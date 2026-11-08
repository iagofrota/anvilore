import { afterEach, expect, spyOn, test } from "bun:test";
import { comandoUi, esperarEncerramento } from "../src/comandos/ui";
import { capturarConsole } from "./apoio/console";

afterEach(() => { delete process.env.ANVILORE_DESTINO; });

test("Dado argumentos extras Quando executo anvilore ui Então mostra uso e retorna 2", async () => {
  const c = capturarConsole();
  try { expect(await comandoUi(["extra"])).toBe(2); expect(c.erros.join(" ")).toContain("Uso: anvilore ui"); }
  finally { c.restaurar(); }
});

test("Dado falha ao subir o servidor Quando executo anvilore ui Então retorna erro curto", async () => {
  const c = capturarConsole();
  try {
    expect(await comandoUi([], async () => { throw new Error("sem portas livres"); })).toBe(1);
    expect(c.erros.join(" ")).toContain("sem portas livres");
  } finally { c.restaurar(); }
});

test("Dado servidor ativo Quando recebo SIGINT Então fecho a porta e retorno", async () => {
  let fechado = false;
  const registrar = (sinal: "SIGINT" | "SIGTERM", callback: () => void) => { if (sinal === "SIGINT") queueMicrotask(callback); };
  const fake = { stop: () => { fechado = true; } } as Awaited<ReturnType<typeof import("../src/ui/servidor/servidor").iniciarServidorUi>>["servidor"];
  await esperarEncerramento(fake, registrar);
  expect(fechado).toBe(true);
});

test("Dado SIGINT durante ingestão Quando encerro a UI Então aguardo a limpeza do agente", async () => {
  let servidorFechado = false;
  let limpezaConcluida = false;
  let liberarLimpeza!: () => void;
  const limpeza = new Promise<void>(resolver => { liberarLimpeza = resolver; });
  const registrar = (sinal: "SIGINT" | "SIGTERM", callback: () => void) => { if (sinal === "SIGINT") queueMicrotask(callback); };
  const fake = { stop: () => { servidorFechado = true; } } as Awaited<ReturnType<typeof import("../src/ui/servidor/servidor").iniciarServidorUi>>["servidor"];
  let terminou = false;
  const encerramento = esperarEncerramento(fake, registrar, async () => { await limpeza; limpezaConcluida = true; }).then(() => { terminou = true; });

  await Promise.resolve();
  expect(servidorFechado).toBe(true);
  expect(limpezaConcluida).toBe(false);
  expect(terminou).toBe(false);
  liberarLimpeza();
  await encerramento;
  expect(limpezaConcluida).toBe(true);
  expect(terminou).toBe(true);
});

test("Dado configuração padrão Quando recebo SIGTERM Então o handler registrado fecha o servidor", async () => {
  let fechado = false;
  const fake = { stop: () => { fechado = true; } } as Awaited<ReturnType<typeof import("../src/ui/servidor/servidor").iniciarServidorUi>>["servidor"];
  const callbacks: Array<() => void> = [];
  const spy = spyOn(process, "once").mockImplementation((_sinal: any, callback: any) => { callbacks.push(callback); return process; });
  try {
    const encerramento = esperarEncerramento(fake);
    expect(callbacks).toHaveLength(2);
    callbacks[1]!();
    await encerramento;
    expect(fechado).toBe(true);
  } finally { spy.mockRestore(); }
});

test("Dado comando válido Quando o servidor abre Então avisa abertura no navegador sem exibir o token e encerra após o sinal", async () => {
  const c = capturarConsole();
  let encerrou = false;
  const fake = { servidor: { stop: () => { encerrou = true; } }, porta: 4173, token: "token", url: "http://127.0.0.1:4173/?token=token" } as Awaited<ReturnType<typeof import("../src/ui/servidor/servidor").iniciarServidorUi>>;
  try {
    expect(await comandoUi([], async () => fake, async servidor => { servidor.stop(true); })).toBe(0);
    expect(c.saida.join(" ")).toContain("Interface do Anvilore aberta no navegador");
    expect(c.saida.join(" ")).not.toContain("token=");
    expect(encerrou).toBe(true);
  } finally { c.restaurar(); }
});

test("Dado comando com --revisao Quando o servidor abre Então passa soRevisao: true e não roda atualização inicial", async () => {
  const c = capturarConsole();
  let opcoesRecebidas: any;
  const fake = { servidor: { stop: () => {} }, porta: 4173, token: "token", url: "http://127.0.0.1:4173/?token=token#revisao" } as Awaited<ReturnType<typeof import("../src/ui/servidor/servidor").iniciarServidorUi>>;
  try {
    expect(await comandoUi(["--revisao"], async (_raiz, opcoes) => { opcoesRecebidas = opcoes; return fake; }, async servidor => { servidor.stop(true); })).toBe(0);
    expect(opcoesRecebidas?.soRevisao).toBe(true);
    expect(c.saida.join(" ")).toContain("Interface do Anvilore aberta no navegador");
  } finally { c.restaurar(); }
});

test("Dado servidor que expõe limpeza Quando comandoUi recebe o sinal Então espera o encerramento da ingestão", async () => {
  const c = capturarConsole();
  let ingestaoEncerrada = false;
  const fake = {
    servidor: { stop() {} }, porta: 4173, token: "token", url: "http://127.0.0.1:4173/?token=token",
    encerrar: async () => { ingestaoEncerrada = true; },
  } as Awaited<ReturnType<typeof import("../src/ui/servidor/servidor").iniciarServidorUi>>;
  const esperar = async (
    servidor: Awaited<ReturnType<typeof import("../src/ui/servidor/servidor").iniciarServidorUi>>["servidor"],
    _registrar?: (sinal: "SIGINT" | "SIGTERM", callback: () => void) => void,
    encerrar?: () => Promise<void>,
  ) => { servidor.stop(true); await encerrar?.(); };
  try {
    expect(await comandoUi([], async () => fake, esperar)).toBe(0);
    expect(ingestaoEncerrada).toBe(true);
  } finally { c.restaurar(); }
});

test("Dado comando com --auto-encerrar Quando o servidor abre Então passa autoEncerrar: true", async () => {
  const c = capturarConsole();
  let opcoesRecebidas: any;
  const fake = { servidor: { stop: () => {} }, porta: 4173, token: "token", url: "http://127.0.0.1:4173/?token=token" } as Awaited<ReturnType<typeof import("../src/ui/servidor/servidor").iniciarServidorUi>>;
  try {
    expect(await comandoUi(["--auto-encerrar"], async (_raiz, opcoes) => { opcoesRecebidas = opcoes; return fake; }, async servidor => { servidor.stop(true); })).toBe(0);
    expect(opcoesRecebidas?.autoEncerrar).toBe(true);
  } finally { c.restaurar(); }
});

test("Dado instância já em execução Quando comandoUi é chamado Então reabre o navegador na URL existente sem subir outro servidor", async () => {
  const c = capturarConsole();
  let navegadorAberto: string | undefined;
  let novoServidorIniciado = false;

  // Servidor fake local em porta efêmera para responder GET autenticado
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.searchParams.get("token") === "token-existente") return new Response("OK", { status: 200 });
      return new Response("Forbidden", { status: 403 });
    },
  });

  const fake = { servidor: { stop: () => {} }, porta: server.port!, token: "token", url: `http://127.0.0.1:${server.port}/?token=token` } as Awaited<ReturnType<typeof import("../src/ui/servidor/servidor").iniciarServidorUi>>;
  const { gravarEstadoUi, removerEstadoUi } = await import("../src/lib/ui-estado");
  const estado = { pid: process.pid, porta: server.port!, token: "token-existente", pasta: process.cwd() };

  try {
    await gravarEstadoUi(estado);
    const codigo = await comandoUi(
      [],
      async () => { novoServidorIniciado = true; return fake; },
      async () => {},
      url => { navegadorAberto = url; },
    );
    expect(codigo).toBe(0);
    expect(novoServidorIniciado).toBe(false);
    expect(navegadorAberto).toBe(`http://127.0.0.1:${server.port}/?token=token-existente`);
    expect(c.saida.join(" ")).toContain("Interface do Anvilore aberta no navegador");
  } finally {
    server.stop(true);
    await removerEstadoUi(process.cwd(), process.pid);
    c.restaurar();
  }
});

test("Dado instância em execução no modo só-revisão, Quando comandoUi é chamado sem --revisao, Então inicia um novo servidor completo (P2-1)", async () => {
  const c = capturarConsole();
  let novoServidorIniciado = false;
  const fake = { servidor: { stop: () => {} }, porta: 4174, token: "token-completo", url: "http://127.0.0.1:4174/?token=token-completo" } as Awaited<ReturnType<typeof import("../src/ui/servidor/servidor").iniciarServidorUi>>;
  const { gravarEstadoUi, removerEstadoUi } = await import("../src/lib/ui-estado");

  // Servidor fake de revisão ativo
  const serverRevisao = Bun.serve({
    port: 0,
    fetch() {
      return new Response("OK", { status: 200 });
    },
  });

  const estado = {
    pid: process.pid,
    porta: serverRevisao.port!,
    token: "token-revisao",
    pasta: process.cwd(),
    soRevisao: true,
  };

  try {
    await gravarEstadoUi(estado);
    const codigo = await comandoUi(
      [],
      async () => { novoServidorIniciado = true; return fake; },
      async () => {},
      () => {},
    );
    expect(codigo).toBe(0);
    // Deve iniciar um novo servidor porque o existente é apenas de revisão
    expect(novoServidorIniciado).toBe(true);
  } finally {
    serverRevisao.stop(true);
    await removerEstadoUi(process.cwd(), process.pid);
    c.restaurar();
  }
});
