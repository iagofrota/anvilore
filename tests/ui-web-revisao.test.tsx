import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CaixaDeAjuste, type PropriedadesDoAjuste } from "../ui/web/caixa-ajuste";
import { achar, botao, expandir, texto } from "./apoio/react-estatico";

function montar(extra: Partial<PropriedadesDoAjuste> = {}) {
  const chamadas: string[] = [];
  const props: PropriedadesDoAjuste = {
    aberto: true,
    texto: "",
    enviando: false,
    aoMudarTexto: t => chamadas.push(`mudar:${t}`),
    aoCancelar: () => chamadas.push("cancelar"),
    aoEnviar: () => chamadas.push("enviar"),
    nomeDoAgente: "Claude Code",
    ...extra,
  };
  const arvore = expandir(<CaixaDeAjuste {...props} />);
  const html = renderToStaticMarkup(<CaixaDeAjuste {...props} />);
  return { arvore, html, chamadas };
}

test("Dado o campo fechado Quando renderizo Então nada é exibido", () => {
  const { html } = montar({ aberto: false });
  expect(html).toBe("");
});

test("Dado o campo aberto Quando renderizo Então exibe rótulo, textarea e botões", () => {
  const { html, arvore } = montar({ aberto: true });
  expect(html).toContain("O que o agente deve mudar nesta página?");
  expect(html).toContain("Ex.: a frase sobre o Obsidian exagera");
  expect(botao(arvore, "Cancelar")).toBeDefined();
  expect(botao(arvore, "Enviar ao Claude Code")).toBeDefined();
});

test("Dado texto vazio Quando observo o botão Enviar Então ele fica desabilitado", () => {
  const { arvore } = montar({ texto: "   " });
  const btn = botao(arvore, "Enviar ao Claude Code");
  expect(btn?.props.disabled).toBe(true);
});

test("Dado texto preenchido Quando clico em Enviar Então chama a ação aoEnviar", () => {
  const { arvore, chamadas } = montar({ texto: "Corrigir segundo parágrafo." });
  const btn = botao(arvore, "Enviar ao Claude Code");
  expect(btn?.props.disabled).toBe(false);
  (btn?.props.onClick as () => void)();
  expect(chamadas).toEqual(["enviar"]);
});

test("Dado o clique em Cancelar Então chama a ação aoCancelar", () => {
  const { arvore, chamadas } = montar();
  const btn = botao(arvore, "Cancelar");
  (btn?.props.onClick as () => void)();
  expect(chamadas).toEqual(["cancelar"]);
});

test("Dado digitação no textarea Então chama aoMudarTexto com o novo valor", () => {
  const { arvore, chamadas } = montar();
  const textarea = achar(arvore, e => e.type === "textarea")[0];
  (textarea?.props.onChange as (e: unknown) => void)({ target: { value: "Novo texto de ajuste" } });
  expect(chamadas).toEqual(["mudar:Novo texto de ajuste"]);
});

test("Dado envio em andamento Quando renderizo Então exibe Enviando... e campos desabilitados", () => {
  const { html, arvore } = montar({ texto: "Texto", enviando: true });
  expect(html).toContain("Enviando…");
  const textarea = achar(arvore, e => e.type === "textarea")[0];
  expect(textarea?.props.disabled).toBe(true);
  const btnCancelar = botao(arvore, "Cancelar");
  expect(btnCancelar?.props.disabled).toBe(true);
  const btnEnviar = botao(arvore, "Enviando…");
  expect(btnEnviar?.props.disabled).toBe(true);
});
