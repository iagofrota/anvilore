import { resolve, join } from "node:path";
import { criarNucleo } from "../busca/nucleo";
import { registradores, type Agente, type Ambiente } from "../mcp/registro";

function ambiente(): Ambiente {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return {
    home,
    existe: async bin => Bun.which(bin) !== null,
    executar: async cmd => {
      const processo = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe", env: { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: join(home, ".codex") } });
      return { codigo: processo.exitCode, saida: processo.stdout.toString() + processo.stderr.toString() };
    },
  };
}

function nucleoDaRaiz(raiz: string) {
  const wiki = process.env.ANVILORE_WIKI ? resolve(process.env.ANVILORE_WIKI) : join(raiz, "wiki");
  const dados = process.env.ANVILORE_DIR ? resolve(process.env.ANVILORE_DIR) : join(raiz, ".anvilore");
  return criarNucleo({ raiz, wiki, arquivoDb: join(dados, "indice.db") });
}

function raizDoClone(): string { return resolve(import.meta.dir, "../.."); }

export async function comandoIndexar(args: string[]): Promise<number> {
  if (args.some(arg => arg !== "--completo") || args.filter(arg => arg === "--completo").length > 1) { console.error("Uso: anvilore indexar [--completo]"); return 2; }
  const relatorio = await nucleoDaRaiz(raizDoClone()).indexar({ completo: args.includes("--completo") });
  console.log(JSON.stringify(relatorio, null, 2)); return 0;
}

export async function comandoMcp(args: string[], amb: Ambiente = ambiente()): Promise<number> {
  if (args.length === 0) return (await import("./mcp-servidor")).comandoMcpServidor(args);
  if (args.includes("--wiki")) return (await import("./mcp-servidor")).comandoMcpServidor(args);
  const acao = args[0] ?? "estado";
  const nomes: Agente[] = args.slice(1).filter((item): item is Agente => ["claude", "codex", "gemini", "copilot"].includes(item));
  if (args.length > (acao === "estado" ? 1 : 2) || args.slice(1).some(item => !["claude", "codex", "gemini", "copilot"].includes(item))) { console.error("Uso: anvilore mcp [ligar|desligar|estado] [claude|codex|gemini|copilot]"); return 2; }
  const selecionados = nomes.length ? registradores.filter(r => nomes.includes(r.agente)) : registradores;
  const raiz = raizDoClone();
  const comando = ["bun", resolve(raiz, "src/cli.ts"), "mcp"];
  if (acao === "ligar") {
    const relatorio = await nucleoDaRaiz(raiz).indexar(); console.log(`Índice atualizado: ${JSON.stringify(relatorio)}`);
    let ligados = 0;
    for (const r of selecionados) if (await r.ligar(comando, amb) === "ligado") ligados++;
    return ligados ? 0 : 1;
  }
  if (acao === "desligar") {
    let removidos = 0;
    for (const r of selecionados) if (await r.desligar(amb) === "removido") removidos++;
    console.log(`MCP removido de ${removidos} agente(s).`); return 0;
  }
  if (acao !== "estado") { console.error("Uso: anvilore mcp [ligar|desligar|estado] [claude|codex|gemini|copilot]"); return 2; }
  const ligados = [];
  for (const r of selecionados) if (await r.ligado(amb)) ligados.push(r.agente);
  const resumo = await nucleoDaRaiz(raiz).resumoDaWiki();
  const relatorio = await nucleoDaRaiz(raiz).indexar();
  console.log(`Agentes MCP ligados: ${ligados.join(", ") || "nenhum"}\nPáginas: ${resumo.paginas}\nÚltima reindexação: ${relatorio.reindexadas} reindexadas em ${relatorio.ms} ms`);
  return 0;
}
