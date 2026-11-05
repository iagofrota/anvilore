import { expect, test } from "bun:test";
import { caminhoDeRawIngerivelPeloBotao, caminhoTemMetacaracteres } from "../src/lib/caminho-raw";

test("Dado um caminho regular em raw/ Quando consulto ingerível pelo botão Então retorna true", () => {
  const normais = [
    "raw/pessoal/nota.md",
    "raw/solta.md",
    "raw/notas/captura-2026-11-04.md",
    "pessoal/pesquisa (2026).md",
    "artigo-completo.txt",
  ];
  for (const caminho of normais) {
    expect(caminhoDeRawIngerivelPeloBotao(caminho)).toBe(true);
    expect(caminhoTemMetacaracteres(caminho)).toBe(false);
  }
});

test("Dado um caminho contendo metacaracteres (* ? [ ] { } ! \\) Quando consulto ingerível pelo botão Então retorna false", () => {
  const caracteres = ["*", "?", "[", "]", "{", "}", "!", "\\"];
  for (const char of caracteres) {
    const caminho = `raw/pessoal/arquivo${char}.md`;
    expect(caminhoDeRawIngerivelPeloBotao(caminho)).toBe(false);
    expect(caminhoTemMetacaracteres(caminho)).toBe(true);
  }
});
