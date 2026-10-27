import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { abrirMetricas } from "../busca/metricas";
import { criarNucleo } from "../busca/nucleo";
import type { RespostaBusca, Resultado, ResumoDaWiki, Trecho } from "../busca/tipos";
import { montarInstrucoes } from "./instrucoes";

export type ConfiguracaoServidor = { raiz: string; wiki: string; entrada?: Readable; saida?: Writable };
type Cliente = { nome: string; versao: string };
type BuscaAnterior = { caminho: string; linhaInicio: number; posicao: number; instante: number };

function mapaResultado(resultado: Resultado): Record<string, unknown> {
  return {
    caminho: resultado.caminho,
    linhas: `${resultado.linhaInicio}-${resultado.linhaFim}`,
    secao: resultado.secao,
    titulo: resultado.titulo,
    trecho: resultado.trecho.replaceAll("\x1e", "«").replaceAll("\x1f", "»"),
    estado: resultado.estado,
    ...(resultado.avisos.length ? { avisos: resultado.avisos } : {}),
    ...(resultado.vencida ? { vencida: true } : {}),
    score: resultado.score,
  };
}

function mapaLeitura(trecho: Trecho): Record<string, unknown> {
  return {
    caminho: trecho.caminho,
    linhas: `${trecho.linhaInicio}-${trecho.linhaFim}`,
    conteudo: trecho.conteudo,
    totalLinhas: trecho.totalLinhas,
    truncado: trecho.truncado,
    estado: trecho.estado,
    ...(trecho.avisos.length ? { avisos: trecho.avisos } : {}),
  };
}

function respostaMcp(valor: unknown, isError = false) {
  return { content: [{ type: "text" as const, text: JSON.stringify(valor) }], ...(isError ? { isError: true } : {}) };
}

function existeDiretorio(caminho: string): boolean {
  try { return existsSync(caminho) && statSync(caminho).isDirectory(); } catch { return false; }
}

export async function criarServidor(cfg: ConfiguracaoServidor): Promise<McpServer> {
  const raiz = resolve(cfg.raiz);
  const wiki = resolve(cfg.wiki);
  const diretorioDados = process.env.ANVILORE_DIR ? resolve(process.env.ANVILORE_DIR) : join(raiz, ".anvilore");
  const metricas = abrirMetricas(join(diretorioDados, "metricas.db"));
  const conexao = randomUUID();
  let cliente: Cliente | undefined;
  let posicaoLida: number | null = null;
  let ultimaBusca: BuscaAnterior[] = [];
  const nucleo = criarNucleo({
    raiz, wiki, arquivoDb: join(diretorioDados, "indice.db"), metricas,
    contextoMetricas: () => ({ cliente, conexao, posicaoLida }),
  });

  let resumo: ResumoDaWiki | null = null;
  if (existeDiretorio(wiki)) {
    await nucleo.indexar();
    resumo = await nucleo.resumoDaWiki();
  }
  const servidor = new McpServer({ name: "anvilore", version: "0.2.0" }, { instructions: montarInstrucoes(resumo) });
  servidor.server.oninitialized = () => {
    const info = servidor.server.getClientVersion();
    if (info) cliente = { nome: info.name, versao: info.version };
  };

  servidor.registerTool("buscar", {
    description: "Busca na wiki quando a pergunta tocar um assunto que ela pode cobrir. Devolve páginas, linhas e trechos; depois use ler.",
    inputSchema: {
      consulta: z.string().describe("Pergunta ou termos de busca."),
      limite: z.number().int().min(1).max(20).optional(),
      tipo: z.array(z.enum(["source", "concept", "entity"])).optional(),
      area: z.array(z.string()).optional(),
      incluir: z.array(z.enum(["log"])).optional(),
      explicar: z.boolean().optional(),
    },
  }, async ({ consulta, limite, tipo, area, incluir, explicar }) => {
    const opcoes = {
      ...(limite === undefined ? {} : { limite }),
      ...(tipo === undefined ? {} : { tipo }),
      ...(area === undefined ? {} : { area }),
      ...(incluir === undefined ? {} : { incluir }),
      ...(explicar === undefined ? {} : { explicar }),
    };
    const resultado = await nucleo.buscar(consulta, opcoes);
    if ("erro" in resultado) return respostaMcp(resultado, true);
    ultimaBusca = resultado.resultados.map((item, i) => ({ caminho: item.caminho.normalize("NFC"), linhaInicio: item.linhaInicio, posicao: i + 1, instante: Date.now() }));
    const resposta = resultado as RespostaBusca;
    return respostaMcp({ consulta: resposta.consulta, resultados: resposta.resultados.map(mapaResultado), vazia: resposta.vazia, indice: resposta.indice });
  });

  servidor.registerTool("ler", {
    description: "Lê uma página ou seção citada pela busca. Use o endereço e as linhas devolvidos por buscar.",
    inputSchema: {
      caminho: z.string().describe("Caminho relativo a wiki/ devolvido por buscar."),
      linha_inicio: z.number().int().positive().optional(),
      linha_fim: z.number().int().positive().optional(),
    },
  }, async ({ caminho, linha_inicio, linha_fim }) => {
    const agora = Date.now();
    ultimaBusca = ultimaBusca.filter((item) => agora - item.instante <= 10 * 60 * 1000);
    const caminhoNfc = caminho.replaceAll("\\", "/").normalize("NFC");
    const origem = ultimaBusca.find((item) => item.caminho === caminhoNfc && (linha_inicio === undefined || item.linhaInicio === linha_inicio));
    posicaoLida = origem?.posicao ?? null;
    const resultado = await nucleo.ler({ caminho, ...(linha_inicio === undefined ? {} : { linhaInicio: linha_inicio }), ...(linha_fim === undefined ? {} : { linhaFim: linha_fim }) });
    if ("erro" in resultado) return respostaMcp(resultado, true);
    return respostaMcp(mapaLeitura(resultado));
  });

  return servidor;
}

export async function iniciarServidor(cfg: ConfiguracaoServidor): Promise<void> {
  const servidor = await criarServidor(cfg);
  const transport = new StdioServerTransport(cfg.entrada ?? process.stdin, cfg.saida ?? process.stdout);
  await servidor.connect(transport);
}
