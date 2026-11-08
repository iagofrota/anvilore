import { resolve } from "node:path";
import { iniciarServidorUi } from "../ui/servidor/servidor";
import { comandoHooksWiki } from "./hooks-wiki";
import { gravarEstadoUi, removerEstadoUi, verificarInstanciaExistente } from "../lib/ui-estado";

type AppUi = Awaited<ReturnType<typeof iniciarServidorUi>>;

function abrirNavegador(url: string): void {
  const comando = process.platform === "win32" ? ["cmd", "/c", "start", "", url]
    : process.platform === "darwin" ? ["open", url]
      : ["xdg-open", url];
  try { Bun.spawn(comando, { stdin: "ignore", stdout: "ignore", stderr: "ignore" }); } catch {}
}

export async function esperarEncerramento(
  servidor: AppUi["servidor"],
  registrar: (sinal: "SIGINT" | "SIGTERM", callback: () => void) => void = (sinal, callback) => process.once(sinal, callback),
  encerrar: () => Promise<void> = async () => {},
): Promise<void> {
  await new Promise<void>(resolver => {
    let sinalRecebido = false;
    const aoEncerrar = () => {
      if (sinalRecebido) return;
      sinalRecebido = true;
      servidor.stop(true);
      void encerrar().catch(erro => console.error(`Falha ao encerrar a ingestão: ${(erro as Error).message}`)).finally(resolver);
    };
    registrar("SIGINT", aoEncerrar);
    registrar("SIGTERM", aoEncerrar);
  });
}

export async function comandoUi(
  args: string[],
  iniciar = iniciarServidorUi,
  esperar = esperarEncerramento,
  abrir = abrirNavegador,
): Promise<number> {
  const soRevisao = args.includes("--revisao");
  const autoEncerrar = args.includes("--auto-encerrar") || process.env.ANVILORE_AUTO_ENCERRAR === "1";
  const argsValidos = args.filter(a => a === "--revisao" || a === "--auto-encerrar");
  if (args.length !== argsValidos.length) {
    console.error("Uso: anvilore ui [--revisao] [--auto-encerrar]");
    return 2;
  }
  const raiz = resolve(process.env.ANVILORE_DESTINO ?? process.cwd());

  const instancia = await verificarInstanciaExistente(raiz, process.env, { soRevisao });
  if (instancia.ativa && instancia.url) {
    const urlFinal = `${instancia.url}${soRevisao ? "#revisao" : ""}`;
    abrir(urlFinal);
    console.log("Interface do Anvilore aberta no navegador");
    return 0;
  }

  if (!soRevisao) {
    // No início da UI, aplica estado retomável; se não houver versão pronta, a checagem fica destacada.
    await comandoHooksWiki(["atualizar", raiz]);
  }
  let app: AppUi;
  try { app = await iniciar(raiz, { soRevisao, autoEncerrar }); }
  catch (erro) { console.error(`Não foi possível abrir a interface: ${(erro as Error).message}`); return 1; }
  if (typeof app.porta === "number") {
    try {
      await gravarEstadoUi({ pid: process.pid, porta: app.porta, token: app.token, pasta: raiz, soRevisao }, process.env);
    } catch {}
  }
  console.log("Interface do Anvilore aberta no navegador");
  try {
    await esperar(app.servidor, undefined, app.encerrar);
  } finally {
    try {
      await removerEstadoUi(app?.obterRaiz ? app.obterRaiz() : raiz, process.pid, process.env);
    } catch {}
  }
  return 0;
}
