import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fotografar } from "./guarda";

export default async function globalSetup(): Promise<void> {
  const raiz = resolve(process.cwd());
  for (const caminho of ["src/ui/public/index.html", "src/ui/public/assets/main.js"]) {
    try { await readFile(join(raiz, caminho)); }
    catch { throw new Error(`Assets da interface não encontrados (${caminho}); rode bun run build:ui antes do Playwright.`); }
  }
  const estado = { raw: await fotografar(join(raiz, "raw")), wiki: await fotografar(join(raiz, "wiki")) };
  const pasta = join(raiz, "e2e/resultados");
  await mkdir(pasta, { recursive: true });
  await writeFile(join(pasta, "checkout-guard.json"), JSON.stringify(estado));
}
