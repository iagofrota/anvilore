import { createHash, randomBytes } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, readlink, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { diagnosticar, type Diagnostico } from "../comandos/doctor";
import { instalar, type Alvo } from "../comandos/instalar";
import { devolverTudo, lerManifestos, migrarRastreio, pendentes, situacaoDaMigracao, type Manifesto } from "./migracao";
import { versaoDoKit } from "../comandos/versao";

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
};

type Estado = {
  versao: 1; modo: ModoAtualizacao; canal: Canal; estado: "ocioso" | "baixada" | "aplicando" | "revertendo" | "recusada" | "reversao-incompleta" | "migracao-incompleta";
  versaoInstalada?: string; disponivel?: string; de?: string; para?: string; anterior?: string; id?: string;
  tagDisponivel?: string; bunLockMudou?: boolean; migracoes?: string[]; manifestoMigracaoId?: string; idAnterior?: string; etapa?: string; recusadas?: string[]; alvos?: Alvo[]; autoCommit?: boolean; githubBackup?: boolean; erro?: string; atualizadoEm?: string; verificadoEm?: string;
};
type Entrada = { path: string; tipo: "arquivo" | "link"; sha256: string; link?: string };
type Backup = { versao: 1; id: string; versaoAtual: string; entradas: Entrada[]; arquivos: string[]; doctor: Diagnostico; hookRaw: { codigo: number; saida: string }; rawWiki: Record<string, string> };

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

const SEGUROS = [".claude/settings.json", ".claude/skills", ".codex/config.toml", ".agents/skills", ".gemini", ".github/hooks/anvilore.json", ".github/agents"];
const CAMINHOS_MIGRACAO = "atualizacao/migracoes.json";
const getHash = (dados: Uint8Array | string) => createHash("sha256").update(dados).digest("hex");
const arquivoEstado = (raiz: string) => join(raiz, ".anvilore/atualizacao.json");
const saidaJson = (d: Diagnostico) => d;

function execPadrao(args: string[], cwd: string) {
  const p = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  return { codigo: p.exitCode, saida: `${p.stdout.toString()}${p.stderr.toString()}`.trim() };
}
function erro(assunto: string, detalhe: string) { return new Error(`${assunto}: ${detalhe}`); }
async function gravarEstado(raiz: string, estado: Estado, deps: DependenciasAtualizacao = {}) {
  const destino = arquivoEstado(raiz), tmp = `${destino}.${process.pid}.tmp`;
  await mkdir(dirname(destino), { recursive: true });
  await writeFile(tmp, `${JSON.stringify(estado, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, destino);
  await log(raiz, `${estado.estado}${estado.etapa ? ` etapa=${estado.etapa}` : ""}${estado.erro ? ` erro=${estado.erro}` : ""}`, deps);
}
async function log(raiz: string, linha: string, deps: DependenciasAtualizacao = {}) {
  const caminho = join(raiz, ".anvilore/atualizacao.log");
  await mkdir(dirname(caminho), { recursive: true });
  const existente = await readFile(caminho, "utf8").catch((e: NodeJS.ErrnoException) => e.code === "ENOENT" ? "" : Promise.reject(e));
  const temporario = `${caminho}.${process.pid}.tmp`;
  await writeFile(temporario, `${existente}${new Date().toISOString()} ${linha}\n`, { mode: 0o600 });
  await rename(temporario, caminho);
}
async function lerEstado(raiz: string): Promise<Estado> {
  let raw: string;
  try { raw = await readFile(arquivoEstado(raiz), "utf8"); } catch { throw erro("instalação não gerenciada", ".anvilore/atualizacao.json ausente ou ilegível"); }
  let state: any;
  try { state = JSON.parse(raw); } catch { throw erro("estado inválido", "atualizacao.json não é JSON válido"); }
  if (state?.versao !== 1 || !["automatico", "perguntar", "nunca"].includes(state.modo) || !["estavel", "teste"].includes(state.canal)) throw erro("estado inválido", "forma ou política desconhecida em atualizacao.json");
  return { ...state, estado: state.estado ?? "ocioso" } as Estado;
}
async function comTrava<T>(raiz: string, acao: () => Promise<T>): Promise<T> {
  const locksLocais = comTrava as typeof comTrava & { ativos?: Set<string> };
  const ativos = locksLocais.ativos ??= new Set<string>();
  const lock = join(raiz, ".anvilore/atualizar.lock");
  await mkdir(dirname(lock), { recursive: true });
  try { await writeFile(lock, `${process.pid}\n`, { flag: "wx", mode: 0o600 }); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    if (ativos.has(lock)) throw erro("atualização já em andamento", "trava .anvilore/atualizar.lock");
    const pid = Number(await readFile(lock, "utf8").catch(() => ""));
    let vivo = false; try { if (pid > 0 && pid !== process.pid) { process.kill(pid, 0); vivo = true; } } catch { /* stale lock */ }
    if (vivo) throw erro("atualização já em andamento", `trava .anvilore/atualizar.lock (processo ${pid})`);
    await rm(lock, { force: true });
    await writeFile(lock, `${process.pid}\n`, { flag: "wx", mode: 0o600 });
  }
  ativos.add(lock);
  try { return await acao(); } finally { ativos.delete(lock); await rm(lock, { force: true }); }
}
function segurarCaminho(rel: string) {
  return !rel.startsWith("/") && !rel.split(/[\\/]/).some(x => x === ".." || x === ".") && !/^[A-Za-z]:/.test(rel);
}
async function caminhar(raiz: string, rel: string, saida: Entrada[]): Promise<void> {
  const abs = join(raiz, rel);
  let st; try { st = await lstat(abs); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
  if (st.isSymbolicLink()) { const destino = await readlink(abs); saida.push({ path: rel, tipo: "link", link: destino, sha256: getHash(destino) }); return; }
  if (st.isDirectory()) { for (const nome of (await readdir(abs)).sort()) await caminhar(raiz, join(rel, nome).split(sep).join("/"), saida); return; }
  if (st.isFile()) saida.push({ path: rel, tipo: "arquivo", sha256: getHash(await readFile(abs)) });
}
async function backup(raiz: string, id: string, files: string[], doctor: Diagnostico, hookRaw: { codigo: number; saida: string }, versaoAtual: string): Promise<Backup> {
  const unique = [...new Set([...files, ...SEGUROS])].filter(segurarCaminho);
  const entradas: Entrada[] = [];
  for (const rel of unique) await caminhar(raiz, rel, entradas);
  const rawWiki: Record<string, string> = {};
  for (const dir of ["raw", "wiki"]) {
    try {
      for (const ent of await readdir(join(raiz, dir), { recursive: true, withFileTypes: true })) if (ent.isFile() || ent.isSymbolicLink()) {
        const rel = join(dir, ent.parentPath ? relative(raiz, ent.parentPath) : "", ent.name).split(sep).join("/");
        rawWiki[rel] = ent.isSymbolicLink() ? getHash(await readlink(join(raiz, rel))) : getHash(await readFile(join(raiz, rel)));
      }
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  const hashesPessoa = Object.fromEntries(Object.entries(rawWiki).sort(([a], [b]) => a.localeCompare(b)));
  const result: Backup = { versao: 1, id, versaoAtual, entradas, arquivos: unique, doctor: saidaJson(doctor), hookRaw, rawWiki: hashesPessoa };
  const dir = join(raiz, ".anvilore/atualizacao", id);
  await mkdir(dir, { recursive: true });
  for (const ent of entradas) {
    const alvo = join(dir, "arquivos", ent.path); await mkdir(dirname(alvo), { recursive: true });
    if (ent.tipo === "link") await symlink(ent.link!, alvo); else await copyFile(join(raiz, ent.path), alvo);
  }
  await writeFile(join(dir, "manifesto.json"), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  return result;
}
async function restaurarBackup(raiz: string, b: Backup): Promise<string[]> {
  if (!/^\d+-[a-f0-9]{10}$/.test(b.id) || !Array.isArray(b.entradas) || !Array.isArray(b.arquivos)) return ["manifesto de cópia inválido; configuração atual mantida"];
  const dir = join(raiz, ".anvilore/atualizacao", b.id), problemas: string[] = [];
  for (const ent of b.entradas) {
    if (!segurarCaminho(ent.path) || !b.arquivos.includes(ent.path) || !["arquivo", "link"].includes(ent.tipo)) {
      problemas.push(`${String(ent.path)}: entrada inválida no manifesto; configuração atual mantida`); continue;
    }
    try {
      const origem = join(dir, "arquivos", ent.path);
      const hash = ent.tipo === "link" ? getHash(await import("node:fs/promises").then(fs => fs.readlink(origem))) : getHash(await readFile(origem));
      if (hash !== ent.sha256) problemas.push(`${ent.path}: a cópia de segurança não confere; configuração atual mantida`);
    } catch (e) { problemas.push(`${ent.path}: cópia de segurança ausente (${(e as Error).message}); configuração atual mantida`); }
  }
  if (problemas.length) return problemas;
  // Limpa somente as raízes pertencentes às configurações que o instalador gera; raw/wiki nunca entram aqui.
  for (const rel of SEGUROS) await rm(join(raiz, rel), { recursive: true, force: true });
  for (const ent of b.entradas) {
    const origem = join(dir, "arquivos", ent.path), destino = join(raiz, ent.path);
    try {
      const hashOrigem = ent.tipo === "link" ? getHash(ent.link ?? "") : getHash(await readFile(origem));
      if (hashOrigem !== ent.sha256) { problemas.push(`${ent.path}: a cópia de segurança não confere; conteúdo atual mantido`); continue; }
      await mkdir(dirname(destino), { recursive: true });
      if (ent.tipo === "link") await symlink(ent.link!, destino); else await copyFile(origem, destino);
      const hash = ent.tipo === "link" ? getHash(await import("node:fs/promises").then(fs => fs.readlink(destino))) : getHash(await readFile(destino));
      if (hash !== ent.sha256) problemas.push(`${ent.path}: SHA-256 restaurado diverge`);
    } catch (e) { problemas.push(`${ent.path}: ${(e as Error).message}`); }
  }
  return problemas;
}
async function shaRawWiki(raiz: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const dir of ["raw", "wiki"]) try {
    for (const ent of await readdir(join(raiz, dir), { recursive: true, withFileTypes: true })) if (ent.isFile() || ent.isSymbolicLink()) {
      const rel = join(dir, ent.parentPath ? relative(raiz, ent.parentPath) : "", ent.name).split(sep).join("/");
      out[rel] = ent.isSymbolicLink() ? getHash(await readlink(join(raiz, rel))) : getHash(await readFile(join(raiz, rel)));
    }
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
async function esperarHook(raiz: string): Promise<{ codigo: number; saida: string }> {
  const p = Bun.spawn([process.execPath, "src/cli.ts", "hook", "proteger-raw"], { cwd: raiz, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  p.stdin.write(JSON.stringify({ tool_name: "Write", tool_input: { file_path: "raw/.anvilore-prova-nao-criada" } }));
  p.stdin.end();
  const [out, err, codigo] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { codigo, saida: `${out}${err}`.trim() };
}
async function releasesGitHub(canal: Canal): Promise<Release[]> {
  const endpoint = canal === "teste" ? "https://api.github.com/repos/iagofrota/anvilore/releases?per_page=100" : "https://api.github.com/repos/iagofrota/anvilore/releases/latest";
  const response = await fetch(endpoint, { headers: { accept: "application/vnd.github+json" } });
  if (!response.ok) throw new Error(`GitHub respondeu HTTP ${response.status}`);
  const data = await response.json();
  return Array.isArray(data) ? data as Release[] : [data as Release];
}
async function listarModificados(raiz: string, exec: Exec): Promise<string[]> {
  const r = exec(["status", "--porcelain", "-z", "--untracked-files=all"], raiz);
  if (r.codigo) throw erro("git status", r.saida);
  const out: string[] = [], partes = r.saida.split("\0");
  for (let i = 0; i < partes.length; i++) {
    const raw = partes[i]!; if (!raw) continue;
    const path = raw.slice(3); if (segurarCaminho(path) && !/^(?:raw|wiki)(?:[\\/]|$)/.test(path)) out.push(path);
    if (/^[RC]/.test(raw.slice(0, 2))) i++;
  }
  return out;
}
async function lerMigracoes(raiz: string, tag: string, exec: Exec): Promise<string[]> {
  const r = exec(["show", `${tag}:${CAMINHOS_MIGRACAO}`], raiz);
  if (r.codigo !== 0) return [];
  let value: any; try { value = JSON.parse(r.saida); } catch { throw erro("migração declarada inválida", `${CAMINHOS_MIGRACAO} não é JSON válido`); }
  if (!Array.isArray(value?.deixa_de_rastrear) || !value.deixa_de_rastrear.every((p: unknown) => typeof p === "string" && segurarCaminho(p))) throw erro("migração declarada inválida", "deixa_de_rastrear precisa ser uma lista de caminhos relativos seguros");
  return value.deixa_de_rastrear;
}
export function verificarAssinaturaTag(raiz: string, tag: string, exec: Exec = execPadrao): string | undefined {
  const allow = join(raiz, "seguranca/assinantes");
  try { if (!Bun.file(allow).size) return "seguranca/assinantes ausente ou vazio; tag candidata recusada até haver chave pública ancorada localmente"; } catch { return "seguranca/assinantes ausente; tag candidata recusada até haver chave pública ancorada localmente"; }
  const r = exec(["-c", "gpg.format=ssh", "-c", `gpg.ssh.allowedSignersFile=${allow}`, "verify-tag", tag], raiz);
  return r.codigo === 0 ? undefined : `assinatura inválida: ${r.saida}`;
}
function oficial(raiz: string, exec: Exec) {
  const rem = exec(["remote", "get-url", "origin"], raiz).saida.trim();
  const ok = ["https://github.com/iagofrota/anvilore.git", "git@github.com:iagofrota/anvilore.git", "ssh://git@github.com/iagofrota/anvilore.git"].includes(rem);
  const tag = exec(["describe", "--tags", "--exact-match", "HEAD"], raiz);
  return ok && tag.codigo === 0;
}
async function conferirMelhorOuIgual(raiz: string, antes: Diagnostico, deps: DependenciasAtualizacao) {
  let depois: Diagnostico;
  if (deps.diagnosticar) depois = await deps.diagnosticar(raiz);
  else {
    const p = Bun.spawnSync([process.execPath, "src/cli.ts", "doctor", "--json"], { cwd: raiz, stdout: "pipe", stderr: "pipe" });
    try { depois = JSON.parse(p.stdout.toString()) as Diagnostico; }
    catch { throw erro("doctor", `não consegui ler o diagnóstico da versão ativa (código ${p.exitCode})`); }
  }
  const faltas = (d: Diagnostico) => new Set(d.travas.filter(t => !t.ligada && !t.opcional).map(t => t.nome));
  const base = faltas(antes), novo = faltas(depois);
  const preReqsFaltando = (d: Diagnostico) => new Set(d.prerequisitos.filter(p => !p.presente).map(p => p.nome));
  const preReqsAntes = preReqsFaltando(antes), preReqsDepois = preReqsFaltando(depois);
  return [...novo].every(item => base.has(item)) && [...preReqsDepois].every(item => preReqsAntes.has(item));
}
async function reverter(raiz: string, estado: Estado, b: Backup, exec: Exec, deps: DependenciasAtualizacao): Promise<void> {
  estado.estado = "revertendo"; await gravarEstado(raiz, estado, deps);
  const etapas: [string, () => Promise<boolean>][] = [
    ["R1 checkout", async () => exec(["checkout", "--force", "--detach", estado.anterior!], raiz).codigo === 0 && exec(["rev-parse", "HEAD"], raiz).saida.trim() === estado.anterior],
    ["R2 dependências", async () => !estado.bunLockMudou || (deps.instalarDependencias ? await deps.instalarDependencias(raiz) : Bun.spawnSync(["bun", "install", "--frozen-lockfile"], { cwd: raiz, stdout: "ignore", stderr: "ignore" }).exitCode) === 0],
    ["R3 restaurar cópia", async () => (await restaurarBackup(raiz, b)).length === 0],
    ["R4 instalar configurações", async () => {
      const codigo = deps.instalar ? await deps.instalar(raiz, estado.alvos ?? []) : (await instalar({ alvos: estado.alvos ?? [], destino: raiz, simular: false, autoCommit: estado.autoCommit, githubBackup: estado.githubBackup })).codigo;
      return codigo !== 1 && codigo !== 4 && (await restaurarBackup(raiz, b)).length === 0;
    }],
    ["R5 doctor e proteção raw", async () => {
      const prova = deps.provarHook ? { codigo: (await deps.provarHook(raiz)) ? 2 : 1, saida: "prova injetada" } : await esperarHook(raiz);
      return prova.codigo === 2 && await conferirMelhorOuIgual(raiz, b.doctor, deps);
    }],
  ];
  for (const [nome, etapa] of etapas) {
    estado.etapa = nome; await gravarEstado(raiz, estado, deps);
    let ok = false; try { ok = await etapa(); } catch { ok = false; }
    if (!ok) { estado.estado = "reversao-incompleta"; estado.erro = nome; await gravarEstado(raiz, estado, deps); throw erro("reversão incompleta", nome); }
  }
  estado.estado = "ocioso"; estado.versaoInstalada = estado.de; estado.recusadas = [...new Set([...(estado.recusadas ?? []), estado.para!])]; delete estado.etapa; delete estado.erro; await gravarEstado(raiz, estado, deps);
}
async function aplicar(raiz: string, estado: Estado, release: { tag: string; versao: string }, exec: Exec, deps: DependenciasAtualizacao) {
  const id = `${Date.now()}-${randomBytes(5).toString("hex")}`;
  const idAnterior = estado.id;
  const anterior = exec(["rev-parse", "HEAD"], raiz); if (anterior.codigo) throw erro("não consegui identificar a versão anterior", anterior.saida);
  const doctor = await (deps.diagnosticar ?? (async r => diagnosticar(r)))(raiz);
  const hookRaw = deps.provarHook ? { codigo: (await deps.provarHook(raiz)) ? 2 : 1, saida: "prova injetada" } : await esperarHook(raiz);
  if (hookRaw.codigo !== 2) throw erro("prova de raw antes da atualização", "o hook não bloqueou a tentativa descartável");
  const locks = exec(["diff", "--quiet", estado.anterior!, release.tag, "--", "bun.lock", "bun.lockb"], raiz);
  estado.bunLockMudou = locks.codigo === 1;
  const migracoes = await lerMigracoes(raiz, release.tag, exec);
  const arquivos = [...new Set([...(await listarModificados(raiz, exec)), ...migracoes])];
  const b = await backup(raiz, id, arquivos, doctor, hookRaw, (await versaoDoKit(raiz)).versao);
  estado.estado = "aplicando"; estado.de = estado.versaoInstalada ?? (await versaoDoKit(raiz)).versao; estado.para = release.versao; estado.anterior = anterior.saida.trim(); estado.id = id;
  estado.idAnterior = idAnterior;
  const anteriorGuardado = exec(["update-ref", "refs/anvilore/anterior", estado.anterior], raiz);
  if (anteriorGuardado.codigo !== 0) throw erro("guardar versão anterior", anteriorGuardado.saida);
  await gravarEstado(raiz, estado, deps);
  try {
    if (migracoes.length) {
      estado.migracoes = migracoes;
      estado.etapa = "migração"; await gravarEstado(raiz, estado, deps);
      const m = await migrarRastreio(raiz, { listaDoRastreio: migracoes });
      if (m.codigo !== 0) { estado.estado = "migracao-incompleta"; estado.erro = m.mensagens.join(" "); await gravarEstado(raiz, estado, deps); throw erro("migração incompleta", estado.erro); }
      estado.manifestoMigracaoId = m.manifesto?.id;
    }
    const comandos: [string, () => { codigo: number; saida: string } | Promise<{ codigo: number; saida: string }>] [] = [
      ["checkout", () => exec(["checkout", "--force", "--detach", release.tag], raiz)],
      ["dependências", async () => !estado.bunLockMudou ? { codigo: 0, saida: "bun.lock inalterado" } : deps.instalarDependencias ? { codigo: await deps.instalarDependencias(raiz), saida: "bun install" } : { codigo: Bun.spawnSync(["bun", "install", "--frozen-lockfile"], { cwd: raiz, stdout: "pipe", stderr: "pipe" }).exitCode, saida: "bun install" }],
    ];
    for (const [etapa, executar] of comandos) {
      estado.etapa = etapa; await gravarEstado(raiz, estado, deps);
      const r = await executar(); if (r.codigo) throw erro(etapa, r.saida);
      if (etapa === "checkout" && estado.manifestoMigracaoId) {
        const manifesto = (await lerManifestos(raiz)).find(m => m.id === estado.manifestoMigracaoId);
        if (!manifesto) throw erro("restaurar migração", `manifesto ${estado.manifestoMigracaoId} ausente após checkout`);
        const devolucao = await devolverTudo(raiz, manifesto);
        if (devolucao.problemas.length) throw erro("restaurar migração", devolucao.problemas.join("; "));
      }
    }
    estado.etapa = "instalar"; await gravarEstado(raiz, estado, deps);
    const instalacao = deps.instalar ? await deps.instalar(raiz, estado.alvos ?? []) : (await instalar({ alvos: estado.alvos ?? [], destino: raiz, simular: false, autoCommit: estado.autoCommit, githubBackup: estado.githubBackup })).codigo;
    if (instalacao === 4 || instalacao === 1) throw erro("instalar", `código ${instalacao}`);
    estado.etapa = "prova"; await gravarEstado(raiz, estado, deps);
    const provaDepois = deps.provarHook ? { codigo: (await deps.provarHook(raiz)) ? 2 : 1, saida: "prova injetada" } : await esperarHook(raiz);
    if (provaDepois.codigo !== 2) throw erro("hook proteger-raw", "a prova não retornou código 2");
    if (!(await conferirMelhorOuIgual(raiz, doctor, deps))) throw erro("doctor", "a instalação piorou em relação ao estado anterior");
    const rawWikiDepois = await shaRawWiki(raiz);
    if (JSON.stringify(rawWikiDepois) !== JSON.stringify(b.rawWiki)) throw erro("preservação raw/wiki", "os hashes medidos mudaram");
    estado.estado = "ocioso"; estado.versaoInstalada = release.versao; estado.atualizadoEm = new Date().toISOString(); delete estado.etapa; delete estado.erro;
    delete estado.idAnterior;
    await gravarEstado(raiz, estado, deps);
    return `Atualizado para ${release.versao}. raw/ e wiki/ mantiveram os hashes medidos.`;
  } catch (e) {
    if (estado.estado === "migracao-incompleta") throw e;
    const msg = (e as Error).message;
    try { await reverter(raiz, estado, b, exec, deps); } catch (rev) { throw rev; }
    estado.estado = "ocioso"; estado.id = idAnterior; estado.erro = msg; estado.recusadas = [...new Set([...(estado.recusadas ?? []), release.versao])]; delete estado.idAnterior; await gravarEstado(raiz, estado, deps);
    throw erro("atualização falhou e foi desfeita", msg);
  }
}

async function recuperar(raiz: string, estado: Estado, exec: Exec, deps: DependenciasAtualizacao) {
  if (!["aplicando", "revertendo", "reversao-incompleta"].includes(estado.estado)) return;
  if (!estado.id || !estado.anterior) throw erro("estado recuperável incompleto", "faltam id ou ref anterior; cópia mantida");
  const backupPath = join(raiz, ".anvilore/atualizacao", estado.id, "manifesto.json");
  const b = JSON.parse(await readFile(backupPath, "utf8")) as Backup;
  if (b.id !== estado.id) throw erro("cópia inválida", "o id do manifesto não corresponde ao diretório; cópia mantida");
  await reverter(raiz, estado, b, exec, deps);
  if (estado.idAnterior !== undefined) { estado.id = estado.idAnterior; delete estado.idAnterior; await gravarEstado(raiz, estado, deps); }
}

export async function atualizar(acao: "verificar" | "voltar" | "estado" | "automatico" | "aplicar" = "verificar", deps: DependenciasAtualizacao = {}): Promise<string> {
  const raiz = resolve(deps.raiz ?? process.env.ANVILORE_DESTINO ?? process.cwd()), exec = deps.executar ?? execPadrao;
  if (acao === "estado") {
    let s: Estado; try { s = await lerEstado(raiz); } catch (e) { return (e as Error).message; }
    const git = exec(["rev-parse", "HEAD"], raiz);
    const mig = await situacaoDaMigracao(raiz, (args) => exec(args, raiz));
    return [`Estado: ${s.estado}`, `Versão: ${s.versaoInstalada ?? "desconhecida"}`, `HEAD: ${git.codigo === 0 ? git.saida.trim() : "indisponível"}`, ...(s.etapa ? [`Etapa: ${s.etapa}`] : []), ...(mig.pendentes.length ? [`Migração pendente: ${mig.pendentes.map(m => m.id).join(", ")}`] : [])].join("\n");
  }
  return await comTrava(raiz, async () => {
    let state = await lerEstado(raiz);
    if (state.estado === "reversao-incompleta" || state.estado === "aplicando" || state.estado === "revertendo") {
      await recuperar(raiz, state, exec, deps);
      state = await lerEstado(raiz);
      return "Recuperação concluída. Nenhuma release nova foi consultada; verifique novamente quando quiser.";
    }
    if (state.estado === "migracao-incompleta") {
      const resultado = await migrarRastreio(raiz, { listaDoRastreio: state.migracoes });
      if (resultado.codigo !== 0) throw erro("migração incompleta", resultado.mensagens.join(" "));
      state.estado = "ocioso"; delete state.erro; await gravarEstado(raiz, state, deps);
      return "Migração recuperada. Nenhuma release nova foi consultada; verifique novamente quando quiser.";
    }
    if (!oficial(raiz, exec)) throw erro("clone não gerenciado", "exige origin oficial, HEAD numa tag e estado criado pelo instalador");
    const tagAtual = exec(["describe", "--tags", "--exact-match", "HEAD"], raiz).saida.trim();
    const versaoDaTag = tagAtual.startsWith("v") ? tagAtual.slice(1) : tagAtual;
    const versaoInstalada = state.versaoInstalada ?? (await versaoDoKit(raiz)).versao;
    if (!parsearSemVer(versaoDaTag) || compararSemVer(versaoDaTag, versaoInstalada) !== 0) {
      throw erro("clone não gerenciado", `tag ${tagAtual} não corresponde à versão instalada ${versaoInstalada}`);
    }
    if (acao === "voltar") {
      if (!state.id || !state.anterior) throw erro("sem versão anterior", "não há cópia de atualização bem-sucedida");
      const b = JSON.parse(await readFile(join(raiz, ".anvilore/atualizacao", state.id, "manifesto.json"), "utf8")) as Backup;
      state.de = b.versaoAtual; state.para = state.versaoInstalada;
      await reverter(raiz, state, b, exec, deps); delete state.id; await gravarEstado(raiz, state, deps); return `Voltou para ${state.versaoInstalada}.`;
    }
    if (!state.alvos?.length) {
      const dirs: [string, Alvo][] = [[".claude", "claude"], [".codex", "codex"], [".gemini", "gemini"], [".github/copilot", "copilot"]];
      state.alvos = [];
      for (const [rel, alvo] of dirs) if (await stat(join(raiz, rel)).then(s => s.isDirectory(), () => false)) state.alvos.push(alvo);
    }
    if (state.autoCommit === undefined || state.githubBackup === undefined) {
      try {
        const toml = Bun.TOML.parse(await readFile(join(raiz, "anvilore.toml"), "utf8")) as Record<string, any>;
        state.autoCommit ??= toml.hooks?.auto_commit === true;
        state.githubBackup ??= toml.hooks?.github_backup === true;
      } catch { state.autoCommit ??= false; state.githubBackup ??= false; }
    }
    const atual = state.versaoInstalada ?? (await versaoDoKit(raiz)).versao;
    let releases: Release[];
    try { releases = await (deps.releases ?? releasesGitHub)(state.canal); }
    catch (e) { state.verificadoEm = new Date().toISOString(); await gravarEstado(raiz, state, deps); throw e; }
    const release = state.estado === "baixada" && state.tagDisponivel
      ? releases.flatMap(r => (r.tag_name.startsWith("v") ? r.tag_name.slice(1) : r.tag_name) === state.disponivel ? [{ tag: r.tag_name.startsWith("v") ? r.tag_name : `v${r.tag_name}`, versao: state.disponivel!, url: r.html_url }] : [])[0]
      : selecionarRelease(atual, releases, state.canal);
    if (!release) { state.verificadoEm = new Date().toISOString(); await gravarEstado(raiz, state, deps); return `Anvilore ${atual} já está atualizado.`; }
    if ((state.recusadas ?? []).includes(release.versao)) return `Anvilore ${release.versao} já foi recusada; aguardando outra release.`;
    const decision = decidirPolitica(atual, release.versao, state.modo, state.canal);
    if (decision === "ignorar" && acao !== "aplicar") return `Atualização ignorada pela política atual (${state.modo}, canal ${state.canal}).`;
    const fetch = exec(["fetch", "origin", "tag", release.tag, "--no-tags"], raiz);
    if (fetch.codigo) throw erro("fetch", fetch.saida);
    const bad = verificarAssinaturaTag(raiz, release.tag, exec);
    if (bad) { state.estado = "recusada"; state.recusadas = [...new Set([...(state.recusadas ?? []), release.versao])]; state.erro = bad; await gravarEstado(raiz, state, deps); await log(raiz, `assinatura inválida tag=${release.tag}`, deps); throw new Error(bad); }
    if (acao === "verificar" || (acao === "automatico" && state.estado !== "baixada")) {
      state.estado = "baixada"; state.disponivel = release.versao; state.tagDisponivel = release.tag; state.verificadoEm = new Date().toISOString();
      await gravarEstado(raiz, state, deps);
      return decision === "perguntar" ? `Há uma versão que pede confirmação: ${release.versao}. Rode o comando anvilore atualizar para aplicar.` : `Versão ${release.versao} conferida e aguardando a próxima sessão.`;
    }
    if (acao === "automatico" && decision !== "aplicar") { state.estado = "baixada"; state.disponivel = release.versao; state.tagDisponivel = release.tag; await gravarEstado(raiz, state, deps); return `Versão ${release.versao} aguardando confirmação.`; }
    return await aplicar(raiz, state, release, exec, deps);
  });
}

export async function comandoAtualizar(args: string[], deps: DependenciasAtualizacao = {}): Promise<number> {
  const modos = args.filter(a => a.startsWith("--"));
  if (args.some(a => !["--verificar", "--voltar", "--estado"].includes(a)) || modos.length > 1) { console.error("Uso: anvilore atualizar [--verificar | --voltar | --estado]"); return 2; }
  const acao = modos[0] === "--voltar" ? "voltar" : modos[0] === "--estado" ? "estado" : modos[0] === "--verificar" ? "verificar" : "aplicar";
  try { console.log(await atualizar(acao, deps)); return 0; } catch (e) { console.error(`atualizar: ${(e as Error).message}`); return 1; }
}
