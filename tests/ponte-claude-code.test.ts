import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import type { EventoDoAgente } from "../src/lib/ponte-agente";
import { argumentosDoPapel, interpretarLinha, PonteClaudeCode, regraDeEdicao, regrasDeLeitura } from "../src/lib/ponte-claude-code";
import { esquemaRelatorioLeitor } from "../src/lib/relatorio-leitor";
import type { RoteiroDoFalso } from "./apoio/claude-falso";
import { antesDoInit, init, limite, resultado, resultadoDeFerramenta, SESSAO, textoDoAssistente, usoDeFerramenta } from "./apoio/eventos-claude";

const FALSO = resolve(import.meta.dir, "apoio/claude-falso.ts");
const KIT = resolve(import.meta.dir, "..");

let tmp: string;
let raiz: string;
let wiki: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "anvilore-ponte-"));
  raiz = join(tmp, "vault");
  wiki = join(raiz, "wiki");
  mkdirSync(wiki, { recursive: true });
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

function ponteCom(roteiro: RoteiroDoFalso, extra: { prazoDoSinalMs?: number } = {}) {
  const arquivoRoteiro = join(tmp, "roteiro.json");
  writeFileSync(arquivoRoteiro, JSON.stringify(roteiro));
  const registro = join(tmp, "registro.jsonl");
  const ponte = new PonteClaudeCode({
    comando: [process.execPath, FALSO],
    ambiente: { ...process.env, CLAUDE_FALSO_ROTEIRO: arquivoRoteiro, CLAUDE_FALSO_REGISTRO: registro, ANVILORE_WIKI: "/não/é/esta", ANVILORE_SEM_AUTOCOMMIT: "0" },
    ...extra,
  });
  const execucoes = () => existsSync(registro) ? readFileSync(registro, "utf8").trim().split("\n").map(linha => JSON.parse(linha) as { argv: string[]; cwd: string; stdin: string; ANVILORE_WIKI?: string; ANVILORE_SEM_AUTOCOMMIT?: string }) : [];
  return { ponte, execucoes };
}

function esperarArquivo(caminho: string): Promise<void> {
  if (existsSync(caminho)) return Promise.resolve();
  return new Promise(resolveEspera => {
    const watcher = watch(dirname(caminho), (_evento, nome) => {
      if ((!nome || nome.toString() === caminho.split(/[\\/]/).at(-1)) && existsSync(caminho)) {
        watcher.close();
        resolveEspera();
      }
    });
    if (existsSync(caminho)) { watcher.close(); resolveEspera(); }
  });
}

// Os itens de uma flag de lista vão separados, como na prova da ponte, até a próxima flag.
function listaApos(args: string[], flag: string): string[] {
  const inicio = args.indexOf(flag) + 1;
  const fim = args.findIndex((arg, i) => i >= inicio && arg.startsWith("--"));
  return args.slice(inicio, fim < 0 ? undefined : fim);
}

const relatorio = { versao: 1, fonte: "raw/pessoal/nota.md", takeaways: [], paginas: [], lacunas: [], contradicoes: [] };

// ── Interpretação do stream ────────────────────────────────────────────────

test("Dado eventos de hook e de limite antes e depois do init Quando interpreto o stream Então despacho por type e só o init vira evento", () => {
  for (const linha of [...antesDoInit(), limite(), { type: "system", subtype: "status" }, { type: "stream_event" }]) {
    expect(interpretarLinha(JSON.stringify(linha))).toEqual({ eventos: [] });
  }
  expect(interpretarLinha(JSON.stringify(init()))).toEqual({ eventos: [{ tipo: "inicio", sessao: SESSAO, autor: "claude-haiku-4-5/2.1.311" }] });
});

test("Dado init sem modelo nem versão Quando interpreto Então o autor ainda casa a convenção de atores", () => {
  const { eventos } = interpretarLinha(JSON.stringify({ type: "system", subtype: "init", session_id: "s", model: "Opus 5[1m]" }));
  expect(eventos).toEqual([{ tipo: "inicio", sessao: "s", autor: "opus-5-1m/desconhecida" }]);
  expect(interpretarLinha(JSON.stringify({ type: "system", subtype: "init", session_id: "s" })).eventos).toEqual([{ tipo: "inicio", sessao: "s", autor: "claude-code/desconhecida" }]);
});

test("Dado linha que não é JSON ou não é objeto Quando interpreto Então ignoro sem lançar", () => {
  expect(interpretarLinha("isto não é json")).toEqual({ eventos: [] });
  expect(interpretarLinha("")).toEqual({ eventos: [] });
  expect(interpretarLinha("[1,2]")).toEqual({ eventos: [] });
  expect(interpretarLinha("null")).toEqual({ eventos: [] });
});

test("Dado mensagem do assistente com texto e uso de ferramenta Quando interpreto Então saem texto e ferramenta com o caminho", () => {
  const { eventos } = interpretarLinha(JSON.stringify(usoDeFerramenta("t1", "Read", { file_path: "/v/raw/a.md" }, "Vou ler.")));
  expect(eventos).toEqual([{ tipo: "texto", texto: "Vou ler." }, { tipo: "ferramenta", id: "t1", nome: "Read", caminho: "/v/raw/a.md" }]);
  expect(interpretarLinha(JSON.stringify(usoDeFerramenta("t2", "Grep", { pattern: "abacaxi", path: "/v/wiki" }))).eventos)
    .toEqual([{ tipo: "ferramenta", id: "t2", nome: "Grep", caminho: "/v/wiki", padrao: "abacaxi" }]);
  expect(interpretarLinha(JSON.stringify(usoDeFerramenta("t3", "Glob", { pattern: "**/*.md" }))).eventos)
    .toEqual([{ tipo: "ferramenta", id: "t3", nome: "Glob", padrao: "**/*.md" }]);
});

test("Dado resultado de ferramenta em texto ou em blocos Quando interpreto Então sai o texto e se foi erro", () => {
  expect(interpretarLinha(JSON.stringify(resultadoDeFerramenta("t1", "Bloqueado: raw/ é imutável", true))).eventos)
    .toEqual([{ tipo: "resultado-ferramenta", id: "t1", erro: true, texto: "Bloqueado: raw/ é imutável" }]);
  const blocos = { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", content: [{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }] }] } };
  expect(interpretarLinha(JSON.stringify(blocos)).eventos).toEqual([{ tipo: "resultado-ferramenta", id: "t2", erro: false, texto: "a\nb" }]);
  expect(interpretarLinha(JSON.stringify({ type: "user", message: { content: "texto solto" } })).eventos).toEqual([]);
  expect(interpretarLinha(JSON.stringify({ type: "assistant", message: {} })).eventos).toEqual([]);
});

test("Dado o result final Quando interpreto Então devolvo o resultado bruto", () => {
  const linha = resultado({ structured_output: relatorio });
  expect(interpretarLinha(JSON.stringify(linha)).resultado).toMatchObject({ structured_output: relatorio, session_id: SESSAO });
});

// ── Argumentos por papel ───────────────────────────────────────────────────

test("Dado wiki absoluta Quando monto a regra de edição Então são duas barras e o caminho sem a barra inicial", () => {
  expect(regraDeEdicao("/tmp/v/wiki")).toBe("Edit(//tmp/v/wiki/**)");
  expect(regraDeEdicao("/tmp/v/wiki/")).toBe("Edit(//tmp/v/wiki/**)");
  expect(regraDeEdicao("C:\\Users\\ana\\wiki")).toBe("Edit(//C:/Users/ana/wiki/**)");
});

test("Dado wiki dentro ou fora do vault Quando monto as regras de leitura Então a leitura fica no vault e na wiki", () => {
  expect(regrasDeLeitura("/v", "/v/wiki")).toEqual(["Read(//v/**)"]);
  expect(regrasDeLeitura("/v", "/v-irma/wiki")).toEqual(["Read(//v/**)", "Read(//v-irma/wiki/**)"]);
});

test("Dado o papel leitor Quando monto os argumentos Então isola as configurações da pessoa, só lê e pede o esquema", () => {
  const args = argumentosDoPapel({ papel: "leitor", mensagem: "Leia.", raiz: "/v", wiki: "/v/wiki" });
  expect(args.slice(0, 2)).toEqual(["-p", "Leia."]);
  const valor = (flag: string) => args[args.indexOf(flag) + 1];
  expect(valor("--output-format")).toBe("stream-json");
  expect(args).toContain("--verbose");
  expect(valor("--setting-sources")).toBe("project,local");
  expect(args).toContain("--strict-mcp-config");
  expect(valor("--tools")).toBe("Read,Grep,Glob");
  expect(listaApos(args, "--allowedTools")).toEqual(["Read(//v/**)"]);
  expect(valor("--permission-mode")).toBe("dontAsk");
  expect(valor("--system-prompt-snapshot")).toBe("off");
  expect(valor("--append-system-prompt-file")).toBe(join(KIT, "skills/ingest/leitor.md"));
  // O claude recusa o esquema com "$schema" draft 2020-12 (prova com o claude real, 28/10): vai sem $schema e $id.
  const { $schema, $id, ...semMetadados } = esquemaRelatorioLeitor();
  expect($schema).toBe("https://json-schema.org/draft/2020-12/schema");
  expect($id).toBe("anvilore/relatorio-leitor/v1");
  const enviado = JSON.parse(valor("--json-schema")!);
  expect(enviado).toEqual(semMetadados);
  expect(enviado).not.toHaveProperty("$schema");
  expect(enviado).not.toHaveProperty("$id");
  expect(args).not.toContain("--resume");
  expect(args.join(" ")).not.toMatch(/Edit|Write|Bash/);
});

test("Dado o papel escritor Quando monto os argumentos Então retoma a sessão, edita só a wiki e nega raw/", () => {
  const args = argumentosDoPapel({ papel: "escritor", mensagem: "Escreva.", raiz: "/v", wiki: "/fora/wiki", sessao: SESSAO });
  const valor = (flag: string) => args[args.indexOf(flag) + 1];
  expect(args.slice(0, 2)).toEqual(["-p", "Escreva."]);
  expect(valor("--resume")).toBe(SESSAO);
  expect(valor("--tools")).toBe("Read,Grep,Glob,Edit,Write");
  expect(listaApos(args, "--allowedTools")).toEqual(["Read(//v/**)", "Read(//fora/wiki/**)", "Edit(//fora/wiki/**)"]);
  expect(listaApos(args, "--disallowedTools")).toEqual(["Edit(//v/raw/**)", "Bash"]);
  expect(valor("--append-system-prompt-file")).toBe(join(KIT, "skills/ingest/escritor.md"));
  expect(valor("--system-prompt-snapshot")).toBe("off");
  expect(args).not.toContain("--json-schema");
  expect(args).not.toContain("--model");
});

test("Dado o escritor sem sessão do leitor Quando monto os argumentos Então recuso", () => {
  expect(() => argumentosDoPapel({ papel: "escritor", mensagem: "x", raiz: "/v", wiki: "/v/wiki" })).toThrow("sessão do leitor");
});

test("Dado fonte na rota grande Quando monto os argumentos Então peço o modelo de janela grande", () => {
  const args = argumentosDoPapel({ papel: "leitor", mensagem: "x", raiz: "/v", wiki: "/v/wiki", rota: "grande" });
  expect(args[args.indexOf("--model") + 1]).toBe("sonnet[1m]");
});

// ── Processo filho ─────────────────────────────────────────────────────────

test("Dado o leitor no claude falso Quando a fase roda Então o filho tem stdin vazio, cwd na raiz e ANVILORE_WIKI, e a saída estruturada volta", async () => {
  const { ponte, execucoes } = ponteCom({ leitor: [
    ...antesDoInit().map(linha => ({ linha })),
    { linha: init() },
    { linha: limite() },
    { linha: usoDeFerramenta("t1", "Read", { file_path: join(raiz, "raw/pessoal/nota.md") }) },
    { linha: resultadoDeFerramenta("t1", "conteúdo") },
    { linha: usoDeFerramenta("t2", "StructuredOutput", relatorio) },
    { linha: resultado({ structured_output: relatorio, result: JSON.stringify(relatorio) }) },
  ] });
  const eventos: EventoDoAgente[] = [];
  const execucao = ponte.executar({ papel: "leitor", mensagem: "Leia.", raiz, wiki }, evento => eventos.push(evento));
  const fim = await execucao.fim;
  expect(fim).toEqual({ situacao: "concluida", sessao: SESSAO, saidaEstruturada: relatorio, texto: JSON.stringify(relatorio), recusas: [] });
  expect(eventos.map(e => e.tipo)).toEqual(["inicio", "ferramenta", "resultado-ferramenta", "ferramenta"]);
  const [registro] = execucoes();
  expect(registro!.stdin).toBe("");
  expect(realpathSync(registro!.cwd)).toBe(realpathSync(raiz));
  expect(registro!.ANVILORE_WIKI).toBe(wiki);
  expect(registro!.ANVILORE_SEM_AUTOCOMMIT).toBeUndefined();
  expect(registro!.argv.slice(0, 2)).toEqual(["-p", "Leia."]);
});

test("Dado o escritor no claude falso Quando a fase roda Então o commit automático fica desligado e as recusas voltam", async () => {
  const { ponte, execucoes } = ponteCom({ escritor: [
    { linha: init() },
    { linha: usoDeFerramenta("w1", "Write", { file_path: join(raiz, "raw/x.md") }) },
    { linha: resultadoDeFerramenta("w1", "PreToolUse:Write hook error: Bloqueado: raw/ é imutável", true) },
    { linha: resultado({ permission_denials: [{ tool_name: "Write", tool_use_id: "w1", tool_input: { file_path: join(raiz, "raw/x.md") } }, { tool_name: "Bash" }] }) },
  ] });
  const fim = await ponte.executar({ papel: "escritor", mensagem: "Escreva.", raiz, wiki, sessao: SESSAO }, () => {}).fim;
  expect(fim).toEqual({ situacao: "concluida", sessao: SESSAO, saidaEstruturada: undefined, texto: "pronto", recusas: [{ ferramenta: "Write", id: "w1", caminho: join(raiz, "raw/x.md") }, { ferramenta: "Bash" }] });
  const [registro] = execucoes();
  expect(registro!.ANVILORE_SEM_AUTOCOMMIT).toBe("1");
  expect(registro!.ANVILORE_WIKI).toBe(wiki);
  expect(registro!.argv).toContain("--resume");
});

test("Dado o result com erro que não é cancelamento Quando a fase termina Então falha com o texto do agente", async () => {
  const { ponte } = ponteCom({ leitor: [{ linha: init() }, { linha: resultado({ subtype: "error_max_turns", is_error: true, result: "Not logged in · Please run /login" }) }] });
  expect(await ponte.executar({ papel: "leitor", mensagem: "x", raiz, wiki }, () => {}).fim)
    .toEqual({ situacao: "falhou", sessao: SESSAO, erro: "Not logged in · Please run /login", recusas: [] });
  const { ponte: semTexto } = ponteCom({ leitor: [{ linha: resultado({ subtype: "error_during_execution", is_error: true, result: null }) }] });
  expect(await semTexto.executar({ papel: "leitor", mensagem: "x", raiz, wiki }, () => {}).fim)
    .toMatchObject({ situacao: "falhou", erro: "O agente terminou com erro (error_during_execution)." });
});

test("Dado o filho que sai sem result Quando a fase termina Então falha com o stderr e o código", async () => {
  const { ponte } = ponteCom({ leitor: [{ linha: init() }, { stderr: "error: unknown option '--system-prompt-snapshot'\n" }, { sair: 1 }] });
  expect(await ponte.executar({ papel: "leitor", mensagem: "x", raiz, wiki }, () => {}).fim)
    .toEqual({ situacao: "falhou", sessao: SESSAO, erro: "O Claude Code saiu com código 1: error: unknown option '--system-prompt-snapshot'", recusas: [] });
  const { ponte: mudo } = ponteCom({ leitor: [{ sair: 0 }] });
  expect(await mudo.executar({ papel: "leitor", mensagem: "x", raiz, wiki }, () => {}).fim)
    .toEqual({ situacao: "falhou", erro: "O Claude Code saiu com código 0 sem resultado.", recusas: [] });
});

test("Dado o agente rodando Quando cancelo Então o filho recebe SIGINT e o fim é cancelado pelo terminal_reason", async () => {
  const { ponte } = ponteCom({ leitor: [{ linha: init() }, { esperarSinal: { sessao: SESSAO } }] });
  const execucao = ponte.executar({ papel: "leitor", mensagem: "x", raiz, wiki }, evento => { if (evento.tipo === "inicio") execucao.cancelar(); });
  expect(await execucao.fim).toEqual({ situacao: "cancelada", sessao: SESSAO, recusas: [] });
});

test("Dado o claude falso esperando um arquivo Quando libero a barreira Então a execução continua sem espera por tempo", async () => {
  const liberar = join(tmp, "barreiras", "liberar");
  const pronto = join(tmp, "barreiras", "pronto");
  mkdirSync(dirname(pronto), { recursive: true });
  const { ponte } = ponteCom({ leitor: [
    { esperarArquivo: { caminho: liberar, pronto, sessao: SESSAO } },
    { linha: resultado({ structured_output: relatorio }) },
  ] });
  const execucao = ponte.executar({ papel: "leitor", mensagem: "x", raiz, wiki }, () => {});
  await esperarArquivo(pronto);
  writeFileSync(liberar, "continuar\n");
  expect(await execucao.fim).toMatchObject({ situacao: "concluida", saidaEstruturada: relatorio });
});

test("Dado o filho que ignora o SIGINT Quando cancelo e o prazo passa Então ele é encerrado e o fim é cancelado", async () => {
  const { ponte } = ponteCom({ leitor: [{ linha: init() }, { esperarSinal: { sessao: SESSAO, ignorar: true } }] }, { prazoDoSinalMs: 300 });
  const execucao = ponte.executar({ papel: "leitor", mensagem: "x", raiz, wiki }, evento => { if (evento.tipo === "inicio") { execucao.cancelar(); execucao.cancelar(); } });
  expect(await execucao.fim).toEqual({ situacao: "cancelada", sessao: SESSAO, recusas: [] });
});

test("Dado comando que não existe Quando a fase roda Então falha sem lançar", async () => {
  const ponte = new PonteClaudeCode({ comando: [join(tmp, "nao-existe")], ambiente: {} });
  expect(await ponte.executar({ papel: "leitor", mensagem: "x", raiz, wiki }, () => {}).fim).toMatchObject({ situacao: "falhou" });
});

// ── Disponibilidade (cenário 1b-11) ────────────────────────────────────────

test("Dado claude com login Quando confiro a disponibilidade Então está ok e o pedido é auth status em JSON", async () => {
  const { ponte, execucoes } = ponteCom({ auth: { saida: JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "x@y" }) } });
  expect(await ponte.disponibilidade()).toEqual({ ok: true });
  expect(execucoes()[0]!.argv).toEqual(["auth", "status", "--json"]);
  expect(execucoes()[0]!.stdin).toBe("");
});

test("Dado claude sem login Quando confiro a disponibilidade Então digo que falta entrar, sem dados da conta", async () => {
  for (const auth of [{ saida: JSON.stringify({ loggedIn: false }), codigo: 1 }, { saida: "não é json" }, { saida: "", codigo: 0 }]) {
    const { ponte } = ponteCom({ auth });
    expect(await ponte.disponibilidade()).toEqual({ ok: false, motivo: "O Claude Code está instalado, mas sem login. Entre no Claude Code e tente de novo." });
  }
});

test("Dado claude fora do PATH Quando confiro a disponibilidade Então digo que não está instalado", async () => {
  const vazio = join(tmp, "vazio");
  mkdirSync(vazio);
  const ponte = new PonteClaudeCode({ ambiente: { PATH: vazio } });
  expect(await ponte.disponibilidade()).toEqual({ ok: false, motivo: "O Claude Code não foi encontrado neste computador. Instale e entre nele para ingerir pela interface." });
  expect(await ponte.executar({ papel: "leitor", mensagem: "x", raiz, wiki }, () => {}).fim)
    .toEqual({ situacao: "falhou", erro: "O Claude Code não foi encontrado neste computador. Instale e entre nele para ingerir pela interface.", recusas: [] });
});

test("Dado auth status que não responde Quando o prazo passa Então digo que não consegui confirmar o login", async () => {
  const lenta = new PonteClaudeCode({ comando: [process.execPath, "-e", "await Bun.sleep(5000)"], ambiente: {}, prazoDaConsultaMs: 200 });
  expect(await lenta.disponibilidade()).toEqual({ ok: false, motivo: "O Claude Code não respondeu à consulta de login. Tente de novo." });
  expect(lenta.nome).toBe("Claude Code");
});

test("Dado um claude falso no PATH Quando confiro a disponibilidade Então a ponte o acha pelo PATH", async () => {
  const bin = join(tmp, "bin");
  mkdirSync(bin);
  const roteiro = join(tmp, "roteiro.json");
  writeFileSync(roteiro, JSON.stringify({ auth: { saida: JSON.stringify({ loggedIn: true }) } }));
  if (process.platform === "win32") writeFileSync(join(bin, "claude.cmd"), `@"${process.execPath}" "${FALSO}" %*\r\n`);
  else { writeFileSync(join(bin, "claude"), `#!/bin/sh\nexec "${process.execPath}" "${FALSO}" "$@"\n`); chmodSync(join(bin, "claude"), 0o755); }
  const ponte = new PonteClaudeCode({ ambiente: { PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`, CLAUDE_FALSO_ROTEIRO: roteiro } });
  expect(await ponte.disponibilidade()).toEqual({ ok: true });
});

test("Dado o texto do assistente Quando a fase roda Então ele chega como evento de texto", async () => {
  const { ponte } = ponteCom({ leitor: [{ linha: textoDoAssistente("Li a fonte.") }, { linha: resultado() }] });
  const eventos: EventoDoAgente[] = [];
  await ponte.executar({ papel: "leitor", mensagem: "x", raiz, wiki }, evento => eventos.push(evento)).fim;
  expect(eventos).toEqual([{ tipo: "texto", texto: "Li a fonte." }]);
});
