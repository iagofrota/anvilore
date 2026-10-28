// Uma fonte e um relatório do leitor que passam no portão do conferir-leitura.
export const FONTE = [
  "# LLM Wiki",
  "",
  "## The core idea",
  "The wiki is a persistent, compounding artifact.",
  "",
  "## Architecture",
  "There are three layers.",
  "",
  "## Operations",
  "A single source might touch 10-15 wiki pages.",
  "Good answers can be filed back into the wiki as new pages.",
  "",
].join("\n");

export const SESSAO = "sessao-do-leitor";

export function relatorioValido(extra: Record<string, unknown> = {}) {
  return {
    versao: 1,
    fonte: "raw/pessoal/llm-wiki.md",
    takeaways: [
      { texto: "A wiki acumula.", citacao: { trecho: "The wiki is a persistent, compounding artifact.", secao: "The core idea" }, certeza: "comprovado" },
      { texto: "Três camadas.", citacao: { trecho: "There are three layers.", secao: "Architecture" }, certeza: "comprovado" },
      { texto: "Uma fonte toca muitas páginas.", citacao: { trecho: "A single source might touch 10-15 wiki pages.", secao: "Operations" }, certeza: "provavel" },
      { texto: "Respostas viram páginas.", citacao: { trecho: "Good answers can be filed back into the wiki as new pages.", secao: "Operations" }, certeza: "comprovado" },
    ],
    paginas: [
      { caminho: "pessoal/sources/llm-wiki.md", tipo: "source", acao: "criar", motivo: "A fonte." },
      { caminho: "pessoal/concepts/rag.md", tipo: "concept", acao: "criar", motivo: "Conceito central." },
      { caminho: "pessoal/concepts/segundo-cerebro.md", tipo: "concept", acao: "atualizar", motivo: "Reforça." },
    ],
    lacunas: ["Não diz como resolver contradições."],
    contradicoes: [],
    ...extra,
  };
}

