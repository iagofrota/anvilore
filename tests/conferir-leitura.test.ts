import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { comandoConferirLeitura, conferirArquivoDeLeitura } from "../src/comandos/conferir-leitura";
import { executar } from "../src/cli";
import { capturarConsole } from "./apoio/console";

let raiz: string;
let consoleCapturado: ReturnType<typeof capturarConsole>;

function gravar(rel: string, texto: string) {
  mkdirSync(dirname(join(raiz, rel)), { recursive: true });
  writeFileSync(join(raiz, rel), texto);
}

function relatorio(trecho = "a wiki acumula") {
  return {
    versao: 1,
    fonte: "raw/notas/fonte.md",
    takeaways: [
      { texto: "Acumula.", citacao: { trecho, secao: "Início" }, certeza: "comprovado" },
      { texto: "Mantém.", citacao: { trecho: "o agente mantém", secao: "Início" }, certeza: "comprovado" },
      { texto: "Cura.", citacao: { trecho: "a pessoa cura", secao: "Início" }, certeza: "provavel" },
    ],
    paginas: [
      { caminho: "pessoal/sources/fonte.md", tipo: "source", acao: "criar", motivo: "resumo" },
      { caminho: "pessoal/concepts/wiki.md", tipo: "concept", acao: "atualizar", motivo: "acrescenta" },
    ],
    lacunas: [],
    contradicoes: [],
  };
}

beforeEach(() => {
  consoleCapturado = capturarConsole();
  raiz = mkdtempSync(join(tmpdir(), "anvilore-leitura-"));
  gravar("raw/notas/fonte.md", "A wiki acumula. O agente mantém e a pessoa cura.\n");
  gravar("wiki/pessoal/concepts/wiki.md", "---\ntitle: Wiki\n---\n");
});
afterEach(() => {
  consoleCapturado.restaurar();
  rmSync(raiz, { recursive: true, force: true });
});

test("Dado o relatório do leitor correto em arquivo Quando confiro Então aprova e resume o que veio", async () => {
  gravar(".anvilore/ingest/leitura.json", JSON.stringify(relatorio()));
  expect(await conferirArquivoDeLeitura(raiz, ".anvilore/ingest/leitura.json")).toEqual({
    codigo: 0,
    mensagens: ["OK: leitura conferida — 3 takeaways, 2 páginas (1 a criar, 1 a atualizar), 0 lacunas, 0 contradições."],
  });
});

test("Dado a resposta do leitor com texto em volta do bloco json Quando confiro Então usa o bloco", async () => {
  gravar("resposta.md", `Pronto.\n\n\`\`\`json\n${JSON.stringify(relatorio(), null, 2)}\n\`\`\`\n`);
  expect((await conferirArquivoDeLeitura(raiz, join(raiz, "resposta.md"))).codigo).toBe(0);
});

test("Dado citação inventada Quando confiro Então reprova e diz qual takeaway", async () => {
  gravar("leitura.json", JSON.stringify(relatorio("a wiki esquece")));
  expect(await conferirArquivoDeLeitura(raiz, "leitura.json")).toEqual({
    codigo: 1,
    mensagens: ['FAIL: $.takeaways[0].citacao.trecho: não aparece na fonte ("a wiki esquece")'],
  });
});

test("Dado wiki fora da pasta por ANVILORE_WIKI Quando confiro Então confere as páginas nela", async () => {
  const externa = join(raiz, "outra-wiki");
  gravar("outra-wiki/pessoal/concepts/wiki.md", "---\ntitle: Wiki\n---\n");
  rmSync(join(raiz, "wiki"), { recursive: true, force: true });
  gravar("leitura.json", JSON.stringify(relatorio()));
  expect((await conferirArquivoDeLeitura(raiz, "leitura.json", { ANVILORE_WIKI: externa })).codigo).toBe(0);
  expect((await conferirArquivoDeLeitura(raiz, "leitura.json", {})).mensagens).toEqual([
    "FAIL: $.paginas[1].acao: pessoal/concepts/wiki.md não existe; use criar",
  ]);
});

test("Dado relatório fora do esquema Quando confiro Então reprova sem ler a fonte", async () => {
  gravar("leitura.json", JSON.stringify({ versao: 1 }));
  const r = await conferirArquivoDeLeitura(raiz, "leitura.json");
  expect(r.codigo).toBe(1);
  expect(r.mensagens[0]).toBe("FAIL: $: falta o campo fonte");
});

test("Dado fonte que não existe em raw/ Quando confiro Então reprova dizendo o caminho", async () => {
  const r = relatorio();
  r.fonte = "raw/notas/sumiu.md";
  gravar("leitura.json", JSON.stringify(r));
  expect(await conferirArquivoDeLeitura(raiz, "leitura.json")).toEqual({ codigo: 1, mensagens: ["FAIL: fonte não encontrada: raw/notas/sumiu.md"] });
});

test("Dado fonte que não é UTF-8 Quando confiro Então reprova em vez de comparar texto corrompido", async () => {
  writeFileSync(join(raiz, "raw/notas/fonte.md"), Buffer.from([0x63, 0x61, 0x66, 0xe9]));
  gravar("leitura.json", JSON.stringify(relatorio()));
  expect((await conferirArquivoDeLeitura(raiz, "leitura.json")).mensagens[0]).toContain("não é UTF-8 válido");
});

test("Dado arquivo de leitura ausente ou sem JSON Quando confiro Então reprova com o motivo", async () => {
  expect((await conferirArquivoDeLeitura(raiz, "nao-existe.json")).mensagens[0]).toStartWith("FAIL: não foi possível ler nao-existe.json");
  gravar("ruim.json", "isto não é json");
  expect((await conferirArquivoDeLeitura(raiz, "ruim.json")).mensagens[0]).toStartWith("FAIL: a resposta do leitor não é JSON");
});

test("Dado a CLI sem argumento ou com --help Quando executo Então mostra o uso", async () => {
  expect(await comandoConferirLeitura([])).toBe(2);
  expect(await comandoConferirLeitura(["--help"])).toBe(0);
  expect(consoleCapturado.saida.join("\n")).toContain("Uso: anvilore conferir-leitura <arquivo>");
});

test("Dado a tabela de subcomandos Quando chamo conferir-leitura Então roda na pasta atual", async () => {
  const anterior = process.cwd();
  gravar("leitura.json", JSON.stringify(relatorio()));
  try {
    process.chdir(raiz);
    expect(await executar(["conferir-leitura", "leitura.json"])).toBe(0);
  } finally {
    process.chdir(anterior);
  }
  expect(consoleCapturado.saida.join("\n")).toContain("OK: leitura conferida");
});

// B1 (revisão 1 do PR #21): fonte e páginas valem pelo caminho real.
const linkDeDiretorio = process.platform === "win32" ? "junction" : "dir";

test.skipIf(process.platform === "win32")("Dado fonte em raw/ que é link para arquivo fora de raw/ Quando confiro Então reprova pela fronteira real", async () => {
  writeFileSync(join(raiz, "fora.md"), "A wiki acumula. O agente mantém e a pessoa cura.\n");
  rmSync(join(raiz, "raw/notas/fonte.md"));
  symlinkSync(join(raiz, "fora.md"), join(raiz, "raw/notas/fonte.md"));
  gravar("leitura.json", JSON.stringify(relatorio()));
  expect(await conferirArquivoDeLeitura(raiz, "leitura.json")).toEqual({
    codigo: 1, mensagens: ["FAIL: a fonte sai de raw/ pelo caminho real: raw/notas/fonte.md"],
  });
});

test("Dado subpasta de raw/ que é link para pasta fora de raw/ Quando confiro Então reprova pela fronteira real", async () => {
  gravar("fora/fonte.md", "A wiki acumula. O agente mantém e a pessoa cura.\n");
  rmSync(join(raiz, "raw/notas"), { recursive: true });
  symlinkSync(join(raiz, "fora"), join(raiz, "raw/notas"), linkDeDiretorio);
  gravar("leitura.json", JSON.stringify(relatorio()));
  expect((await conferirArquivoDeLeitura(raiz, "leitura.json")).mensagens).toEqual(["FAIL: a fonte sai de raw/ pelo caminho real: raw/notas/fonte.md"]);
});

test("Dado raw/ inteiro como link para outro disco Quando confiro Então aprova: a fonte continua dentro do raw/ real", async () => {
  gravar("disco/notas/fonte.md", "A wiki acumula. O agente mantém e a pessoa cura.\n");
  rmSync(join(raiz, "raw"), { recursive: true });
  symlinkSync(join(raiz, "disco"), join(raiz, "raw"), linkDeDiretorio);
  gravar("leitura.json", JSON.stringify(relatorio()));
  expect((await conferirArquivoDeLeitura(raiz, "leitura.json")).codigo).toBe(0);
});

test("Dado área da wiki que é link para raw/ Quando confiro Então reprova as páginas que cairiam em raw/", async () => {
  rmSync(join(raiz, "wiki/pessoal"), { recursive: true });
  gravar("raw/concepts/wiki.md", "---\ntitle: Wiki\n---\n");
  symlinkSync(join(raiz, "raw"), join(raiz, "wiki/pessoal"), linkDeDiretorio);
  gravar("leitura.json", JSON.stringify(relatorio()));
  expect((await conferirArquivoDeLeitura(raiz, "leitura.json")).mensagens).toEqual([
    "FAIL: $.paginas[0].caminho: pelo caminho real a página sai da wiki ou cai em raw/ (pessoal/sources/fonte.md)",
    "FAIL: $.paginas[1].caminho: pelo caminho real a página sai da wiki ou cai em raw/ (pessoal/concepts/wiki.md)",
  ]);
});

test.skipIf(process.platform === "win32")("Dado página a atualizar que é link para arquivo fora da wiki Quando confiro Então reprova", async () => {
  gravar("fora/wiki.md", "---\ntitle: Wiki\n---\n");
  rmSync(join(raiz, "wiki/pessoal/concepts/wiki.md"));
  symlinkSync(join(raiz, "fora/wiki.md"), join(raiz, "wiki/pessoal/concepts/wiki.md"));
  gravar("leitura.json", JSON.stringify(relatorio()));
  expect((await conferirArquivoDeLeitura(raiz, "leitura.json")).mensagens).toEqual([
    "FAIL: $.paginas[1].caminho: pelo caminho real a página sai da wiki ou cai em raw/ (pessoal/concepts/wiki.md)",
  ]);
});

test("Dado fonte com link/../ no caminho Quando confiro Então reprova antes de tocar o disco: .. nunca vale na fonte", async () => {
  const r = relatorio();
  r.fonte = "raw/link/../notas/fonte.md";
  gravar("leitura.json", JSON.stringify(r));
  expect((await conferirArquivoDeLeitura(raiz, "leitura.json")).mensagens).toEqual([
    "FAIL: $.fonte: a fonte tem de estar em raw/ (veio raw/link/../notas/fonte.md)",
  ]);
});
