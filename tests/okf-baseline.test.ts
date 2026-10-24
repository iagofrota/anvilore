import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { classificarRecurso, validarRecurso } from "../src/lib/okf";

// O baseline NÃO é outra versão do código: é scripts/resource-baseline.tsv, uma tabela de
// vereditos escrita à mão a partir da regra do SCHEMA.md. A comparação é código x dado, por isso
// ela não se anula depois do merge. Não existe --update nem regenerador, de propósito: afrouxar
// uma checagem exige editar a tabela à mão, linha a linha, com o motivo escrito ao lado.

type Veredito = "pass" | "fail";
type Entrada = { esperado: Veredito; valor: string; origem: string; linha: number };
type Fixture = { tipo: "file" | "dir"; caminho: string };

// Os quatro valores que regrediram de fato quando o espaço em branco decidia antes da forma de
// caminho. Moram aqui, e não na tabela, para que apagar uma linha exija editar também este arquivo.
const CANARIOS = [
  "raw/meetings/notas de reuniao.md",
  "wiki/_meta/arquivo com espaco.md",
  "raw/2026 Q3/notas.md",
  "raw/notas do dia",
];
const MINIMO_DE_VALORES = 26;

function carregar(texto: string): { fixtures: Fixture[]; entradas: Entrada[] } {
  const fixtures: Fixture[] = [];
  const entradas: Entrada[] = [];
  const vistos = new Map<string, number>();
  texto.split(/\r?\n/).forEach((bruta, i) => {
    const linha = i + 1;
    if (bruta.trim() === "" || bruta.trimStart().startsWith("#")) return;
    const campos = bruta.split("\t");
    if (campos[0] === "@fixture") {
      const [, tipo, caminho] = campos;
      if (campos.length !== 3 || (tipo !== "file" && tipo !== "dir")) throw new Error(`linha ${linha}: @fixture espera "@fixture<TAB>file|dir<TAB>caminho"`);
      if (caminho!.startsWith("/") || caminho!.split("/").includes("..")) throw new Error(`linha ${linha}: fixture tem de ser relativa e contida na raiz: ${caminho}`);
      fixtures.push({ tipo, caminho: caminho! });
      return;
    }
    if (campos.length !== 3) throw new Error(`linha ${linha}: esperadas 3 colunas separadas por TAB, vieram ${campos.length}`);
    const [esperado, valor, origem] = campos as [string, string, string];
    if (esperado !== "pass" && esperado !== "fail") throw new Error(`linha ${linha}: coluna 1 tem de ser "pass" ou "fail", veio ${esperado}`);
    if (valor === "") throw new Error(`linha ${linha}: coluna 2 (valor) vazia`);
    if (origem.trim() === "") throw new Error(`linha ${linha}: coluna 3 (origem) vazia: todo valor carrega o motivo de estar aqui`);
    if (vistos.has(valor)) throw new Error(`linha ${linha}: valor duplicado (já na linha ${vistos.get(valor)}): ${valor}`);
    vistos.set(valor, linha);
    entradas.push({ esperado, valor, origem: origem.trim(), linha });
  });
  return { fixtures, entradas };
}

function montarFixtures(raizDoRepo: string, fixtures: Fixture[]): void {
  for (const { tipo, caminho } of fixtures) {
    const alvo = join(raizDoRepo, caminho);
    if (tipo === "dir") mkdirSync(alvo, { recursive: true });
    else {
      mkdirSync(dirname(alvo), { recursive: true });
      writeFileSync(alvo, "fixture\n");
    }
  }
}

// Divergências do detector contra a tabela: "afrouxado" (esperava fail, deu pass) ou "apertado".
function comparar(entradas: Entrada[], veredito: (valor: string) => Veredito) {
  const afrouxados: Entrada[] = [];
  const apertados: Entrada[] = [];
  for (const entrada of entradas) {
    const obtido = veredito(entrada.valor);
    if (obtido === entrada.esperado) continue;
    (entrada.esperado === "fail" ? afrouxados : apertados).push(entrada);
  }
  return { afrouxados, apertados };
}

const caminhoDaTabela = join(import.meta.dir, "..", "scripts", "resource-baseline.tsv");
const { fixtures, entradas } = carregar(readFileSync(caminhoDaTabela, "utf8"));

let raizDoRepo: string;
beforeAll(() => {
  // Dois níveis: a raiz do "repositório" é filha do temporário, para que ../.. tenha para onde
  // escapar sem depender da profundidade de TMPDIR.
  raizDoRepo = join(mkdtempSync(join(tmpdir(), "anvilore-baseline-")), "repo");
  mkdirSync(raizDoRepo);
  montarFixtures(raizDoRepo, fixtures);
});
afterAll(() => {
  rmSync(dirname(raizDoRepo), { recursive: true, force: true });
});

const veredito = (valor: string): Veredito => (validarRecurso(valor, raizDoRepo) ? "pass" : "fail");

describe("baseline de sources[].resource", () => {
  test("Dado o baseline versionado, Quando valido cada valor, Então nenhum veredito foi afrouxado nem apertado", () => {
    const { afrouxados, apertados } = comparar(entradas, veredito);
    expect(afrouxados.map((e) => `${e.valor} (linha ${e.linha})`)).toEqual([]);
    expect(apertados.map((e) => `${e.valor} (linha ${e.linha})`)).toEqual([]);
  });

  test("Dado a tabela, Quando conto os valores, Então ela não encolheu abaixo do mínimo", () => {
    expect(entradas.length).toBeGreaterThanOrEqual(MINIMO_DE_VALORES);
  });

  test("Dado a tabela, Quando procuro os quatro canários, Então todos estão presentes e marcados fail", () => {
    for (const canario of CANARIOS) {
      expect(entradas.find((e) => e.valor === canario)?.esperado).toBe("fail");
    }
  });

  test("Dado a regra com o espaço em branco decidindo antes da forma de caminho, Quando o detector roda, Então acusa os quatro canários", () => {
    const comEspacoDecidindo = (valor: string): Veredito => {
      if (classificarRecurso(valor) === "url") return "pass";
      return /\s/.test(valor) ? "pass" : veredito(valor);
    };
    const { afrouxados } = comparar(entradas, comEspacoDecidindo);
    const acusados = afrouxados.map((e) => e.valor);
    for (const canario of CANARIOS) expect(acusados).toContain(canario);
  });

  test("Dado um detector invertido, Quando roda sobre a tabela, Então reprova (o teste tem dentes)", () => {
    const invertido = (valor: string): Veredito => (veredito(valor) === "pass" ? "fail" : "pass");
    const { afrouxados, apertados } = comparar(entradas, invertido);
    expect(afrouxados.length + apertados.length).toBe(entradas.length);
  });
});

describe("formato da tabela do baseline", () => {
  test("Dado uma linha sem o motivo, Quando carrego, Então falha (nada entra sem origem)", () => {
    expect(() => carregar("fail\traw/x.md\t \n")).toThrow("coluna 3");
  });

  test("Dado um veredito que não é pass nem fail, Quando carrego, Então falha", () => {
    expect(() => carregar("talvez\traw/x.md\tmotivo\n")).toThrow("coluna 1");
  });

  test("Dado uma linha com número errado de colunas, Quando carrego, Então falha", () => {
    expect(() => carregar("fail\traw/x.md\n")).toThrow("3 colunas");
  });

  test("Dado um valor vazio, Quando carrego, Então falha", () => {
    expect(() => carregar("fail\t\tmotivo\n")).toThrow("coluna 2");
  });

  test("Dado um valor repetido, Quando carrego, Então falha apontando a primeira linha", () => {
    expect(() => carregar("fail\ta.md\tm\nfail\ta.md\tm\n")).toThrow("já na linha 1");
  });

  test("Dado uma fixture fora da raiz ou malformada, Quando carrego, Então falha", () => {
    expect(() => carregar("@fixture\tfile\t../fora\n")).toThrow("contida na raiz");
    expect(() => carregar("@fixture\tfile\t/abs\n")).toThrow("contida na raiz");
    expect(() => carregar("@fixture\tpipe\tx\n")).toThrow("@fixture espera");
  });

  test("Dado comentários e linhas em branco, Quando carrego, Então são ignorados", () => {
    const r = carregar("# nota\n\n@fixture\tdir\td\npass\tslack\tdescritor\n");
    expect(r.entradas).toHaveLength(1);
    expect(r.fixtures).toEqual([{ tipo: "dir", caminho: "d" }]);
  });
});
