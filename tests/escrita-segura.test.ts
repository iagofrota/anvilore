import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ErroDeEscritaSegura,
  gravarArquivoWiki,
  gravarArquivoWikiSync,
  podeGravarNaWiki,
  validarDiretorioWiki,
  validarEscritaNaWiki,
  validarLeituraNaWiki,
} from "../src/lib/escrita-segura";

let temporario: string;
let wiki: string;
let raw: string;
let fora: string;

const semLink = process.platform === "win32";

beforeEach(() => {
  temporario = mkdtempSync(join(tmpdir(), "anvilore-escrita-segura-"));
  wiki = join(temporario, "wiki");
  raw = join(temporario, "raw");
  fora = join(temporario, "fora");
  mkdirSync(wiki, { recursive: true });
  mkdirSync(raw, { recursive: true });
  mkdirSync(fora, { recursive: true });
});

afterEach(() => {
  rmSync(temporario, { recursive: true, force: true });
});

describe("validarEscritaNaWiki", () => {
  test("Dado raiz da wiki inexistente, Quando valido escrita, Então recusa", () => {
    expect(() => validarEscritaNaWiki(join(temporario, "ausente"), "arquivo.md")).toThrow(
      /raiz da wiki não encontrada/,
    );
  });

  test("Dado raiz da wiki dentro de raw/, Quando valido escrita, Então recusa", () => {
    const wikiEmRaw = join(raw, "wiki");
    mkdirSync(wikiEmRaw, { recursive: true });
    expect(() => validarEscritaNaWiki(wikiEmRaw, "arquivo.md")).toThrow(/a raiz da wiki fica dentro de raw/);
  });

  test("Dado caminho fora da raiz da wiki, Quando valido escrita, Então recusa", () => {
    expect(() => validarEscritaNaWiki(wiki, "../fora/arquivo.md")).toThrow(/caminho fora da raiz da wiki/);
    expect(() => validarEscritaNaWiki(wiki, "")).toThrow(/caminho fora da raiz da wiki/);
  });

  test.skipIf(semLink)("Dado alvo que é symlink para fora, Quando valido escrita, Então recusa com caminho real sai da raiz", () => {
    const alvoFora = join(fora, "arquivo.md");
    writeFileSync(alvoFora, "conteudo");
    symlinkSync(alvoFora, join(wiki, "link-fora.md"));
    expect(() => validarEscritaNaWiki(wiki, "link-fora.md")).toThrow(/o caminho real sai da raiz da wiki/);
  });

  test.skipIf(semLink)("Dado alvo que é symlink para raw/, Quando valido escrita, Então recusa com caminho real fica dentro de raw", () => {
    const alvoRaw = join(raw, "arquivo.md");
    writeFileSync(alvoRaw, "conteudo");
    symlinkSync(alvoRaw, join(wiki, "link-raw.md"));
    expect(() => validarEscritaNaWiki(wiki, "link-raw.md")).toThrow(/o caminho real fica dentro de raw/);
  });

  test.skipIf(semLink)("Dado alvo que é symlink para outro arquivo da wiki, Quando valido escrita, Então recusa com alvo é link simbólico", () => {
    const real = join(wiki, "real.md");
    writeFileSync(real, "conteudo");
    symlinkSync(real, join(wiki, "link-interno.md"));
    expect(() => validarEscritaNaWiki(wiki, "link-interno.md")).toThrow(/o alvo é um link simbólico/);
  });

  test.skipIf(semLink)("Dado ancestral que é symlink interno, Quando valido escrita, Então recusa com ancestral é link simbólico", () => {
    const pastaReal = join(wiki, "pasta-real");
    mkdirSync(pastaReal);
    symlinkSync(pastaReal, join(wiki, "pasta-link"));
    expect(() => validarEscritaNaWiki(wiki, join("pasta-link", "novo.md"))).toThrow(
      /diretório ancestral é um link simbólico/,
    );
  });

  test("Dado caminho normal dentro da wiki, Quando valido escrita, Então devolve caminhos resolvidos", () => {
    const res = validarEscritaNaWiki(wiki, "doc.md");
    expect(res.alvoAbs).toBe(join(wiki, "doc.md"));
    expect(res.paiAbs).toBe(wiki);
  });
});

describe("validarDiretorioWiki", () => {
  test("Dado raiz da wiki inexistente, Quando valido diretório, Então recusa", () => {
    expect(() => validarDiretorioWiki(join(temporario, "ausente"), "pasta")).toThrow(/raiz da wiki não encontrada/);
  });

  test("Dado raiz da wiki dentro de raw/, Quando valido diretório, Então recusa", () => {
    const wikiEmRaw = join(raw, "wiki");
    mkdirSync(wikiEmRaw, { recursive: true });
    expect(() => validarDiretorioWiki(wikiEmRaw, "pasta")).toThrow(/a raiz da wiki fica dentro de raw/);
  });

  test("Dado diretório raiz da wiki (rel ''), Quando valido, Então aceita sem erro", () => {
    expect(() => validarDiretorioWiki(wiki, wiki)).not.toThrow();
  });

  test("Dado diretório fora da wiki, Quando valido, Então recusa", () => {
    expect(() => validarDiretorioWiki(wiki, fora)).toThrow(/diretório fora da raiz da wiki/);
  });

  test.skipIf(semLink)("Dado diretório que aponta para raw/, Quando valido, Então recusa", () => {
    symlinkSync(raw, join(wiki, "link-raw"));
    expect(() => validarDiretorioWiki(wiki, join(wiki, "link-raw"))).toThrow(/o caminho real fica dentro de raw/);
  });

  test.skipIf(semLink)("Dado diretório que é symlink para fora, Quando valido, Então recusa", () => {
    symlinkSync(fora, join(wiki, "link-fora"));
    expect(() => validarDiretorioWiki(wiki, join(wiki, "link-fora"))).toThrow(/o caminho real sai da raiz/);
  });

  test.skipIf(semLink)("Dado diretório que é symlink interno, Quando valido, Então recusa com diretório é link simbólico", () => {
    const pastaReal = join(wiki, "dir-real");
    mkdirSync(pastaReal);
    symlinkSync(pastaReal, join(wiki, "dir-link"));
    expect(() => validarDiretorioWiki(wiki, join(wiki, "dir-link"))).toThrow(/diretório é um link simbólico/);
  });
});

describe("validarLeituraNaWiki", () => {
  test("Dado raiz da wiki inexistente, Quando valido leitura, Então recusa", () => {
    expect(() => validarLeituraNaWiki(join(temporario, "ausente"), "nota.md")).toThrow(/raiz da wiki não encontrada/);
  });

  test("Dado raiz da wiki dentro de raw/, Quando valido leitura, Então recusa", () => {
    const wikiEmRaw = join(raw, "wiki");
    mkdirSync(wikiEmRaw, { recursive: true });
    expect(() => validarLeituraNaWiki(wikiEmRaw, "nota.md")).toThrow(/a raiz da wiki fica dentro de raw/);
  });

  test("Dado caminho fora da raiz da wiki, Quando valido leitura, Então recusa", () => {
    expect(() => validarLeituraNaWiki(wiki, "../fora/nota.md")).toThrow(/caminho fora da raiz da wiki/);
  });

  test("Dado arquivo inexistente, Quando valido leitura, Então recusa com erro de acesso", () => {
    expect(() => validarLeituraNaWiki(wiki, "ausente.md")).toThrow(/não foi possível acessar/);
  });

  test("Dado arquivo normal existente, Quando valido leitura, Então aceita", () => {
    const arquivo = join(wiki, "nota.md");
    writeFileSync(arquivo, "texto");
    expect(() => validarLeituraNaWiki(wiki, "nota.md")).not.toThrow();
  });

  test.skipIf(semLink)("Dado arquivo symlink para fora, Quando valido leitura, Então recusa", () => {
    const arquivo = join(fora, "nota.md");
    writeFileSync(arquivo, "texto");
    symlinkSync(arquivo, join(wiki, "link-fora.md"));
    expect(() => validarLeituraNaWiki(wiki, "link-fora.md")).toThrow(/o caminho real sai da raiz/);
  });

  test.skipIf(semLink)("Dado arquivo symlink para raw/, Quando valido leitura, Então recusa", () => {
    const arquivo = join(raw, "nota.md");
    writeFileSync(arquivo, "texto");
    symlinkSync(arquivo, join(wiki, "link-raw.md"));
    expect(() => validarLeituraNaWiki(wiki, "link-raw.md")).toThrow(/o caminho real fica dentro de raw/);
  });

  test.skipIf(semLink)("Dado arquivo symlink interno, Quando valido leitura, Então recusa com link simbólico", () => {
    const real = join(wiki, "real.md");
    writeFileSync(real, "texto");
    symlinkSync(real, join(wiki, "link-interno.md"));
    expect(() => validarLeituraNaWiki(wiki, "link-interno.md")).toThrow(/o alvo é um link simbólico/);
  });

  test.skipIf(semLink)("Dado ancestral symlink interno, Quando valido leitura, Então recusa com ancestral é link simbólico", () => {
    const pastaReal = join(wiki, "pasta-real");
    mkdirSync(pastaReal);
    writeFileSync(join(pastaReal, "nota.md"), "texto");
    symlinkSync(pastaReal, join(wiki, "pasta-link"));
    expect(() => validarLeituraNaWiki(wiki, join("pasta-link", "nota.md"))).toThrow(/diretório ancestral é um link simbólico/);
  });
});

describe("podeGravarNaWiki", () => {
  test("Dado arquivo legítimo, Quando consulto podeGravarNaWiki, Então retorna true", () => {
    expect(podeGravarNaWiki(wiki, "ok.md")).toBe(true);
  });

  test("Dado caminho fora da wiki, Quando consulto podeGravarNaWiki, Então retorna false", () => {
    expect(podeGravarNaWiki(wiki, "../fora/ok.md")).toBe(false);
  });
});

describe("gravarArquivoWiki e gravarArquivoWikiSync", () => {
  test("Dado arquivo novo, Quando gravo assíncrono, Então cria o arquivo com o conteúdo", async () => {
    const destino = join(wiki, "sub", "novo.md");
    await gravarArquivoWiki(wiki, destino, "conteudo assíncrono");
    expect(readFileSync(destino, "utf8")).toBe("conteudo assíncrono");
  });

  test("Dado arquivo novo, Quando gravo síncrono, Então cria o arquivo com o conteúdo", () => {
    const destino = join(wiki, "sub", "sync.md");
    gravarArquivoWikiSync(wiki, destino, "conteudo síncrono");
    expect(readFileSync(destino, "utf8")).toBe("conteudo síncrono");
  });

  test("Dado arquivo existente somente leitura, Quando gravo, Então falha com permissão negada", async () => {
    const destino = join(wiki, "ro.md");
    writeFileSync(destino, "original");
    chmodSync(destino, 0o444);
    try {
      expect(gravarArquivoWiki(wiki, destino, "alterado")).rejects.toThrow();
      expect(() => gravarArquivoWikiSync(wiki, destino, "alterado")).toThrow();
    } finally {
      chmodSync(destino, 0o644);
    }
  });

  test("Dado flag 'wx', Quando gravo em destino inexistente, Então cria com sucesso", async () => {
    const destino = join(wiki, "wx-novo.md");
    await gravarArquivoWiki(wiki, destino, "criado", { flag: "wx" });
    expect(readFileSync(destino, "utf8")).toBe("criado");

    const destinoSync = join(wiki, "wx-sync.md");
    gravarArquivoWikiSync(wiki, destinoSync, "criado sync", { flag: "wx" });
    expect(readFileSync(destinoSync, "utf8")).toBe("criado sync");
  });

  test("Dado flag 'wx', Quando gravo em destino que já existe, Então recusa com EEXIST", async () => {
    const destino = join(wiki, "ja-existe.md");
    writeFileSync(destino, "ja existe");
    expect(gravarArquivoWiki(wiki, destino, "novo", { flag: "wx" })).rejects.toThrow(/EEXIST/);
    expect(() => gravarArquivoWikiSync(wiki, destino, "novo", { flag: "wx" })).toThrow(/EEXIST/);
  });
});
