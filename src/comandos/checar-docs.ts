import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { linhasDe } from "../lib/frontmatter";
import { PASTA_DA_KB, listarPaginasDaKb } from "../lib/knowledge-base";
import { acharCodigosEmLinha, acharLinks, linhasVisiveis } from "../lib/markdown";
import { origemNoModelo } from "../lib/modelos";

export type ResultadoDocs = { ok: boolean; problemas: string[] };

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

function foraDaRaiz(raiz: string, caminho: string): boolean {
  const rel = relative(resolve(raiz), caminho);
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

// `raw/`, `wiki/` e `SCHEMA.md` são da pessoa e o kit não os rastreia: a menção vale se o original existe em `modelos/`.
function existeNoModelo(raiz: string, alvo: string): boolean {
  const origem = origemNoModelo(alvo.replace(/^\/+/, ""));
  return origem !== undefined && existsSync(join(raiz, "modelos", origem));
}

function conferirPagina(raiz: string, pasta: string, pagina: string): string[] {
  const nome = `${PASTA_DA_KB}/${pagina}`;
  const dirDaPagina = dirname(join(pasta, pagina));
  const problemas = new Set<string>();
  const visiveis = linhasVisiveis(linhasDe(readFileSync(join(pasta, pagina), "utf8")));

  // O texto inteiro, para pegar link e código em linha que atravessam linhas. O reconhecimento de código
  // em linha é o de `markdown.ts`, o mesmo do leitor: link dentro de código nunca é link.
  const completo = visiveis.join("\n");

  // Menção entre crases resolve a partir da raiz do repositório.
  for (const { conteudo } of acharCodigosEmLinha(completo)) {
    const alvo = semAncora(conteudo.trim());
    if (alvo === "" || !pareceCaminho(alvo)) continue;
    const caminho = resolve(raiz, alvo.replace(/^\/+/, ""));
    if (foraDaRaiz(raiz, caminho)) {
      problemas.add(`${nome}: menção a \`${alvo}\` aponta para fora da raiz do repositório`);
    } else if (!existsSync(caminho) && !existeNoModelo(raiz, alvo)) {
      problemas.add(`${nome}: menção a \`${alvo}\` que não existe`);
    }
  }

  // Link markdown resolve a partir da página (ou da raiz, se começa com `/`).
  const vistos = new Set<string>();
  for (const achado of acharLinks(completo)) {
    const alvo = semAncora(achado.alvo);
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
    const linha = completo.slice(0, achado.inicio).split("\n").length;
    problemas.add(`${mensagem} (linha ${linha})`);
  }
  return [...problemas];
}

export function checarDocs(raiz: string): ResultadoDocs {
  const { paginas, problemas: daLista } = listarPaginasDaKb(raiz);
  if (daLista.length > 0) return { ok: false, problemas: daLista };
  const pasta = join(raiz, ...PASTA_DA_KB.split("/"));
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
