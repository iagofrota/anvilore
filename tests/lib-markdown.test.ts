import { describe, expect, test } from "bun:test";
import { linhasVisiveis } from "../src/lib/markdown";

describe("linhasVisiveis: cercas de código", () => {
  test("Dado uma cerca de 4 crases com uma linha de 3 crases dentro, Quando filtro, Então a de 3 não fecha e o texto depois da de 4 fica visível", () => {
    const entrada = ["````markdown", "```", "interno", "````", "[x](a.md)"];
    expect(linhasVisiveis(entrada)).toEqual(["", "", "", "", "[x](a.md)"]);
  });

  test("Dado uma cerca de 3 crases com uma linha de 4 crases, Quando filtro, Então 4 fecha (comprimento maior basta)", () => {
    expect(linhasVisiveis(["```", "interno", "````", "fora"])).toEqual(["", "", "", "fora"]);
  });

  test("Dado uma cerca de 4 tils com uma linha de 3 tils dentro, Quando filtro, Então a de 3 não fecha", () => {
    const entrada = ["~~~~", "~~~", "interno", "~~~~", "fora"];
    expect(linhasVisiveis(entrada)).toEqual(["", "", "", "", "fora"]);
  });

  test("Dado uma cerca de tils com crases dentro, Quando filtro, Então as crases não fecham (caractere diferente)", () => {
    expect(linhasVisiveis(["~~~", "```", "interno", "~~~", "fora"])).toEqual(["", "", "", "", "fora"]);
  });

  test("Dado uma cerca de crases com tils dentro, Quando filtro, Então os tils não fecham", () => {
    expect(linhasVisiveis(["```", "~~~", "interno", "```", "fora"])).toEqual(["", "", "", "", "fora"]);
  });

  test("Dado uma linha de fechamento com texto depois, Quando filtro, Então ela não fecha a cerca", () => {
    const entrada = ["```", "``` texto", "ainda dentro", "```", "fora"];
    expect(linhasVisiveis(entrada)).toEqual(["", "", "", "", "fora"]);
  });

  test("Dado um fechamento com espaços depois, Quando filtro, Então ele fecha", () => {
    expect(linhasVisiveis(["```", "interno", "```   ", "fora"])).toEqual(["", "", "", "fora"]);
  });

  test("Dado um fechamento de tils com texto depois, Quando filtro, Então ele não fecha", () => {
    expect(linhasVisiveis(["~~~", "~~~ x", "dentro", "~~~", "fora"])).toEqual(["", "", "", "", "fora"]);
  });

  test("Dado uma cerca sem fechamento, Quando filtro, Então o resto do arquivo é código", () => {
    expect(linhasVisiveis(["antes", "````", "```", "resto"])).toEqual(["antes", "", "", ""]);
  });

  test("Dado uma abertura de crases com crase no texto de informação, Quando filtro, Então não é cerca (é código em linha)", () => {
    expect(linhasVisiveis(["```js`x`", "visível"])).toEqual(["```js`x`", "visível"]);
  });

  test("Dado uma abertura de tils com crase no texto de informação, Quando filtro, Então ainda é cerca", () => {
    expect(linhasVisiveis(["~~~ `x`", "interno", "~~~", "fora"])).toEqual(["", "", "", "fora"]);
  });

  test("Dado uma cerca indentada, Quando filtro, Então abre e fecha com a mesma regra", () => {
    expect(linhasVisiveis(["  ````", "  ```", "  ````", "fora"])).toEqual(["", "", "", "fora"]);
  });

  test("Dado um bloco de 4 crases dentro de outro de 4 tils, Quando filtro, Então o texto depois do fechamento aparece", () => {
    const entrada = ["~~~~~text", "````markdown", "```", "````", "[x](a.md)", "~~~~~", "fora"];
    expect(linhasVisiveis(entrada)).toEqual(["", "", "", "", "", "", "fora"]);
  });
});
