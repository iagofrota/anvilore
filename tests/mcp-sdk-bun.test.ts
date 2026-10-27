import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("Dado servidor SDK sob Bun, Quando inicializa e lista tools, Então responde initialize e tools/list", async () => {
  const transport = new StdioClientTransport({ command: "bun", args: ["tests/apoio/mcp-minimo.ts"] });
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
