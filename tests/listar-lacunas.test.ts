import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { listarLacunas, comandoListarLacunas } from "../src/comandos/listar-lacunas";
import { executar, subcomandos } from "../src/cli";

let raiz: string;
let wiki: string;

function gravar(rel: string, texto: string): void {
  const destino = join(wiki, rel);
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, texto);
}

function pagina(slug: string, corpo: string): string {
  return `---\ntitle: "${slug}"\nslug: ${slug}\ntype: concept\ntags: []\n---\n\nProsa inicial.\n\n${corpo}`;
}

function indice(): string {
  return readFileSync(join(wiki, "_meta", "lacunas.md"), "utf8");
}

function hashIndice(): string {
  return createHash("sha256").update(indice()).digest("hex");
}

async function capturar(acao: () => Promise<number>) {
  const saida: string[] = [];
  const erro: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...args) => { saida.push(args.join(" ")); });
  const err = spyOn(console, "error").mockImplementation((...args) => { erro.push(args.join(" ")); });
  try {
    const codigo = await acao();
    return { codigo, saida, erro };
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
}

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "anvilore-lacunas-"));
  wiki = join(raiz, "wiki");
  mkdirSync(wiki);
  gravar("alfa/concepts/a.md", pagina("a", "> [!gap]\n> Falta a definicao de X.\n"));
  gravar("alfa/sources/b.md", pagina("b", "> [!gap] Nenhuma fonte cobre Y.\n"));
  gravar("beta/concepts/c.md", pagina("c", "> [!gap]\n> Falta medir Z.\n\nMais prosa.\n\n> [!contradiction]\n> A fonte P afirma W; a fonte Q afirma o contrario.\n"));
  gravar("alfa/concepts/d.md", pagina("d", "Quando o agente encontra uma lacuna ele escreve um [!gap] na pagina.\n"));
});

afterEach(() => rmSync(raiz, { recursive: true, force: true }));

test("Dado quatro callouts reais, Quando gero o índice, Então o comando sai 0 e cria _meta/lacunas.md", async () => {
  const r = await capturar(() => comandoListarLacunas([wiki]));
  expect(r.codigo).toBe(0);
  expect(r.saida).toEqual([`${join(wiki, "_meta", "lacunas.md")}: 4 callout(s) em 3 página(s)`]);
  expect(r.erro).toEqual([]);
  expect(existsSync(join(wiki, "_meta", "lacunas.md"))).toBe(true);
});

test("Dado quatro callouts reais, Quando gero o índice, Então há quatro itens", async () => {
  await listarLacunas(wiki);
  expect(indice().split("\n").filter((linha) => linha.startsWith("- `"))).toHaveLength(4);
});

test.each([
  ["alfa/concepts/a.md", 10, "gap"],
  ["alfa/sources/b.md", 10, "gap"],
  ["beta/concepts/c.md", 15, "contradiction"],
] as const)("Dado o callout de %s, Quando gero o índice, Então o endereço e tipo conferem", async (rel, linha, tipo) => {
  await listarLacunas(wiki);
  expect(indice()).toContain(`\`${rel}:${linha}\` \`${tipo}\``);
});

test("Dado [!gap] citado em prosa, Quando gero o índice, Então a menção não entra", async () => {
  await listarLacunas(wiki);
  expect(indice()).not.toContain("concepts/d.md");
});

test("Dado gap e contradiction, Quando gero o índice sem filtro, Então contradiction entra por padrão", async () => {
  await listarLacunas(wiki);
  expect(indice()).toContain("`contradiction`");
});

test("Dado consulta por contradiction, Quando listo, Então devolve um resultado endereçado e não vaza gap", async () => {
  const linhas = await listarLacunas(wiki, { consultar: true, tipos: ["contradiction"] });
  expect(linhas).toEqual(["beta/concepts/c.md:15 [contradiction] A fonte P afirma W; a fonte Q afirma o contrario."]);
  expect(existsSync(join(wiki, "_meta"))).toBe(false);
});

test("Dado índice existente, Quando consulto, Então o hash de _meta/lacunas.md fica igual", async () => {
  await listarLacunas(wiki);
  const antes = hashIndice();
  await listarLacunas(wiki, { consultar: true, tipos: ["contradiction"] });
  expect(hashIndice()).toBe(antes);
});

test("Dado a wiki alterada depois do índice, Quando consulto e gero de novo, Então só a geração muda o hash", async () => {
  await listarLacunas(wiki);
  gravar("beta/concepts/e.md", pagina("e", "> [!gap]\n> Lacuna nova, aberta depois do primeiro indice.\n"));
  const antes = hashIndice();
  await listarLacunas(wiki, { consultar: true, tipos: ["gap"] });
  expect(hashIndice()).toBe(antes);
  await listarLacunas(wiki);
  expect(hashIndice()).not.toBe(antes);
});

test("Dado wiki sem índice, Quando peço --stdout, Então imprime sem escrever e o modo normal recria", async () => {
  const r = await capturar(() => comandoListarLacunas([wiki, "--stdout"]));
  expect(r.codigo).toBe(0);
  expect(r.saida.join("\n")).toContain("# Lacunas abertas");
  expect(existsSync(join(wiki, "_meta"))).toBe(false);
  await listarLacunas(wiki);
  expect(existsSync(join(wiki, "_meta", "lacunas.md"))).toBe(true);
});

test("Dado página solta, Quando gero o índice, Então ela cai em (raiz)", async () => {
  gravar("solta.md", pagina("solta", "> [!gap]\n> Lacuna de pagina solta.\n"));
  await listarLacunas(wiki);
  expect(indice()).toContain("## (raiz) (1)");
});

test("Dado páginas nos diretórios de tipo e reservados, Quando gero o índice, Então não invento área", async () => {
  gravar("concepts/raiz.md", pagina("raiz", "> [!gap] Nas concepts.\n"));
  gravar("log/diario.md", pagina("diario", "> [!gap] No log.\n"));
  gravar("_meta/oculta.md", pagina("oculta", "> [!gap] No meta.\n"));
  await listarLacunas(wiki);
  expect(indice()).toContain("## (raiz) (2)");
  expect(indice()).not.toContain("oculta.md");
});

test("Dado filtros de área, busca sem acento e limite, Quando consulto, Então devolvo só o endereço pedido", async () => {
  const linhas = await listarLacunas(wiki, { area: "alfa", buscar: "definição", limite: 1 });
  expect(linhas).toEqual(["alfa/concepts/a.md:10 [gap] Falta a definicao de X."]);
  expect(existsSync(join(wiki, "_meta"))).toBe(false);
});

test("Dado consulta sem resultado, Quando executo, Então sai 0, avisa e não escreve _meta", async () => {
  const r = await capturar(() => comandoListarLacunas([wiki, "--consultar", "--buscar", "inexistente"]));
  expect(r).toEqual({ codigo: 0, saida: [], erro: ["nenhum callout casou com a consulta"] });
  expect(existsSync(join(wiki, "_meta"))).toBe(false);
});

test("Dado wiki inexistente, Quando executo, Então sai 2 e nomeia a wiki", async () => {
  const ausente = join(raiz, "ausente");
  const r = await capturar(() => comandoListarLacunas([ausente]));
  expect(r).toEqual({ codigo: 2, saida: [], erro: [`erro: wiki não encontrada: ${ausente}`] });
});

test("Dado o CLI, Quando executo listar-lacunas --consultar, Então o subcomando está registrado", async () => {
  expect(Object.keys(subcomandos)).toContain("listar-lacunas");
  const r = await capturar(() => executar(["listar-lacunas", wiki, "--consultar", "--tipos", "contradiction"]));
  expect(r.codigo).toBe(0);
  expect(r.saida).toEqual(["beta/concepts/c.md:15 [contradiction] A fonte P afirma W; a fonte Q afirma o contrario."]);
});
