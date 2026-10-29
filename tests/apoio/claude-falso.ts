// `claude` falso para os testes da ponte. Nenhum teste chama o Claude Code real.
//
// CLAUDE_FALSO_ROTEIRO: arquivo JSON { auth?, leitor?, escritor? }. A fase é escolhida pelo argv:
// `auth status` usa `auth`; com `--resume`, `escritor`; senão, `leitor`.
// CLAUDE_FALSO_REGISTRO: arquivo onde cada execução acrescenta uma linha JSON com argv, cwd,
// variáveis do Anvilore e o que chegou pelo stdin (a ponte deve deixá-lo vazio).
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type PassoDoFalso =
  | { linha: unknown }
  | { escrever: { caminho: string; conteudo: string } }
  | { esperar: number }
  | { esperarArquivo: { caminho: string; pronto: string; sessao: string } }
  | { esperarSinal: { sessao: string; ignorar?: boolean } }
  | { stderr: string }
  | { sair: number };

export type RoteiroDoFalso = {
  auth?: { saida: string; codigo?: number };
  leitor?: PassoDoFalso[];
  escritor?: PassoDoFalso[];
};

const argv = process.argv.slice(2);
const roteiro = JSON.parse(readFileSync(process.env.CLAUDE_FALSO_ROTEIRO!, "utf8")) as RoteiroDoFalso;
const stdin = await Bun.stdin.text();
if (process.env.CLAUDE_FALSO_REGISTRO) {
  appendFileSync(process.env.CLAUDE_FALSO_REGISTRO, JSON.stringify({
    argv,
    pid: process.pid,
    cwd: process.cwd(),
    stdin,
    ANVILORE_WIKI: process.env.ANVILORE_WIKI,
    ANVILORE_SEM_AUTOCOMMIT: process.env.ANVILORE_SEM_AUTOCOMMIT,
  }) + "\n");
}

if (argv[0] === "auth") {
  process.stdout.write(roteiro.auth?.saida ?? "");
  process.exit(roteiro.auth?.codigo ?? 0);
}

const passos = (argv.includes("--resume") ? roteiro.escritor : roteiro.leitor) ?? [];
function substituirMarcadores(valor: unknown): unknown {
  const pasta = resolve(process.cwd(), ".anvilore/ui/conversas");
  // A conversa mais recente é a da execução em curso; a primeira da pasta poderia ser uma conversa semeada antes.
  const nome = existsSync(pasta)
    ? readdirSync(pasta).filter(arquivo => arquivo.endsWith(".json")).sort((a, b) => statSync(join(pasta, b)).mtimeMs - statSync(join(pasta, a)).mtimeMs)[0]
    : undefined;
  let fonteAtual = "";
  if (nome) {
    try { fonteAtual = String((JSON.parse(readFileSync(join(pasta, nome), "utf8")) as { fonte?: string }).fonte ?? ""); }
    catch { /* conversa ainda não foi persistida */ }
  }
  return JSON.parse(JSON.stringify(valor)
    .replaceAll("{{ROOT}}", process.cwd())
    .replaceAll("{{FONTE_ATUAL}}", fonteAtual)) as unknown;
}
for (const passo of passos) {
  if ("linha" in passo) process.stdout.write(JSON.stringify(substituirMarcadores(passo.linha)) + "\n");
  else if ("escrever" in passo) {
    const alvo = resolve(passo.escrever.caminho);
    mkdirSync(dirname(alvo), { recursive: true });
    writeFileSync(alvo, passo.escrever.conteudo);
  } else if ("esperar" in passo) await Bun.sleep(passo.esperar);
  else if ("esperarArquivo" in passo) {
    const alvo = resolve(passo.esperarArquivo.caminho);
    const pronto = resolve(passo.esperarArquivo.pronto);
    mkdirSync(dirname(alvo), { recursive: true });
    mkdirSync(dirname(pronto), { recursive: true });
    if (!existsSync(alvo)) await new Promise<void>(resolveEspera => {
      const watcher = watch(dirname(alvo), (_evento, nome) => {
        if ((!nome || nome.toString() === alvo.split(/[\\/]/).at(-1)) && existsSync(alvo)) {
          process.off("SIGINT", interromper);
          watcher.close();
          resolveEspera();
        }
      });
      const interromper = () => {
        watcher.close();
        process.stdout.write(JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, terminal_reason: "aborted_streaming", result: null, session_id: passo.esperarArquivo.sessao }) + "\n");
        process.exit(0);
      };
      process.once("SIGINT", interromper);
      if (existsSync(alvo)) {
        process.off("SIGINT", interromper);
        watcher.close();
        resolveEspera();
      } else writeFileSync(pronto, "pronto\n");
    });
  }
  else if ("stderr" in passo) process.stderr.write(passo.stderr);
  else if ("sair" in passo) process.exit(passo.sair);
  else if ("esperarSinal" in passo) {
    const { sessao, ignorar } = passo.esperarSinal;
    await new Promise<void>(() => {
      process.on("SIGINT", () => {
        if (ignorar) return;
        process.stdout.write(JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, terminal_reason: "aborted_streaming", result: null, session_id: sessao }) + "\n");
        process.exit(0);
      });
      setInterval(() => {}, 1000);
    });
  }
}
