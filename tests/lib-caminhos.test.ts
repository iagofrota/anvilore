import { expect, test } from "bun:test";
import { chaveDeNome, estaEmRaw, normalizarFimDeLinha } from "../src/lib/caminhos";

test("Dado texto com CRLF, Quando normalizo o fim de linha, Então só restam LF", () => {
  expect(normalizarFimDeLinha("a\r\nb\r\n")).toBe("a\nb\n");
});

test("Dado texto que já usa LF, Quando normalizo o fim de linha, Então nada muda", () => {
  expect(normalizarFimDeLinha("a\nb\n")).toBe("a\nb\n");
});

test("Dado um CR solto sem LF, Quando normalizo o fim de linha, Então ele é preservado", () => {
  expect(normalizarFimDeLinha("a\rb")).toBe("a\rb");
});

test("Dado o é composto e o é decomposto, Quando calculo a chave de nome, Então as chaves são iguais", () => {
  const composto = "caf\u00e9.md";
  const decomposto = "cafe\u0301.md";
  expect(composto).not.toBe(decomposto);
  expect(chaveDeNome(composto)).toBe(chaveDeNome(decomposto));
});

test("Dado Pagina e pagina, Quando calculo a chave de nome, Então as chaves são iguais", () => {
  expect(chaveDeNome("Pagina")).toBe(chaveDeNome("pagina"));
});

test("Dado É maiúsculo decomposto e é minúsculo composto, Quando calculo a chave de nome, Então as chaves são iguais", () => {
  expect(chaveDeNome("E\u0301")).toBe(chaveDeNome("\u00e9"));
});

test("Dado dois nomes diferentes de verdade, Quando calculo a chave de nome, Então as chaves diferem", () => {
  expect(chaveDeNome("pagina-a")).not.toBe(chaveDeNome("pagina-b"));
});

test("Dado a chave de um nome, Quando calculo a chave dela de novo, Então o resultado não muda", () => {
  const chave = chaveDeNome("Cafe\u0301");
  expect(chaveDeNome(chave)).toBe(chave);
});

test("Dado um caminho do Windows com barra invertida, Quando pergunto se está em raw, Então está", () => {
  expect(estaEmRaw("C:\\p\\raw\\a.md")).toBe(true);
});

test("Dado um caminho POSIX com raw no meio, Quando pergunto se está em raw, Então está", () => {
  expect(estaEmRaw("/proj/raw/a.md")).toBe(true);
  expect(estaEmRaw("raw/a.md")).toBe(true);
});

test("Dado o próprio diretório raw, Quando pergunto se está em raw, Então está", () => {
  expect(estaEmRaw("raw")).toBe(true);
  expect(estaEmRaw("proj/raw/")).toBe(true);
});

test("Dado rawdata/a.md, Quando pergunto se está em raw, Então não está", () => {
  expect(estaEmRaw("rawdata/a.md")).toBe(false);
});

test("Dado wiki/raw-notas.md, Quando pergunto se está em raw, Então não está", () => {
  expect(estaEmRaw("wiki/raw-notas.md")).toBe(false);
});

test("Dado um caminho sem raw, Quando pergunto se está em raw, Então não está", () => {
  expect(estaEmRaw("wiki/a.md")).toBe(false);
  expect(estaEmRaw("")).toBe(false);
});

test("Dado Raw e RAW em caixas diferentes, Quando pergunto se está em raw, Então está (disco sem distinção de caixa)", () => {
  expect(estaEmRaw("Raw/a.md")).toBe(true);
  expect(estaEmRaw("proj\\RAW\\a.md")).toBe(true);
  expect(estaEmRaw("/p/rAw/x.md")).toBe(true);
});

test("Dado caminho misturando / e \\, Quando pergunto se está em raw, Então está", () => {
  expect(estaEmRaw("C:\\p/raw\\a.md")).toBe(true);
});

test("Dado raw como parte do nome do arquivo, Quando pergunto se está em raw, Então não está", () => {
  expect(estaEmRaw("wiki/raw.md")).toBe(false);
  expect(estaEmRaw("wiki/notas.raw")).toBe(false);
});
