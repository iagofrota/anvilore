import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Conversa } from "../src/lib/ui-ingestao";
import { type AcoesDaConversa, ConversaDaIngestao, PainelDaIngestao } from "../ui/web/conversa";
import { relatorioValido } from "./apoio/ingestao-exemplo";

// Sem navegador e sem dependência nova: a marcação vem do react-dom/server e a interação é provada chamando o
// manipulador do elemento, depois de expandir os componentes (que não têm hooks) em elementos de HTML.
type No = React.ReactNode;

function expandir(no: No): No {
  if (Array.isArray(no)) return no.map(expandir);
  if (!React.isValidElement(no)) return no;
  const elemento = no as React.ReactElement<Record<string, unknown>>;
  if (typeof elemento.type === "function") return expandir((elemento.type as (p: unknown) => No)(elemento.props));
  return React.cloneElement(elemento, undefined, ...([] as No[]).concat(expandir(elemento.props.children as No) as No));
}

function texto(no: No): string {
  if (Array.isArray(no)) return no.map(texto).join("");
  if (typeof no === "string" || typeof no === "number") return String(no);
  if (!React.isValidElement(no)) return "";
  return texto((no.props as { children?: No }).children);
}

function achar(no: No, pred: (e: React.ReactElement<Record<string, unknown>>) => boolean): Array<React.ReactElement<Record<string, unknown>>> {
  if (Array.isArray(no)) return no.flatMap(filho => achar(filho, pred));
  if (!React.isValidElement(no)) return [];
  const elemento = no as React.ReactElement<Record<string, unknown>>;
  return [...(pred(elemento) ? [elemento] : []), ...achar(elemento.props.children as No, pred)];
}

const botao = (arvore: No, rotulo: string) => achar(arvore, e => e.type === "button" && texto(e).includes(rotulo))[0];

function acoesQueAnotam() {
  const chamadas: string[] = [];
  const acoes: AcoesDaConversa = {
    aoLer: () => chamadas.push("ler"),
    aoCancelar: () => chamadas.push("cancelar"),
    aoSeguir: () => chamadas.push("seguir"),
    alternarTakeaway: i => chamadas.push(`takeaway ${i}`),
    alternarPagina: i => chamadas.push(`pagina ${i}`),
    mudarComentario: t => chamadas.push(`comentario ${t}`),
  };
  return { acoes, chamadas };
}

function conversa(extra: Partial<Conversa>): Conversa {
  return {
    versao: 1, id: "20261028-140000-abc123", criadaEm: "2026-10-28T17:00:00.000Z", atualizadaEm: "2026-10-28T17:00:00.000Z",
    area: "pessoal", fonte: "raw/pessoal/llm-wiki.md", nome: "llm-wiki.md", bytes: 12 * 1024,
    passo: "fonte", situacao: "pronta", atividade: [], avisos: [], recusas: [], ...extra,
  } as Conversa;
}

function montar(c: Conversa, extra: { takeaways?: boolean[]; paginas?: boolean[] } = {}) {
  const { acoes, chamadas } = acoesQueAnotam();
  const props = { conversa: c, agente: "Claude Code", ocupado: false, takeaways: extra.takeaways ?? [true, true, true, true], paginas: extra.paginas ?? [true, true, true], comentario: "", acoes };
  return { html: renderToStaticMarkup(<ConversaDaIngestao {...props} />), arvore: expandir(<ConversaDaIngestao {...props} />), chamadas };
}

test("Dado a parada com fonte binária Quando a tela monta Então o AVISO aparece com os takeaways e Pode seguir, desmarcar e comentar chamam as ações", () => {
  const aviso = "AVISO: citações não conferidas automaticamente (fonte binária: pdf); confira os trechos na fonte antes de aprovar.";
  const { html, arvore, chamadas } = montar(conversa({ passo: "parada", situacao: "esperando", relatorio: relatorioValido() as never, avisos: [aviso] }), { takeaways: [true, true, true, false] });
  expect(html).toContain(aviso);
  expect(html).toContain("3 de 4 selecionados");
  expect(html).toContain("Criar · 2");
  expect(html).toContain("Atualizar · 1");
  expect(html).toContain("Não diz como resolver contradições.");
  const caixas = achar(arvore, e => e.type === "input");
  expect(caixas.map(c => [c.props.checked, c.props.disabled])).toEqual([
    [true, false], [true, false], [true, false], [false, false],
    [true, true], [true, false], [true, false],
  ]);
  (caixas[3]!.props.onChange as () => void)();
  (caixas[6]!.props.onChange as () => void)();
  (achar(arvore, e => e.type === "textarea")[0]!.props.onChange as (e: unknown) => void)({ target: { value: "Enfatize o índice." } });
  (botao(arvore, "Pode seguir")!.props.onClick as () => void)();
  expect(chamadas).toEqual(["takeaway 3", "pagina 2", "comentario Enfatize o índice.", "seguir"]);
});

test("Dado o escritor rodando Quando a tela monta Então a lista de escrita mostra verbo, caminho e estado, e Cancelar chama a ação", () => {
  const c = conversa({
    passo: "escrita", situacao: "rodando", relatorio: relatorioValido() as never, agora: "Escrevendo wiki/pessoal/concepts/rag.md",
    escolha: { takeaways: [0, 1, 2], paginas: [0, 1, 2], comentario: "Enfatize o índice." },
    atividade: [
      { id: "x1", papel: "escritor", verbo: "Recusado", alvo: "raw/pessoal/llm-wiki.md", estado: "recusado", motivo: "Bloqueado: raw/ é imutável" },
      { id: "w1", papel: "escritor", verbo: "Criou", alvo: "wiki/pessoal/sources/llm-wiki.md", estado: "ok" },
      { id: "w2", papel: "escritor", verbo: "Escrevendo", alvo: "wiki/pessoal/concepts/rag.md", estado: "andamento" },
    ],
  });
  const { html, arvore, chamadas } = montar(c);
  expect(html).toContain("Pode seguir. Deixe de fora o takeaway 4.");
  expect(html).toContain("Enfatize o índice.");
  expect(html).toContain("Escrevendo · 3");
  const linhas = achar(arvore, e => typeof e.props.className === "string" && e.props.className.startsWith("activity-row")).map(texto);
  expect(linhas).toEqual([
    "Recusadoraw/pessoal/llm-wiki.mdBloqueado: raw/ é imutável",
    "Criouwiki/pessoal/sources/llm-wiki.mdrascunho",
    "Escrevendowiki/pessoal/concepts/rag.mdescrevendo…",
  ]);
  expect(html).toContain("Escrevendo wiki/pessoal/concepts/rag.md");
  (botao(arvore, "Cancelar ingestão")!.props.onClick as () => void)();
  expect(chamadas).toEqual(["cancelar"]);
  expect(botao(arvore, "Pode seguir")).toBeUndefined();
});

test("Dado o fechamento com só rascunhos Quando a tela monta Então mostra a saída real, quantos rascunhos esperam e o atalho para a Revisão", () => {
  const saida = "ERRO: página gerada sem aprovação humana: pessoal/sources/llm-wiki.md\nFECHAMENTO: FAIL no passo validar-wiki";
  const { html, arvore } = montar(conversa({
    passo: "revisao", situacao: "concluida", relatorio: relatorioValido() as never,
    escolha: { takeaways: [0, 1, 2, 3], paginas: [0, 1, 2], comentario: "" },
    atividade: [
      { id: "w1", papel: "escritor", verbo: "Criou", alvo: "wiki/pessoal/sources/llm-wiki.md", estado: "ok" },
      { id: "w2", papel: "escritor", verbo: "Atualizou", alvo: "wiki/pessoal/concepts/segundo-cerebro.md", estado: "ok" },
      { id: "w3", papel: "escritor", verbo: "Atualizou", alvo: "wiki/index.md", estado: "ok" },
    ],
    fechamento: { codigo: 1, saida, rascunhos: 2, soRascunhos: true },
  }));
  expect(html).toContain("CÓDIGO 1");
  expect(html).toContain("ERRO: página gerada sem aprovação humana: pessoal/sources/llm-wiki.md");
  expect(html).toContain("2 rascunhos esperam você");
  expect(html).toContain("1 nova · 1 atualizada (a aprovação antiga deixa de valer)");
  expect(achar(arvore, e => e.type === "a" && texto(e) === "Revisar agora")[0]!.props.href).toBe("#/revisao");
  expect(achar(arvore, e => e.type === "details")[0]!.props.open).toBe(false);
});

test("Dado o fechamento com outro erro Quando a tela monta Então a saída abre, o erro aparece e ainda dá para revisar os rascunhos", () => {
  const { html, arvore } = montar(conversa({
    passo: "revisao", situacao: "erro", erro: "O fechamento encontrou problemas na wiki.", relatorio: relatorioValido() as never,
    escolha: { takeaways: [0], paginas: [0], comentario: "" },
    fechamento: { codigo: 1, saida: "ERRO: página fora do índice: pessoal/sources/llm-wiki.md", rascunhos: 1, soRascunhos: false },
  }));
  expect(achar(arvore, e => e.type === "details")[0]!.props.open).toBe(true);
  expect(html).toContain("O fechamento encontrou problemas. Veja a saída acima.");
  expect(achar(arvore, e => e.type === "a" && texto(e).includes("Revisar os 1 rascunhos"))[0]!.props.href).toBe("#/revisao");
});

test("Dado o leitor recusado pelo portão Quando a tela monta Então o erro e as mensagens aparecem e Ler de novo chama a ação", () => {
  const { html, arvore, chamadas } = montar(conversa({
    passo: "leitura", situacao: "erro", erro: "O relatório do leitor não passou na conferência. Nada foi escrito.",
    mensagens: ["FAIL: $.takeaways: no mínimo 3 itens (veio 0)"],
    atividade: [{ id: "r1", papel: "leitor", verbo: "Leu", alvo: "raw/pessoal/llm-wiki.md", estado: "ok" }],
  }));
  expect(html).toContain("1 leitura");
  expect(html).toContain("nada escrito");
  expect(html).toContain("FAIL: $.takeaways: no mínimo 3 itens (veio 0)");
  (botao(arvore, "Ler de novo")!.props.onClick as () => void)();
  expect(chamadas).toEqual(["ler"]);
});

test("Dado a fonte em raw/ ainda sem leitura Quando a tela monta Então mostra o arquivo salvo e Ingerir chama a leitura", () => {
  const { html, arvore, chamadas } = montar(conversa({}));
  expect(html).toContain("Ingere esta fonte na área pessoal.");
  expect(html).toContain("12 KB");
  expect(html).toContain("raw/pessoal/llm-wiki.md");
  (botao(arvore, "Ingerir")!.props.onClick as () => void)();
  expect(chamadas).toEqual(["ler"]);
});

test("Dado a escrita cancelada Quando a tela monta Então diz que o que já foi escrito ficou como rascunho", () => {
  const { html } = montar(conversa({ passo: "escrita", situacao: "cancelada", atividade: [{ id: "w1", papel: "escritor", verbo: "Escrevendo", alvo: "wiki/pessoal/concepts/rag.md", estado: "interrompido" }] }));
  expect(html).toContain("Ingestão cancelada. O que já foi escrito ficou na wiki como rascunho.");
  expect(html).toContain("interrompido");
});

test("Dado uma ingestão rodando Quando o painel monta Então mostra os 7 passos, o que o agente faz agora e a fonte", () => {
  const html = renderToStaticMarkup(<PainelDaIngestao conversa={conversa({ passo: "leitura", situacao: "rodando", agora: "Lendo raw/pessoal/llm-wiki.md", rota: "grande" })} />);
  expect(html.match(/<li class="(feito|atual|falta|parou)"/g)).toEqual([
    '<li class="feito"', '<li class="atual"', '<li class="falta"', '<li class="falta"', '<li class="falta"', '<li class="falta"', '<li class="falta"',
  ]);
  expect(html).toContain("Lendo raw/pessoal/llm-wiki.md");
  expect(html).toContain("grande (custa mais)");
  expect(renderToStaticMarkup(<PainelDaIngestao conversa={null} />)).not.toContain("Fonte</h2>");
});
