import { resolve, join } from "node:path";
import { abrirMetricas } from "../busca/metricas";

export async function executarMetricas(
  args: string[],
  opcoes: { arquivoDb?: string; stdout?: (texto: string) => void; stderr?: (texto: string) => void; ligado?: boolean } = {},
): Promise<number> {
  let desde: Date | undefined; let json = false; let limpar = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") json = true;
    else if (arg === "--limpar") limpar = true;
    else if (arg === "--desde") {
      const texto = args[++i];
      const data = texto && /^\d{4}-\d{2}-\d{2}$/.test(texto) ? new Date(`${texto}T00:00:00`) : null;
      if (!data || Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== texto) {
        (opcoes.stderr ?? console.error)("FAIL: --desde exige uma data AAAA-MM-DD válida"); return 1;
      }
      desde = data;
    } else {
      (opcoes.stderr ?? console.error)(`FAIL: argumento desconhecido: ${arg}`); return 1;
    }
  }
  const diretorio = process.env.ANVILORE_DIR ? resolve(process.env.ANVILORE_DIR) : resolve(".anvilore");
  const registro = abrirMetricas(opcoes.arquivoDb ?? join(diretorio, "metricas.db"), opcoes.ligado);
  if (limpar) registro.limpar();
  const relatorio = registro.resumo(desde);
  const saida = opcoes.stdout ?? console.log;
  if (json) saida(JSON.stringify(relatorio, null, 2));
  else saida([
    `Métricas locais: ${relatorio.totalChamadas} chamadas`,
    `Uso: ${relatorio.uso.buscas} buscas, ${relatorio.uso.leituras} leituras, ${relatorio.uso.indexacoes} indexações`,
    `Acerto: ${relatorio.acerto.percentualSeguidasDeLer}% das buscas seguidas de leitura`,
    `Lacuna: ${relatorio.lacuna.percentualBuscasVazias}% de buscas vazias`,
    `Confiança: ${relatorio.confianca.percentualPorEstado.verificada}% verificadas, ${relatorio.confianca.percentualPorEstado.manual}% manuais, ${relatorio.confianca.percentualPorEstado.rascunho}% rascunhos, ${relatorio.confianca.percentualVencidas}% vencidas`,
    `Avisos: ${relatorio.confianca.lacunas} lacunas, ${relatorio.confianca.contradicoes} contradições`,
    `Custo de busca: ${relatorio.custo.buscar.bytesMedios} bytes médios, p95 ${relatorio.custo.buscar.p95Ms} ms`,
    "\nJSON:", JSON.stringify(relatorio, null, 2),
  ].join("\n"));
  return 0;
}

export async function comandoMetricas(args: string[]): Promise<number> { return executarMetricas(args); }
