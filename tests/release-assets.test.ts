import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { criarChave } from "./apoio/kit-atualizavel";
import { embutirInstalador } from "../scripts/embutir-instalador";
import { comandoMontarAssets, montarAssets } from "../scripts/montar-assets-release";
import { capturarConsole } from "./apoio/console";

let pasta: string, raiz: string, dist: string, assinantes: string;
const repo = resolve(import.meta.dir, "..");
async function capturar(rodar: () => Promise<number>) {
  const c = capturarConsole();
  try { return { codigo: await rodar(), erro: c.erros }; }
  finally { c.restaurar(); }
}
beforeEach(async () => {
  pasta = await mkdtemp(join(tmpdir(), "anvilore-assets-")); raiz = join(pasta, "repo"); dist = join(pasta, "dist");
  await mkdir(join(raiz, "instalador"), { recursive: true }); await mkdir(join(raiz, "seguranca")); await mkdir(dist);
  const chave = await criarChave(pasta); assinantes = chave.assinantes;
  const manifesto = await readFile(join(repo, "instalador/dependencias.json"), "utf8");
  await writeFile(join(raiz, "instalador/dependencias.json"), manifesto);
  await writeFile(join(raiz, "instalador/base-minima"), "0.3.0\n");
  await writeFile(join(raiz, "seguranca/assinantes"), assinantes);
  for (const dialeto of ["sh", "ps1"] as const) {
    const modelo = await readFile(join(repo, `instalador/instalar.${dialeto}`), "utf8");
    await writeFile(join(raiz, `instalador/instalar.${dialeto}`), modelo);
    const arquivo = join(dist, `instalar.${dialeto}`);
    await writeFile(arquivo, embutirInstalador(modelo, manifesto, assinantes, "0.3.0\n", dialeto));
    const p = Bun.spawnSync(["ssh-keygen", "-Y", "sign", "-f", chave.chave, "-n", "file", arquivo], { stdout: "pipe", stderr: "pipe" });
    if (p.exitCode) throw new Error("Não assinou fixture");
  }
  for (const nome of ["AnviloreSetup.exe", "anvilore.deb", "anvilore.rpm"]) await writeFile(join(dist, nome), "abc");
});
afterEach(async () => { await rm(pasta, { recursive: true, force: true }); });

test("Dado pacotes e scripts autenticados, Quando monto assets, Então hashes são portáteis e cobrem o conjunto completo", async () => {
  const arquivos = await montarAssets(raiz, dist, assinantes);
  expect(arquivos.sort()).toEqual(["AnviloreSetup.exe", "SHA256SUMS", "anvilore.deb", "anvilore.rpm", "instalar.ps1", "instalar.ps1.sha256", "instalar.ps1.sig", "instalar.sh", "instalar.sh.sha256", "instalar.sh.sig"].sort());
  const hashes = await readFile(join(dist, "SHA256SUMS"), "utf8");
  expect(hashes.split("\n")).toContain("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  anvilore.deb");
  expect(hashes).not.toContain(pasta);
  // O CI Windows não precisa de sha256sum: o verificador só é exercitado no sistema que o oferece.
  if (process.platform === "linux") {
    const conferir = Bun.spawnSync(["sha256sum", "-c", "SHA256SUMS"], { cwd: dist, stdout: "pipe", stderr: "pipe" });
    expect(conferir.exitCode).toBe(0);
  }
});
test("Dado pacote ausente, Quando monto assets, Então falho antes de gerar hashes", async () => {
  await rm(join(dist, "anvilore.rpm"));
  await expect(montarAssets(raiz, dist, assinantes)).rejects.toThrow("anvilore.rpm");
  expect(existsSync(join(dist, "SHA256SUMS"))).toBe(false);
});
test("Dado manifesto embutido alterado, Quando monto assets, Então recuso mesmo que a assinatura seja válida para os bytes antigos", async () => {
  const arquivo = join(dist, "instalar.sh");
  await writeFile(arquivo, (await readFile(arquivo, "utf8")).replace('"formato": 1', '"formato": 2'));
  await expect(montarAssets(raiz, dist, assinantes)).rejects.toThrow("instalar.sh");
});
test("Dado assinatura inválida ou ausente, Quando monto assets, Então hashes não substituem autenticidade", async () => {
  await writeFile(join(dist, "instalar.ps1.sig"), "não é uma assinatura");
  await expect(montarAssets(raiz, dist, assinantes)).rejects.toThrow("assinatura");
  expect(existsSync(join(dist, "SHA256SUMS"))).toBe(false);
});
test("Dado corpo do script alterado fora das regiões, Quando monto assets, Então a conferência recusa", async () => {
  const arquivo = join(dist, "instalar.sh");
  await writeFile(arquivo, (await readFile(arquivo, "utf8")) + "\necho adulterado\n");
  await expect(montarAssets(raiz, dist, assinantes)).rejects.toThrow("instalar.sh");
});
test("Dado chave de outra origem, Quando monto assets, Então assinaturas válidas porém não confiáveis são recusadas", async () => {
  const outraPasta = join(pasta, "outra"); await mkdir(outraPasta);
  const outra = await criarChave(outraPasta);
  await expect(montarAssets(raiz, dist, outra.assinantes)).rejects.toThrow("assinatura");
});
test("Dado CLI sem versão anterior ou com argumentos extras, Quando invoco o montador, Então devolvo uso inválido sem gerar hashes", async () => {
  for (const args of [[], [dist], [dist, "v0.3.0", "extra"]]) {
    const r = await capturar(() => comandoMontarAssets(args));
    expect(r.codigo).toBe(2);
    expect(r.erro.join("\n")).toContain("Uso:");
  }
  expect(existsSync(join(dist, "SHA256SUMS"))).toBe(false);
});
test("Dado CLI com âncora inexistente, Quando invoco o montador, Então devolvo erro sem baixar confiança nem gerar hashes", async () => {
  const r = await capturar(() => comandoMontarAssets([dist, "v999999999.0.0"]));
  expect(r.codigo).toBe(1);
  expect(r.erro.join("\n")).toContain("Âncora da versão anterior ausente");
  expect(existsSync(join(dist, "SHA256SUMS"))).toBe(false);
});
