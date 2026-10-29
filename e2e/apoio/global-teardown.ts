import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { conferirFoto, fotografar, type Foto } from "./guarda";

export default async function globalTeardown(): Promise<void> {
  const raiz = resolve(process.cwd());
  const antes = JSON.parse(await readFile(join(raiz, "e2e/resultados/checkout-guard.json"), "utf8")) as { raw: Foto; wiki: Foto };
  const problemas = [
    conferirFoto("raw", antes.raw, await fotografar(join(raiz, "raw"))),
    conferirFoto("wiki", antes.wiki, await fotografar(join(raiz, "wiki"))),
  ].filter((problema): problema is string => problema !== null);
  if (problemas.length > 0) throw new Error(`Playwright alterou o checkout real. A guarda global detectou: ${problemas.join("; ")}.`);
}
