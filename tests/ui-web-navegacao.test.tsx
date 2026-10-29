import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MENU, hashDaRota, lerRota } from "../ui/web/navegacao";
import { Shell } from "../ui/web/shell";
import { achar, expandir, link, texto } from "./apoio/react-estatico";

test("Dado endereço vazio, só # ou desconhecido Quando leio a rota Então abre o Início", () => {
  for (const hash of ["", "#", "#/", "#/inicio", "#/nao-existe", "#/inicio/x"]) expect(lerRota(hash)).toEqual({ tela: "inicio" });
});

test("Dado endereços de Revisão e Chat Quando leio a rota Então devolve a tela e o id da conversa", () => {
  expect(lerRota("#/revisao")).toEqual({ tela: "revisao" });
  expect(lerRota("#/chat")).toEqual({ tela: "chat" });
  expect(lerRota("#/chat/20261028-140000-abc123")).toEqual({ tela: "chat", id: "20261028-140000-abc123" });
});

test("Dado id de conversa com caractere fora do padrão Quando leio a rota Então ignora o id", () => {
  expect(lerRota("#/chat/../../x")).toEqual({ tela: "chat" });
  expect(lerRota("#/chat/ABC")).toEqual({ tela: "chat" });
});

test("Dado uma rota Quando monto o endereço Então volta ao mesmo que lerRota entende", () => {
  for (const rota of [{ tela: "inicio" as const }, { tela: "chat" as const }, { tela: "chat" as const, id: "a-1" }, { tela: "revisao" as const }]) {
    expect(lerRota(hashDaRota(rota))).toEqual(rota);
  }
});

test("O menu tem Início primeiro e cada item leva ao endereço da própria tela", () => {
  expect(MENU[0]).toMatchObject({ tela: "inicio", rotulo: "Início" });
  expect(MENU.map(item => item.rotulo)).toEqual(["Início", "＋ Nova ingestão", "Revisão"]);
  for (const item of MENU) expect(lerRota(item.hash).tela).toBe(item.tela);
});

const conversas = [
  { id: "c-1", nome: "um.md", fonte: "raw/pessoal/um.md", passo: "leitura" as const, situacao: "rodando" as const, criadaEm: "2026-10-29T10:00:00Z" },
];

test("Dado a tela Início ativa Quando o shell monta Então só o item do Início fica ativo e o conteúdo aparece", () => {
  const arvore = expandir(<Shell rota={{ tela: "inicio" }} conversas={conversas} agente="Claude Code"><p>conteúdo da tela</p></Shell>);
  const ativos = achar(arvore, e => e.type === "a" && String(e.props.className ?? "").includes("active")).map(texto);
  expect(ativos).toEqual(["Início"]);
  expect(texto(arvore)).toContain("conteúdo da tela");
  expect(link(arvore, "Revisão")!.props.href).toBe("#/revisao");
});

test("Dado uma conversa aberta Quando o shell monta Então a conversa fica ativa e Nova ingestão não", () => {
  const arvore = expandir(<Shell rota={{ tela: "chat", id: "c-1" }} conversas={conversas} agente="Claude Code"><span /></Shell>);
  const ativos = achar(arvore, e => e.type === "a" && String(e.props.className ?? "").includes("active")).map(texto);
  expect(ativos).toEqual(["Ingerir: um.md"]);
});

test("Dado aviso do atualizador Quando o shell monta Então o aviso vem acima da tela, e sem conversas não há lista", () => {
  const html = renderToStaticMarkup(<Shell rota={{ tela: "revisao" }} conversas={[]} agente="Claude Code" aviso={<div id="aviso">Atualizado</div>}><main>tela</main></Shell>);
  expect(html.indexOf("Atualizado")).toBeLessThan(html.indexOf("tela</main>"));
  expect(html).not.toContain("CONVERSAS");
  expect(html).toContain('aria-label="Telas"');
});
