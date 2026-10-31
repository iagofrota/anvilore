import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const carregar = () => import("../scripts/criar-rascunho-release");
const nomes = ["AnviloreSetup.exe", "anvilore.deb", "anvilore.rpm", "instalar.sh", "instalar.ps1", "instalar.sh.sig", "instalar.ps1.sig", "instalar.sh.sha256", "instalar.ps1.sha256"];
let raiz: string, pasta: string;
beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "anv-rascunho-")); pasta = join(raiz, "assets"); await mkdir(pasta);
  await writeFile(join(raiz, "package.json"), JSON.stringify({ version: "0.3.1" }));
  await writeFile(join(pasta, "NOTAS.md"), "- Instalar sem terminal.\n");
  const linhas = [];
  for (const nome of nomes) {
    await writeFile(join(pasta, nome), nome);
    linhas.push(`${createHash("sha256").update(nome).digest("hex")}  ${nome}\n`);
  }
  await writeFile(join(pasta, "SHA256SUMS"), linhas.sort().join(""));
});
afterEach(async () => { await rm(raiz, { recursive: true, force: true }); });
test("Dado assets completos, Quando simulo o rascunho, Então não executo GitHub e os argumentos exigem draft e tag existente", async () => {
  const { prepararRascunho } = await carregar();
  const args = await prepararRascunho(raiz, pasta, "v0.3.1");
  expect(args.slice(0, 4)).toEqual(["gh", "release", "create", "v0.3.1"]);
  expect(args).toContain("--draft"); expect(args).toContain("--verify-tag");
  expect(args).toContain("iagofrota/anvilore");
  expect(args).not.toContain("--prerelease");
  for (const nome of [...nomes, "SHA256SUMS"]) expect(args).toContain(join(pasta, nome));
});
test("Dado sufixo SemVer, Quando preparo o rascunho, Então marco pré-release e recuso versão diferente do pacote", async () => {
  const { prepararRascunho } = await carregar();
  await writeFile(join(raiz, "package.json"), JSON.stringify({ version: "0.3.1-rc.1" }));
  expect(await prepararRascunho(raiz, pasta, "v0.3.1-rc.1")).toContain("--prerelease");
  await expect(prepararRascunho(raiz, pasta, "v0.3.1")).rejects.toThrow("versão");
  await expect(prepararRascunho(raiz, pasta, "--target=main")).rejects.toThrow("versão");
});
test("Dado pacote removido, hash adulterado ou assinatura ausente, Quando preparo, Então nenhuma chamada pública é preparada", async () => {
  const { prepararRascunho } = await carregar();
  await writeFile(join(pasta, "anvilore.deb"), "adulterado");
  await expect(prepararRascunho(raiz, pasta, "v0.3.1")).rejects.toThrow("SHA-256");
  await writeFile(join(pasta, "anvilore.deb"), "anvilore.deb");
  await rm(join(pasta, "instalar.ps1.sig"));
  await expect(prepararRascunho(raiz, pasta, "v0.3.1")).rejects.toThrow();
});
test("Dado checksum com item omitido ou extra, Quando preparo, Então exijo o conjunto fechado da distribuição", async () => {
  const { prepararRascunho } = await carregar();
  const sums = await readFile(join(pasta, "SHA256SUMS"), "utf8");
  for (const invalido of [sums.split("\n").slice(1).join("\n"), sums + `${'0'.repeat(64)}  surpresa.exe\n`]) {
    await writeFile(join(pasta, "SHA256SUMS"), invalido);
    await expect(prepararRascunho(raiz, pasta, "v0.3.1")).rejects.toThrow("SHA256SUMS");
  }
});

test("Dado CLI sem --criar, Quando executo, Então nenhuma chamada ao GitHub acontece; contexto inválido também recusa escrita", async () => {
  const { comandoRascunho } = await carregar();
  const chamadas: string[][] = [];
  const opcoes = { raiz, executar: (args: string[]) => { chamadas.push(args); return 0; }, ambiente: {} };
  expect(await comandoRascunho(["--tag", "v0.3.1", "--pasta", pasta], opcoes)).toBe(0);
  expect(chamadas).toHaveLength(0);
  expect(await comandoRascunho(["--tag", "v0.3.1", "--pasta", pasta, "--criar"], opcoes)).toBe(1);
  expect(chamadas).toHaveLength(0);
  expect(await comandoRascunho(["--inesperado"], opcoes)).toBe(1);
});
test("Dado contexto autorizado de tag e executor falso, Quando crio o rascunho, Então executo só create draft e propago falha do GitHub", async () => {
  const { comandoRascunho } = await carregar();
  const chamadas: string[][] = [];
  const ambiente = { GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v0.3.1", GITHUB_REPOSITORY: "iagofrota/anvilore" };
  const args = ["--tag", "v0.3.1", "--pasta", pasta, "--criar"];
  expect(await comandoRascunho(args, { raiz, ambiente, executar: a => { chamadas.push(a); return 0; } })).toBe(0);
  expect(chamadas).toHaveLength(1); expect(chamadas[0]).toContain("--draft");
  expect(await comandoRascunho(args, { raiz, ambiente, executar: () => 1 })).toBe(1);
});
