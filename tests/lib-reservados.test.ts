import { expect, test } from "bun:test";
import { diretorioDeTipo, nomeReservado } from "../src/lib/reservados";

// Porte de tests/test-lib-anvilore.sh: nome_reservado e nome_tipo_diretorio.

test("Dado o nome _meta, Quando pergunto se é reservado, Então é", () => {
  expect(nomeReservado("_meta")).toBe(true);
});

test("Dado o nome log, Quando pergunto se é reservado, Então é", () => {
  expect(nomeReservado("log")).toBe(true);
});

test("Dado o nome exemplo, Quando pergunto se é reservado, Então não é", () => {
  expect(nomeReservado("exemplo")).toBe(false);
});

test("Dado nomes que só lembram os reservados, Quando pergunto se são reservados, Então não são", () => {
  for (const nome of ["", "Log", "_META", "logs", "_meta/", "meta"]) {
    expect(nomeReservado(nome)).toBe(false);
  }
});

test("Dado um nome herdado de Object.prototype, Quando pergunto se é reservado, Então não é", () => {
  expect(nomeReservado("constructor")).toBe(false);
  expect(nomeReservado("toString")).toBe(false);
});

test("Dado o nome sources, Quando pergunto se é diretório de tipo, Então é", () => {
  expect(diretorioDeTipo("sources")).toBe(true);
});

test("Dado o nome concepts, Quando pergunto se é diretório de tipo, Então é", () => {
  expect(diretorioDeTipo("concepts")).toBe(true);
});

test("Dado o nome entities, Quando pergunto se é diretório de tipo, Então é", () => {
  expect(diretorioDeTipo("entities")).toBe(true);
});

test("Dado o nome de uma área comum, Quando pergunto se é diretório de tipo, Então não é", () => {
  expect(diretorioDeTipo("exemplo")).toBe(false);
});

test("Dado nomes que só lembram os de tipo, Quando pergunto se são diretório de tipo, Então não são", () => {
  for (const nome of ["", "Sources", "source", "concept", "entity", "constructor"]) {
    expect(diretorioDeTipo(nome)).toBe(false);
  }
});

test("Dado os nomes reservados e os de tipo, Quando comparo, Então nenhum nome está nos dois", () => {
  for (const nome of ["_meta", "log", "sources", "concepts", "entities"]) {
    expect(nomeReservado(nome) && diretorioDeTipo(nome)).toBe(false);
  }
});
