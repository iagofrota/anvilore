import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FrontmatterInvalido, lerFrontmatter, linhasDe } from "../lib/frontmatter";
import { PASTA_DA_KB, listarPaginasDaKb } from "../lib/knowledge-base";
import { linhasVisiveis } from "../lib/markdown";

export type ResultadoRelease = { ok: boolean; problemas: string[] };

const ITEM_DE_LISTA = /^\s*[-*+]\s+(\S.*)$/;
const TITULO_DE_VERSAO = /^##\s+\[([^\]]*)\]/;
// Só `###` exato alterna a subseção; `####` e mais fundo herdam a de cima.
const SUBSECAO = /^###\s+(.*)$/;
const NAO_RESOLVIDO = /^n[aã]o resolvido/i;
// Gramática da SemVer 2.0.0: núcleo e identificador numérico de pré-release sem zero à esquerda,
// identificador nunca vazio, metadados de build (`+...`) aceitos.
const NUMERICO = "(?:0|[1-9]\\d*)";
const IDENTIFICADOR_DE_PRE = `(?:${NUMERICO}|\\d*[A-Za-z-][0-9A-Za-z-]*)`;
const IDENTIFICADOR_DE_BUILD = "[0-9A-Za-z-]+";
const SEMVER = new RegExp(
  `^${NUMERICO}\\.${NUMERICO}\\.${NUMERICO}` +
    `(?:-${IDENTIFICADOR_DE_PRE}(?:\\.${IDENTIFICADOR_DE_PRE})*)?` +
    `(?:\\+${IDENTIFICADOR_DE_BUILD}(?:\\.${IDENTIFICADOR_DE_BUILD})*)?$`,
);
const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
// Texto de item que é só marcador: não diz que algo foi entregue.
const SEM_CONTEUDO = new Set(["nada", "nada ainda", "todo", "tbd", "n/a"]);

function anoBissexto(ano: number): boolean {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

// Data de calendário real, conferida na mão: `new Date` rolaria 2026-02-30 para março.
function ehDataReal(texto: string): boolean {
  const partes = DATA.exec(texto);
  if (partes === null) return false;
  const ano = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);
  if (mes < 1 || mes > 12 || dia < 1) return false;
  const diasDoMes = [31, anoBissexto(ano) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return dia <= diasDoMes[mes - 1]!;
}

function itemTemConteudo(texto: string): boolean {
  const normalizado = texto.trim().toLowerCase().replace(/\.$/, "").trim();
  return !SEM_CONTEUDO.has(normalizado) && !/^[\p{P}\p{S}\s]*$/u.test(normalizado);
}

// Só conta como entregue um item de lista com conteúdo fora de "Não resolvido": a
// lista do que falta não prova que algo saiu.
function temItemEntregue(linhasDaSecao: string[]): boolean {
  let emNaoResolvido = false;
  for (const linha of linhasDaSecao) {
    const subsecao = SUBSECAO.exec(linha);
    if (subsecao !== null) {
      emNaoResolvido = NAO_RESOLVIDO.test(subsecao[1]!.trim());
      continue;
    }
    const item = ITEM_DE_LISTA.exec(linha);
    if (!emNaoResolvido && item !== null && itemTemConteudo(item[1]!)) return true;
  }
  return false;
}

function checarChangelog(raiz: string, versao: string): string[] {
  const caminho = join(raiz, "CHANGELOG.md");
  if (!existsSync(caminho)) return ["CHANGELOG.md não existe na raiz do projeto"];

  const linhas = linhasVisiveis(linhasDe(readFileSync(caminho, "utf8")));
  const inicio = linhas.findIndex((linha) => TITULO_DE_VERSAO.exec(linha)?.[1] === versao);
  if (inicio === -1) return [`CHANGELOG.md não tem a seção da versão ${versao}`];

  const seguinte = linhas.findIndex((linha, i) => i > inicio && linha.startsWith("## "));
  const secao = linhas.slice(inicio + 1, seguinte === -1 ? undefined : seguinte);
  if (!temItemEntregue(secao)) {
    return [`A seção da versão ${versao} no CHANGELOG.md está vazia: nenhum item entregue`];
  }
  return [];
}

// Toda página exige `verified: AAAA-MM-DD`: a data em que uma pessoa a revisou.
// `generated` é só informativo.
function checarKnowledgeBase(raiz: string): string[] {
  const lista = listarPaginasDaKb(raiz);
  const pasta = join(raiz, ...PASTA_DA_KB.split("/"));
  const problemas = [...lista.problemas];
  for (const pagina of lista.paginas) {
    const nome = `${PASTA_DA_KB}/${pagina}`;
    try {
      const campos = lerFrontmatter(readFileSync(join(pasta, pagina), "utf8"));
      const verified = campos?.verified;
      if (verified === undefined || verified === null || !ehDataReal(String(verified).trim())) {
        problemas.push(`${nome} falta revisão humana com data (verified: AAAA-MM-DD)`);
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
  if (versao === undefined || versao === "" || args.length > 1 || versao === "--help") {
    console.error("Uso: anvilore checar-release <versao>");
    return 2;
  }
  if (!SEMVER.test(versao)) {
    console.error(`Versão inválida: ${versao}. Use SemVer, por exemplo 0.1.0`);
    return 2;
  }
  const { ok, problemas } = checarRelease(raiz, versao);
  if (!ok) {
    for (const problema of problemas) console.error(problema);
    return 1;
  }
  console.log(`Release ${versao} pronta: CHANGELOG preenchido e knowledge base revisada por pessoa`);
  return 0;
}
