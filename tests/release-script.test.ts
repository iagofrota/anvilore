import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { embutirInstalador } from "../scripts/embutir-instalador";
// O import dinâmico permite observar RED por ausência do módulo sem impedir descobrir os cenários.
const conferir = async (raiz: string, arquivo: string) => (await import("../scripts/conferir-script-release")).conferirScriptRelease(raiz, arquivo);
let raiz: string, script: string;
beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "anv-script-release-"));
  await mkdir(join(raiz, "instalador")); await mkdir(join(raiz, "seguranca"));
  for (const nome of ["instalador/instalar.sh", "instalador/instalar.ps1", "instalador/dependencias.json", "instalador/base-minima", "seguranca/assinantes"]) {
    await writeFile(join(raiz, nome), await readFile(resolve(import.meta.dir, "..", nome)));
  }
  script = join(raiz, "instalar.ps1");
  const ler = (p: string) => readFile(join(raiz, p), "utf8");
  await writeFile(script, embutirInstalador(await ler("instalador/instalar.ps1"), await ler("instalador/dependencias.json"), await ler("seguranca/assinantes"), await ler("instalador/base-minima"), "ps1"));
});
afterEach(async () => { await rm(raiz, { recursive: true, force: true }); });
test("Dado script de produção, Quando confiro antes de empacotar, Então aceito os bytes determinísticos", async () => {
  await expect(conferir(raiz, script)).resolves.toBeUndefined();
});
test("Dado modelo sem embutimento ou corpo alterado, Quando confiro antes de empacotar, Então recuso", async () => {
  for (const corpo of [await readFile(join(raiz, "instalador/instalar.ps1"), "utf8"), await readFile(script, "utf8") + "\nWrite-Host adulterado\n"]) {
    await writeFile(script, corpo);
    await expect(conferir(raiz, script)).rejects.toThrow("produção");
  }
});
test("Dado manifesto alterado depois de gerar o script, Quando confiro, Então recuso o script anterior", async () => {
  await writeFile(join(raiz, "instalador/dependencias.json"), (await readFile(join(raiz, "instalador/dependencias.json"), "utf8")).replace('"formato": 1', '"formato": 2'));
  await expect(conferir(raiz, script)).rejects.toThrow();
});

test("Dado CLI, Quando confiro produção válida, inválida ou uso incorreto, Então os códigos impedem continuar o build", async () => {
  const { comandoConferirScript } = await import("../scripts/conferir-script-release");
  expect(await comandoConferirScript([script], raiz)).toBe(0);
  await writeFile(script, "script alterado");
  expect(await comandoConferirScript([script], raiz)).toBe(1);
  for (const args of [[], [script, "extra"], [join(raiz, "script.exe")]]) expect(await comandoConferirScript(args, raiz)).toBe(1);
});
