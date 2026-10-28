import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { auditarWiki, comandoAuditar, exibirCaminho } from "../src/comandos/auditar";
import { executar, subcomandos } from "../src/cli";
import { esqueletoEm } from "./apoio/esqueleto";

const HOJE = "2026-01-02";
const CORPO = ["linha um do corpo", "linha dois do corpo", "linha tres do corpo"];
const TITULOS = ["Páginas órfãs", "Entradas ausentes do índice", "Wikilinks quebrados", "Frontmatter incompleto", "Páginas vazias ou esboço"];

let raiz: string;
let W: string;

// O relatório mostra os caminhos com "/" em qualquer sistema (a forma do índice e dos links); só o separador do Windows vira "/".
const exib = (rel = "") => exibirCaminho(W, rel, process.platform === "win32" ? "\\" : "/");

function gravar(rel: string, texto: string): void {
  const destino = join(W, rel);
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, texto);
}

function pagina(rel: string, tipo: string, ...corpo: string[]): void {
  const slug = rel.replace(/^.*\//, "").replace(/\.md$/, "");
  const extra = tipo === "source"
    ? "original_file: raw/exemplo/f.md\ndate_ingested: 2026-01-01\nauthors: []\n"
    : "related_sources: []\nrelated_concepts: []\n";
  gravar(rel, `---\ntitle: "${slug}"\nslug: ${slug}\ntype: ${tipo}\ntags: []\n${extra}---\n\n${corpo.join("\n")}\n`);
}

function indice(...slugs: string[]): void {
  gravar("index.md", `# Índice\n\n## Área: exemplo\n\n### Conceitos\n\n${slugs.map((s) => `- [[${s}]] — resumo`).join("\n")}\n`);
  gravar("log.md", "# Log\n");
}

async function auditar() {
  return auditarWiki(W, HOJE);
}

function secao(relatorio: string, titulo: string): string[] {
  const linhas = relatorio.split("\n");
  const inicio = linhas.findIndex((l) => l.startsWith(`## ${titulo}`));
  const fim = linhas.findIndex((l, i) => i > inicio && (l.startsWith("## ") || l.startsWith("Total:")));
  return linhas.slice(inicio + 1, fim).filter((l) => l !== "");
}

function itens(relatorio: string, titulo: string): string[] {
  return secao(relatorio, titulo).filter((l) => l.startsWith("- "));
}

function noRelatorio(relatorio: string, titulo: string, trecho: string): boolean {
  return secao(relatorio, titulo).some((linha) => linha.includes(trecho));
}

async function capturar(acao: () => Promise<number>) {
  const saida: string[] = [];
  const erro: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...args) => { saida.push(args.join(" ")); });
  const err = spyOn(console, "error").mockImplementation((...args) => { erro.push(args.join(" ")); });
  try {
    return { codigo: await acao(), saida, erro };
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
}

function arquivosDe(pasta: string): string[] {
  return readdirSync(pasta, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name))
    .sort();
}

function hashDe(pasta: string): string {
  const h = createHash("sha256");
  for (const arquivo of arquivosDe(pasta)) h.update(arquivo).update(readFileSync(arquivo));
  return h.digest("hex");
}

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "anvilore-auditar-"));
  W = join(raiz, "wiki");
  mkdirSync(W);
  pagina("exemplo/concepts/alfa.md", "concept", ...CORPO);
  pagina("exemplo/concepts/beta.md", "concept", ...CORPO);
  indice("alfa", "beta");
});

afterEach(() => rmSync(raiz, { recursive: true, force: true }));

// C1 ---------------------------------------------------------------------

test("Dado páginas indexadas sem link entre si, Quando audito, Então ambas são órfãs e a saída é 1", async () => {
  const r = await auditar();
  expect(r.codigo).toBe(1);
  expect(noRelatorio(r.relatorio, "Páginas órfãs", "exemplo/concepts/alfa.md")).toBe(true);
  expect(noRelatorio(r.relatorio, "Páginas órfãs", "exemplo/concepts/beta.md")).toBe(true);
});

test("Dado beta que passa a linkar alfa, Quando audito, Então alfa sai das órfãs e beta continua nelas", async () => {
  gravar("exemplo/concepts/beta.md", readFileSync(join(W, "exemplo/concepts/beta.md"), "utf8") + "\nVeja tambem [[alfa]].\n");
  const r = await auditar();
  expect(noRelatorio(r.relatorio, "Páginas órfãs", "exemplo/concepts/alfa.md")).toBe(false);
  expect(noRelatorio(r.relatorio, "Páginas órfãs", "exemplo/concepts/beta.md")).toBe(true);
});

// C2 ---------------------------------------------------------------------

test("Dado página fora do índice, Quando audito, Então ela é entrada ausente e a indexada não", async () => {
  pagina("exemplo/concepts/gama.md", "concept", ...CORPO);
  const r = await auditar();
  expect(noRelatorio(r.relatorio, "Entradas ausentes do índice", "exemplo/concepts/gama.md")).toBe(true);
  expect(noRelatorio(r.relatorio, "Entradas ausentes do índice", "exemplo/concepts/alfa.md")).toBe(false);
});

test("Dado gama que entra no índice, Quando audito, Então ela sai das entradas ausentes", async () => {
  pagina("exemplo/concepts/gama.md", "concept", ...CORPO);
  indice("alfa", "beta", "gama");
  const r = await auditar();
  expect(noRelatorio(r.relatorio, "Entradas ausentes do índice", "exemplo/concepts/gama.md")).toBe(false);
});

test("Dado wiki sem index.md, Quando audito, Então toda página é entrada ausente", async () => {
  rmSync(join(W, "index.md"));
  const r = await auditar();
  expect(secao(r.relatorio, "Entradas ausentes do índice")).toEqual([
    `- ${exib("exemplo/concepts/alfa.md")} — não aparece em ${exib("index.md")}`,
    `- ${exib("exemplo/concepts/beta.md")} — não aparece em ${exib("index.md")}`,
  ]);
});

// C3 ---------------------------------------------------------------------

test("Dado link para página inexistente, Quando audito, Então a origem e o slug alvo aparecem na mesma linha", async () => {
  pagina("exemplo/concepts/delta.md", "concept", "Aponta para [[pagina-que-nao-existe]].", ...CORPO);
  indice("alfa", "beta", "delta");
  const r = await auditar();
  expect(secao(r.relatorio, "Wikilinks quebrados")).toEqual([
    `- ${exib("exemplo/concepts/delta.md")} → [[pagina-que-nao-existe]] não corresponde a nenhuma página`,
  ]);
});

test("Dado que a página alvo passa a existir, Quando audito, Então o par sai da lista de quebrados", async () => {
  pagina("exemplo/concepts/delta.md", "concept", "Aponta para [[pagina-que-nao-existe]].", ...CORPO);
  pagina("exemplo/concepts/pagina-que-nao-existe.md", "concept", ...CORPO);
  const r = await auditar();
  expect(noRelatorio(r.relatorio, "Wikilinks quebrados", "pagina-que-nao-existe")).toBe(false);
});

test("Dado link repetido na mesma página e link quebrado no índice, Quando audito, Então cada par aparece uma vez", async () => {
  pagina("exemplo/concepts/delta.md", "concept", "[[fantasma]] e de novo [[fantasma]].", ...CORPO);
  gravar("index.md", "# Índice\n\n- [[alfa]]\n- [[fantasma]]\n- [[fantasma]]\n");
  const r = await auditar();
  expect(secao(r.relatorio, "Wikilinks quebrados")).toEqual([
    `- ${exib("exemplo/concepts/delta.md")} → [[fantasma]] não corresponde a nenhuma página`,
    `- ${exib("index.md")} → [[fantasma]] não corresponde a nenhuma página`,
  ]);
});

test("Dado apelido, âncora e alvo vazio nos wikilinks, Quando audito, Então só o slug conta", async () => {
  pagina("exemplo/concepts/delta.md", "concept", "[[alfa|apelido]] [[beta#secao]] [[|so-apelido]] [[#so-ancora]] [[ ]]", ...CORPO);
  const r = await auditar();
  expect(itens(r.relatorio, "Wikilinks quebrados")).toEqual([]);
  expect(noRelatorio(r.relatorio, "Páginas órfãs", "exemplo/concepts/alfa.md")).toBe(false);
  expect(noRelatorio(r.relatorio, "Páginas órfãs", "exemplo/concepts/beta.md")).toBe(false);
});

test("Dado página que linka a si mesma, Quando audito, Então o auto-link não a tira das órfãs", async () => {
  pagina("exemplo/concepts/alfa.md", "concept", "Eu: [[alfa]].", ...CORPO);
  const r = await auditar();
  expect(noRelatorio(r.relatorio, "Páginas órfãs", "exemplo/concepts/alfa.md")).toBe(true);
});

test("Dado wikilink com quebra de linha dentro, Quando audito, Então não conta como link", async () => {
  pagina("exemplo/concepts/delta.md", "concept", "[[alfa\nbeta]]", ...CORPO);
  const r = await auditar();
  expect(itens(r.relatorio, "Wikilinks quebrados")).toEqual([]);
});

test("Dado wikilink com CR solitário dentro, Quando audito, Então o CR vira quebra de linha e não conta", async () => {
  pagina("exemplo/concepts/delta.md", "concept", "[[alfa\rbeta]]", ...CORPO);
  const r = await auditar();
  expect(itens(r.relatorio, "Wikilinks quebrados")).toEqual([]);
});

// C4 ---------------------------------------------------------------------

const SEM_SLUG = `---
title: "epsilon"
type: concept
tags: []
related_sources: []
related_concepts: []
---

linha um do corpo
linha dois do corpo
linha tres do corpo
`;

test("Dado página sem o campo slug, Quando audito, Então o campo ausente é nomeado", async () => {
  gravar("exemplo/concepts/epsilon.md", SEM_SLUG);
  const r = await auditar();
  expect(secao(r.relatorio, "Frontmatter incompleto")).toEqual([
    `- ${exib("exemplo/concepts/epsilon.md")} — campo ausente: slug`,
  ]);
});

test("Dado que o campo slug é acrescentado, Quando audito, Então a página sai da lista", async () => {
  gravar("exemplo/concepts/epsilon.md", SEM_SLUG.replace("type: concept", "slug: epsilon\ntype: concept"));
  const r = await auditar();
  expect(noRelatorio(r.relatorio, "Frontmatter incompleto", "epsilon.md")).toBe(false);
});

test("Dado fonte sem os campos próprios do tipo, Quando audito, Então todos são nomeados na ordem do contrato", async () => {
  gravar("exemplo/sources/fonte.md", `---\ntitle: "f"\nslug: fonte\ntype: source\ntags: []\n---\n\n${CORPO.join("\n")}\n`);
  const r = await auditar();
  expect(secao(r.relatorio, "Frontmatter incompleto")).toEqual([
    `- ${exib("exemplo/sources/fonte.md")} — campos ausentes: original_file, date_ingested, authors`,
  ]);
});

test("Dado type desconhecido, Quando audito, Então só os campos comuns são exigidos", async () => {
  gravar("exemplo/x.md", `---\ntitle: "x"\nslug: x\ntype: outro\ntags: []\n---\n\n${CORPO.join("\n")}\n`);
  const r = await auditar();
  expect(noRelatorio(r.relatorio, "Frontmatter incompleto", "x.md")).toBe(false);
});

test("Dado campo repetido, indentado ou com espaço antes dos dois pontos, Quando audito, Então vale a regra do original", async () => {
  gravar("exemplo/dup.md", `---\ntitle : "d"\nslug: dup\ntype: source\ntype: concept\n  tags: []\n---\n\n${CORPO.join("\n")}\n`);
  const r = await auditar();
  expect(secao(r.relatorio, "Frontmatter incompleto")).toEqual([
    `- ${exib("exemplo/dup.md")} — campos ausentes: tags, original_file, date_ingested, authors`,
  ]);
});

test.each([
  ["sem frontmatter", `texto\n${CORPO.join("\n")}\n`],
  ["cerca nunca fechada", `---\ntitle: "x"\nslug: x\ntype: concept\ntags: []\n\n${CORPO.join("\n")}\n`],
  ["BOM antes da cerca", `﻿---\ntitle: "x"\nslug: x\ntype: concept\ntags: []\nrelated_sources: []\nrelated_concepts: []\n---\n${CORPO.join("\n")}\n`],
  ["arquivo vazio", ""],
] as const)("Dado página %s, Quando audito, Então ela é listada como sem frontmatter e não como esboço", async (_nome, texto) => {
  gravar("exemplo/sem.md", texto);
  const r = await auditar();
  expect(secao(r.relatorio, "Frontmatter incompleto")).toEqual([`- ${exib("exemplo/sem.md")} — sem frontmatter`]);
  expect(noRelatorio(r.relatorio, "Páginas vazias ou esboço", "sem.md")).toBe(false);
});

test("Dado página com CRLF e sem newline final, Quando audito, Então não há achado nela", async () => {
  const texto = `---\r\ntitle: "x"\r\nslug: x\r\ntype: concept\r\ntags: []\r\nrelated_sources: []\r\nrelated_concepts: []\r\n---\r\n\r\n${CORPO.join("\r\n")}`;
  gravar("exemplo/x.md", texto);
  const r = await auditar();
  for (const titulo of ["Frontmatter incompleto", "Páginas vazias ou esboço"]) {
    expect(noRelatorio(r.relatorio, titulo, "x.md")).toBe(false);
  }
});

// C5 ---------------------------------------------------------------------

test("Dado corpo de uma linha, Quando audito, Então a página é esboço e a de três linhas não", async () => {
  pagina("exemplo/concepts/zeta.md", "concept", "uma linha so de corpo");
  const r = await auditar();
  expect(secao(r.relatorio, "Páginas vazias ou esboço")).toEqual([
    `- ${exib("exemplo/concepts/zeta.md")} — 1 linha(s) de corpo (mínimo 3)`,
  ]);
});

test("Dado que o corpo é completado, Quando audito, Então a página sai dos esboços", async () => {
  pagina("exemplo/concepts/zeta.md", "concept", ...CORPO);
  const r = await auditar();
  expect(noRelatorio(r.relatorio, "Páginas vazias ou esboço", "zeta.md")).toBe(false);
});

test.each([
  ["form feed", "\f", 3],
  ["CR solitário", "\r", 3],
  ["separador Unicode", "\u2028", 3],
  ["tabulação (não separa)", "\t", 1],
] as const)("Dado corpo separado por %s, Quando audito, Então conto as linhas como o splitlines do Python", async (_nome, sep, linhas) => {
  gravar("exemplo/sep.md", `---\ntitle: "s"\nslug: sep\ntype: concept\ntags: []\nrelated_sources: []\nrelated_concepts: []\n---\n\na${sep}b${sep}c`);
  const r = await auditar();
  const esbocos = itens(r.relatorio, "Páginas vazias ou esboço");
  expect(esbocos.length).toBe(linhas === 3 ? 0 : 1);
  if (linhas !== 3) expect(esbocos[0]).toContain(`${linhas} linha(s) de corpo`);
});

test("Dado linhas só com espaço no corpo, Quando audito, Então elas não contam", async () => {
  pagina("exemplo/concepts/zeta.md", "concept", "a", "   ", "\t", "　", "b");
  const r = await auditar();
  expect(noRelatorio(r.relatorio, "Páginas vazias ou esboço", "2 linha(s) de corpo")).toBe(true);
});

// Estado limpo e saída ---------------------------------------------------

function limpa(): void {
  rmSync(W, { recursive: true, force: true });
  mkdirSync(W);
  pagina("concepts/um.md", "concept", "Liga para [[dois]].", ...CORPO);
  pagina("concepts/dois.md", "concept", "Liga para [[um]].", ...CORPO);
  indice("um", "dois");
}

test("Dado wiki sem problema, Quando audito, Então sai 0 e as cinco seções vêm zeradas", async () => {
  limpa();
  const r = await auditar();
  expect(r.codigo).toBe(0);
  expect(r.achados).toEqual([]);
  for (const titulo of TITULOS) {
    expect(r.relatorio).toContain(`## ${titulo} (0)`);
    expect(secao(r.relatorio, titulo)).toEqual(["_nenhum._"]);
  }
  expect(r.relatorio).toContain("Total: 0 achado(s) estrutural(is).");
});

test("Dado wiki com problema, Quando audito, Então sai 1 e achados lista cada linha do relatório", async () => {
  const r = await auditar();
  expect(r.codigo).toBe(1);
  expect(r.achados.length).toBeGreaterThan(0);
  expect(r.achados.every((linha) => linha.startsWith("- "))).toBe(true);
  expect(r.relatorio).toContain(`Total: ${r.achados.length} achado(s) estrutural(is).`);
});

test("Dado a wiki, Quando audito, Então o relatório tem cabeçalho, seções na ordem e rodapé do original", async () => {
  const r = await auditar();
  expect(r.relatorio.split("\n").filter((l) => l.startsWith("#"))).toEqual([
    `# Auditoria estrutural de ${exib()} — ${HOJE}`,
    ...TITULOS.map((t) => `## ${t} (${secao(r.relatorio, t).filter((l) => l.startsWith("- ")).length})`),
  ]);
  expect(r.relatorio.endsWith(
    "A dívida declarada (`[!gap]`, `[!contradiction]`) tem outro dono: `bun src/cli.ts listar-lacunas <wiki> --consultar`.\n",
  )).toBe(true);
});

test("Dado a data omitida, Quando audito, Então o cabeçalho usa a data de hoje", async () => {
  const r = await auditarWiki(W);
  expect(r.relatorio.split("\n")[0]).toMatch(/ — \d{4}-\d{2}-\d{2}$/);
});

test("Dado o caminho da wiki escrito de forma torta, Quando audito, Então os caminhos saem normalizados como no pathlib", async () => {
  const r = await auditarWiki(`${W}//./`, HOJE);
  expect(r.relatorio.split("\n")[0]).toBe(`# Auditoria estrutural de ${exib()} — ${HOJE}`);
  expect(r.relatorio).toContain(`- ${exib("exemplo/concepts/alfa.md")} —`);
});

test("Dado diretórios cujos nomes o separador desempata, Quando audito, Então as órfãs saem na ordem das partes do caminho", async () => {
  rmSync(join(W, "exemplo"), { recursive: true });
  pagina("a-b/x.md", "concept", ...CORPO);
  pagina("a/y.md", "concept", ...CORPO);
  indice("x", "y");
  const r = await auditar();
  expect(secao(r.relatorio, "Páginas órfãs").map((l) => l.split(" — ")[0])).toEqual([
    `- ${exib("a/y.md")}`,
    `- ${exib("a-b/x.md")}`,
  ]);
});

test("Dado reservados, navegação e arquivos que não são .md, Quando audito, Então ficam fora da varredura", async () => {
  gravar("_meta/lacunas.md", "sem frontmatter\n");
  gravar("log/2026-01-01.md", "sem frontmatter\n");
  gravar("exemplo/index.md", "sem frontmatter\n");
  gravar("exemplo/log.md", "sem frontmatter\n");
  gravar("exemplo/notas.txt", "sem frontmatter\n");
  const r = await auditar();
  expect(noRelatorio(r.relatorio, "Frontmatter incompleto", "lacunas")).toBe(false);
  expect(r.relatorio).not.toContain("2026-01-01.md");
  expect(r.relatorio).not.toContain("notas.txt");
  expect(secao(r.relatorio, "Frontmatter incompleto")).toEqual(["_nenhum._"]);
});

test("Dado a wiki do repositório, Quando audito, Então nada é escrito nela e o relatório existe", async () => {
  const { wiki } = await esqueletoEm(raiz);
  const antes = hashDe(wiki);
  const r = await auditarWiki(wiki, HOJE);
  expect(hashDe(wiki)).toBe(antes);
  expect(r.relatorio).toContain("## Páginas órfãs");
});

// Wiki inexistente -------------------------------------------------------

test("Dado diretório inexistente, Quando audito, Então sai 2 com a mensagem do original e sem relatório", async () => {
  const ausente = join(raiz, "nao-existe");
  expect(await auditarWiki(ausente, HOJE)).toEqual({
    achados: [], codigo: 2, relatorio: "", erro: `erro: wiki não encontrada: ${ausente}`,
  });
});

test("Dado um arquivo no lugar da wiki, Quando audito, Então sai 2", async () => {
  const arquivo = join(raiz, "arquivo");
  writeFileSync(arquivo, "x");
  expect((await auditarWiki(arquivo, HOJE)).codigo).toBe(2);
});

test("Dado um diretório chamado x.md na wiki, Quando executo auditar, Então avisa o caminho em stderr e não o trata como página", async () => {
  mkdirSync(join(W, "exemplo", "pasta.md"));
  const r = await capturar(() => comandoAuditar([W]));
  expect(r.erro).toEqual([`AVISO: diretório com nome de página ignorado: ${join(W, "exemplo", "pasta.md")}`]);
  expect(r.saida.join("\n")).not.toContain("pasta");
});

// Symlinks (R58/R61) -----------------------------------------------------

const testeSymlink = process.platform === "win32" ? test.skip : test;

testeSymlink("Dado página em symlink, Quando audito, Então ela entra pelo caminho do link", async () => {
  const alvo = join(raiz, "fora.md");
  writeFileSync(alvo, "sem frontmatter\n");
  symlinkSync(alvo, join(W, "exemplo", "link.md"));
  const r = await auditar();
  expect(secao(r.relatorio, "Frontmatter incompleto")).toEqual([`- ${exib("exemplo/link.md")} — sem frontmatter`]);
});

testeSymlink("Dado symlink quebrado e symlink de diretório, Quando audito pelo comando, Então avisa os dois e sai como sem eles", async () => {
  const quebrado = join(W, "exemplo", "quebrado.md");
  const diretorio = join(W, "espelho");
  symlinkSync(join(raiz, "ausente.md"), quebrado);
  symlinkSync(join(W, "exemplo"), diretorio);
  const r = await capturar(() => comandoAuditar([W]));
  expect(r.codigo).toBe(1);
  expect(r.erro).toEqual([
    `AVISO: symlink de diretório não seguido: ${diretorio}`,
    `AVISO: symlink quebrado: ${quebrado}`,
  ]);
  expect(r.saida.join("\n")).not.toContain("espelho/");
});

testeSymlink("Dado index.md que é symlink quebrado, Quando audito, Então avisa e trata o índice como ausente", async () => {
  rmSync(join(W, "index.md"));
  symlinkSync(join(raiz, "ausente.md"), join(W, "index.md"));
  const r = await capturar(() => comandoAuditar([W]));
  expect(r.codigo).toBe(1);
  expect(r.erro).toEqual([`AVISO: symlink quebrado: ${join(W, "index.md")}`]);
  expect(r.saida.join("\n")).toContain("— não aparece em");
});

// Linha de comando -------------------------------------------------------

test("Dado wiki com problema, Quando executo auditar, Então imprime o relatório e sai 1", async () => {
  const r = await capturar(() => comandoAuditar([W]));
  expect(r.codigo).toBe(1);
  expect(r.erro).toEqual([]);
  expect(r.saida).toHaveLength(1);
  expect(r.saida[0]).toContain("# Auditoria estrutural de");
  expect(r.saida[0]!.endsWith("<wiki> --consultar`.")).toBe(true);
});

test("Dado wiki limpa, Quando executo auditar, Então sai 0", async () => {
  limpa();
  const r = await capturar(() => comandoAuditar([W]));
  expect(r.codigo).toBe(0);
  expect(r.saida[0]).toContain("Total: 0 achado(s) estrutural(is).");
});

test("Dado wiki inexistente, Quando executo auditar, Então a mensagem vai para stderr e sai 2", async () => {
  const ausente = join(raiz, "nao-existe");
  const r = await capturar(() => comandoAuditar([ausente]));
  expect(r).toEqual({ codigo: 2, saida: [], erro: [`erro: wiki não encontrada: ${ausente}`] });
});

test("Dado nenhum argumento, Quando executo auditar, Então audita ./wiki", async () => {
  const anterior = process.cwd();
  process.chdir(raiz);
  try {
    const r = await capturar(() => comandoAuditar([]));
    expect(r.codigo).toBe(1);
    expect(r.saida[0]).toContain("# Auditoria estrutural de wiki —");
  } finally {
    process.chdir(anterior);
  }
});

test("Dado --help, Quando executo auditar, Então mostra o uso em stderr e sai 2", async () => {
  const r = await capturar(() => comandoAuditar(["--help"]));
  expect(r).toEqual({ codigo: 2, saida: [], erro: ["Uso: anvilore auditar [WIKI]"] });
});

test("Dado opção desconhecida, Quando executo auditar, Então nomeia a opção e sai 2", async () => {
  const r = await capturar(() => comandoAuditar([W, "--x"]));
  expect(r.codigo).toBe(2);
  expect(r.saida).toEqual([]);
  expect(r.erro.join("\n")).toContain("--x");
});

test("Dado dois caminhos de wiki, Quando executo auditar, Então mostra o uso e sai 2", async () => {
  const r = await capturar(() => comandoAuditar([W, W]));
  expect(r).toEqual({ codigo: 2, saida: [], erro: ["Uso: anvilore auditar [WIKI]"] });
});

test("Dado erro de leitura numa página, Quando executo auditar, Então relata e sai 2", async () => {
  gravar("exemplo/concepts/ilegivel.md", "x");
  const leitura = spyOn(await import("node:fs/promises"), "readFile").mockRejectedValue(new Error("EACCES: sem permissão"));
  try {
    const r = await capturar(() => comandoAuditar([W]));
    expect(r.codigo).toBe(2);
    expect(r.erro).toEqual(["EACCES: sem permissão"]);
  } finally {
    leitura.mockRestore();
  }
});

test("Dado o CLI, Quando executo auditar por ele, Então o subcomando está registrado", async () => {
  expect(Object.keys(subcomandos)).toContain("auditar");
  limpa();
  const r = await capturar(() => executar(["auditar", W]));
  expect(r.codigo).toBe(0);
});

test("Dado separador do Windows, Quando exibo um caminho do relatório, Então tudo sai com barra normal", () => {
  expect(exibirCaminho("D:\\a\\wiki", "exemplo\\concepts\\alfa.md", "\\")).toBe("D:/a/wiki/exemplo/concepts/alfa.md");
  expect(exibirCaminho("D:\\a\\wiki\\", "index.md", "\\")).toBe("D:/a/wiki/index.md");
  expect(exibirCaminho(".", "exemplo\\x.md", "\\")).toBe("exemplo/x.md");
});

test("Dado separador POSIX, Quando exibo um caminho, Então a barra invertida de um nome de arquivo continua sendo parte do nome", () => {
  expect(exibirCaminho("/tmp/w", "a/b.md", "/")).toBe("/tmp/w/a/b.md");
  expect(exibirCaminho("/tmp/w", "a\\b.md", "/")).toBe("/tmp/w/a\\b.md");
  expect(exibirCaminho("/tmp/w/", "i.md", "/")).toBe("/tmp/w/i.md");
});
