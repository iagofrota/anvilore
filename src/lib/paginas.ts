import { readdir, stat } from "node:fs/promises";
import { join, parse, sep } from "node:path";

// Leitura de páginas .md compartilhada pelos comandos que varrem a wiki
// (listar-lacunas, auditar). Reproduz o que o Python antigo fazia com
// `rglob("*.md")`, `splitlines` e `strip`, para a saída não mudar com o porte.

// R58/R61: symlink de arquivo é seguido com stat e, quebrado, avisa. Symlink de
// diretório não é descido (o rglob do Python 3.12 não descia), mas avisa.
const LINK_QUEBRADO = new Set(["ENOENT", "ELOOP", "ENOTDIR"]);

export function linkQuebrado(erro: unknown): boolean {
  return LINK_QUEBRADO.has((erro as NodeJS.ErrnoException).code ?? "");
}

function porBytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

// Percorre em profundidade com os nomes ordenados a cada nível, que é a ordem
// das partes do caminho que `sorted(rglob)` dava. Ordenar o caminho inteiro
// como texto não serve: `a-b/x` viria antes de `a/x` porque `-` vem antes de `/`.
export async function paginasMarkdown(pasta: string, ignorar: (nome: string) => boolean = () => false): Promise<string[]> {
  const paginas: string[] = [];
  const entradas = (await readdir(pasta, { withFileTypes: true })).sort((a, b) => porBytes(a.name, b.name));
  for (const entrada of entradas) {
    if (ignorar(entrada.name)) continue;
    const caminho = join(pasta, entrada.name);
    let alvo: { isDirectory(): boolean; isFile(): boolean } = entrada;
    if (entrada.isSymbolicLink()) {
      try {
        alvo = await stat(caminho);
      } catch (erro) {
        if (!linkQuebrado(erro)) throw erro;
        console.error(`AVISO: symlink quebrado: ${caminho}`);
        continue;
      }
      if (alvo.isDirectory()) {
        console.error(`AVISO: symlink de diretório não seguido: ${caminho}`);
        continue;
      }
    }
    if (alvo.isDirectory()) {
      // O Python listava `x.md` (diretório) e quebrava ao ler; aqui desce nele, mas não pula em silêncio.
      if (entrada.name.endsWith(".md")) console.error(`AVISO: diretório com nome de página ignorado: ${caminho}`);
      paginas.push(...await paginasMarkdown(caminho, ignorar));
    }
    else if (alvo.isFile() && entrada.name.endsWith(".md")) paginas.push(caminho);
  }
  return paginas;
}

// `str.splitlines` do Python: além de \n, \r e \r\n, quebra em \v, \f, \x1c-\x1e,
// \x85, U+2028 e U+2029, e não devolve linha vazia depois da última quebra.
export function linhasPython(texto: string): string[] {
  const linhas = texto.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/);
  if (linhas[linhas.length - 1] === "") linhas.pop();
  return linhas;
}

// `str.strip` do Python: o `trim` do JS tira o BOM e não tira \x1c-\x1f nem \x85.
export const ESPACO_PYTHON = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const APARAR = new RegExp(`^[${ESPACO_PYTHON}]+|[${ESPACO_PYTHON}]+$`, "g");

export function apararPython(texto: string): string {
  return texto.replace(APARAR, "");
}

// Como `str(Path(x))`: tira barra final, `//` e `.`, mas deixa `..` onde está.
export function caminhoPathlib(caminho: string): string {
  const { root } = parse(caminho);
  const partes = caminho.slice(root.length).split(sep === "\\" ? /[\\/]+/ : /\/+/).filter((p) => p !== "" && p !== ".");
  return root + partes.join(sep) || ".";
}

export function dataLocal(): string {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}`;
}
