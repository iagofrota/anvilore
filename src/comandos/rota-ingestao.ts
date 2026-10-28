import { stat } from "node:fs/promises";
import { LIMITE_DIVIDIR_BYTES, nomeDoAgente, rotaDaIngestao } from "../lib/papeis-ingestao";

export type ResultadoRota = { codigo: number; mensagens: string[] };

const USO = "Uso: anvilore rota-ingestao <fonte>\n  Diz, pelo tamanho da fonte, quais agentes a ingestão usa: padrao, grande ou dividir (sai 3).";

// A escolha é por conta, não por prosa de skill: quem despacha roda isto e usa o que sai.
export async function rotaDoArquivo(fonte: string): Promise<ResultadoRota> {
  let bytes: number;
  try {
    bytes = (await stat(fonte)).size;
  } catch (erro) {
    return { codigo: 2, mensagens: [`fonte inexistente: ${fonte} (${(erro as Error).message})`] };
  }
  const rota = rotaDaIngestao(bytes);
  if (rota === "dividir") {
    return {
      codigo: 3,
      mensagens: [`dividir: ${bytes} bytes; acima de ${LIMITE_DIVIDIR_BYTES} bytes a fonte não cabe nem na janela grande. Combine com a pessoa como dividir.`],
    };
  }
  const agentes = `agentes ${nomeDoAgente("leitor", rota)} e ${nomeDoAgente("escritor", rota)}`;
  const nota = rota === "grande" ? " (janela de contexto grande; a ingestão custa mais: avise a pessoa)" : "";
  return { codigo: 0, mensagens: [`${rota}: ${bytes} bytes; ${agentes}${nota}.`] };
}

export async function comandoRotaIngestao(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USO);
    return 0;
  }
  if (args.length !== 1) {
    console.log(USO);
    return 2;
  }
  const resultado = await rotaDoArquivo(args[0]!);
  for (const mensagem of resultado.mensagens) console.log(mensagem);
  return resultado.codigo;
}
