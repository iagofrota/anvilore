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

describe("linhasVisiveis: comentário HTML e código em linha", () => {
  test("Dado `<!--` dentro de código em linha, Quando filtro, Então a linha seguinte continua visível e o código é mantido", () => {
    const entrada = ["Use `<!--` para abrir comentário.", "[Quebrado](nao-existe.md)"];
    expect(linhasVisiveis(entrada)).toEqual(["Use `<!--` para abrir comentário.", "[Quebrado](nao-existe.md)"]);
  });

  test("Dado um comentário real aberto numa linha, Quando a linha seguinte tem `-->` entre crases, Então o `-->` fecha o comentário (código em linha não existe dentro de comentário)", () => {
    const entrada = ["<!-- abre", "texto `-->` depois", "[x](a.md)"];
    expect(linhasVisiveis(entrada)).toEqual(["", "` depois", "[x](a.md)"]);
  });

  test("Dado crases de comprimentos diferentes, Quando o span abre com duas, Então ele vai até a sequência de duas e o `<!--` no meio não abre comentário", () => {
    const entrada = ["``a ` <!-- b`` fim", "[x](a.md)"];
    expect(linhasVisiveis(entrada)).toEqual(["``a ` <!-- b`` fim", "[x](a.md)"]);
  });

  test("Dado uma abertura de duas crases sem sequência de duas para fechar, Quando há `<!--` depois, Então as crases são texto e o comentário abre", () => {
    expect(linhasVisiveis(["``<!--`", "[x](a.md)"])).toEqual(["``", ""]);
  });

  test("Dado uma crase solta antes de um span de uma crase com `<!--`, Quando filtro, Então o span pareia com a crase seguinte e protege o `<!--`", () => {
    expect(linhasVisiveis(["`` a ` <!-- b`", "[x](a.md)"])).toEqual(["`` a ` <!-- b`", "[x](a.md)"]);
  });

  test("Dado um comentário HTML fechado numa linha com código em linha, Quando filtro, Então o comentário some e o código fica", () => {
    expect(linhasVisiveis(["`a` <!-- c --> `b`"])).toEqual(["`a`  `b`"]);
  });

  test("Dado um comentário que abre depois de código em linha, Quando ele atravessa linhas, Então o miolo some e o resto da última linha, com seu código, fica", () => {
    const entrada = ["`a` <!-- aberto", "oculto `x", "--> `b` fim"];
    expect(linhasVisiveis(entrada)).toEqual(["`a` ", "", " `b` fim"]);
  });

  test("Dado uma crase dentro de comentário HTML, Quando o comentário fecha na mesma linha, Então a crase não abre código em linha", () => {
    expect(linhasVisiveis(["<!-- `x --> y `z`"])).toEqual([" y `z`"]);
  });

  test("Dado um link dentro de código em linha, Quando filtro, Então o texto é mantido (quem lê decide o que fazer com código em linha)", () => {
    expect(linhasVisiveis(["Escreva `[x](y.md)` assim."])).toEqual(["Escreva `[x](y.md)` assim."]);
  });

  test("Dado `<!--` dentro de código em linha e uma cerca depois, Quando filtro, Então a cerca ainda esvazia o bloco", () => {
    const entrada = ["`<!--`", "```", "[x](a.md)", "```", "fora"];
    expect(linhasVisiveis(entrada)).toEqual(["`<!--`", "", "", "", "fora"]);
  });

  test("Dada abertura de cerca com `<!--` no texto de informação, Quando a cerca fecha, Então a linha seguinte continua visível", () => {
    const entrada = ["```js <!--", "interno", "```", "[x](a.md)"];
    expect(linhasVisiveis(entrada)).toEqual(["", "", "", "[x](a.md)"]);
  });

  test("Dada abertura de cerca de tils com `<!--` no texto de informação, Quando a cerca fecha, Então a linha seguinte continua visível", () => {
    const entrada = ["~~~ <!--", "interno", "~~~", "[x](a.md)"];
    expect(linhasVisiveis(entrada)).toEqual(["", "", "", "[x](a.md)"]);
  });

  test("Dado um comentário que fecha numa linha seguido de abertura de cerca, Quando filtro, Então a cerca abre depois do comentário (comportamento mantido)", () => {
    const entrada = ["<!-- abre", "--> ```js", "interno", "```", "fora"];
    expect(linhasVisiveis(entrada)).toEqual(["", "", "", "", "fora"]);
  });
});
