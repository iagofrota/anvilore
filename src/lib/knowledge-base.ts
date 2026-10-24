import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const PASTA_DA_KB = "docs/knowledge_base";

export type ListaDaKb = { paginas: string[]; problemas: string[] };

function ehArquivo(caminho: string): boolean {
  try {
    return statSync(caminho).isFile();
  } catch {
    return false;
  }
}

function ehPasta(caminho: string): boolean | null {
  try {
    return statSync(caminho).isDirectory();
  } catch {
    return null;
  }
}

// Fonte única da lista de páginas da knowledge base: quem confere links e quem trava a
// release olham o mesmo conjunto. KB ausente, que é arquivo ou sem nenhum `.md` reprova.
export function listarPaginasDaKb(raiz: string): ListaDaKb {
  const pasta = join(raiz, ...PASTA_DA_KB.split("/"));
  const dica = `rode na raiz do repositório (cwd: ${process.cwd()})`;
  const tipo = ehPasta(pasta);
  if (tipo === null) {
    return { paginas: [], problemas: [`${PASTA_DA_KB} não existe em ${resolve(raiz)}; ${dica}`] };
  }
  if (!tipo) {
    return { paginas: [], problemas: [`${PASTA_DA_KB} não é uma pasta em ${resolve(raiz)}; ${dica}`] };
  }

  const paginas = (readdirSync(pasta, { recursive: true, encoding: "utf8" }) as string[])
    .map((relativo) => relativo.replaceAll("\\", "/"))
    .filter((relativo) => relativo.toLowerCase().endsWith(".md") && ehArquivo(join(pasta, relativo)))
    .sort();
  if (paginas.length === 0) {
    return { paginas, problemas: [`${PASTA_DA_KB} não tem nenhuma página .md`] };
  }
  return { paginas, problemas: [] };
}
