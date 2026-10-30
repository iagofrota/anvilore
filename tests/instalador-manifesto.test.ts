import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

// Cenário (PLANO §8, 33 e 36): o manifesto é a única fonte das dependências baixadas pelos instaladores.
// Dado instalador/dependencias.json; Quando confiro a forma de cada entrada; Então toda entrada tem URL oficial
// por https, SHA-256 de 64 hexadecimais e o executável dentro do arquivo.

const raiz = resolve(import.meta.dir, "..");
type Entrada = { arquivo: string; url: string; sha256: string; formato: string; executavel: string; tamanhoMB?: number };
type Manifesto = { formato: number; dependencias: Record<string, { versao: string; plataformas: Record<string, Entrada> }> };
const lerManifesto = async () => JSON.parse(await readFile(resolve(raiz, "instalador/dependencias.json"), "utf8")) as Manifesto;

const ORIGENS: Record<string, RegExp> = {
  bun: /^https:\/\/github\.com\/oven-sh\/bun\/releases\/download\/bun-v[^/]+\/[^/]+$/,
  rg: /^https:\/\/github\.com\/BurntSushi\/ripgrep\/releases\/download\/[^/]+\/[^/]+$/,
  portablegit: /^https:\/\/github\.com\/git-for-windows\/git\/releases\/download\/[^/]+\/[^/]+$/,
};

test("Dado o manifesto, Quando listo as dependências, Então há Bun, rg e PortableGit nas plataformas do plano", async () => {
  const m = await lerManifesto();
  expect(m.formato).toBe(1);
  expect(Object.keys(m.dependencias).sort()).toEqual(["bun", "portablegit", "rg"]);
  expect(Object.keys(m.dependencias.bun!.plataformas).sort()).toEqual(["linux-arm64", "linux-x64", "windows-x64", "windows-x64-baseline"]);
  expect(Object.keys(m.dependencias.rg!.plataformas).sort()).toEqual(["linux-arm64", "linux-x64", "windows-x64"]);
  expect(Object.keys(m.dependencias.portablegit!.plataformas)).toEqual(["windows-x64"]);
});

test("Dado cada entrada, Quando confiro URL, hash e arquivo, Então vem do release oficial com SHA-256 e nome coerente", async () => {
  const m = await lerManifesto();
  for (const [nome, dep] of Object.entries(m.dependencias)) {
    expect(dep.versao).toMatch(/^\d+\.\d+\.\d+(\.\d+)?$/);
    for (const [plataforma, e] of Object.entries(dep.plataformas)) {
      const onde = `${nome}/${plataforma}`;
      expect(e.url, onde).toMatch(ORIGENS[nome]!);
      expect(basename(e.url), onde).toBe(e.arquivo);
      expect(e.sha256, onde).toMatch(/^[0-9a-f]{64}$/);
      expect(["zip", "tar.gz", "7z-sfx"], onde).toContain(e.formato);
      expect(e.executavel, onde).not.toMatch(/^\/|\.\./);
      // Uma entrada por linha: o instalar.sh lê o manifesto com awk, sem jq nem Python.
    }
  }
});

test("Dado o manifesto e o package.json, Quando comparo o Bun, Então a versão baixada é a do packageManager", async () => {
  const m = await lerManifesto();
  const pacote = JSON.parse(await readFile(resolve(raiz, "package.json"), "utf8")) as { packageManager: string };
  expect(pacote.packageManager).toBe(`bun@${m.dependencias.bun!.versao}`);
});

test("Dado o manifesto, Quando leio o formato do arquivo, Então cada entrada ocupa uma linha (o instalar.sh lê com awk)", async () => {
  const texto = await readFile(resolve(raiz, "instalador/dependencias.json"), "utf8");
  const linhasDeEntrada = texto.split("\n").filter(l => /^ {8}"[a-z0-9-]+": \{ "arquivo":/.test(l));
  const m = await lerManifesto();
  const total = Object.values(m.dependencias).reduce((n, d) => n + Object.keys(d.plataformas).length, 0);
  expect(linhasDeEntrada.length).toBe(total);
  expect(texto.endsWith("}\n")).toBe(true);
});

test("Dado o PortableGit, Quando leio a entrada, Então informa o tamanho extraído para a tela do instalador", async () => {
  const m = await lerManifesto();
  expect(m.dependencias.portablegit!.plataformas["windows-x64"]!.tamanhoMB).toBe(392);
});
