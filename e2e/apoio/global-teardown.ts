import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { instantaneo, mesmaArvore } from "./vault";

export default async function globalTeardown(): Promise<void> {
  const raiz = resolve(process.cwd());
  const arquivo = join(raiz, "e2e/resultados/checkout-guard.json");
  const antes = JSON.parse(await readFile(arquivo, "utf8")) as { raw: [string, string][]; wiki: [string, string][] };
  const rawDepois = await instantaneo(join(raiz, "raw"));
  const wikiDepois = await instantaneo(join(raiz, "wiki"));
  if (!mesmaArvore(new Map(antes.raw), rawDepois) || !mesmaArvore(new Map(antes.wiki), wikiDepois)) {
    throw new Error("Playwright alterou raw/ ou wiki/ do checkout. A guarda global detectou diferença de hashes.");
  }
}
