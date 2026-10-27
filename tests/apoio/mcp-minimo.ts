import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "anvilore-teste", version: "0.0.0" }, { instructions: "ok" });
server.registerTool("eco", { inputSchema: { t: z.string() } }, async ({ t }) => ({
  content: [{ type: "text", text: t }],
}));
await server.connect(new StdioServerTransport());
