import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";

test("Dado FTS5 com tokenizer unicode61, Quando busca termos sem acento, Então encontra créditos, alíquotas e tributos", () => {
  const db = new Database(":memory:");
  try {
    db.exec('CREATE VIRTUAL TABLE fts5 USING fts5(titulo, corpo, tokenize="unicode61 remove_diacritics 2")');
    const inserir = db.query("INSERT INTO fts5(titulo, corpo) VALUES (?, ?)");
    inserir.run("Créditos", "As alíquotas do IBS/CBS e o crédito pré-pago");
    inserir.run("Tributação", "Tributação sobre consumo");
    for (const termo of ["aliquota*", "credito*", "IBS", "pago", "tributacao"]) {
      expect(db.query("SELECT count(*) AS n FROM fts5 WHERE fts5 MATCH ?").get(termo)).toEqual({ n: 1 });
    }
  } finally {
    db.close();
  }
});

test("Dado duas ocorrências em título e corpo, Quando aplica bm25 com pesos, Então prioriza o título", () => {
  const db = new Database(":memory:");
  try {
    db.exec('CREATE VIRTUAL TABLE t USING fts5(titulo, corpo, tokenize="unicode61 remove_diacritics 2")');
    db.query("INSERT INTO t(titulo, corpo) VALUES (?, ?)").run("outro", "termo raro");
    db.query("INSERT INTO t(titulo, corpo) VALUES (?, ?)").run("termo raro", "outro");
    const rows = db.query("SELECT titulo, bm25(t, 5.0, 1.0) AS score FROM t WHERE t MATCH 'raro' ORDER BY score").all() as {titulo: string}[];
    expect(rows[0]?.titulo).toBe("termo raro");
  } finally {
    db.close();
  }
});

test("Dado FTS5 unicode61, Quando grava NFC e NFD, Então cada forma encontra a outra", () => {
  const db = new Database(":memory:");
  try {
    db.exec('CREATE VIRTUAL TABLE t USING fts5(corpo, tokenize="unicode61 remove_diacritics 2")');
    const inserir = db.query("INSERT INTO t(corpo) VALUES (?)");
    inserir.run("alíquota");
    inserir.run("tributação");
    expect(db.query("SELECT count(*) AS n FROM t WHERE t MATCH 'aliquota'").get()).toEqual({ n: 1 });
    expect(db.query("SELECT count(*) AS n FROM t WHERE t MATCH 'tributação'").get()).toEqual({ n: 1 });
  } finally {
    db.close();
  }
});

test("Dado FTS5 snippet, Quando extrai trecho com marcadores neutros, Então preserva o termo destacado", () => {
  const db = new Database(":memory:");
  try {
    db.exec('CREATE VIRTUAL TABLE t USING fts5(titulo, corpo, tokenize="unicode61 remove_diacritics 2")');
    db.query("INSERT INTO t(titulo, corpo) VALUES (?, ?)").run("Tributos", "As alíquotas do IBS e CBS");
    const result = db.query("SELECT snippet(t,1,char(30),char(31),'…',8) AS trecho FROM t WHERE t MATCH 'aliquota*'").get() as {trecho: string};
    expect(result.trecho).toContain("\x1ealíquotas\x1f");
  } finally {
    db.close();
  }
});
