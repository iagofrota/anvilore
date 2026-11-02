import type { Conversa, Fechamento } from "../../src/lib/ui-ingestao";

export type EstadoDoPasso = "feito" | "atual" | "falta" | "parou";
export type PassoDoPainel = { rotulo: string; dica: string; estado: EstadoDoPasso };

const PASSOS: Array<[string, string]> = [
  ["Fonte em raw/", "você adicionou o arquivo"],
  ["Leitura", "o agente só lê"],
  ["Takeaways", "você aprova o que entra"],
  ["Plano de páginas", "você aprova o que muda"],
  ["Escrita", "só na wiki, como rascunho"],
  ["Índice, log e validação", "anvilore fechar"],
  ["Sua revisão", "aprovar na Revisão"],
];

const PASSOS_AJUSTE: Array<[string, string]> = [
  ["Pedido de ajuste", "você pediu a alteração"],
  ["Escrita", "só nesta página, como rascunho"],
  ["Índice, log e validação", "anvilore fechar"],
  ["Sua revisão", "aprovar na Revisão"],
];

// A parada é uma só: Takeaways e Plano de páginas ficam ativos juntos.
const ATUAIS: Record<Conversa["passo"], number[]> = {
  fonte: [1], leitura: [1], parada: [2, 3], escrita: [4], fechamento: [5], revisao: [6],
};

const ATUAIS_AJUSTE: Record<Conversa["passo"], number[]> = {
  fonte: [0], leitura: [0], parada: [0], escrita: [1], fechamento: [2], revisao: [3],
};

export function passosDoPainel(conversa: Pick<Conversa, "passo" | "situacao" | "tipo"> | undefined): PassoDoPainel[] {
  const passosLista = conversa?.tipo === "ajuste" ? PASSOS_AJUSTE : PASSOS;
  const atuaisMapa = conversa?.tipo === "ajuste" ? ATUAIS_AJUSTE : ATUAIS;
  let atuais = conversa ? atuaisMapa[conversa.passo] : [0];
  const parou = conversa !== undefined && ["erro", "cancelada", "interrompida"].includes(conversa.situacao);
  // Na revisão, o erro é do fechamento.
  if (parou && conversa.passo === "revisao") atuais = [conversa?.tipo === "ajuste" ? 2 : 5];
  const primeiro = atuais[0]!;
  return passosLista.map(([rotulo, dica], i) => ({
    rotulo, dica,
    estado: atuais.includes(i) ? (parou ? "parou" : "atual") : i < primeiro ? "feito" : "falta",
  }));
}

function listaNatural(itens: string[]): string {
  return itens.length < 2 ? itens.join("") : `${itens.slice(0, -1).join(", ")} e ${itens.at(-1)}`;
}

export function textoDeSeguir(takeaways: boolean[], paginas: boolean[]): string {
  const fora = takeaways.flatMap((marcado, i) => marcado ? [] : [String(i + 1)]);
  const paginasFora = paginas.filter(marcada => !marcada).length;
  const partes = [
    ...(fora.length ? [fora.length === 1 ? `o takeaway ${fora[0]}` : `os takeaways ${listaNatural(fora)}`] : []),
    ...(paginasFora ? [`${paginasFora} ${paginasFora === 1 ? "página" : "páginas"} do plano`] : []),
  ];
  return partes.length ? `Pode seguir. Deixe de fora ${partes.join(", e ")}.` : "Pode seguir.";
}

export function avisoDoFechamento(fechamento: Fechamento): { tipo: "rascunhos" | "ok" | "erro"; texto: string } {
  if (fechamento.soRascunhos) {
    const n = fechamento.rascunhos;
    return { tipo: "rascunhos", texto: n === 1 ? "1 rascunho espera você" : `${n} rascunhos esperam você` };
  }
  if (fechamento.codigo === 0) return { tipo: "ok", texto: "A validação passou" };
  return { tipo: "erro", texto: "O fechamento encontrou problemas" };
}

export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const formatar = (valor: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(valor);
  if (bytes < 1024 * 1024) return `${formatar(bytes / 1024)} KB`;
  return `${formatar(bytes / 1024 / 1024)} MB`;
}

export function podeLerDeNovo(conversa: Pick<Conversa, "passo" | "situacao">): boolean {
  return conversa.passo === "fonte" || (conversa.passo === "leitura" && conversa.situacao !== "rodando");
}
