import { describe, expect, spyOn, test } from "bun:test";
import { executar } from "../src/cli";

function capturar<T>(corpo: () => Promise<T>) {
  const saida: string[] = [];
  const erro: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...a) => {
    saida.push(a.join(" "));
  });
  const err = spyOn(console, "error").mockImplementation((...a) => {
    erro.push(a.join(" "));
  });
  return corpo()
    .then((codigo) => ({ codigo, saida, erro }))
    .finally(() => {
      log.mockRestore();
      err.mockRestore();
    });
}

describe("cli", () => {
  test("Dado nenhum argumento, Quando executar, Então devolve 2 e lista os subcomandos", async () => {
    const r = await capturar(() => executar([]));
    expect(r.codigo).toBe(2);
    expect(r.erro.join("\n")).toContain("--help");
  });

  test("Dado --help, Quando executar, Então devolve 0 e lista os subcomandos", async () => {
    const r = await capturar(() => executar(["--help"]));
    expect(r.codigo).toBe(0);
    expect(r.saida.join("\n")).toContain("--help");
  });

  test("Dado subcomando desconhecido, Quando executar, Então devolve 2 e lista os subcomandos", async () => {
    const r = await capturar(() => executar(["nao-existe"]));
    expect(r.codigo).toBe(2);
    expect(r.erro.join("\n")).toContain("nao-existe");
    expect(r.erro.join("\n")).toContain("--help");
  });

  test("Dado subcomando registrado, Quando executar, Então repassa os argumentos restantes e devolve o código dele", async () => {
    const recebido: string[][] = [];
    const tabela = {
      eco: async (args: string[]) => {
        recebido.push(args);
        return 7;
      },
    };
    const r = await capturar(() => executar(["eco", "a", "--b"], tabela));
    expect(r.codigo).toBe(7);
    expect(recebido).toEqual([["a", "--b"]]);
  });
});
