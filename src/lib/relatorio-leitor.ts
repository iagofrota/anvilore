import { resolve } from "node:path";
import { chaveDeNome, estaEmRaw, normalizarFimDeLinha } from "./caminhos";
import { nomeReservado } from "./reservados";
import { lerUtf8EstritoSync } from "./utf8";

// O esquema mora em skills/ingest/ e é o mesmo para a skill no terminal e para a
// interface (`claude -p --json-schema`). Este módulo só o interpreta: não há uma
// segunda definição dos campos em código. É lido no primeiro uso, não no import,
// para a CLI subir mesmo numa cópia só de src/.
export const CAMINHO_ESQUEMA_RELATORIO_LEITOR = resolve(import.meta.dir, "../../skills/ingest/relatorio-leitor.schema.json");
let esquemaCarregado: Record<string, any> | undefined;

export function esquemaRelatorioLeitor(): Record<string, any> {
  esquemaCarregado ??= JSON.parse(lerUtf8EstritoSync(CAMINHO_ESQUEMA_RELATORIO_LEITOR)) as Record<string, any>;
  return esquemaCarregado;
}

export type Certeza = "comprovado" | "provavel" | "inferencia";
export type TipoDePagina = "source" | "entity" | "concept";
export type Takeaway = { texto: string; citacao: { trecho: string; secao: string }; certeza: Certeza };
export type PaginaPlanejada = { caminho: string; tipo: TipoDePagina; acao: "criar" | "atualizar"; motivo: string };
export type RelatorioLeitor = {
  versao: 1;
  fonte: string;
  takeaways: Takeaway[];
  paginas: PaginaPlanejada[];
  lacunas: string[];
  contradicoes: Array<{ pagina: string; descricao: string }>;
};
export type Conferencia = { ok: boolean; erros: string[] };

type Esquema = Record<string, unknown>;

// Subconjunto do JSON Schema que o esquema usa. Palavra-chave fora daqui é erro, não
// silêncio: um `pattern` acrescentado ao arquivo e ignorado aqui seria uma checagem falsa.
const SUPORTADAS = new Set([
  "$schema", "$id", "title", "description", "type", "properties", "required",
  "additionalProperties", "items", "enum", "minItems", "maxItems", "minLength",
]);

const TIPOS: Record<string, { nome: string; casa: (valor: unknown) => boolean }> = {
  object: { nome: "objeto", casa: v => typeof v === "object" && v !== null && !Array.isArray(v) },
  array: { nome: "lista", casa: Array.isArray },
  string: { nome: "texto", casa: v => typeof v === "string" },
  integer: { nome: "inteiro", casa: Number.isInteger },
};

export function validarContraEsquema(regra: Esquema, valor: unknown, onde = "$"): string[] {
  for (const chave of Object.keys(regra)) {
    if (!SUPORTADAS.has(chave)) throw new Error(`palavra-chave não suportada: ${chave}`);
  }
  const tipo = regra.type as string;
  const esperado = TIPOS[tipo];
  if (!esperado) throw new Error(`tipo não suportado: ${tipo}`);
  if (!esperado.casa(valor)) return [`${onde}: esperado ${esperado.nome}`];

  const enumeracao = regra.enum as unknown[] | undefined;
  if (enumeracao && !enumeracao.includes(valor)) {
    return [`${onde}: valor fora da lista (${enumeracao.map(v => JSON.stringify(v)).join(", ")})`];
  }
  if (tipo === "string") {
    const minimo = regra.minLength as number | undefined;
    if (minimo !== undefined && (valor as string).length < minimo) {
      return [`${onde}: ${(valor as string).length === 0 ? "texto vazio" : `no mínimo ${minimo} caracteres`}`];
    }
    return [];
  }
  if (tipo === "array") return validarLista(regra, valor as unknown[], onde);
  if (tipo === "object") return validarObjeto(regra, valor as Record<string, unknown>, onde);
  return [];
}

function validarLista(regra: Esquema, lista: unknown[], onde: string): string[] {
  const minimo = regra.minItems as number | undefined;
  const maximo = regra.maxItems as number | undefined;
  if (minimo !== undefined && lista.length < minimo) return [`${onde}: no mínimo ${minimo} itens (veio ${lista.length})`];
  if (maximo !== undefined && lista.length > maximo) return [`${onde}: no máximo ${maximo} itens (veio ${lista.length})`];
  const itens = regra.items as Esquema | undefined;
  if (!itens) return [];
  return lista.flatMap((item, i) => validarContraEsquema(itens, item, `${onde}[${i}]`));
}

function validarObjeto(regra: Esquema, objeto: Record<string, unknown>, onde: string): string[] {
  const propriedades = (regra.properties ?? {}) as Record<string, Esquema>;
  const erros: string[] = [];
  for (const campo of (regra.required ?? []) as string[]) {
    if (!Object.hasOwn(objeto, campo)) erros.push(`${onde}: falta o campo ${campo}`);
  }
  if (regra.additionalProperties === false) {
    for (const campo of Object.keys(objeto)) {
      if (!Object.hasOwn(propriedades, campo)) erros.push(`${onde}: campo não previsto: ${campo}`);
    }
  }
  for (const [campo, sub] of Object.entries(propriedades)) {
    if (Object.hasOwn(objeto, campo)) erros.push(...validarContraEsquema(sub, objeto[campo], `${onde}.${campo}`));
  }
  return erros;
}

const DIRETORIO_DO_TIPO: Record<TipoDePagina, string> = { source: "sources", entity: "entities", concept: "concepts" };

function segmentosSeguros(caminho: string): string[] | undefined {
  if (caminho.includes("\\") || caminho.startsWith("/") || /^[A-Za-z]:/.test(caminho)) return undefined;
  const segmentos = caminho.split("/");
  if (segmentos.some(s => s === "" || s === "." || s === "..")) return undefined;
  return segmentos;
}

function erroDaFonte(fonte: string): string | undefined {
  const segmentos = segmentosSeguros(fonte);
  if (segmentos && segmentos[0] === "raw" && segmentos.length > 1) return undefined;
  return `$.fonte: a fonte tem de estar em raw/ (veio ${fonte})`;
}

function erroDaPagina(pagina: PaginaPlanejada, onde: string): string | undefined {
  const { caminho, tipo } = pagina;
  const segmentos = segmentosSeguros(caminho);
  if (!segmentos || !caminho.endsWith(".md") || estaEmRaw(caminho)) {
    return `${onde}: caminho relativo à wiki, terminado em .md, fora de raw/ e sem .. (veio ${caminho})`;
  }
  if (segmentos.length !== 2 && segmentos.length !== 3) {
    return `${onde}: use <área>/<tipo>/<slug>.md ou <tipo>/<slug>.md (veio ${caminho})`;
  }
  if (segmentos.some(nomeReservado)) return `${onde}: diretório reservado, não é página (veio ${caminho})`;
  const diretorio = DIRETORIO_DO_TIPO[tipo];
  if (segmentos[segmentos.length - 2] !== diretorio) {
    return `${onde}: página do tipo ${tipo} mora em ${diretorio}/ (veio ${caminho})`;
  }
  return undefined;
}

function regrasExtras(relatorio: RelatorioLeitor): string[] {
  const erros: string[] = [];
  const daFonte = erroDaFonte(relatorio.fonte);
  if (daFonte) erros.push(daFonte);
  const vistos = new Set<string>();
  relatorio.paginas.forEach((pagina, i) => {
    const onde = `$.paginas[${i}].caminho`;
    const erro = erroDaPagina(pagina, onde);
    if (erro) return erros.push(erro);
    const chave = chaveDeNome(pagina.caminho);
    if (vistos.has(chave)) return erros.push(`${onde}: página repetida (${pagina.caminho})`);
    vistos.add(chave);
  });
  const fontes = relatorio.paginas.filter(p => p.tipo === "source").length;
  if (fontes !== 1) erros.push(`$.paginas: exatamente uma página do tipo source (veio ${fontes})`);
  return erros;
}

export function validarRelatorioLeitor(valor: unknown): Conferencia {
  const doEsquema = validarContraEsquema(esquemaRelatorioLeitor(), valor);
  // Regra extra sobre dado fora do esquema só gera ruído (ou exceção): para no esquema.
  const erros = doEsquema.length ? doEsquema : regrasExtras(valor as RelatorioLeitor);
  return { ok: erros.length === 0, erros };
}

function normalizarTexto(texto: string): string {
  return normalizarFimDeLinha(texto).normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

// O portão da wiki-wonka (citacao-check): o trecho citado tem de existir na fonte.
// Prova que o trecho existe, não que o takeaway decorre dele; essa leitura é da pessoa.
export function conferirCitacoes(relatorio: RelatorioLeitor, textoFonte: string): string[] {
  const fonte = normalizarTexto(textoFonte);
  return relatorio.takeaways.flatMap((takeaway, i) => {
    const trecho = normalizarTexto(takeaway.citacao.trecho);
    if (trecho && fonte.includes(trecho)) return [];
    return [`$.takeaways[${i}].citacao.trecho: não aparece na fonte (${JSON.stringify(takeaway.citacao.trecho)})`];
  });
}

// `existe` recebe o caminho relativo à wiki: quem chama decide onde a wiki mora (caminhoWiki).
export function conferirPaginas(relatorio: RelatorioLeitor, existe: (caminho: string) => boolean): string[] {
  return relatorio.paginas.flatMap((pagina, i) => {
    const ha = existe(pagina.caminho);
    if (pagina.acao === "criar" && ha) return [`$.paginas[${i}].acao: ${pagina.caminho} já existe; use atualizar`];
    if (pagina.acao === "atualizar" && !ha) return [`$.paginas[${i}].acao: ${pagina.caminho} não existe; use criar`];
    return [];
  });
}

export function conferirLeitura(
  valor: unknown,
  // `textoFonte` ausente: a fonte não tem texto que a ferramenta saiba ler (PDF, imagem). As citações ficam para a pessoa.
  contexto: { textoFonte: string | undefined; existe: (caminho: string) => boolean },
): Conferencia {
  const doEsquema = validarRelatorioLeitor(valor);
  if (!doEsquema.ok) return doEsquema;
  const relatorio = valor as RelatorioLeitor;
  const citacoes = contexto.textoFonte === undefined ? [] : conferirCitacoes(relatorio, contexto.textoFonte);
  const erros = [...citacoes, ...conferirPaginas(relatorio, contexto.existe)];
  return { ok: erros.length === 0, erros };
}

// No terminal o leitor responde em texto: JSON puro ou um bloco ```json. Vale o último bloco.
export function extrairJson(resposta: string): unknown {
  const blocos = [...resposta.matchAll(/```json\s*\n([\s\S]*?)\n```/g)].map(m => m[1]!);
  const candidato = blocos.length ? blocos[blocos.length - 1]! : resposta.trim();
  try {
    return JSON.parse(candidato);
  } catch (erro) {
    throw new Error(`a resposta do leitor não é JSON: ${(erro as Error).message}`, { cause: erro });
  }
}
