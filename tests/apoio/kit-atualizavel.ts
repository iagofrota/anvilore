import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { DependenciasAtualizacao, Release } from "../../src/lib/atualizacao";

// Kit descartável para o atualizador: repositório Git real, tags assinadas com chave SSH gerada na hora e um
// `src/cli.ts` mínimo por versão. O stub registra em .anvilore/chamadas.log qual versão rodou cada subcomando,
// o que prova que instalar/doctor/hook vêm da versão ativa no disco. Só a rede (fetch, releases) é simulada.

export type StubCli = { doctorRuim?: boolean; hookNovo?: boolean; corromperRaw?: boolean; mexerNaWiki?: "esqueleto" | "pagina" };
export type Versao = { versao: string; arquivos?: Record<string, string | null>; cli?: StubCli; packageManager?: string };

export function stubCli(versao: string, o: StubCli = {}): string {
  return `import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [comando, ...resto] = process.argv.slice(2);
const versao = ${JSON.stringify(versao)};
mkdirSync(".anvilore", { recursive: true });
appendFileSync(".anvilore/chamadas.log", versao + " " + comando + " " + resto.join(" ") + "\\n");
if (comando === "instalar") {
  mkdirSync(".codex", { recursive: true });
  writeFileSync(".codex/config.toml", "# hook gerado pela " + versao + "\\n");
  mkdirSync(".claude/agents", { recursive: true });
  writeFileSync(".claude/agents/anvilore-leitor.md", "leitor da " + versao + "\\n");
  mkdirSync(".github/copilot", { recursive: true });
  writeFileSync(".github/copilot/settings.json", JSON.stringify({ versao }) + "\\n");
  writeFileSync(".claude/settings.json", JSON.stringify({ hooks: { SessionStart: [{ command: "bun src/cli.ts " + (${o.hookNovo === true} ? "subcomando-novo" : "hooks-wiki contexto") }] } }) + "\\n");
  if (${o.corromperRaw === true}) writeFileSync("raw/evidencia.md", "corrompido\\n");
  const wiki = process.env.ANVILORE_WIKI || "wiki";
  if (${JSON.stringify(o.mexerNaWiki ?? "")} === "esqueleto") {
    mkdirSync(join(wiki, ".git"), { recursive: true }); writeFileSync(join(wiki, ".git", "HEAD"), "ref: refs/heads/main\\n");
    if (!existsSync(join(wiki, "index.md"))) writeFileSync(join(wiki, "index.md"), "# índice do modelo\\n");
  }
  if (${JSON.stringify(o.mexerNaWiki ?? "")} === "pagina") writeFileSync(join(wiki, "pagina.md"), "reescrita pelo instalar\\n");
  process.exit(0);
}
if (comando === "doctor") { console.log(JSON.stringify({ travas: [{ nome: "raw", ligada: ${o.doctorRuim !== true} }], prerequisitos: [], avisos: [] })); process.exit(${o.doctorRuim ? 1 : 0}); }
if (comando === "hook") process.exit(2);
process.exit(64);
`;
}

export function gitReal(raiz: string) {
  return (args: string[]) => {
    const p = Bun.spawnSync(["git", "-C", raiz, ...args], { stdout: "pipe", stderr: "pipe" });
    return { codigo: p.exitCode, saida: `${p.stdout.toString()}${p.stderr.toString()}` };
  };
}

export async function criarChave(pasta: string) {
  const chave = join(pasta, "chave-descartavel");
  const p = Bun.spawnSync(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "fixture-descartavel", "-f", chave], { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error("ssh-keygen falhou");
  const publica = (await readFile(`${chave}.pub`, "utf8")).trim().split(/\s+/).slice(0, 2).join(" ");
  return { chave, assinantes: `teste@localhost namespaces="git" ${publica}\n` };
}

const GITIGNORE = ".anvilore/\n.claude/\n.codex/\n.agents/\n.gemini/\n.github/copilot/\n.github/hooks/\n.github/agents/\nraw/\nwiki/\nanvilore.toml\nnode_modules/\n";

export type Kit = Awaited<ReturnType<typeof criarKit>>;

export async function criarKit(versoes: Versao[], opcoes: { alvos?: string[]; estado?: Record<string, unknown> } = {}) {
  const pai = await mkdtemp(join(tmpdir(), "anvilore-kit-"));
  const raiz = join(pai, "Anvilore");
  await mkdir(raiz);
  const { chave, assinantes } = await criarChave(pai);
  const git = gitReal(raiz);
  const ok = (args: string[]) => { const r = git(args); if (r.codigo) throw new Error(`git ${args.join(" ")}: ${r.saida}`); return r.saida.trim(); };
  ok(["init", "-q"]); ok(["config", "user.name", "Teste"]); ok(["config", "user.email", "teste@localhost"]); ok(["config", "commit.gpgsign", "false"]);
  ok(["remote", "add", "origin", "https://github.com/iagofrota/anvilore.git"]);
  const commits: Record<string, string> = {};
  for (const v of versoes) {
    const base: Record<string, string | null> = {
      ".gitignore": GITIGNORE, "seguranca/assinantes": assinantes, "bun.lock": `lock ${v.versao}\n`,
      "package.json": JSON.stringify({ name: "anvilore", version: v.versao, ...(v.packageManager ? { packageManager: v.packageManager } : {}) }),
      "src/cli.ts": stubCli(v.versao, v.cli), "skills/ingest/SKILL.md": "skill do kit\n",
    };
    for (const [rel, conteudo] of Object.entries({ ...base, ...v.arquivos })) {
      if (conteudo === null) { if (git(["ls-files", "--error-unmatch", rel]).codigo === 0) ok(["rm", "-q", "--", rel]); continue; }
      await mkdir(dirname(join(raiz, rel)), { recursive: true });
      await writeFile(join(raiz, rel), conteudo);
      ok(["add", "-f", "--", rel]);
    }
    ok(["commit", "-qm", `versão ${v.versao}`, "--allow-empty"]);
    ok(["-c", "gpg.format=ssh", "-c", `user.signingkey=${chave}`, "tag", "-s", `v${v.versao}`, "-m", `v${v.versao}`]);
    commits[v.versao] = ok(["rev-parse", "HEAD"]);
  }
  const primeira = versoes[0]!.versao;
  ok(["checkout", "-q", "--force", "--detach", `v${primeira}`]);
  await mkdir(join(raiz, ".anvilore"), { recursive: true });
  await writeFile(join(raiz, ".anvilore/atualizacao.json"), JSON.stringify({
    versao: 1, modo: "automatico", canal: "estavel", estado: "ocioso", versaoInstalada: primeira, alvos: opcoes.alvos ?? ["claude", "codex"], ...opcoes.estado,
  }));
  let releases: Release[] = versoes.slice(1).map(v => ({ tag_name: `v${v.versao}`, draft: false, prerelease: false }));
  let dependencias = 0;
  const kit = {
    pai, raiz, chave, git, ok, commits,
    head: () => ok(["rev-parse", "HEAD"]),
    dependencias: () => dependencias,
    publicar: (tags: string[]) => { releases = tags.map(tag => ({ tag_name: tag, draft: false, prerelease: false })); },
    deps: (extra: DependenciasAtualizacao = {}): DependenciasAtualizacao => ({
      raiz,
      executar: (args: string[]) => args[0] === "fetch" ? { codigo: 0, saida: "" } : git(args),
      releases: async () => releases,
      instalarDependencias: async () => { dependencias++; return 0; },
      versaoBun: async () => "1.4.1",
      ...extra,
    }),
    estado: async () => JSON.parse(await readFile(join(raiz, ".anvilore/atualizacao.json"), "utf8")),
    mudarEstado: async (mudanca: Record<string, unknown>) => {
      const atual = JSON.parse(await readFile(join(raiz, ".anvilore/atualizacao.json"), "utf8"));
      await writeFile(join(raiz, ".anvilore/atualizacao.json"), JSON.stringify({ ...atual, ...mudanca }));
    },
    chamadas: async () => (await readFile(join(raiz, ".anvilore/chamadas.log"), "utf8").catch(() => "")).trim().split("\n").filter(Boolean),
    rodarCli: (args: string[]) => Bun.spawnSync([process.execPath, join(raiz, "src/cli.ts"), ...args], { cwd: raiz, stdout: "pipe", stderr: "pipe" }).exitCode,
    limpar: () => rm(pai, { recursive: true, force: true }),
  };
  return kit;
}

// Árvore medida no teste, sem usar o código do atualizador: caminho → tipo e SHA-256 (link: alvo).
export async function arvore(raiz: string, rels: readonly string[]): Promise<Record<string, string>> {
  const saida: Record<string, string> = {};
  const andar = async (rel: string) => {
    const abs = join(raiz, rel);
    let st;
    try { st = await lstat(abs); } catch { return; }
    if (st.isSymbolicLink()) saida[rel] = `link:${await readlink(abs)}`;
    else if (st.isDirectory()) { saida[rel] = "dir"; for (const nome of (await readdir(abs)).sort()) await andar(`${rel}/${nome}`); }
    else saida[rel] = `arquivo:${createHash("sha256").update(await readFile(abs)).digest("hex")}`;
  };
  for (const rel of rels) await andar(rel);
  return saida;
}
