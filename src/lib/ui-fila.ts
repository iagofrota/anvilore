import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { lerFrontmatter } from "./frontmatter";
import { caminhoWiki } from "./wiki-repo";
import { validarWiki, type ResultadoValidacao } from "../comandos/validar";
import { estadoAprovacaoHumana, timestampValido } from "./okf";

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
  avisos?: string[];
  conteudo: string;
  versao: string;
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

function erroGlobal(erro: string): boolean {
  return erro.startsWith("página fora do índice:") || erro.startsWith("wikilink quebrado");
}

// `validada` deixa quem já validou a wiki (a tela Início) reaproveitar o resultado em vez de lê-la de novo.
export async function listarFilaRascunhos(raiz: string, ambiente: Record<string, string | undefined> = process.env, validada?: ResultadoValidacao): Promise<Rascunho[]> {
  const wiki = caminhoWiki(raiz, ambiente);
  const arquivos = await listarMarkdown(wiki);
  const validacao = validada ?? await validarWiki(wiki);
  const fila: Rascunho[] = [];
  for (const caminho of arquivos) {
    if (basename(caminho) === "index.md" || caminho === "log.md" || caminho.startsWith("log/") || caminho.startsWith("_meta/")) continue;
    const conteudo = await readFile(join(wiki, caminho), "utf8");
    let frontmatter: Record<string, unknown> | null;
    try { frontmatter = lerFrontmatter(conteudo); }
    catch {
      fila.push({ caminho, titulo: basename(caminho, ".md"), tipo: "", status: "erro", aprovavel: false, erros: erroDoValidador(validacao.erros, caminho), conteudo, versao: createHash("sha256").update(conteudo).digest("hex") });
      continue;
    }
    if (!frontmatter || frontmatter.generated === undefined) continue;
    const generated = frontmatter.generated;
    const geradaEm = ehMapa(generated) && timestampValido(generated.at);
    const estadoAprovacao = estadoAprovacaoHumana(frontmatter);
    const diagnosticos = erroDoValidador(validacao.erros, caminho).filter(erro => !erro.startsWith(`página gerada sem aprovação humana: ${caminho}`));
    const erros = diagnosticos.filter(erro => !erroGlobal(erro));
    const avisos = diagnosticos.filter(erroGlobal);
    if (!geradaEm || estadoAprovacao === "invalida") {
      fila.push({ caminho, titulo: String(frontmatter.title ?? basename(caminho, ".md")), tipo: String(frontmatter.type ?? ""), status: "erro", aprovavel: false, erros, conteudo, versao: createHash("sha256").update(conteudo).digest("hex") });
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
      ...(avisos.length ? { avisos } : {}),
      conteudo,
      versao: createHash("sha256").update(conteudo).digest("hex"),
    });
  }
  return fila;
}

export async function indexarCopias(raiz: string): Promise<Map<string, string>> {
  const pasta = resolve(raiz, ".anvilore/ui/copias");
  const arquivos: string[] = [];
  const visitar = async (dir: string): Promise<void> => {
    let entradas;
    try { entradas = await readdir(dir, { withFileTypes: true }); }
    catch (erro) { if ((erro as NodeJS.ErrnoException).code === "ENOENT") return; throw erro; }
    await Promise.all(entradas.map(async entrada => {
      const absoluto = join(dir, entrada.name);
      if (entrada.isDirectory()) await visitar(absoluto);
      else if (entrada.isFile() && entrada.name.endsWith(".md")) arquivos.push(absoluto);
    }));
  };
  await visitar(pasta);
  const candidatos = new Map<string, { caminho: string; data: number }>();
  await Promise.all(arquivos.map(async caminho => {
    const relativo = relative(pasta, caminho).split(sep).join("/");
    const separador = relativo.indexOf("/");
    if (separador < 1) return;
    const pagina = relativo.slice(separador + 1);
    try {
      const data = (await stat(caminho)).mtimeMs;
      if (!candidatos.has(pagina) || candidatos.get(pagina)!.data < data) candidatos.set(pagina, { caminho, data });
    } catch { /* cópia removida durante a indexação */ }
  }));
  return new Map([...candidatos].map(([pagina, item]) => [pagina, item.caminho]));
}

export async function caminhoDaCopia(raiz: string, caminhoWikiRelativo: string): Promise<string | undefined> {
  return (await indexarCopias(raiz)).get(caminhoWikiRelativo);
}
