import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

// Os originais do que é da pessoa (SCHEMA.md, o esqueleto de wiki/ e de raw/). O kit copia daqui só o que falta e nunca
// sobrescreve; não depende de `git ls-files` nem de `git show` da fonte (depois que esses arquivos saem do rastreio,
// o HEAD do kit não os tem mais).
export const PASTA_MODELOS = resolve(import.meta.dir, "../../modelos");

// O que o kit deixa de rastrear (PLANO §4b, lista do U1). Diretório vale pelo conteúdo inteiro.
export const LISTA_DO_RASTREIO = [
  "SCHEMA.md", "wiki/index.md", "wiki/log.md", "wiki/.gitignore", "wiki/_meta/.gitkeep", "wiki/log/.gitkeep",
  "wiki/exemplo", "raw/.gitkeep", "raw/exemplo",
] as const;

export type PecaDoModelo = { origem: string; destino: string };

// `raw/` mora em `modelos/fontes/`: o hook trata qualquer componente `raw` do caminho como a camada da pessoa, e um
// `modelos/raw/` proibiria todo agente de editar o modelo. O `.gitignore` da wiki mora como `wiki/gitignore`: com o
// nome de verdade, ele ignoraria `modelos/wiki/exemplo/` no próprio repositório do kit.
export function destinoDoModelo(relModelo: string): string {
  if (relModelo.startsWith("fontes/")) return `raw/${relModelo.slice("fontes/".length)}`;
  if (relModelo === "wiki/gitignore") return "wiki/.gitignore";
  return relModelo;
}

// O inverso de `destinoDoModelo`: onde mora em `modelos/` o original de um caminho da pessoa (`raw/`, `wiki/`, `SCHEMA.md`).
export function origemNoModelo(destino: string): string | undefined {
  const rel = destino.replace(/\/+$/, "");
  if (rel === "raw" || rel.startsWith("raw/")) return `fontes${rel.slice("raw".length)}`;
  if (rel === "wiki/.gitignore") return "wiki/gitignore";
  if (rel === "wiki" || rel.startsWith("wiki/") || rel === "SCHEMA.md") return rel;
  return undefined;
}

export function ehExemplo(destino: string): boolean {
  return destino.startsWith("wiki/exemplo/") || destino.startsWith("raw/exemplo/");
}

async function existe(caminho: string): Promise<boolean> {
  try {
    await lstat(caminho);
    return true;
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw erro;
  }
}

export async function pecasDoModelo(pasta: string = PASTA_MODELOS): Promise<PecaDoModelo[]> {
  let entradas: string[];
  try {
    entradas = await readdir(pasta, { recursive: true });
  } catch (erro) {
    throw new Error(`kit sem a pasta modelos/ (${pasta}): ${(erro as Error).message}`, { cause: erro });
  }
  const pecas: PecaDoModelo[] = [];
  for (const entrada of entradas.sort()) {
    const origem = join(pasta, entrada);
    if (!(await lstat(origem)).isFile()) continue;
    pecas.push({ origem, destino: destinoDoModelo(relative(pasta, origem).split(sep).join("/")) });
  }
  if (pecas.length === 0) throw new Error(`kit com a pasta modelos/ vazia (${pasta})`);
  return pecas;
}

export type PlanoDeModelos = { copiar: PecaDoModelo[]; existentes: string[] };

// `exemplo`: o exemplo de wiki/ só nasce se wiki/ ainda não existe, e o de raw/ só se raw/ não existe (instalação nova).
// Assim o exemplo que a pessoa apagou continua apagado em toda reinstalação e atualização (PLANO §8, cenário 20).
export async function planejarModelos(raiz: string, opcoes: { exemplo: boolean; pasta?: string }): Promise<PlanoDeModelos> {
  const pecas = await pecasDoModelo(opcoes.pasta);
  const novas = { wiki: !(await existe(join(raiz, "wiki"))), raw: !(await existe(join(raiz, "raw"))) };
  const plano: PlanoDeModelos = { copiar: [], existentes: [] };
  for (const peca of pecas) {
    if (ehExemplo(peca.destino) && !(opcoes.exemplo && novas[peca.destino.startsWith("wiki/") ? "wiki" : "raw"])) continue;
    if (await existe(join(raiz, peca.destino))) plano.existentes.push(peca.destino);
    else plano.copiar.push(peca);
  }
  return plano;
}

// `wx`: se alguém criou o arquivo entre o plano e a escrita, a escrita falha em vez de sobrescrever.
export async function escreverPeca(raiz: string, peca: PecaDoModelo, opcoes: { exemplo?: boolean } = {}): Promise<void> {
  const caminho = join(raiz, peca.destino);
  await mkdir(dirname(caminho), { recursive: true });
  let conteudo = await readFile(peca.origem, "utf8");
  if (opcoes.exemplo === false && peca.destino === "wiki/index.md") {
    const inicioDoExemplo = conteudo.indexOf("\n## Área: exemplo\n");
    if (inicioDoExemplo >= 0) conteudo = `${conteudo.slice(0, inicioDoExemplo).trimEnd()}\n`;
  }
  await writeFile(caminho, conteudo, { flag: "wx" });
}

export async function copiarModelos(raiz: string, opcoes: { exemplo: boolean; pasta?: string }): Promise<{ criados: string[]; existentes: string[] }> {
  const plano = await planejarModelos(raiz, opcoes);
  for (const peca of plano.copiar) await escreverPeca(raiz, peca, { exemplo: opcoes.exemplo });
  return { criados: plano.copiar.map(peca => peca.destino), existentes: plano.existentes };
}
