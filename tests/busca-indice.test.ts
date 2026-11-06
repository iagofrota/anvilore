import { afterEach, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync, renameSync, symlinkSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrirIndice, sincronizar } from "../src/busca/indice";

const temporarios: string[] = [];
afterEach(() => { for (const dir of temporarios.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture(): { raiz: string; wiki: string; db: string } {
  const raiz = mkdtempSync(join(tmpdir(), "anvilore-indice-"));
  temporarios.push(raiz);
  const wiki = join(raiz, "wiki");
  mkdirSync(wiki);
  return { raiz, wiki, db: join(raiz, ".anvilore", "indice.db") };
}

function pagina(caminho: string, corpo = "## Uma\nconteúdo único"): void {
  mkdirSync(join(caminho, ".."), { recursive: true });
  writeFileSync(caminho, `---\ntitle: Página\nslug: página\ntype: concept\narea: tributos\n---\n${corpo}\n`);
}

test("Dado wiki com seções, Quando sincroniza pela primeira vez, Então indexa todas as seções", async () => {
  const f = fixture();
  pagina(join(f.wiki, "a.md"), "intro\n## Uma\nconteúdo exclusivo\n### Duas\nb");
  const db = abrirIndice(f.db);
  try {
    expect(await sincronizar(db, f.wiki, f.raiz)).toMatchObject({ paginas: 1, secoes: 3, reindexadas: 1, removidas: 0, puladas: 0 });
    expect(db.query("SELECT count(*) AS n FROM secoes_fts WHERE secoes_fts MATCH 'exclusivo'").get()).toEqual({ n: 1 });
  } finally { db.close(); }
});

test("Dado symlink .md para fora da wiki, Quando indexa, Então ignora o alvo e avisa", async () => {
  if (process.platform === "win32") return;
  const f = fixture(); const fora = join(f.raiz, "segredo.md"); pagina(fora, "## Chave privada\nsegredo ssh");
  try { symlinkSync(fora, join(f.wiki, "segredo.md")); } catch { return; }
  const avisos = spyOn(console, "error").mockImplementation(() => {});
  const db = abrirIndice(f.db);
  try {
    await sincronizar(db, f.wiki, f.raiz);
    expect(db.query("SELECT count(*) AS n FROM secoes_fts WHERE secoes_fts MATCH 'ssh'").get()).toEqual({ n: 0 });
    expect(avisos).toHaveBeenCalledWith(expect.stringContaining("symlink fora da wiki"));
  } finally { avisos.mockRestore(); db.close(); }
});

test("Dado symlink .md interno, Quando indexa, Então usa apenas o caminho canônico do alvo", async () => {
  if (process.platform === "win32") return;
  const f = fixture(); pagina(join(f.wiki, "legitima.md"), "## Tema\ntermo interno"); mkdirSync(join(f.wiki, "sub"));
  symlinkSync(join(f.wiki, "legitima.md"), join(f.wiki, "sub", "interno.md"));
  const db = abrirIndice(f.db);
  try {
    await sincronizar(db, f.wiki, f.raiz);
    expect(db.query("SELECT caminho FROM paginas").all()).toEqual([{ caminho: "legitima.md" }]);
    expect(db.query("SELECT caminho FROM secoes").all()).toEqual([{ caminho: "legitima.md" }]);
  } finally { db.close(); }
});

test("Dado raiz da wiki alcançada por symlink, Quando indexa, Então caminhos seguem relativos à raiz real", async () => {
  if (process.platform === "win32") return;
  const f = fixture(); pagina(join(f.wiki, "normal.md"));
  const apelido = join(f.raiz, "wiki-link"); symlinkSync(f.wiki, apelido);
  const db = abrirIndice(f.db);
  try {
    await sincronizar(db, apelido, f.raiz);
    expect(db.query("SELECT caminho FROM paginas").all()).toEqual([{ caminho: "normal.md" }]);
  } finally { db.close(); }
});

test("Dado índice atualizado, Quando não há mudanças, Então não reindexa", async () => {
  const f = fixture(); pagina(join(f.wiki, "a.md")); const db = abrirIndice(f.db);
  try { await sincronizar(db, f.wiki, f.raiz); expect((await sincronizar(db, f.wiki, f.raiz)).reindexadas).toBe(0); }
  finally { db.close(); }
});

test("Dado página editada, Quando muda mtime, Então reindexa somente ela", async () => {
  const f = fixture(); pagina(join(f.wiki, "a.md")); pagina(join(f.wiki, "b.md")); const db = abrirIndice(f.db);
  try {
    await sincronizar(db, f.wiki, f.raiz);
    const arquivo = join(f.wiki, "a.md"); utimesSync(arquivo, new Date(), new Date(Date.now() + 5000));
    expect((await sincronizar(db, f.wiki, f.raiz)).reindexadas).toBe(1);
  } finally { db.close(); }
});

test("Dado página apagada, Quando sincroniza novamente, Então remove índice obsoleto", async () => {
  const f = fixture(); pagina(join(f.wiki, "a.md")); const db = abrirIndice(f.db);
  try { await sincronizar(db, f.wiki, f.raiz); rmSync(join(f.wiki, "a.md")); expect((await sincronizar(db, f.wiki, f.raiz)).removidas).toBe(1); }
  finally { db.close(); }
});

test("Dado página renomeada, Quando sincroniza, Então remove o caminho anterior", async () => {
  const f = fixture(); pagina(join(f.wiki, "a.md")); const db = abrirIndice(f.db);
  try { await sincronizar(db, f.wiki, f.raiz); renameSync(join(f.wiki, "a.md"), join(f.wiki, "b.md")); await sincronizar(db, f.wiki, f.raiz); expect(db.query("SELECT caminho FROM paginas").all()).toEqual([{ caminho: "b.md" }]); }
  finally { db.close(); }
});

test("Dado wiki com .gitignore global, Quando sincroniza, Então indexa a página ignorada pelo Git", async () => {
  const f = fixture(); writeFileSync(join(f.wiki, ".gitignore"), "*\n"); pagina(join(f.wiki, "a.md")); const db = abrirIndice(f.db);
  try { await sincronizar(db, f.wiki, f.raiz); expect(db.query("SELECT count(*) AS n FROM paginas").get()).toEqual({ n: 1 }); }
  finally { db.close(); }
});

test("Dado frontmatter malformado, Quando sincroniza, Então indexa como rascunho sem lançar", async () => {
  const f = fixture(); writeFileSync(join(f.wiki, "a.md"), "---\nx: [\n---\n## tema\ntexto"); const db = abrirIndice(f.db);
  try { await sincronizar(db, f.wiki, f.raiz); expect(db.query("SELECT estado FROM paginas").get()).toEqual({ estado: "rascunho" }); }
  finally { db.close(); }
});

test("Dado UTF-8 inválido, Quando sincroniza, Então pula e conta a página", async () => {
  const f = fixture(); writeFileSync(join(f.wiki, "a.md"), new Uint8Array([0xC3, 0x28])); const db = abrirIndice(f.db);
  try { expect((await sincronizar(db, f.wiki, f.raiz)).puladas).toBe(1); expect(db.query("SELECT count(*) AS n FROM paginas").get()).toEqual({ n: 0 }); }
  finally { db.close(); }
});

test("Dado arquivo Markdown de 5 MB, Quando sincroniza, Então indexa sem corte", async () => {
  const f = fixture(); writeFileSync(join(f.wiki, "a.md"), `## enorme\n${"x".repeat(5 * 1024 * 1024)}`); const db = abrirIndice(f.db);
  try { expect((await sincronizar(db, f.wiki, f.raiz)).secoes).toBe(1); expect(db.query("SELECT length(corpo) AS n FROM secoes").get()).toEqual({ n: 5 * 1024 * 1024 }); }
  finally { db.close(); }
});

test("Dado log, _meta e índice principal, Quando indexa, Então atribui categorias", async () => {
  const f = fixture(); mkdirSync(join(f.wiki, "log")); mkdirSync(join(f.wiki, "_meta"));
  pagina(join(f.wiki, "log.md")); pagina(join(f.wiki, "log", "dia.md")); pagina(join(f.wiki, "_meta", "cache.md")); pagina(join(f.wiki, "index.md")); pagina(join(f.wiki, "normal.md")); const db = abrirIndice(f.db);
  try { await sincronizar(db, f.wiki, f.raiz); expect(db.query("SELECT caminho, categoria FROM paginas ORDER BY caminho").all()).toEqual([{ caminho: "_meta/cache.md", categoria: "meta" }, { caminho: "index.md", categoria: "meta" }, { caminho: "log.md", categoria: "log" }, { caminho: "log/dia.md", categoria: "log" }, { caminho: "normal.md", categoria: "conteudo" }]); }
  finally { db.close(); }
});

test("Dado nome de arquivo NFD, Quando indexa, Então armazena o caminho em NFC", async () => {
  const f = fixture(); pagina(join(f.wiki, "tributac\u0327a\u0303o.md")); const db = abrirIndice(f.db);
  try { await sincronizar(db, f.wiki, f.raiz); expect(db.query("SELECT caminho FROM paginas").get()).toEqual({ caminho: "tributação.md" }); }
  finally { db.close(); }
});

test("Dado versão de esquema diferente, Quando abre o índice, Então reconstrói o esquema", () => {
  const f = fixture(); mkdirSync(join(f.raiz, ".anvilore")); const db = new Database(f.db); db.exec("PRAGMA user_version = 999"); db.close();
  const reconstruido = abrirIndice(f.db);
  try { expect(reconstruido.query("PRAGMA user_version").get()).toEqual({ user_version: 3 }); expect(reconstruido.query("SELECT count(*) AS n FROM paginas").get()).toEqual({ n: 0 }); }
  finally { reconstruido.close(); }
});

test("Dado índice na versão 2 com página anteriormente verificada que a regra nova classifica como rascunho, Quando indexa incrementalmente, Então reconstrói o índice e reclassifica como rascunho", async () => {
  const f = fixture();
  const textoPagina = "---\ntitle: Antiga\ngenerated:\n  by: claude/3.5\nverified:\n  by: human:iago\n---\n## Conteúdo\ntexto da página";
  const caminhoArquivo = join(f.wiki, "antiga.md");
  writeFileSync(caminhoArquivo, textoPagina);
  const st = statSync(caminhoArquivo);

  mkdirSync(join(f.raiz, ".anvilore"), { recursive: true });
  const dbV2 = new Database(f.db);
  dbV2.exec("PRAGMA foreign_keys = ON");
  dbV2.exec("CREATE TABLE paginas (caminho TEXT PRIMARY KEY, mtime REAL NOT NULL, tamanho INTEGER NOT NULL, slug TEXT, titulo TEXT, tipo TEXT, area TEXT, estado TEXT NOT NULL, vencida INTEGER NOT NULL, stale_after TEXT, categoria TEXT NOT NULL)");
  dbV2.exec("CREATE TABLE secoes (id INTEGER PRIMARY KEY, caminho TEXT NOT NULL REFERENCES paginas(caminho) ON DELETE CASCADE, secao TEXT NOT NULL, linha_inicio INTEGER NOT NULL, linha_fim INTEGER NOT NULL, avisos TEXT NOT NULL, titulo TEXT NOT NULL, corpo TEXT NOT NULL, caminho_fts TEXT NOT NULL)");
  dbV2.exec('CREATE VIRTUAL TABLE secoes_fts USING fts5(titulo, corpo, caminho, content="secoes", content_rowid="id", tokenize="unicode61 remove_diacritics 2")');
  dbV2.run("INSERT INTO paginas (caminho, mtime, tamanho, slug, titulo, tipo, area, estado, vencida, stale_after, categoria) VALUES ('antiga.md', ?, ?, 'antiga', 'Antiga', 'concept', 'tributos', 'verificada', 0, NULL, 'conteudo')", [
    st.mtimeMs,
    st.size,
  ]);
  dbV2.exec("PRAGMA user_version = 2");
  dbV2.close();

  const db = abrirIndice(f.db);
  try {
    await sincronizar(db, f.wiki, f.raiz);
    const registro = db.query("SELECT estado FROM paginas WHERE caminho = 'antiga.md'").get() as { estado: string } | null;
    expect(registro?.estado).toBe("rascunho");
  } finally {
    db.close();
  }
});

test("Dado versão antiga com objeto incompatível, Quando recria o esquema, Então desfaz a transação e falha", () => {
  const f = fixture(); mkdirSync(join(f.raiz, ".anvilore")); const original = new Database(f.db);
  original.exec("CREATE VIEW paginas AS SELECT 1 AS conflito; PRAGMA user_version = 999"); original.close();
  expect(() => abrirIndice(f.db)).toThrow();
  const preservado = new Database(f.db);
  try { expect(preservado.query("PRAGMA user_version").get()).toEqual({ user_version: 999 }); }
  finally { preservado.close(); }
});

test("Dado duas conexões concorrentes, Quando sincronizam, Então não duplicam seções", async () => {
  const f = fixture(); pagina(join(f.wiki, "a.md"), "## um\n## dois"); const db1 = abrirIndice(f.db); const db2 = abrirIndice(f.db);
  try {
    await Promise.all([sincronizar(db1, f.wiki, f.raiz), sincronizar(db2, f.wiki, f.raiz)]);
    expect(db1.query("SELECT count(*) AS n FROM secoes").get()).toEqual({ n: 2 });
  } finally { db1.close(); db2.close(); }
});

test("Dado oito processos abrindo banco SQLite novo ao mesmo tempo, Quando inicializam o índice, Então todos completam", async () => {
  for (let rodada = 0; rodada < 3; rodada++) {
    const f = fixture();
    const modulo = new URL("../src/busca/indice.ts", import.meta.url).href;
    const codigo = `import { abrirIndice } from ${JSON.stringify(modulo)}; const db = abrirIndice(process.argv[1]!); db.close();`;
    const processos = Array.from({ length: 8 }, () => Bun.spawn([process.execPath, "-e", codigo, f.db], { stdout: "pipe", stderr: "pipe" }));
    const resultados = await Promise.all(processos.map(async (processo) => {
      const [saida, erro, codigoSaida] = await Promise.all([new Response(processo.stdout).text(), new Response(processo.stderr).text(), processo.exited]);
      return { codigo: codigoSaida, saida, erro };
    }));
    expect(resultados.filter((resultado) => resultado.codigo !== 0)).toEqual([]);
  }
});
