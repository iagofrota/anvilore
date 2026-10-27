import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import type { Estado } from "./estado";
import { comRetentativaSqlite } from "./sqlite-retry";

export type Chamada = {
  tool: "buscar" | "ler" | "indexar"; ms: number; bytes: number; resultados: number; vazia: boolean; palavras: number; explicita: boolean;
  filtros: string[]; porEstado: Record<Estado, number>; comAviso: number; reindexadas: number; msReindexacao: number; erro?: string;
  vencidas?: number; lacunas?: number; contradicoes?: number;
  cliente?: { nome: string; versao: string }; conexao: string; posicaoLida?: number | null; buscaId?: string;
};
export type RelatorioMetricas = {
  totalChamadas: number;
  uso: { buscas: number; leituras: number; indexacoes: number; porDia: Array<{ dia: string; buscas: number }>; diasComUsoPorSemana: Array<{ semana: string; dias: number }>; porCliente: Array<{ nome: string; versao: string; chamadas: number }> };
  acerto: { buscasSeguidasDeLer: number; percentualSeguidasDeLer: number; posicoes: { primeiro: number; segundo: number; terceiroAQuinto: number; acimaDeCinco: number } };
  lacuna: { buscasVazias: number; percentualBuscasVazias: number };
  custo: { buscar: CustoMetricas; ler: CustoMetricas; reindexadas: number; msReindexacao: number };
  confianca: { porEstado: Record<Estado, number>; percentualPorEstado: Record<Estado, number>; vencidas: number; percentualVencidas: number; comAviso: number; percentualComAviso: number; lacunas: number; contradicoes: number };
  contexto: { wiki: { paginas: number; secoes: number; porEstado: Record<Estado, number>; percentualPorEstado: Record<Estado, number> } | null; versaoAnvilore: string; plataforma: string; bun: string };
  saude: { erros: Record<string, number> };
};
type CustoMetricas = { bytesMedios: number; p95Bytes: number; medianaMs: number; p95Ms: number };
export interface RegistroDeMetricas { registrar(c: Chamada, agora?: Date): void; resumo(desde?: Date): RelatorioMetricas; limpar(): void }

const ERROS = new Set(["wiki_ausente", "indice_corrompido", "indice_indisponivel", "fora_da_wiki", "arquivo_inexistente", "linha_fora_do_arquivo", "utf8_invalido"]);
const FILTROS = new Set(["tipo", "area", "incluir"]);

function dataLocal(agora: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const offset = -agora.getTimezoneOffset(); const sinal = offset >= 0 ? "+" : "-";
  return `${agora.getFullYear()}-${pad(agora.getMonth() + 1)}-${pad(agora.getDate())}T${pad(agora.getHours())}:00:00${sinal}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}
function dbAberto(arquivo: string): Database {
  mkdirSync(resolve(arquivo, ".."), { recursive: true });
  return comRetentativaSqlite(() => {
    let db: Database | undefined;
    let transacao = false;
    try {
      db = new Database(arquivo, { create: true });
      db.exec("PRAGMA busy_timeout = 5000");
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("BEGIN IMMEDIATE"); transacao = true;
      db.exec("CREATE TABLE IF NOT EXISTS chamadas (hora TEXT NOT NULL, tool TEXT NOT NULL, ms REAL NOT NULL, bytes INTEGER NOT NULL, resultados INTEGER NOT NULL, vazia INTEGER NOT NULL, palavras INTEGER NOT NULL, explicita INTEGER NOT NULL, filtros TEXT NOT NULL, manual INTEGER NOT NULL, verificada INTEGER NOT NULL, rascunho INTEGER NOT NULL, com_aviso INTEGER NOT NULL, reindexadas INTEGER NOT NULL, ms_reindexacao REAL NOT NULL, erro TEXT, cliente_nome TEXT, cliente_versao TEXT, conexao TEXT NOT NULL, posicao_lida INTEGER, vencidas INTEGER NOT NULL DEFAULT 0, lacunas INTEGER NOT NULL DEFAULT 0, contradicoes INTEGER NOT NULL DEFAULT 0, busca_id TEXT)");
      const colunas = new Set((db.query("PRAGMA table_info(chamadas)").all() as { name: string }[]).map((c) => c.name));
      for (const [nome, tipo] of [["vencidas", "INTEGER NOT NULL DEFAULT 0"], ["lacunas", "INTEGER NOT NULL DEFAULT 0"], ["contradicoes", "INTEGER NOT NULL DEFAULT 0"], ["busca_id", "TEXT"]]) {
        if (!colunas.has(nome!)) db.exec(`ALTER TABLE chamadas ADD COLUMN ${nome} ${tipo}`);
      }
      db.exec("COMMIT"); transacao = false;
      return db;
    } catch (causa) {
      if (transacao) try { db?.exec("ROLLBACK"); } catch { /* mantém a falha original */ }
      try { db?.close(); } catch { /* mantém a falha original */ }
      throw causa;
    }
  });
}
function numero(valor: number): number { return Number.isFinite(valor) && valor > 0 ? valor : 0; }
function vazio(): RelatorioMetricas {
  return {
    totalChamadas: 0,
    uso: { buscas: 0, leituras: 0, indexacoes: 0, porDia: [], diasComUsoPorSemana: [], porCliente: [] },
    acerto: { buscasSeguidasDeLer: 0, percentualSeguidasDeLer: 0, posicoes: { primeiro: 0, segundo: 0, terceiroAQuinto: 0, acimaDeCinco: 0 } },
    lacuna: { buscasVazias: 0, percentualBuscasVazias: 0 },
    custo: { buscar: { bytesMedios: 0, p95Bytes: 0, medianaMs: 0, p95Ms: 0 }, ler: { bytesMedios: 0, p95Bytes: 0, medianaMs: 0, p95Ms: 0 }, reindexadas: 0, msReindexacao: 0 },
    confianca: { porEstado: { manual: 0, verificada: 0, rascunho: 0 }, percentualPorEstado: { manual: 0, verificada: 0, rascunho: 0 }, vencidas: 0, percentualVencidas: 0, comAviso: 0, percentualComAviso: 0, lacunas: 0, contradicoes: 0 },
    contexto: { wiki: null, versaoAnvilore: "", plataforma: process.platform, bun: Bun.version },
    saude: { erros: {} },
  };
}
function percentagem(parte: number, total: number): number { return total === 0 ? 0 : Math.round((parte / total) * 1000) / 10; }
function percentil(valores: number[], p: number): number {
  if (!valores.length) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  return ordenados[Math.max(0, Math.ceil(p * ordenados.length) - 1)] ?? 0;
}
function semana(isoDia: string): string {
  const d = new Date(`${isoDia}T12:00:00Z`); const dia = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dia);
  return d.toISOString().slice(0, 10);
}

export function abrirMetricas(arquivoDb: string, ligadas = process.env.ANVILORE_METRICAS !== "0"): RegistroDeMetricas {
  function registrar(c: Chamada, agora = new Date()): void {
    if (!ligadas) return;
    const db = dbAberto(arquivoDb);
    try {
      db.exec("BEGIN IMMEDIATE");
      db.query("INSERT INTO chamadas(hora, tool, ms, bytes, resultados, vazia, palavras, explicita, filtros, manual, verificada, rascunho, com_aviso, reindexadas, ms_reindexacao, erro, cliente_nome, cliente_versao, conexao, posicao_lida, vencidas, lacunas, contradicoes, busca_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        dataLocal(agora), c.tool, numero(c.ms), Math.trunc(numero(c.bytes)), Math.trunc(numero(c.resultados)), Number(c.vazia), Math.trunc(numero(c.palavras)), Number(c.explicita),
        JSON.stringify([...new Set(c.filtros.filter((x) => FILTROS.has(x)))]), Math.trunc(numero(c.porEstado.manual)), Math.trunc(numero(c.porEstado.verificada)), Math.trunc(numero(c.porEstado.rascunho)),
        Math.trunc(numero(c.comAviso)), Math.trunc(numero(c.reindexadas)), numero(c.msReindexacao), c.erro && ERROS.has(c.erro) ? c.erro : c.erro ? "erro_interno" : null,
        c.cliente?.nome.slice(0, 80) ?? null, c.cliente?.versao.slice(0, 80) ?? null, c.conexao.slice(0, 80), c.posicaoLida == null ? null : Math.max(1, Math.trunc(numero(c.posicaoLida))),
        Math.trunc(numero(c.vencidas ?? 0)), Math.trunc(numero(c.lacunas ?? 0)), Math.trunc(numero(c.contradicoes ?? 0)), c.buscaId?.slice(0, 80) ?? null,
      );
      const corte = new Date(agora.getTime() - 180 * 24 * 60 * 60 * 1000);
      db.query("DELETE FROM chamadas WHERE hora < ?").run(dataLocal(corte));
      db.exec("COMMIT");
    } catch (erro) { db.exec("ROLLBACK"); throw erro; }
    finally { db.close(); }
  }

  function resumo(desde?: Date): RelatorioMetricas {
    if (!ligadas && !existsSync(arquivoDb)) return vazio();
    if (!ligadas) return vazio();
    const db = dbAberto(arquivoDb);
    try {
      const rows = (desde
        ? db.query("SELECT * FROM chamadas WHERE substr(hora, 1, 10) >= ? ORDER BY hora").all(dataLocal(desde).slice(0, 10))
        : db.query("SELECT * FROM chamadas ORDER BY hora").all()) as Array<Record<string, string | number | null>>;
      const r = vazio(); r.totalChamadas = rows.length;
      const buscas = rows.filter((x) => x.tool === "buscar"); const leituras = rows.filter((x) => x.tool === "ler"); const indexacoes = rows.filter((x) => x.tool === "indexar");
      r.uso.buscas = buscas.length; r.uso.leituras = leituras.length; r.uso.indexacoes = indexacoes.length;
      const dias = new Map<string, number>();
      for (const item of buscas) { const dia = String(item.hora).slice(0, 10); dias.set(dia, (dias.get(dia) ?? 0) + 1); }
      r.uso.porDia = [...dias].sort(([a], [b]) => a.localeCompare(b)).map(([dia, n]) => ({ dia, buscas: n }));
      const semanas = new Map<string, Set<string>>();
      for (const dia of dias.keys()) { const chave = semana(dia); const ativos = semanas.get(chave) ?? new Set<string>(); ativos.add(dia); semanas.set(chave, ativos); }
      r.uso.diasComUsoPorSemana = [...semanas].sort(([a], [b]) => a.localeCompare(b)).map(([semana, ativos]) => ({ semana, dias: ativos.size }));
      const clientes = new Map<string, { nome: string; versao: string; chamadas: number }>();
      for (const item of rows) if (item.cliente_nome) {
        const nome = String(item.cliente_nome); const versao = String(item.cliente_versao ?? ""); const chave = `${nome}\0${versao}`;
        const registro = clientes.get(chave) ?? { nome, versao, chamadas: 0 }; registro.chamadas++; clientes.set(chave, registro);
      }
      r.uso.porCliente = [...clientes.values()].sort((a, b) => a.nome.localeCompare(b.nome));
      const vazias = buscas.filter((x) => x.vazia === 1).length;
      const idsLidos = new Set(leituras.filter((x) => x.posicao_lida !== null && x.busca_id !== null).map((x) => String(x.busca_id)));
      r.acerto.buscasSeguidasDeLer = idsLidos.size || Math.min(buscas.length, leituras.filter((x) => x.posicao_lida !== null).length);
      r.acerto.percentualSeguidasDeLer = percentagem(r.acerto.buscasSeguidasDeLer, buscas.length);
      for (const item of leituras) {
        const pos = Number(item.posicao_lida ?? 0);
        if (pos === 1) r.acerto.posicoes.primeiro++;
        else if (pos === 2) r.acerto.posicoes.segundo++;
        else if (pos >= 3 && pos <= 5) r.acerto.posicoes.terceiroAQuinto++;
        else if (pos > 5) r.acerto.posicoes.acimaDeCinco++;
      }
      r.lacuna = { buscasVazias: vazias, percentualBuscasVazias: percentagem(vazias, buscas.length) };
      const custo = (tool: "buscar" | "ler"): CustoMetricas => {
        const itens = rows.filter((x) => x.tool === tool); const bytes = itens.map((x) => Number(x.bytes)); const ms = itens.map((x) => Number(x.ms));
        return { bytesMedios: bytes.length ? Math.round(bytes.reduce((a, b) => a + b, 0) / bytes.length) : 0, p95Bytes: percentil(bytes, 0.95), medianaMs: percentil(ms, 0.5), p95Ms: percentil(ms, 0.95) };
      };
      r.custo.buscar = custo("buscar"); r.custo.ler = custo("ler");
      r.custo.reindexadas = rows.reduce((n, x) => n + Number(x.reindexadas), 0); r.custo.msReindexacao = rows.reduce((n, x) => n + Number(x.ms_reindexacao), 0);
      for (const item of rows) {
        r.confianca.porEstado.manual += Number(item.manual); r.confianca.porEstado.verificada += Number(item.verificada); r.confianca.porEstado.rascunho += Number(item.rascunho);
        r.confianca.comAviso += Number(item.com_aviso);
        r.confianca.vencidas += Number(item.vencidas ?? 0); r.confianca.lacunas += Number(item.lacunas ?? 0); r.confianca.contradicoes += Number(item.contradicoes ?? 0);
        if (item.erro) r.saude.erros[String(item.erro)] = (r.saude.erros[String(item.erro)] ?? 0) + 1;
      }
      const totalResultados = Object.values(r.confianca.porEstado).reduce((a, b) => a + b, 0);
      for (const estado of ["manual", "verificada", "rascunho"] as const) r.confianca.percentualPorEstado[estado] = percentagem(r.confianca.porEstado[estado], totalResultados);
      r.confianca.percentualVencidas = percentagem(r.confianca.vencidas, totalResultados);
      r.confianca.percentualComAviso = percentagem(r.confianca.comAviso, totalResultados);
      return r;
    } finally { db.close(); }
  }

  function limpar(): void {
    if (!ligadas || !existsSync(arquivoDb)) return;
    const db = dbAberto(arquivoDb);
    try { db.exec("DELETE FROM chamadas; PRAGMA wal_checkpoint(TRUNCATE)"); }
    finally { db.close(); }
    rmSync(`${arquivoDb}-wal`, { force: true });
  }
  return { registrar, resumo, limpar };
}
