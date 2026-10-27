import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { writeFileSync } from "node:fs";
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

test("Dado cwd fora do clone, Quando executa métricas, Então grava em .anvilore da raiz do clone", async () => {
  const clone = mkdtempSync(join(tmpdir(), "anvilore-metricas-clone-")); const alheio = mkdtempSync(join(tmpdir(), "anvilore-metricas-cwd-"));
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    expect(await comandoMetricas([], { raiz: clone, ambiente: {} })).toBe(0);
    expect(await import("node:fs").then(fs => fs.existsSync(join(clone, ".anvilore", "metricas.db")))).toBe(true);
    expect(await import("node:fs").then(fs => fs.existsSync(join(alheio, ".anvilore")))).toBe(false);
  } finally { log.mockRestore(); rmSync(clone, { recursive: true, force: true }); rmSync(alheio, { recursive: true, force: true }); }
});

test("Dado oito processos abrindo banco de métricas novo ao mesmo tempo, Quando inicializam, Então todos completam", async () => {
  for (let rodada = 0; rodada < 3; rodada++) {
    const dir = mkdtempSync(join(tmpdir(), "anvilore-metricas-concorrentes-")); const db = join(dir, "metricas.db");
    const modulo = new URL("../src/busca/metricas.ts", import.meta.url).href;
    const codigo = `import { abrirMetricas } from ${JSON.stringify(modulo)}; abrirMetricas(process.argv[1]).resumo();`;
    const processos = Array.from({ length: 8 }, () => Bun.spawn([process.execPath, "-e", codigo, db], { stdout: "pipe", stderr: "pipe" }));
    const resultados = await Promise.all(processos.map(async (processo) => {
      const [saida, erro, codigoSaida] = await Promise.all([new Response(processo.stdout).text(), new Response(processo.stderr).text(), processo.exited]);
      return { codigo: codigoSaida, saida, erro };
    }));
    expect(resultados.filter((resultado) => resultado.codigo !== 0)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Dado banco de métricas corrompido, Quando lê o resumo, Então fecha e propaga o erro", () => {
  const dir = mkdtempSync(join(tmpdir(), "anvilore-metricas-corrompidas-")); const db = join(dir, "metricas.db");
  writeFileSync(db, "lixo sqlite");
  try { expect(() => abrirMetricas(db).resumo()).toThrow(); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
