import type { Aviso } from "./secoes";
import type { Estado } from "./estado";
import type { RelatorioIndexacao } from "./indice";
import type { RelatorioMetricas, RegistroDeMetricas } from "./metricas";

export type { Aviso, Estado };
export type Endereco = { caminho: string; linhaInicio: number; linhaFim: number };
export type Explicacao = { bm25: number; autoridade: number; colunas: string[]; termos: string[] };
export type Resultado = Endereco & {
  pagina: string; titulo: string; secao: string; trecho: string; estado: Estado; vencida: boolean; avisos: Aviso[];
  tipo?: "source" | "concept" | "entity"; area?: string; score: number; explicacao?: Explicacao;
};
export type OpcoesBusca = { limite?: number; tipo?: Array<"source" | "concept" | "entity">; area?: string[]; incluir?: Array<"log">; explicar?: boolean };
export type RespostaBusca = { consulta: string; resultados: Resultado[]; vazia: boolean; indice: { paginas: number; secoes: number; reindexadas: number } };
export type Trecho = Endereco & { conteudo: string; totalLinhas: number; truncado: boolean; estado: Estado; avisos: Aviso[] };
export type ResumoDaWiki = { paginas: number; secoes: number; porEstado: Record<Estado, number>; areas: Array<{ area: string; paginas: number }>; titulos: string[] };
export type CodigoErro = "wiki_ausente" | "indice_corrompido" | "fora_da_wiki" | "arquivo_inexistente" | "linha_fora_do_arquivo";
export type ErroDeBusca = { codigo: CodigoErro; mensagem: string };
export type ResultadoOuErro<T> = T | { erro: ErroDeBusca };

export interface NucleoDeBusca {
  buscar(consulta: string, opcoes?: OpcoesBusca): Promise<ResultadoOuErro<RespostaBusca>>;
  ler(endereco: Partial<Endereco> & { caminho: string }): Promise<ResultadoOuErro<Trecho>>;
  indexar(opcoes?: { completo?: boolean }): Promise<RelatorioIndexacao>;
  resumoDaWiki(): Promise<ResumoDaWiki>;
  metricas(): Promise<RelatorioMetricas>;
}
