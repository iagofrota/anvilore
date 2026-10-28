import { readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";

const fonte = resolve(import.meta.dir, "../..");

export type VersaoDoKit = { versao: string; tag?: string; commit?: string };

const USO = `Uso: anvilore versao
Mostra a versão do kit (package.json) e, quando o kit é um clone git, a tag exata e o commit.`;

function git(raiz: string, args: string[]): string | undefined {
  try {
    const processo = Bun.spawnSync(["git", "-C", raiz, ...args], { stdout: "pipe", stderr: "pipe" });
    return processo.exitCode === 0 ? processo.stdout.toString().trim() : undefined;
  } catch {
    return undefined; // git ausente: a versão do package.json basta
  }
}

// Só usa o git quando o kit é a raiz do repositório: uma cópia dentro de outro repositório não herda o commit de fora.
async function ehRaizDoRepositorio(raiz: string): Promise<boolean> {
  const topo = git(raiz, ["rev-parse", "--show-toplevel"]);
  if (!topo) return false;
  try { return await realpath(topo) === await realpath(raiz); } catch { return false; }
}

export async function versaoDoKit(raiz: string = fonte): Promise<VersaoDoKit> {
  const pacote = JSON.parse(await readFile(join(raiz, "package.json"), "utf8")) as { version?: unknown };
  if (typeof pacote.version !== "string" || pacote.version === "") throw new Error(`package.json sem versão em ${raiz}`);
  const resultado: VersaoDoKit = { versao: pacote.version };
  if (!(await ehRaizDoRepositorio(raiz))) return resultado;
  const tag = git(raiz, ["describe", "--tags", "--exact-match", "HEAD"]);
  const commit = git(raiz, ["rev-parse", "--short", "HEAD"]);
  if (tag) resultado.tag = tag;
  if (commit) resultado.commit = commit;
  return resultado;
}

export function formatarVersao({ versao, tag, commit }: VersaoDoKit): string {
  const detalhes = [tag && `tag ${tag}`, commit && `commit ${commit}`].filter(Boolean);
  return detalhes.length ? `anvilore ${versao} (${detalhes.join(", ")})` : `anvilore ${versao}`;
}

export async function comandoVersao(args: string[]): Promise<number> {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    console.log(USO);
    return 0;
  }
  if (args.length > 0) {
    console.error(USO);
    return 2;
  }
  try {
    console.log(formatarVersao(await versaoDoKit()));
    return 0;
  } catch (erro) {
    console.error(`versao: ${(erro as Error).message}`);
    return 1;
  }
}
