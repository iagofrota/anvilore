import type { Papel } from "./papeis-ingestao";

// A interface neutra entre a ingestão da interface e o agente que lê e escreve. O Claude Code é a
// primeira implementação (`ponte-claude-code.ts`); Codex e Gemini entram depois, com o mesmo contrato.
// Uma execução por fase: nenhum processo atravessa a parada humana.

export type EventoDoAgente =
  | { tipo: "inicio"; sessao: string; autor: string }
  | { tipo: "ferramenta"; id: string; nome: string; caminho?: string; padrao?: string }
  | { tipo: "resultado-ferramenta"; id: string; erro: boolean; texto: string }
  | { tipo: "texto"; texto: string };

export type Recusa = { ferramenta: string; id?: string; caminho?: string; motivo?: string };

export type FimDaFase =
  | { situacao: "concluida"; sessao?: string; saidaEstruturada?: unknown; texto: string; recusas: Recusa[] }
  | { situacao: "cancelada"; sessao?: string; recusas: Recusa[] }
  | { situacao: "falhou"; sessao?: string; erro: string; recusas: Recusa[] };

export type PedidoDeFase = {
  papel: Papel;
  mensagem: string;
  raiz: string;
  wiki: string;
  // O escritor continua a conversa do leitor: o que ele leu não é lido de novo.
  sessao?: string;
  rota?: "padrao" | "grande";
  // No ajuste de uma página, o escritor só pode editar este caminho relativo da wiki.
  pagina?: string;
};

export type Disponibilidade = { ok: true } | { ok: false; motivo: string };

export type ExecucaoDeFase = { cancelar(): void; fim: Promise<FimDaFase> };

export interface PonteDeAgente {
  readonly nome: string;
  disponibilidade(): Promise<Disponibilidade>;
  executar(pedido: PedidoDeFase, aoEvento: (evento: EventoDoAgente) => void): ExecucaoDeFase;
}
