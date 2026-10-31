import { lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { dialetoDe, embutirInstalador } from "./embutir-instalador";

// Além dos quatro campos, confere o corpo: nenhum pacote recebe modelo vazio ou fixture.
export async function conferirScriptRelease(raiz: string, arquivo: string): Promise<void> {
  const dialeto = dialetoDe(arquivo);
  const ler = (p: string) => readFile(join(raiz, p), "utf8");
  const esperado = embutirInstalador(await ler(`instalador/instalar.${dialeto}`), await ler("instalador/dependencias.json"), await ler("seguranca/assinantes"), await ler("instalador/base-minima"), dialeto);
  if (!(await lstat(arquivo)).isFile() || !(await readFile(arquivo)).equals(Buffer.from(esperado))) {
    throw new Error(`${arquivo}: instalador difere do build de produção.`);
  }
}

export async function comandoConferirScript(args: string[], raiz = resolve(import.meta.dir, "..")): Promise<number> {
  try {
    const [arquivo, ...extras] = args;
    if (!arquivo || extras.length || !/\.(sh|ps1)$/.test(arquivo)) throw new Error("Uso: bun scripts/conferir-script-release.ts <instalar.sh|instalar.ps1>");
    await conferirScriptRelease(raiz, resolve(arquivo));
    console.log("Instalador de produção conferido.");
    return 0;
  } catch (e) { console.error((e as Error).message); return 1; }
}
if (import.meta.main) process.exit(await comandoConferirScript(process.argv.slice(2)));
