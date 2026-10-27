import { Database } from "bun:sqlite";
import { mkdirSync, statSync } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";
import { estadoDaPagina } from "./estado";
import { secoesDe } from "./secoes";
import { lerUtf8Estrito, lerUtf8EstritoSync } from "../lib/utf8";
import { paginasMarkdown } from "../lib/paginas";

export const VERSAO_ESQUEMA = 1;
export type RelatorioIndexacao = { paginas: number; secoes: number; reindexadas: number; removidas: number; puladas: number; ms: number };

function criarEsquema(db: Database): void {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("CREATE TABLE paginas (caminho TEXT PRIMARY KEY, mtime REAL NOT NULL, tamanho INTEGER NOT NULL, slug TEXT, titulo TEXT, tipo TEXT, area TEXT, estado TEXT NOT NULL, vencida INTEGER NOT NULL, categoria TEXT NOT NULL)");
  db.exec("CREATE TABLE secoes (id INTEGER PRIMARY KEY, caminho TEXT NOT NULL REFERENCES paginas(caminho) ON DELETE CASCADE, secao TEXT NOT NULL, linha_inicio INTEGER NOT NULL, linha_fim INTEGER NOT NULL, avisos TEXT NOT NULL, titulo TEXT NOT NULL, corpo TEXT NOT NULL, caminho_fts TEXT NOT NULL)");
  db.exec('CREATE VIRTUAL TABLE secoes_fts USING fts5(titulo, corpo, caminho, content="secoes", content_rowid="id", tokenize="unicode61 remove_diacritics 2")');
  db.exec(`CREATE TRIGGER secoes_ai AFTER INSERT ON secoes BEGIN
    INSERT INTO secoes_fts(rowid, titulo, corpo, caminho) VALUES (new.id, new.titulo, new.corpo, new.caminho_fts);
  END`);
  db.exec(`CREATE TRIGGER secoes_ad AFTER DELETE ON secoes BEGIN
    INSERT INTO secoes_fts(secoes_fts, rowid, titulo, corpo, caminho) VALUES ('delete', old.id, old.titulo, old.corpo, old.caminho_fts);
  END`);
  db.exec(`CREATE TRIGGER secoes_au AFTER UPDATE ON secoes BEGIN
    INSERT INTO secoes_fts(secoes_fts, rowid, titulo, corpo, caminho) VALUES ('delete', old.id, old.titulo, old.corpo, old.caminho_fts);
    INSERT INTO secoes_fts(rowid, titulo, corpo, caminho) VALUES (new.id, new.titulo, new.corpo, new.caminho_fts);
  END`);
  db.exec(`CREATE TRIGGER paginas_ad AFTER DELETE ON paginas BEGIN DELETE FROM secoes WHERE caminho = old.caminho; END`);
  db.exec(`PRAGMA user_version = ${VERSAO_ESQUEMA}`);
}

export function abrirIndice(arquivoDb: string): Database {
  mkdirSync(resolve(arquivoDb, ".."), { recursive: true });
  const db = new Database(arquivoDb, { create: true });
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");
  const versao = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (versao !== VERSAO_ESQUEMA) {
    db.exec("DROP TRIGGER IF EXISTS secoes_ai; DROP TRIGGER IF EXISTS secoes_ad; DROP TRIGGER IF EXISTS secoes_au; DROP TRIGGER IF EXISTS paginas_ad; DROP TABLE IF EXISTS secoes_fts; DROP TABLE IF EXISTS secoes; DROP TABLE IF EXISTS paginas;");
    criarEsquema(db);
  }
  return db;
}

type ArquivoLista = { arquivo: string; caminho: string };

function listar(wiki: string, arquivos: string[]): ArquivoLista[] {
  return arquivos.map((arquivo) => ({
    arquivo,
    caminho: relative(wiki, arquivo).split(sep).join("/").normalize("NFC"),
  }));
}

function categoria(caminho: string): "conteudo" | "log" | "meta" {
  if (caminho === "log.md" || caminho.startsWith("log/")) return "log";
  if (caminho === "index.md" || caminho.startsWith("_meta/")) return "meta";
  return "conteudo";
}

function comoTexto(valor: unknown): string | null {
  return typeof valor === "string" && valor.length > 0 ? valor.normalize("NFC") : null;
}

function caminhoFts(caminho: string): string {
  return caminho.replace(/[\/_-]|\.md/gi, " ").normalize("NFC");
}

export async function sincronizar(
  db: Database,
  wiki: string,
  raiz: string,
  opcoes: { completo?: boolean; agora?: Date } = {},
): Promise<RelatorioIndexacao> {
  const inicio = Date.now();
  const absolutoWiki = resolve(wiki);
  let arquivos: string[];
  try {
    arquivos = await paginasMarkdown(absolutoWiki);
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === "ENOENT") return { paginas: 0, secoes: 0, reindexadas: 0, removidas: 0, puladas: 0, ms: Date.now() - inicio };
    throw erro;
  }
  const entradas = listar(absolutoWiki, arquivos);
  const prepararAgora = new Map<string, { mtime: number; tamanho: number; conteudo?: string; erro?: true }>();
  const metadadosAtuais = new Map((db.query("SELECT caminho, mtime, tamanho FROM paginas").all() as { caminho: string; mtime: number; tamanho: number }[]).map((linha) => [linha.caminho, linha]));
  await Promise.all(entradas.map(async (entrada) => {
    try {
      const stat = statSync(entrada.arquivo);
      const salvo = metadadosAtuais.get(entrada.caminho);
      if (!opcoes.completo && salvo?.mtime === stat.mtimeMs && salvo.tamanho === stat.size) return;
      prepararAgora.set(entrada.caminho, { mtime: stat.mtimeMs, tamanho: stat.size, conteudo: (await lerUtf8Estrito(entrada.arquivo)).normalize("NFC") });
    } catch {
      prepararAgora.set(entrada.caminho, { mtime: 0, tamanho: 0, erro: true });
    }
  }));
  let puladas = 0;
  let reindexadas = 0;
  let removidas = 0;

  db.exec("BEGIN IMMEDIATE");
  try {
    const vistas = new Set(entradas.map((entrada) => entrada.caminho));
    const existentes = db.query("SELECT caminho FROM paginas").all() as { caminho: string }[];
    for (const existente of existentes) {
      if (!vistas.has(existente.caminho)) {
        db.query("DELETE FROM paginas WHERE caminho = ?").run(existente.caminho);
        removidas++;
      }
    }

    const porCaminho = db.query("SELECT mtime, tamanho FROM paginas WHERE caminho = ?");
    const atualizarPagina = db.query("INSERT INTO paginas(caminho, mtime, tamanho, slug, titulo, tipo, area, estado, vencida, categoria) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(caminho) DO UPDATE SET mtime=excluded.mtime, tamanho=excluded.tamanho, slug=excluded.slug, titulo=excluded.titulo, tipo=excluded.tipo, area=excluded.area, estado=excluded.estado, vencida=excluded.vencida, categoria=excluded.categoria");
    const inserirSecao = db.query("INSERT INTO secoes(caminho, secao, linha_inicio, linha_fim, avisos, titulo, corpo, caminho_fts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");

    for (const entrada of entradas) {
      let tamanho: number;
      let mtime: number;
      let conteudo: string;
      try {
        const info = statSync(entrada.arquivo);
        tamanho = info.size;
        mtime = info.mtimeMs;
        const anterior = porCaminho.get(entrada.caminho) as { mtime: number; tamanho: number } | null;
        if (!opcoes.completo && anterior?.mtime === mtime && anterior.tamanho === tamanho) continue;
        const preparado = prepararAgora.get(entrada.caminho);
        if (preparado?.erro) throw new Error("arquivo não pôde ser lido");
        if (preparado && preparado.mtime === mtime && preparado.tamanho === tamanho && preparado.conteudo !== undefined) {
          conteudo = preparado.conteudo;
        } else {
          conteudo = lerUtf8EstritoSync(entrada.arquivo).normalize("NFC");
        }
      } catch {
        puladas++;
        db.query("DELETE FROM paginas WHERE caminho = ?").run(entrada.caminho);
        continue;
      }

      const relativoRaiz = relative(resolve(raiz), entrada.arquivo).split(sep).join("/");
      const infoPagina = estadoDaPagina(conteudo, relativoRaiz, raiz, opcoes.agora);
      const fm = infoPagina.frontmatter ?? {};
      const slug = comoTexto(fm.slug) ?? basename(entrada.caminho, ".md");
      const titulo = comoTexto(fm.title) ?? slug;
      atualizarPagina.run(entrada.caminho, mtime, tamanho, slug, titulo, comoTexto(fm.type), comoTexto(fm.area), infoPagina.estado, Number(infoPagina.vencida), categoria(entrada.caminho));
      db.query("DELETE FROM secoes WHERE caminho = ?").run(entrada.caminho);
      for (const secao of secoesDe(conteudo, titulo)) {
        const tituloSecao = `${titulo} ${secao.secao}`.normalize("NFC");
        inserirSecao.run(entrada.caminho, secao.secao, secao.linhaInicio, secao.linhaFim, secao.avisos.join(","), tituloSecao, secao.corpo, caminhoFts(entrada.caminho));
      }
      reindexadas++;
    }
    db.exec("COMMIT");
  } catch (erro) {
    db.exec("ROLLBACK");
    throw erro;
  }

  const paginas = (db.query("SELECT count(*) AS n FROM paginas").get() as { n: number }).n;
  const secoes = (db.query("SELECT count(*) AS n FROM secoes").get() as { n: number }).n;
  return { paginas, secoes, reindexadas, removidas, puladas, ms: Date.now() - inicio };
}
