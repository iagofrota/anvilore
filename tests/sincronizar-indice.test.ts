import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sincronizarIndice, comandoSincronizarIndice } from "../src/comandos/sincronizar-indice";

let raiz: string;
let wiki: string;
let indice: string;

function gravar(caminho: string, texto = "pagina\n"): void {
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, texto);
}

function ligarDiretorio(alvo: string, link: string): void {
  symlinkSync(alvo, link, process.platform === "win32" ? "junction" : "dir");
}

function ler(caminho = indice): string {
  return readFileSync(caminho, "utf8");
}

function linha3(): string {
  return ler().split(/\r?\n/)[2] ?? "";
}

function header(linha = "_1 página, 1 fonte, 1 entidade, 1 conceito — Última atualização: 2020-01-01 · + 3 sessoes de retro_"): void {
  gravar(indice, `# Indice — alfa\n\n${linha}\n\n## Conceitos\n`);
}

async function capturar(corpo: () => Promise<unknown>) {
  const saida: string[] = [];
  const erro: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...partes) => { saida.push(partes.join(" ")); });
  const err = spyOn(console, "error").mockImplementation((...partes) => { erro.push(partes.join(" ")); });
  try {
    return { valor: await corpo(), saida: saida.join("\n"), erro: erro.join("\n") };
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
}

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "anvilore-indice-"));
  wiki = join(raiz, "wiki");
  indice = join(wiki, "alfa", "index.md");
  for (const nome of ["um", "dois"]) gravar(join(wiki, "alfa", "sources", `f-${nome}.md`));
  gravar(join(wiki, "alfa", "entities", "e-um.md"));
  for (const nome of ["um", "dois", "tres"]) gravar(join(wiki, "alfa", "concepts", `c-${nome}.md`));
  header();
});

afterEach(() => rmSync(raiz, { recursive: true, force: true }));

test("Dado header defasado, Quando sincronizo, Então a operação reescreve alfa", async () => {
  const r = await capturar(() => sincronizarIndice(wiki));
  expect(r.valor).toEqual({ defasadas: [], reescritas: ["alfa"] });
  expect(r.saida).toContain("SYNC (alfa):");
  expect(r.saida).toContain("INDICE: OK (1 header(s) reescrito(s))");
});

test.each(["6 páginas", "2 fontes", "1 entidade", "3 conceitos", "+ 3 sessoes de retro"])(
  "Dado header defasado, Quando sincronizo, Então a linha 3 traz %s",
  async (esperado) => {
    await capturar(() => sincronizarIndice(wiki));
    expect(linha3()).toContain(esperado);
  },
);

test("Dado header defasado, Quando sincronizo, Então a linha 3 traz a data local de hoje", async () => {
  await capturar(() => sincronizarIndice(wiki));
  const hoje = new Date();
  const data = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  expect(linha3()).toContain(`Última atualização: ${data}`);
});

test("Dado uma entidade, Quando sincronizo, Então não escrevo 1 entidades", async () => {
  await capturar(() => sincronizarIndice(wiki));
  expect(linha3()).not.toContain("1 entidades");
});

test("Dado índice sincronizado, Quando checo, Então saio 0", async () => {
  await capturar(() => sincronizarIndice(wiki));
  const r = await capturar(() => comandoSincronizarIndice([wiki, "--checar"]));
  expect(r.valor).toBe(0);
  expect(r.saida).toContain("INDICE: OK (0 header(s) reescrito(s))");
});

test("Dado índice sincronizado, Quando checo, Então não escrevo", async () => {
  await capturar(() => sincronizarIndice(wiki));
  const antes = ler();
  await capturar(() => comandoSincronizarIndice([wiki, "--checar"]));
  expect(ler()).toBe(antes);
});

test("Dado índice defasado, Quando checo, Então saio 1 e aviso o header", async () => {
  const r = await capturar(() => comandoSincronizarIndice([wiki, "--checar"]));
  expect(r.valor).toBe(1);
  expect(r.saida).toContain("FAIL: header (alfa) defasado:");
});

test("Dado índice defasado, Quando checo, Então não escrevo", async () => {
  const antes = ler();
  await capturar(() => comandoSincronizarIndice([wiki, "--checar"]));
  expect(ler()).toBe(antes);
});

test("Dado índice defasado checado, Quando sincronizo sem checar, Então a escrita muda o índice", async () => {
  const antes = ler();
  await capturar(() => comandoSincronizarIndice([wiki, "--checar"]));
  await capturar(() => sincronizarIndice(wiki));
  expect(ler()).not.toBe(antes);
});

test("Dado novo conceito, Quando sincronizo de novo, Então conto 4 conceitos", async () => {
  await capturar(() => sincronizarIndice(wiki));
  gravar(join(wiki, "alfa", "concepts", "c-quatro.md"));
  await capturar(() => sincronizarIndice(wiki));
  expect(linha3()).toContain("4 conceitos");
});

test("Dado área beta sem index.md, Quando sincronizo, Então a área opcional não reprova", async () => {
  gravar(join(wiki, "beta", "concepts", "x.md"));
  const r = await capturar(() => comandoSincronizarIndice([wiki]));
  expect(r.valor).toBe(0);
});

test("Dado índice sem header de contagem, Quando sincronizo, Então não reprova", async () => {
  gravar(join(wiki, "gama", "index.md"), "# Indice — gama\n\nProsa livre de quem cura, sem header de contagem nenhum.\n");
  const r = await capturar(() => comandoSincronizarIndice([wiki]));
  expect(r.valor).toBe(0);
});

test("Dado índice sem header de contagem, Quando sincronizo, Então ele fica intacto", async () => {
  const caminho = join(wiki, "gama", "index.md");
  gravar(caminho, "# Indice — gama\n\nProsa livre de quem cura, sem header de contagem nenhum.\n");
  const antes = ler(caminho);
  await capturar(() => sincronizarIndice(wiki));
  expect(ler(caminho)).toBe(antes);
});

test("Dado header parcial, Quando sincronizo, Então reprovo sem reescrever o índice", async () => {
  header("_2 páginas — Última atualização: 2020-01-01_");
  const antes = ler();
  const r = await capturar(() => comandoSincronizarIndice([wiki]));
  expect(r.valor).toBe(1);
  expect(r.saida).toContain("FAIL: header (alfa) nao tem o campo 'fontes':");
  expect(ler()).toBe(antes);
});

test("Dado header com contagens sem data, Quando sincronizo, Então reprovo sem escrever", async () => {
  header("_1 página, 1 fonte, 1 entidade, 1 conceito_");
  const antes = ler();
  const r = await capturar(() => comandoSincronizarIndice([wiki]));
  expect(r.valor).toBe(1);
  expect(r.saida).toContain("nao tem 'Última atualização: AAAA-MM-DD'");
  expect(ler()).toBe(antes);
});

test("Dado diretórios reservados, Quando sincronizo, Então não os trato como áreas", async () => {
  for (const nome of ["_meta", "log", "sources", "entities", "concepts"]) {
    gravar(join(wiki, nome, "index.md"), "# reservado\n\n_2 páginas — Última atualização: 2020-01-01_\n");
  }
  const r = await capturar(() => comandoSincronizarIndice([wiki]));
  expect(r.valor).toBe(0);
  for (const nome of ["_meta", "log", "sources", "entities", "concepts"]) expect(r.saida).not.toContain(nome);
});

test("Dado área que é symlink com header defasado, Quando checo, Então aviso e saio 1 sem escrever", async () => {
  await capturar(() => sincronizarIndice(wiki));
  const alvo = join(raiz, "fora", "area");
  const indexLinkado = join(alvo, "index.md");
  gravar(indexLinkado, "# Área ligada\n\n_0 páginas, 0 fontes, 0 entidades, 0 conceitos — Última atualização: 2020-01-01_\n");
  ligarDiretorio(alvo, join(wiki, "ligada"));
  const antes = ler(indexLinkado);
  const r = await capturar(() => comandoSincronizarIndice([wiki, "--checar"]));
  expect(r.valor).toBe(1);
  expect(r.saida).toContain("FAIL: header (ligada) defasado:");
  expect(ler(indexLinkado)).toBe(antes);
});

test("Dado symlink de área quebrado, Quando checo, Então aviso no stderr e não afirmo erro de header", async () => {
  await capturar(() => sincronizarIndice(wiki));
  const alvo = join(raiz, "fora", "quebrada");
  gravar(join(alvo, "index.md"), "# temporário\n");
  ligarDiretorio(alvo, join(wiki, "quebrada"));
  rmSync(alvo, { recursive: true });
  const r = await capturar(() => comandoSincronizarIndice([wiki, "--checar"]));
  expect(r.valor).toBe(0);
  expect(r.erro).toContain("AVISO:");
  expect(r.erro).toContain("quebrada");
  expect(r.saida).not.toContain("FAIL: header (quebrada)");
});

test("Dado sources como symlink, Quando sincronizo, Então não sigo o link nem em páginas nem em fontes", async () => {
  const alvo = join(raiz, "fora", "sources");
  gravar(join(alvo, "um.md"));
  gravar(join(alvo, "dois.md"));
  rmSync(join(wiki, "alfa", "sources"), { recursive: true });
  ligarDiretorio(alvo, join(wiki, "alfa", "sources"));
  await capturar(() => sincronizarIndice(wiki));
  expect(linha3()).toContain("4 páginas");
  expect(linha3()).toContain("0 fontes");
});

test("Dado .trash com header defasado, Quando checo, Então não o trato como área", async () => {
  await capturar(() => sincronizarIndice(wiki));
  const caminho = join(wiki, ".trash", "index.md");
  gravar(caminho, "# Lixeira\n\n_9 páginas — Última atualização: 2020-01-01_\n");
  const r = await capturar(() => comandoSincronizarIndice([wiki, "--checar"]));
  expect(r.valor).toBe(0);
  expect(r.saida).not.toContain(".trash");
});

test("Dado .trash com header defasado, Quando sincronizo, Então não escrevo na lixeira", async () => {
  await capturar(() => sincronizarIndice(wiki));
  const caminho = join(wiki, ".trash", "index.md");
  gravar(caminho, "# Lixeira\n\n_9 páginas — Última atualização: 2020-01-01_\n");
  const antes = ler(caminho);
  const r = await capturar(() => comandoSincronizarIndice([wiki]));
  expect(r.valor).toBe(0);
  expect(ler(caminho)).toBe(antes);
});

test("Dado áreas criadas fora da ordem alfabética, Quando sincronizo, Então anuncio alfa, beta e zeta nessa ordem", async () => {
  const linha = "_0 páginas, 0 fontes, 0 entidades, 0 conceitos — Última atualização: 2020-01-01_";
  gravar(join(wiki, "zeta", "index.md"), `# Zeta\n\n${linha}\n`);
  gravar(join(wiki, "beta", "index.md"), `# Beta\n\n${linha}\n`);
  const r = await capturar(() => sincronizarIndice(wiki));
  expect(r.saida.match(/SYNC \([^)]+\)/g)).toEqual(["SYNC (alfa)", "SYNC (beta)", "SYNC (zeta)"]);
});

test("Dado a wiki versionada do repositório, Quando checo, Então ela passa sem escrita", async () => {
  const r = await capturar(() => comandoSincronizarIndice([join(import.meta.dir, "..", "wiki"), "--checar"]));
  expect(r.valor).toBe(0);
});

test("Dado flag --check, Quando checo um índice defasado, Então devolvo 1 sem escrever", async () => {
  const antes = ler();
  const r = await capturar(() => comandoSincronizarIndice(["--check", wiki]));
  expect(r.valor).toBe(1);
  expect(ler()).toBe(antes);
});

test("Dado a wiki inexistente, Quando sincronizo, Então aviso e devolvo 1", async () => {
  const ausente = join(raiz, "ausente");
  const r = await capturar(() => comandoSincronizarIndice([ausente]));
  expect(r.valor).toBe(1);
  expect(r.saida).toContain(`FAIL: raiz da wiki nao encontrada: ${ausente}`);
});

test("Dado flag desconhecida, Quando sincronizo, Então aviso e devolvo 1", async () => {
  const r = await capturar(() => comandoSincronizarIndice([wiki, "--outra"]));
  expect(r.valor).toBe(1);
  expect(r.saida).toContain("FAIL: flag desconhecida: --outra");
});

test("Dado índice com CRLF e prosa extra, Quando sincronizo, Então só a linha 3 muda", async () => {
  const texto = "# Indice\r\nSubtítulo da área\r\n_1 página, 1 fonte, 1 entidade, 1 conceito — Última atualização: 2020-01-01_\r\nNotas do curador\r\n## Conceitos";
  gravar(indice, texto);
  await capturar(() => sincronizarIndice(wiki));
  const depois = ler();
  expect(depois).not.toBe(texto);
  expect(depois.split("\r\n")[2]).toContain("6 páginas");
  expect(depois.split("\r\n")[2]).not.toContain("2020-01-01");
  expect(depois.split("\r\n").filter((_, i) => i !== 2)).toEqual(texto.split("\r\n").filter((_, i) => i !== 2));
  expect(depois).not.toMatch(/(?<!\r)\n/);
  expect(depois.endsWith("\n")).toBe(false);
});
