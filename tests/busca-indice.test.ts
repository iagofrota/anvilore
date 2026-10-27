import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync, renameSync } from "node:fs";
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
  try { expect(reconstruido.query("PRAGMA user_version").get()).toEqual({ user_version: 1 }); expect(reconstruido.query("SELECT count(*) AS n FROM paginas").get()).toEqual({ n: 0 }); }
  finally { reconstruido.close(); }
});

test("Dado duas conexões concorrentes, Quando sincronizam, Então não duplicam seções", async () => {
  const f = fixture(); pagina(join(f.wiki, "a.md"), "## um\n## dois"); const db1 = abrirIndice(f.db); const db2 = abrirIndice(f.db);
  try {
    await Promise.all([sincronizar(db1, f.wiki, f.raiz), sincronizar(db2, f.wiki, f.raiz)]);
    expect(db1.query("SELECT count(*) AS n FROM secoes").get()).toEqual({ n: 2 });
  } finally { db1.close(); db2.close(); }
});
