import { readdir, readFile } from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { lerFrontmatter } from "./frontmatter";
import { caminhoWiki } from "./wiki-repo";
import { validarWiki } from "../comandos/validar";
import { estadoAprovacaoHumana } from "./okf";

export type Rascunho = {
  caminho: string;
  titulo: string;
  tipo: string;
  geradoPor?: string;
  geradoEm?: string;
  fonte?: string;
  status: "nova" | "atualizada" | "erro";
  aprovavel: boolean;
  aprovacaoAnterior?: "deixa de valer";
  erros?: string[];
  conteudo: string;
};

async function listarMarkdown(diretorio: string, prefixo = ""): Promise<string[]> {
  let entradas;
  try { entradas = await readdir(join(diretorio, prefixo), { withFileTypes: true }); }
  catch (erro) { if ((erro as NodeJS.ErrnoException).code === "ENOENT") return []; throw erro; }
  const arquivos: string[] = [];
  for (const entrada of entradas) {
    const caminho = prefixo ? `${prefixo}/${entrada.name}` : entrada.name;
    if (entrada.isDirectory()) arquivos.push(...await listarMarkdown(diretorio, caminho));
    else if (entrada.isFile() && entrada.name.endsWith(".md") && !entrada.name.startsWith(".")) arquivos.push(caminho);
  }
  return arquivos.sort();
}

function ehMapa(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function erroDoValidador(erros: string[], caminho: string): string[] {
  return erros.filter(erro => erro.endsWith(`: ${caminho}`) || erro.includes(`: ${caminho} (`));
}

export async function listarFilaRascunhos(raiz: string, ambiente: Record<string, string | undefined> = process.env): Promise<Rascunho[]> {
  const wiki = caminhoWiki(raiz, ambiente);
  const arquivos = await listarMarkdown(wiki);
  const validacao = await validarWiki(wiki);
  const fila: Rascunho[] = [];
  for (const caminho of arquivos) {
    if (basename(caminho) === "index.md" || caminho === "log.md" || caminho.startsWith("log/") || caminho.startsWith("_meta/")) continue;
    const conteudo = await readFile(join(wiki, caminho), "utf8");
    let frontmatter: Record<string, unknown> | null;
    try { frontmatter = lerFrontmatter(conteudo); }
    catch {
      fila.push({ caminho, titulo: basename(caminho, ".md"), tipo: "", status: "erro", aprovavel: false, erros: erroDoValidador(validacao.erros, caminho), conteudo });
      continue;
    }
    if (!frontmatter || frontmatter.generated === undefined) continue;
    const generated = frontmatter.generated;
    const geradaEm = ehMapa(generated) && instanteValido(generated.at);
    const estadoAprovacao = estadoAprovacaoHumana(frontmatter);
    const erros = erroDoValidador(validacao.erros, caminho).filter(erro => !erro.startsWith(`página gerada sem aprovação humana: ${caminho}`));
    if (!geradaEm || estadoAprovacao === "invalida") {
      fila.push({ caminho, titulo: String(frontmatter.title ?? basename(caminho, ".md")), tipo: String(frontmatter.type ?? ""), status: "erro", aprovavel: false, erros, conteudo });
      continue;
    }
    if (estadoAprovacao === "vigente") continue;
    const atualizada = estadoAprovacao === "antiga";
    const geracao = ehMapa(generated) ? generated : {};
    const fontes = Array.isArray(frontmatter.sources) ? frontmatter.sources : [];
    const primeiraFonte = fontes.find(ehMapa);
    fila.push({
      caminho,
      titulo: String(frontmatter.title ?? basename(caminho, ".md")),
      tipo: String(frontmatter.type ?? ""),
      geradoPor: typeof geracao.by === "string" ? geracao.by : undefined,
      geradoEm: String(geracao.at),
      fonte: primeiraFonte && typeof primeiraFonte.resource === "string" ? primeiraFonte.resource : undefined,
      status: erros.length ? "erro" : atualizada ? "atualizada" : "nova",
      aprovavel: erros.length === 0,
      ...(atualizada ? { aprovacaoAnterior: "deixa de valer" as const } : {}),
      ...(erros.length ? { erros } : {}),
      conteudo,
    });
  }
  return fila;
}

function instanteValido(valor: unknown): boolean {
  if (typeof valor !== "string" && typeof valor !== "number" && !(valor instanceof Date)) return false;
  return Number.isFinite(Date.parse(String(valor)));
}

export function caminhoDaCopia(raiz: string, caminhoWikiRelativo: string): string | undefined {
  const pasta = resolve(raiz, ".anvilore/ui/copias");
  const caminhos: Array<{ caminho: string; data: number }> = [];
  const visitar = (dir: string) => {
    let entradas;
    try { entradas = readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entrada of entradas) {
      const absoluto = join(dir, entrada.name);
      if (entrada.isDirectory()) visitar(absoluto);
      else if (entrada.isFile()) {
        const relativo = relative(pasta, absoluto).split(sep).join("/");
        if (relativo !== caminhoWikiRelativo && !relativo.endsWith(`/${caminhoWikiRelativo}`)) continue;
        try { caminhos.push({ caminho: absoluto, data: statSync(absoluto).mtimeMs }); } catch { /* arquivo removido durante a leitura */ }
      }
    }
  };
  visitar(pasta);
  return caminhos.sort((a, b) => b.data - a.data)[0]?.caminho;
}
