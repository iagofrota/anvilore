import { randomBytes } from "node:crypto";
import { existsSync, watch } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { dirname, join, resolve } from "node:path";
import { expect, request, test as base, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";
import type { RoteiroDoFalso } from "../../tests/apoio/claude-falso";
import { criarVault, type Vault } from "./vault";
import { roteiroPadrao } from "./roteiros";
import { ambienteHermetico } from "./ambiente";

type App = { base: string; url: string; token: string; porta: number; processo: ChildProcessByStdio<null, Readable, Readable>; log(): string };
type Agente = { registro: string; invocacoes(papel?: "leitor" | "escritor" | "auth"): Promise<Record<string, unknown>[]>; liberar(nome: string): Promise<void>; pronto(nome: string): Promise<void> };
type Oraculo = { get<T>(rota: string): Promise<T>; post<T>(rota: string, corpo?: unknown): Promise<{ status: number; body: T }> };

type Fixtures = { vault: Vault; app: App; agente: Agente; oraculo: Oraculo; guardas: void };
type Options = { roteiro: RoteiroDoFalso; manterVault: boolean; agenteAusente: boolean; ambienteDoRunner: NodeJS.ProcessEnv | undefined };

async function lerRegistro(caminho: string): Promise<Record<string, unknown>[]> {
  try { return (await readFile(caminho, "utf8")).split("\n").filter(Boolean).map(linha => JSON.parse(linha) as Record<string, unknown>); }
  catch { return []; }
}

async function iniciar(processo: ChildProcessByStdio<null, Readable, Readable>): Promise<{ porta: number; url: string; token: string }> {
  return new Promise((resolveApp, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error(`Servidor de teste não publicou a linha de pronto. stdout: ${buffer}`)), 15_000);
    processo.stdout.on("data", bloco => {
      buffer += bloco.toString();
      const fim = buffer.indexOf("\n");
      if (fim < 0) return;
      clearTimeout(timer);
      try { resolveApp(JSON.parse(buffer.slice(0, fim)) as { porta: number; url: string; token: string }); }
      catch (erro) { reject(new Error(`Resposta inválida do servidor: ${buffer}`)); }
    });
    processo.once("error", erro => { clearTimeout(timer); reject(erro); });
    processo.once("exit", codigo => { clearTimeout(timer); reject(new Error(`Servidor encerrou antes de subir (código ${codigo}): ${buffer}`)); });
  });
}

async function encerrar(processo: ChildProcessByStdio<null, Readable, Readable>): Promise<void> {
  if (processo.exitCode !== null || processo.signalCode !== null) return;
  await new Promise<void>(resolveSaida => {
    // SIGKILL de reserva só para o PID que este fixture criou; o encerramento normal cancela o agente antes de sair.
    const reserva = setTimeout(() => processo.kill("SIGKILL"), 10_000);
    processo.once("exit", () => { clearTimeout(reserva); resolveSaida(); });
    processo.kill("SIGTERM");
  });
}

export const test = base.extend<Fixtures & Options>({
  roteiro: [roteiroPadrao(), { option: true }],
  manterVault: [process.env.E2E_MANTER === "1", { option: true }],
  agenteAusente: [false, { option: true }],
  // Só a contraprova de isolamento troca isto: simula um runner com ANVILORE_WIKI etc. exportados.
  ambienteDoRunner: [undefined, { option: true }],
  vault: async ({ manterVault }, use, testInfo) => {
    const vault = await criarVault();
    await use(vault);
    const falhou = testInfo.status !== testInfo.expectedStatus;
    await vault.limparFora();
    if (falhou || manterVault) {
      console.log(`Vault e2e preservado em ${vault.raiz}`);
    } else await vault.remover();
  },
  agente: async ({ vault, roteiro }, use) => {
    const diretorio = join(vault.raiz, ".anvilore/e2e");
    await mkdir(diretorio, { recursive: true });
    const arquivoRoteiro = join(diretorio, "roteiro.json");
    const registro = join(diretorio, "registro.jsonl");
    const serialized = JSON.stringify(roteiro).replaceAll("{{ROOT}}", vault.raiz);
    await writeFile(arquivoRoteiro, serialized);
    const agente: Agente = {
      registro,
      invocacoes: async papel => {
        const chamadas = await lerRegistro(registro);
        return papel ? chamadas.filter(chamada => {
          const argv = chamada.argv as string[] | undefined;
          if (papel === "auth") return argv?.[0] === "auth";
          if (argv?.[0] === "auth") return false;
          return Boolean(argv?.includes("--resume")) === (papel === "escritor");
        }) : chamadas;
      },
      liberar: async nome => writeFile(join(diretorio, `${nome}.liberar`), "continuar\n"),
      pronto: async nome => {
        const caminho = join(diretorio, `${nome}.pronto`);
        if (existsSync(caminho)) return;
        await new Promise<void>(resolvePronto => {
          const watcher = watch(dirname(caminho), (_evento, arquivo) => {
            if ((!arquivo || arquivo.toString() === `${nome}.pronto`) && existsSync(caminho)) { watcher.close(); resolvePronto(); }
          });
          if (existsSync(caminho)) { watcher.close(); resolvePronto(); }
        });
      },
    };
    await use(agente);
  },
  app: async ({ vault, agente, agenteAusente, ambienteDoRunner }, use) => {
    const token = randomBytes(24).toString("base64url");
    const configPath = join(vault.raiz, ".anvilore/e2e/servidor.json");
    const config = { raiz: vault.raiz, token, agente: agenteAusente ? { tipo: "ausente" } : { tipo: "falso", roteiro: join(vault.raiz, ".anvilore/e2e/roteiro.json"), registro: agente.registro } };
    await writeFile(configPath, JSON.stringify(config));
    const env = ambienteHermetico(ambienteDoRunner ?? process.env, join(vault.raiz, ".home"));
    const processo = spawn("bun", [resolve("e2e/apoio/servidor.ts"), configPath], { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    processo.stderr.on("data", bloco => { stderr += bloco.toString(); });
    let appInicial: { porta: number; url: string; token: string };
    try { appInicial = await iniciar(processo); }
    catch (erro) { await encerrar(processo); throw new Error(`${(erro as Error).message}\nstderr: ${stderr}`); }
    const app: App = { ...appInicial, base: new URL(appInicial.url).origin, processo, log: () => stderr };
    await use(app);
    await encerrar(processo);
  },
  oraculo: async ({ app }, use) => {
    const url = new URL(app.url);
    const token = url.searchParams.get("token")!;
    const contexto = await request.newContext({ extraHTTPHeaders: { origin: app.base } });
    const endpoint = (rota: string) => `${app.base}${rota}${rota.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
    const oraculo: Oraculo = {
      get: async <T>(rota: string) => {
        const resposta = await contexto.get(endpoint(rota));
        if (!resposta.ok()) throw new Error(`GET ${rota}: HTTP ${resposta.status()} ${await resposta.text()}`);
        return await resposta.json() as T;
      },
      post: async <T>(rota: string, corpo?: unknown) => {
        const resposta = await contexto.post(endpoint(rota), corpo === undefined ? {} : { data: corpo });
        let body: T;
        try { body = await resposta.json() as T; } catch { body = await resposta.text() as T; }
        return { status: resposta.status(), body };
      },
    };
    await use(oraculo);
    await contexto.dispose();
  },
  guardas: [async ({ page, app, agente }, use, testInfo) => {
    const erros: string[] = [];
    const caminhos: string[] = [];
    page.on("pageerror", erro => erros.push(erro.message));
    page.on("console", msg => { if (msg.type() === "error") erros.push(msg.text()); });
    page.on("request", req => { const origem = new URL(req.url()).origin; if (!new Set([app.base, app.base.replace("127.0.0.1", "localhost"), app.base.replace("localhost", "127.0.0.1")]).has(origem)) caminhos.push(req.url()); });
    await use();
    const caminhoTitulo = testInfo.titlePath.join(" ");
    const codigosEsperados = [
      ...(caminhoTitulo.includes("[C02]") ? [403] : []),
      ...(caminhoTitulo.includes("[C07]") ? [409] : []),
      ...(caminhoTitulo.includes("[C15]") ? [400] : []),
      ...(caminhoTitulo.includes("[C24]") ? [503] : []),
    ];
    const errosNaoEsperados = erros.filter(erro => !(/Failed to load resource/i.test(erro) && codigosEsperados.some(codigo => erro.includes(String(codigo)))));
    expect(errosNaoEsperados, "erros do console/página não permitidos").toEqual([]);
    expect(caminhos, "requisições externas ao vault local").toEqual([]);
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach("servidor.log", { body: Buffer.from(app.log()), contentType: "text/plain" });
      await testInfo.attach("registro.jsonl", { body: await readFile(agente.registro).catch(() => Buffer.from("")), contentType: "application/jsonl" });
    }
  }, { auto: true }],
});

export { expect };
