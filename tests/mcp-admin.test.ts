import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capturarConsole } from "./apoio/console";
import { comandoIndexar, comandoMcp } from "../src/comandos/mcp";

async function comWiki(exec: (args: string[]) => Promise<{ codigo: number; saida: string }>, f: (raiz: string) => Promise<void>) {
  const raiz = mkdtempSync(join(tmpdir(), "anvilore-mcp-admin-")); const wiki = join(raiz, "wiki"); mkdirSync(wiki);
  writeFileSync(join(wiki, "a.md"), "---\ntitle: Página A\nslug: a\ntype: concept\n---\n## Assunto\ntexto consultável");
  const antigo = [process.env.ANVILORE_WIKI, process.env.ANVILORE_DIR];
  process.env.ANVILORE_WIKI = wiki; process.env.ANVILORE_DIR = join(raiz, ".anvilore");
  try { await f(raiz); } finally {
    if (antigo[0] === undefined) delete process.env.ANVILORE_WIKI; else process.env.ANVILORE_WIKI = antigo[0];
    if (antigo[1] === undefined) delete process.env.ANVILORE_DIR; else process.env.ANVILORE_DIR = antigo[1];
    rmSync(raiz, { recursive: true, force: true });
  }
}

test("Dado wiki local, Quando indexa em modo completo, Então imprime relatório", async () => {
  await comWiki(async () => ({ codigo: 0, saida: "" }), async () => {
    const log = capturarConsole(); try {
      expect(await comandoIndexar(["--completo"])).toBe(0);
      expect(log.saida.join("\n")).toContain('"paginas": 1');
    } finally { log.restaurar(); }
  });
});

test("Dado agente disponível, Quando liga MCP, Então indexa e registra comando absoluto", async () => {
  await comWiki(async () => ({ codigo: 0, saida: "" }), async raiz => {
    const comandos: string[][] = []; const log = capturarConsole();
    try {
      expect(await comandoMcp(["ligar", "claude"], { home: raiz, existe: async bin => bin === "claude", executar: async cmd => { comandos.push(cmd); return { codigo: 0, saida: "ok" }; } })).toBe(0);
      expect(comandos[0]).toEqual(["claude", "mcp", "add", "-s", "user", "anvilore", "--", "bun", join(process.cwd(), "src/cli.ts"), "mcp"]);
      expect(log.saida.join("\n")).toContain("Índice atualizado");
    } finally { log.restaurar(); }
  });
});

test("Dado registro ausente, Quando remove e consulta estado, Então não toca no índice e informa páginas", async () => {
  await comWiki(async () => ({ codigo: 0, saida: "" }), async () => {
    const log = capturarConsole();
    try {
      expect(await comandoMcp(["desligar", "claude"], { home: "/tmp", existe: async () => false, executar: async () => ({ codigo: 0, saida: "" }) })).toBe(0);
      expect(await comandoMcp(["estado"], { home: "/tmp", existe: async () => false, executar: async () => ({ codigo: 0, saida: "" }) })).toBe(0);
      expect(log.saida.join("\n")).toContain("Páginas: 1");
      expect(log.saida.join("\n")).toContain("nenhum");
    } finally { log.restaurar(); }
  });
});

test("Dado argumento inválido, Quando indexa ou escolhe ação MCP, Então mostra uso e falha", async () => {
  expect(await comandoIndexar(["--errado"])).toBe(2);
  expect(await comandoMcp(["outra-ação"])).toBe(2);
});
