import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { conferirLeitura, extrairJson, validarRelatorioLeitor, type RelatorioLeitor } from "../lib/relatorio-leitor";
import { lerUtf8Estrito } from "../lib/utf8";
import { caminhoWiki } from "../lib/wiki-repo";

export type ResultadoConferencia = { codigo: number; mensagens: string[] };

const USO = "Uso: anvilore conferir-leitura <arquivo>\n  Confere o relatório do leitor (JSON puro ou resposta com bloco ```json) contra o esquema, a fonte e a wiki.";

function falha(mensagens: string[]): ResultadoConferencia {
  return { codigo: 1, mensagens: mensagens.map(m => `FAIL: ${m}`) };
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

// O portão entre o leitor e a parada humana. Quem roda é a ferramenta (a sessão do agente
// ou a interface), nunca a pessoa: o relatório de um subagente não é prova.
export async function conferirArquivoDeLeitura(
  raiz: string,
  arquivo: string,
  ambiente: Record<string, string | undefined> = process.env,
): Promise<ResultadoConferencia> {
  let valor: unknown;
  try {
    const texto = await readFile(resolve(raiz, arquivo), "utf8");
    valor = extrairJson(texto);
  } catch (erro) {
    const mensagem = (erro as NodeJS.ErrnoException).code ? `não foi possível ler ${arquivo}: ${(erro as Error).message}` : (erro as Error).message;
    return falha([mensagem]);
  }
  const doEsquema = validarRelatorioLeitor(valor);
  if (!doEsquema.ok) return falha(doEsquema.erros);

  const relatorio = valor as RelatorioLeitor;
  let textoFonte: string;
  try {
    textoFonte = await lerUtf8Estrito(resolve(raiz, relatorio.fonte));
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === "ENOENT") return falha([`fonte não encontrada: ${relatorio.fonte}`]);
    return falha([(erro as Error).message]);
  }
  const wiki = caminhoWiki(raiz, ambiente);
  const resultado = conferirLeitura(relatorio, { textoFonte, existe: caminho => existsSync(join(wiki, caminho)) });
  if (!resultado.ok) return falha(resultado.erros);

  const criar = relatorio.paginas.filter(p => p.acao === "criar").length;
  return {
    codigo: 0,
    mensagens: [
      `OK: leitura conferida — ${plural(relatorio.takeaways.length, "takeaway", "takeaways")}, ` +
      `${plural(relatorio.paginas.length, "página", "páginas")} (${criar} a criar, ${relatorio.paginas.length - criar} a atualizar), ` +
      `${plural(relatorio.lacunas.length, "lacuna", "lacunas")}, ${plural(relatorio.contradicoes.length, "contradição", "contradições")}.`,
    ],
  };
}

export async function comandoConferirLeitura(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USO);
    return 0;
  }
  if (args.length !== 1) {
    console.log(USO);
    return 2;
  }
  const raiz = process.env.ANVILORE_DESTINO ?? process.cwd();
  const resultado = await conferirArquivoDeLeitura(raiz, args[0]!, process.env);
  for (const mensagem of resultado.mensagens) console.log(mensagem);
  return resultado.codigo;
}
