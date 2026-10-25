import { afterEach, beforeEach, expect, test } from "bun:test";
import { capturarConsole } from "./apoio/console";
import { ConflitoEscalar, fundirJson, comandoFundirJson } from "../src/lib/fundir-json";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let consoleCapturado: ReturnType<typeof capturarConsole>;
beforeEach(() => { consoleCapturado = capturarConsole(); });
afterEach(() => { consoleCapturado.restaurar(); });

test("Dado objetos e listas Quando fundo Então preserva e acrescenta sem duplicar por igualdade profunda", () => {
  const alvo = { pessoal: true, hooks: [{ a: 1, b: 2 }] };
  const fragmento = { hooks: [{ b: 2, a: 1 }, { a: 3 }], novo: { x: 1 } };
  const obtido = fundirJson(alvo, fragmento);
  expect(obtido).toEqual({ resultado: { pessoal: true, hooks: [{ a: 1, b: 2 }, { a: 3 }], novo: { x: 1 } }, veredito: "MUDOU" });
  expect(alvo).toEqual({ pessoal: true, hooks: [{ a: 1, b: 2 }] });
  expect(fundirJson(obtido.resultado, fragmento).veredito).toBe("INALTERADO");
});

for (const [atual, novo] of [["meu", "outro"], [[], {}], [true, 1], [null, {}]]) {
  test(`Dado escalar ou tipo divergente ${JSON.stringify(atual)} Quando fundo Então recusa com o caminho`, () => {
    try {
      fundirJson({ context: { fileName: atual } }, { context: { fileName: novo } });
      throw new Error("aceitou conflito");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ConflitoEscalar);
      expect((erro as ConflitoEscalar).caminho).toBe("context.fileName");
    }
    expect(() => fundirJson(atual, novo)).toThrow("(raiz)");
  });
}

test("Dado chaves especiais Quando fundo Então preserva dados sem alterar protótipos", () => {
  const dado = JSON.parse('{"__proto__":{"poluido":true},"constructor":4}');
  expect(fundirJson({}, dado).resultado).toEqual(dado);
  expect(Object.hasOwn({}, "poluido")).toBe(false);
});

test("Dado o comando de fusão Quando crio simulo repito ou recuso Então mantém códigos e disco", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fundir-"));
  const alvo = join(dir, "alvo.json"), frag = join(dir, "frag.json");
  try {
    writeFileSync(frag, '{"modelo":"meu"}');
    expect(await comandoFundirJson([alvo, frag])).toBe(0);
    const antes = readFileSync(alvo, "utf8");
    expect(antes).toBe('{\n  "modelo": "meu"\n}\n');
    expect(await comandoFundirJson([alvo, frag])).toBe(0);
    writeFileSync(frag, '{"novo":true}');
    expect(await comandoFundirJson(["--simular", alvo, frag])).toBe(0);
    expect(readFileSync(alvo, "utf8")).toBe(antes);
    expect(await comandoFundirJson([alvo, frag])).toBe(0);
    expect(JSON.parse(readFileSync(alvo, "utf8")).novo).toBe(true);
    const depois = readFileSync(alvo, "utf8");
    writeFileSync(frag, '{"modelo":"outro"}');
    expect(await comandoFundirJson([alvo, frag])).toBe(3);
    expect(readFileSync(alvo, "utf8")).toBe(depois);
    writeFileSync(frag, "{ruim");
    expect(await comandoFundirJson([alvo, frag])).toBe(2);
    expect(await comandoFundirJson([alvo, join(dir, "ausente")])).toBe(2);
    expect(await comandoFundirJson([])).toBe(2);
    expect(await comandoFundirJson(["--ruim", alvo, frag])).toBe(2);
    expect(consoleCapturado.saida).toEqual(["MUDOU", "INALTERADO", "MUDOU", "MUDOU"]);
    expect(consoleCapturado.erros.join("\n")).toContain("RECUSADO");
    expect(consoleCapturado.erros.join("\n")).toContain("JSON");
    expect(consoleCapturado.erros.join("\n")).toContain("uso: fundir-json");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
