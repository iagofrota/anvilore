import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { valorDoPath } from "../comandos/instalar";
import { FERRAMENTAS, MODELO_GRANDE } from "./papeis-ingestao";
import type { Disponibilidade, EventoDoAgente, ExecucaoDeFase, FimDaFase, PedidoDeFase, PonteDeAgente, Recusa } from "./ponte-agente";
import { esquemaRelatorioLeitor } from "./relatorio-leitor";

// A ponte com o Claude Code: `claude -p` com stream JSON, uma execução por fase, usando o login que a
// pessoa já fez (nada de chave de API). O que cada flag faz e por que está aqui foi provado num vault
// temporário (prova da ponte, 27/10, Claude Code 2.1.311):
// - `--setting-sources project,local`: o settings.json da pessoa liberava Write fora da wiki (G1). Os
//   hooks do projeto continuam valendo; `--strict-mcp-config` não sobe os MCP da pessoa a cada fase.
// - `--tools` por papel remove as ferramentas; `--allowedTools` + `dontAsk` nega o resto.
// - `--system-prompt-snapshot off`: sem ele, o `--resume` reusa o prompt do leitor no escritor.
// - stdin ignorado (G3: sem isso o `claude -p` espera 3 s por dados).
// - Cancelar é SIGINT: o turno parcial fica salvo e o `result` vem com `terminal_reason:
//   "aborted_streaming"` e código 0. SIGTERM perde o turno; só depois do prazo, como último recurso.

const fonteDoKit = resolve(import.meta.dir, "../..");
const NAO_ENCONTRADO = "O Claude Code não foi encontrado neste computador. Instale e entre nele para ingerir pela interface.";
const SEM_LOGIN = "O Claude Code está instalado, mas sem login. Entre no Claude Code e tente de novo.";
const SEM_RESPOSTA = "O Claude Code não respondeu à consulta de login. Tente de novo.";

type Objeto = Record<string, unknown>;
type ResultadoBruto = Objeto;

function ehObjeto(valor: unknown): valor is Objeto {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function texto(valor: unknown): string | undefined {
  return typeof valor === "string" && valor !== "" ? valor : undefined;
}

function segmentoDeAtor(valor: unknown, permitido: RegExp): string | undefined {
  if (typeof valor !== "string") return undefined;
  return valor.toLowerCase().replace(permitido, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || undefined;
}

// `generated.by` segue a convenção de atores do validador: <agente>/<versão>.
function autorDoInit(linha: Objeto): string {
  const modelo = segmentoDeAtor(linha.model, /[^a-z0-9_-]/g) ?? "claude-code";
  const versao = segmentoDeAtor(linha.claude_code_version, /[^a-z0-9._-]/g) ?? "desconhecida";
  return `${modelo}/${versao}`;
}

function conteudoDeResultado(valor: unknown): string {
  if (typeof valor === "string") return valor;
  if (!Array.isArray(valor)) return "";
  return valor.flatMap(bloco => ehObjeto(bloco) && bloco.type === "text" && typeof bloco.text === "string" ? [bloco.text] : []).join("\n");
}

function blocos(linha: Objeto): Objeto[] {
  const mensagem = linha.message;
  if (!ehObjeto(mensagem) || !Array.isArray(mensagem.content)) return [];
  return mensagem.content.filter(ehObjeto);
}

// Despacha por `type`, nunca pela posição: hooks vêm antes do `init` e `rate_limit_event` aparece no meio.
// O que a tela não usa (hooks, status, limites, deltas) é ignorado.
export function interpretarLinha(bruta: string): { eventos: EventoDoAgente[]; resultado?: ResultadoBruto } {
  let linha: unknown;
  try { linha = JSON.parse(bruta); } catch { return { eventos: [] }; }
  if (!ehObjeto(linha)) return { eventos: [] };
  if (linha.type === "result") return { eventos: [], resultado: linha };
  if (linha.type === "system" && linha.subtype === "init") {
    return { eventos: [{ tipo: "inicio", sessao: String(linha.session_id ?? ""), autor: autorDoInit(linha) }] };
  }
  const eventos: EventoDoAgente[] = [];
  if (linha.type === "assistant") {
    for (const bloco of blocos(linha)) {
      if (bloco.type === "text" && texto(bloco.text)) eventos.push({ tipo: "texto", texto: bloco.text as string });
      if (bloco.type === "tool_use") {
        const entrada = ehObjeto(bloco.input) ? bloco.input : {};
        const caminho = texto(entrada.file_path) ?? texto(entrada.path);
        const padrao = texto(entrada.pattern);
        eventos.push({ tipo: "ferramenta", id: String(bloco.id ?? ""), nome: String(bloco.name ?? ""), ...(caminho ? { caminho } : {}), ...(padrao ? { padrao } : {}) });
      }
    }
  }
  if (linha.type === "user") {
    for (const bloco of blocos(linha)) {
      if (bloco.type === "tool_result") eventos.push({ tipo: "resultado-ferramenta", id: String(bloco.tool_use_id ?? ""), erro: bloco.is_error === true, texto: conteudoDeResultado(bloco.content) });
    }
  }
  return { eventos };
}

// A regra de caminho absoluto do Claude Code: duas barras seguidas do caminho sem a barra inicial.
// `Edit` vale para Edit e Write (provado); `Read` vale para Read, Grep e Glob (não provado com o
// claude real). No Windows a forma `//C:/…` não foi provada.
function regraDeCaminho(ferramenta: "Edit" | "Read", caminhoAbsoluto: string): string {
  const normalizado = caminhoAbsoluto.replaceAll("\\", "/").replace(/\/+$/, "").replace(/^\/+/, "");
  return `${ferramenta}(//${normalizado}/**)`;
}

export function regraDeEdicao(caminhoAbsoluto: string): string {
  return regraDeCaminho("Edit", caminhoAbsoluto);
}

// Leitura só no vault e na wiki (que pode morar fora dele): uma fonte com instrução escondida não leva o
// agente a ler, por exemplo, as chaves da pessoa e copiá-las para a wiki.
export function regrasDeLeitura(raiz: string, wiki: string): string[] {
  const relativo = relative(resolve(raiz), resolve(wiki));
  const dentro = relativo !== ".." && !relativo.startsWith(`..${sep}`) && !isAbsolute(relativo);
  return [regraDeCaminho("Read", raiz), ...(dentro ? [] : [regraDeCaminho("Read", wiki)])];
}

// O `--json-schema` do claude recusa o esquema que declara `"$schema"` draft 2020-12 ("not a valid JSON Schema",
// prova com o claude real em 2026-10-28). `$schema` e `$id` são só metadados: o arquivo do kit continua com eles.
function esquemaParaOClaude(): Record<string, unknown> {
  const { $schema: _versao, $id: _id, ...regras } = esquemaRelatorioLeitor();
  return regras;
}

export function argumentosDoPapel(pedido: PedidoDeFase): string[] {
  const { papel } = pedido;
  if (papel === "escritor" && !pedido.sessao) throw new Error("o escritor precisa da sessão do leitor");
  const leitura = regrasDeLeitura(pedido.raiz, pedido.wiki);
  const permitidas = papel === "leitor" ? leitura : [...leitura, regraDeEdicao(pedido.wiki)];
  return [
    "-p", pedido.mensagem,
    "--output-format", "stream-json",
    "--verbose",
    "--setting-sources", "project,local",
    "--strict-mcp-config",
    "--permission-mode", "dontAsk",
    "--system-prompt-snapshot", "off",
    "--append-system-prompt-file", join(fonteDoKit, "skills/ingest", `${papel}.md`),
    "--tools", FERRAMENTAS[papel].join(","),
    "--allowedTools", ...permitidas,
    ...(papel === "escritor" ? ["--disallowedTools", regraDeEdicao(join(pedido.raiz, "raw")), "Bash"] : []),
    ...(papel === "leitor" ? ["--json-schema", JSON.stringify(esquemaParaOClaude())] : []),
    ...(pedido.rota === "grande" ? ["--model", MODELO_GRANDE] : []),
    ...(pedido.sessao ? ["--resume", pedido.sessao] : []),
  ];
}

function recusasDoResultado(resultado: ResultadoBruto | undefined): Recusa[] {
  const negadas = resultado?.permission_denials;
  if (!Array.isArray(negadas)) return [];
  return negadas.filter(ehObjeto).map(negada => {
    const entrada = ehObjeto(negada.tool_input) ? negada.tool_input : {};
    const caminho = texto(entrada.file_path);
    const id = texto(negada.tool_use_id);
    return { ferramenta: texto(negada.tool_name) ?? "?", ...(id ? { id } : {}), ...(caminho ? { caminho } : {}) };
  });
}

export type OpcoesPonteClaudeCode = {
  // Prefixo do comando; sem ele, o `claude` do PATH do ambiente.
  comando?: string[];
  ambiente?: Record<string, string | undefined>;
  prazoDoSinalMs?: number;
  prazoDaConsultaMs?: number;
};

export class PonteClaudeCode implements PonteDeAgente {
  readonly nome = "Claude Code";
  private readonly ambiente: Record<string, string | undefined>;

  constructor(private readonly opcoes: OpcoesPonteClaudeCode = {}) {
    this.ambiente = opcoes.ambiente ?? process.env;
  }

  private comando(): string[] | undefined {
    if (this.opcoes.comando) return this.opcoes.comando;
    const achado = Bun.which("claude", { PATH: valorDoPath(this.ambiente) ?? "" });
    return achado ? [achado] : undefined;
  }

  async disponibilidade(): Promise<Disponibilidade> {
    const comando = this.comando();
    if (!comando) return { ok: false, motivo: NAO_ENCONTRADO };
    let processo: ReturnType<typeof Bun.spawn>;
    try {
      processo = Bun.spawn([...comando, "auth", "status", "--json"], { env: this.ambiente, stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    } catch { return { ok: false, motivo: NAO_ENCONTRADO }; }
    let expirou = false;
    const prazo = setTimeout(() => { expirou = true; processo.kill("SIGKILL"); }, this.opcoes.prazoDaConsultaMs ?? 15_000);
    const saida = await new Response(processo.stdout as ReadableStream).text();
    await processo.exited;
    clearTimeout(prazo);
    if (expirou) return { ok: false, motivo: SEM_RESPOSTA };
    try {
      const estado = JSON.parse(saida) as unknown;
      // Só `loggedIn` é lido: e-mail e organização da conta nunca vão para a tela.
      if (ehObjeto(estado) && estado.loggedIn === true) return { ok: true };
    } catch { /* saída que não é JSON: tratada como sem login */ }
    return { ok: false, motivo: SEM_LOGIN };
  }

  executar(pedido: PedidoDeFase, aoEvento: (evento: EventoDoAgente) => void): ExecucaoDeFase {
    let cancelado = false;
    let processo: ReturnType<typeof Bun.spawn> | undefined;
    let prazo: ReturnType<typeof setTimeout> | undefined;
    const cancelar = () => {
      if (cancelado) return;
      cancelado = true;
      if (!processo) return;
      processo.kill("SIGINT");
      prazo = setTimeout(() => processo!.kill("SIGKILL"), this.opcoes.prazoDoSinalMs ?? 10_000);
    };
    const fim = (async (): Promise<FimDaFase> => {
      const comando = this.comando();
      if (!comando) return { situacao: "falhou", erro: NAO_ENCONTRADO, recusas: [] };
      const ambiente: Record<string, string | undefined> = { ...this.ambiente, ANVILORE_WIKI: pedido.wiki };
      if (pedido.papel === "escritor") ambiente.ANVILORE_SEM_AUTOCOMMIT = "1";
      else delete ambiente.ANVILORE_SEM_AUTOCOMMIT;
      try {
        processo = Bun.spawn([...comando, ...argumentosDoPapel(pedido)], { cwd: pedido.raiz, env: ambiente, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      } catch (erro) {
        return { situacao: "falhou", erro: `Não foi possível iniciar o Claude Code: ${(erro as Error).message}`, recusas: [] };
      }
      let sessao: string | undefined;
      let resultado: ResultadoBruto | undefined;
      const tratar = (linha: string) => {
        const lida = interpretarLinha(linha);
        if (lida.resultado) resultado = lida.resultado;
        for (const evento of lida.eventos) {
          if (evento.tipo === "inicio") sessao = evento.sessao;
          aoEvento(evento);
        }
      };
      const erroPadrao = new Response(processo.stderr as ReadableStream).text();
      const decodificador = new TextDecoder();
      let pendente = "";
      for await (const pedaco of processo.stdout as ReadableStream<Uint8Array>) {
        pendente += decodificador.decode(pedaco, { stream: true });
        let quebra: number;
        while ((quebra = pendente.indexOf("\n")) >= 0) {
          tratar(pendente.slice(0, quebra));
          pendente = pendente.slice(quebra + 1);
        }
      }
      pendente += decodificador.decode();
      if (pendente.trim()) tratar(pendente);
      const codigo = await processo.exited;
      const stderr = (await erroPadrao).trim().slice(-500);
      if (prazo) clearTimeout(prazo);

      const sessaoFinal = texto(resultado?.session_id) ?? sessao;
      const comSessao = sessaoFinal ? { sessao: sessaoFinal } : {};
      const recusas = recusasDoResultado(resultado);
      if (!resultado) {
        if (cancelado) return { situacao: "cancelada", ...comSessao, recusas };
        return { situacao: "falhou", ...comSessao, erro: stderr ? `O Claude Code saiu com código ${codigo}: ${stderr}` : `O Claude Code saiu com código ${codigo} sem resultado.`, recusas };
      }
      if (resultado.terminal_reason === "aborted_streaming" || (cancelado && resultado.is_error === true)) return { situacao: "cancelada", ...comSessao, recusas };
      if (resultado.is_error === true) {
        return { situacao: "falhou", ...comSessao, erro: texto(resultado.result) ?? `O agente terminou com erro (${String(resultado.subtype)}).`, recusas };
      }
      return { situacao: "concluida", ...comSessao, saidaEstruturada: resultado.structured_output, texto: typeof resultado.result === "string" ? resultado.result : "", recusas };
    })();
    return { cancelar, fim };
  }
}
