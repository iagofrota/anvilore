import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import { join, relative } from "node:path";

export async function instantaneo(dir: string): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const visitar = async (atual: string) => {
    for (const entrada of await readdir(atual, { withFileTypes: true })) {
      const caminho = join(atual, entrada.name);
      const rel = relative(dir, caminho).replaceAll("\\", "/");
      const stat = await lstat(caminho);
      if (stat.isSymbolicLink()) mapa.set(rel, `link:${await readlink(caminho)}`);
      else if (stat.isDirectory()) { mapa.set(rel, "dir"); await visitar(caminho); }
      else if (stat.isFile()) mapa.set(rel, `sha256:${createHash("sha256").update(await readFile(caminho)).digest("hex")}`);
    }
  };
  await visitar(dir);
  return mapa;
}

export function mesmaArvore(a: Map<string, string>, b: Map<string, string>): boolean {
  return a.size === b.size && [...a].every(([caminho, hash]) => b.get(caminho) === hash);
}
