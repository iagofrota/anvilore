import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { normalizarFimDeLinha } from "../lib/caminhos";
import { FrontmatterInvalido, lerFrontmatter } from "../lib/frontmatter";

export type ResultadoRelease = { ok: boolean; problemas: string[] };

const ITEM_DE_LISTA = /^\s*[-*+]\s+\S/;
const TITULO_DE_VERSAO = /^##\s+\[([^\]]*)\]/;
const SUBSECAO = /^#{3,}\s+(.*)$/;

function semBom(texto: string): string {
  return texto.startsWith("﻿") ? texto.slice(1) : texto;
}

// Só conta como entregue um item de lista fora de "Não resolvido": a lista do que
// falta não prova que algo saiu.
function temItemEntregue(linhasDaSecao: string[]): boolean {
  let emNaoResolvido = false;
  for (const linha of linhasDaSecao) {
    const subsecao = SUBSECAO.exec(linha);
    if (subsecao !== null) {
      emNaoResolvido = subsecao[1]!.trim().toLowerCase().startsWith("não resolvido");
      continue;
    }
    if (!emNaoResolvido && ITEM_DE_LISTA.test(linha)) return true;
  }
  return false;
}

function checarChangelog(raiz: string, versao: string): string[] {
  const caminho = join(raiz, "CHANGELOG.md");
  if (!existsSync(caminho)) return ["CHANGELOG.md não existe na raiz do projeto"];

  const linhas = normalizarFimDeLinha(semBom(readFileSync(caminho, "utf8"))).split("\n");
  const inicio = linhas.findIndex((linha) => TITULO_DE_VERSAO.exec(linha)?.[1] === versao);
  if (inicio === -1) return [`CHANGELOG.md não tem a seção da versão ${versao}`];

  const seguinte = linhas.findIndex((linha, i) => i > inicio && linha.startsWith("## "));
  const secao = linhas.slice(inicio + 1, seguinte === -1 ? undefined : seguinte);
  if (!temItemEntregue(secao)) {
    return [`A seção da versão ${versao} no CHANGELOG.md está vazia: nenhum item entregue`];
  }
  return [];
}

function preenchido(valor: unknown): boolean {
  if (valor === null || valor === undefined || valor === false) return false;
  return String(valor).trim() !== "";
}

function paginasDaKb(pasta: string): string[] {
  return (readdirSync(pasta, { recursive: true, encoding: "utf8" }) as string[])
    .map((relativo) => relativo.replaceAll("\\", "/"))
    .filter((relativo) => relativo.endsWith(".md"))
    .sort();
}

function checarKnowledgeBase(raiz: string): string[] {
  const pasta = join(raiz, "docs", "knowledge_base");
  if (!existsSync(pasta)) return [];

  const problemas: string[] = [];
  for (const pagina of paginasDaKb(pasta)) {
    const nome = `docs/knowledge_base/${pagina}`;
    try {
      const campos = lerFrontmatter(readFileSync(join(pasta, pagina), "utf8"));
      if (campos !== null && preenchido(campos.generated) && !preenchido(campos.verified)) {
        problemas.push(`${nome} foi gerada por agente e nenhuma pessoa a revisou (falta verified)`);
      }
    } catch (erro) {
      if (!(erro instanceof FrontmatterInvalido)) throw erro;
      problemas.push(`${nome} tem frontmatter inválido: ${erro.message}`);
    }
  }
  return problemas;
}

export function checarRelease(raiz: string, versao: string): ResultadoRelease {
  const problemas = [...checarChangelog(raiz, versao), ...checarKnowledgeBase(raiz)];
  return { ok: problemas.length === 0, problemas };
}

export async function comandoChecarRelease(args: string[], raiz: string = process.cwd()): Promise<number> {
  const versao = args[0];
  if (versao === undefined || versao === "") {
    console.error("Uso: anvilore checar-release <versao>");
    return 2;
  }
  const { ok, problemas } = checarRelease(raiz, versao);
  if (!ok) {
    for (const problema of problemas) console.error(problema);
    return 1;
  }
  console.log(`Release ${versao} pronta: CHANGELOG preenchido e knowledge base revisada`);
  return 0;
}
