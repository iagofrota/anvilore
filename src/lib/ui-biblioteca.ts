import { readdir, readFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { lerFrontmatter } from "./frontmatter";
import { estadoAprovacaoHumana } from "./okf";
import { caminhoWiki } from "./wiki-repo";

export type StatusDaPagina = "rascunho" | "aprovada" | "erro";

export type ItemDaBiblioteca = {
  caminho: string;
  titulo: string;
  slug: string;
  tipo: string;
  area: string;
  tags: string[];
  status: StatusDaPagina;
  data: string;
  links: number;
};

export type AbaTipo = {
  tipo: string;
  rotulo: string;
  contagem: number;
};

export type TotaisDaBiblioteca = {
  total: number;
  rascunhos: number;
  aprovadas: number;
  erros: number;
};

export type ResumoDaBiblioteca = {
  paginas: ItemDaBiblioteca[];
  totais: TotaisDaBiblioteca;
  tipos: AbaTipo[];
  areas: string[];
  tags: string[];
};

export function ehCaminhoDeNotaValido(caminhoRelativo: string): boolean {
  if (!caminhoRelativo || typeof caminhoRelativo !== "string" || caminhoRelativo.includes("\0")) {
    return false;
  }
  if (isAbsolute(caminhoRelativo)) {
    return false;
  }
  if (!caminhoRelativo.endsWith(".md")) {
    return false;
  }
  const partes = caminhoRelativo.split(/[/\\]/);
  for (const parte of partes) {
    if (parte.startsWith(".")) return false;
    const parteMin = parte.toLowerCase();
    if (parteMin === "_meta" || parteMin === "log") return false;
  }
  const nomeArquivo = (partes[partes.length - 1] ?? "").toLowerCase();
  if (nomeArquivo === "log.md" || nomeArquivo === "index.md") return false;
  return true;
}

const WIKILINK = /\[\[([^\]\n]+)\]\]/g;

async function listarMarkdown(diretorio: string, prefixo = ""): Promise<string[]> {
  let entradas;
  try {
    entradas = await readdir(join(diretorio, prefixo), { withFileTypes: true });
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw erro;
  }
  const arquivos: string[] = [];
  for (const entrada of entradas) {
    const caminho = prefixo ? `${prefixo}/${entrada.name}` : entrada.name;
    if (entrada.isDirectory()) {
      const nomeMin = entrada.name.toLowerCase();
      if (nomeMin === "_meta" || nomeMin === "log" || entrada.name.startsWith(".")) continue;
      arquivos.push(...(await listarMarkdown(diretorio, caminho)));
    } else if (entrada.isFile() && ehCaminhoDeNotaValido(caminho)) {
      arquivos.push(caminho);
    }
  }
  return arquivos.sort();
}

function extrairTags(frontmatter: Record<string, unknown>): string[] {
  if (Array.isArray(frontmatter.tags)) {
    return frontmatter.tags.map(String).filter(Boolean);
  }
  if (typeof frontmatter.tags === "string") {
    return frontmatter.tags.split(",").map((t) => t.trim()).filter(Boolean);
  }
  return [];
}

function contarWikilinks(conteudo: string): number {
  const matches = conteudo.match(WIKILINK);
  return matches ? matches.length : 0;
}

function determinarStatus(frontmatter: Record<string, unknown> | null): StatusDaPagina {
  if (!frontmatter) return "erro";
  if (frontmatter.generated !== undefined) {
    const estado = estadoAprovacaoHumana(frontmatter);
    if (estado === "invalida") return "erro";
    if (estado === "vigente") return "aprovada";
    return "rascunho";
  }
  return "aprovada";
}

function extrairData(frontmatter: Record<string, unknown>): string {
  if (typeof frontmatter.updated === "string") return frontmatter.updated;
  if (typeof frontmatter.date === "string") return frontmatter.date;
  if (frontmatter.generated && typeof frontmatter.generated === "object" && "at" in frontmatter.generated) {
    return String(frontmatter.generated.at);
  }
  if (Array.isArray(frontmatter.verified) && frontmatter.verified.length > 0) {
    const ultima = frontmatter.verified[frontmatter.verified.length - 1];
    if (ultima && typeof ultima === "object" && "at" in ultima) return String(ultima.at);
  }
  return "";
}

function extrairArea(caminho: string, frontmatter: Record<string, unknown>): string {
  if (typeof frontmatter.area === "string" && frontmatter.area.trim()) {
    return frontmatter.area.trim();
  }
  const partes = caminho.split("/");
  return partes.length > 1 ? partes[0]! : "(raiz)";
}

export async function listarBiblioteca(
  raiz: string,
  ambiente: Record<string, string | undefined> = process.env,
): Promise<ResumoDaBiblioteca> {
  const wiki = caminhoWiki(raiz, ambiente);
  const arquivos = await listarMarkdown(wiki);

  const paginas: ItemDaBiblioteca[] = [];
  const tiposContagem = new Map<string, number>();
  const areasSet = new Set<string>();
  const tagsSet = new Set<string>();

  let rascunhos = 0;
  let aprovadas = 0;
  let erros = 0;

  for (const caminho of arquivos) {
    const caminhoCompleto = join(wiki, caminho);
    let conteudo: string;
    try {
      conteudo = await readFile(caminhoCompleto, "utf8");
    } catch {
      continue;
    }

    const slug = basename(caminho, ".md");
    let frontmatter: Record<string, unknown> | null = null;
    try {
      frontmatter = lerFrontmatter(conteudo);
    } catch {
      // Frontmatter inválido
    }

    const status = determinarStatus(frontmatter);
    if (status === "rascunho") rascunhos++;
    else if (status === "aprovada") aprovadas++;
    else erros++;

    const titulo = frontmatter && typeof frontmatter.title === "string" && frontmatter.title.trim()
      ? frontmatter.title.trim()
      : slug;
    const tipo = frontmatter && typeof frontmatter.type === "string" && frontmatter.type.trim()
      ? frontmatter.type.trim()
      : "";
    const area = frontmatter ? extrairArea(caminho, frontmatter) : "(raiz)";
    const tags = frontmatter ? extrairTags(frontmatter) : [];
    const data = frontmatter ? extrairData(frontmatter) : "";
    const links = contarWikilinks(conteudo);

    if (tipo) {
      tiposContagem.set(tipo, (tiposContagem.get(tipo) ?? 0) + 1);
    }
    if (area && area !== "(raiz)") {
      areasSet.add(area);
    }
    for (const tag of tags) {
      tagsSet.add(tag);
    }

    paginas.push({
      caminho,
      titulo,
      slug,
      tipo,
      area,
      tags,
      status,
      data,
      links,
    });
  }

  // Montar abas de tipos: Todas primeiro, depois tipos ordenados alfabeticamente
  const tipos: AbaTipo[] = [
    { tipo: "todos", rotulo: "Todas", contagem: paginas.length },
    ...Array.from(tiposContagem.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([tipo, contagem]) => ({
        tipo,
        rotulo: tipo.charAt(0).toUpperCase() + tipo.slice(1),
        contagem,
      })),
  ];

  return {
    paginas,
    totais: {
      total: paginas.length,
      rascunhos,
      aprovadas,
      erros,
    },
    tipos,
    areas: Array.from(areasSet).sort(),
    tags: Array.from(tagsSet).sort(),
  };
}
