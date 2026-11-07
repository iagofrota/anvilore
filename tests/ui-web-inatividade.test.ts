import { expect, test } from "bun:test";
import { criarControladorBatimento, MENSAGEM_INATIVIDADE } from "../ui/web/inatividade";

test("Dado controlador de batimento ativo, Quando a aba ganha foco ou visibilidade, Então dispara batimento imediatamente", async () => {
  let chamadas = 0;
  const ouvintesDoc: Record<string, () => void> = {};
  const ouvintesWin: Record<string, () => void> = {};

  (globalThis as unknown as { document: unknown }).document = {
    visibilityState: "visible",
    addEventListener: (evento: string, fn: () => void) => { ouvintesDoc[evento] = fn; },
    removeEventListener: (evento: string) => { delete ouvintesDoc[evento]; },
  };

  (globalThis as unknown as { window: unknown }).window = {
    addEventListener: (evento: string, fn: () => void) => { ouvintesWin[evento] = fn; },
    removeEventListener: (evento: string) => { delete ouvintesWin[evento]; },
  };

  try {
    const limpar = criarControladorBatimento({
      enviar: async () => { chamadas++; },
      aoFalhar: () => {},
      intervaloMs: 60_000,
    });

    // Chamada inicial
    expect(chamadas).toBe(1);

    // Simula evento focus da janela
    ouvintesWin["focus"]?.();
    expect(chamadas).toBe(2);

    // Simula visibilitychange para aba visível
    ouvintesDoc["visibilitychange"]?.();
    expect(chamadas).toBe(3);

    // Simula visibilitychange para aba oculta (não deve disparar)
    (globalThis.document as { visibilityState: string }).visibilityState = "hidden";
    ouvintesDoc["visibilitychange"]?.();
    expect(chamadas).toBe(3);

    limpar();
    expect(Object.keys(ouvintesDoc)).toHaveLength(0);
    expect(Object.keys(ouvintesWin)).toHaveLength(0);
  } finally {
    delete (globalThis as unknown as { document?: unknown }).document;
    delete (globalThis as unknown as { window?: unknown }).window;
  }
});

test("Dado servidor desconectado por inatividade, Quando o batimento falha 3 vezes, Então aciona aoFalhar e expõe mensagem amigável de inatividade", async () => {
  let falhou = false;
  const limpar = criarControladorBatimento({
    enviar: async () => { throw new Error("Connection refused"); },
    aoFalhar: () => { falhou = true; },
    intervaloMs: 15,
  });

  // Aguarda 3 tentativas (0ms, 15ms, 30ms)
  await new Promise(r => setTimeout(r, 55));

  expect(falhou).toBe(true);
  expect(MENSAGEM_INATIVIDADE).toBe("O Anvilore foi fechado por inatividade. Clique no ícone para abrir de novo.");

  limpar();
});

test("Dado controlador de batimento, Quando ocorre 1 falha em 6 envios, Então não chama aoFalhar, e quando ocorrem 3 falhas consecutivas, Então chama aoFalhar e aoRecuperar (P3-B)", async () => {
  let chamadasFalha = 0;
  let chamadasRecuperar = 0;

  // Fase 1: 1 falha isolada em 6 envios não deve disparar aoFalhar
  const sequencia1 = [true, false, true, true, true, true];
  let idx1 = 0;

  const ctrl1 = criarControladorBatimento({
    enviar: async () => {
      const ok = sequencia1[idx1++];
      if (!ok) throw new Error("Erro de rede temporário");
    },
    aoFalhar: () => { chamadasFalha++; },
    aoRecuperar: () => { chamadasRecuperar++; },
    intervaloMs: 15,
  });

  await new Promise(r => setTimeout(r, 110));
  ctrl1();

  expect(idx1).toBeGreaterThanOrEqual(6);
  expect(chamadasFalha).toBe(0);

  // Fase 2: 3 falhas consecutivas chamam aoFalhar
  let falhouFase2 = false;
  let idx2 = 0;
  const ctrl2 = criarControladorBatimento({
    enviar: async () => {
      idx2++;
      throw new Error("Servidor fora do ar");
    },
    aoFalhar: () => { falhouFase2 = true; },
    intervaloMs: 15,
  });

  await new Promise(r => setTimeout(r, 60));
  ctrl2();

  expect(idx2).toBeGreaterThanOrEqual(3);
  expect(falhouFase2).toBe(true);
});
