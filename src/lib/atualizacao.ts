import { createHash, randomBytes } from "node:crypto";
import { createReadStream, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { appendFile, chmod, lstat, mkdir, readFile, readdir, readlink, rename, rm, rmdir, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, win32 } from "node:path";
import type { Diagnostico } from "../comandos/doctor";
import type { Alvo } from "../comandos/instalar";
import { versaoDoKit } from "../comandos/versao";
import { consultarConfianca, filtrarAssinantes, type BuscarConfianca } from "./confianca";
import { devolverTudo, lerManifestos, migrarRastreio, situacaoDaMigracao } from "./migracao";
import { LISTA_DO_RASTREIO } from "./modelos";
import { caminhoWiki } from "./wiki-repo";

// PLANO §4 (U2). Este módulo é o código da versão que ESTÁ instalada quando a atualização começa: ele guarda, decide e
// desfaz. Tudo o que depende da versão ativa no disco (instalar, doctor, hook) roda em subprocesso `bun src/cli.ts`,
// para que a versão nova gere os próprios hooks e a reversão use os da versão antiga.

export type SemVer = { major: bigint; minor: bigint; patch: bigint; prerelease: (string | bigint)[] };
export type Canal = "estavel" | "teste";
export type ModoAtualizacao = "automatico" | "perguntar" | "nunca";
export type Release = { tag_name: string; draft: boolean; prerelease: boolean; html_url?: string };
export type DecisaoAtualizacao = "aplicar" | "perguntar" | "ignorar";
export type Exec = (args: string[], cwd: string) => { codigo: number; saida: string };
export type DependenciasAtualizacao = {
  raiz?: string;
  executar?: Exec;
  releases?: (canal: Canal) => Promise<Release[]>;
  diagnosticar?: (raiz: string) => Promise<Diagnostico>;
  provarHook?: (raiz: string) => Promise<boolean>;
  instalar?: (raiz: string, alvos: Alvo[]) => Promise<number>;
  instalarDependencias?: (raiz: string) => Promise<number>;
  // Versão do Bun que os hooks usam (padrão: `bun --version` do PATH).
  versaoBun?: () => Promise<string | undefined>;
  // Atualiza o Bun instalado pelo Anvilore para pelo menos `minima` (D9). Sem ele, a tag que pede Bun mais novo é recusada.
  atualizarBun?: (raiz: string, minima: string) => Promise<number>;
  // Arquivo de chaves confiáveis entregue pelo instalador (`--assinantes-do-instalador`). Só vale ao aplicar; veja verificarAssinaturaTag.
  assinantesDoInstalador?: string;
  // Busca da lista de chaves do site (confianca.json). Padrão: `fetch`. Só os testes trocam; a URL é constante (confianca.ts).
  buscarConfianca?: BuscarConfianca;
};

type EstadoAtualizador = "ocioso" | "baixada" | "aplicando" | "revertendo" | "recusada" | "reversao-incompleta" | "migracao-incompleta";
type Ponto = { versao: string; commit: string };
// A operação em curso. `volta` é para onde a reversão leva; `id` é a cópia de (a) e das medições desta operação;
// `copiaConfig` é a cópia cuja configuração (b) volta. Num `aplicar`, as duas são a mesma; num `voltar`, a (b) é a da
// última atualização bem-sucedida e a (a) é nova, para não devolver uma edição antiga da pessoa por cima da atual.
type Operacao = {
  tipo: "aplicar" | "voltar"; id: string; copiaConfig: string; origem: Ponto; alvo: Ponto & { tag?: string }; volta: Ponto;
  lockMudou: boolean; bunMinimo?: string; migracoes?: string[]; manifestoMigracaoId?: string;
};
type Ultima = { id: string; de: Ponto; para: Ponto; migracoes?: string[] };
type Estado = {
  versao: 1; modo: ModoAtualizacao; canal: Canal; estado: EstadoAtualizador;
  versaoInstalada?: string; disponivel?: string; tagDisponivel?: string; etapa?: string; erro?: string; alerta?: string;
  recusadas?: string[]; alvos?: Alvo[]; autoCommit?: boolean; githubBackup?: boolean; bunGerenciado?: boolean;
  operacao?: Operacao; ultima?: Ultima; atualizadoEm?: string; verificadoEm?: string;
};
// `alvoPasta`: o link aponta para pasta. No Windows o tipo do link recriado sai de `tipoDeLink` (plataformas.md).
type Entrada = { path: string; tipo: "arquivo" | "link" | "dir" | "ausente"; sha256?: string; link?: string; modo?: number; alvoPasta?: boolean };
type Dados = { arquivos: Record<string, string>; pastas: { raw: boolean; wiki: boolean } };
type Copia = {
  versao: 2; id: string; criadaEm: string; pessoais: Entrada[]; config: { raiz: string; entradas: Entrada[] }[];
  doctor: Diagnostico; hook: { codigo: number; saida: string }; dados: Dados;
};
type Saida = { codigo: number; saida: string; stdout: string };

export function parsearSemVer(texto: string): SemVer | undefined {
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(texto);
  if (!m) return undefined;
  const prerelease = m[4] ? m[4].split(".").map(item => {
    if (/^\d+$/.test(item)) return item.length > 1 && item.startsWith("0") ? undefined : BigInt(item);
    return item;
  }) : [];
  if (prerelease.some(item => item === undefined)) return undefined;
  return { major: BigInt(m[1]!), minor: BigInt(m[2]!), patch: BigInt(m[3]!), prerelease: prerelease as (string | bigint)[] };
}

export function compararSemVer(a: string, b: string): number {
  const x = parsearSemVer(a), y = parsearSemVer(b);
  if (!x || !y) throw new Error("versão SemVer inválida");
  for (const k of ["major", "minor", "patch"] as const) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  if (!x.prerelease.length || !y.prerelease.length) return x.prerelease.length === y.prerelease.length ? 0 : x.prerelease.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.prerelease.length, y.prerelease.length); i++) {
    const l = x.prerelease[i], r = y.prerelease[i];
    if (l === undefined || r === undefined) return l === r ? 0 : l === undefined ? -1 : 1;
    if (l === r) continue;
    if (typeof l === "bigint" && typeof r === "bigint") return l < r ? -1 : 1;
    if (typeof l === "bigint") return -1;
    if (typeof r === "bigint") return 1;
    return l < r ? -1 : 1;
  }
  return 0;
}

export function decidirPolitica(atual: string, candidata: string, modo: ModoAtualizacao, canal: Canal = "estavel"): DecisaoAtualizacao {
  if (!parsearSemVer(atual) || !parsearSemVer(candidata)) return "ignorar";
  if (modo === "nunca" || compararSemVer(candidata, atual) <= 0) return "ignorar";
  if (parsearSemVer(candidata)!.prerelease.length && canal !== "teste") return "ignorar";
  if (modo === "perguntar") return "perguntar";
  const a = parsearSemVer(atual)!, c = parsearSemVer(candidata)!;
  return c.major === a.major && c.minor === a.minor ? "aplicar" : "perguntar";
}

export function selecionarRelease(atual: string, releases: Release[], canal: Canal): { tag: string; versao: string; url?: string } | undefined {
  const candidatas = releases.flatMap(release => {
    const versao = release.tag_name.startsWith("v") ? release.tag_name.slice(1) : release.tag_name;
    const semver = parsearSemVer(versao);
    if (!semver || release.draft || (canal === "estavel" && (release.prerelease || semver.prerelease.length > 0)) || (canal === "teste" && !release.prerelease && semver.prerelease.length > 0)) return [];
    if (compararSemVer(versao, atual) <= 0) return [];
    return [{ tag: release.tag_name.startsWith("v") ? release.tag_name : `v${release.tag_name}`, versao, url: release.html_url, prerelease: release.prerelease || semver.prerelease.length > 0 }];
  });
  candidatas.sort((a, b) => compararSemVer(b.versao, a.versao));
  const escolhida = candidatas[0];
  return escolhida ? { tag: escolhida.tag, versao: escolhida.versao, url: escolhida.url } : undefined;
}

// Cópia (b): tudo o que `instalar` escreve (src/comandos/instalar.ts: configuracaoDoHook, instalarSkills,
// instalarAgentesDaIngestao, hooks do Copilot e anvilore.toml com --auto-commit/--github-backup).
export const CONFIGURACAO_DOS_AGENTES = [
  ".claude/settings.json", ".claude/skills", ".claude/agents", ".codex/config.toml", ".agents/skills", ".gemini",
  ".github/hooks/anvilore.json", ".github/agents", ".github/copilot/settings.json", "anvilore.toml",
] as const;
const CAMINHO_MIGRACOES = "atualizacao/migracoes.json";
const REF_ANTERIOR = "refs/anvilore/anterior";
const REF_OPERACAO = "refs/anvilore/operacao";
const ID = /^\d+-[a-f0-9]{10}$/;
const COMMIT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const hash = (dados: Uint8Array | string) => createHash("sha256").update(dados).digest("hex");
const arquivoEstado = (raiz: string) => join(raiz, ".anvilore/atualizacao.json");
const pastaCopia = (raiz: string, id: string) => join(raiz, ".anvilore/atualizacao", id);
const noDisco = (base: string, rel: string) => join(base, ...rel.split("/"));
const codigoFs = (e: unknown) => (e as NodeJS.ErrnoException).code;
const ausente = (e: unknown) => codigoFs(e) === "ENOENT" || codigoFs(e) === "ENOTDIR";
const motivo = (e: unknown) => e instanceof Error ? e.message : String(e);

import { execPadrao, guardaDeRede } from "./git-rede";
export { execPadrao, guardaDeRede };
function erro(assunto: string, detalhe: string) { return new Error(`${assunto}: ${detalhe}`); }

async function log(raiz: string, linha: string) {
  const caminho = join(raiz, ".anvilore/atualizacao.log");
  await mkdir(dirname(caminho), { recursive: true });
  await appendFile(caminho, `${new Date().toISOString()} ${linha.replace(/\s*\n\s*/g, " ")}\n`, { mode: 0o600 });
}
async function gravarEstado(raiz: string, estado: Estado) {
  const destino = arquivoEstado(raiz), tmp = `${destino}.${process.pid}.tmp`;
  await mkdir(dirname(destino), { recursive: true });
  await writeFile(tmp, `${JSON.stringify(estado, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, destino);
  await log(raiz, `${estado.estado}${estado.etapa ? ` etapa=${estado.etapa}` : ""}${estado.erro ? ` erro=${estado.erro}` : ""}`);
}

function pontoValido(p: unknown): p is Ponto {
  const x = p as Ponto;
  return typeof x === "object" && x !== null && typeof x.versao === "string" && parsearSemVer(x.versao) !== undefined && typeof x.commit === "string" && COMMIT.test(x.commit);
}
function migracoesValidas(m: unknown) { return m === undefined || (Array.isArray(m) && m.every(caminhoSeguro)); }
function defeitoDoEstado(s: any): string | undefined {
  if (s?.versao !== 1 || !["automatico", "perguntar", "nunca"].includes(s.modo) || !["estavel", "teste"].includes(s.canal)) return "forma ou política desconhecida em atualizacao.json";
  if (s.estado !== undefined && !["ocioso", "baixada", "aplicando", "revertendo", "recusada", "reversao-incompleta", "migracao-incompleta"].includes(s.estado)) return `estado desconhecido: ${String(s.estado)}`;
  const op = s.operacao;
  if (op !== undefined && (!["aplicar", "voltar"].includes(op?.tipo) || !ID.test(String(op.id)) || !ID.test(String(op.copiaConfig)) || !pontoValido(op.origem) || !pontoValido(op.alvo) || !pontoValido(op.volta) || typeof op.lockMudou !== "boolean" || !migracoesValidas(op.migracoes))) return "operação em curso com forma inválida";
  const u = s.ultima;
  if (u !== undefined && (!ID.test(String(u?.id)) || !pontoValido(u.de) || !pontoValido(u.para) || !migracoesValidas(u.migracoes))) return "última atualização com forma inválida";
  return undefined;
}
async function lerEstado(raiz: string): Promise<Estado> {
  let texto: string;
  try { texto = await readFile(arquivoEstado(raiz), "utf8"); }
  catch (e) {
    if (codigoFs(e) === "ENOENT") throw erro("instalação não gerenciada", ".anvilore/atualizacao.json ausente");
    throw erro("estado ilegível", `.anvilore/atualizacao.json: ${motivo(e)}`);
  }
  let estado: any;
  try { estado = JSON.parse(texto); } catch { throw erro("estado inválido", "atualizacao.json não é JSON válido"); }
  const defeito = defeitoDoEstado(estado);
  if (defeito) throw erro("estado inválido", `${defeito}; nada foi mudado`);
  // Campos da primeira versão do atualizador (antes de separar operação e última atualização) não são usados.
  for (const antigo of ["anterior", "id", "idAnterior", "de", "para", "bunLockMudou", "migracoes", "manifestoMigracaoId"]) delete estado[antigo];
  return { ...estado, estado: estado.estado ?? "ocioso" } as Estado;
}

// Trava: arquivo com o pid. Outro processo vivo (ou de outra conta, EPERM) = em andamento. Pid morto = abandonada.
// Conteúdo ilegível só é tratado como abandonado depois de 2 minutos (pode ser outro processo no meio da escrita).
const travasDoProcesso = new Set<string>();
async function criarTrava(lock: string) {
  try { await writeFile(lock, `${process.pid}\n`, { flag: "wx", mode: 0o600 }); return true; }
  catch (e) { if (codigoFs(e) === "EEXIST") return false; throw e; }
}
async function donaDaTrava(lock: string): Promise<{ pid?: number; viva: boolean }> {
  let texto: string, idade: number;
  try { texto = await readFile(lock, "utf8"); idade = Date.now() - (await stat(lock)).mtimeMs; }
  catch (e) { if (codigoFs(e) === "ENOENT") return { viva: false }; throw e; }
  const pid = Number(texto.trim());
  if (!Number.isInteger(pid) || pid <= 0) return { viva: idade < 120_000 };
  if (pid === process.pid) return { pid, viva: false };
  try { process.kill(pid, 0); return { pid, viva: true }; } catch (e) { return { pid, viva: codigoFs(e) === "EPERM" }; }
}
async function comTrava<T>(raiz: string, acao: () => Promise<T>): Promise<T> {
  const lock = join(raiz, ".anvilore/atualizar.lock");
  await mkdir(dirname(lock), { recursive: true });
  if (travasDoProcesso.has(lock)) throw erro("atualização já em andamento", "trava .anvilore/atualizar.lock");
  if (!(await criarTrava(lock))) {
    const dona = await donaDaTrava(lock);
    if (dona.viva) throw erro("atualização já em andamento", `trava .anvilore/atualizar.lock${dona.pid ? ` (processo ${dona.pid})` : ""}`);
    await rm(lock, { force: true });
    await log(raiz, `trava abandonada removida${dona.pid ? ` (processo ${dona.pid})` : ""}`);
    if (!(await criarTrava(lock))) throw erro("atualização já em andamento", "trava .anvilore/atualizar.lock");
  }
  travasDoProcesso.add(lock);
  try { return await acao(); } finally { travasDoProcesso.delete(lock); await rm(lock, { force: true }); }
}

function caminhoSeguro(rel: unknown): rel is string {
  return typeof rel === "string" && rel.length > 0 && !rel.includes("\0") && !rel.includes("\\") && !rel.startsWith("/")
    && !/^[A-Za-z]:/.test(rel) && rel.split("/").every(p => p !== "" && p !== "." && p !== "..");
}
const dentroDe = (rel: string, raizRel: string) => rel === raizRel || rel.startsWith(`${raizRel}/`);

// Nenhum ancestral de `rel` dentro de `base` pode ser link ou arquivo: senão, apagar ou escrever ali sairia da pasta.
async function conferirAncestrais(base: string, rel: string) {
  let atual = base;
  for (const parte of rel.split("/").slice(0, -1)) {
    atual = join(atual, parte);
    let st;
    try { st = await lstat(atual); } catch (e) { if (ausente(e)) return; throw e; }
    if (st.isSymbolicLink() || !st.isDirectory()) throw erro("caminho inseguro", `${rel} passa por ${atual}, que é link ou não é pasta`);
  }
}

async function medirArvore(base: string, rel: string, saida: Entrada[], topo = true): Promise<void> {
  const abs = noDisco(base, rel);
  let st;
  try { st = await lstat(abs); } catch (e) { if (topo && ausente(e)) return; throw e; }
  if (st.isSymbolicLink()) {
    const alvo = await readlink(abs), alvoPasta = await stat(abs).then(x => x.isDirectory(), () => false);
    saida.push({ path: rel, tipo: "link", link: alvo, sha256: hash(alvo), ...(alvoPasta ? { alvoPasta } : {}) });
  }
  else if (st.isDirectory()) {
    saida.push({ path: rel, tipo: "dir" });
    for (const nome of (await readdir(abs)).sort()) await medirArvore(base, `${rel}/${nome}`, saida, false);
  }
  else if (st.isFile()) saida.push({ path: rel, tipo: "arquivo", sha256: hash(await readFile(abs)), modo: st.mode & 0o777 });
  else throw erro("tipo de arquivo não suportado", rel);
}
const assinatura = (e: Entrada) => `${e.path}\0${e.tipo}\0${e.sha256 ?? ""}\0${e.link ?? ""}`;
const mesmaArvore = (a: Entrada[], b: Entrada[]) => a.length === b.length && a.every((e, i) => assinatura(e) === assinatura(b[i]!));

async function hashEmFluxo(abs: string) {
  const h = createHash("sha256");
  for await (const parte of createReadStream(abs)) h.update(parte as Buffer);
  return h.digest("hex");
}
// Medição de raw/ e wiki/ (caminhoWiki respeita ANVILORE_WIKI). A raiz de cada uma é seguida se for link; dentro, não.
// `wiki/.git` fica de fora: é o repositório próprio da wiki, que a migração pode criar e o autocommit altera.
async function percorrerDados(abs: string, rel: string, saida: Record<string, string>, ehWiki: boolean, topo: boolean): Promise<boolean> {
  let st;
  try { st = topo ? await stat(abs) : await lstat(abs); } catch (e) { if (topo && ausente(e)) return false; throw e; }
  if (st.isDirectory()) {
    for (const nome of (await readdir(abs)).sort()) {
      if (topo && ehWiki && nome === ".git") continue;
      await percorrerDados(join(abs, nome), `${rel}/${nome}`, saida, ehWiki, false);
    }
  }
  else if (st.isSymbolicLink()) saida[rel] = `link:${hash(await readlink(abs))}`;
  else if (st.isFile()) saida[rel] = `arquivo:${await hashEmFluxo(abs)}`;
  else saida[rel] = `outro:${st.mode}`;
  return true;
}
async function medirDados(raiz: string): Promise<Dados> {
  const arquivos: Record<string, string> = {};
  const raw = await percorrerDados(join(raiz, "raw"), "raw", arquivos, false, true);
  const wiki = await percorrerDados(caminhoWiki(raiz), "wiki", arquivos, true, true);
  return { arquivos, pastas: { raw, wiki } };
}
// Política: todo arquivo que existia continua presente e com o mesmo SHA-256. Só se aceita arquivo NOVO que seja peça
// do esqueleto que `instalar` cria quando falta (LISTA_DO_RASTREIO; o exemplo só se a pasta não existia antes).
function adicaoPermitida(rel: string, antes: Dados) {
  return LISTA_DO_RASTREIO.some(peca => {
    if (!/^(raw|wiki)\//.test(peca)) return false;
    if (peca.endsWith("/exemplo")) return rel.startsWith(`${peca}/`) && !antes.pastas[peca.startsWith("raw/") ? "raw" : "wiki"];
    return rel === peca;
  });
}
function diferencasDados(antes: Dados, depois: Dados): string[] {
  const problemas: string[] = [];
  for (const [rel, valor] of Object.entries(antes.arquivos)) {
    if (!(rel in depois.arquivos)) problemas.push(`${rel} sumiu`);
    else if (depois.arquivos[rel] !== valor) problemas.push(`${rel} mudou`);
  }
  for (const rel of Object.keys(depois.arquivos)) if (!(rel in antes.arquivos) && !adicaoPermitida(rel, antes)) problemas.push(`${rel} apareceu`);
  return problemas;
}
const resumir = (lista: string[]) => lista.length > 8 ? `${lista.slice(0, 8).join(", ")} e mais ${lista.length - 8}` : lista.join(", ");

// No Windows, junção só guarda caminho absoluto: no Bun do CI (windows-latest, PR #28) o alvo relativo de uma junção
// foi resolvido contra a pasta do PROCESSO, não a do link. Por isso só alvo absoluto (o que o `instalar` cria) volta como junção; link de pasta relativo volta como
// link simbólico de pasta, com o mesmo texto de alvo. Fora do Windows o tipo não importa.
export function tipoDeLink(alvo: string, alvoPasta: boolean, plataforma: NodeJS.Platform = process.platform): "junction" | "dir" | "file" | undefined {
  if (plataforma !== "win32") return undefined;
  if (!alvoPasta) return "file";
  return win32.isAbsolute(alvo) ? "junction" : "dir";
}
const criarLink = (e: Entrada, alvo: string, destino: string) => symlink(alvo, destino, tipoDeLink(alvo, e.alvoPasta === true));
async function escreverAtomico(destino: string, dados: Uint8Array, modo?: number) {
  const tmp = `${destino}.anvilore-${process.pid}.tmp`;
  await writeFile(tmp, dados, { mode: modo ?? 0o644 });
  if (modo !== undefined) await chmod(tmp, modo);
  await rename(tmp, destino);
}

// Guarda cada entrada na cópia com os mesmos bytes que foram medidos (se mudou entre medir e copiar, falha).
async function copiarEntradas(raiz: string, destinoBase: string, entradas: Entrada[]) {
  for (const e of entradas) {
    const alvo = noDisco(destinoBase, e.path);
    // Link não vira arquivo na cópia: o alvo dele, com SHA-256, já está no manifesto. Recriá-lo aqui mudaria o
    // alvo no Windows (junção relativa) e a cópia não conferiria.
    if (e.tipo === "ausente" || e.tipo === "link") continue;
    if (e.tipo === "dir") { await mkdir(alvo, { recursive: true }); continue; }
    await mkdir(dirname(alvo), { recursive: true });
    const dados = await readFile(noDisco(raiz, e.path));
    if (hash(dados) !== e.sha256) throw erro("cópia de segurança", `${e.path} mudou durante a cópia`);
    await writeFile(alvo, dados, { mode: 0o600 });
  }
}
function semRepetir(entradas: Entrada[]) {
  const vistos = new Set<string>();
  return entradas.filter(e => !vistos.has(e.path) && (vistos.add(e.path), true));
}
async function guardarCopia(raiz: string, id: string, pessoais: string[], doctor: Diagnostico, hook: { codigo: number; saida: string }): Promise<Copia> {
  const entradasPessoais: Entrada[] = [];
  for (const rel of [...new Set(pessoais)].sort()) {
    await conferirAncestrais(raiz, rel);
    const antes = entradasPessoais.length;
    await medirArvore(raiz, rel, entradasPessoais);
    if (entradasPessoais.length === antes) entradasPessoais.push({ path: rel, tipo: "ausente" });
  }
  const config: Copia["config"] = [];
  for (const rel of CONFIGURACAO_DOS_AGENTES) {
    await conferirAncestrais(raiz, rel);
    const entradas: Entrada[] = [];
    await medirArvore(raiz, rel, entradas);
    config.push({ raiz: rel, entradas });
  }
  const copia: Copia = { versao: 2, id, criadaEm: new Date().toISOString(), pessoais: semRepetir(entradasPessoais), config, doctor, hook, dados: await medirDados(raiz) };
  const dir = pastaCopia(raiz, id);
  await mkdir(dir, { recursive: true });
  await copiarEntradas(raiz, join(dir, "pessoal"), copia.pessoais);
  for (const grupo of config) await copiarEntradas(raiz, join(dir, "config"), grupo.entradas);
  const manifesto = join(dir, "manifesto.json");
  await writeFile(`${manifesto}.tmp`, `${JSON.stringify(copia, null, 2)}\n`, { mode: 0o600 });
  await rename(`${manifesto}.tmp`, manifesto);
  return copia;
}

function entradaValida(e: any): e is Entrada {
  if (!caminhoSeguro(e?.path) || !["arquivo", "link", "dir", "ausente"].includes(e.tipo)) return false;
  if (e.tipo === "arquivo") return typeof e.sha256 === "string" && /^[0-9a-f]{64}$/.test(e.sha256) && (e.modo === undefined || (Number.isInteger(e.modo) && e.modo >= 0 && e.modo <= 0o777));
  if (e.tipo === "link") return typeof e.link === "string" && e.sha256 === hash(e.link);
  return true;
}
async function lerCopia(raiz: string, id: string): Promise<Copia> {
  if (!ID.test(id)) throw erro("cópia inválida", `id ${id}`);
  let copia: any;
  try { copia = JSON.parse(await readFile(join(pastaCopia(raiz, id), "manifesto.json"), "utf8")); }
  catch (e) { throw erro("cópia de segurança ilegível", `.anvilore/atualizacao/${id}/manifesto.json: ${motivo(e)}`); }
  const configOk = Array.isArray(copia?.config) && copia.config.every((g: any) => (CONFIGURACAO_DOS_AGENTES as readonly string[]).includes(g?.raiz)
    && Array.isArray(g.entradas) && g.entradas.every((e: any) => entradaValida(e) && e.tipo !== "ausente" && dentroDe(e.path, g.raiz)));
  if (copia?.versao !== 2 || copia.id !== id || !Array.isArray(copia.pessoais) || !copia.pessoais.every(entradaValida) || !configOk
    || typeof copia.dados?.arquivos !== "object" || typeof copia.doctor !== "object") throw erro("cópia inválida", `.anvilore/atualizacao/${id}/manifesto.json não tem a forma esperada; nada foi restaurado`);
  return copia as Copia;
}

// Confere a fonte (na cópia) antes de mexer no destino: nada é apagado se a cópia não bate com o SHA-256 guardado.
async function conferirFonte(base: string, e: Entrada): Promise<Uint8Array | string | undefined> {
  if (e.tipo === "dir" || e.tipo === "ausente") return undefined;
  if (e.tipo === "link") {
    if (typeof e.link !== "string" || hash(e.link) !== e.sha256) throw erro("cópia não confere", e.path);
    return e.link;
  }
  await conferirAncestrais(base, e.path);
  const abs = noDisco(base, e.path), st = await lstat(abs);
  if (!st.isFile()) throw erro("cópia não confere", `${e.path} deveria ser arquivo`);
  const dados = await readFile(abs);
  if (hash(dados) !== e.sha256) throw erro("cópia não confere", e.path);
  return dados;
}
async function escreverEntrada(raiz: string, e: Entrada, conteudo: Uint8Array | string | undefined) {
  await conferirAncestrais(raiz, e.path);
  const abs = noDisco(raiz, e.path);
  let atual;
  try { atual = await lstat(abs); } catch (err) { if (!ausente(err)) throw err; }
  if (e.tipo === "dir") {
    if (atual && !atual.isDirectory()) throw erro("restaurar", `${e.path} existe e não é pasta; mantido`);
    await mkdir(abs, { recursive: true }); return;
  }
  if (atual?.isDirectory()) throw erro("restaurar", `${e.path} virou pasta; mantida`);
  await mkdir(dirname(abs), { recursive: true });
  if (e.tipo === "link") {
    if (atual?.isSymbolicLink() && await readlink(abs) === conteudo) return;
    if (atual) await rm(abs, { force: true });
    await criarLink(e, conteudo as string, abs); return;
  }
  if (atual?.isFile() && hash(await readFile(abs)) === e.sha256) { if (e.modo !== undefined) await chmod(abs, e.modo); return; }
  if (atual?.isSymbolicLink()) await rm(abs, { force: true });
  await escreverAtomico(abs, conteudo as Uint8Array, e.modo);
}

// Arquivo que a pessoa apagou e o checkout recriou: sai de novo, mas só o que é exatamente o blob do commit atual.
async function removerSeForDoKit(raiz: string, rel: string, exec: Exec, avisos: string[]) {
  const medidas: Entrada[] = [];
  await conferirAncestrais(raiz, rel);
  await medirArvore(raiz, rel, medidas);
  for (const e of medidas.filter(m => m.tipo !== "dir")) {
    const blob = exec(["rev-parse", "--verify", "-q", `HEAD:${e.path}`], raiz).saida.trim();
    const local = exec(["hash-object", "--", e.path], raiz);
    if (e.tipo === "arquivo" && COMMIT.test(blob) && local.codigo === 0 && local.saida.trim() === blob) await rm(noDisco(raiz, e.path));
    else avisos.push(`${e.path}: a pessoa tinha apagado, mas há outro conteúdo no lugar; mantido`);
  }
  for (const e of medidas.filter(m => m.tipo === "dir").reverse()) {
    try { await rmdir(noDisco(raiz, e.path)); } catch (err) { if (codigoFs(err) !== "ENOTEMPTY" && codigoFs(err) !== "EEXIST" && !ausente(err)) throw err; }
  }
}

async function restaurarPessoais(raiz: string, copia: Copia, exec: Exec): Promise<{ problemas: string[]; avisos: string[] }> {
  const base = join(pastaCopia(raiz, copia.id), "pessoal"), problemas: string[] = [], avisos: string[] = [], fontes = new Map<string, Uint8Array | string | undefined>();
  for (const e of copia.pessoais) {
    try { fontes.set(e.path, await conferirFonte(base, e)); } catch (err) { problemas.push(motivo(err)); }
  }
  if (problemas.length) return { problemas, avisos };
  for (const e of copia.pessoais) {
    try {
      if (e.tipo === "ausente") await removerSeForDoKit(raiz, e.path, exec, avisos);
      else await escreverEntrada(raiz, e, fontes.get(e.path));
    } catch (err) { problemas.push(`${e.path}: ${motivo(err)}`); }
  }
  problemas.push(...await conferirPessoais(raiz, copia));
  return { problemas, avisos };
}
async function conferirPessoais(raiz: string, copia: Copia): Promise<string[]> {
  const problemas: string[] = [];
  for (const e of copia.pessoais.filter(x => x.tipo === "arquivo" || x.tipo === "link")) {
    const medida: Entrada[] = [];
    try { await medirArvore(raiz, e.path, medida); } catch (err) { problemas.push(`${e.path}: ${motivo(err)}`); continue; }
    if (medida.length !== 1 || assinatura(medida[0]!) !== assinatura(e)) problemas.push(`${e.path}: SHA-256 diferente do guardado`);
  }
  return problemas;
}
async function restaurarConfig(raiz: string, copia: Copia): Promise<string[]> {
  const base = join(pastaCopia(raiz, copia.id), "config"), problemas: string[] = [], fontes = new Map<string, Uint8Array | string | undefined>();
  for (const grupo of copia.config) for (const e of grupo.entradas) {
    try { fontes.set(e.path, await conferirFonte(base, e)); } catch (err) { problemas.push(motivo(err)); }
  }
  if (problemas.length) return problemas.map(p => `${p}; configuração atual mantida`);
  for (const grupo of copia.config) {
    try {
      await conferirAncestrais(raiz, grupo.raiz);
      await rm(noDisco(raiz, grupo.raiz), { recursive: true, force: true });
      for (const e of grupo.entradas) await escreverEntrada(raiz, e, fontes.get(e.path));
    } catch (err) { problemas.push(`${grupo.raiz}: ${motivo(err)}`); }
  }
  return problemas.length ? problemas : await conferirConfig(raiz, copia);
}
async function conferirConfig(raiz: string, copia: Copia): Promise<string[]> {
  const problemas: string[] = [];
  for (const grupo of copia.config) {
    const medida: Entrada[] = [];
    try { await medirArvore(raiz, grupo.raiz, medida); } catch (err) { problemas.push(`${grupo.raiz}: ${motivo(err)}`); continue; }
    if (!mesmaArvore(medida, grupo.entradas)) problemas.push(`${grupo.raiz}: a árvore não confere com a cópia (b)`);
  }
  return problemas;
}

async function cli(raiz: string, args: string[], entrada?: string): Promise<Saida> {
  const p = Bun.spawn([process.execPath, join(raiz, "src/cli.ts"), ...args], { cwd: raiz, env: process.env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  if (entrada !== undefined) p.stdin.write(entrada);
  p.stdin.end();
  const [stdout, stderr, codigo] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { codigo, stdout, saida: `${stdout}${stderr}`.trim() };
}
async function provaDoHook(raiz: string, deps: DependenciasAtualizacao) {
  if (deps.provarHook) return { codigo: (await deps.provarHook(raiz)) ? 2 : 1, saida: "prova injetada" };
  const r = await cli(raiz, ["hook", "proteger-raw"], JSON.stringify({ tool_name: "Write", tool_input: { file_path: "raw/.anvilore-prova-nao-criada" } }));
  return { codigo: r.codigo, saida: r.saida };
}
async function diagnosticoAtivo(raiz: string, deps: DependenciasAtualizacao): Promise<Diagnostico> {
  if (deps.diagnosticar) return deps.diagnosticar(raiz);
  const r = await cli(raiz, ["doctor", "--json", raiz]);
  let d: Diagnostico;
  try { d = JSON.parse(r.stdout) as Diagnostico; } catch { throw erro("doctor", `não consegui ler o diagnóstico da versão ativa (código ${r.codigo})`); }
  if (!Array.isArray(d?.travas) || !Array.isArray(d.prerequisitos)) throw erro("doctor", `diagnóstico da versão ativa sem a forma esperada (código ${r.codigo})`);
  return d;
}
function naoPiorou(antes: Diagnostico, depois: Diagnostico) {
  const faltas = (d: Diagnostico) => new Set(d.travas.filter(t => !t.ligada && !t.opcional).map(t => t.nome));
  const ausentes = (d: Diagnostico) => new Set(d.prerequisitos.filter(p => !p.presente).map(p => p.nome));
  const [ta, tb, pa, pb] = [faltas(antes), faltas(depois), ausentes(antes), ausentes(depois)];
  return [...tb].every(t => ta.has(t)) && [...pb].every(p => pa.has(p));
}
async function instalarAtivo(raiz: string, estado: Estado, deps: DependenciasAtualizacao): Promise<{ codigo: number; saida: string }> {
  const alvos = estado.alvos ?? [];
  if (deps.instalar) return { codigo: await deps.instalar(raiz, alvos), saida: "instalar injetado" };
  if (!alvos.length) return { codigo: 0, saida: "nenhum agente gravado no estado; instalar não executado" };
  return cli(raiz, ["instalar", "--alvo", alvos.join(","), "--destino", raiz, ...(estado.autoCommit ? ["--auto-commit"] : []), ...(estado.githubBackup ? ["--github-backup"] : [])]);
}
async function instalarDependencias(raiz: string, deps: DependenciasAtualizacao) {
  if (deps.instalarDependencias) return { codigo: await deps.instalarDependencias(raiz), saida: "dependências injetadas" };
  const p = Bun.spawnSync([process.execPath, "install", "--frozen-lockfile"], { cwd: raiz, env: process.env, stdout: "pipe", stderr: "pipe" });
  return { codigo: p.exitCode, saida: `${p.stdout.toString()}${p.stderr.toString()}`.trim() };
}
async function versaoBunPadrao(): Promise<string | undefined> {
  const bun = Bun.which("bun");
  if (!bun) return undefined;
  const p = Bun.spawnSync([bun, "--version"], { stdout: "pipe", stderr: "pipe" });
  return p.exitCode === 0 ? p.stdout.toString().trim() : undefined;
}

async function releasesGitHub(canal: Canal): Promise<Release[]> {
  const endpoint = canal === "teste" ? "https://api.github.com/repos/iagofrota/anvilore/releases?per_page=100" : "https://api.github.com/repos/iagofrota/anvilore/releases/latest";
  const response = await fetch(endpoint, { headers: { accept: "application/vnd.github+json" } });
  if (!response.ok) throw new Error(`GitHub respondeu HTTP ${response.status}`);
  const data = await response.json();
  return Array.isArray(data) ? data as Release[] : [data as Release];
}

function commitDe(raiz: string, exec: Exec, ref: string): string {
  const r = exec(["rev-parse", "--verify", "-q", ref], raiz), commit = r.saida.trim();
  if (r.codigo !== 0 || !COMMIT.test(commit)) throw erro("git rev-parse", `não resolvi ${ref}: ${commit}`);
  return commit;
}
function guardarRef(raiz: string, exec: Exec, ref: string, commit: string) {
  const r = exec(["update-ref", ref, commit], raiz);
  if (r.codigo !== 0) throw erro("guardar versão anterior", r.saida.trim());
}
async function apagarRef(raiz: string, exec: Exec, ref: string) {
  const r = exec(["update-ref", "-d", ref], raiz);
  if (r.codigo !== 0) await log(raiz, `aviso: não apaguei ${ref}: ${r.saida.trim()}`);
}
// `git diff --quiet`: 0 igual, 1 diferente, qualquer outro código é erro (nunca "igual").
function arquivosDiferem(raiz: string, exec: Exec, de: string, para: string, caminhos: string[]): boolean {
  const r = exec(["diff", "--quiet", de, para, "--", ...caminhos], raiz);
  if (r.codigo === 0) return false;
  if (r.codigo === 1) return true;
  throw erro("git diff", `não consegui comparar ${caminhos.join(", ")} (código ${r.codigo}): ${r.saida.trim()}`);
}

// `--porcelain=v2`: nenhuma entrada começa com espaço, então a saída sobrevive a quem apara as pontas. `--no-renames`
// faz renomear aparecer como apagar + criar, e os dois lados entram na cópia (o apagado como "ausente").
function listarModificados(raiz: string, exec: Exec): string[] {
  const r = exec(["status", "--porcelain=v2", "-z", "--no-renames", "--untracked-files=all"], raiz);
  if (r.codigo) throw erro("git status", r.saida.trim());
  const caminhos: string[] = [], partes = r.saida.split("\0");
  for (let i = 0; i < partes.length; i++) {
    const linha = partes[i]!;
    if (!linha) continue;
    const campos = ({ "1": 8, "2": 9, u: 10, "?": 1 } as Record<string, number>)[linha[0]!];
    if (campos === undefined) throw erro("git status", `entrada desconhecida: ${linha.slice(0, 40)}`);
    let inicio = 0;
    for (let k = 0; k < campos; k++) inicio = linha.indexOf(" ", inicio) + 1;
    const rel = linha.slice(inicio);
    if (!caminhoSeguro(rel)) throw erro("git status", `caminho que o atualizador não sabe guardar: ${JSON.stringify(rel)}; nada foi mudado`);
    caminhos.push(rel);
    if (linha[0] === "2") { const origem = partes[++i]; if (origem && caminhoSeguro(origem)) caminhos.push(origem); }
  }
  return caminhos;
}
function lerMigracoes(raiz: string, commit: string, exec: Exec): string[] {
  const existe = exec(["ls-tree", "--name-only", commit, "--", CAMINHO_MIGRACOES], raiz);
  if (existe.codigo !== 0) throw erro("migração declarada", existe.saida.trim());
  if (!existe.saida.trim()) return [];
  const r = exec(["show", `${commit}:${CAMINHO_MIGRACOES}`], raiz);
  if (r.codigo !== 0) throw erro("migração declarada", r.saida.trim());
  let value: any; try { value = JSON.parse(r.saida); } catch { throw erro("migração declarada inválida", `${CAMINHO_MIGRACOES} não é JSON válido`); }
  if (!Array.isArray(value?.deixa_de_rastrear) || !value.deixa_de_rastrear.every(caminhoSeguro)) throw erro("migração declarada inválida", "deixa_de_rastrear precisa ser uma lista de caminhos relativos seguros");
  return value.deixa_de_rastrear;
}
// Um checkout para a candidata apaga do disco o que o commit atual rastreia e ela não. Se isso inclui dado da pessoa
// (raw/, wiki/, SCHEMA.md, anvilore.toml, a lista do rastreio) sem que a candidata declare a migração, ela é recusada.
const DADO_DA_PESSOA = (rel: string) => /^(raw|wiki)\//.test(rel) || rel === "SCHEMA.md" || rel === "anvilore.toml" || LISTA_DO_RASTREIO.some(p => dentroDe(rel, p));
function dadosQueOCheckoutApagaria(raiz: string, de: string, para: string, declarados: string[], exec: Exec): string[] {
  const d = exec(["diff", "--name-only", "-z", "--no-renames", "--diff-filter=D", de, para, "--"], raiz);
  if (d.codigo !== 0) throw erro("git diff", `não consegui listar o que a versão nova deixa de rastrear: ${d.saida.trim()}`);
  const apagados = d.saida.split("\0").filter(Boolean).filter(DADO_DA_PESSOA);
  if (!apagados.length) return [];
  const cobertos = new Set<string>();
  if (declarados.length) {
    const r = exec(["ls-tree", "-r", "-z", "--name-only", de, "--", ...declarados], raiz);
    if (r.codigo !== 0) throw erro("git ls-tree", r.saida.trim());
    for (const rel of r.saida.split("\0").filter(Boolean)) cobertos.add(rel);
  }
  return apagados.filter(rel => !cobertos.has(rel));
}
async function bunExigido(raiz: string, commit: string, tag: string, exec: Exec, estado: Estado, deps: DependenciasAtualizacao): Promise<string | undefined> {
  const r = exec(["show", `${commit}:package.json`], raiz);
  if (r.codigo !== 0) throw erro("package.json da versão nova", r.saida.trim());
  let pm: unknown;
  try { pm = (JSON.parse(r.saida) as { packageManager?: unknown }).packageManager; } catch { throw erro("package.json da versão nova", "não é JSON válido"); }
  if (pm === undefined) return undefined;
  const m = typeof pm === "string" ? /^bun@([^+]+)(?:\+.*)?$/.exec(pm) : null;
  if (!m || !parsearSemVer(m[1]!)) throw erro("package.json da versão nova", `packageManager não suportado: ${String(pm)}`);
  const minima = m[1]!, atual = await (deps.versaoBun ?? versaoBunPadrao)();
  if (atual && parsearSemVer(atual) && compararSemVer(atual, minima) >= 0) return undefined;
  const pede = `a versão ${tag} pede Bun ${minima} e este computador tem ${atual ?? "versão desconhecida"}`;
  if (!estado.bunGerenciado) throw erro("Bun desatualizado", `${pede}. O Bun não foi instalado pelo Anvilore: atualize-o (bun upgrade) e peça a atualização de novo. Nada foi mudado.`);
  if (!deps.atualizarBun) throw erro("Bun desatualizado", `${pede}. O Bun foi instalado pelo Anvilore, mas este kit ainda não traz a atualização do Bun com origem e hash conferidos (fatia dos instaladores). Nada foi mudado.`);
  return minima;
}

// `objeto`: o id já resolvido de refs/tags/<tag>, para que o objeto verificado seja o mesmo lido depois.
//
// O instalador pode entregar o arquivo de chaves confiáveis da própria execução pela opção `--assinantes-do-instalador`: numa
// pasta que ficou para trás na troca de chave, o seguranca/assinantes local só conhece a chave antiga. Com ele, vale ESSE
// arquivo no lugar do local (não se somam); ausente, vazio ou ilegível recusa, nunca cai de volta no local. O ambiente
// NÃO é lido: uma atualização manual ou agendada que herdasse uma variável trocaria a âncora de confiança por acidente.
// A opção não prova quem a passou (um processo local hostil também poderia); o ganho é não herdá-la sem querer.
//
// `permitidas`: as fingerprints que o site (confianca.json) autoriza agora. O verify-tag roda com um allowed_signers
// TEMPORÁRIO só com as linhas do arquivo acima cuja fingerprint está na lista: a interseção. O site nunca acrescenta uma
// chave, e uma chave retirada dele deixa de valer mesmo que a assinatura seja válida. Interseção vazia recusa.
export const OPCAO_ASSINANTES_DO_INSTALADOR = "--assinantes-do-instalador";
export function verificarAssinaturaTag(raiz: string, tag: string, exec: Exec = execPadrao, objeto: string = tag, doInstalador?: string, permitidas?: readonly string[]): string | undefined {
  const allow = doInstalador === undefined ? join(raiz, "seguranca/assinantes") : doInstalador === "" ? "" : resolve(doInstalador);
  let tamanho: number;
  const semChaves = `o instalador não entregou as chaves confiáveis (arquivo ausente, vazio ou ilegível); a versão ${tag} foi recusada e nada mudou. Rode o instalador de novo.`;
  try { const st = statSync(allow); if (!st.isFile()) throw Object.assign(new Error("não é arquivo"), { code: "EISDIR" }); tamanho = st.size; }
  catch (e) {
    if (doInstalador !== undefined) return semChaves;
    if (codigoFs(e) === "ENOENT") return `seguranca/assinantes ausente; tag candidata recusada. Configure no kit instalado (antes da atualização) uma linha OpenSSH allowed_signers com principal igual ao e-mail de assinatura Git, opção namespaces="git" e chave pública SSH aprovada; veja docs/knowledge_base/decisoes.md.`;
    return "seguranca/assinantes ilegível; tag candidata recusada. Confira permissões e formato OpenSSH allowed_signers; veja docs/knowledge_base/decisoes.md.";
  }
  if (tamanho === 0 && doInstalador !== undefined) return semChaves;
  if (tamanho === 0) return `seguranca/assinantes vazio; tag candidata recusada. Configure no kit instalado (antes da atualização) uma linha OpenSSH allowed_signers com principal igual ao e-mail de assinatura Git, opção namespaces="git" e chave pública SSH aprovada; veja docs/knowledge_base/decisoes.md.`;
  const cat = exec(["cat-file", "tag", objeto], raiz);
  if (cat.codigo !== 0 || !cat.saida.split(/\r?\n/).includes("-----BEGIN SSH SIGNATURE-----")) {
    return `git verify-tag recusou a tag ${tag}: a tag não tem assinatura SSH. Confira o formato de seguranca/assinantes, o principal (e-mail de assinatura Git) e a chave pública ancorada no kit instalado antes da atualização.`;
  }
  let temporaria: string | undefined, arquivo = allow;
  if (permitidas !== undefined) {
    let filtradas: string;
    try { filtradas = filtrarAssinantes(readFileSync(allow, "utf8"), permitidas); } catch { filtradas = ""; }
    if (filtradas === "") return `a lista atual de chaves do site não inclui nenhuma chave em que esta pasta confia; a versão ${tag} foi recusada e nada mudou. Se a chave de assinatura foi trocada, rode o instalador de novo.`;
    temporaria = mkdtempSync(join(tmpdir(), "anvilore-assinantes-"));
    arquivo = join(temporaria, "assinantes");
    writeFileSync(arquivo, filtradas, { mode: 0o600 });
  }
  let r: { codigo: number; saida: string };
  try {
    r = exec([
      "-c", "gpg.format=ssh",
      "-c", "gpg.ssh.program=ssh-keygen",
      "-c", "gpg.program=anvilore-sem-gpg",
      "-c", "gpg.openpgp.program=anvilore-sem-gpg",
      "-c", "gpg.x509.program=anvilore-sem-gpg",
      "-c", `gpg.ssh.allowedSignersFile=${arquivo}`,
      "verify-tag", objeto,
    ], raiz);
  } finally { if (temporaria) rmSync(temporaria, { recursive: true, force: true }); }
  return r.codigo === 0 ? undefined : `git verify-tag recusou a tag ${tag}: assinatura inválida ou signatário desconhecido. Confira o formato de seguranca/assinantes, o principal (e-mail de assinatura Git) e a chave pública ancorada no kit instalado antes da atualização; a chave da candidata não é confiável. ${r.saida.trim()}`;
}
// `verify-tag` só prova que o objeto foi assinado; não que o NOME assinado é o da ref. Um espelho pode publicar
// refs/tags/v0.3.2 apontando para a tag assinada da v0.3.1. Aqui a identidade vem do conteúdo assinado: o objeto é
// uma tag anotada, `tag` é o nome pedido, `type` é commit (sem tag aninhada) e `object` é o commit que será aplicado.
export function identidadeDaTag(raiz: string, tag: string, exec: Exec = execPadrao, id: string = tag): { versao: string; commit: string } | string {
  const tipo = exec(["cat-file", "-t", id], raiz);
  if (tipo.codigo !== 0 || tipo.saida.trim() !== "tag") return `a ref ${tag} não é uma tag anotada (tipo ${tipo.saida.trim() || "desconhecido"}); recusada.`;
  const conteudo = exec(["cat-file", "tag", id], raiz);
  if (conteudo.codigo !== 0) return `não consegui ler a tag ${tag}: ${conteudo.saida.trim()}`;
  const cabecalho = new Map<string, string>();
  for (const linha of conteudo.saida.split("\n")) {
    if (linha === "") break;
    const espaco = linha.indexOf(" ");
    if (espaco > 0 && !cabecalho.has(linha.slice(0, espaco))) cabecalho.set(linha.slice(0, espaco), linha.slice(espaco + 1));
  }
  const nome = cabecalho.get("tag"), objeto = cabecalho.get("object") ?? "", alvo = cabecalho.get("type");
  if (nome !== tag) return `a tag assinada se chama ${nome ?? "(sem nome)"}, não ${tag}; a ref foi trocada e a versão anunciada não é a assinada. Recusada.`;
  if (alvo !== "commit") return `a tag ${tag} aponta para um objeto do tipo ${alvo ?? "desconhecido"}, não para um commit; recusada.`;
  if (!COMMIT.test(objeto)) return `a tag ${tag} não traz um commit válido; recusada.`;
  const resolvido = exec(["rev-parse", "--verify", "-q", `${id}^{commit}`], raiz).saida.trim();
  if (resolvido !== objeto) return `a tag ${tag} aponta para ${objeto}, mas a ref resolve para ${resolvido || "nada"}; recusada.`;
  const versao = tag.startsWith("v") ? tag.slice(1) : tag;
  if (!parsearSemVer(versao)) return `o nome assinado ${tag} não é uma versão SemVer; recusada.`;
  return { versao, commit: objeto };
}
function oficial(raiz: string, exec: Exec) {
  const rem = exec(["remote", "get-url", "origin"], raiz).saida.trim();
  const ok = ["https://github.com/iagofrota/anvilore.git", "git@github.com:iagofrota/anvilore.git", "ssh://git@github.com/iagofrota/anvilore.git"].includes(rem);
  const tag = exec(["describe", "--tags", "--exact-match", "HEAD"], raiz);
  return ok && tag.codigo === 0;
}

async function situacaoDosDados(raiz: string, copia: Copia | undefined): Promise<{ problemas: string[]; frase: string }> {
  if (!copia) return { problemas: [], frase: "Não consegui ler a cópia para conferir raw/ e wiki/." };
  try {
    const problemas = diferencasDados(copia.dados, await medirDados(raiz));
    return problemas.length
      ? { problemas, frase: `ATENÇÃO: raw/ ou wiki/ mudaram durante a atualização e o atualizador não os restaura (${resumir(problemas)}).` }
      : { problemas, frase: "Conferi raw/ e wiki/: estão como antes." };
  } catch (e) { return { problemas: [], frase: `Não consegui conferir raw/ e wiki/ (${motivo(e)}).` }; }
}

// R1–R5 (PLANO §4, "Reversão"). Uma etapa só começa quando a anterior foi conferida.
async function reverter(raiz: string, estado: Estado, exec: Exec, deps: DependenciasAtualizacao): Promise<string> {
  const op = estado.operacao!;
  estado.estado = "revertendo"; await gravarEstado(raiz, estado);
  let copia: Copia | undefined, copiaConfig: Copia | undefined;
  const carregar = async () => {
    copia ??= await lerCopia(raiz, op.id);
    copiaConfig ??= op.copiaConfig === op.id ? copia : await lerCopia(raiz, op.copiaConfig);
    return { copia, copiaConfig };
  };
  const etapas: [string, () => Promise<string | undefined>][] = [
    ["R1 checkout", async () => {
      const r = exec(["checkout", "--force", "--detach", op.volta.commit], raiz);
      if (r.codigo !== 0) return r.saida.trim() || `código ${r.codigo}`;
      const head = commitDe(raiz, exec, "HEAD");
      return head === op.volta.commit ? undefined : `HEAD ficou em ${head}`;
    }],
    ["R2 dependências", async () => {
      if (!op.lockMudou) return undefined;
      const r = await instalarDependencias(raiz, deps);
      return r.codigo === 0 ? undefined : `bun install saiu ${r.codigo}: ${r.saida}`;
    }],
    ["R3 restaurar cópia", async () => {
      const { copia, copiaConfig } = await carregar();
      const pessoais = await restaurarPessoais(raiz, copia, exec);
      for (const aviso of pessoais.avisos) await log(raiz, `aviso: ${aviso}`);
      const problemas = [...pessoais.problemas, ...await restaurarConfig(raiz, copiaConfig)];
      return problemas.length ? resumir(problemas) : undefined;
    }],
    ["R4 instalar configurações", async () => {
      const { copiaConfig } = await carregar();
      const r = await instalarAtivo(raiz, estado, deps);
      if (r.codigo !== 0) return `instalar saiu ${r.codigo}: ${r.saida}`;
      // O instalar antigo só mescla; o que ele deixou diferente da cópia (b) volta da cópia e é conferido de novo.
      if ((await conferirConfig(raiz, copiaConfig)).length === 0) return undefined;
      await log(raiz, "R4: instalar deixou a configuração diferente da cópia (b); restaurando de novo");
      const problemas = await restaurarConfig(raiz, copiaConfig);
      return problemas.length ? resumir(problemas) : undefined;
    }],
    ["R5 doctor e proteção raw", async () => {
      const { copiaConfig } = await carregar();
      const prova = await provaDoHook(raiz, deps);
      if (prova.codigo !== 2) return `o hook proteger-raw saiu ${prova.codigo} em vez de 2`;
      return naoPiorou(copiaConfig.doctor, await diagnosticoAtivo(raiz, deps)) ? undefined : "o doctor ficou pior que antes da atualização";
    }],
  ];
  for (const [nome, etapa] of etapas) {
    estado.etapa = nome; await gravarEstado(raiz, estado);
    let falha: string | undefined;
    try { falha = await etapa(); } catch (e) { falha = motivo(e); }
    if (falha !== undefined) {
      estado.estado = "reversao-incompleta"; estado.erro = `${nome}: ${falha}`; await gravarEstado(raiz, estado);
      const dados = await situacaoDosDados(raiz, copia ?? await lerCopia(raiz, op.id).catch(() => undefined));
      throw erro("reversão incompleta", `A atualização para ${op.alvo.versao} falhou e não consegui voltar por completo (etapa: ${nome}; ${falha}). ${dados.frase} Uma cópia do resto está em .anvilore/atualizacao/${op.id}/. Vou tentar de novo no próximo início.${nome.startsWith("R5") ? " A proteção de raw/ pode estar desligada." : ""}`);
    }
  }
  const dados = await situacaoDosDados(raiz, copia);
  if (dados.problemas.length) estado.alerta = dados.frase;
  return dados.frase;
}
async function concluirReversao(raiz: string, estado: Estado, exec: Exec, erroOriginal?: string) {
  const op = estado.operacao!;
  estado.estado = "ocioso"; estado.versaoInstalada = op.volta.versao;
  estado.recusadas = [...new Set([...(estado.recusadas ?? []), op.tipo === "aplicar" ? op.alvo.versao : op.origem.versao])];
  if (op.tipo === "voltar") { delete estado.ultima; await apagarRef(raiz, exec, REF_ANTERIOR); }
  if (erroOriginal) estado.erro = erroOriginal; else delete estado.erro;
  delete estado.operacao; delete estado.etapa; delete estado.disponivel; delete estado.tagDisponivel;
  await apagarRef(raiz, exec, REF_OPERACAO);
  await gravarEstado(raiz, estado);
}

// `release` já passou por verificarAssinaturaTag e identidadeDaTag: versão e commit vêm do conteúdo assinado.
async function aplicar(raiz: string, estado: Estado, release: { tag: string; versao: string; commit: string }, exec: Exec, deps: DependenciasAtualizacao): Promise<string> {
  let op: Operacao, copia: Copia;
  try {
    const origemCommit = commitDe(raiz, exec, "HEAD"), alvoCommit = release.commit;
    const origemVersao = estado.versaoInstalada ?? (await versaoDoKit(raiz)).versao;
    const migracoes = lerMigracoes(raiz, alvoCommit, exec);
    const semMigrar = dadosQueOCheckoutApagaria(raiz, origemCommit, alvoCommit, migracoes, exec);
    if (semMigrar.length) {
      estado.estado = "recusada"; estado.recusadas = [...new Set([...(estado.recusadas ?? []), release.versao])];
      throw erro("versão recusada", `a ${release.tag} deixaria de rastrear arquivos que são seus (${resumir(semMigrar)}) sem declará-los em ${CAMINHO_MIGRACOES}; o checkout os apagaria. Nada foi mudado.`);
    }
    const bunMinimo = await bunExigido(raiz, alvoCommit, release.tag, exec, estado, deps);
    const lockMudou = arquivosDiferem(raiz, exec, origemCommit, alvoCommit, ["bun.lock", "bun.lockb"]);
    const doctor = await diagnosticoAtivo(raiz, deps);
    const hook = await provaDoHook(raiz, deps);
    if (hook.codigo !== 2) throw erro("prova de raw antes da atualização", `o hook saiu ${hook.codigo} em vez de 2; nada foi mudado`);
    const id = `${Date.now()}-${randomBytes(5).toString("hex")}`;
    copia = await guardarCopia(raiz, id, [...listarModificados(raiz, exec), ...migracoes], doctor, hook);
    const origem = { versao: origemVersao, commit: origemCommit };
    op = { tipo: "aplicar", id, copiaConfig: id, origem, alvo: { versao: release.versao, commit: alvoCommit, tag: release.tag }, volta: origem, lockMudou, ...(bunMinimo ? { bunMinimo } : {}), ...(migracoes.length ? { migracoes } : {}) };
    guardarRef(raiz, exec, REF_OPERACAO, origemCommit);
  } catch (e) {
    estado.erro = motivo(e); await gravarEstado(raiz, estado);
    throw e;
  }
  estado.operacao = op; estado.estado = "aplicando"; delete estado.erro;
  if (op.migracoes) {
    estado.etapa = "migração"; await gravarEstado(raiz, estado);
    const m = await migrarRastreio(raiz, { listaDoRastreio: op.migracoes });
    if (m.codigo !== 0) { estado.estado = "migracao-incompleta"; estado.erro = m.mensagens.join(" "); await gravarEstado(raiz, estado); throw erro("migração incompleta", estado.erro); }
    if (m.manifesto) op.manifestoMigracaoId = m.manifesto.id;
  }
  const passos: [string, () => Promise<string | undefined>][] = [
    ["checkout", async () => {
      const r = exec(["checkout", "--force", "--detach", op.alvo.commit], raiz);
      if (r.codigo !== 0) return r.saida.trim() || `código ${r.codigo}`;
      const head = commitDe(raiz, exec, "HEAD");
      return head === op.alvo.commit ? undefined : `HEAD ficou em ${head}`;
    }],
    ["restaurar arquivos pessoais", async () => {
      const problemas: string[] = [];
      if (op.manifestoMigracaoId) {
        const manifesto = (await lerManifestos(raiz)).find(m => m.id === op.manifestoMigracaoId);
        if (!manifesto) return `manifesto da migração ${op.manifestoMigracaoId} ausente após o checkout`;
        problemas.push(...(await devolverTudo(raiz, manifesto)).problemas);
      }
      const pessoais = await restaurarPessoais(raiz, copia, exec);
      for (const aviso of pessoais.avisos) await log(raiz, `aviso: ${aviso}`);
      problemas.push(...pessoais.problemas);
      return problemas.length ? resumir(problemas) : undefined;
    }],
    ["bun", async () => {
      if (!op.bunMinimo) return undefined;
      const codigo = await deps.atualizarBun!(raiz, op.bunMinimo);
      if (codigo !== 0) return `atualizar o Bun saiu ${codigo}`;
      const agora = await (deps.versaoBun ?? versaoBunPadrao)();
      return agora && parsearSemVer(agora) && compararSemVer(agora, op.bunMinimo) >= 0 ? undefined : `o Bun continua em ${agora ?? "versão desconhecida"}`;
    }],
    ["dependências", async () => {
      if (!op.lockMudou) return undefined;
      const r = await instalarDependencias(raiz, deps);
      return r.codigo === 0 ? undefined : `bun install saiu ${r.codigo}: ${r.saida}`;
    }],
    ["instalar", async () => {
      const r = await instalarAtivo(raiz, estado, deps);
      return r.codigo === 0 ? undefined : `instalar saiu ${r.codigo}: ${r.saida}`;
    }],
    ["prova", async () => {
      const prova = await provaDoHook(raiz, deps);
      if (prova.codigo !== 2) return `o hook proteger-raw saiu ${prova.codigo} em vez de 2`;
      return naoPiorou(copia.doctor, await diagnosticoAtivo(raiz, deps)) ? undefined : "o doctor ficou pior que antes da atualização";
    }],
    ["conferir preservação", async () => {
      const problemas = [...diferencasDados(copia.dados, await medirDados(raiz)), ...await conferirPessoais(raiz, copia)];
      return problemas.length ? `raw/, wiki/ ou arquivos guardados mudaram: ${resumir(problemas)}` : undefined;
    }],
  ];
  let falha: string | undefined;
  for (const [nome, passo] of passos) {
    estado.etapa = nome; await gravarEstado(raiz, estado);
    try { falha = await passo(); } catch (e) { falha = motivo(e); }
    if (falha !== undefined) { falha = `${nome}: ${falha}`; break; }
  }
  if (falha !== undefined) {
    const frase = await reverter(raiz, estado, exec, deps);
    await concluirReversao(raiz, estado, exec, falha);
    throw erro("atualização falhou e foi desfeita", `a versão ${op.alvo.versao} falhou (${falha}) e voltei para ${op.volta.versao}. ${frase}`);
  }
  estado.ultima = { id: op.id, de: op.origem, para: { versao: op.alvo.versao, commit: op.alvo.commit }, ...(op.migracoes ? { migracoes: op.migracoes } : {}) };
  try { guardarRef(raiz, exec, REF_ANTERIOR, op.origem.commit); } catch (e) { await log(raiz, `aviso: ${motivo(e)}`); }
  await apagarRef(raiz, exec, REF_OPERACAO);
  estado.estado = "ocioso"; estado.versaoInstalada = op.alvo.versao; estado.atualizadoEm = new Date().toISOString();
  // O alerta de raw/wiki alterados fica visível (doctor, interface, --estado) até uma atualização terminar conferida.
  delete estado.operacao; delete estado.etapa; delete estado.erro; delete estado.alerta; delete estado.disponivel; delete estado.tagDisponivel;
  await gravarEstado(raiz, estado);
  return `Atualizado para ${op.alvo.versao}. Conferi raw/, wiki/ e os arquivos guardados: estão como antes.`;
}

async function voltar(raiz: string, estado: Estado, exec: Exec, deps: DependenciasAtualizacao): Promise<string> {
  const u = estado.ultima;
  if (!u) throw erro("sem versão anterior", "não há cópia de atualização bem-sucedida");
  const head = commitDe(raiz, exec, "HEAD");
  if (head !== u.para.commit || estado.versaoInstalada !== u.para.versao) throw erro("versão anterior indisponível", `a versão ativa não é a ${u.para.versao} da última atualização; nada foi mudado`);
  const anterior = await lerCopia(raiz, u.id);
  const id = `${Date.now()}-${randomBytes(5).toString("hex")}`;
  // (a) nova: o que a pessoa tem agora, inclusive o que a última atualização tinha guardado e migrado.
  const pessoais = [...listarModificados(raiz, exec), ...anterior.pessoais.map(e => e.path), ...(u.migracoes ?? [])];
  await guardarCopia(raiz, id, pessoais, anterior.doctor, anterior.hook);
  estado.operacao = { tipo: "voltar", id, copiaConfig: u.id, origem: u.para, alvo: u.de, volta: u.de, lockMudou: arquivosDiferem(raiz, exec, head, u.de.commit, ["bun.lock", "bun.lockb"]) };
  guardarRef(raiz, exec, REF_OPERACAO, u.de.commit);
  delete estado.erro;
  const frase = await reverter(raiz, estado, exec, deps);
  await concluirReversao(raiz, estado, exec);
  return `Voltou para ${u.de.versao}; a ${u.para.versao} fica recusada. ${frase}`;
}

async function recuperar(raiz: string, estado: Estado, exec: Exec, deps: DependenciasAtualizacao): Promise<string> {
  if (!estado.operacao) throw erro("estado recuperável incompleto", `estado ${estado.estado} sem operação gravada; cópias mantidas em .anvilore/atualizacao/`);
  const op = estado.operacao;
  const frase = await reverter(raiz, estado, exec, deps);
  await concluirReversao(raiz, estado, exec, op.tipo === "aplicar" ? `atualização para ${op.alvo.versao} interrompida e desfeita` : undefined);
  return `Recuperação concluída: voltei para ${op.volta.versao}. ${frase} Nenhuma release nova foi consultada; verifique novamente quando quiser.`;
}

export async function atualizar(acao: "verificar" | "voltar" | "estado" | "automatico" | "aplicar" = "verificar", deps: DependenciasAtualizacao = {}): Promise<string> {
  const raiz = resolve(deps.raiz ?? process.env.ANVILORE_DESTINO ?? process.cwd()), exec = deps.executar ?? execPadrao;
  if (acao === "estado") {
    let s: Estado; try { s = await lerEstado(raiz); } catch (e) { return motivo(e); }
    const git = exec(["rev-parse", "HEAD"], raiz);
    const mig = await situacaoDaMigracao(raiz, (args) => exec(args, raiz));
    return [`Estado: ${s.estado}`, `Versão: ${s.versaoInstalada ?? "desconhecida"}`, `HEAD: ${git.codigo === 0 ? git.saida.trim() : "indisponível"}`,
      ...(s.etapa ? [`Etapa: ${s.etapa}`] : []), ...(s.erro ? [`Último erro: ${s.erro}`] : []), ...(s.alerta ? [s.alerta] : []), ...(s.ultima ? [`Pode voltar para: ${s.ultima.de.versao}`] : []),
      ...(mig.pendentes.length ? [`Migração pendente: ${mig.pendentes.map(m => m.id).join(", ")}`] : [])].join("\n");
  }
  return await comTrava(raiz, async () => {
    const state = await lerEstado(raiz);
    if (state.estado === "reversao-incompleta" || state.estado === "aplicando" || state.estado === "revertendo") return await recuperar(raiz, state, exec, deps);
    if (state.estado === "migracao-incompleta") {
      const resultado = await migrarRastreio(raiz, { listaDoRastreio: state.operacao?.migracoes });
      if (resultado.codigo !== 0) throw erro("migração incompleta", resultado.mensagens.join(" "));
      state.estado = "ocioso"; delete state.erro; delete state.etapa; delete state.operacao;
      await apagarRef(raiz, exec, REF_OPERACAO);
      await gravarEstado(raiz, state);
      return "Migração recuperada. Nenhuma release nova foi consultada; verifique novamente quando quiser.";
    }
    if (!oficial(raiz, exec)) throw erro("clone não gerenciado", "exige origin oficial, HEAD numa tag e estado criado pelo instalador");
    const tagAtual = exec(["describe", "--tags", "--exact-match", "HEAD"], raiz).saida.trim();
    const versaoDaTag = tagAtual.startsWith("v") ? tagAtual.slice(1) : tagAtual;
    const versaoInstalada = state.versaoInstalada ?? (await versaoDoKit(raiz)).versao;
    if (!parsearSemVer(versaoDaTag) || compararSemVer(versaoDaTag, versaoInstalada) !== 0) {
      throw erro("clone não gerenciado", `tag ${tagAtual} não corresponde à versão instalada ${versaoInstalada}`);
    }
    state.versaoInstalada = versaoInstalada;
    if (!state.alvos?.length) {
      const dirs: [string, Alvo][] = [[".claude", "claude"], [".codex", "codex"], [".gemini", "gemini"], [".github/copilot", "copilot"]];
      state.alvos = [];
      for (const [rel, alvo] of dirs) if (await stat(join(raiz, rel)).then(s => s.isDirectory(), () => false)) state.alvos.push(alvo);
    }
    if (state.autoCommit === undefined || state.githubBackup === undefined) {
      let toml: Record<string, any> = {};
      try { toml = Bun.TOML.parse(await readFile(join(raiz, "anvilore.toml"), "utf8")) as Record<string, any>; }
      catch (e) { if (codigoFs(e) !== "ENOENT") throw erro("anvilore.toml", motivo(e)); }
      state.autoCommit ??= toml.hooks?.auto_commit === true;
      state.githubBackup ??= toml.hooks?.github_backup === true;
    }
    if (acao === "voltar") return await voltar(raiz, state, exec, deps);
    const atual = versaoInstalada;
    let releases: Release[];
    try { releases = await (deps.releases ?? releasesGitHub)(state.canal); }
    catch (e) { state.verificadoEm = new Date().toISOString(); await gravarEstado(raiz, state); throw e; }
    const release = state.estado === "baixada" && state.tagDisponivel
      ? releases.flatMap(r => (r.tag_name.startsWith("v") ? r.tag_name.slice(1) : r.tag_name) === state.disponivel ? [{ tag: r.tag_name.startsWith("v") ? r.tag_name : `v${r.tag_name}`, versao: state.disponivel!, url: r.html_url }] : [])[0]
      : selecionarRelease(atual, releases, state.canal);
    // Antes de qualquer fetch e em toda ação: só uma versão MAIS NOVA que a instalada é candidata. Uma "baixada"
    // obsoleta (versão igual ou anterior) é descartada; buscar a tag dela deixaria um espelho sobrescrever a tag
    // local da versão instalada ou da anterior, e o clone deixaria de ser reconhecido como gerenciado.
    if (!release || compararSemVer(release.versao, atual) <= 0) {
      if (state.estado === "baixada") { state.estado = "ocioso"; delete state.disponivel; delete state.tagDisponivel; }
      state.verificadoEm = new Date().toISOString(); await gravarEstado(raiz, state);
      return `Anvilore ${atual} já está atualizado.`;
    }
    if ((state.recusadas ?? []).includes(release.versao)) return `Anvilore ${release.versao} já foi recusada; aguardando outra release.`;
    const decision = decidirPolitica(atual, release.versao, state.modo, state.canal);
    if (decision === "ignorar" && acao !== "aplicar") return `Atualização ignorada pela política atual (${state.modo}, canal ${state.canal}).`;
    // Estado das chaves no site, ANTES de buscar a tag e de verificá-la, na aplicação comum e na com `--assinantes-do-instalador`
    // (e na verificação): falha da consulta ou versão abaixo da mínima param aqui, sem tocar na tag nem no HEAD.
    let confianca: Awaited<ReturnType<typeof consultarConfianca>>;
    try { confianca = await consultarConfianca(deps.buscarConfianca); }
    catch (e) { state.verificadoEm = new Date().toISOString(); await gravarEstado(raiz, state); await log(raiz, `consulta do estado das chaves falhou: ${motivo((e as Error).cause ?? e)}`); throw e; }
    if (compararSemVer(release.versao, confianca.versaoMinima) < 0) {
      const bad = `a lista atual do site exige a versão ${confianca.versaoMinima} ou mais nova e a ${release.versao} é mais antiga; foi recusada e nada mudou. Instale a versão atual pelo instalador.`;
      state.estado = "recusada"; state.erro = bad; state.verificadoEm = new Date().toISOString(); await gravarEstado(raiz, state);
      throw new Error(bad);
    }
    // `+`: se um espelho já trocou esta tag localmente, a do origin a substitui (sem isso o git recusa com "would
    // clobber existing tag" e a release legítima nunca entraria). A troca não dá confiança: tudo é verificado abaixo.
    // A ref da tag antes do fetch: qualquer recusa ou erro até a verificação terminar a devolve como estava (apaga se
    // não existia). Uma tag não confirmada que ficasse apontando para o HEAD instalado mudaria o `describe` e o clone
    // deixaria de ser reconhecido como gerenciado.
    const refTag = `refs/tags/${release.tag}`, anteriorDaRef = exec(["rev-parse", "--verify", "-q", refTag], raiz);
    const oidAnterior = anteriorDaRef.codigo === 0 && COMMIT.test(anteriorDaRef.saida.trim()) ? anteriorDaRef.saida.trim() : undefined;
    const devolverRef = async () => {
      const agora = exec(["rev-parse", "--verify", "-q", refTag], raiz);
      if (agora.codigo === 0 && agora.saida.trim() === oidAnterior) return;
      const r = oidAnterior ? exec(["update-ref", refTag, oidAnterior], raiz) : agora.codigo === 0 ? exec(["update-ref", "-d", refTag], raiz) : { codigo: 0, saida: "" };
      await log(raiz, r.codigo === 0 ? `ref ${refTag} devolvida ao estado anterior à busca` : `aviso: não devolvi ${refTag}: ${r.saida.trim()}`);
    };
    const fetch = exec(["fetch", "--no-tags", "origin", `+${refTag}:${refTag}`], raiz);
    if (fetch.codigo) { await devolverRef(); throw erro("fetch", fetch.saida.trim()); }
    const ref = exec(["rev-parse", "--verify", "-q", refTag], raiz), objeto = ref.saida.trim();
    let assinada: ReturnType<typeof identidadeDaTag>;
    try {
      assinada = ref.codigo !== 0 || !COMMIT.test(objeto) ? `a tag ${release.tag} não existe depois do fetch; recusada.`
        : verificarAssinaturaTag(raiz, release.tag, exec, objeto, acao === "aplicar" ? deps.assinantesDoInstalador : undefined, confianca.chaves) ?? identidadeDaTag(raiz, release.tag, exec, objeto);
    } catch (e) { await devolverRef(); throw e; }
    const bad = typeof assinada === "string" ? assinada
      : assinada.versao !== release.versao ? `a release anuncia ${release.versao}, mas a tag assinada é ${assinada.versao}; recusada.`
      : compararSemVer(assinada.versao, atual) <= 0 ? `a tag assinada ${release.tag} não é mais nova que a ${atual} instalada; recusada.`
      : undefined;
    // Sem `recusadas`: o objeto não foi confirmado como da release (assinatura ou identidade), então um espelho que
    // o sirva uma vez não pode bloquear para sempre a tag legítima da mesma versão. A próxima checagem tenta de novo.
    if (bad || typeof assinada === "string") { await devolverRef(); state.estado = "recusada"; state.erro = bad; state.verificadoEm = new Date().toISOString(); await gravarEstado(raiz, state); await log(raiz, `tag recusada tag=${release.tag}: ${bad}`); throw new Error(bad); }
    const confirmada = { tag: release.tag, versao: assinada.versao, commit: assinada.commit };
    if (acao === "verificar" || (acao === "automatico" && state.estado !== "baixada")) {
      state.estado = "baixada"; state.disponivel = release.versao; state.tagDisponivel = release.tag; state.verificadoEm = new Date().toISOString();
      await gravarEstado(raiz, state);
      return decision === "perguntar" ? `Há uma versão que pede confirmação: ${release.versao}. Rode o comando anvilore atualizar para aplicar.` : `Versão ${release.versao} conferida e aguardando a próxima sessão.`;
    }
    if (acao === "automatico" && decision !== "aplicar") { state.estado = "baixada"; state.disponivel = release.versao; state.tagDisponivel = release.tag; await gravarEstado(raiz, state); return `Versão ${release.versao} aguardando confirmação.`; }
    return await aplicar(raiz, state, confirmada, exec, deps);
  });
}

export async function comandoAtualizar(args: string[], deps: DependenciasAtualizacao = {}): Promise<number> {
  const uso = () => { console.error("Uso: anvilore atualizar [--verificar | --voltar | --estado]"); return 2; };
  // A opção interna (valor em seguida) sai da lista antes da conferência dos modos; só vale ao aplicar.
  const resto: string[] = [];
  let assinantes: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== OPCAO_ASSINANTES_DO_INSTALADOR) { resto.push(args[i]!); continue; }
    if (assinantes !== undefined || i + 1 >= args.length || args[i + 1]!.startsWith("--")) return uso();
    assinantes = args[++i]!;
  }
  const modos = resto.filter(a => a.startsWith("--"));
  if (resto.some(a => !["--verificar", "--voltar", "--estado"].includes(a)) || modos.length > 1 || (assinantes !== undefined && modos.length)) return uso();
  const acao = modos[0] === "--voltar" ? "voltar" : modos[0] === "--estado" ? "estado" : modos[0] === "--verificar" ? "verificar" : "aplicar";
  try { console.log(await atualizar(acao, assinantes === undefined ? deps : { ...deps, assinantesDoInstalador: assinantes })); return 0; } catch (e) { console.error(`atualizar: ${(e as Error).message}`); return 1; }
}
