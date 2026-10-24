import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checarDocs, comandoChecarDocs } from "../src/comandos/checar-docs";
import { executar, subcomandos } from "../src/cli";

let raiz: string;

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "anvilore-docs-"));
});
afterEach(() => {
  rmSync(raiz, { recursive: true, force: true });
});

function gravar(relativo: string, conteudo: string): void {
  const caminho = join(raiz, relativo);
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, conteudo);
}

function kb(pagina: string, conteudo: string): void {
  gravar(`docs/knowledge_base/${pagina}`, conteudo);
}

describe("checarDocs: referências", () => {
  test("Dado uma página que cita um arquivo inexistente, Quando checo, Então reprova nomeando a página e o arquivo", () => {
    kb("governanca.md", "# Governança\n\nVeja `src/nao-existe.ts`.\n");
    const r = checarDocs(raiz);
    expect(r.ok).toBe(false);
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toContain("docs/knowledge_base/governanca.md");
    expect(r.problemas[0]).toContain("src/nao-existe.ts");
  });

  test("Dado uma menção entre crases a arquivo que existe na raiz, Quando checo, Então passa", () => {
    gravar("src/cli.ts", "");
    kb("README.md", "Veja `src/cli.ts` e `src/`.\n");
    expect(checarDocs(raiz)).toEqual({ ok: true, problemas: [] });
  });

  test("Dado uma menção entre crases, Quando checo, Então ela resolve a partir da raiz e não da página", () => {
    gravar("docs/knowledge_base/outra.md", "");
    kb("README.md", "Veja `outra.md` e `docs/knowledge_base/outra.md`.\n");
    const r = checarDocs(raiz);
    expect(r.ok).toBe(false);
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toContain("`outra.md`");
  });

  test("Dado um link relativo quebrado, Quando checo, Então reprova nomeando a página e o alvo", () => {
    kb("README.md", "Leia [as decisões](decisoes.md).\n");
    const r = checarDocs(raiz);
    expect(r.ok).toBe(false);
    expect(r.problemas[0]).toContain("docs/knowledge_base/README.md");
    expect(r.problemas[0]).toContain("decisoes.md");
  });

  test("Dado um link relativo, Quando checo, Então ele resolve a partir da página, mesmo numa subpasta", () => {
    gravar("README.md", "");
    kb("README.md", "Veja [a raiz](../../README.md).\n");
    kb("sub/pagina.md", "Veja [a raiz](../../../README.md) e [a irmã](../README.md).\n");
    expect(checarDocs(raiz)).toEqual({ ok: true, problemas: [] });
  });

  test("Dado a âncora depois do arquivo, Quando checo, Então a âncora é ignorada e o arquivo é conferido", () => {
    gravar("SCHEMA.md", "");
    kb("README.md", "[a](../../SCHEMA.md#tipos) e `SCHEMA.md#tipos`.\n[b](#nesta-pagina)\n[c](../../FALTA.md#x)\n");
    const r = checarDocs(raiz);
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toContain("FALTA.md");
    expect(r.problemas[0]).not.toContain("#");
  });

  test("Dado URLs http, https e mailto, Quando checo, Então são ignoradas", () => {
    kb(
      "README.md",
      "[a](https://exemplo.com/x.md) [b](http://exemplo.com/y) [c](mailto:alguem@exemplo.com)\n`https://exemplo.com/a/b.md`\n",
    );
    expect(checarDocs(raiz)).toEqual({ ok: true, problemas: [] });
  });

  test("Dado um bloco de código cercado com caminhos e links, Quando checo, Então o conteúdo do bloco é ignorado", () => {
    kb("README.md", "```bash\nbun src/nao-existe.ts\ncat `docs/fantasma.md` [x](tampouco.md)\n```\n\n~~~\n`src/outro.ts`\n~~~\n");
    expect(checarDocs(raiz)).toEqual({ ok: true, problemas: [] });
  });

  test("Dado uma menção que não parece caminho, Quando checo, Então é ignorada", () => {
    kb(
      "README.md",
      [
        "`bun run checar`",
        "`src/lib/*.ts`",
        "`wiki/<área>/index.md`",
        "`ANVILORE_LOG_HOOK`",
        "`Bun.YAML`",
        "`checarDocs(raiz)`",
        "`Write|Edit`",
        "`AAAA-MM-DD`",
        "",
      ].join("\n"),
    );
    expect(checarDocs(raiz)).toEqual({ ok: true, problemas: [] });
  });

  test("Dado uma menção só com extensão de arquivo, Quando o arquivo não existe, Então reprova", () => {
    kb("README.md", "Veja `FALTA.md` e `faltando.json`.\n");
    const r = checarDocs(raiz);
    expect(r.problemas).toHaveLength(2);
  });

  test("Dado uma página em CRLF e com BOM, Quando checo, Então a leitura é a mesma da página em LF", () => {
    kb("README.md", "﻿# T\r\n\r\nVeja `src/falta.ts`.\r\n");
    const r = checarDocs(raiz);
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toContain("src/falta.ts");
  });

  test("Dado a mesma referência quebrada duas vezes na página, Quando checo, Então é apontada uma vez", () => {
    kb("README.md", "`src/falta.ts` e de novo `src/falta.ts`.\n");
    expect(checarDocs(raiz).problemas).toHaveLength(1);
  });

  test("Dado um link com título entre aspas, Quando checo, Então só o alvo é conferido", () => {
    gravar("LICENSE", "");
    kb("README.md", '[a](../../LICENSE "licença")\n');
    expect(checarDocs(raiz).ok).toBe(true);
  });

  test("Dado um alvo com escape de URL, Quando checo, Então ele é decodificado antes de conferir", () => {
    gravar("com espaço.md", "");
    kb("README.md", "[a](../../com%20espaço.md)\n");
    expect(checarDocs(raiz).ok).toBe(true);
  });

  test("Dado um escape de URL malformado, Quando checo, Então o alvo é conferido como foi escrito", () => {
    gravar("a%ZZ.md", "");
    kb("README.md", "[a](../../a%ZZ.md) [b](../../b%ZZ.md)\n");
    const r = checarDocs(raiz);
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toContain("b%ZZ.md");
  });

  test("Dado páginas sem nenhum problema, Quando checo, Então passa", () => {
    kb("README.md", "# Nada a conferir\n");
    expect(checarDocs(raiz)).toEqual({ ok: true, problemas: [] });
  });
});

describe("checarDocs: a própria knowledge base", () => {
  test("Dado um repositório sem docs/knowledge_base, Quando checo, Então reprova e não imprime PASS calado", () => {
    const r = checarDocs(raiz);
    expect(r.ok).toBe(false);
    expect(r.problemas.join("\n")).toContain("docs/knowledge_base");
  });

  test("Dado docs/knowledge_base existente e sem páginas, Quando checo, Então reprova", () => {
    mkdirSync(join(raiz, "docs", "knowledge_base"), { recursive: true });
    const r = checarDocs(raiz);
    expect(r.ok).toBe(false);
    expect(r.problemas.join("\n")).toContain("nenhuma página");
  });

  test("Dado docs/knowledge_base como arquivo, Quando checo, Então reprova", () => {
    gravar("docs/knowledge_base", "isto é um arquivo");
    expect(checarDocs(raiz).ok).toBe(false);
  });

  test("Dado a raiz real do repositório, Quando checo, Então não há nenhum problema", () => {
    const real = checarDocs(join(import.meta.dir, ".."));
    expect(real.problemas).toEqual([]);
    expect(real.ok).toBe(true);
  });
});

describe("comandoChecarDocs", () => {
  function capturar<T>(corpo: () => Promise<T>) {
    const saida: string[] = [];
    const erro: string[] = [];
    const log = spyOn(console, "log").mockImplementation((...a) => {
      saida.push(a.join(" "));
    });
    const err = spyOn(console, "error").mockImplementation((...a) => {
      erro.push(a.join(" "));
    });
    return corpo()
      .then((codigo) => ({ codigo, saida, erro }))
      .finally(() => {
        log.mockRestore();
        err.mockRestore();
      });
  }

  test("Dado uma knowledge base consistente, Quando rodo o subcomando, Então o código é 0", async () => {
    kb("README.md", "# Ok\n");
    const r = await capturar(() => comandoChecarDocs([], raiz));
    expect(r.codigo).toBe(0);
    expect(r.saida.join("\n")).toContain("docs/knowledge_base");
  });

  test("Dado uma referência quebrada, Quando rodo o subcomando, Então o código é 1 e cada problema vai para o stderr", async () => {
    kb("README.md", "`src/falta.ts`\n[x](falta.md)\n");
    const r = await capturar(() => comandoChecarDocs([], raiz));
    expect(r.codigo).toBe(1);
    expect(r.erro).toHaveLength(2);
    expect(r.saida).toEqual([]);
  });

  test("Dado o subcomando checar-docs, Quando consulto a tabela da CLI, Então ele está registrado e roda", async () => {
    expect(Object.keys(subcomandos)).toContain("checar-docs");
    const r = await capturar(() => executar(["checar-docs"]));
    expect(r.codigo).toBe(0);
  });
});
