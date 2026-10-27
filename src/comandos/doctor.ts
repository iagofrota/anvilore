import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fundirBloco } from "../lib/fundir-bloco";
import { fundirJson } from "../lib/fundir-json";
import { NOME_DO_PERFIL, carregarPerfil, type Perfil } from "../lib/perfil";
import { alvosConhecidos, configuracaoDoHook, tirarHookAntigo, valorDoPath, type Alvo } from "./instalar";
import { avisoRg } from "../lib/rg";

export type Trava = { nome: string; ligada: boolean; comoLigar?: string; detalhe?: string; opcional?: boolean; naoInstalado?: boolean; semTrava?: boolean };
export type Prerequisito = { nome: string; presente: boolean };
export type Diagnostico = { travas: Trava[]; prerequisitos: Prerequisito[]; avisos: string[] };

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
  // R63 refinado pelo R70-H: só se cobra o agente que o clone configurou (pasta de configuração no destino). Agente com CLI no PATH e sem
  // pasta é só "encontrado, sem trava neste clone"; sem CLI nem pasta, "não instalado". Nenhum dos dois reprova.
  const pasta = await stat(join(raiz, dirname(esperado.arquivo))).then(info => info.isDirectory(), () => false);
  if (!pasta) {
    const comCli = Bun.which(alvo, { PATH: path ?? "" }) !== null;
    return { ...trava, opcional: true, naoInstalado: !comCli, semTrava: comCli };
  }
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
async function versaoDoClaude(raiz: string, path: string | undefined): Promise<Trava | undefined> {
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
  const comoLigar = "atualize o Claude Code para a 2.1.295 ou mais nova (o onFailure do hook não existe antes)";
  // R74 I2: só reprova quem configurou o Claude neste clone; a CLI antiga apenas no PATH é um aviso opcional (como os outros agentes).
  const configurado = await stat(join(raiz, ".claude")).then(info => info.isDirectory(), () => false);
  return configurado
    ? { nome, ligada: false, comoLigar, detalhe: `versão encontrada: ${achada[0]}` }
    : { nome, ligada: false, opcional: true, comoLigar: `${comoLigar}, se for usar o Claude Code neste clone`, detalhe: `versão encontrada: ${achada[0]}` };
}

// Tira os comentários de shell/YAML (linha inteira ou depois de ` #`), respeitando aspas: texto comentado não é chamada ativa.
function semComentarios(texto: string): string {
  return texto.split(/\r?\n/).map(linha => {
    let aspas = "";
    for (let i = 0; i < linha.length; i++) {
      const c = linha[i]!;
      if (aspas) { if (c === aspas) aspas = ""; }
      else if (c === "'" || c === '"') aspas = c;
      else if (c === "#" && (i === 0 || /\s/.test(linha[i - 1]!))) return linha.slice(0, i);
    }
    return linha;
  }).join("\n");
}

const CHECAGEM_ATIVA = /checar-docs|cli\.ts"?\s+validar|anvilore validar/;
const DESATIVADO = (condicao: unknown) => condicao === false || (typeof condicao === "string" && /^(?:false|\$\{\{\s*false\s*\}\})$/.test(condicao.trim()));

async function validacaoNoFechamento(raiz: string): Promise<Trava> {
  const nome = "Validação no fechamento da wiki";
  const texto = await ler(join(raiz, "src/comandos/fechar.ts")).catch(() => undefined);
  const chamada = /\bcomandoValidar\s*\(/;
  const ativo = texto?.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  if (ativo !== undefined && chamada.test(ativo)) return { nome, ligada: true };
  const comentada = texto !== undefined && chamada.test(texto);
  return {
    nome, ligada: false, comoLigar: "restaure a chamada ao validador em src/comandos/fechar.ts e rode bun src/cli.ts fechar wiki",
    detalhe: texto === undefined ? "src/comandos/fechar.ts não existe" : comentada ? "a chamada ao validador só aparece em comentário" : undefined,
  };
}

// Etapas `run` ativas de um workflow: ignora comentário (o YAML já os descarta), job ou etapa com `if: false` e blocos `run` comentados por linha.
function etapasAtivas(yaml: string): string[] {
  const fluxo = Bun.YAML.parse(yaml) as { jobs?: Record<string, { if?: unknown; steps?: Array<{ if?: unknown; run?: unknown }> }> };
  const comandos: string[] = [];
  for (const job of Object.values(fluxo?.jobs ?? {})) {
    if (DESATIVADO(job?.if)) continue;
    for (const etapa of job?.steps ?? []) if (!DESATIVADO(etapa?.if) && typeof etapa?.run === "string") comandos.push(semComentarios(etapa.run));
  }
  return comandos;
}

async function checagemAntesDeAceitar(raiz: string): Promise<Trava> {
  const nome = "Checagem antes de aceitar a mudança";
  const comoLigar = "acrescente ao CI (.github/workflows/ci.yml) ou ao pré-commit a etapa: bun src/cli.ts checar-docs";
  const problemas: string[] = [];
  let achouTexto = false;
  try {
    const dir = join(raiz, ".github/workflows");
    for (const arquivo of await readdir(dir)) {
      if (!/\.ya?ml$/.test(arquivo)) continue;
      const texto = await ler(join(dir, arquivo)).catch(() => "") ?? "";
      achouTexto ||= CHECAGEM_ATIVA.test(texto);
      try {
        if (etapasAtivas(texto).some(comando => CHECAGEM_ATIVA.test(comando))) return { nome, ligada: true };
      } catch {
        problemas.push(`${arquivo} não é um YAML válido`);
      }
    }
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code !== "ENOENT") throw erro;
  }
  const preCommit = await ler(join(raiz, ".git/hooks/pre-commit")).catch(() => undefined);
  if (preCommit !== undefined) {
    if (CHECAGEM_ATIVA.test(semComentarios(preCommit))) return { nome, ligada: true };
    achouTexto ||= CHECAGEM_ATIVA.test(preCommit);
  }
  if (achouTexto) problemas.push("a checagem só aparece em comentário ou em etapa desativada");
  return { nome, ligada: false, comoLigar, detalhe: problemas.length ? problemas.join("; ") : undefined };
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
  // Sai 1 se nenhum agente do destino tem a proteção ligada, mesmo que cada agente avulso seja opcional.
  if (!travas.some(trava => trava.ligada)) {
    const sugerido = alvosConhecidos.find(alvo => Bun.which(alvo, { PATH: path ?? "" }) !== null) ?? "claude";
    travas.push({ nome: "Proteção do raw/ em pelo menos um agente", ligada: false, comoLigar: comandoInstalar(raiz, sugerido), detalhe: "nenhum agente deste clone tem o hook instalado" });
  }
  const versao = await versaoDoClaude(raiz, path);
  if (versao) travas.push(versao);
  travas.push(await validacaoNoFechamento(raiz), await checagemAntesDeAceitar(raiz), await perfilDaEmpresa(raiz));
  const perfil: Perfil = await carregarPerfil(raiz).catch(() => ({}));
  travas.push(
    { nome: "Commit automático das páginas de wiki", ligada: perfil.hooks?.autoCommit === true, opcional: true, comoLigar: `${comandoInstalar(raiz, "claude")} --auto-commit` },
    { nome: "Backup da branch no GitHub", ligada: perfil.hooks?.githubBackup === true, opcional: true, comoLigar: `${comandoInstalar(raiz, "claude")} --github-backup` },
  );
  const prerequisitos = ["bun", "git"].map(nome => ({ nome, presente: Bun.which(nome, { PATH: path ?? "" }) !== null }));
  const aviso = avisoRg(path);
  const avisos = aviso ? [aviso] : [];
  if (await stat(join(raiz, ".gemini")).then(info => info.isDirectory(), () => false)) avisos.push("Gemini: não há evento FileChanged nem origem compact para SessionStart; W12/W13 não estão disponíveis neste agente.");
  if (await stat(join(raiz, ".github/copilot")).then(info => info.isDirectory(), () => false)) avisos.push("Copilot: não há evento FileChanged nem matcher de compactação; W12/W13 não estão disponíveis. O evento agentStop não oferece mensagem terminal sem bloquear a próxima rodada, então W14 não está disponível.");
  if (await stat(join(raiz, ".codex")).then(info => info.isDirectory(), () => false)) avisos.push("Codex: não há evento FileChanged; W12 não está disponível neste agente.");
  return { travas, prerequisitos, avisos };
}

function linhas(trava: Trava): string[] {
  if (trava.ligada) return [`  ${trava.nome}: ligada`];
  if (trava.semTrava) return [`  ${trava.nome}: encontrado, sem trava neste clone (opcional: ${trava.comoLigar})`];
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
  const { travas, prerequisitos, avisos } = await diagnosticar(raiz);
  const faltam = travas.filter(trava => !trava.ligada && !trava.opcional).length;
  const ausentes = prerequisitos.filter(item => !item.presente).length;
  console.log(`anvilore doctor — ${raiz}`);
  console.log("Travas (o que impede o agente de atravessar a fronteira):");
  for (const trava of travas) for (const texto of linhas(trava)) console.log(texto);
  console.log("Pré-requisitos:");
  for (const item of prerequisitos) console.log(`  ${item.nome}: ${item.presente ? "presente" : `ausente — instale em ${ONDE_INSTALAR[item.nome]}`}`);
  for (const aviso of avisos) console.log(`AVISO: ${aviso}`);
  if (!faltam && !ausentes) {
    console.log("Resultado: tudo ligado.");
    return 0;
  }
  console.log(`Resultado: faltam ${faltam} trava(s) e ${ausentes} pré-requisito(s). Rode os comandos acima e depois o doctor de novo.`);
  return 1;
}
