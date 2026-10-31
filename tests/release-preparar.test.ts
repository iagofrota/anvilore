import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { criarChave } from "./apoio/kit-atualizavel";
import { prepararRelease } from "../scripts/lancar";

let pasta: string, raiz: string, saida: string;
beforeEach(async () => {
  pasta = await mkdtemp(join(tmpdir(), "anvilore-preparar-")); raiz = join(pasta, "repo"); saida = join(pasta, "dist");
  await mkdir(raiz); await mkdir(join(raiz, "seguranca"));
  await cp(resolve(import.meta.dir, "../instalador"), join(raiz, "instalador"), { recursive: true });
  await writeFile(join(raiz, "seguranca/assinantes"), (await criarChave(pasta)).assinantes);
  await writeFile(join(raiz, "package.json"), JSON.stringify({ version: "0.3.1" }));
  await writeFile(join(raiz, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n\n## [0.3.1] - 2026-10-31\n\n### Added\n\n- Pacotes para instalar.\n\n## [0.3.0] - 2026-10-30\n\n- Antigo.\n");
});
afterEach(async () => { await rm(pasta, { recursive: true, force: true }); });

test("Dado preparo sem flag de escrita, Quando executo, Então mostro os arquivos e notas sem criar diretório", async () => {
  const plano = await prepararRelease(raiz, "0.3.1", saida);
  expect(plano.arquivos).toEqual(["instalar.sh", "instalar.ps1", "NOTAS.md"]);
  expect(plano.notas).toContain("- Pacotes para instalar.");
  expect(plano.notas).not.toContain("Antigo");
  expect(existsSync(saida)).toBe(false);
});
test("Dado preparo explícito, Quando executo, Então gero só scripts de produção e notas sem assinar nem publicar", async () => {
  await prepararRelease(raiz, "0.3.1", saida, true);
  expect((await readdir(saida)).sort()).toEqual(["NOTAS.md", "instalar.ps1", "instalar.sh"]);
  const script = await readFile(join(saida, "instalar.sh"), "utf8");
  expect(script).toContain("https://anvilore.iagofrota.com.br/confianca.json");
  expect(script).toContain("0.3.0\nANVILORE_FIM_BASE_MINIMA");
  expect(await readFile(join(raiz, "instalador/base-minima"), "utf8")).toBe("0.3.0\n");
});
test("Dado versão divergente ou sem seção, Quando preparo, Então falho sem escrever", async () => {
  await expect(prepararRelease(raiz, "0.3.2", saida, true)).rejects.toThrow("package.json");
  await writeFile(join(raiz, "CHANGELOG.md"), "## [Unreleased]\n- Futuro\n");
  await expect(prepararRelease(raiz, "0.3.1", saida, true)).rejects.toThrow("CHANGELOG");
  expect(existsSync(saida)).toBe(false);
});
test("Dado arquivo existente na saída, Quando preparo, Então recuso sobrescrever assinaturas ou artefatos anteriores", async () => {
  await mkdir(saida); await writeFile(join(saida, "instalar.sh"), "anterior");
  await expect(prepararRelease(raiz, "0.3.1", saida, true)).rejects.toThrow("já existe");
  expect(await readFile(join(saida, "instalar.sh"), "utf8")).toBe("anterior");
});

test("Dado assinaturas públicas alteradas, Quando gero os scripts de novo, Então os bytes de produção não dependem delas", async () => {
  await mkdir(join(raiz, "instalador/assinaturas"), { recursive: true });
  const assinatura = join(raiz, "instalador/assinaturas/instalar.sh.sig");
  await writeFile(assinatura, "primeira assinatura pública");
  await prepararRelease(raiz, "0.3.1", saida, true);
  await writeFile(assinatura, "segunda assinatura pública");
  const outraSaida = join(pasta, "outro-preparo");
  await prepararRelease(raiz, "0.3.1", outraSaida, true);
  for (const nome of ["instalar.sh", "instalar.ps1"]) {
    expect(await readFile(join(saida, nome), "utf8")).toBe(await readFile(join(outraSaida, nome), "utf8"));
  }
});
