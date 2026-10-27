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
      expect(comandos[1]).toEqual(["claude", "mcp", "add", "-s", "user", "anvilore", "--", "bun", join(process.cwd(), "src/cli.ts"), "mcp"]);
      expect(log.saida.join("\n")).toContain("Índice atualizado");
    } finally { log.restaurar(); }
  });
});

test("Dado registro ausente, Quando remove e consulta estado, Então não toca no índice e informa páginas", async () => {
  await comWiki(async () => ({ codigo: 0, saida: "" }), async () => {
    const log = capturarConsole(); const comandos: string[][] = [];
    try {
      const amb = { home: "/tmp", existe: async () => false, executar: async (cmd: string[]) => { comandos.push(cmd); return { codigo: 0, saida: "" }; } };
      expect(await comandoMcp(["desligar", "claude"], amb)).toBe(0);
      expect(await comandoMcp(["estado"], amb)).toBe(0);
      expect(comandos).toEqual([]);
      expect(log.saida.join("\n")).toContain("Páginas: 1");
      expect(log.saida.join("\n")).toContain("Índice:");
      expect(log.saida.join("\n")).toContain("Última reindexação:");
      expect(log.saida.join("\n")).toContain("nenhum");
    } finally { log.restaurar(); }
  });
});

test("Dado nenhum agente instalado, Quando liga MCP, Então informa falha sem abortar", async () => {
  await comWiki(async () => ({ codigo: 2, saida: "indisponível" }), async () => {
    const log = capturarConsole();
    try { expect(await comandoMcp(["ligar", "--agente", "todos"], { home: "/tmp", existe: async () => false, executar: async () => ({ codigo: 1, saida: "" }) })).toBe(1); }
    finally { log.restaurar(); }
  });
});

test("Dado list de um agente que falha, Quando liga todos, Então segue para os outros agentes", async () => {
  await comWiki(async () => ({ codigo: 0, saida: "" }), async () => {
    const comandos: string[][] = []; const log = capturarConsole();
    try {
      const resultado = await comandoMcp(["ligar", "--agente", "todos"], {
        home: "/tmp", existe: async () => true,
        executar: async cmd => { comandos.push(cmd); return cmd[0] === "claude" && cmd.includes("list") ? { codigo: 1, saida: "erro" } : { codigo: 0, saida: cmd.includes("list") ? "outro: /tmp/servidor" : "ok" }; },
      });
      expect(resultado).toBe(0);
      expect(comandos.some((cmd) => cmd[0] === "codex" && cmd.includes("add"))).toBe(true);
    } finally { log.restaurar(); }
  });
});

test("Dado erro ao remover um agente, Quando desliga todos, Então avisa e tenta os agentes seguintes", async () => {
  await comWiki(async () => ({ codigo: 0, saida: "" }), async () => {
    const comandos: string[][] = []; const log = capturarConsole();
    try {
      expect(await comandoMcp(["desligar", "todos"], {
        home: "/tmp", existe: async () => true,
        executar: async cmd => {
          comandos.push(cmd);
          if (cmd.includes("list")) return { codigo: 0, saida: `anvilore: bun "${join(process.cwd(), "src", "cli.ts")}" mcp` };
          return { codigo: cmd[0] === "claude" ? 1 : 0, saida: "erro" };
        },
      })).toBe(0);
      expect(comandos.filter(cmd => cmd.includes("remove"))).toHaveLength(4);
      expect(log.avisos.join("\n")).toContain("não foi possível remover claude");
    } finally { log.restaurar(); }
  });
});

test("Dado argumento inválido, Quando indexa ou escolhe ação MCP, Então mostra uso e falha", async () => {
  expect(await comandoIndexar(["--errado"])).toBe(2);
  expect(await comandoMcp(["outra-ação"])).toBe(2);
});
