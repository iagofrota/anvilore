import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { linhasDe } from "../lib/frontmatter";
import { linhasVisiveis } from "../lib/markdown";

export type ResultadoDocs = { ok: boolean; problemas: string[] };

const PASTA_DA_KB = "docs/knowledge_base";
// `[texto](alvo)` ou `![texto](alvo)`, com título opcional entre aspas. O alvo não tem espaço nem `)`.
const LINK = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const TRECHO_EM_CRASES = /`([^`]+)`/g;
const ESQUEMA = /^[a-z][a-z0-9+.-]+:/i;
// Lista fechada, em minúsculas: `Bun.YAML` e `process.env` não são arquivos.
const EXTENSOES = new Set(["md", "ts", "js", "mjs", "json", "sh", "py", "yml", "yaml", "toml", "lock", "tsv", "txt"]);

function ehUrl(texto: string): boolean {
  return ESQUEMA.test(texto);
}

// Só uma menção entre crases que parece caminho é conferida; o resto é código ou prosa.
function pareceCaminho(mencao: string): boolean {
  if (/[\s*<>]/.test(mencao) || ehUrl(mencao)) return false;
  const ponto = mencao.lastIndexOf(".");
  return mencao.includes("/") || (ponto > 0 && EXTENSOES.has(mencao.slice(ponto + 1)));
}

function semAncora(alvo: string): string {
  const cerca = alvo.indexOf("#");
  return cerca === -1 ? alvo : alvo.slice(0, cerca);
}

function decodificar(alvo: string): string {
  try {
    return decodeURIComponent(alvo);
  } catch {
    return alvo;
  }
}

function paginasDaKb(pasta: string): string[] {
  return (readdirSync(pasta, { recursive: true, encoding: "utf8" }) as string[])
    .map((relativo) => relativo.replaceAll("\\", "/"))
    .filter((relativo) => relativo.toLowerCase().endsWith(".md") && statSync(join(pasta, relativo)).isFile())
    .sort();
}

function conferirPagina(raiz: string, pasta: string, pagina: string): string[] {
  const nome = `${PASTA_DA_KB}/${pagina}`;
  const dirDaPagina = dirname(join(pasta, pagina));
  const problemas = new Set<string>();

  for (const linha of linhasVisiveis(linhasDe(readFileSync(join(pasta, pagina), "utf8")))) {
    // Menção entre crases resolve a partir da raiz do repositório.
    for (const [, mencao] of linha.matchAll(TRECHO_EM_CRASES)) {
      const alvo = semAncora(mencao!.trim());
      if (alvo === "" || !pareceCaminho(alvo)) continue;
      if (!existsSync(resolve(raiz, alvo.replace(/^\/+/, "")))) {
        problemas.add(`${nome}: menção a \`${alvo}\` que não existe`);
      }
    }
    // Link markdown resolve a partir da página (ou da raiz, se começa com `/`).
    for (const [, bruto] of linha.replace(TRECHO_EM_CRASES, "").matchAll(LINK)) {
      const alvo = semAncora(bruto!);
      if (alvo === "" || ehUrl(alvo)) continue;
      const base = alvo.startsWith("/") ? raiz : dirDaPagina;
      if (!existsSync(resolve(base, decodificar(alvo.replace(/^\/+/, ""))))) {
        problemas.add(`${nome}: link para ${alvo} quebrado`);
      }
    }
  }
  return [...problemas];
}

export function checarDocs(raiz: string): ResultadoDocs {
  const pasta = join(raiz, "docs", "knowledge_base");
  if (!existsSync(pasta) || !statSync(pasta).isDirectory()) {
    return { ok: false, problemas: [`${PASTA_DA_KB} não existe`] };
  }
  const paginas = paginasDaKb(pasta);
  if (paginas.length === 0) {
    return { ok: false, problemas: [`${PASTA_DA_KB} não tem nenhuma página .md`] };
  }
  const problemas = paginas.flatMap((pagina) => conferirPagina(raiz, pasta, pagina));
  return { ok: problemas.length === 0, problemas };
}

export async function comandoChecarDocs(_args: string[], raiz: string = process.cwd()): Promise<number> {
  const { ok, problemas } = checarDocs(raiz);
  if (!ok) {
    for (const problema of problemas) console.error(problema);
    return 1;
  }
  console.log(`${PASTA_DA_KB}: nenhum link quebrado nem referência a arquivo inexistente`);
  return 0;
}
