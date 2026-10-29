import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { lerFrontmatter, linhasDe } from "./frontmatter";
import { estadoAprovacaoHumana } from "./okf";
import { ehCaminhoDeNotaValido } from "./ui-biblioteca";
import { caminhoWiki } from "./wiki-repo";

export class ErroDeCaminhoInvalido extends Error {
  status = 400;
  constructor(mensagem = "Caminho fora da wiki.") {
    super(mensagem);
    this.name = "ErroDeCaminhoInvalido";
  }
}

export type Lacuna = {
  tipo: "gap" | "contradiction";
  texto: string;
  linha: number;
};

export type Fonte = {
  recurso: string;
  titulo?: string;
};

export type Proveniencia = {
  fontePrincipal?: string;
  fontes: Fonte[];
  geradoPor?: string;
  geradoEm?: string;
  verificadoPor?: string;
  verificadoEm?: string;
};

export type Backlink = {
  caminho: string;
  slug: string;
  titulo: string;
  tipo: string;
  contexto: string;
};

export type NoDoGrafo = {
  id: string;
  rotulo: string;
  tipo: string;
  atual: boolean;
};

export type ArestaDoGrafo = {
  de: string;
  para: string;
};

export type GrafoLocal = {
  nos: NoDoGrafo[];
  arestas: ArestaDoGrafo[];
};

export type DetalhesDaNota = {
  caminho: string;
  titulo: string;
  slug: string;
  tipo: string;
  area: string;
  tags: string[];
  status: "rascunho" | "aprovada" | "erro";
  statusMeta: string;
  aprovavel: boolean;
  versao: string;
  corpo: string;
  proveniencia: Proveniencia;
  fontes: Fonte[];
  relacionados: string[];
  lacunas: Lacuna[];
  backlinks: Backlink[];
  grafoLocal: GrafoLocal;
};

const CALLOUT = /^>\s*\[!(gap|contradiction)\]\s?(.*)$/i;
const CITACAO = /^>\s?(.*)$/;
const WIKILINK = /\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g;

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
      if (entrada.name === "_meta" || entrada.name === "log" || entrada.name.startsWith(".")) continue;
      arquivos.push(...(await listarMarkdown(diretorio, caminho)));
    } else if (entrada.isFile() && entrada.name.endsWith(".md") && !entrada.name.startsWith(".")) {
      if (basename(caminho) === "index.md" || caminho === "log.md" || caminho.startsWith("log/")) continue;
      arquivos.push(caminho);
    }
  }
  return arquivos.sort();
}

function extrairWikilinks(conteudo: string): string[] {
  const alvos: string[] = [];
  let correspondencia;
  const regex = new RegExp(WIKILINK.source, "g");
  while ((correspondencia = regex.exec(conteudo)) !== null) {
    const alvo = correspondencia[1]?.trim();
    if (alvo) alvos.push(alvo);
  }
  return alvos;
}

function extrairLacunas(corpo: string): Lacuna[] {
  const linhas = corpo.split(/\r?\n/);
  const lacunas: Lacuna[] = [];
  for (let i = 0; i < linhas.length;) {
    const abertura = CALLOUT.exec(linhas[i]!);
    if (!abertura) {
      i++;
      continue;
    }
    const linha = i + 1;
    const tipo = abertura[1]!.toLowerCase() as "gap" | "contradiction";
    const textoInicial = abertura[2]?.trim() ?? "";
    const partes: string[] = textoInicial ? [textoInicial] : [];
    i++;
    while (i < linhas.length && !CALLOUT.test(linhas[i]!)) {
      const continuacao = CITACAO.exec(linhas[i]!);
      if (!continuacao) break;
      const textoLinha = continuacao[1]?.trim();
      if (textoLinha) partes.push(textoLinha);
      i++;
    }
    lacunas.push({
      tipo,
      linha,
      texto: partes.join(" ").replace(/\s+/g, " ").trim(),
    });
  }
  return lacunas;
}

function extrairContextoDeWikilink(conteudo: string, slugAlvo: string): string {
  const linhas = corpoSemFrontmatter(conteudo).split(/\r?\n/);
  for (const linha of linhas) {
    if (linha.includes(`[[${slugAlvo}`) || linha.includes(`[[${slugAlvo}|`)) {
      const limpa = linha.replace(/^>\s?/, "").replace(/^#+\s?/, "").trim();
      return limpa.length > 120 ? `${limpa.slice(0, 117)}...` : limpa;
    }
  }
  return "";
}

function corpoSemFrontmatter(conteudo: string): string {
  const linhas = linhasDe(conteudo);
  if (linhas[0] !== "---") return conteudo;
  const fim = linhas.indexOf("---", 1);
  if (fim === -1) return conteudo;
  return linhas.slice(fim + 1).join("\n").replace(/^\n+/, "");
}

export async function validarCaminhoWiki(wiki: string, caminhoRelativo: string): Promise<string> {
  if (!ehCaminhoDeNotaValido(caminhoRelativo)) {
    throw new ErroDeCaminhoInvalido();
  }
  const caminhoNormalizado = resolve(wiki, caminhoRelativo);
  const rel = relative(wiki, caminhoNormalizado);
  if (rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel)) {
    throw new ErroDeCaminhoInvalido();
  }
  try {
    await stat(caminhoNormalizado);
    const caminhoReal = await realpath(caminhoNormalizado);
    const wikiReal = await realpath(wiki);
    const relReal = relative(wikiReal, caminhoReal);
    if (relReal === ".." || relReal.startsWith("../") || relReal.startsWith("..\\") || isAbsolute(relReal)) {
      throw new ErroDeCaminhoInvalido();
    }
  } catch (erro) {
    if (erro instanceof ErroDeCaminhoInvalido) throw erro;
    const codigo = (erro as NodeJS.ErrnoException).code;
    if (codigo === "ENOENT") return caminhoNormalizado;
    throw erro;
  }
  return caminhoNormalizado;
}

export async function obterNota(
  raiz: string,
  caminhoRelativo: string,
  ambiente: Record<string, string | undefined> = process.env,
): Promise<DetalhesDaNota | null> {
  const wiki = caminhoWiki(raiz, ambiente);
  const caminhoAbsoluto = await validarCaminhoWiki(wiki, caminhoRelativo);

  let conteudo: string;
  try {
    conteudo = await readFile(caminhoAbsoluto, "utf8");
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw erro;
  }

  const slug = basename(caminhoRelativo, ".md");
  let frontmatter: Record<string, unknown> | null = null;
  try {
    frontmatter = lerFrontmatter(conteudo);
  } catch {
    // Frontmatter inválido
  }

  const corpo = corpoSemFrontmatter(conteudo);
  const versao = createHash("sha256").update(conteudo).digest("hex");
  const titulo = frontmatter && typeof frontmatter.title === "string" && frontmatter.title.trim()
    ? frontmatter.title.trim()
    : slug;
  const tipo = frontmatter && typeof frontmatter.type === "string" && frontmatter.type.trim()
    ? frontmatter.type.trim()
    : "";
  const area = frontmatter && typeof frontmatter.area === "string" && frontmatter.area.trim()
    ? frontmatter.area.trim()
    : caminhoRelativo.split("/").length > 1
      ? caminhoRelativo.split("/")[0]!
      : "(raiz)";
  const tags = frontmatter && Array.isArray(frontmatter.tags)
    ? frontmatter.tags.map(String).filter(Boolean)
    : [];

  // Status & meta
  let status: "rascunho" | "aprovada" | "erro" = "aprovada";
  let statusMeta = "";
  let aprovavel = false;

  if (!frontmatter) {
    status = "erro";
    statusMeta = "Frontmatter ausente ou com formatação inválida.";
  } else if (frontmatter.generated !== undefined) {
    const estado = estadoAprovacaoHumana(frontmatter);
    if (estado === "invalida") {
      status = "erro";
      statusMeta = "Formato de geração inválido.";
    } else if (estado === "vigente") {
      status = "aprovada";
      const verificacoes = Array.isArray(frontmatter.verified) ? frontmatter.verified : [];
      const ultima = verificacoes[verificacoes.length - 1];
      const humano = ultima && typeof ultima === "object" && "by" in ultima ? String(ultima.by) : "humano";
      statusMeta = `Aprovada por ${humano}.`;
    } else {
      status = "rascunho";
      aprovavel = true;
      const agente = typeof (frontmatter.generated as Record<string, unknown>)?.by === "string"
        ? String((frontmatter.generated as Record<string, unknown>).by)
        : "agente";
      statusMeta = `Rascunho escrito por ${agente}. Aguarda aprovação humana.`;
    }
  } else {
    status = "aprovada";
    const verificacoes = Array.isArray(frontmatter.verified) ? frontmatter.verified : [];
    if (verificacoes.length > 0) {
      const ultima = verificacoes[verificacoes.length - 1];
      const humano = ultima && typeof ultima === "object" && "by" in ultima ? String(ultima.by) : "humano";
      statusMeta = `Aprovada por ${humano}.`;
    } else {
      statusMeta = "Página escrita manualmente.";
    }
  }

  // Proveniência
  const fontesBrutas: Fonte[] = [];
  if (frontmatter && Array.isArray(frontmatter.sources)) {
    for (const s of frontmatter.sources) {
      if (s && typeof s === "object" && typeof s.resource === "string") {
        fontesBrutas.push({
          recurso: s.resource,
          ...(typeof s.title === "string" ? { titulo: s.title } : {}),
        });
      }
    }
  }

  const geracao = frontmatter?.generated && typeof frontmatter.generated === "object"
    ? frontmatter.generated as Record<string, unknown>
    : undefined;
  const verificacoes = frontmatter && Array.isArray(frontmatter.verified) ? frontmatter.verified : [];
  const ultimaVerificacao = verificacoes.length > 0 ? verificacoes[verificacoes.length - 1] as Record<string, unknown> : undefined;

  const proveniencia: Proveniencia = {
    fontePrincipal: fontesBrutas[0]?.recurso,
    fontes: fontesBrutas,
    geradoPor: geracao && typeof geracao.by === "string" ? geracao.by : undefined,
    geradoEm: geracao && typeof geracao.at === "string" ? String(geracao.at) : undefined,
    verificadoPor: ultimaVerificacao && typeof ultimaVerificacao.by === "string" ? String(ultimaVerificacao.by) : undefined,
    verificadoEm: ultimaVerificacao && typeof ultimaVerificacao.at === "string" ? String(ultimaVerificacao.at) : undefined,
  };

  const lacunas = extrairLacunas(corpo);
  const saidas = extrairWikilinks(conteudo);
  const saidasSet = new Set(saidas);

  // Varrer wiki para coletar backlinks e montar o grafo local
  const todosArquivos = await listarMarkdown(wiki);
  const backlinks: Backlink[] = [];
  const mapaDeMetadados = new Map<string, { titulo: string; tipo: string; caminho: string }>();
  mapaDeMetadados.set(slug, { titulo, tipo, caminho: caminhoRelativo });

  const mapaConexoes = new Map<string, Set<string>>();
  mapaConexoes.set(slug, saidasSet);

  for (const arq of todosArquivos) {
    if (arq === caminhoRelativo) continue;
    const s = basename(arq, ".md");
    try {
      const c = await readFile(join(wiki, arq), "utf8");
      let fm: Record<string, unknown> | null = null;
      try {
        fm = lerFrontmatter(c);
      } catch {
        /* ignora */
      }
      const t = fm && typeof fm.title === "string" ? fm.title.trim() : s;
      const tp = fm && typeof fm.type === "string" ? fm.type.trim() : "";
      mapaDeMetadados.set(s, { titulo: t, tipo: tp, caminho: arq });

      const linksDeste = extrairWikilinks(c);
      mapaConexoes.set(s, new Set(linksDeste));

      if (linksDeste.includes(slug)) {
        backlinks.push({
          caminho: arq,
          slug: s,
          titulo: t,
          tipo: tp,
          contexto: extrairContextoDeWikilink(c, slug),
        });
      }
    } catch {
      /* ignora erro de leitura */
    }
  }

  // Grafo local: nó atual + vizinhos diretos (saídas + entradas)
  const vizinhos = new Set<string>([slug]);
  for (const s of saidas) vizinhos.add(s);
  for (const b of backlinks) vizinhos.add(b.slug);

  const nos: NoDoGrafo[] = [];
  for (const id of vizinhos) {
    const meta = mapaDeMetadados.get(id);
    nos.push({
      id,
      rotulo: meta?.titulo ?? id,
      tipo: meta?.tipo ?? "",
      atual: id === slug,
    });
  }

  const arestas: ArestaDoGrafo[] = [];
  for (const de of vizinhos) {
    const conexoes = mapaConexoes.get(de);
    if (!conexoes) continue;
    for (const para of conexoes) {
      if (vizinhos.has(para)) {
        arestas.push({ de, para });
      }
    }
  }

  return {
    caminho: caminhoRelativo,
    titulo,
    slug,
    tipo,
    area,
    tags,
    status,
    statusMeta,
    aprovavel,
    versao,
    corpo,
    proveniencia,
    fontes: fontesBrutas,
    relacionados: Array.from(saidasSet),
    lacunas,
    backlinks,
    grafoLocal: {
      nos,
      arestas,
    },
  };
}
