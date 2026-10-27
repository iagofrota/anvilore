import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { comandoMetricas, executarMetricas } from "../src/comandos/metricas";
import { abrirMetricas } from "../src/busca/metricas";

test("Dado comando com --json, Quando imprime métricas, Então stdout contém JSON válido", async () => {
  const dir = mkdtempSync(join(tmpdir(), "anvilore-cli-metricas-")); const saidas: string[] = [];
  try {
    const codigo = await executarMetricas(["--json"], { arquivoDb: join(dir, "metricas.db"), stdout: (texto) => saidas.push(texto), ligado: false });
    expect(codigo).toBe(0);
    expect(() => JSON.parse(saidas.join(""))).not.toThrow();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Dado chamadas salvas, Quando executa --limpar, Então o comando zera o banco", async () => {
  const dir = mkdtempSync(join(tmpdir(), "anvilore-cli-metricas-limpar-")); const db = join(dir, "metricas.db"); const saidas: string[] = [];
  try {
    abrirMetricas(db).registrar({ tool: "buscar", ms: 1, bytes: 1, resultados: 0, vazia: true, palavras: 1, explicita: false, filtros: [], porEstado: { manual: 0, verificada: 0, rascunho: 0 }, comAviso: 0, reindexadas: 0, msReindexacao: 0, conexao: "x" });
    await executarMetricas(["--limpar", "--json"], { arquivoDb: db, stdout: (s) => saidas.push(s), ligado: true });
    expect(abrirMetricas(db).resumo().totalChamadas).toBe(0);
    expect(JSON.parse(saidas[0] ?? "{}").totalChamadas).toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Dado data fora do calendário, Quando filtra métricas, Então recusa sem executar", async () => {
  const erros: string[] = [];
  expect(await executarMetricas(["--desde", "2026-02-30"], { stderr: (s) => erros.push(s) })).toBe(1);
  expect(erros[0]).toContain("AAAA-MM-DD");
});

test("Dado o subcomando público, Quando executa sem argumentos, Então imprime o relatório local", async () => {
  const dir = mkdtempSync(join(tmpdir(), "anvilore-cli-metricas-publico-")); const anterior = process.env.ANVILORE_DIR; const metricasAnterior = process.env.ANVILORE_METRICAS; const log = spyOn(console, "log").mockImplementation(() => {});
  process.env.ANVILORE_DIR = dir; process.env.ANVILORE_METRICAS = "0";
  try { expect(await comandoMetricas([])).toBe(0); expect(log).toHaveBeenCalled(); }
  finally {
    log.mockRestore(); rmSync(dir, { recursive: true, force: true });
    if (anterior === undefined) delete process.env.ANVILORE_DIR; else process.env.ANVILORE_DIR = anterior;
    if (metricasAnterior === undefined) delete process.env.ANVILORE_METRICAS; else process.env.ANVILORE_METRICAS = metricasAnterior;
  }
});
