import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { auditarWiki } from "../comandos/auditar";
import { listarLacunas } from "../comandos/listar-lacunas";
import { validarWiki } from "../comandos/validar";
import { lerFrontmatter } from "./frontmatter";
import { paginasMarkdown } from "./paginas";
import { listarFilaRascunhos } from "./ui-fila";
import { caminhoWiki } from "./wiki-repo";

// Os dados da tela Início, sem HTTP. Tudo aqui só lê: nada escreve na wiki nem em raw/.

export type EntradaDeAtividade = { data: string; tipo: string; resumo: string; arquivo: string };
export type FonteSemIngestao = { caminho: string; area: string; bytes: number; conversa?: string };
export type ResumoDeRascunhos = {
  total: number; novas: number; atualizadas: number; comErro: number;
  itens: { caminho: string; titulo: string; tipo: string; status: "nova" | "atualizada" | "erro" }[];
};
export type ResumoDoInicio = { rascunhos: ResumoDeRascunhos; atividade: EntradaDeAtividade[]; fontes: FonteSemIngestao[] };
export type SaudeDaWiki = {
  validar: { ok: boolean; semAprovacao: number; outrosErros: string[]; avisos: string[]; paginas: number };
  vencidas: number;
  lacunas: { total: number; contradicoes: number; abertas: string[] };
  auditoria: { total: number; resumo: string[]; erro?: string };
};

const ARQUIVO_DO_DIA = /^log-\d{4}-\d{2}-\d{2}\.md$/;
const CABECALHO = /^## \[(\d{4}-\d{2}-\d{2})\] ([^|]+?) *\| *(.+?)\s*$/;
const SEM_APROVACAO = "página gerada sem aprovação humana:";
const LIMITE_DE_RASCUNHOS = 5;
const LIMITE_DE_LACUNAS = 5;
const LIMITE_DA_AUDITORIA = 5;

function entradasDoDia(texto: string, arquivo: string): EntradaDeAtividade[] {
  const entradas: EntradaDeAtividade[] = [];
  let emCerca = false;
  for (const linha of texto.split(/\r?\n/)) {
    if (linha.startsWith("```")) { emCerca = !emCerca; continue; }
    if (emCerca) continue;
    const casou = CABECALHO.exec(linha);
    if (casou) entradas.push({ data: casou[1]!, tipo: casou[2]!, resumo: casou[3]!, arquivo });
  }
  return entradas;
}

// Do log mais novo para o mais antigo; dentro do dia, a última entrada vem primeiro.
export async function atividadeRecente(wiki: string, limite = 8): Promise<EntradaDeAtividade[]> {
  let nomes: string[];
  try { nomes = (await readdir(join(wiki, "log"))).filter(nome => ARQUIVO_DO_DIA.test(nome)).sort().reverse(); }
  catch (erro) { if ((erro as NodeJS.ErrnoException).code === "ENOENT") return []; throw erro; }
  const entradas: EntradaDeAtividade[] = [];
  for (const nome of nomes) {
    let texto: string;
    try { texto = await readFile(join(wiki, "log", nome), "utf8"); } catch { continue; }
    entradas.push(...entradasDoDia(texto, `log/${nome}`).reverse());
    if (entradas.length >= limite) break;
  }
  return entradas.slice(0, limite);
}

function normalizarFonte(valor: string): string {
  return valor.trim().replaceAll("\\", "/").replace(/^(\.\/)+/, "");
}

async function fontesCitadas(wiki: string): Promise<Set<string>> {
  const citadas = new Set<string>();
  for (const pagina of await paginasMarkdown(wiki)) {
    let frontmatter: Record<string, unknown> | null;
    try { frontmatter = lerFrontmatter(await readFile(pagina, "utf8")); } catch { continue; }
    if (!frontmatter) continue;
    if (typeof frontmatter.original_file === "string") citadas.add(normalizarFonte(frontmatter.original_file));
    if (Array.isArray(frontmatter.sources)) {
      for (const fonte of frontmatter.sources) {
        const recurso = (fonte as { resource?: unknown } | null)?.resource;
        if (typeof recurso === "string") citadas.add(normalizarFonte(recurso));
      }
    }
  }
  return citadas;
}

async function arquivosDeRaw(raw: string, prefixo = ""): Promise<{ caminho: string; bytes: number }[]> {
  let entradas;
  try { entradas = await readdir(join(raw, prefixo), { withFileTypes: true }); }
  catch (erro) { if ((erro as NodeJS.ErrnoException).code === "ENOENT") return []; throw erro; }
  const achados: { caminho: string; bytes: number }[] = [];
  for (const entrada of entradas.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entrada.name.startsWith(".")) continue;
    const relativo = prefixo ? `${prefixo}/${entrada.name}` : entrada.name;
    // Link simbólico não é seguido: raw/ é a evidência da pessoa e a lista não pode sair dela.
    if (entrada.isDirectory()) achados.push(...await arquivosDeRaw(raw, relativo));
    else if (entrada.isFile()) achados.push({ caminho: relativo, bytes: (await lstat(join(raw, relativo))).size });
  }
  return achados;
}

// "Sem ingestão" = nenhuma página da wiki cita o arquivo em `sources[].resource` nem em `original_file`.
// `conversas` liga a fonte à conversa de ingestão ainda aberta, para a tela oferecer "Continuar".
export async function fontesSemIngestao(raiz: string, wiki: string, conversas: ReadonlyMap<string, string> = new Map()): Promise<FonteSemIngestao[]> {
  const citadas = await fontesCitadas(wiki);
  const itens: FonteSemIngestao[] = [];
  for (const { caminho, bytes } of await arquivosDeRaw(join(raiz, "raw"))) {
    const completo = `raw/${caminho}`;
    if (citadas.has(completo)) continue;
    const partes = caminho.split("/");
    const conversa = conversas.get(completo);
    itens.push({ caminho: completo, area: partes.length > 1 ? partes[0]! : "", bytes, ...(conversa ? { conversa } : {}) });
  }
  return itens;
}

// Roda os mesmos comandos do terminal (`validar`, `auditar`, `listar-lacunas --consultar`) dentro do servidor.
// Nenhum deles escreve; falha de um não derruba os outros.
export async function saudeDaWiki(wiki: string): Promise<SaudeDaWiki> {
  const validacao = await validarWiki(wiki).catch((erro: Error) => ({ ok: false, erros: [erro.message], avisos: [], paginas: 0, gaps: 0, contradicoes: 0, vencidas: 0, geradasAposVerificacao: 0 }));
  const semAprovacao = validacao.erros.filter(erro => erro.startsWith(SEM_APROVACAO));

  let auditoria: SaudeDaWiki["auditoria"];
  try {
    const resultado = await auditarWiki(wiki);
    auditoria = resultado.erro !== undefined
      ? { total: 0, resumo: [], erro: resultado.erro }
      : { total: resultado.achados.length, resumo: resultado.achados.slice(0, LIMITE_DA_AUDITORIA) };
  } catch (erro) { auditoria = { total: 0, resumo: [], erro: erro instanceof Error ? erro.message : String(erro) }; }

  let abertas: string[] = [];
  try { abertas = await listarLacunas(wiki, { consultar: true }); }
  catch { /* página ilegível: `validar` já a aponta; a contagem de lacunas fica vazia */ }

  return {
    validar: { ok: validacao.ok, semAprovacao: semAprovacao.length, outrosErros: validacao.erros.filter(erro => !erro.startsWith(SEM_APROVACAO)), avisos: validacao.avisos, paginas: validacao.paginas },
    vencidas: validacao.vencidas,
    lacunas: { total: abertas.length, contradicoes: abertas.filter(linha => linha.includes(" [contradiction] ")).length, abertas: abertas.slice(0, LIMITE_DE_LACUNAS) },
    auditoria,
  };
}

// O que a tela mostra de imediato. A saúde fica de fora de propósito: é a parte lenta e a tela a pede à parte.
export async function resumoDoInicio(raiz: string, conversasAbertas: ReadonlyMap<string, string> = new Map(), ambiente: Record<string, string | undefined> = process.env): Promise<ResumoDoInicio> {
  const wiki = caminhoWiki(raiz, ambiente);
  const fila = await listarFilaRascunhos(raiz, ambiente);
  return {
    rascunhos: {
      total: fila.length,
      novas: fila.filter(item => item.status === "nova").length,
      atualizadas: fila.filter(item => item.status === "atualizada").length,
      comErro: fila.filter(item => item.status === "erro").length,
      itens: fila.slice(0, LIMITE_DE_RASCUNHOS).map(({ caminho, titulo, tipo, status }) => ({ caminho, titulo, tipo, status })),
    },
    atividade: await atividadeRecente(wiki),
    fontes: await fontesSemIngestao(raiz, wiki, conversasAbertas),
  };
}
