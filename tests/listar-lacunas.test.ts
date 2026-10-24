import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

// Criar symlink no Windows pode exigir modo de desenvolvedor ou privilégio elevado.
const testeSymlink = process.platform === "win32" ? test.skip : test;

testeSymlink("Dado página .md em symlink, Quando consulto, Então o callout aparece pelo caminho do link", async () => {
  const alvo = join(raiz, "alvo.md");
  writeFileSync(alvo, "> [!gap] Vem do link.\n");
  symlinkSync(alvo, join(wiki, "alfa", "link.md"));
  const linhas = await listarLacunas(wiki, { consultar: true });
  expect(linhas).toContain("alfa/link.md:1 [gap] Vem do link.");
});

testeSymlink("Dado symlink .md quebrado, Quando consulto, Então avisa o caminho e continua", async () => {
  const link = join(wiki, "alfa", "quebrado.md");
  symlinkSync(join(raiz, "ausente.md"), link);
  const r = await capturar(() => comandoListarLacunas([wiki, "--consultar"]));
  expect(r.codigo).toBe(0);
  expect(r.erro).toEqual([`AVISO: symlink quebrado: ${link}`]);
  expect(r.saida.join("\n")).toContain("alfa/concepts/a.md:10");
});

testeSymlink("Dado diretório symlink para outra área da wiki, Quando consulto, Então não duplica callouts e avisa o link", async () => {
  const espelho = join(wiki, "alfa", "espelho");
  symlinkSync(join(wiki, "beta"), espelho);
  const r = await capturar(() => comandoListarLacunas([wiki, "--consultar"]));
  expect(r.codigo).toBe(0);
  expect(r.erro).toEqual([`AVISO: symlink de diretório não seguido: ${espelho}`]);
  expect(r.saida.join("\n").split("\n")).toHaveLength(4);
  expect(r.saida.join("\n")).not.toContain("espelho");
});

testeSymlink("Dado diretório symlink para fora da wiki, Quando gero o índice, Então nada de fora entra e avisa o link", async () => {
  const fora = join(raiz, "fora", "sub");
  mkdirSync(fora, { recursive: true });
  writeFileSync(join(fora, "x.md"), "> [!gap] Fora da wiki.\n");
  const externo = join(wiki, "externo");
  symlinkSync(fora, externo);
  const r = await capturar(() => comandoListarLacunas([wiki]));
  expect(r.codigo).toBe(0);
  expect(r.erro).toEqual([`AVISO: symlink de diretório não seguido: ${externo}`]);
  expect(r.saida).toEqual([`${join(wiki, "_meta", "lacunas.md")}: 4 callout(s) em 3 página(s)`]);
  expect(indice()).not.toContain("externo");
});

testeSymlink("Dado symlink de diretório para um ancestral, Quando consulto, Então avisa o link e termina", async () => {
  const volta = join(wiki, "alfa", "volta");
  symlinkSync(wiki, volta);
  const r = await capturar(() => comandoListarLacunas([wiki, "--consultar"]));
  expect(r.codigo).toBe(0);
  expect(r.erro).toEqual([`AVISO: symlink de diretório não seguido: ${volta}`]);
  expect(r.saida.join("\n").split("\n")).toHaveLength(4);
});

testeSymlink("Dado symlink que aponta para si mesmo, Quando consulto, Então avisa como link quebrado e continua", async () => {
  const link = join(wiki, "alfa", "si.md");
  symlinkSync(link, link);
  const r = await capturar(() => comandoListarLacunas([wiki, "--consultar"]));
  expect(r.codigo).toBe(0);
  expect(r.erro).toEqual([`AVISO: symlink quebrado: ${link}`]);
});

test("Dado quatro callouts e --limite -1 separado, Quando consulto, Então retorna todos menos o último", async () => {
  const r = await capturar(() => comandoListarLacunas([wiki, "--consultar", "--limite", "-1"]));
  expect(r.codigo).toBe(0);
  expect(r.erro).toEqual([]);
  expect(r.saida.join("\n").split("\n")).toEqual([
    "alfa/concepts/a.md:10 [gap] Falta a definicao de X.",
    "alfa/sources/b.md:10 [gap] Nenhuma fonte cobre Y.",
    "beta/concepts/c.md:10 [gap] Falta medir Z.",
  ]);
});

test.each([
  ["CR solitário", "\r"],
  ["form feed", "\f"],
  ["separador Unicode", "\u2028"],
] as const)("Dado texto com %s, Quando consulto, Então numero o callout como splitlines do Python", async (_nome, separador) => {
  gravar("extremos/separador.md", `Prosa${separador}> [!gap] Separado.${separador}`);
  expect(await listarLacunas(wiki, { consultar: true, area: "extremos" })).toEqual([
    "extremos/separador.md:2 [gap] Separado.",
  ]);
});

test("Dado BOM antes de callout na primeira linha, Quando consulto, Então ele não é reconhecido", async () => {
  gravar("extremos/bom.md", "\uFEFF> [!gap] Oculto.\n> [!gap] Visível.\n");
  expect(await listarLacunas(wiki, { consultar: true, area: "extremos" })).toEqual([
    "extremos/bom.md:2 [gap] Visível.",
  ]);
});

test("Dado --tipos com valor desconhecido, Quando executo, Então reprova com saída 2", async () => {
  const r = await capturar(() => comandoListarLacunas([wiki, "--consultar", "--tipos", "gap,note"]));
  expect(r.codigo).toBe(2);
  expect(r.saida).toEqual([]);
  expect(r.erro.join("\n")).toContain("tipo de callout inválido: note");
});

test("Dado --limite com texto, Quando executo, Então reprova sem ler a wiki", async () => {
  const r = await capturar(() => comandoListarLacunas([wiki, "--limite", "abc"]));
  expect(r).toEqual({ codigo: 2, saida: [], erro: ["argumento inválido para --limite"] });
  expect(existsSync(join(wiki, "_meta"))).toBe(false);
});

test("Dado opção desconhecida, Quando executo, Então reprova nomeando a opção", async () => {
  const r = await capturar(() => comandoListarLacunas([wiki, "--desconhecido"]));
  expect(r.codigo).toBe(2);
  expect(r.saida).toEqual([]);
  expect(r.erro.join("\n")).toContain("--desconhecido");
});

test("Dado dois caminhos de wiki, Quando executo, Então reprova com o uso", async () => {
  const r = await capturar(() => comandoListarLacunas([wiki, join(raiz, "outra")]));
  expect(r.codigo).toBe(2);
  expect(r.saida).toEqual([]);
  expect(r.erro.join("\n")).toContain("Uso: anvilore listar-lacunas");
});

test("Dado --help, Quando executo, Então mostro o uso sem ler a wiki", async () => {
  const r = await capturar(() => comandoListarLacunas([join(raiz, "ausente"), "--help"]));
  expect(r.codigo).toBe(0);
  expect(r.erro).toEqual([]);
  expect(r.saida.join("\n")).toContain("Uso: anvilore listar-lacunas");
});
