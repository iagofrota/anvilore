import { mkdir, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { iniciarServidorUi } from "../../src/ui/servidor/servidor";
import { PonteClaudeCode } from "../../src/lib/ponte-claude-code";
import { variaveisProibidas } from "./ambiente";

type Config = {
  raiz: string;
  token: string;
  agente: { tipo: "falso"; roteiro: string; registro: string } | { tipo: "ausente" };
};

const herdadas = variaveisProibidas(process.env);
if (herdadas.length > 0) throw new Error(`O servidor de teste recusa subir com variáveis que apontam para fora do vault: ${herdadas.join(", ")}.`);

const configPath = process.argv[2];
if (!configPath) throw new Error("Uso interno: servidor.ts <config.json>");
const config = JSON.parse(await readFile(configPath, "utf8")) as Config;
const raiz = resolve(config.raiz);
const temporario = await realpath(tmpdir());
const raizRelativa = relative(temporario, await realpath(raiz));
if (!raizRelativa.startsWith("anvilore-e2e-") || raizRelativa.includes("..") || isAbsolute(raizRelativa)) {
  throw new Error("O servidor de teste só aceita vault descartável anvilore-e2e-* dentro do diretório temporário.");
}

let ponte: PonteClaudeCode;
if (config.agente.tipo === "falso") {
  await mkdir(dirname(config.agente.registro), { recursive: true });
  await mkdir(resolve(raiz, ".home"), { recursive: true });
  ponte = new PonteClaudeCode({
    comando: [process.execPath, resolve(import.meta.dir, "../../tests/apoio/claude-falso.ts")],
    ambiente: {
      PATH: process.env.PATH,
      HOME: resolve(raiz, ".home"),
      TMPDIR: process.env.TMPDIR ?? tmpdir(),
      CLAUDE_FALSO_ROTEIRO: config.agente.roteiro,
      CLAUDE_FALSO_REGISTRO: config.agente.registro,
    },
  });
} else {
  const vazio = resolve(raiz, ".path-vazio");
  await mkdir(vazio, { recursive: true });
  await mkdir(resolve(raiz, ".home"), { recursive: true });
  ponte = new PonteClaudeCode({ ambiente: { PATH: vazio, HOME: resolve(raiz, ".home"), TMPDIR: process.env.TMPDIR ?? tmpdir() } });
}

const app = await iniciarServidorUi(raiz, { portaInicial: 0, token: config.token, abrirNavegador: false, ponte });
process.stdout.write(JSON.stringify({ porta: app.porta, url: app.url, token: app.token }) + "\n");

let encerrando = false;
const encerrar = async () => {
  if (encerrando) return;
  encerrando = true;
  await app.encerrar();
  app.servidor.stop(true);
};
process.on("SIGTERM", () => { void encerrar().finally(() => process.exit(0)); });
process.on("SIGINT", () => { void encerrar().finally(() => process.exit(0)); });
