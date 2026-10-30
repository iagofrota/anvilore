import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DetalhesDaNota } from "../src/lib/ui-nota";
import { carregarNota, formatarData, lerNotaDaApi, Nota, PainelDaNota, renderizarCorpoMarkdown, renderizarTextoComWikilinks } from "../ui/web/nota";
import { achar, expandir, texto } from "./apoio/react-estatico";

const notaExemplo: DetalhesDaNota = {
  caminho: "pessoal/conceitos/padrao-llm-wiki.md",
  titulo: "Padrão LLM Wiki",
  slug: "padrao-llm-wiki",
  tipo: "conceito",
  area: "pessoal",
  tags: ["metodo", "llm"],
  status: "rascunho",
  statusMeta: "Rascunho escrito por claude/3.5. Aguarda aprovação humana.",
  aprovavel: true,
  versao: "a".repeat(64),
  corpo: `# Padrão LLM Wiki\n\nEm vez de recuperar trechos, o agente constrói e mantém uma wiki persistente.\nVeja também [[rag|o modelo RAG]] e [[segundo-cerebro]].\n\n> [!gap]\n> A fonte não diz como resolver uma contradição entre fontes.\n\n> [!contradiction]\n> Fontes divergem sobre o autor.\n\n> Esta é uma citação simples.\n\n## Como funciona\n### Detalhes\n- Item 1\n- Item 2\n\nTexto final.`,
  proveniencia: {
    fontePrincipal: "raw/pessoal/artigos/llm-wiki.md",
    fontes: [{ recurso: "raw/pessoal/artigos/llm-wiki.md", titulo: "LLM Wiki" }],
    geradoPor: "claude/3.5",
    geradoEm: "2026-10-26T14:35:00-03:00",
  },
  fontes: [{ recurso: "raw/pessoal/artigos/llm-wiki.md", titulo: "LLM Wiki" }],
  relacionados: ["rag", "segundo-cerebro"],
  lacunas: [
    {
      tipo: "gap",
      linha: 7,
      texto: "A fonte não diz como resolver uma contradição entre fontes.",
    },
  ],
  backlinks: [
    {
      caminho: "pessoal/notas/segundo-cerebro.md",
      slug: "segundo-cerebro",
      titulo: "Segundo Cérebro",
      tipo: "nota",
      contexto: "O [[padrao-llm-wiki]] delega ao agente a parte da síntese.",
    },
  ],
  grafoLocal: {
    nos: [
      { id: "padrao-llm-wiki", rotulo: "Padrão LLM Wiki", tipo: "conceito", atual: true },
      { id: "rag", rotulo: "RAG", tipo: "conceito", atual: false },
      { id: "segundo-cerebro", rotulo: "Segundo Cérebro", tipo: "nota", atual: false },
    ],
    arestas: [
      { de: "padrao-llm-wiki", para: "rag" },
      { de: "padrao-llm-wiki", para: "segundo-cerebro" },
      { de: "segundo-cerebro", para: "padrao-llm-wiki" },
    ],
  },
};

describe("ui-web: PainelDaNota", () => {
  test("formatarData formata datas válidas, vazias e inválidas", () => {
    expect(formatarData("")).toBe("—");
    expect(formatarData("2026-10-29T10:00:00Z")).toContain("2026");
    expect(formatarData("invalida")).toBe("invalida");
  });

  test("renderizarTextoComWikilinks trata texto sem links e com links com e sem rótulo", () => {
    const simples = renderizarTextoComWikilinks("Texto puro sem links");
    expect(simples).toEqual(["Texto puro sem links"]);

    const comLinks = renderToStaticMarkup(<>{renderizarTextoComWikilinks("Veja [[alvo]] e [[alvo2|rótulo]] e mais texto")}</>);
    expect(comLinks).toContain('href="#/nota/alvo.md"');
    expect(comLinks).toContain('href="#/nota/alvo2.md"');
    expect(comLinks).toContain("rótulo");

    const comFormatacao = renderToStaticMarkup(<>{renderizarTextoComWikilinks("Texto com **negrito** e `codigo` e fim")}</>);
    expect(comFormatacao).toContain("<strong>negrito</strong>");
    expect(comFormatacao).toContain("<code>codigo</code>");
  });

  test("renderizarCorpoMarkdown processa títulos, listas, citações e callouts", () => {
    const html = renderToStaticMarkup(<>{renderizarCorpoMarkdown(notaExemplo.corpo)}</>);
    expect(html).toContain("<h1>Padrão LLM Wiki</h1>");
    expect(html).toContain("<h2>Como funciona</h2>");
    expect(html).toContain("<h3>Detalhes</h3>");
    expect(html).toContain("<ul><li>Item 1</li><li>Item 2</li></ul>");
    expect(html).toContain("<blockquote>Esta é uma citação simples.</blockquote>");
    expect(html).toContain("LACUNA");
    expect(html).toContain("CONTRADIÇÃO");
  });

  test("lerNotaDaApi lida com sucesso e erro", async () => {
    const apiSucesso = async () => notaExemplo;
    const resSucesso = await lerNotaDaApi("padrao.md", apiSucesso as never);
    expect(resSucesso.valor).toEqual(notaExemplo);

    const apiErro = async () => { throw new Error("404 não encontrada"); };
    const resErro = await lerNotaDaApi("padrao.md", apiErro as never);
    expect(resErro.valor).toBeNull();
    expect(resErro.erro).toBe("404 não encontrada");
  });

  test("renderiza estado de carregamento e mensagem de erro", () => {
    const carregando = renderToStaticMarkup(
      <PainelDaNota nota={null} carregando={true} erro="" />,
    );
    expect(carregando).toContain("Lendo a nota…");

    const comErro = renderToStaticMarkup(
      <PainelDaNota nota={null} carregando={false} erro="Página não encontrada." />,
    );
    expect(comErro).toContain("Página não encontrada.");
  });

  test("renderiza propriedades do frontmatter e corpo da nota", () => {
    const chamadas: string[] = [];
    const arvore = expandir(
      <PainelDaNota
        nota={notaExemplo}
        carregando={false}
        erro=""
        aoAprovar={async () => { chamadas.push("aprovar"); }}
      />,
    );
    const txt = texto(arvore);

    expect(txt).toContain("Padrão LLM Wiki");
    expect(txt).toContain("pessoal");
    expect(txt).toContain("metodo");
    expect(txt).toContain("llm");
    expect(txt).toContain("Em vez de recuperar trechos");

    // Banner de rascunho com botão Aprovar
    expect(txt).toContain("Rascunho escrito por claude/3.5");
    expect(txt).toContain("Ver na revisão");
    const btns = achar(arvore, (e) => e.type === "button" && texto(e).includes("Aprovar"));
    expect(btns.length).toBe(1);
    (btns[0]?.props.onClick as (() => void) | undefined)?.();
    expect(chamadas).toContain("aprovar");

    const html = renderToStaticMarkup(<PainelDaNota nota={notaExemplo} carregando={false} erro="" tema="claro" alternarTema={() => {}} />);
    expect(html).toContain("Padrão LLM Wiki");
  });

  test("renderiza nota aprovada e nota com erro", () => {
    const notaAprovada: DetalhesDaNota = {
      ...notaExemplo,
      status: "aprovada",
      statusMeta: "Aprovada por human:iago.",
      aprovavel: false,
      proveniencia: {
        ...notaExemplo.proveniencia,
        verificadoPor: "human:iago",
        verificadoEm: "2026-10-27T10:00:00Z",
      },
      backlinks: [],
      grafoLocal: { nos: [{ id: "padrao-llm-wiki", rotulo: "Padrão LLM Wiki", tipo: "conceito", atual: true }], arestas: [] },
    };
    const arvoreAprovada = expandir(<PainelDaNota nota={notaAprovada} carregando={false} erro="" />);
    expect(texto(arvoreAprovada)).toContain("Aprovada por human:iago");
    expect(texto(arvoreAprovada)).toContain("Nenhuma outra página cita esta ainda");

    const notaErro: DetalhesDaNota = {
      ...notaExemplo,
      status: "erro",
      statusMeta: "Frontmatter inválido.",
      aprovavel: false,
    };
    const arvoreErro = expandir(<PainelDaNota nota={notaErro} carregando={false} erro="" />);
    expect(texto(arvoreErro)).toContain("Frontmatter inválido");
  });

  test("renderiza callout de lacuna com link para procurar fonte no chat", () => {
    const arvore = expandir(<PainelDaNota nota={notaExemplo} carregando={false} erro="" />);
    const txt = texto(arvore);

    expect(txt).toContain("LACUNA");
    expect(txt).toContain("A fonte não diz como resolver uma contradição");

    const linksChat = achar(arvore, (e) => e.type === "a" && e.props.href === "#/chat");
    expect(linksChat.length).toBeGreaterThan(0);
  });

  test("Dado caminhos resolvidos no servidor Quando renderizo wikilinks e Relacionados Então uso o caminho único e não navego por slug ambíguo", () => {
    const nota = {
      ...notaExemplo,
      corpo: "[[Destino|Página certa]] e [[duplicado]].",
      relacionados: ["Destino", "duplicado"],
      destinosWikilinks: { Destino: "trabalho/concepts/destino.md", duplicado: null },
    } as DetalhesDaNota;
    const arvore = expandir(<PainelDaNota nota={nota} carregando={false} erro="" />);
    const links = achar(arvore, e => e.type === "a");
    expect(links.some(e => e.props.href === "#/nota/trabalho/concepts/destino.md" && texto(e).includes("Página certa"))).toBe(true);
    expect(links.some(e => e.props.href === "#/nota/trabalho/concepts/destino.md" && texto(e).includes("Destino"))).toBe(true);
    expect(links.some(e => e.props.href === "#/nota/duplicado.md")).toBe(false);
    expect(texto(arvore)).toContain("duplicado");
  });

  test("renderiza seção de proveniência com fonte bruta", () => {
    const arvore = expandir(<PainelDaNota nota={notaExemplo} carregando={false} erro="" />);
    const txt = texto(arvore);

    expect(txt).toContain("Proveniência");
    expect(txt).toContain("raw/pessoal/artigos/llm-wiki.md");
    expect(txt).toContain("claude/3.5");
  });

  test("renderiza backlinks e grafo local com nós vizinhos", () => {
    const arvore = expandir(<PainelDaNota nota={notaExemplo} carregando={false} erro="" />);
    const txt = texto(arvore);

    expect(txt).toContain("Backlinks");
    expect(txt).toContain("Segundo Cérebro");
    expect(txt).toContain("delega ao agente a parte da síntese");

    // Grafo local SVG
    const grafos = achar(arvore, (e) => e.type === "svg" && String(e.props["aria-label"] ?? "").includes("Grafo local"));
    expect(grafos.length).toBe(1);
    expect(txt).toContain("Grafo local");
  });

  test("carregarNota lida com caminho indefinido, sucesso e erro", async () => {
    let notaRecebida: DetalhesDaNota | null = null;
    let carregandoRecebido = false;
    let erroRecebido = "";

    // Sem caminho
    await carregarNota(
      undefined,
      (n) => { notaRecebida = n; },
      (c) => { carregandoRecebido = c; },
      (e) => { erroRecebido = e; },
    );
    expect(erroRecebido).toBe("Caminho da nota não informado.");

    // Com sucesso
    await carregarNota(
      "pessoal/padrao.md",
      (n) => { notaRecebida = n; },
      (c) => { carregandoRecebido = c; },
      (e) => { erroRecebido = e; },
      async () => ({ valor: notaExemplo }),
    );
    expect(notaRecebida as DetalhesDaNota | null).toEqual(notaExemplo);

    // Com erro
    await carregarNota(
      "pessoal/padrao.md",
      (n) => { notaRecebida = n; },
      (c) => { carregandoRecebido = c; },
      (e) => { erroRecebido = e; },
      async () => ({ valor: null, erro: "Página inexistente" }),
    );
    expect(erroRecebido).toBe("Página inexistente");
  });

  test("renderToStaticMarkup de Nota monta sem quebrar com e sem caminho", () => {
    const html = renderToStaticMarkup(<Nota tema="claro" alternarTema={() => {}} caminho="pessoal/conceitos/padrao.md" />);
    expect(html).toContain("Nota");
    const htmlSemCaminho = renderToStaticMarkup(<Nota tema="claro" alternarTema={() => {}} />);
    expect(htmlSemCaminho).toContain("Nota");
  });
});


