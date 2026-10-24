import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { linhasDe } from "../lib/frontmatter";
import { linhasVisiveis } from "../lib/markdown";

export type ResultadoDocs = { ok: boolean; problemas: string[] };

const PASTA_DA_KB = "docs/knowledge_base";
// `[texto](alvo)` ou `![texto](alvo)`, com título opcional entre aspas duplas ou simples. O texto pode
// atravessar linhas, mas não um parágrafo (linha em branco). O alvo não tem espaço nem `)`.
const LINK = /!?\[(?:[^\]\n]|\n(?!\s*\n))*\]\(([^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\)/g;
const TRECHO_EM_CRASES = /`([^`]+)`/g;
// Trecho de código em linha dentro de um parágrafo: pode atravessar linhas, mas não uma linha em branco.
const CRASES_NO_PARAGRAFO = /`(?:[^`\n]|\n(?!\s*\n))+`/g;
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

function foraDaRaiz(raiz: string, caminho: string): boolean {
  const rel = relative(resolve(raiz), caminho);
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

function conferirPagina(raiz: string, pasta: string, pagina: string): string[] {
  const nome = `${PASTA_DA_KB}/${pagina}`;
  const dirDaPagina = dirname(join(pasta, pagina));
  const problemas = new Set<string>();
  const visiveis = linhasVisiveis(linhasDe(readFileSync(join(pasta, pagina), "utf8")));

  // Menção entre crases resolve a partir da raiz do repositório.
  for (const linha of visiveis) {
    for (const [, mencao] of linha.matchAll(TRECHO_EM_CRASES)) {
      const alvo = semAncora(mencao!.trim());
      if (alvo === "" || !pareceCaminho(alvo)) continue;
      const caminho = resolve(raiz, alvo.replace(/^\/+/, ""));
      if (foraDaRaiz(raiz, caminho)) {
        problemas.add(`${nome}: menção a \`${alvo}\` aponta para fora da raiz do repositório`);
      } else if (!existsSync(caminho)) {
        problemas.add(`${nome}: menção a \`${alvo}\` que não existe`);
      }
    }
  }

  // Link markdown resolve a partir da página (ou da raiz, se começa com `/`). Casa sobre o texto inteiro
  // para pegar link que atravessa linha; código em linha vira espaços (as quebras ficam), o que preserva os índices.
  const texto = visiveis.join("\n").replace(CRASES_NO_PARAGRAFO, (trecho) =>
    trecho.replace(/[^\n]/g, " "),
  );
  const vistos = new Set<string>();
  for (const achado of texto.matchAll(LINK)) {
    const alvo = semAncora(achado[1]!);
    if (alvo === "" || ehUrl(alvo)) continue;
    const base = alvo.startsWith("/") ? raiz : dirDaPagina;
    const caminho = resolve(base, decodificar(alvo.replace(/^\/+/, "")));
    const defeito = foraDaRaiz(raiz, caminho)
      ? "aponta para fora da raiz do repositório"
      : existsSync(caminho)
        ? null
        : "quebrado";
    if (defeito === null) continue;
    const mensagem = `${nome}: link para ${alvo} ${defeito}`;
    if (vistos.has(mensagem)) continue;
    vistos.add(mensagem);
    const linha = texto.slice(0, achado.index).split("\n").length;
    problemas.add(`${mensagem} (linha ${linha})`);
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

export async function comandoChecarDocs(args: string[], raiz: string = process.cwd()): Promise<number> {
  if (args.length > 0) {
    console.error("Uso: anvilore checar-docs (não recebe argumentos)");
    return 2;
  }
  const { ok, problemas } = checarDocs(raiz);
  if (!ok) {
    for (const problema of problemas) console.error(problema);
    return 1;
  }
  console.log(`${PASTA_DA_KB}: nenhum link quebrado nem referência a arquivo inexistente`);
  return 0;
}
