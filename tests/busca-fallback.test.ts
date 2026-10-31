import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { comandoFallback, provarBuscaFallback } from "../scripts/provar-busca-fallback";

test("Dado cada sistema Quando escolho o fallback Então usa a busca nativa com flags portáveis e UTF-8 no PowerShell", () => {
  expect(comandoFallback("linux", "governança")).toBe('grep -rn -i "governança" wiki/');
  expect(comandoFallback("darwin", "governança")).toBe('grep -rn -i "governança" wiki/');
  expect(comandoFallback("win32", "governança")).toContain("Select-String -Encoding UTF8 -Pattern 'governança'");
  expect(comandoFallback("win32", "governança")).toContain('"{0}:{1}:{2}" -f $_.Path, $_.LineNumber, $_.Line');
  expect(() => comandoFallback("freebsd", "x")).toThrow(/não suportada/);
});

test("Dado as skills de busca e lint Quando não há rg Então orientam o fallback e mantêm a busca obrigatória", () => {
  const query = readFileSync(join(import.meta.dir, "../skills/query/SKILL.md"), "utf8");
  const lint = readFileSync(join(import.meta.dir, "../skills/lint/SKILL.md"), "utf8");
  for (const skill of [query, lint]) {
    expect(skill).toContain("grep -rn -i");
    expect(skill).toContain("Select-String -Encoding UTF8");
    expect(skill.toLowerCase()).toContain("nunca pule a busca");
  }
});

test("Dado o job multiplataforma Quando executo a prova Então CI executa o fallback nativo em cada runner", () => {
  const fluxo = Bun.YAML.parse(readFileSync(join(import.meta.dir, "../.github/workflows/ci.yml"), "utf8")) as any;
  const etapas = fluxo.jobs.testes.steps;
  expect(fluxo.jobs.testes.strategy.matrix.os).toEqual(["ubuntu-latest", "windows-latest", "macos-latest"]);
  expect(etapas.some((etapa: any) => etapa.run === "bun scripts/provar-busca-fallback.ts")).toBe(true);
});

test("Dado a ferramenta nativa Quando busco um termo acentuado numa wiki ignorada Então imprime arquivo:linha:texto e encontra espaços no caminho", () => {
  const resultado = provarBuscaFallback();
  expect(resultado.codigo, resultado.saida).toBe(0);
  expect(resultado.saida).toContain("governança funciona");
  expect(resultado.saida).toContain(":2:A governança funciona.");
  expect(resultado.saida).toContain("página com espaço.md");
});
