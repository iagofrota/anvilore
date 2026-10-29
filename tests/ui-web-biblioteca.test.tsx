import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ResumoDaBiblioteca } from "../src/lib/ui-biblioteca";
import { Biblioteca, carregarBiblioteca, formatarData, iconeDoTipo, lerBibliotecaDaApi, PainelDaBiblioteca } from "../ui/web/biblioteca";
import { achar, expandir, texto } from "./apoio/react-estatico";

const resumoExemplo: ResumoDaBiblioteca = {
  paginas: [
    {
      caminho: "pessoal/conceitos/padrao-llm-wiki.md",
      titulo: "Padrão LLM Wiki",
      slug: "padrao-llm-wiki",
      tipo: "conceito",
      area: "pessoal",
      tags: ["metodo", "llm"],
      status: "rascunho",
      data: "2026-10-26T14:35:00-03:00",
      links: 2,
    },
    {
      caminho: "pessoal/conceitos/rag.md",
      titulo: "RAG",
      slug: "rag",
      tipo: "conceito",
      area: "pessoal",
      tags: ["metodo"],
      status: "aprovada",
      data: "2026-10-28T10:00:00-03:00",
      links: 1,
    },
    {
      caminho: "pessoal/notas/segundo-cerebro.md",
      titulo: "Segundo Cérebro",
      slug: "segundo-cerebro",
      tipo: "nota",
      area: "pessoal",
      tags: ["pkm"],
      status: "aprovada",
      data: "2026-10-27T10:00:00-03:00",
      links: 0,
    },
    {
      caminho: "pessoal/conceitos/quebrada.md",
      titulo: "Quebrada",
      slug: "quebrada",
      tipo: "outro",
      area: "pessoal",
      tags: [],
      status: "erro",
      data: "invalida",
      links: 0,
    },
  ],
  totais: { total: 4, rascunhos: 1, aprovadas: 2, erros: 1 },
  tipos: [
    { tipo: "todos", rotulo: "Todas", contagem: 4 },
    { tipo: "conceito", rotulo: "Conceito", contagem: 2 },
    { tipo: "nota", rotulo: "Nota", contagem: 1 },
    { tipo: "outro", rotulo: "Outro", contagem: 1 },
  ],
  areas: ["pessoal"],
  tags: ["llm", "metodo", "pkm"],
};

describe("ui-web: PainelDaBiblioteca", () => {
  test("formatarData formata data válida, vazia ou inválida", () => {
    expect(formatarData("")).toBe("—");
    expect(formatarData("2026-10-29T10:00:00Z")).toContain("2026");
    expect(formatarData("data-invalida")).toBe("data-invalida");
  });

  test("iconeDoTipo devolve ícone para conceito, nota e outro", () => {
    expect(renderToStaticMarkup(iconeDoTipo("conceito"))).toContain("<svg");
    expect(renderToStaticMarkup(iconeDoTipo("nota"))).toContain("<svg");
    expect(renderToStaticMarkup(iconeDoTipo("outro"))).toContain("<svg");
  });

  test("lerBibliotecaDaApi lida com sucesso e erro", async () => {
    const apiSucesso = async () => resumoExemplo;
    const resSucesso = await lerBibliotecaDaApi(apiSucesso as never);
    expect(resSucesso.valor).toEqual(resumoExemplo);

    const apiErro = async () => { throw new Error("Falha HTTP"); };
    const resErro = await lerBibliotecaDaApi(apiErro as never);
    expect(resErro.valor).toBeNull();
    expect(resErro.erro).toBe("Falha HTTP");
  });

  test("carregarBiblioteca atualiza estado com sucesso e com erro", async () => {
    let resumoRecebido: ResumoDaBiblioteca | null = null;
    let carregandoRecebido = false;
    let erroRecebido = "";

    await carregarBiblioteca(
      (r) => { resumoRecebido = r; },
      (c) => { carregandoRecebido = c; },
      (e) => { erroRecebido = e; },
      async () => ({ valor: resumoExemplo }),
    );
    expect(resumoRecebido as ResumoDaBiblioteca | null).toEqual(resumoExemplo);
    expect(carregandoRecebido).toBe(false);
    expect(erroRecebido).toBe("");

    await carregarBiblioteca(
      (r) => { resumoRecebido = r; },
      (c) => { carregandoRecebido = c; },
      (e) => { erroRecebido = e; },
      async () => ({ valor: null, erro: "Falha na rede" }),
    );
    expect(erroRecebido).toBe("Falha na rede");
  });

  test("renderiza estado de carregamento, mensagem de erro e lista vazia", () => {
    const carregando = renderToStaticMarkup(
      <PainelDaBiblioteca
        resumo={null}
        carregando={true}
        erro=""
        filtroTexto=""
        aoMudarFiltroTexto={() => {}}
        tipoSelecionado="todos"
        aoSelecionarTipo={() => {}}
        statusSelecionado="todos"
        aoSelecionarStatus={() => {}}
        areaSelecionada="todas"
        aoSelecionarArea={() => {}}
        tagSelecionada="todas"
        aoSelecionarTag={() => {}}
      />,
    );
    expect(carregando).toContain("Lendo a biblioteca…");

    const comErro = renderToStaticMarkup(
      <PainelDaBiblioteca
        resumo={null}
        carregando={false}
        erro="Falha ao obter dados da biblioteca."
        filtroTexto=""
        aoMudarFiltroTexto={() => {}}
        tipoSelecionado="todos"
        aoSelecionarTipo={() => {}}
        statusSelecionado="todos"
        aoSelecionarStatus={() => {}}
        areaSelecionada="todas"
        aoSelecionarArea={() => {}}
        tagSelecionada="todas"
        aoSelecionarTag={() => {}}
      />,
    );
    expect(comErro).toContain("Falha ao obter dados da biblioteca.");

    const vazio = renderToStaticMarkup(
      <PainelDaBiblioteca
        resumo={{ paginas: [], totais: { total: 0, rascunhos: 0, aprovadas: 0, erros: 0 }, tipos: [], areas: [], tags: [] }}
        carregando={false}
        erro=""
        filtroTexto=""
        aoMudarFiltroTexto={() => {}}
        tipoSelecionado="todos"
        aoSelecionarTipo={() => {}}
        statusSelecionado="todos"
        aoSelecionarStatus={() => {}}
        areaSelecionada="todas"
        aoSelecionarArea={() => {}}
        tagSelecionada="todas"
        aoSelecionarTag={() => {}}
      />,
    );
    expect(vazio).toContain("Nenhuma página encontrada.");
  });

  test("renderiza abas de tipos com contagens e lista de páginas", () => {
    const chamadas: string[] = [];
    const arvore = expandir(
      <PainelDaBiblioteca
        resumo={resumoExemplo}
        carregando={false}
        erro=""
        filtroTexto=""
        aoMudarFiltroTexto={(v) => chamadas.push(`texto:${v}`)}
        tipoSelecionado="todos"
        aoSelecionarTipo={(t) => chamadas.push(`tipo:${t}`)}
        statusSelecionado="todos"
        aoSelecionarStatus={(s) => chamadas.push(`status:${s}`)}
        areaSelecionada="todas"
        aoSelecionarArea={(a) => chamadas.push(`area:${a}`)}
        tagSelecionada="todas"
        aoSelecionarTag={(tg) => chamadas.push(`tag:${tg}`)}
      />,
    );

    const txt = texto(arvore);
    expect(txt).toContain("Biblioteca");
    expect(txt).toContain("Padrão LLM Wiki");
    expect(txt).toContain("RAG");
    expect(txt).toContain("Segundo Cérebro");
    expect(txt).toContain("Quebrada");
    expect(txt).toContain("Com problema");

    const links = achar(arvore, (e) => e.type === "a" && String(e.props.href ?? "").startsWith("#/nota/"));
    expect(links.length).toBe(4);
    expect(links[0]!.props.href).toBe("#/nota/pessoal/conceitos/padrao-llm-wiki.md");
  });

  test("filtra páginas por tipo, status, área e tag", () => {
    // Por tipo
    const porTipo = expandir(
      <PainelDaBiblioteca
        resumo={resumoExemplo}
        carregando={false}
        erro=""
        filtroTexto=""
        aoMudarFiltroTexto={() => {}}
        tipoSelecionado="nota"
        aoSelecionarTipo={() => {}}
        statusSelecionado="todos"
        aoSelecionarStatus={() => {}}
        areaSelecionada="todas"
        aoSelecionarArea={() => {}}
        tagSelecionada="todas"
        aoSelecionarTag={() => {}}
      />,
    );
    expect(texto(porTipo)).toContain("Segundo Cérebro");
    expect(texto(porTipo)).not.toContain("Padrão LLM Wiki");

    // Por status aprovada
    const porStatus = expandir(
      <PainelDaBiblioteca
        resumo={resumoExemplo}
        carregando={false}
        erro=""
        filtroTexto=""
        aoMudarFiltroTexto={() => {}}
        tipoSelecionado="todos"
        aoSelecionarTipo={() => {}}
        statusSelecionado="aprovada"
        aoSelecionarStatus={() => {}}
        areaSelecionada="todas"
        aoSelecionarArea={() => {}}
        tagSelecionada="todas"
        aoSelecionarTag={() => {}}
      />,
    );
    expect(texto(porStatus)).toContain("RAG");
    expect(texto(porStatus)).not.toContain("Padrão LLM Wiki");

    // Por área inexistente
    const porArea = expandir(
      <PainelDaBiblioteca
        resumo={resumoExemplo}
        carregando={false}
        erro=""
        filtroTexto=""
        aoMudarFiltroTexto={() => {}}
        tipoSelecionado="todos"
        aoSelecionarTipo={() => {}}
        statusSelecionado="todos"
        aoSelecionarStatus={() => {}}
        areaSelecionada="outra"
        aoSelecionarArea={() => {}}
        tagSelecionada="todas"
        aoSelecionarTag={() => {}}
      />,
    );
    expect(texto(porArea)).toContain("Nenhuma página encontrada.");

    // Por tag
    const porTag = expandir(
      <PainelDaBiblioteca
        resumo={resumoExemplo}
        carregando={false}
        erro=""
        filtroTexto=""
        aoMudarFiltroTexto={() => {}}
        tipoSelecionado="todos"
        aoSelecionarTipo={() => {}}
        statusSelecionado="todos"
        aoSelecionarStatus={() => {}}
        areaSelecionada="todas"
        aoSelecionarArea={() => {}}
        tagSelecionada="llm"
        aoSelecionarTag={() => {}}
      />,
    );
    expect(texto(porTag)).toContain("Padrão LLM Wiki");
    expect(texto(porTag)).not.toContain("Segundo Cérebro");

    // Por texto batendo no slug
    const porSlug = expandir(
      <PainelDaBiblioteca
        resumo={resumoExemplo}
        carregando={false}
        erro=""
        filtroTexto="segundo-cerebro"
        aoMudarFiltroTexto={() => {}}
        tipoSelecionado="todos"
        aoSelecionarTipo={() => {}}
        statusSelecionado="todos"
        aoSelecionarStatus={() => {}}
        areaSelecionada="todas"
        aoSelecionarArea={() => {}}
        tagSelecionada="todas"
        aoSelecionarTag={() => {}}
      />,
    );
    expect(texto(porSlug)).toContain("Segundo Cérebro");
    expect(texto(porSlug)).not.toContain("RAG");

    // Por texto batendo na tag
    const porTextoTag = expandir(
      <PainelDaBiblioteca
        resumo={resumoExemplo}
        carregando={false}
        erro=""
        filtroTexto="pkm"
        aoMudarFiltroTexto={() => {}}
        tipoSelecionado="todos"
        aoSelecionarTipo={() => {}}
        statusSelecionado="todos"
        aoSelecionarStatus={() => {}}
        areaSelecionada="todas"
        aoSelecionarArea={() => {}}
        tagSelecionada="todas"
        aoSelecionarTag={() => {}}
      />,
    );
    expect(texto(porTextoTag)).toContain("Segundo Cérebro");
    expect(texto(porTextoTag)).not.toContain("RAG");

    // Por texto não batendo em nada
    const porTextoNenhum = expandir(
      <PainelDaBiblioteca
        resumo={resumoExemplo}
        carregando={false}
        erro=""
        filtroTexto="termo-inexistente"
        aoMudarFiltroTexto={() => {}}
        tipoSelecionado="todos"
        aoSelecionarTipo={() => {}}
        statusSelecionado="todos"
        aoSelecionarStatus={() => {}}
        areaSelecionada="todas"
        aoSelecionarArea={() => {}}
        tagSelecionada="todas"
        aoSelecionarTag={() => {}}
      />,
    );
    expect(texto(porTextoNenhum)).toContain("Nenhuma página encontrada.");
  });

  test("renderToStaticMarkup de Biblioteca monta sem quebrar", () => {
    const html = renderToStaticMarkup(<Biblioteca tema="claro" alternarTema={() => {}} />);
    expect(html).toContain("Biblioteca");
  });

  test("aciona callbacks de abas e campos de busca e seleção", () => {
    const chamadas: string[] = [];
    const arvore = expandir(
      <PainelDaBiblioteca
        resumo={resumoExemplo}
        carregando={false}
        erro=""
        filtroTexto=""
        aoMudarFiltroTexto={(v) => chamadas.push(`texto:${v}`)}
        tipoSelecionado="todos"
        aoSelecionarTipo={(t) => chamadas.push(`tipo:${t}`)}
        statusSelecionado="todos"
        aoSelecionarStatus={(s) => chamadas.push(`status:${s}`)}
        areaSelecionada="todas"
        aoSelecionarArea={(a) => chamadas.push(`area:${a}`)}
        tagSelecionada="todas"
        aoSelecionarTag={(tg) => chamadas.push(`tag:${tg}`)}
      />,
    );

    const btns = achar(arvore, (e) => e.type === "button" && e.props.role === "tab");
    (btns[1]?.props.onClick as (() => void) | undefined)?.();
    expect(chamadas).toContain("tipo:conceito");

    const input = achar(arvore, (e) => e.type === "input" && e.props.id === "lib-filter");
    (input[0]?.props.onChange as ((e: unknown) => void) | undefined)?.({ target: { value: "busca" } });
    expect(chamadas).toContain("texto:busca");

    const selects = achar(arvore, (e) => e.type === "select");
    (selects[0]?.props.onChange as ((e: unknown) => void) | undefined)?.({ target: { value: "rascunho" } });
    expect(chamadas).toContain("status:rascunho");
    (selects[1]?.props.onChange as ((e: unknown) => void) | undefined)?.({ target: { value: "pessoal" } });
    expect(chamadas).toContain("area:pessoal");
    (selects[2]?.props.onChange as ((e: unknown) => void) | undefined)?.({ target: { value: "llm" } });
    expect(chamadas).toContain("tag:llm");
  });
});


