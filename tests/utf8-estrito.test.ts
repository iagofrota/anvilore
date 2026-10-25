import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ErroDeEncoding, decodificarUtf8, lerUtf8Estrito, lerUtf8EstritoSync } from "../src/lib/utf8";
import { comandoIndexarLog } from "../src/comandos/indexar-log";
import { comandoListarLacunas } from "../src/comandos/listar-lacunas";
import { comandoSincronizarIndice } from "../src/comandos/sincronizar-indice";

// Regra da Onda 2: comando que reescreve ou copia texto de um arquivo não troca bytes inválidos por U+FFFD em silêncio.
// Latin-1 "café" = 63 61 66 E9; o script em bash preservava o byte E9, e ler como utf8 gravaria EF BF BD.
const E9 = Buffer.from([0xe9]);
const latin1 = (antes: string, depois: string) => Buffer.concat([Buffer.from(antes), E9, Buffer.from(depois)]);

let tmp: string;
let wiki: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "anvilore-utf8-"));
  wiki = join(tmp, "wiki");
  mkdirSync(wiki, { recursive: true });
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

function gravar(rel: string, conteudo: string | Buffer): string {
  const caminho = join(wiki, rel);
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, conteudo);
  return caminho;
}

async function capturar(corpo: () => Promise<number>) {
  const saida: string[] = [];
  const erro: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...a) => { saida.push(a.join(" ")); });
  const err = spyOn(console, "error").mockImplementation((...a) => { erro.push(a.join(" ")); });
  try {
    return { codigo: await corpo(), saida: saida.join("\n"), erro: erro.join("\n") };
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
}

describe("lib/utf8", () => {
  test("Dado bytes UTF-8 válidos, com acento e BOM, Quando decodifico, Então o texto sai inteiro e o BOM fica", () => {
    expect(decodificarUtf8(Buffer.from("café ção"), "a.md")).toBe("café ção");
    expect(decodificarUtf8(Buffer.from("﻿texto"), "a.md")).toBe("﻿texto");
  });

  test("Dado bytes Latin-1, Quando decodifico, Então lança ErroDeEncoding nomeando o arquivo", () => {
    try {
      decodificarUtf8(latin1("caf", ""), "wiki/a.md");
      throw new Error("deveria lançar");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroDeEncoding);
      expect((erro as Error).message).toContain("wiki/a.md");
      expect((erro as Error).message).toContain("UTF-8");
    }
  });

  test("Dado um arquivo Latin-1, Quando leio de forma síncrona ou assíncrona, Então as duas formas recusam", async () => {
    const caminho = gravar("x.md", latin1("caf", "\n"));
    expect(() => lerUtf8EstritoSync(caminho)).toThrow(ErroDeEncoding);
    await expect(lerUtf8Estrito(caminho)).rejects.toBeInstanceOf(ErroDeEncoding);
    const bom = gravar("ok.md", "café\n");
    expect(lerUtf8EstritoSync(bom)).toBe("café\n");
    expect(await lerUtf8Estrito(bom)).toBe("café\n");
  });
});

describe("sincronizar-indice: bytes que não são UTF-8", () => {
  const HEADER = "_1 página, 1 fonte, 1 entidade, 1 conceito — Última atualização: 2020-01-01_";
  const indice = (area: string) => join(wiki, area, "index.md");
  const conteudo = (titulo: Buffer | string) => Buffer.concat([Buffer.from("# Indice — "), Buffer.from(titulo), Buffer.from(`\n\n${HEADER}\n\n## Conceitos\n`)]);

  test("Dado índice de área em Latin-1 com header defasado, Quando sincronizo, Então reprova nomeando o arquivo, sai 1 e nada é escrito (nem nas outras áreas)", async () => {
    gravar("alfa/index.md", conteudo("alfa"));
    gravar("alfa/concepts/c.md", "x\n");
    const ruim = gravar("beta/index.md", conteudo(latin1("caf", "")));
    gravar("beta/concepts/c.md", "x\n");
    const antesAlfa = readFileSync(indice("alfa"));
    const antesBeta = readFileSync(ruim);
    const r = await capturar(() => comandoSincronizarIndice([wiki]));
    expect(r.codigo).toBe(1);
    expect(r.saida).toContain(`FAIL: ${ruim}`);
    expect(r.saida).toContain("UTF-8");
    expect(readFileSync(indice("alfa")).equals(antesAlfa)).toBe(true);
    expect(readFileSync(ruim).equals(antesBeta)).toBe(true);
  });

  test("Dado o mesmo índice Latin-1, Quando só checo (--checar), Então não falha por codificação e não escreve", async () => {
    const ruim = gravar("beta/index.md", conteudo(latin1("caf", "")));
    gravar("beta/concepts/c.md", "x\n");
    const antes = readFileSync(ruim);
    const r = await capturar(() => comandoSincronizarIndice([wiki, "--checar"]));
    expect(r.saida).not.toContain("UTF-8");
    expect(readFileSync(ruim).equals(antes)).toBe(true);
  });

  test("Dado índice UTF-8 com acento, Quando sincronizo, Então reescreve só o header e preserva os bytes do resto", async () => {
    const caminho = gravar("alfa/index.md", conteudo("café"));
    gravar("alfa/concepts/c.md", "x\n");
    const r = await capturar(() => comandoSincronizarIndice([wiki]));
    expect(r.codigo).toBe(0);
    expect(readFileSync(caminho, "utf8")).toContain("# Indice — café\n");
    expect(readFileSync(caminho, "utf8")).not.toContain("2020-01-01");
  });
});

describe("indexar-log: bytes que não são UTF-8", () => {
  test("Dado dia de log em Latin-1, Quando indexo, Então reprova nomeando o arquivo, sai 1 e não escreve o log.md", async () => {
    gravar("log/log-2026-09-01.md", "## [2026-09-01] ingest | Primeira\n");
    const ruim = gravar("log/log-2026-09-02.md", latin1("## [2026-09-02] caf", " | Segunda\n"));
    gravar("log.md", "# Log antigo\n");
    const r = await capturar(() => comandoIndexarLog([wiki]));
    expect(r.codigo).toBe(1);
    expect(r.erro).toContain(ruim);
    expect(r.erro).toContain("UTF-8");
    expect(readFileSync(join(wiki, "log.md"), "utf8")).toBe("# Log antigo\n");
  });

  test("Dado dia de log em Latin-1 e --stdout, Quando indexo, Então também reprova em vez de imprimir U+FFFD", async () => {
    gravar("log/log-2026-09-02.md", latin1("## [2026-09-02] caf", " | Segunda\n"));
    const r = await capturar(() => comandoIndexarLog([wiki, "--stdout"]));
    expect(r.codigo).toBe(1);
    expect(r.saida).not.toContain("�");
  });

  test("Dado dias de log em UTF-8 com acento, Quando indexo, Então o tipo acentuado sai intacto", async () => {
    gravar("log/log-2026-09-01.md", "## [2026-09-01] revisão | Passada\n");
    const r = await capturar(() => comandoIndexarLog([wiki]));
    expect(r.codigo).toBe(0);
    expect(readFileSync(join(wiki, "log.md"), "utf8")).toContain("revisão ×1");
  });
});

describe("listar-lacunas: bytes que não são UTF-8", () => {
  const pagina = (corpo: Buffer | string) => Buffer.concat([Buffer.from('---\ntitle: "x"\nslug: x\ntype: concept\ntags: []\n---\n\n'), Buffer.from(corpo)]);

  test("Dado página em Latin-1 com callout, Quando gero o relatório, Então reprova nomeando a página e não cria lacunas.md", async () => {
    gravar("ok.md", pagina("> [!gap] Falta X.\n"));
    const ruim = gravar("alfa/ruim.md", pagina(latin1("> [!gap] Falta caf", ".\n")));
    const r = await capturar(() => comandoListarLacunas([wiki]));
    expect(r.codigo).toBe(1);
    expect(r.erro).toContain(ruim);
    expect(r.erro).toContain("UTF-8");
    expect(existsSync(join(wiki, "_meta", "lacunas.md"))).toBe(false);
    expect(existsSync(join(wiki, "_meta"))).toBe(false);
  });

  test("Dado página em Latin-1 e --consultar, Quando listo, Então também reprova em vez de mostrar U+FFFD", async () => {
    gravar("alfa/ruim.md", pagina(latin1("> [!gap] Falta caf", ".\n")));
    const r = await capturar(() => comandoListarLacunas([wiki, "--consultar"]));
    expect(r.codigo).toBe(1);
    expect(r.saida).not.toContain("�");
  });

  test("Dado páginas UTF-8 com acento, Quando gero o relatório, Então o texto do callout sai intacto", async () => {
    gravar("ok.md", pagina("> [!gap] Falta o café.\n"));
    const r = await capturar(() => comandoListarLacunas([wiki]));
    expect(r.codigo).toBe(0);
    expect(readFileSync(join(wiki, "_meta", "lacunas.md"), "utf8")).toContain("Falta o café.");
    expect(readdirSync(join(wiki, "_meta"))).toEqual(["lacunas.md"]);
  });
});
