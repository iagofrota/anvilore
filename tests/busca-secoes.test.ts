import { expect, test } from "bun:test";
import { secoesDe } from "../src/busca/secoes";

test("Dado heading ## seguido de ###, Quando divide a página, Então as seções são planas e sem sobreposição", () => {
  const secoes = secoesDe("## Uma\na\n### Duas\nb\n", "Página");
  expect(secoes.map((s) => [s.secao, s.linhaInicio, s.linhaFim])).toEqual([["Uma", 1, 2], ["Duas", 3, 4]]);
});

test("Dado headings em fences de crase e til, Quando divide, Então headings cercados não abrem seção", () => {
  const secoes = secoesDe("```md\n## ignorado\n```\n~~~\n### também ignorado\n~~~\n## real\ntexto", "P");
  expect(secoes.map((s) => s.secao)).toEqual(["P", "real"]);
});

test("Dado headings H4 e H5, Quando divide, Então só até H4 abrem seção", () => {
  const secoes = secoesDe("#### válido\n##### ignorado\ntexto", "P");
  expect(secoes.map((s) => s.secao)).toEqual(["válido"]);
  expect(secoes[0]?.corpo).toContain("##### ignorado");
});

test("Dado texto introdutório, Quando há heading, Então vira seção anterior; introdução vazia é omitida", () => {
  expect(secoesDe("intro\n## T\ncorpo", "P").map((s) => s.secao)).toEqual(["P", "T"]);
  expect(secoesDe("## T\ncorpo", "P").map((s) => s.secao)).toEqual(["T"]);
});

test("Dado frontmatter de cinco linhas, Quando lê heading, Então linha inicial conta arquivo inteiro", () => {
  const secoes = secoesDe("---\na: b\nc: d\ne: f\n---\nintro\n## T\ntexto", "P");
  expect(secoes.map((s) => s.linhaInicio)).toEqual([6, 7]);
  expect(secoes[0]?.corpo).toBe("intro");
});

test("Dado BOM e CRLF, Quando divide, Então normaliza sem deslocar linhas", () => {
  const secoes = secoesDe("\uFEFF---\r\na: b\r\n---\r\n## T\r\nx\r\n", "P");
  expect(secoes[0]?.linhaInicio).toBe(4);
  expect(secoes[0]?.linhaFim).toBe(5);
});

test("Dado callouts gap e contradiction, Quando divide, Então emite avisos normalizados", () => {
  const secoes = secoesDe("## A\n> [!gap]\nx\n## B\n> [!contradiction]\ny", "P");
  expect(secoes.map((s) => s.avisos)).toEqual([["lacuna"], ["contradicao"]]);
});
