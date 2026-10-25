import { expect, test } from "bun:test";
import { join } from "node:path";
import { conferirBaseline } from "../src/comandos/baseline";

// A conferência (as duas fases, a estrutura da tabela e o formato do TSV) mora em
// src/comandos/baseline.ts e é testada em tests/baseline.test.ts. Aqui fica só a
// pergunta que importa ao repositório: a tabela versionada ainda bate com o validador?
const TABELA = join(import.meta.dir, "..", "scripts", "resource-baseline.tsv");

test("Dado o baseline versionado, Quando valido cada valor, Então nenhum veredito foi afrouxado nem apertado", async () => {
  const { ok, divergencias } = await conferirBaseline(TABELA);
  expect(divergencias).toEqual([]);
  expect(ok).toBe(true);
});

test("Dado o baseline versionado, Quando confiro, Então as duas fases rodaram e passaram", async () => {
  const texto = (await conferirBaseline(TABELA)).relato.join("\n");
  expect(texto).toContain("FASE1: PASS");
  expect(texto).toContain("FASE2: PASS");
});
