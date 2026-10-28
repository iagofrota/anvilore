import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LISTA_DO_RASTREIO, PASTA_MODELOS, copiarModelos, destinoDoModelo, ehExemplo, pecasDoModelo, planejarModelos } from "../src/lib/modelos";

const raiz = resolve(import.meta.dir, "..");
let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "anvilore-modelos-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

const ESTRUTURAIS = ["SCHEMA.md", "raw/.gitkeep", "wiki/.gitignore", "wiki/_meta/.gitkeep", "wiki/index.md", "wiki/log.md", "wiki/log/.gitkeep"];
const EXEMPLOS = ["raw/exemplo/llm-wiki.md", "wiki/exemplo/concepts/.gitkeep", "wiki/exemplo/concepts/area-tematica.md", "wiki/exemplo/entities/.gitkeep", "wiki/exemplo/sources/.gitkeep"];

test("Dado a pasta modelos/ do kit, Quando listo as peças, Então cobre exatamente a lista do U1 com o destino de cada uma", async () => {
  const pecas = await pecasDoModelo();
  expect(pecas.map(p => p.destino).sort()).toEqual([...ESTRUTURAIS, ...EXEMPLOS].sort());
  for (const p of pecas) expect(ehExemplo(p.destino)).toBe(EXEMPLOS.includes(p.destino));
  for (const destino of pecas.map(p => p.destino)) {
    expect(LISTA_DO_RASTREIO.some(item => destino === item || destino.startsWith(`${item}/`))).toBe(true);
  }
});

test("Dado um caminho em modelos/, Quando mapeio para o destino, Então fontes/ vira raw/ e wiki/gitignore vira wiki/.gitignore", () => {
  expect(destinoDoModelo("fontes/exemplo/llm-wiki.md")).toBe("raw/exemplo/llm-wiki.md");
  expect(destinoDoModelo("fontes/.gitkeep")).toBe("raw/.gitkeep");
  expect(destinoDoModelo("wiki/gitignore")).toBe("wiki/.gitignore");
  expect(destinoDoModelo("wiki/index.md")).toBe("wiki/index.md");
  expect(destinoDoModelo("SCHEMA.md")).toBe("SCHEMA.md");
});

test("Dado o kit na versão que ainda rastreia, Quando comparo modelos/ com os originais, Então o conteúdo é idêntico byte a byte", async () => {
  for (const p of await pecasDoModelo()) {
    const original = join(raiz, p.destino);
    if (existsSync(original)) expect(readFileSync(p.origem)).toEqual(readFileSync(original));
  }
});

test("Dado uma pasta vazia, Quando copio os modelos com exemplo para instalação nova, Então cria tudo", async () => {
  const r = await copiarModelos(tmp, { exemplo: true });
  expect(r.criados.sort()).toEqual([...ESTRUTURAIS, ...EXEMPLOS].sort());
  expect(readFileSync(join(tmp, "wiki/index.md"))).toEqual(readFileSync(join(PASTA_MODELOS, "wiki/index.md")));
  expect(readFileSync(join(tmp, "raw/exemplo/llm-wiki.md"))).toEqual(readFileSync(join(PASTA_MODELOS, "fontes/exemplo/llm-wiki.md")));
});

test("Dado SCHEMA.md e wiki/index.md editados pela pessoa, Quando copio os modelos, Então nada é sobrescrito", async () => {
  writeFileSync(join(tmp, "SCHEMA.md"), "MEU SCHEMA");
  mkdirSync(join(tmp, "wiki")); writeFileSync(join(tmp, "wiki/index.md"), "MEU ÍNDICE");
  const r = await copiarModelos(tmp, { exemplo: true });
  expect(readFileSync(join(tmp, "SCHEMA.md"), "utf8")).toBe("MEU SCHEMA");
  expect(readFileSync(join(tmp, "wiki/index.md"), "utf8")).toBe("MEU ÍNDICE");
  expect(r.existentes).toEqual(expect.arrayContaining(["SCHEMA.md", "wiki/index.md"]));
  expect(r.criados).not.toContain("SCHEMA.md");
});

test("Dado que a pessoa apagou wiki/exemplo e raw/exemplo, Quando copio de novo os modelos, Então os exemplos não voltam e o estrutural que falta volta", async () => {
  await copiarModelos(tmp, { exemplo: true });
  rmSync(join(tmp, "wiki/exemplo"), { recursive: true }); rmSync(join(tmp, "raw/exemplo"), { recursive: true });
  rmSync(join(tmp, "wiki/log.md"));
  const r = await copiarModelos(tmp, { exemplo: true });
  expect(r.criados).toEqual(["wiki/log.md"]);
  expect(existsSync(join(tmp, "wiki/exemplo"))).toBe(false);
  expect(existsSync(join(tmp, "raw/exemplo"))).toBe(false);
});

test("Dado wiki/ existente e raw/ ausente, Quando copio com exemplo, Então só o exemplo de raw/ nasce", async () => {
  mkdirSync(join(tmp, "wiki"));
  const r = await copiarModelos(tmp, { exemplo: true });
  expect(r.criados.filter(ehExemplo)).toEqual(["raw/exemplo/llm-wiki.md"]);
});

test("Dado pedido sem exemplo, Quando copio numa pasta vazia, Então só o estrutural nasce", async () => {
  const r = await copiarModelos(tmp, { exemplo: false });
  expect(r.criados.sort()).toEqual([...ESTRUTURAIS].sort());
  const indice = readFileSync(join(tmp, "wiki/index.md"), "utf8");
  expect(indice).not.toContain("## Área: exemplo");
  expect(indice).not.toContain("[[area-tematica]]");
});

test("Dado simulação, Quando planejo, Então devolve o que seria criado sem escrever nada", async () => {
  const plano = await planejarModelos(tmp, { exemplo: true });
  expect(plano.copiar.length).toBe(ESTRUTURAIS.length + EXEMPLOS.length);
  expect(existsSync(join(tmp, "wiki"))).toBe(false);
});

test("Dado um kit sem modelos/, Quando listo as peças, Então reprova dizendo o que falta em vez de inventar conteúdo", async () => {
  await expect(pecasDoModelo(join(tmp, "nao-existe"))).rejects.toThrow("modelos");
});

test("Dado um caminho de destino ocupado por diretório, Quando copio, Então reprova sem apagar o diretório", async () => {
  mkdirSync(join(tmp, "wiki/index.md"), { recursive: true });
  writeFileSync(join(tmp, "wiki/index.md/dentro"), "x");
  const r = await copiarModelos(tmp, { exemplo: false });
  expect(r.existentes).toContain("wiki/index.md");
  expect(readFileSync(join(tmp, "wiki/index.md/dentro"), "utf8")).toBe("x");
});
