import { expect, spyOn, test } from "bun:test";
import { criarRegistrador, type Ambiente } from "../src/mcp/registro";

function fixture(presente = true) {
  const comandos: string[][] = []; let configurado = false;
  const amb: Ambiente = { home: "/home/teste", existe: async () => presente, executar: async cmd => {
    comandos.push(cmd);
    if (cmd.includes("list")) return { codigo: 0, saida: configurado ? "anvilore: bun /repo/src/cli.ts mcp" : "other: /repo/anvilore" };
    if (cmd.includes("add")) configurado = true;
    if (cmd.includes("remove")) configurado = false;
    return { codigo: 0, saida: "ok" };
  } };
  return { amb, comandos, ligado: () => configurado };
}

test("Dado Claude instalado, Quando liga, Então usa escopo de usuário e executável absoluto", async () => {
  const f = fixture(); const comando = ["bun", "/repo/src/cli.ts", "mcp"];
  expect(await criarRegistrador("claude").ligar(comando, f.amb)).toBe("ligado");
  expect(f.comandos[1]).toEqual(["claude", "mcp", "add", "-s", "user", "anvilore", "--", ...comando]);
});

test("Dado agente ausente, Quando liga, Então pula sem executar comando", async () => {
  const f = fixture(false);
  expect(await criarRegistrador("claude").ligar(["bun", "/repo/src/cli.ts", "mcp"], f.amb)).toBe("pulado");
  expect(f.comandos).toHaveLength(0);
});

test("Dado entrada Anvilore e outra entrada, Quando desliga, Então remove só Anvilore e preserva o banco", async () => {
  const f = fixture(); const r = criarRegistrador("claude");
  await r.ligar(["bun", "/repo/src/cli.ts", "mcp"], f.amb);
  expect(await r.desligar(f.amb)).toBe("removido");
  expect(f.ligado()).toBe(false);
  expect(f.comandos.at(-1)).toEqual(["claude", "mcp", "remove", "-s", "user", "anvilore"]);
  expect(f.amb.home).toBe("/home/teste");
});

test("Dado agente ligado, Quando consulto e removo, Então o estado alterna", async () => {
  const f = fixture(); const r = criarRegistrador("gemini");
  expect(await r.ligado(f.amb)).toBe(false);
  await r.ligar(["bun", "/repo/src/cli.ts", "mcp"], f.amb);
  expect(await r.ligado(f.amb)).toBe(true);
  expect(await r.desligar(f.amb)).toBe("removido");
  expect(await r.ligado(f.amb)).toBe(false);
});

test("Dado nenhum agente instalado, Quando liga, Então todos pulam", async () => {
  const f = fixture(false); const resultados = await Promise.all(["claude", "codex", "gemini", "copilot"].map(a => criarRegistrador(a as "claude").ligar([], f.amb)));
  expect(resultados).toEqual(["pulado", "pulado", "pulado", "pulado"]);
});

test("Dado agente sem registro, Quando desliga, Então relata ausente", async () => {
  expect(await criarRegistrador("codex").desligar(fixture().amb)).toBe("ausente");
});

test("Dado list com nome anvilore em caminho alheio, Quando desliga ou consulta, Então não considera nosso servidor", async () => {
  const amb: Ambiente = { home: "/home/teste", existe: async () => true, executar: async cmd => ({ codigo: 0, saida: cmd.includes("list") ? "wiki-wonka: /tmp/anvilore/mcp" : "ok" }) };
  const r = criarRegistrador("claude");
  expect(await r.ligado(amb)).toBe(false);
  expect(await r.desligar(amb)).toBe("ausente");
});

test("Dado entrada chamada anvilore com comando estrangeiro, Quando liga, Então avisa e preserva", async () => {
  const comandos: string[][] = [];
  const amb: Ambiente = { home: "/home/teste", existe: async () => true, executar: async cmd => { comandos.push(cmd); return { codigo: 0, saida: cmd.includes("list") ? "anvilore: node /tmp/wiki-wonka/server.js" : "ok" }; } };
  const avisos = spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(await criarRegistrador("claude").ligar(["bun", "/repo/src/cli.ts", "mcp"], amb)).toBe("pulado");
    expect(comandos.some((cmd) => cmd.includes("add"))).toBe(false);
    expect(avisos).toHaveBeenCalled();
  } finally { avisos.mockRestore(); }
});

test("Dado comando de agente que falha, Quando liga, Então avisa e pula sem abortar", async () => {
  const avisos = spyOn(console, "warn").mockImplementation(() => {});
  const amb: Ambiente = { home: "/home/teste", existe: async () => true, executar: async () => ({ codigo: 2, saida: "falhou" }) };
  try {
    expect(await criarRegistrador("claude").ligar(["bun", "/repo/src/cli.ts", "mcp"], amb)).toBe("pulado");
    expect(avisos).toHaveBeenCalled();
  } finally { avisos.mockRestore(); }
});

test("Dado list de agente que nunca responde, Quando consulta status, Então falha com timeout curto", async () => {
  const amb: Ambiente = { home: "/home/teste", existe: async () => true, executar: async () => new Promise(() => {}) };
  const inicio = Date.now();
  await expect(Promise.race([criarRegistrador("claude", 20).ligado(amb), new Promise((_, reject) => setTimeout(() => reject(new Error("teste excedeu timeout")), 500))])).rejects.toThrow("timeout");
  expect(Date.now() - inicio).toBeLessThan(500);
});
