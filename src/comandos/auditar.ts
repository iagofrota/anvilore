import { readFile, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { parseArgs } from "node:util";
import { ESPACO_PYTHON, apararPython, caminhoPathlib, dataLocal, linkQuebrado, linhasPython, paginasMarkdown } from "../lib/paginas";
import { nomeReservado } from "../lib/reservados";

export type ResultadoAuditoria = { achados: string[]; codigo: 0 | 1 | 2; relatorio: string; erro?: string };

type Pagina = { caminho: string; slug: string; frontmatter: string[] | null; campos: Map<string, string>; linhasDeCorpo: number; alvos: string[] };

const NAVEGACAO = new Set(["index.md", "log.md"]);
const MIN_LINHAS_DE_CORPO = 3;
const CAMPOS_COMUNS = ["title", "slug", "type", "tags"];
const CAMPOS_POR_TIPO: Record<string, string[]> = {
  source: ["original_file", "date_ingested", "authors"],
  concept: ["related_sources", "related_concepts"],
  entity: ["related_sources", "related_concepts"],
};

const WIKILINK = /\[\[([^\]\n]+)\]\]/g;
const CAMPO = new RegExp(`^([A-Za-z_][A-Za-z0-9_]*)[${ESPACO_PYTHON}]*:`);

function alvosDe(texto: string): string[] {
  const alvos: string[] = [];
  for (const [, bruto] of texto.matchAll(WIKILINK)) {
    const alvo = apararPython(bruto!.split("|")[0]!.split("#")[0]!);
    if (alvo) alvos.push(alvo);
  }
  return alvos;
}

// Sem `---` na primeira linha, ou sem o fechamento, não há contrato a conferir.
function separarFrontmatter(linhas: string[]): { frontmatter: string[] | null; corpo: string[] } {
  if (linhas.length === 0 || apararPython(linhas[0]!) !== "---") return { frontmatter: null, corpo: linhas };
  for (let i = 1; i < linhas.length; i++) {
    if (apararPython(linhas[i]!) === "---") return { frontmatter: linhas.slice(1, i), corpo: linhas.slice(i + 1) };
  }
  return { frontmatter: null, corpo: linhas };
}

function camposDeclarados(frontmatter: string[]): Map<string, string> {
  const campos = new Map<string, string>();
  for (const linha of frontmatter) {
    const casou = CAMPO.exec(linha);
    if (casou && !campos.has(casou[1]!)) campos.set(casou[1]!, apararPython(linha.slice(linha.indexOf(":") + 1)));
  }
  return campos;
}

// O relatório mostra os caminhos com "/" em qualquer sistema, a forma do índice e dos links: o legado em Python só rodava onde "/" era o
// separador. Só a barra invertida do Windows é trocada; no POSIX ela é parte legítima do nome do arquivo.
function paraBarras(caminho: string, separador: string): string {
  return separador === "\\" ? caminho.replaceAll("\\", "/") : caminho;
}

export function exibirCaminho(base: string, rel: string, separador: string = sep): string {
  const b = paraBarras(base, separador);
  const r = paraBarras(rel, separador);
  if (r === "") return b;
  return b === "." ? r : b.endsWith("/") ? b + r : `${b}/${r}`;
}

function unir(base: string, rel: string): string {
  return exibirCaminho(base, rel);
}

async function lerPagina(wiki: string, exibida: string, caminho: string): Promise<Pagina> {
  // O Python abria em modo texto: \r\n e \r solitário viram \n antes de tudo.
  const texto = (await readFile(caminho, "utf8")).replace(/\r\n?/g, "\n");
  const { frontmatter, corpo } = separarFrontmatter(linhasPython(texto));
  const nome = basename(caminho);
  return {
    caminho: unir(exibida, relative(wiki, caminho)),
    slug: nome.length > 3 ? nome.slice(0, -3) : nome,
    frontmatter,
    campos: frontmatter === null ? new Map() : camposDeclarados(frontmatter),
    linhasDeCorpo: corpo.filter((linha) => apararPython(linha) !== "").length,
    alvos: alvosDe(texto),
  };
}

// O aviso de link quebrado já saiu na varredura das páginas, que passa por index.md.
async function lerIndice(caminho: string): Promise<string> {
  try {
    if (!(await stat(caminho)).isFile()) return "";
  } catch (erro) {
    if (!linkQuebrado(erro)) throw erro;
    return "";
  }
  return (await readFile(caminho, "utf8")).replace(/\r\n?/g, "\n");
}

function camposAusentes(pagina: Pagina): string[] {
  const exigidos = [...CAMPOS_COMUNS, ...(CAMPOS_POR_TIPO[pagina.campos.get("type") ?? ""] ?? [])];
  return exigidos.filter((campo) => !pagina.campos.has(campo));
}

export async function auditarWiki(wiki: string, hoje: string = dataLocal()): Promise<ResultadoAuditoria> {
  const exibida = exibirCaminho(caminhoPathlib(wiki), "");
  if (!(await stat(wiki).catch(() => null))?.isDirectory()) {
    return { achados: [], codigo: 2, relatorio: "", erro: `erro: wiki não encontrada: ${exibida}` };
  }

  const paginas: Pagina[] = [];
  for (const caminho of await paginasMarkdown(wiki, nomeReservado)) {
    if (!NAVEGACAO.has(basename(caminho))) paginas.push(await lerPagina(wiki, exibida, caminho));
  }
  const slugs = new Set(paginas.map((p) => p.slug));

  const indice = unir(exibida, "index.md");
  const alvosDoIndice = alvosDe(await lerIndice(join(wiki, "index.md")));
  const indexados = new Set(alvosDoIndice);

  // O índice fica de fora de propósito: página só alcançável por ele é a definição de órfã.
  const entradas = new Map<string, number>();
  for (const pagina of paginas) {
    for (const alvo of new Set(pagina.alvos)) {
      if (alvo !== pagina.slug) entradas.set(alvo, (entradas.get(alvo) ?? 0) + 1);
    }
  }

  const orfas = paginas
    .filter((p) => indexados.has(p.slug) && (entradas.get(p.slug) ?? 0) === 0)
    .map((p) => `- ${p.caminho} — listada no índice, sem wikilink de nenhuma outra página`);

  const ausentesDoIndice = paginas
    .filter((p) => !indexados.has(p.slug))
    .map((p) => `- ${p.caminho} — não aparece em ${indice}`);

  const quebrados: string[] = [];
  const origens: [string, string][] = paginas.flatMap((p) => p.alvos.map((alvo): [string, string] => [p.caminho, alvo]));
  origens.push(...alvosDoIndice.map((alvo): [string, string] => [indice, alvo]));
  for (const [origem, alvo] of origens) {
    const linha = `- ${origem} → [[${alvo}]] não corresponde a nenhuma página`;
    if (!slugs.has(alvo) && !quebrados.includes(linha)) quebrados.push(linha);
  }

  const incompletos: string[] = [];
  for (const pagina of paginas) {
    if (pagina.frontmatter === null) {
      incompletos.push(`- ${pagina.caminho} — sem frontmatter`);
      continue;
    }
    const faltando = camposAusentes(pagina);
    if (faltando.length > 0) {
      incompletos.push(`- ${pagina.caminho} — ${faltando.length === 1 ? "campo ausente" : "campos ausentes"}: ${faltando.join(", ")}`);
    }
  }

  const esbocos = paginas
    .filter((p) => p.frontmatter !== null && p.linhasDeCorpo < MIN_LINHAS_DE_CORPO)
    .map((p) => `- ${p.caminho} — ${p.linhasDeCorpo} linha(s) de corpo (mínimo ${MIN_LINHAS_DE_CORPO})`);

  const secoes: [string, string[]][] = [
    ["Páginas órfãs", orfas],
    ["Entradas ausentes do índice", ausentesDoIndice],
    ["Wikilinks quebrados", quebrados],
    ["Frontmatter incompleto", incompletos],
    ["Páginas vazias ou esboço", esbocos],
  ];
  const achados = secoes.flatMap(([, itens]) => itens);
  const saida = [`# Auditoria estrutural de ${exibida} — ${hoje}`, ""];
  for (const [titulo, itens] of secoes) {
    saida.push(`## ${titulo} (${itens.length})`, "", ...(itens.length > 0 ? itens : ["_nenhum._"]), "");
  }
  saida.push(
    `Total: ${achados.length} achado(s) estrutural(is).`,
    "A dívida declarada (`[!gap]`, `[!contradiction]`) tem outro dono: `bun src/cli.ts listar-lacunas <wiki> --consultar`.",
  );
  return { achados, codigo: achados.length > 0 ? 1 : 0, relatorio: saida.join("\n") + "\n" };
}

const USO = "Uso: anvilore auditar [WIKI]";

export async function comandoAuditar(args: string[]): Promise<number> {
  let wiki: string;
  try {
    const { positionals, values } = parseArgs({ args, allowPositionals: true, options: { help: { type: "boolean", short: "h" } } });
    if (values.help || positionals.length > 1) {
      console.error(USO);
      return 2;
    }
    wiki = positionals[0] ?? "wiki";
  } catch (erro) {
    console.error((erro as Error).message);
    return 2;
  }

  try {
    const { codigo, relatorio, erro } = await auditarWiki(wiki);
    if (erro !== undefined) console.error(erro);
    else console.log(relatorio.trimEnd());
    return codigo;
  } catch (erro) {
    console.error(erro instanceof Error ? erro.message : String(erro));
    return 2;
  }
}

// Obra derivada de wiki-wonka (https://github.com/cooperacode/wiki-wonka),
// Coopera Code, licença MIT. Aviso de copyright original em LICENSE.
