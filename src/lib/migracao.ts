import { createHash, randomBytes } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { LISTA_DO_RASTREIO } from "./modelos";
import { caminhoWiki, inicializarRepositorioWiki, repositorioDaWiki } from "./wiki-repo";

// PLANO §4b: tirar do rastreio do kit o que é da pessoa sem perder nada. Cada etapa grava o próprio nome no manifesto
// antes de começar; o que a pessoa tem no disco é copiado com SHA-256 antes de qualquer mudança e nunca é apagado.
// Nada aqui chama `unlink` num arquivo da pessoa: estacionar é `rename` para dentro de `.anvilore/` (ignorado pelo kit).

export type ResultadoGit = { codigo: number; saida: string };
export type Git = (args: string[]) => ResultadoGit;
export type Etapa = "copiar" | "repositorio-wiki" | "tirar-do-indice" | "conferir" | "estacionar" | "puxar" | "devolver";
export type EstadoMigracao = "migrando" | "concluida" | "migracao-incompleta" | "puxando" | "retomada";
export type Arquivo = { caminho: string; sha256: string };

export interface Manifesto {
  versao: 1;
  id: string;
  tipo: "migracao" | "puxar";
  criado: string;
  estado: EstadoMigracao;
  etapa?: Etapa;
  erro?: string;
  arquivos: Arquivo[];
  // Rastreados pelo kit e já ausentes do disco (a pessoa apagou): saem do índice e continuam apagados.
  ausentes: string[];
  rastreados: string[];
  estacionados?: string[];
  wiki?: { caminho: string; criada: boolean; commit: boolean };
  retomadaPor?: string;
}

export interface Dependencias {
  git?: Git;
  // Chamado ao entrar em cada etapa, já com a etapa gravada. Os testes usam para provocar falha (ou morte) no meio.
  aoEntrarNaEtapa?: (etapa: Etapa, manifesto: Manifesto) => void | Promise<void>;
  ambiente?: Record<string, string | undefined>;
}

export type Resultado = {
  codigo: 0 | 1;
  situacao: "nada-a-migrar" | "migrada" | "puxada" | "incompleta" | "pull-falhou";
  mensagens: string[];
  manifesto?: Manifesto;
};

const TERMINAIS: EstadoMigracao[] = ["concluida", "retomada"];
export const PASTA_MIGRACAO = join(".anvilore", "migracao");

function gitPadrao(raiz: string): Git {
  return (args) => {
    const exe = Bun.which("git");
    if (exe === null) return { codigo: 127, saida: "git ausente do PATH" };
    try {
      const processo = Bun.spawnSync([exe, "-C", raiz, ...args], { stdout: "pipe", stderr: "pipe" });
      return { codigo: processo.exitCode, saida: `${processo.stdout.toString()}${processo.stderr.toString()}` };
    } catch (erro) { return { codigo: 126, saida: motivo(erro) }; }
  };
}

function motivo(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

const noDisco = (raiz: string, rel: string) => join(raiz, ...rel.split("/"));

async function tipo(caminho: string): Promise<"arquivo" | "outro" | "ausente"> {
  try {
    return (await lstat(caminho)).isFile() ? "arquivo" : "outro";
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === "ENOENT" || (erro as NodeJS.ErrnoException).code === "ENOTDIR") return "ausente";
    throw erro;
  }
}

export async function sha256(caminho: string): Promise<string> {
  return createHash("sha256").update(await readFile(caminho)).digest("hex");
}

function listaZ(saida: string): string[] {
  return saida.split("\0").filter(Boolean).map(rel => rel.replaceAll("\\", "/")).sort();
}

// Só vale para a raiz de um repositório git: uma pasta dentro de outro repositório não é o clone do kit.
export async function ehClone(raiz: string, git: Git): Promise<boolean> {
  const topo = git(["rev-parse", "--show-toplevel"]);
  if (topo.codigo !== 0) return false;
  try { return await realpath(topo.saida.trim()) === await realpath(raiz); } catch { return false; }
}

// O que da lista o índice do kit ainda rastreia.
export function rastreadosNoIndice(git: Git): string[] {
  const r = git(["ls-files", "-z", "--", ...LISTA_DO_RASTREIO]);
  if (r.codigo !== 0) throw new Error(`git ls-files falhou: ${r.saida.trim()}`);
  return listaZ(r.saida);
}

// O que da lista o commit atual rastreia: é o conjunto que um `git pull` pode querer tocar.
function rastreadosNoHead(git: Git): string[] {
  const r = git(["ls-tree", "-r", "-z", "--name-only", "HEAD", "--", ...LISTA_DO_RASTREIO]);
  if (r.codigo !== 0) throw new Error(`git ls-tree falhou: ${r.saida.trim()}`);
  return listaZ(r.saida);
}

async function gravarManifesto(raiz: string, manifesto: Manifesto): Promise<void> {
  const destino = join(raiz, PASTA_MIGRACAO, manifesto.id, "manifesto.json");
  const temporario = `${destino}.${process.pid}.tmp`;
  await writeFile(temporario, `${JSON.stringify(manifesto, null, 2)}\n`);
  await rename(temporario, destino); // temporário + renomear: o manifesto nunca fica pela metade
}

const ETAPAS: Etapa[] = ["copiar", "repositorio-wiki", "tirar-do-indice", "conferir", "estacionar", "puxar", "devolver"];
const ESTADOS: EstadoMigracao[] = ["migrando", "concluida", "migracao-incompleta", "puxando", "retomada"];

// Caminho relativo ao clone, com `/`, sem `..`, sem unidade e sem raiz: é para lá que a restauração escreve.
function caminhoSeguro(valor: unknown): valor is string {
  if (typeof valor !== "string" || valor === "" || /^[\\/]|^[a-z]:|\\/i.test(valor)) return false;
  return valor.split("/").every(parte => parte !== "" && parte !== "." && parte !== "..");
}

const listaDeCaminhos = (valor: unknown): valor is string[] => Array.isArray(valor) && valor.every(caminhoSeguro);
const textoOpcional = (valor: unknown) => valor === undefined || typeof valor === "string";

// O manifesto é o mapa de onde estão os arquivos da pessoa: com qualquer campo fora da forma, a retomada não sabe o que
// devolver. Então ele é conferido por inteiro (inclusive o id contra o nome da pasta) e, inválido, bloqueia.
function defeitoDoManifesto(dado: unknown, id: string): string | undefined {
  if (dado === null || typeof dado !== "object" || Array.isArray(dado)) return "não é um objeto";
  const m = dado as Record<string, unknown>;
  if (m.versao !== 1) return "versao diferente de 1";
  if (m.id !== id) return `id ${JSON.stringify(m.id)} diferente do nome da pasta`;
  if (m.tipo !== "migracao" && m.tipo !== "puxar") return "tipo desconhecido";
  if (typeof m.criado !== "string") return "sem data de criação";
  if (!ESTADOS.includes(m.estado as EstadoMigracao)) return `estado desconhecido ${JSON.stringify(m.estado)}`;
  if (m.etapa !== undefined && !ETAPAS.includes(m.etapa as Etapa)) return `etapa desconhecida ${JSON.stringify(m.etapa)}`;
  if (!textoOpcional(m.erro) || !textoOpcional(m.retomadaPor)) return "erro ou retomadaPor fora da forma";
  if (!Array.isArray(m.arquivos) || !m.arquivos.every(a => a !== null && typeof a === "object" && caminhoSeguro((a as Arquivo).caminho) && /^[a-f0-9]{64}$/.test(String((a as Arquivo).sha256)))) {
    return "lista de arquivos ausente ou fora da forma";
  }
  if (!listaDeCaminhos(m.ausentes) || !listaDeCaminhos(m.rastreados)) return "ausentes ou rastreados fora da forma";
  if (m.estacionados !== undefined && !listaDeCaminhos(m.estacionados)) return "estacionados fora da forma";
  const wiki = m.wiki as Record<string, unknown> | undefined;
  if (wiki !== undefined && (wiki === null || typeof wiki !== "object" || typeof wiki.caminho !== "string" || typeof wiki.criada !== "boolean" || typeof wiki.commit !== "boolean")) {
    return "wiki fora da forma";
  }
  return undefined;
}

async function temArquivoDentro(pasta: string): Promise<boolean> {
  try {
    for (const entrada of await readdir(pasta, { recursive: true, withFileTypes: true })) if (!entrada.isDirectory()) return true;
    return false;
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw erro;
  }
}

function bloqueio(id: string, motivo: string): Error {
  const pasta = join(PASTA_MIGRACAO, id);
  return new Error(`manifesto ${motivo} em ${pasta}. Nada seu foi apagado: a cópia e o que estiver estacionado continuam em ${pasta}. Devolva os arquivos de ${join(pasta, "estacionados")} ao lugar, se houver, e só então tire a pasta daí`);
}

export async function lerManifestos(raiz: string): Promise<Manifesto[]> {
  let ids: string[];
  try {
    ids = await readdir(join(raiz, PASTA_MIGRACAO));
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw erro;
  }
  const manifestos: Manifesto[] = [];
  for (const id of ids.sort()) {
    let texto: string;
    try {
      texto = await readFile(join(raiz, PASTA_MIGRACAO, id, "manifesto.json"), "utf8");
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code !== "ENOENT") throw bloqueio(id, `ilegível (${motivo(erro)})`);
      // Pasta sem manifesto: morte antes de gravá-lo (vazia) passa; com arquivo estacionado, a pessoa tem algo fora do lugar.
      if (await temArquivoDentro(join(raiz, PASTA_MIGRACAO, id, "estacionados"))) throw bloqueio(id, "ausente com arquivos estacionados");
      continue;
    }
    let dado: unknown;
    try { dado = JSON.parse(texto); } catch (erro) { throw bloqueio(id, `ilegível (${motivo(erro)})`); }
    const defeito = defeitoDoManifesto(dado, id);
    if (defeito) throw bloqueio(id, `inválido (${defeito})`);
    manifestos.push(dado as Manifesto);
  }
  return manifestos;
}

export async function pendentes(raiz: string): Promise<Manifesto[]> {
  return (await lerManifestos(raiz)).filter(m => !TERMINAIS.includes(m.estado));
}

async function novoManifesto(raiz: string, tipoDoManifesto: Manifesto["tipo"], rastreados: string[]): Promise<Manifesto> {
  await mkdir(join(raiz, PASTA_MIGRACAO), { recursive: true });
  for (;;) {
    const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
    try {
      await mkdir(join(raiz, PASTA_MIGRACAO, id)); // sem `recursive`: falha se outro processo pegou o mesmo id
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw erro;
    }
    const manifesto: Manifesto = {
      versao: 1, id, tipo: tipoDoManifesto, criado: new Date().toISOString(),
      estado: tipoDoManifesto === "puxar" ? "puxando" : "migrando", arquivos: [], ausentes: [], rastreados,
    };
    await gravarManifesto(raiz, manifesto);
    return manifesto;
  }
}

async function entrar(raiz: string, manifesto: Manifesto, etapa: Etapa, deps: Dependencias): Promise<void> {
  manifesto.etapa = etapa;
  await gravarManifesto(raiz, manifesto);
  await deps.aoEntrarNaEtapa?.(etapa, manifesto);
}

const copiaDe = (raiz: string, manifesto: Manifesto, rel: string) => noDisco(join(raiz, PASTA_MIGRACAO, manifesto.id, "arquivos"), rel);
const vagaDe = (raiz: string, manifesto: Manifesto, rel: string) => noDisco(join(raiz, PASTA_MIGRACAO, manifesto.id, "estacionados"), rel);

// Passo 1: copia cada arquivo presente, editado ou não, e confere o SHA-256 da cópia contra o original.
async function copiar(raiz: string, manifesto: Manifesto, caminhos: string[]): Promise<void> {
  for (const rel of caminhos) {
    const original = noDisco(raiz, rel);
    const situacao = await tipo(original);
    if (situacao === "ausente") { manifesto.ausentes.push(rel); continue; }
    if (situacao === "outro") throw new Error(`${rel} existe e não é um arquivo comum; nada foi mexido`);
    const copia = copiaDe(raiz, manifesto, rel);
    await mkdir(dirname(copia), { recursive: true });
    await copyFile(original, copia);
    const [hashOriginal, hashCopia] = [await sha256(original), await sha256(copia)];
    if (hashOriginal !== hashCopia) throw new Error(`a cópia de ${rel} não confere com o original (SHA-256)`);
    manifesto.arquivos.push({ caminho: rel, sha256: hashOriginal });
  }
  await gravarManifesto(raiz, manifesto);
}

// Devolve da cópia o que faltar ou divergir. `soAusentes`: na retomada, um arquivo presente e diferente pode ser edição
// legítima da pessoa depois da falha, e fica como está.
async function restaurar(raiz: string, manifesto: Manifesto, soAusentes: boolean): Promise<string[]> {
  const problemas: string[] = [];
  for (const { caminho: rel, sha256: esperado } of manifesto.arquivos) {
    const alvo = noDisco(raiz, rel);
    try {
      const situacao = await tipo(alvo);
      if (situacao === "arquivo" && (soAusentes || await sha256(alvo) === esperado)) continue;
      if (situacao === "outro") throw new Error("o caminho está ocupado por algo que não é arquivo; não apago nada");
      await mkdir(dirname(alvo), { recursive: true });
      await copyFile(copiaDe(raiz, manifesto, rel), alvo);
      if (await sha256(alvo) !== esperado) throw new Error("o SHA-256 depois de restaurar não confere");
    } catch (erro) {
      problemas.push(`${rel}: ${motivo(erro)}`);
    }
  }
  return problemas;
}

async function garantirRepositorioDaWiki(raiz: string, manifesto: Manifesto, git: Git, ambiente: Record<string, string | undefined>): Promise<void> {
  const wiki = caminhoWiki(raiz, ambiente);
  const existia = await repositorioDaWiki(wiki);
  if (!existia) await inicializarRepositorioWiki(raiz, ambiente);
  const gitWiki = (args: string[]) => git(["-C", wiki, ...args]);
  // Repositório criado à mão e sem commit: o primeiro commit guarda o que já está lá.
  if (gitWiki(["rev-parse", "--verify", "--quiet", "HEAD"]).codigo !== 0) {
    for (const args of [["add", "-A"], ["-c", "user.name=Anvilore", "-c", "user.email=anvilore@localhost", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-q", "-m", "wiki: início"]]) {
      const r = gitWiki(args);
      if (r.codigo !== 0) throw new Error(`não foi possível criar o primeiro commit da wiki: ${r.saida.trim()}`);
    }
  }
  manifesto.wiki = { caminho: wiki, criada: !existia, commit: gitWiki(["rev-parse", "--verify", "--quiet", "HEAD"]).codigo === 0 };
}

// Passo 4: o índice não lista mais nenhum; cada arquivo tem o SHA-256 da cópia (o que divergiu volta da cópia); a wiki tem commit.
async function conferir(raiz: string, manifesto: Manifesto, git: Git): Promise<string[]> {
  const problemas = rastreadosNoIndice(git).map(rel => `${rel}: o índice do kit ainda o rastreia`);
  problemas.push(...await restaurar(raiz, manifesto, false));
  if (manifesto.wiki && !manifesto.wiki.commit) problemas.push(`${manifesto.wiki.caminho}: a wiki não tem commit`);
  return problemas;
}

async function falhar(raiz: string, manifesto: Manifesto, erro: string, situacao: "incompleta" = "incompleta"): Promise<Resultado> {
  // Antes de declarar a falha, devolve da cópia o que faltar: a falha nunca deixa um arquivo da pessoa fora do lugar.
  const naoDevolvidos = await restaurar(raiz, manifesto, true);
  manifesto.estado = "migracao-incompleta";
  manifesto.erro = [erro, ...naoDevolvidos].join("; ");
  await gravarManifesto(raiz, manifesto);
  const pasta = join(PASTA_MIGRACAO, manifesto.id);
  return {
    codigo: 1, situacao, manifesto,
    mensagens: [
      `A migração parou na etapa "${manifesto.etapa}": ${manifesto.erro}.`,
      `Nada seu foi apagado. A cópia conferida está em ${pasta}/arquivos/.`,
      "Resolva o motivo e rode de novo `anvilore migrar-rastreio`: ele retoma daqui.",
    ],
  };
}

// Manifestos que ficaram pela metade (falha ou processo morto): devolve o que estiver estacionado ou faltando.
async function retomar(raiz: string): Promise<string[]> {
  const problemas: string[] = [];
  for (const antigo of await pendentes(raiz)) {
    const erros: string[] = [];
    for (const rel of antigo.estacionados ?? []) {
      const vaga = vagaDe(raiz, antigo, rel);
      if (await tipo(vaga) !== "arquivo") continue;
      const alvo = noDisco(raiz, rel);
      if (await tipo(alvo) !== "ausente") { erros.push(`${rel}: o lugar está ocupado; o seu ficou em ${join(PASTA_MIGRACAO, antigo.id, "estacionados")}`); continue; }
      try {
        await mkdir(dirname(alvo), { recursive: true });
        await rename(vaga, alvo);
      } catch (erro) { erros.push(`${rel}: ${motivo(erro)}`); }
    }
    erros.push(...await restaurar(raiz, antigo, true));
    if (erros.length) {
      antigo.estado = "migracao-incompleta";
      antigo.erro = erros.join("; ");
      problemas.push(...erros);
    } else {
      antigo.estado = "retomada";
      delete antigo.erro;
    }
    await gravarManifesto(raiz, antigo);
  }
  return problemas;
}

async function travar(raiz: string): Promise<() => Promise<void>> {
  const trava = join(raiz, ".anvilore", "migracao.lock");
  await mkdir(dirname(trava), { recursive: true });
  try {
    await writeFile(trava, String(process.pid), { flag: "wx" });
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code !== "EEXIST") throw erro;
    const dono = Number(await readFile(trava, "utf8").catch(() => ""));
    let vivo = false;
    try { if (dono > 0 && dono !== process.pid) { process.kill(dono, 0); vivo = true; } } catch { /* processo não existe: trava velha */ }
    if (vivo) throw new Error(`outra migração está rodando (processo ${dono}; trava em .anvilore/migracao.lock)`);
    await writeFile(trava, String(process.pid));
  }
  return () => rm(trava, { force: true });
}

async function preparar(raiz: string, deps: Dependencias): Promise<{ git: Git; soltar: () => Promise<void> } | Resultado> {
  const git = deps.git ?? gitPadrao(raiz);
  if (!(await ehClone(raiz, git))) {
    return { codigo: 1, situacao: "incompleta", mensagens: [`${raiz} não é a raiz de um clone git do kit; nada a migrar aqui.`] };
  }
  try {
    return { git, soltar: await travar(raiz) };
  } catch (erro) {
    return { codigo: 1, situacao: "incompleta", mensagens: [motivo(erro)] };
  }
}

async function migrarComTrava(raiz: string, git: Git, deps: Dependencias): Promise<Resultado> {
  let problemasDaRetomada: string[];
  try {
    problemasDaRetomada = await retomar(raiz);
  } catch (erro) {
    return { codigo: 1, situacao: "incompleta", mensagens: [`Não sigo: ${motivo(erro)}.`] };
  }
  if (problemasDaRetomada.length) {
    return { codigo: 1, situacao: "incompleta", mensagens: ["Uma migração anterior não terminou e ainda não consegui devolver tudo:", ...problemasDaRetomada.map(p => `  ${p}`)] };
  }
  const rastreados = rastreadosNoIndice(git);
  if (rastreados.length === 0) return { codigo: 0, situacao: "nada-a-migrar", mensagens: ["Nada a migrar: o kit já não rastreia os seus arquivos."] };

  const manifesto = await novoManifesto(raiz, "migracao", rastreados);
  try {
    await entrar(raiz, manifesto, "copiar", deps);
    await copiar(raiz, manifesto, rastreados);
    await entrar(raiz, manifesto, "repositorio-wiki", deps);
    await garantirRepositorioDaWiki(raiz, manifesto, git, deps.ambiente ?? process.env);
    await gravarManifesto(raiz, manifesto);
    await entrar(raiz, manifesto, "tirar-do-indice", deps);
    const rm = git(["rm", "--cached", "-q", "--", ...rastreados]);
    if (rm.codigo !== 0) throw new Error(`git rm --cached falhou: ${rm.saida.trim()}`);
    await entrar(raiz, manifesto, "conferir", deps);
    const problemas = await conferir(raiz, manifesto, git);
    if (problemas.length) throw new Error(problemas.join("; "));
  } catch (erro) {
    return falhar(raiz, manifesto, motivo(erro));
  }
  manifesto.estado = "concluida";
  delete manifesto.etapa;
  await gravarManifesto(raiz, manifesto);
  const wiki = manifesto.wiki?.criada ? " A wiki ganhou repositório próprio, com um commit do que já havia nela." : "";
  return {
    codigo: 0, situacao: "migrada", manifesto,
    mensagens: [
      `Migração concluída: ${rastreados.length} arquivo(s) saíram do rastreio do kit e continuam no disco, conferidos pelo SHA-256.${wiki}`,
      ...(manifesto.ausentes.length ? [`Já estavam apagados e continuam apagados: ${manifesto.ausentes.join(", ")}.`] : []),
      `Cópia em ${join(PASTA_MIGRACAO, manifesto.id)}/arquivos/.`,
      "Para atualizar este clone, use `anvilore migrar-rastreio --puxar` (um `git pull` direto recusa enquanto estes arquivos estão no disco).",
    ],
  };
}

export async function migrarRastreio(raiz: string, deps: Dependencias = {}): Promise<Resultado> {
  const pronto = await preparar(raiz, deps);
  if ("codigo" in pronto) return pronto;
  try {
    return await migrarComTrava(raiz, pronto.git, deps);
  } finally {
    await pronto.soltar();
  }
}

// PLANO §4b passo 5 no clone de desenvolvimento: o `git pull` da versão que tira os arquivos do rastreio recusa enquanto
// eles estão no disco ("untracked working tree files would be removed"). Então: migra se faltar, fotografa de novo,
// estaciona por `rename` o que o HEAD rastreia, puxa com `--ff-only` e devolve conferindo o SHA-256. Falhou o pull,
// devolve na hora. Morreu no meio, o manifesto fica "puxando" e a próxima execução devolve antes de qualquer coisa.
export async function puxar(raiz: string, deps: Dependencias & { argsDoPull?: string[] } = {}): Promise<Resultado> {
  const pronto = await preparar(raiz, deps);
  if ("codigo" in pronto) return pronto;
  const { git } = pronto;
  try {
    const migracao = await migrarComTrava(raiz, git, deps);
    if (migracao.codigo !== 0) return migracao;
    const mensagens = migracao.situacao === "migrada" ? [...migracao.mensagens.slice(0, -1)] : [];
    const estacionar: string[] = [];
    for (const rel of rastreadosNoHead(git)) if (await tipo(noDisco(raiz, rel)) === "arquivo") estacionar.push(rel);

    const manifesto = await novoManifesto(raiz, "puxar", estacionar);
    let pull: ResultadoGit;
    try {
      await entrar(raiz, manifesto, "copiar", deps);
      await copiar(raiz, manifesto, estacionar);
      manifesto.estacionados = estacionar;
      await entrar(raiz, manifesto, "estacionar", deps);
      for (const rel of estacionar) {
        const vaga = vagaDe(raiz, manifesto, rel);
        await mkdir(dirname(vaga), { recursive: true });
        await rename(noDisco(raiz, rel), vaga);
      }
      await entrar(raiz, manifesto, "puxar", deps);
      pull = git(["pull", "--ff-only", ...(deps.argsDoPull ?? [])]);
      await entrar(raiz, manifesto, "devolver", deps);
    } catch (erro) {
      pull = { codigo: 1, saida: `parou na etapa "${manifesto.etapa}": ${motivo(erro)}` };
    }
    // Com o pull bom ou não, tudo o que foi estacionado volta agora e é conferido.
    const problemas = await devolver(raiz, manifesto);
    if (problemas.length) return falhar(raiz, manifesto, [...(pull.codigo === 0 ? [] : [pull.saida.trim()]), ...problemas].join("; "));
    manifesto.estado = "concluida";
    delete manifesto.etapa;
    if (pull.codigo !== 0) manifesto.erro = `git pull: ${pull.saida.trim()}`;
    await gravarManifesto(raiz, manifesto);
    const devolvidos = `${manifesto.arquivos.length} arquivo(s) seu(s) voltaram ao lugar, conferidos pelo SHA-256.`;
    if (pull.codigo !== 0) {
      return { codigo: 1, situacao: "pull-falhou", manifesto, mensagens: [...mensagens, `O git pull falhou e nada foi atualizado: ${pull.saida.trim()}`, devolvidos] };
    }
    return { codigo: 0, situacao: "puxada", manifesto, mensagens: [...mensagens, `Atualizado com git pull. ${devolvidos}`] };
  } finally {
    await pronto.soltar();
  }
}

// Devolve os estacionados (rename de volta) e confere contra a fotografia; o que não der, volta da cópia.
async function devolver(raiz: string, manifesto: Manifesto): Promise<string[]> {
  const problemas: string[] = [];
  for (const rel of manifesto.estacionados ?? []) {
    const vaga = vagaDe(raiz, manifesto, rel);
    if (await tipo(vaga) !== "arquivo") continue;
    const alvo = noDisco(raiz, rel);
    if (await tipo(alvo) !== "ausente") {
      problemas.push(`${rel}: o lugar foi ocupado durante a atualização; o seu ficou em ${join(PASTA_MIGRACAO, manifesto.id, "estacionados")}`);
      continue;
    }
    try {
      await mkdir(dirname(alvo), { recursive: true });
      await rename(vaga, alvo);
    } catch (erro) {
      problemas.push(`${rel}: ${motivo(erro)}`);
    }
  }
  if (problemas.length) return problemas;
  return restaurar(raiz, manifesto, false);
}

// Para o doctor: o que o kit ainda rastreia da lista e as migrações que não terminaram.
export async function situacaoDaMigracao(raiz: string, git: Git = gitPadrao(raiz)): Promise<{ aMigrar: string[]; pendentes: Manifesto[] }> {
  const aMigrar = await ehClone(raiz, git) ? rastreadosNoIndice(git) : [];
  return { aMigrar, pendentes: await pendentes(raiz) };
}
