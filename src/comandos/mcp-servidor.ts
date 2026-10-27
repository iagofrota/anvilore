import { resolve, join } from "node:path";
import type { Readable } from "node:stream";
import { iniciarServidor } from "../mcp/servidor";

type Dependencias = { iniciar?: typeof iniciarServidor; entrada?: Readable; raiz?: string };

export async function comandoMcpServidor(args: string[], deps: Dependencias = {}): Promise<number> {
  const iniciar = deps.iniciar ?? iniciarServidor;
  const entrada = deps.entrada ?? process.stdin;
  const raiz = deps.raiz ?? resolve(import.meta.dir, "../..");
  let wiki = process.env.ANVILORE_WIKI ?? join(raiz, "wiki");
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--wiki") {
      const valor = args[++i];
      if (!valor) { console.error("FAIL: --wiki exige um caminho"); return 1; }
      wiki = valor;
    } else {
      console.error(`FAIL: argumento desconhecido: ${arg}`); return 1;
    }
  }
  try {
    await iniciar({ raiz, wiki: resolve(wiki) });
    await new Promise<void>((concluir) => entrada.once("end", concluir));
    return 0;
  }
  catch (erro) { console.error(`FAIL: não foi possível iniciar o MCP: ${erro instanceof Error ? erro.message : String(erro)}`); return 1; }
}
