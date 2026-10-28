import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isoComOffset } from "../src/lib/hora";
import { areasDaWiki, ErroDeFonte, nomeSeguro, salvarFonte } from "../src/lib/ui-fonte";

let raiz: string;
beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "anvilore-fonte-"));
  for (const dir of ["wiki/pessoal/sources", "wiki/trabalho/concepts", "wiki/exemplo/sources", "wiki/_meta", "wiki/log", "wiki/.obsidian"]) mkdirSync(join(raiz, dir), { recursive: true });
  writeFileSync(join(raiz, "wiki/index.md"), "# Índice\n");
});
afterEach(() => rmSync(raiz, { recursive: true, force: true }));

test("Dado uma wiki com áreas, exemplo e diretórios reservados Quando listo as áreas Então só as áreas da pessoa aparecem, em ordem", async () => {
  expect(await areasDaWiki(join(raiz, "wiki"))).toEqual(["pessoal", "trabalho"]);
});

test("Dado uma wiki plana ou inexistente Quando listo as áreas Então a lista é vazia", async () => {
  const plana = join(raiz, "plana");
  mkdirSync(join(plana, "sources"), { recursive: true });
  expect(await areasDaWiki(plana)).toEqual([]);
  expect(await areasDaWiki(join(raiz, "nao-existe"))).toEqual([]);
});

test("Dado um arquivo solto com a área pessoal Quando confirmo Então o servidor grava em raw/pessoal/<nome>", async () => {
  const salvo = await salvarFonte(raiz, { area: "pessoal", nome: "llm-wiki.md", conteudo: new TextEncoder().encode("# LLM Wiki\n") });
  expect(salvo).toEqual({ fonte: "raw/pessoal/llm-wiki.md", bytes: 11 });
  expect(readFileSync(join(raiz, "raw/pessoal/llm-wiki.md"), "utf8")).toBe("# LLM Wiki\n");
});

test("Dado um nome que já existe em raw/ Quando gravo de novo Então ganha sufixo e o original fica intacto", async () => {
  mkdirSync(join(raiz, "raw/pessoal"), { recursive: true });
  writeFileSync(join(raiz, "raw/pessoal/nota.md"), "original");
  writeFileSync(join(raiz, "raw/pessoal/nota-2.md"), "segunda");
  const salvo = await salvarFonte(raiz, { area: "pessoal", nome: "nota.md", conteudo: new TextEncoder().encode("nova") });
  expect(salvo.fonte).toBe("raw/pessoal/nota-3.md");
  expect(readFileSync(join(raiz, "raw/pessoal/nota.md"), "utf8")).toBe("original");
  expect(readFileSync(join(raiz, "raw/pessoal/nota-2.md"), "utf8")).toBe("segunda");
  expect(readFileSync(join(raiz, "raw/pessoal/nota-3.md"), "utf8")).toBe("nova");
  const semExtensao = await salvarFonte(raiz, { area: "pessoal", nome: "nota", conteudo: new Uint8Array([1]) });
  const outra = await salvarFonte(raiz, { area: "pessoal", nome: "nota", conteudo: new Uint8Array([2]) });
  expect([semExtensao.fonte, outra.fonte]).toEqual(["raw/pessoal/nota", "raw/pessoal/nota-2"]);
});

test("Dado gravações simultâneas com o mesmo nome Quando chegam juntas Então nenhuma sobrescreve a outra", async () => {
  const conteudos = Array.from({ length: 6 }, (_, i) => new TextEncoder().encode(`versão ${i}`));
  const salvos = await Promise.all(conteudos.map(conteudo => salvarFonte(raiz, { area: "pessoal", nome: "igual.md", conteudo })));
  expect(new Set(salvos.map(s => s.fonte)).size).toBe(6);
  const lidos = readdirSync(join(raiz, "raw/pessoal")).map(nome => readFileSync(join(raiz, "raw/pessoal", nome), "utf8")).sort();
  expect(lidos).toEqual(conteudos.map(c => new TextDecoder().decode(c)).sort());
});

test("Dado área que não existe na wiki ou com caminho Quando gravo Então recuso sem criar nada em raw/", async () => {
  for (const area of ["inventada", "../fora", "pessoal/../../x", "_meta", "exemplo", ""]) {
    await expect(salvarFonte(raiz, { area, nome: "x.md", conteudo: new Uint8Array([1]) })).rejects.toBeInstanceOf(ErroDeFonte);
  }
  expect(() => readdirSync(join(raiz, "raw"))).toThrow();
});

test("Dado wiki sem áreas Quando gravo sem área Então a fonte vai direto para raw/", async () => {
  rmSync(join(raiz, "wiki"), { recursive: true });
  mkdirSync(join(raiz, "wiki/sources"), { recursive: true });
  expect((await salvarFonte(raiz, { area: "", nome: "a.md", conteudo: new Uint8Array([65]) })).fonte).toBe("raw/a.md");
  await expect(salvarFonte(raiz, { area: "pessoal", nome: "a.md", conteudo: new Uint8Array([65]) })).rejects.toThrow("área");
});

test("Dado conteúdo vazio Quando gravo Então recuso", async () => {
  await expect(salvarFonte(raiz, { area: "pessoal", nome: "a.md", conteudo: new Uint8Array() })).rejects.toThrow("vazia");
});

test("Dado nomes perigosos ou estranhos Quando normalizo Então sai um nome de arquivo simples e seguro em qualquer sistema", () => {
  expect(nomeSeguro("../../etc/passwd")).toBe("passwd");
  expect(nomeSeguro("C:\\Users\\ana\\nota.md")).toBe("nota.md");
  expect(nomeSeguro('a<b>c:d"e|f?g*h.md')).toBe("a-b-c-d-e-f-g-h.md");
  expect(nomeSeguro("..")).toBe("fonte");
  expect(nomeSeguro("   ")).toBe("fonte");
  expect(nomeSeguro(".oculto.md")).toBe("oculto.md");
  expect(nomeSeguro("fim. ")).toBe("fim");
  expect(nomeSeguro("nul.txt")).toBe("_nul.txt");
  expect(nomeSeguro("con")).toBe("_con");
  expect(nomeSeguro("tab\tcontrole\u0001.md")).toBe("tab-controle-.md");
  expect(nomeSeguro("Cafe\u0301.md")).toBe("Café.md");
  expect(nomeSeguro(`${"a".repeat(300)}.markdown`)).toBe(`${"a".repeat(111)}.markdown`);
});

test("Dado uma data Quando formato com offset Então sai ISO com segundos e o fuso local explícito", () => {
  const texto = isoComOffset(new Date(2026, 9, 28, 9, 5, 7));
  expect(texto).toMatch(/^2026-10-28T09:05:07[+-]\d{2}:\d{2}$/);
  expect(new Date(texto).getTime()).toBe(new Date(2026, 9, 28, 9, 5, 7).getTime());
});
