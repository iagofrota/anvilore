import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { linhasDe } from "../src/lib/frontmatter";

const raiz = join(import.meta.dir, "..");
const ler = (arquivo: string) => readFileSync(join(raiz, arquivo), "utf8");

describe("ponteiros entre os arquivos de instrução", () => {
  test("Dado o CLAUDE.md do repositório, Quando leio, Então ele cita o AGENTS.md e não repete regras (menos de 10 linhas)", () => {
    const texto = ler("CLAUDE.md");
    expect(texto).toContain("AGENTS.md");
    const linhas = linhasDe(texto).filter((linha) => linha.trim() !== "");
    expect(linhas.length).toBeLessThan(10);
  });

  test("Dado o AGENTS.md, Quando leio, Então ele aponta para docs/knowledge_base/README.md, que existe", () => {
    expect(ler("AGENTS.md")).toContain("docs/knowledge_base/README.md");
    expect(existsSync(join(raiz, "docs", "knowledge_base", "README.md"))).toBe(true);
  });

  test("Dado o AGENTS.md, Quando leio a seção sobre o Anvilore, Então ela é curta e não carrega o conteúdo da knowledge base", () => {
    const linhas = linhasDe(ler("AGENTS.md"));
    const inicio = linhas.findIndex((linha) => linha.startsWith("## ") && linha.includes("Anvilore"));
    expect(inicio).toBeGreaterThan(-1);
    const seguinte = linhas.findIndex((linha, i) => i > inicio && linha.startsWith("## "));
    const secao = linhas.slice(inicio, seguinte === -1 ? undefined : seguinte).filter((linha) => linha.trim() !== "");
    expect(secao.length).toBeLessThanOrEqual(14);
  });

  test("Dado o AGENTS.md, Quando leio os ponteiros para a knowledge base, Então cada página citada existe", () => {
    const citadas = [...ler("AGENTS.md").matchAll(/`(docs\/knowledge_base\/[^`\s]+)`/g)].map((m) => m[1]!);
    expect(citadas.length).toBeGreaterThan(1);
    for (const citada of citadas) {
      expect(existsSync(join(raiz, citada))).toBe(true);
    }
  });

  test("Dado o README da knowledge base, Quando leio, Então cada página que ele lista com link existe", () => {
    const texto = ler("docs/knowledge_base/README.md");
    const alvos = [...texto.matchAll(/\]\(([^)#\s]+\.md)\)/g)].map((m) => m[1]!);
    expect(alvos.length).toBeGreaterThan(0);
    for (const alvo of alvos) {
      expect(existsSync(join(raiz, "docs", "knowledge_base", alvo))).toBe(true);
    }
  });
});
