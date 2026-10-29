import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atividadeRecente, fontesSemIngestao, saudeDaWiki } from "../src/lib/ui-inicio";

let raiz: string;
let wiki: string;
beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "anvilore-inicio-"));
  wiki = join(raiz, "wiki");
  mkdirSync(join(wiki, "log"), { recursive: true });
  mkdirSync(join(wiki, "pessoal", "concepts"), { recursive: true });
  mkdirSync(join(raiz, "raw", "pessoal"), { recursive: true });
});
afterEach(() => rmSync(raiz, { recursive: true, force: true }));

const escrever = (relativo: string, texto: string) => { mkdirSync(join(relativo.startsWith("raw") ? raiz : wiki, relativo, ".."), { recursive: true }); writeFileSync(join(relativo.startsWith("raw") ? raiz : wiki, relativo), texto); };

// --- Atividade (wiki/log/) ---------------------------------------------------------------------------------

test("Dado logs de dias diferentes Quando leio a atividade Então vem a mais nova primeiro, com data, tipo e resumo", async () => {
  escrever("log/log-2026-10-27.md", "# 2026-10-27\n\n## [2026-10-27] ingest | Fonte antiga\n");
  escrever("log/log-2026-10-29.md", "# 2026-10-29\n\n## [2026-10-29] ingest | Primeira do dia\n\ncorpo\n\n## [2026-10-29] lint | Segunda do dia\n");
  expect(await atividadeRecente(wiki)).toEqual([
    { data: "2026-10-29", tipo: "lint", resumo: "Segunda do dia", arquivo: "log/log-2026-10-29.md" },
    { data: "2026-10-29", tipo: "ingest", resumo: "Primeira do dia", arquivo: "log/log-2026-10-29.md" },
    { data: "2026-10-27", tipo: "ingest", resumo: "Fonte antiga", arquivo: "log/log-2026-10-27.md" },
  ]);
});

test("Dado mais entradas que o limite Quando leio a atividade Então devolve só as mais novas", async () => {
  escrever("log/log-2026-10-29.md", Array.from({ length: 5 }, (_, n) => `## [2026-10-29] ingest | Item ${n}`).join("\n\n"));
  const itens = await atividadeRecente(wiki, 2);
  expect(itens.map(item => item.resumo)).toEqual(["Item 4", "Item 3"]);
});

test("Dado cabeçalho dentro de bloco de código ou sem o formato do log Quando leio Então ignora", async () => {
  escrever("log/log-2026-10-29.md", "## [2026-10-29] ingest | Real\n\n```\n## [2026-10-29] ingest | Falsa\n```\n\n## sem data | nada\n\n## [2026-10-29] sem-barra\n");
  expect((await atividadeRecente(wiki)).map(item => item.resumo)).toEqual(["Real"]);
});

test("Dado wiki sem pasta log/ ou arquivo que não é de dia Quando leio Então a lista é vazia", async () => {
  rmSync(join(wiki, "log"), { recursive: true });
  expect(await atividadeRecente(wiki)).toEqual([]);
  mkdirSync(join(wiki, "log"));
  escrever("log/anotacao.md", "## [2026-10-29] ingest | Solta\n");
  expect(await atividadeRecente(wiki)).toEqual([]);
});

// --- raw/ sem ingestão -------------------------------------------------------------------------------------

test("Dado fonte em raw/ citada por uma página Quando listo Então só a não citada aparece", async () => {
  escrever("raw/pessoal/citada.md", "a");
  escrever("raw/pessoal/solta.md", "bb");
  escrever("raw/pessoal/ponto.md", "c");
  escrever("raw/pessoal/outra.md", "d");
  escrever("pessoal/concepts/a.md", "---\ntype: concept\nslug: a\nsources:\n  - resource: raw/pessoal/citada.md\n  - resource: ./raw/pessoal/ponto.md\n---\ncorpo\n");
  escrever("pessoal/concepts/b.md", "---\ntype: source\nslug: b\noriginal_file: raw\\pessoal\\outra.md\n---\ncorpo\n");
  expect(await fontesSemIngestao(raiz, wiki)).toEqual([{ caminho: "raw/pessoal/solta.md", area: "pessoal", bytes: 2 }]);
});

test("Dado arquivos ocultos, .gitkeep e subpastas Quando listo Então ignora o oculto e acha o aninhado", async () => {
  escrever("raw/pessoal/.gitkeep", "");
  escrever("raw/pessoal/.oculto.md", "x");
  escrever("raw/pessoal/livros/capitulo.md", "x");
  escrever("raw/solto.md", "x");
  const itens = await fontesSemIngestao(raiz, wiki);
  expect(itens).toEqual([
    { caminho: "raw/pessoal/livros/capitulo.md", area: "pessoal", bytes: 1 },
    { caminho: "raw/solto.md", area: "", bytes: 1 },
  ]);
});

test("Dado página com frontmatter inválido Quando listo Então não derruba a lista", async () => {
  escrever("raw/pessoal/a.md", "x");
  escrever("pessoal/concepts/quebrada.md", "---\ntype: [aberto\n---\ncorpo\n");
  expect((await fontesSemIngestao(raiz, wiki)).map(item => item.caminho)).toEqual(["raw/pessoal/a.md"]);
});

test("Dado raw/ ausente Quando listo Então a lista é vazia", async () => {
  rmSync(join(raiz, "raw"), { recursive: true });
  expect(await fontesSemIngestao(raiz, wiki)).toEqual([]);
});

test("Dado link simbólico em raw/ apontando para fora Quando listo Então não segue o link", async () => {
  const fora = mkdtempSync(join(tmpdir(), "anvilore-inicio-fora-"));
  try {
    writeFileSync(join(fora, "segredo.md"), "x");
    symlinkSync(fora, join(raiz, "raw", "pessoal", "ligacao"));
    expect(await fontesSemIngestao(raiz, wiki)).toEqual([]);
  } finally { rmSync(fora, { recursive: true, force: true }); }
});

test("Dado fonte com conversa aberta Quando listo Então a fonte traz o id da conversa", async () => {
  escrever("raw/pessoal/em-curso.md", "x");
  expect(await fontesSemIngestao(raiz, wiki, new Map([["raw/pessoal/em-curso.md", "conv-1"]]))).toEqual([
    { caminho: "raw/pessoal/em-curso.md", area: "pessoal", bytes: 1, conversa: "conv-1" },
  ]);
});

// --- Saúde -------------------------------------------------------------------------------------------------

const PAGINA = (slug: string, corpo: string, extras = "") => `---\ntype: concept\nslug: ${slug}\ntitle: ${slug.toUpperCase()}\ntags: [x]\nrelated_sources: []\nrelated_concepts: []\n${extras}---\n\n${corpo}\n`;

function wikiSaudavel() {
  escrever("index.md", "# Índice\n\n- [[a]]\n- [[b]]\n");
  escrever("pessoal/concepts/a.md", PAGINA("a", "linha um\nlinha dois\nveja [[b]]"));
  escrever("pessoal/concepts/b.md", PAGINA("b", "linha um\nlinha dois\nveja [[a]]"));
}

test("Dado wiki limpa Quando consulto a saúde Então validar passa e não há pendência", async () => {
  wikiSaudavel();
  const saude = await saudeDaWiki(wiki);
  expect(saude.validar).toMatchObject({ ok: true, outrosErros: [], semAprovacao: 0 });
  expect(saude.auditoria.total).toBe(0);
  expect(saude.lacunas).toEqual({ total: 0, contradicoes: 0, abertas: [] });
  expect(saude.vencidas).toBe(0);
});

test("Dado página gerada sem aprovação Quando consulto a saúde Então conta como portão e não como erro", async () => {
  wikiSaudavel();
  escrever("index.md", "# Índice\n\n- [[a]]\n- [[b]]\n- [[g]]\n");
  escrever("pessoal/concepts/g.md", PAGINA("g", "linha um\nlinha dois\nveja [[a]]", "generated:\n  by: agente/teste\n  at: 2026-10-27T10:00:00Z\n"));
  const saude = await saudeDaWiki(wiki);
  expect(saude.validar.ok).toBe(false);
  expect(saude.validar.semAprovacao).toBe(1);
  expect(saude.validar.outrosErros).toEqual([]);
});

test("Dado lacuna e contradição abertas Quando consulto a saúde Então lista as duas e conta a contradição", async () => {
  wikiSaudavel();
  escrever("pessoal/concepts/a.md", PAGINA("a", "veja [[b]]\n> [!gap] Falta o preço\n> [!contradiction] Datas divergem\nlinha"));
  const saude = await saudeDaWiki(wiki);
  expect(saude.lacunas.total).toBe(2);
  expect(saude.lacunas.contradicoes).toBe(1);
  expect(saude.lacunas.abertas).toEqual([
    "pessoal/concepts/a.md:11 [gap] Falta o preço",
    "pessoal/concepts/a.md:12 [contradiction] Datas divergem",
  ]);
});

test("Dado página fora do índice Quando consulto a saúde Então a auditoria relata e validar também", async () => {
  wikiSaudavel();
  escrever("index.md", "# Índice\n\n- [[a]]\n");
  const saude = await saudeDaWiki(wiki);
  expect(saude.auditoria.total).toBeGreaterThan(0);
  expect(saude.auditoria.resumo.join(" ")).toContain("pessoal/concepts/b.md");
  expect(saude.auditoria.resumo.join(" ")).not.toContain(raiz);
  expect(saude.validar.outrosErros.length).toBeGreaterThan(0);
});

test("Dado wiki inexistente Quando consulto a saúde Então devolve erro legível e não lança", async () => {
  const saude = await saudeDaWiki(join(raiz, "nao-existe"));
  expect(saude.validar.ok).toBe(false);
  expect(saude.validar.outrosErros.length).toBeGreaterThan(0);
  expect(saude.auditoria.erro).toBeDefined();
});

// --- Resumo da tela --------------------------------------------------------------------------------------

import { resumoDoInicio } from "../src/lib/ui-inicio";

const GERADA = (slug: string, extras = "") => `---\ntype: concept\nslug: ${slug}\ntitle: ${slug}\ngenerated:\n  by: agente/teste\n  at: 2026-10-27T10:00:00Z\n${extras}---\n\nCorpo.\n`;

test("Dado rascunhos novos, atualizados e inválidos Quando monto o resumo Então conta cada um e limita a lista", async () => {
  for (let n = 0; n < 7; n++) escrever(`pessoal/concepts/n${n}.md`, GERADA(`n${n}`));
  escrever("pessoal/concepts/at.md", GERADA("at", "verified:\n  - by: human:ana\n    at: 2026-10-26T10:00:00Z\n"));
  escrever("pessoal/concepts/ruim.md", "---\ntype: concept\nslug: ruim\ngenerated: ontem\n---\nX\n");
  const { rascunhos } = await resumoDoInicio(raiz);
  expect(rascunhos).toMatchObject({ total: 9, novas: 7, atualizadas: 1, comErro: 1 });
  expect(rascunhos.itens).toHaveLength(5);
  expect(Object.keys(rascunhos.itens[0]!).sort()).toEqual(["caminho", "status", "tipo", "titulo"]);
});

test("Dado conversa aberta sobre uma fonte Quando monto o resumo Então a fonte aponta a conversa", async () => {
  escrever("raw/pessoal/a.md", "x");
  const resumo = await resumoDoInicio(raiz, new Map([["raw/pessoal/a.md", "conv-9"]]));
  expect(resumo.fontes).toEqual([{ caminho: "raw/pessoal/a.md", area: "pessoal", bytes: 1, conversa: "conv-9" }]);
  expect(resumo.atividade).toEqual([]);
});

test("Dado o resumo e a saúde Quando rodam Então não escrevem nada no vault", async () => {
  wikiSaudavel();
  escrever("raw/pessoal/a.md", "x");
  escrever("log/log-2026-10-29.md", "## [2026-10-29] ingest | X\n");
  const foto = () => Bun.spawnSync(["find", raiz, "-type", "f", "-printf", "%p %s %T@\\n"]).stdout.toString().split("\n").sort().join("\n");
  const antes = foto();
  await resumoDoInicio(raiz);
  await saudeDaWiki(wiki);
  expect(foto()).toBe(antes);
});
