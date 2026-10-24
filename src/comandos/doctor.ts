import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fundirBloco } from "../lib/fundir-bloco";
import { fundirJson } from "../lib/fundir-json";
import { NOME_DO_PERFIL, carregarPerfil } from "../lib/perfil";
import { alvosConhecidos, configuracaoDoHook, tirarHookAntigo, valorDoPath, type Alvo } from "./instalar";

export type Trava = { nome: string; ligada: boolean; comoLigar?: string; detalhe?: string; opcional?: boolean; naoInstalado?: boolean };
export type Prerequisito = { nome: string; presente: boolean };
export type Diagnostico = { travas: Trava[]; prerequisitos: Prerequisito[] };

const AGENTES: Record<Alvo, string> = { claude: "Claude Code", codex: "Codex", gemini: "Gemini", copilot: "Copilot" };
const HOOK_ANTIGO = "hooks/proteger-raw.sh";

async function ler(caminho: string): Promise<string | undefined> {
  try {
    return await readFile(caminho, "utf8");
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw erro;
  }
}

function comandoInstalar(raiz: string, alvo: Alvo): string {
  const destino = resolve(raiz) === process.cwd() ? "" : ` --destino "${raiz}"`;
  return `bun src/cli.ts instalar --alvo ${alvo}${destino}`;
}

// Lê a configuração do agente do mesmo jeito que o `instalar` a escreve: o hook está ligado quando a fusão não teria o que acrescentar.
async function protecaoDoRaw(raiz: string, alvo: Alvo, path: string | undefined): Promise<Trava> {
  const trava: Trava = { nome: `Proteção do raw/ no ${AGENTES[alvo]}`, ligada: false, comoLigar: comandoInstalar(raiz, alvo) };
  const esperado = await configuracaoDoHook(alvo, await realpath(raiz));
  // R63: só cobra o agente presente — CLI no PATH ou pasta de configuração já criada no destino.
  const pasta = await stat(join(raiz, dirname(esperado.arquivo))).then(info => info.isDirectory(), () => false);
  if (Bun.which(alvo, { PATH: path ?? "" }) === null && !pasta) return { ...trava, opcional: true, naoInstalado: true };
  let atual: string | undefined;
  try {
    atual = await ler(join(raiz, esperado.arquivo));
  } catch (erro) {
    return { ...trava, detalhe: `${esperado.arquivo}: não foi possível ler (${(erro as Error).message})` };
  }
  if (atual === undefined) return { ...trava, detalhe: `${esperado.arquivo} não existe` };
  if (esperado.bloco !== undefined) {
    if (fundirBloco(atual, "anvilore", esperado.bloco, "#").veredito === "INALTERADO") return { nome: trava.nome, ligada: true };
    return { ...trava, detalhe: atual.includes(HOOK_ANTIGO) ? `hook antigo em ${esperado.arquivo}; reinstale` : `${esperado.arquivo} não traz o hook atual` };
  }
  let dados: unknown;
  try {
    dados = JSON.parse(atual);
  } catch (erro) {
    return { ...trava, detalhe: `${esperado.arquivo}: não foi possível ler (${(erro as Error).message})` };
  }
  if (!isDeepStrictEqual(tirarHookAntigo(dados), dados)) return { ...trava, detalhe: `hook antigo em ${esperado.arquivo}; reinstale` };
  try {
    const apenasHook = { hooks: (esperado.json as { hooks: unknown }).hooks };
    if (fundirJson(dados, apenasHook).veredito === "INALTERADO") return { nome: trava.nome, ligada: true };
  } catch { /* configuração em conflito com o hook: cai no relato abaixo */ }
  return { ...trava, detalhe: `${esperado.arquivo} não traz o hook atual` };
}

// `onFailure` do hook do Claude Code só existe a partir da 2.1.295 (https://code.claude.com/docs/en/hooks); antes, a chave pode ser ignorada.
async function versaoDoClaude(path: string | undefined): Promise<Trava | undefined> {
  const exe = Bun.which("claude", { PATH: path ?? "" });
  if (exe === null) return undefined;
  const nome = "Versão do Claude Code (o hook usa onFailure)";
  let saida = "";
  try {
    saida = Bun.spawnSync([exe, "--version"], { stdout: "pipe", stderr: "pipe" }).stdout.toString();
  } catch { /* cai no aviso de versão ilegível */ }
  const achada = /(\d+)\.(\d+)\.(\d+)/.exec(saida);
  if (!achada) return { nome, ligada: false, opcional: true, comoLigar: "rode `claude --version` e confira que é a 2.1.295 ou mais nova", detalhe: "não consegui ler a versão" };
  const [maior, menor, correcao] = [Number(achada[1]), Number(achada[2]), Number(achada[3])];
  const antiga = maior < 2 || (maior === 2 && (menor < 1 || (menor === 1 && correcao < 295)));
  if (!antiga) return { nome, ligada: true };
  return { nome, ligada: false, comoLigar: "atualize o Claude Code para a 2.1.295 ou mais nova (o onFailure do hook não existe antes)", detalhe: `versão encontrada: ${achada[0]}` };
}

async function validacaoNoFechamento(raiz: string): Promise<Trava> {
  const nome = "Validação no fechamento da wiki";
  const texto = await ler(join(raiz, "scripts/fechar-wiki.sh")).catch(() => undefined);
  if (texto !== undefined && /cli\.ts"?\s+validar/.test(texto)) return { nome, ligada: true };
  return { nome, ligada: false, comoLigar: "faça scripts/fechar-wiki.sh chamar: bun src/cli.ts validar wiki", detalhe: texto === undefined ? "scripts/fechar-wiki.sh não existe" : undefined };
}

async function checagemAntesDeAceitar(raiz: string): Promise<Trava> {
  const nome = "Checagem antes de aceitar a mudança";
  const procurados: string[] = [];
  try {
    const dir = join(raiz, ".github/workflows");
    for (const arquivo of await readdir(dir)) if (/\.ya?ml$/.test(arquivo)) procurados.push(join(dir, arquivo));
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code !== "ENOENT") throw erro;
  }
  procurados.push(join(raiz, ".git/hooks/pre-commit"));
  for (const caminho of procurados) {
    if (/checar-docs|cli\.ts"?\s+validar|anvilore validar/.test(await ler(caminho).catch(() => "") ?? "")) return { nome, ligada: true };
  }
  return { nome, ligada: false, comoLigar: "acrescente ao CI (.github/workflows/ci.yml) ou ao pré-commit a etapa: bun src/cli.ts checar-docs" };
}

async function perfilDaEmpresa(raiz: string): Promise<Trava> {
  const nome = `Perfil da empresa (${NOME_DO_PERFIL})`;
  if (await ler(join(raiz, NOME_DO_PERFIL)).catch(() => "ilegível") === undefined) {
    return { nome, ligada: false, opcional: true, comoLigar: `crie ${NOME_DO_PERFIL} na raiz para restringir áreas, tipos e campos` };
  }
  try {
    await carregarPerfil(raiz);
    return { nome, ligada: true };
  } catch (erro) {
    return { nome, ligada: false, comoLigar: `corrija ${NOME_DO_PERFIL}`, detalhe: (erro as Error).message };
  }
}

export async function diagnosticar(raiz: string, ambiente: Record<string, string | undefined> = process.env): Promise<Diagnostico> {
  const travas: Trava[] = [];
  const path = valorDoPath(ambiente);
  for (const alvo of alvosConhecidos) travas.push(await protecaoDoRaw(raiz, alvo, path));
  const versao = await versaoDoClaude(path);
  if (versao) travas.push(versao);
  travas.push(await validacaoNoFechamento(raiz), await checagemAntesDeAceitar(raiz), await perfilDaEmpresa(raiz));
  const prerequisitos = ["bun", "git"].map(nome => ({ nome, presente: Bun.which(nome, { PATH: path ?? "" }) !== null }));
  return { travas, prerequisitos };
}

function linhas(trava: Trava): string[] {
  if (trava.ligada) return [`  ${trava.nome}: ligada`];
  if (trava.naoInstalado) return [`  ${trava.nome}: não instalado (opcional) — se usar este agente, para ligar: ${trava.comoLigar}`];
  if (trava.opcional) return [`  ${trava.nome}: não configurado (opcional) — para ligar: ${trava.comoLigar}`];
  const principal = `  ${trava.nome}: desligada — para ligar: ${trava.comoLigar}`;
  return trava.detalhe ? [principal, `    motivo: ${trava.detalhe}`] : [principal];
}

const AJUDA = "Uso: anvilore doctor [pasta]  (padrão: ANVILORE_DESTINO ou o diretório atual)";
const ONDE_INSTALAR: Record<string, string> = { bun: "https://bun.sh", git: "https://git-scm.com" };

export async function comandoDoctor(args: string[]): Promise<number> {
  if (args.length > 1 || args[0]?.startsWith("-")) {
    console.error(AJUDA);
    return 2;
  }
  const raiz = resolve(args[0] ?? process.env.ANVILORE_DESTINO ?? process.cwd());
  try {
    if (!(await stat(raiz)).isDirectory()) throw new Error("não é um diretório");
  } catch (erro) {
    console.error(`doctor: ${raiz}: ${(erro as Error).message}`);
    return 1;
  }
  const { travas, prerequisitos } = await diagnosticar(raiz);
  const faltam = travas.filter(trava => !trava.ligada && !trava.opcional).length;
  const ausentes = prerequisitos.filter(item => !item.presente).length;
  console.log(`anvilore doctor — ${raiz}`);
  console.log("Travas (o que impede o agente de atravessar a fronteira):");
  for (const trava of travas) for (const texto of linhas(trava)) console.log(texto);
  console.log("Pré-requisitos:");
  for (const item of prerequisitos) console.log(`  ${item.nome}: ${item.presente ? "presente" : `ausente — instale em ${ONDE_INSTALAR[item.nome]}`}`);
  if (!faltam && !ausentes) {
    console.log("Resultado: tudo ligado.");
    return 0;
  }
  console.log(`Resultado: faltam ${faltam} trava(s) e ${ausentes} pré-requisito(s). Rode os comandos acima e depois o doctor de novo.`);
  return 1;
}
