import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { comandoEmbutir, conferirEmbutidos, embutirInstalador, lerEmbutidos } from "../scripts/embutir-instalador";
import { capturarConsole } from "./apoio/console";
import { criarChave } from "./apoio/kit-atualizavel";

// Base mínima (decisão 1 do parecer de release): o build embute, nos dois instaladores, a menor versão do Anvilore que o
// instalador aceita reinstalar. O valor mora em instalador/base-minima (uma linha X.Y.Z) e entra pela região BASE_MINIMA.
// Sem valor SemVer válido o build recusa gerar; `--conferir` confere a região como confere o manifesto e a chave.

const raiz = resolve(import.meta.dir, "..");
const pastas: string[] = [];
afterAll(async () => { await Promise.all(pastas.map(p => rm(p, { recursive: true, force: true }))); });
async function pastaNova() { const p = await mkdtemp(join(tmpdir(), "anvilore-base-minima-")); pastas.push(p); return p; }
async function assinantesDescartaveis(): Promise<string> { return (await criarChave(await pastaNova())).assinantes; }
const modelo = (nome: "instalar.sh" | "instalar.ps1") => readFile(join(raiz, "instalador", nome), "utf8");
const manifesto = () => readFile(join(raiz, "instalador/dependencias.json"), "utf8");
const modeloSync = (nome: string) => readFileSync(join(raiz, "instalador", nome), "utf8");
const DIALETOS = [["sh", "instalar.sh"], ["ps1", "instalar.ps1"]] as const;

test.each(DIALETOS)("Dado o repositório, Quando leio instalador/base-minima, Então é uma única linha X.Y.Z provisória 0.3.0 (%s)", async () => {
  expect(await readFile(join(raiz, "instalador/base-minima"), "utf8")).toBe("0.3.0\n");
});

test.each(DIALETOS)("Dado o modelo do %s do repositório, Quando leio o que ele embute, Então a base mínima vem vazia (nada que pareça confiança)", async (dialeto, nome) => {
  expect(lerEmbutidos(await modelo(nome), dialeto)).toEqual({ manifesto: "", assinantes: "", baseMinima: "", urlConfianca: "" });
});

test.each(DIALETOS)("Dado o modelo do %s, Quando embuto manifesto, chave e base mínima, Então a cópia embutida é igual aos arquivos e confere", async (dialeto, nome) => {
  const assinantes = await assinantesDescartaveis();
  const pronto = embutirInstalador(await modelo(nome), await manifesto(), assinantes, "0.3.0\n", dialeto);
  expect(lerEmbutidos(pronto, dialeto).baseMinima).toBe("0.3.0\n");
  expect(conferirEmbutidos(pronto, await manifesto(), assinantes, "0.3.0\n", dialeto)).toEqual([]);
  expect(embutirInstalador(pronto, await manifesto(), assinantes, "0.3.0\n", dialeto)).toBe(pronto);
});

test("Dado a região no .sh e no .ps1, Quando embuto, Então cada dialeto usa a sua forma (função com heredoc / here-string)", async () => {
  const assinantes = await assinantesDescartaveis();
  const sh = embutirInstalador(await modelo("instalar.sh"), await manifesto(), assinantes, "1.2.3\n");
  const ps1 = embutirInstalador(await modelo("instalar.ps1"), await manifesto(), assinantes, "1.2.3\n", "ps1");
  expect(sh).toContain("base_minima_embutida() {\n  cat <<'ANVILORE_FIM_BASE_MINIMA'\n1.2.3\nANVILORE_FIM_BASE_MINIMA\n}");
  expect(ps1).toContain("$script:AnvBaseMinimaEmbutida = @'\n1.2.3\n'@");
});

test.each([
  ["vazia", ""],
  ["sem quebra de linha final", "0.3.0"],
  ["texto qualquer", "nova\n"],
  ["só major.minor", "0.3\n"],
  ["quatro números", "0.3.0.1\n"],
  ["com v na frente", "v0.3.0\n"],
  ["pré-release", "0.3.0-rc.1\n"],
  ["metadado de build", "0.3.0+abc\n"],
  ["zero à esquerda", "00.3.0\n"],
  ["duas linhas", "0.3.0\n0.4.0\n"],
  ["linha em branco antes", "\n0.3.0\n"],
  ["com espaço", " 0.3.0\n"],
  ["com retorno de carro", "0.3.0\r\n"],
])("Dado a base mínima %s, Quando embuto, Então recusa em vez de embutir um valor que não é SemVer X.Y.Z", async (_nome, valor) => {
  const assinantes = await assinantesDescartaveis();
  for (const [dialeto, nome] of DIALETOS) {
    expect(() => embutirInstalador(modeloSync(nome), JSON.stringify({ formato: 1, dependencias: {} }), assinantes, valor, dialeto)).toThrow("base mínima");
  }
});

test("Dado um script com outra base mínima, ou sem a região, Quando confiro, Então aponta a diferença", async () => {
  const assinantes = await assinantesDescartaveis();
  const pronto = embutirInstalador(await modelo("instalar.sh"), await manifesto(), assinantes, "0.3.0\n");
  expect(conferirEmbutidos(pronto, await manifesto(), assinantes, "0.4.0\n").join("\n")).toContain("base mínima embutida difere");
  expect(conferirEmbutidos(await modelo("instalar.sh"), await manifesto(), assinantes, "0.3.0\n").join("\n")).toContain("base mínima embutida difere");
  const ps1 = embutirInstalador(await modelo("instalar.ps1"), await manifesto(), assinantes, "0.3.0\n", "ps1");
  expect(conferirEmbutidos(ps1, await manifesto(), assinantes, "0.4.0\n", "ps1").join("\n")).toContain("base mínima embutida difere");
});

test("Dado a linha de comando, Quando gero e confiro com --base-minima, Então grava, confere e recusa adulteração ou arquivo inválido", async () => {
  const pasta = await pastaNova();
  const assinantes = join(pasta, "assinantes"), base = join(pasta, "base-minima"), saida = join(pasta, "instalar.sh");
  await writeFile(assinantes, await assinantesDescartaveis());
  await writeFile(base, "0.3.0\n");
  const rodar = (...args: string[]) => Bun.spawnSync([process.execPath, join(raiz, "scripts/embutir-instalador.ts"), ...args], { stdout: "pipe", stderr: "pipe" });
  const gerar = rodar("--assinantes", assinantes, "--base-minima", base, "--saida", saida);
  expect(gerar.exitCode, gerar.stderr.toString()).toBe(0);
  expect(rodar("--conferir", saida, "--assinantes", assinantes, "--base-minima", base).exitCode).toBe(0);
  // Sem --base-minima vale o arquivo do repositório (0.3.0): é o mesmo valor, então confere.
  expect(rodar("--conferir", saida, "--assinantes", assinantes).exitCode).toBe(0);
  // O arquivo do repositório muda depois de gerado: o conferir acusa.
  await writeFile(base, "0.4.0\n");
  const outra = rodar("--conferir", saida, "--assinantes", assinantes, "--base-minima", base);
  expect(outra.exitCode).toBe(1);
  expect(outra.stderr.toString()).toContain("base mínima embutida difere");
  // Adulteração direta no script gerado.
  await writeFile(base, "0.3.0\n");
  await writeFile(saida, (await readFile(saida, "utf8")).replace("\n0.3.0\nANVILORE_FIM_BASE_MINIMA", "\n0.0.1\nANVILORE_FIM_BASE_MINIMA"));
  expect(rodar("--conferir", saida, "--assinantes", assinantes, "--base-minima", base).exitCode).toBe(1);
  // Arquivo inválido ou ausente: não gera.
  await writeFile(base, "0.3.0-rc.1\n");
  const ruim = rodar("--assinantes", assinantes, "--base-minima", base, "--saida", join(pasta, "x.sh"));
  expect(ruim.exitCode).toBe(1);
  expect(ruim.stderr.toString()).toContain("base mínima");
  const ausente = rodar("--assinantes", assinantes, "--base-minima", join(pasta, "nao-existe"), "--saida", join(pasta, "y.sh"));
  expect(ausente.exitCode).toBe(1);
  expect(ausente.stderr.toString()).toContain("base mínima");
});

test("Dado a função da linha de comando com --modelo .ps1, Quando gero e confiro, Então a base mínima entra e é conferida nos dois dialetos", async () => {
  const pasta = await pastaNova();
  const assinantes = join(pasta, "assinantes"), base = join(pasta, "base-minima");
  await writeFile(assinantes, await assinantesDescartaveis());
  await writeFile(base, "2.0.1\n");
  const c = capturarConsole();
  try {
    for (const [dialeto, nome] of DIALETOS) {
      const saida = join(pasta, `instalar.${dialeto === "ps1" ? "ps1" : "sh"}`);
      expect(await comandoEmbutir(["--modelo", join(raiz, "instalador", nome), "--assinantes", assinantes, "--base-minima", base, "--saida", saida])).toBe(0);
      expect(lerEmbutidos(await readFile(saida, "utf8"), dialeto).baseMinima).toBe("2.0.1\n");
      expect(await comandoEmbutir(["--conferir", saida, "--assinantes", assinantes, "--base-minima", base])).toBe(0);
    }
    expect(c.saida.join("\n")).toContain("base mínima");
  } finally { c.restaurar(); }
});
