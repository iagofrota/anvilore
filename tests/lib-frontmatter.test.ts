import { expect, test } from "bun:test";
import { join } from "node:path";
import { FrontmatterInvalido, extrairCampo, lerFrontmatter, slugDe, temFrontmatter } from "../src/lib/frontmatter";

// Mesmo conteúdo do fixture de tests/test-lib-anvilore.sh.
const pagina = `---
title: "Uma página"
slug: uma-pagina
type: concept
related_sources: [fonte-a, fonte-b]
---

Corpo.
`;
const solta = "Sem frontmatter.\n";
const paginaCrlf = pagina.replaceAll("\n", "\r\n");

// Porte de tests/test-lib-anvilore.sh: extrair_campo, slug_de e tem_frontmatter.

test("Dado uma página com frontmatter, Quando extraio title, Então vem o valor com as aspas", () => {
  expect(extrairCampo(pagina, "title")).toBe('"Uma página"');
});

test("Dado uma página com frontmatter, Quando extraio type, Então vem concept", () => {
  expect(extrairCampo(pagina, "type")).toBe("concept");
});

test("Dado uma página com frontmatter, Quando extraio um campo ausente, Então vem vazio", () => {
  expect(extrairCampo(pagina, "ausente")).toBe("");
});

test("Dado o caminho de uma página, Quando calculo o slug, Então vem o nome sem .md", () => {
  expect(slugDe("/tmp/xyz/pagina.md")).toBe("pagina");
});

test("Dado uma página com frontmatter, Quando pergunto se tem frontmatter, Então tem", () => {
  expect(temFrontmatter(pagina)).toBe(true);
});

test("Dado um arquivo sem frontmatter, Quando pergunto se tem frontmatter, Então não tem", () => {
  expect(temFrontmatter(solta)).toBe(false);
});

// Casos de borda do mesmo contrato.

test("Dado um arquivo sem frontmatter, Quando extraio um campo, Então vem vazio", () => {
  expect(extrairCampo("type: concept\n", "type")).toBe("");
  expect(extrairCampo(solta, "type")).toBe("");
});

test("Dado um arquivo vazio, Quando pergunto por frontmatter e campo, Então não tem e vem vazio", () => {
  expect(temFrontmatter("")).toBe(false);
  expect(extrairCampo("", "type")).toBe("");
});

test("Dado um campo que só aparece depois do segundo ---, Quando extraio, Então vem vazio", () => {
  expect(extrairCampo("---\ntitle: a\n---\ntype: concept\n", "type")).toBe("");
});

test("Dado um campo cujo nome é prefixo de outro, Quando extraio, Então não confunde os dois", () => {
  const conteudo = "---\ntitle2: errado\ntitle: certo\n---\n";
  expect(extrairCampo(conteudo, "title")).toBe("certo");
});

test("Dado um valor com dois-pontos e espaço, Quando extraio, Então vem o resto da linha", () => {
  expect(extrairCampo("---\ntitle: a: b\n---\n", "title")).toBe("a: b");
});

test("Dado um campo com valor vazio, Quando extraio, Então vem vazio", () => {
  expect(extrairCampo("---\ntype: \n---\n", "type")).toBe("");
});

test("Dado um campo sem espaço depois dos dois-pontos, Quando extraio, Então não casa", () => {
  expect(extrairCampo("---\ntype:concept\n---\n", "type")).toBe("");
});

test("Dado um campo com caracteres especiais de regex no nome, Quando extraio, Então o nome é literal", () => {
  expect(extrairCampo("---\naxb: errado\na.b: certo\n---\n", "a.b")).toBe("certo");
});

test("Dado um frontmatter sem fechamento, Quando extraio, Então o campo é lido até o fim do arquivo", () => {
  expect(extrairCampo("---\ntype: concept\nCorpo\n", "type")).toBe("concept");
});

test("Dado a primeira linha diferente de ---, Quando pergunto por frontmatter, Então não tem", () => {
  expect(temFrontmatter("\n---\ntype: a\n---\n")).toBe(false);
  expect(temFrontmatter("--- \ntype: a\n---\n")).toBe(false);
  expect(temFrontmatter("----\n")).toBe(false);
});

test("Dado só o delimitador sem quebra de linha, Quando pergunto por frontmatter, Então tem", () => {
  expect(temFrontmatter("---")).toBe(true);
});

// Foco 1: CRLF lido como LF.

test("Dado uma página com CRLF, Quando extraio campos, Então vem o mesmo que com LF e sem CR", () => {
  expect(extrairCampo(paginaCrlf, "title")).toBe(extrairCampo(pagina, "title"));
  expect(extrairCampo(paginaCrlf, "type")).toBe("concept");
  expect(extrairCampo(paginaCrlf, "ausente")).toBe("");
});

test("Dado uma página com CRLF, Quando pergunto por frontmatter, Então tem", () => {
  expect(temFrontmatter(paginaCrlf)).toBe(true);
});

test("Dado uma página com CRLF, Quando leio o frontmatter, Então vem o mesmo objeto que com LF", () => {
  expect(lerFrontmatter(paginaCrlf)).toEqual(lerFrontmatter(pagina));
});

test("Dado uma página com CRLF, Quando extraio campo depois do segundo ---, Então continua vazio", () => {
  expect(extrairCampo("---\r\ntitle: a\r\n---\r\ntype: x\r\n", "type")).toBe("");
});

// slugDe

test("Dado caminhos variados, Quando calculo o slug, Então só o final .md sai", () => {
  expect(slugDe("pagina.md")).toBe("pagina");
  expect(slugDe("wiki/area/pagina.md")).toBe("pagina");
  expect(slugDe(join("wiki", "area", "pagina.md"))).toBe("pagina");
  expect(slugDe("a.md.md")).toBe("a.md");
  expect(slugDe("sem-extensao")).toBe("sem-extensao");
  expect(slugDe("nota.MD")).toBe("nota.MD");
  expect(slugDe("a.txt")).toBe("a.txt");
});

test("Dado um nome com acento, Quando calculo o slug, Então o nome é preservado como veio", () => {
  const decomposto = "cafe\u0301.md";
  expect(slugDe(decomposto)).toBe("cafe\u0301");
});

// lerFrontmatter

test("Dado uma página com frontmatter, Quando leio o frontmatter, Então vem o objeto com os campos", () => {
  expect(lerFrontmatter(pagina)).toEqual({
    title: "Uma página",
    slug: "uma-pagina",
    type: "concept",
    related_sources: ["fonte-a", "fonte-b"],
  });
});

test("Dado um arquivo sem frontmatter, Quando leio o frontmatter, Então vem null", () => {
  expect(lerFrontmatter(solta)).toBeNull();
  expect(lerFrontmatter("")).toBeNull();
});

test("Dado um frontmatter vazio, Quando leio o frontmatter, Então vem objeto vazio", () => {
  expect(lerFrontmatter("---\n---\nCorpo\n")).toEqual({});
});

test("Dado um YAML quebrado, Quando leio o frontmatter, Então lança FrontmatterInvalido com a causa", () => {
  const quebrado = "---\ntitle: [aberto\nslug: : :\n---\nCorpo\n";
  let erro: unknown;
  try {
    lerFrontmatter(quebrado);
  } catch (e) {
    erro = e;
  }
  expect(erro).toBeInstanceOf(FrontmatterInvalido);
  expect(erro).toBeInstanceOf(Error);
  const invalido = erro as FrontmatterInvalido;
  expect(invalido.arquivo).toBeUndefined();
  expect(invalido.cause).toBeInstanceOf(Error);
  expect(invalido.message).toContain((invalido.cause as Error).message);
});

test("Dado um frontmatter sem fechamento, Quando leio o frontmatter, Então lança FrontmatterInvalido", () => {
  expect(() => lerFrontmatter("---\ntype: concept\nCorpo\n")).toThrow(FrontmatterInvalido);
});

test("Dado um frontmatter que não é um mapa, Quando leio o frontmatter, Então lança FrontmatterInvalido", () => {
  expect(() => lerFrontmatter("---\n- a\n- b\n---\n")).toThrow(FrontmatterInvalido);
  expect(() => lerFrontmatter("---\nsoltinho\n---\n")).toThrow(FrontmatterInvalido);
});

test("Dado o nome de um arquivo, Quando construo FrontmatterInvalido, Então o nome fica em .arquivo", () => {
  const erro = new FrontmatterInvalido("quebrou", { arquivo: "wiki/a.md" });
  expect(erro.arquivo).toBe("wiki/a.md");
  expect(erro.name).toBe("FrontmatterInvalido");
  expect(erro.message).toBe("quebrou");
});

test("Dado um campo atribuído depois, Quando consulto .arquivo, Então o chamador pode preencher", () => {
  const erro = new FrontmatterInvalido("quebrou");
  erro.arquivo = "wiki/b.md";
  expect(erro.arquivo).toBe("wiki/b.md");
});

test("Dado um nome com barra invertida, Quando calculo o slug, Então segue o separador da plataforma", () => {
  expect(slugDe("a\\b.md")).toBe(process.platform === "win32" ? "b" : "a\\b");
});

// BOM UTF-8 (readFileSync "utf8" o mantém): divergência intencional do bash.

const comBom = "\uFEFF---\ntype: concept\n---\n";

test("Dado um arquivo com BOM antes do ---, Quando pergunto por frontmatter, Então tem", () => {
  expect(temFrontmatter(comBom)).toBe(true);
});

test("Dado um arquivo com BOM antes do ---, Quando extraio um campo, Então vem o valor", () => {
  expect(extrairCampo(comBom, "type")).toBe("concept");
});

test("Dado um arquivo com BOM antes do ---, Quando leio o frontmatter, Então vem o objeto", () => {
  expect(lerFrontmatter(comBom)).toEqual({ type: "concept" });
});

test("Dado BOM com CRLF, Quando leio o frontmatter, Então vem o objeto", () => {
  expect(lerFrontmatter(comBom.replaceAll("\n", "\r\n"))).toEqual({ type: "concept" });
});

test("Dado um BOM sem frontmatter, Quando pergunto por frontmatter, Então não tem", () => {
  expect(temFrontmatter("\uFEFFSem frontmatter\n")).toBe(false);
  expect(lerFrontmatter("\uFEFFSem frontmatter\n")).toBeNull();
});
