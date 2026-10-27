import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrirMetricas, type Chamada } from "../src/busca/metricas";
import { criarNucleo } from "../src/busca/nucleo";
import { executarMetricas } from "../src/comandos/metricas";

const temporarios: string[] = [];
afterEach(() => { for (const dir of temporarios.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function arquivo(): string { const dir = mkdtempSync(join(tmpdir(), "anvilore-metricas-")); temporarios.push(dir); return join(dir, "metricas.db"); }
function chamada(overrides: Partial<Chamada> = {}): Chamada {
  return { tool: "buscar", ms: 10, bytes: 100, resultados: 1, vazia: false, palavras: 2, explicita: false, filtros: [], porEstado: { manual: 1, verificada: 0, rascunho: 0 }, comAviso: 0, reindexadas: 0, msReindexacao: 0, conexao: "conexao-teste", ...overrides };
}

test("Dado consulta sentinela, Quando registra e resume, Então o texto e os caminhos não aparecem no banco", () => {
  const dbPath = arquivo(); const m = abrirMetricas(dbPath);
  m.registrar(chamada({ filtros: ["area"], cliente: { nome: "claude-code", versao: "1" } }));
  const resumo = JSON.stringify(m.resumo());
  const bytes = ["", "-wal", "-shm"].map((s) => { try { return readFileSync(`${dbPath}${s}`).toString("utf8"); } catch { return ""; } }).join("");
  expect(resumo).not.toContain("termo-sentinela-xyz");
  expect(bytes).not.toContain("termo-sentinela-xyz");
  expect(bytes).not.toContain("segredo/caminho");
});

test("Dado busca por título, slug e caminho sentinela, Quando resume métricas, Então nenhum aparece no resumo, JSON ou banco", async () => {
  const dir = mkdtempSync(join(tmpdir(), "anvilore-metricas-privacidade-")); temporarios.push(dir);
  const wiki = join(dir, "wiki"); mkdirSync(wiki); const slug = "sentinela-segreda";
  writeFileSync(join(wiki, `${slug}.md`), `---\ntitle: ${slug}\nslug: ${slug}\n---\n## Exemplo\ntermo-sentinela-xyz`);
  const dbPath = join(dir, "metricas.db"); const registro = abrirMetricas(dbPath);
  const n = criarNucleo({ raiz: dir, wiki, arquivoDb: join(dir, "indice.db"), metricas: registro });
  await n.buscar("termo-sentinela-xyz");
  const metricas = await n.metricas(); const saidas: string[] = [];
  await executarMetricas(["--json"], { arquivoDb: dbPath, ligado: true, stdout: (s) => saidas.push(s) });
  const arquivos = ["", "-wal", "-shm"].map((s) => { try { return readFileSync(`${dbPath}${s}`).toString("utf8"); } catch { return ""; } }).join("");
  for (const texto of [JSON.stringify(metricas), saidas.join(""), arquivos]) {
    expect(texto).not.toContain("termo-sentinela-xyz");
    expect(texto).not.toContain(slug);
    expect(texto).not.toContain(`${slug}.md`);
  }
});

test("Dado ANVILORE_METRICAS igual a zero, Quando abre registry, Então não cria arquivo", () => {
  const dbPath = arquivo(); const m = abrirMetricas(dbPath, false); m.registrar(chamada());
  expect(existsSync(dbPath)).toBe(false);
  expect(m.resumo().uso.buscas).toBe(0);
});

test("Dado linha com mais de 180 dias, Quando registra de novo, Então remove a antiga", () => {
  const m = abrirMetricas(arquivo()); const agora = new Date("2026-10-27T12:00:00Z");
  m.registrar(chamada(), new Date("2026-04-28T12:00:00Z"));
  m.registrar(chamada(), agora);
  expect(m.resumo().totalChamadas).toBe(1);
});

test("Dado buscas, leituras e posições, Quando resume, Então calcula taxas, distribuição e p95", () => {
  const m = abrirMetricas(arquivo()); const dia = new Date("2026-10-27T12:00:00Z");
  m.registrar(chamada({ bytes: 100, conexao: "a" }), dia);
  m.registrar(chamada({ tool: "ler", bytes: 200, resultados: 0, porEstado: { manual: 0, verificada: 0, rascunho: 0 }, conexao: "a", posicaoLida: 1 }), dia);
  m.registrar(chamada({ bytes: 300, vazia: true, resultados: 0, porEstado: { manual: 0, verificada: 0, rascunho: 0 }, conexao: "b" }), dia);
  m.registrar(chamada({ tool: "ler", bytes: 400, resultados: 0, porEstado: { manual: 0, verificada: 0, rascunho: 0 }, conexao: "b", posicaoLida: 6 }), dia);
  const r = m.resumo();
  expect(r.uso.buscas).toBe(2);
  expect(r.acerto).toMatchObject({ buscasSeguidasDeLer: 2, percentualSeguidasDeLer: 100, posicoes: { primeiro: 1, segundo: 0, terceiroAQuinto: 0, acimaDeCinco: 1 } });
  expect(r.lacuna.percentualBuscasVazias).toBe(50);
  expect(r.custo.buscar).toMatchObject({ p95Bytes: 300 });
  expect(r.custo.ler).toMatchObject({ p95Bytes: 400 });
});

test("Dado resultados vencidos e avisos separados, Quando resume, Então distingue confiança e dias ativos por semana", () => {
  const m = abrirMetricas(arquivo()); const d1 = new Date("2026-10-26T12:00:00Z"); const d2 = new Date("2026-10-27T12:00:00Z");
  m.registrar(chamada({ conexao: "c1", vencidas: 1, lacunas: 1 }), d1);
  m.registrar(chamada({ conexao: "c2", vencidas: 0, contradicoes: 1 }), d2);
  const r = m.resumo();
  expect(r.confianca).toMatchObject({ vencidas: 1, percentualVencidas: 50, lacunas: 1, contradicoes: 1 });
  expect(r.uso.diasComUsoPorSemana).toEqual([{ semana: "2026-10-26", dias: 2 }]);
});

test("Dado métricas com dados, Quando limpa, Então o resumo fica zerado", () => {
  const m = abrirMetricas(arquivo()); m.registrar(chamada()); m.limpar(); expect(m.resumo().totalChamadas).toBe(0);
});

test("Dado registro incompleto, Quando falha uma escrita, Então desfaz a transação e fecha o banco", () => {
  const m = abrirMetricas(arquivo());
  expect(() => m.registrar(chamada({ porEstado: null as unknown as Chamada["porEstado"] }))).toThrow();
  expect(m.resumo().totalChamadas).toBe(0);
});

test("Dado métricas locais, Quando usa saída padrão, Então imprime resumo legível e JSON", async () => {
  const saidas: string[] = [];
  expect(await executarMetricas([], { arquivoDb: arquivo(), ligado: true, stdout: (texto) => saidas.push(texto) })).toBe(0);
  expect(saidas[0]).toContain("Uso:");
  expect(saidas[0]).toContain("JSON:");
});
