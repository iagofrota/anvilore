import { expect, setDefaultTimeout, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Sobe processo do servidor MCP sob Bun via StdioClientTransport: no runner Windows isso passa dos 5 s padrão.
setDefaultTimeout(30_000);

test("Dado servidor SDK sob Bun, Quando inicializa e lista tools, Então responde initialize e tools/list", async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: ["tests/apoio/mcp-minimo.ts"] });
  const client = new Client({ name: "teste", version: "0.0.0" });
  try {
    await client.connect(transport);
    expect(client.getServerVersion()?.name).toBe("anvilore-teste");
    expect(client.getInstructions()).toBe("ok");
    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(1);
    expect(tools.tools[0]?.name).toBe("eco");
    const result = await client.callTool({ name: "eco", arguments: { t: "x" } });
    expect(result.content).toEqual([{ type: "text", text: "x" }]);
  } finally {
    await client.close();
  }
});
