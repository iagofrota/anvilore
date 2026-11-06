import { expect, test } from "bun:test";
import { estadoDaPagina } from "../src/busca/estado";

const raiz = "/tmp/wiki";
const arquivo = "wiki/pagina.md";

test("Dado página sem generated, Quando classifica estado, Então é manual", () => {
  expect(estadoDaPagina("---\ntitle: X\n---\ntexto", arquivo, raiz).estado).toBe("manual");
});

test("Dado generated não-mapa (string, array, null, número, data legada), Quando classifica estado, Então é rascunho", () => {
  expect(estadoDaPagina("---\ngenerated: 'agent'\n---\ntexto", arquivo, raiz).estado).toBe("rascunho");
  expect(estadoDaPagina("---\ngenerated: []\n---\ntexto", arquivo, raiz).estado).toBe("rascunho");
  expect(estadoDaPagina("---\ngenerated: null\n---\ntexto", arquivo, raiz).estado).toBe("rascunho");
  expect(estadoDaPagina("---\ngenerated: 42\n---\ntexto", arquivo, raiz).estado).toBe("rascunho");
  expect(estadoDaPagina("---\ngenerated: 2026-01-01\n---\ntexto", arquivo, raiz).estado).toBe("rascunho");
});

test("Dado generated aprovado por humano depois, Quando classifica estado, Então é verificada", () => {
  const texto = "---\ngenerated:\n  by: agent/model\n  at: '2026-01-01T00:00:00Z'\nverified:\n  by: human:iago\n  at: '2026-01-02T00:00:00Z'\n---\ntexto";
  expect(estadoDaPagina(texto, arquivo, raiz).estado).toBe("verificada");
});

test("Dado generated sem verified, Quando classifica estado, Então é rascunho", () => {
  expect(estadoDaPagina("---\ngenerated:\n  by: agent/model\n  at: '2026-01-01T00:00:00Z'\n---\ntexto", arquivo, raiz).estado).toBe("rascunho");
});

test("Dado generated sem at e verified sem at, Quando classifica estado, Então é rascunho", () => {
  const texto = "---\ngenerated:\n  by: agent/model\nverified:\n  by: human:iago\n---\ntexto";
  expect(estadoDaPagina(texto, arquivo, raiz).estado).toBe("rascunho");
});

test("Dado generated com at inválido e verified com at inválido, Quando classifica estado, Então é rascunho", () => {
  const texto = "---\ngenerated:\n  by: agent/model\n  at: invalido\nverified:\n  by: human:iago\n  at: invalido\n---\ntexto";
  expect(estadoDaPagina(texto, arquivo, raiz).estado).toBe("rascunho");
});

test("Dado página manual com verified, Quando classifica estado, Então permanece manual", () => {
  const texto = "---\ntitle: Manual\nverified:\n  by: human:iago\n  at: '2026-01-02T00:00:00Z'\n---\ntexto";
  expect(estadoDaPagina(texto, arquivo, raiz).estado).toBe("manual");
});

test("Dado verified anterior a generated, Quando classifica estado, Então é rascunho", () => {
  const texto = "---\ngenerated:\n  by: agent/model\n  at: '2026-01-02T00:00:00Z'\nverified:\n  by: human:iago\n  at: '2026-01-01T00:00:00Z'\n---\ntexto";
  expect(estadoDaPagina(texto, arquivo, raiz).estado).toBe("rascunho");
});

test("Dado stale_after no passado, Quando usa relógio fixo, Então marca vencida", () => {
  const texto = "---\nstale_after: '2026-01-01T00:00:00Z'\n---\ntexto";
  expect(estadoDaPagina(texto, arquivo, raiz, new Date("2026-01-02T00:00:00Z")).vencida).toBe(true);
});

test("Dado YAML inválido, Quando classifica estado, Então devolve rascunho sem lançar", () => {
  expect(estadoDaPagina("---\nfoo: [\n---\ntexto", arquivo, raiz).estado).toBe("rascunho");
});
