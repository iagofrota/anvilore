import { mkdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";

function caminhoGit(repo: string, args: string[], git = "git"): { codigo: number; saida: string } {
  try {
    const processo = Bun.spawnSync([git, "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" });
    return { codigo: processo.exitCode, saida: `${processo.stdout.toString()}${processo.stderr.toString()}`.trim() };
  } catch (erro) { return { codigo: 1, saida: (erro as Error).message }; }
}

export function caminhoWiki(raiz: string, ambiente: Record<string, string | undefined> = process.env): string {
  return resolve(ambiente.ANVILORE_WIKI || join(raiz, "wiki"));
}

export async function repositorioDaWiki(wiki: string, git = "git"): Promise<boolean> {
  const topo = caminhoGit(wiki, ["rev-parse", "--show-toplevel"], git);
  if (topo.codigo !== 0) return false;
  try { return await realpath(topo.saida) === await realpath(wiki); } catch { return false; }
}

export async function inicializarRepositorioWiki(raiz: string, ambiente: Record<string, string | undefined> = process.env): Promise<{ criado: boolean; caminho: string }> {
  const wiki = caminhoWiki(raiz, ambiente);
  await mkdir(wiki, { recursive: true });
  if (await repositorioDaWiki(wiki)) return { criado: false, caminho: wiki };
  const init = caminhoGit(wiki, ["init", "-q"]);
  if (init.codigo !== 0) throw new Error(init.saida || `não foi possível inicializar ${wiki}`);
  const add = caminhoGit(wiki, ["add", "-A"]);
  if (add.codigo !== 0) throw new Error(add.saida || `não foi possível preparar o commit inicial de ${wiki}`);
  const commit = Bun.spawnSync(["git", "-C", wiki, "-c", "user.name=Anvilore", "-c", "user.email=anvilore@localhost", "commit", "--allow-empty", "-m", "wiki: início"], { stdout: "pipe", stderr: "pipe" });
  if (commit.exitCode !== 0) throw new Error(`${commit.stdout.toString()}${commit.stderr.toString()}`.trim() || `não foi possível criar o commit inicial de ${wiki}`);
  return { criado: true, caminho: wiki };
}
