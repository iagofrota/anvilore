import { expect, test } from "bun:test";
import { diffLinhas, indiceVizinho } from "../ui/web/revisao";

test("Dado conteúdo inalterado Quando comparo linhas Então marco todas como contexto", () => {
  expect(diffLinhas("a\nb", "a\nb")).toEqual([{ tipo: "igual", texto: "a" }, { tipo: "igual", texto: "b" }]);
});

test("Dado uma linha acrescentada e outra removida Quando comparo Mudanças Então identifico ambas", () => {
  expect(diffLinhas("comum\nremovida", "comum\nadicionada")).toEqual([
    { tipo: "igual", texto: "comum" }, { tipo: "removida", texto: "removida" }, { tipo: "adicionada", texto: "adicionada" },
  ]);
});

test("Dado seleção na fila Quando uso J ou K Então avanço sem sair dos limites", () => {
  expect(indiceVizinho(0, -1, 3)).toBe(0);
  expect(indiceVizinho(0, 1, 3)).toBe(1);
  expect(indiceVizinho(2, 1, 3)).toBe(2);
  expect(indiceVizinho(0, 1, 0)).toBe(-1);
});

test("Dado páginas grandes demais para comparação ótima Quando abro Mudanças Então mostra removidas e adicionadas", () => {
  const antes = Array.from({ length: 1001 }, (_, n) => `antes ${n}`).join("\n");
  const depois = Array.from({ length: 1001 }, (_, n) => `depois ${n}`).join("\n");
  const linhas = diffLinhas(antes, depois);
  expect(linhas).toHaveLength(2002);
  expect(linhas[0]?.tipo).toBe("removida");
  expect(linhas.at(-1)?.tipo).toBe("adicionada");
});
