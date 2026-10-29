import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ResumoDoInicio, SaudeDaWiki } from "../src/lib/ui-inicio";
import { api } from "../ui/web/api";
import { Inicio, lerDaApi, PainelDoInicio, saudacao, situacaoDaSaude, type DadosDoInicio } from "../ui/web/inicio";
import { achar, botao, expandir, link, texto } from "./apoio/react-estatico";

const vazio: ResumoDoInicio = { rascunhos: { total: 0, novas: 0, atualizadas: 0, comErro: 0, itens: [] }, atividade: [], fontes: [] };
const dados = (extra: Partial<DadosDoInicio> = {}): DadosDoInicio => ({ agente: "Claude Code", areas: ["pessoal"], conversas: [], ...vazio, ...extra });
const saudeOk: SaudeDaWiki = { validar: { ok: true, semAprovacao: 0, outrosErros: [], avisos: [], paginas: 4 }, vencidas: 0, lacunas: { total: 0, contradicoes: 0, abertas: [] }, auditoria: { total: 0, resumo: [] } };

function montar(d: DadosDoInicio | null, saude: SaudeDaWiki | null = null, extra: { saudeCarregando?: boolean; erro?: string } = {}) {
  const chamadas: string[] = [];
  const props = { dados: d, saude, saudeCarregando: extra.saudeCarregando ?? false, erro: extra.erro ?? "", aoValidar: () => chamadas.push("validar"), hora: 15 };
  return { html: renderToStaticMarkup(<PainelDoInicio {...props} />), arvore: expandir(<PainelDoInicio {...props} />), chamadas };
}

test("A saudação muda com a hora", () => {
  expect([saudacao(5), saudacao(11), saudacao(12), saudacao(17), saudacao(18), saudacao(23), saudacao(2)]).toEqual(["Bom dia", "Bom dia", "Boa tarde", "Boa tarde", "Boa noite", "Boa noite", "Boa noite"]);
});

test("Dado a saúde Quando classifico Então separa tudo certo, só o portão e problema", () => {
  expect(situacaoDaSaude(saudeOk)).toBe("ok");
  expect(situacaoDaSaude({ ...saudeOk, validar: { ...saudeOk.validar, ok: false, semAprovacao: 3 } })).toBe("portao");
  expect(situacaoDaSaude({ ...saudeOk, validar: { ...saudeOk.validar, ok: false, semAprovacao: 3, outrosErros: ["x"] } })).toBe("problema");
  expect(situacaoDaSaude({ ...saudeOk, auditoria: { total: 0, resumo: [], erro: "wiki não encontrada" } })).toBe("problema");
  expect(situacaoDaSaude({ ...saudeOk, auditoria: { total: 2, resumo: ["- a"] } })).toBe("atencao");
});

test("Dado dados ainda não chegados Quando a tela monta Então mostra que está lendo a wiki", () => {
  expect(montar(null).html).toContain("Lendo a wiki");
});

test("Dado erro da API Quando a tela monta Então o erro aparece como alerta", () => {
  const { arvore } = montar(null, null, { erro: "Falha ao falar com o Anvilore." });
  expect(texto(achar(arvore, e => e.props.role === "alert"))).toContain("Falha ao falar com o Anvilore.");
});

test("O composer leva ao Chat de ingestão e à Revisão sem pedir comando", () => {
  const { arvore, html } = montar(dados({ rascunhos: { total: 7, novas: 5, atualizadas: 2, comErro: 0, itens: [] } }));
  expect(link(arvore, "Ingerir uma fonte")!.props.href).toBe("#/chat");
  expect(link(arvore, "Revisar")!.props.href).toBe("#/revisao");
  expect(html).toContain("7 páginas esperam a sua aprovação");
  expect(html).not.toContain("bun src/cli.ts");
});

test("Dado nenhum rascunho Quando a tela monta Então diz que nada espera e não oferece Abrir revisão", () => {
  const { html, arvore } = montar(dados());
  expect(html).toContain("Nada esperando a sua aprovação");
  expect(link(arvore, "Abrir revisão")).toBeUndefined();
});

test("Dado um rascunho Quando a tela monta Então a página aparece com tipo e estado e o singular certo", () => {
  const d = dados({ rascunhos: { total: 1, novas: 1, atualizadas: 0, comErro: 0, itens: [{ caminho: "pessoal/concepts/rag.md", titulo: "RAG", tipo: "concept", status: "nova" }] } });
  const { html, arvore } = montar(d);
  expect(html).toContain("1 página espera a sua aprovação");
  expect(texto(arvore)).toContain("RAG");
  expect(link(arvore, "RAG")!.props.href).toBe("#/revisao");
  expect(texto(achar(arvore, e => e.props.className === "item-meta"))).toContain("concept · nova");
});

test("Dado rascunhos além da lista Quando a tela monta Então a revisão mostra quantos faltam", () => {
  const itens = Array.from({ length: 5 }, (_, n) => ({ caminho: `p/${n}.md`, titulo: `P${n}`, tipo: "concept", status: "nova" as const }));
  expect(montar(dados({ rascunhos: { total: 8, novas: 8, atualizadas: 0, comErro: 0, itens } })).html).toContain("e mais 3 na Revisão");
});

test("Dado conversa em andamento Quando a tela monta Então oferece continuar a ingestão", () => {
  const d = dados({ conversas: [{ id: "c-1", nome: "llm.md", fonte: "raw/pessoal/llm.md", passo: "parada", situacao: "esperando", criadaEm: "2026-10-29T10:00:00Z" }] });
  const { arvore } = montar(d);
  expect(link(arvore, "Continuar")!.props.href).toBe("#/chat/c-1");
  expect(texto(arvore)).toContain("Ingerir: llm.md");
});

test("Dado o log Quando a tela monta Então lista data, tipo e resumo da atividade", () => {
  const { html } = montar(dados({ atividade: [{ data: "2026-10-29", tipo: "ingest", resumo: "Chegou uma fonte", arquivo: "log/log-2026-10-29.md" }] }));
  expect(html).toContain("Atividade recente");
  expect(html).toContain("2026-10-29");
  expect(html).toContain("ingest");
  expect(html).toContain("Chegou uma fonte");
});

test("Dado log vazio Quando a tela monta Então diz que não há atividade", () => {
  expect(montar(dados()).html).toContain("Nada registrado ainda");
});

test("Dado saúde ainda rodando Quando a tela monta Então mostra que está conferindo e bloqueia Validar agora", () => {
  const { html, arvore } = montar(dados(), null, { saudeCarregando: true });
  expect(html).toContain("Conferindo a wiki");
  expect(botao(arvore, "Conferindo…")!.props.disabled).toBe(true);
});

test("Dado wiki saudável Quando a tela monta Então mostra Tudo certo com os contadores zerados", () => {
  const { html } = montar(dados(), saudeOk);
  expect(html).toContain("Tudo certo");
  expect(html).toContain("Lacunas abertas");
  expect(html).toContain("Contradições");
  expect(html).toContain("Vencidas");
});

test("Dado só o portão de aprovação Quando a tela monta Então explica que é o portão e não lista erro", () => {
  const { html } = montar(dados(), { ...saudeOk, validar: { ...saudeOk.validar, ok: false, semAprovacao: 7 } });
  expect(html).toContain("Falta aprovar 7 páginas");
  expect(html).toContain("Isso é o portão funcionando");
});

test("Dado erros, achados e lacunas Quando a tela monta Então lista cada um em linguagem simples", () => {
  const saude: SaudeDaWiki = {
    validar: { ok: false, semAprovacao: 0, outrosErros: ["wikilink quebrado: [[x]] em a.md"], avisos: [], paginas: 3 },
    vencidas: 1,
    lacunas: { total: 2, contradicoes: 1, abertas: ["pessoal/a.md:9 [gap] Falta o preço"] },
    auditoria: { total: 1, resumo: ["- wiki/b.md — não aparece em wiki/index.md"] },
  };
  const { html, arvore } = montar(dados(), saude);
  expect(html).toContain("A validação encontrou problemas");
  expect(html).toContain("wikilink quebrado: [[x]] em a.md");
  expect(html).toContain("Falta o preço");
  expect(html).toContain("b.md");
  expect(html).not.toContain("bun src/cli.ts");
  expect(texto(achar(arvore, e => e.props.className === "health-counters"))).toContain("Vencidas1");
});

test("Validar agora chama a ação e Fontes em raw/ sem ingestão mostra nome, área, tamanho e conversa", () => {
  const d = dados({ fontes: [
    { caminho: "raw/pessoal/solta.md", area: "pessoal", bytes: 2048 },
    { caminho: "raw/pessoal/em-curso.md", area: "pessoal", bytes: 10, conversa: "c-9" },
  ] });
  const { arvore, html, chamadas } = montar(d, saudeOk);
  (botao(arvore, "Validar agora")!.props.onClick as () => void)();
  expect(chamadas).toEqual(["validar"]);
  expect(html).toContain("Em raw/, sem ingestão");
  expect(html).toContain("raw/pessoal/solta.md");
  expect(html).toContain("2 KB");
  expect(link(arvore, "Continuar")!.props.href).toBe("#/chat/c-9");
});

test("Dado nenhuma fonte solta Quando a tela monta Então diz que tudo em raw/ já foi ingerido", () => {
  expect(montar(dados()).html).toContain("Tudo em raw/ já foi ingerido");
});

// --- Leitura da API e a tela com hooks ---------------------------------------------------------------------

test("Dado a API respondendo Quando leio uma rota Então devolvo o valor; com falha, a mensagem para a pessoa", async () => {
  expect(await lerDaApi("/api/x", "padrão", async () => 7)).toEqual({ valor: 7 });
  expect(await lerDaApi("/api/x", "padrão", async () => { throw new Error("Falha ao falar com o Anvilore."); })).toEqual({ erro: "Falha ao falar com o Anvilore." });
  expect(await lerDaApi("/api/x", "padrão", async () => { throw "texto"; })).toEqual({ erro: "padrão" });
});

test("A tela Início monta com o cabeçalho e o tema, ainda sem dados", () => {
  const html = renderToStaticMarkup(<Inicio tema="claro" alternarTema={() => {}} />);
  expect(html).toContain("<h1>Início</h1>");
  expect(html).toContain("Lendo a wiki");
  expect(html).toContain("◐");
  expect(renderToStaticMarkup(<Inicio tema="escuro" alternarTema={() => {}} />)).toContain("☼");
});

test("O cliente da API manda o token da página e transforma falha em erro legível", async () => {
  const original = { fetch: globalThis.fetch, document: (globalThis as { document?: unknown }).document };
  const chamadas: string[] = [];
  (globalThis as { document?: unknown }).document = { querySelector: () => ({ content: "tok en" }) };
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    chamadas.push(`${init?.method} ${url}`);
    return url.startsWith("/api/ok") ? new Response(JSON.stringify({ a: 1 })) : new Response(JSON.stringify({ mensagens: ["Não deu."] }), { status: 500 });
  }) as unknown as typeof fetch;
  try {
    expect(await api("/api/ok")).toEqual({ a: 1 });
    expect(await api<{ a: number }>("/api/ok", "POST", { x: 1 })).toEqual({ a: 1 });
    await expect(api("/api/falha")).rejects.toThrow("Não deu.");
    expect(chamadas).toEqual(["GET /api/ok?token=tok%20en", "POST /api/ok?token=tok%20en", "GET /api/falha?token=tok%20en"]);
  } finally {
    globalThis.fetch = original.fetch;
    (globalThis as { document?: unknown }).document = original.document;
  }
});
