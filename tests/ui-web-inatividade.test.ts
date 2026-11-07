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

test("Dado servidor desconectado por inatividade, Quando o batimento falha, Então aciona aoFalhar e expõe mensagem amigável de inatividade", async () => {
  let falhou = false;
  const limpar = criarControladorBatimento({
    enviar: async () => { throw new Error("Connection refused"); },
    aoFalhar: () => { falhou = true; },
    intervaloMs: 60_000,
  });

  // Aguarda promessa do primeiro envio
  await new Promise(r => setTimeout(r, 20));

  expect(falhou).toBe(true);
  expect(MENSAGEM_INATIVIDADE).toBe("O Anvilore foi fechado por inatividade. Clique no ícone para abrir de novo.");

  limpar();
});
