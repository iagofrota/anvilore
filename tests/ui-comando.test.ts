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

test("Dado comando válido Quando o servidor abre Então exibe a URL com token e encerra após o sinal", async () => {
  const c = capturarConsole();
  let encerrou = false;
  const fake = { servidor: { stop: () => { encerrou = true; } }, porta: 4173, token: "token", url: "http://127.0.0.1:4173/?token=token" } as Awaited<ReturnType<typeof import("../src/ui/servidor/servidor").iniciarServidorUi>>;
  try {
    expect(await comandoUi([], async () => fake, async servidor => { servidor.stop(true); })).toBe(0);
    expect(c.saida.join(" ")).toContain("http://127.0.0.1:4173/?token=token");
    expect(encerrou).toBe(true);
  } finally { c.restaurar(); }
});
