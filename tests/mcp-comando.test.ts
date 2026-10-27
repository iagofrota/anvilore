import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { comandoMcpServidor } from "../src/comandos/mcp-servidor";

test("Dado argumentos válidos, Quando inicia MCP, Então resolve a wiki e aguarda o fim do transporte", async () => {
  const entrada = new PassThrough(); let configuracao: { raiz: string; wiki: string } | undefined;
  entrada.resume();
  const resultado = comandoMcpServidor(["--wiki", "pessoal"], { raiz: "/tmp/anvilore", entrada, iniciar: async (cfg) => { configuracao = cfg; } });
  setTimeout(() => entrada.end(), 0);
  expect(await resultado).toBe(0);
  expect(configuracao).toEqual({ raiz: "/tmp/anvilore", wiki: `${process.cwd()}/pessoal` });
});

test("Dado flag sem caminho, Quando inicia MCP, Então devolve erro", async () => {
  expect(await comandoMcpServidor(["--wiki"])).toBe(1);
});

test("Dado opção desconhecida, Quando inicia MCP, Então devolve erro", async () => {
  expect(await comandoMcpServidor(["--outro"])).toBe(1);
});

test("Dado inicialização que lança, Quando inicia MCP, Então converte erro para código 1", async () => {
  expect(await comandoMcpServidor([], { iniciar: async () => { throw new Error("falha simulada"); } })).toBe(1);
});
