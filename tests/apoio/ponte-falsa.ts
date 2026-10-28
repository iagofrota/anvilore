import type { Papel } from "../../src/lib/papeis-ingestao";
import type { Disponibilidade, EventoDoAgente, FimDaFase, PedidoDeFase, PonteDeAgente } from "../../src/lib/ponte-agente";

// Ponte em memória para testar a orquestração sem processo: cada papel segue um roteiro.
export type Roteiro = (pedido: PedidoDeFase, aoEvento: (evento: EventoDoAgente) => void, cancelamento: Promise<void>) => Promise<FimDaFase>;

export class PonteFalsa implements PonteDeAgente {
  readonly nome = "Agente falso";
  pedidos: PedidoDeFase[] = [];
  consultas = 0;
  cancelamentos = 0;
  disponivel: Disponibilidade = { ok: true };
  constructor(public roteiros: Partial<Record<Papel, Roteiro>> = {}) {}
  async disponibilidade() { this.consultas++; return this.disponivel; }
  executar(pedido: PedidoDeFase, aoEvento: (evento: EventoDoAgente) => void) {
    this.pedidos.push(pedido);
    let avisar!: () => void;
    const cancelamento = new Promise<void>(resolver => { avisar = resolver; });
    const roteiro = this.roteiros[pedido.papel] ?? (async () => ({ situacao: "concluida", texto: "", recusas: [] }) as FimDaFase);
    return { cancelar: () => { this.cancelamentos++; avisar(); }, fim: roteiro(pedido, aoEvento, cancelamento) };
  }
}

