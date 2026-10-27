import { expect, test } from "bun:test";
import { montarConsulta } from "../src/busca/consulta";

const aceita = () => true;

test("Dado dois termos livres, Quando monta a consulta, Então os une por OR", () => {
  const consulta = montarConsulta("alíquota IBS", aceita);
  expect(consulta.match).toContain("OR");
  expect(consulta.termos).toEqual(["alíquota", "IBS"]);
});

test("Dado termo com quatro letras, Quando monta prefixos, Então IBS fica exato", () => {
  const consulta = montarConsulta("aliquota IBS", aceita);
  expect(consulta.match).toContain('"aliquota"*');
  expect(consulta.match).toContain('"IBS"');
  expect(consulta.match).not.toContain('"IBS"*');
});

test("Dado termo plural terminado em s, Quando monta prefixos, Então inclui singular aproximado", () => {
  const consulta = montarConsulta("créditos", aceita);
  expect(consulta.match).toContain('"créditos"*');
  expect(consulta.match).toContain('"crédito"*');
});

test("Dado consulta com stopwords, Quando monta termos, Então remove as palavras funcionais", () => {
  expect(montarConsulta("o que temos sobre IBS", aceita).termos).toEqual(["IBS"]);
});

test("Dado consulta só com stopwords, Quando filtra, Então mantém todos os termos", () => {
  expect(montarConsulta("o que temos", aceita).termos).toEqual(["o", "que", "temos"]);
});

test("Dado aspas e operador explícito, Quando monta, Então preserva a entrada", () => {
  const original = '"base de cálculo" NOT CBS';
  const consulta = montarConsulta(original, aceita);
  expect(consulta.explicita).toBe(true);
  expect(consulta.match).toBe(original);
});

test("Dado candidato FTS recusado, Quando valida, Então usa saco de palavras entre aspas", () => {
  const consulta = montarConsulta("IBS: crédito", () => false);
  expect(consulta.match).toBe('"IBS" OR "crédito"');
});

test("Dado consulta NFD, Quando normaliza, Então termos saem em NFC", () => {
  expect(montarConsulta("tributac\u0327a\u0303o", aceita).termos).toEqual(["tributação"]);
});

test("Dado vazio, espaços ou pontuação, Quando monta consulta, Então match é null", () => {
  for (const texto of ["", "   ", "?!"]) expect(montarConsulta(texto, aceita).match).toBeNull();
});

test("Dado texto livre arbitrário, Quando monta consulta, Então nunca lança", () => {
  for (let i = 0; i < 200; i++) {
    const texto = `${Math.random()} \" ( NEAR( : * ${Math.random()}`;
    expect(() => montarConsulta(texto, () => false)).not.toThrow();
  }
});
