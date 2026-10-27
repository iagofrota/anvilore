import { resolve, join } from "node:path";
import { statSync } from "node:fs";
import { criarNucleo } from "../busca/nucleo";
import { registradores, type Agente, type Ambiente } from "../mcp/registro";

function ambiente(): Ambiente {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return {
    home,
    existe: async bin => Bun.which(bin) !== null,
    executar: async (cmd, timeoutMs) => {
      const processo = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", env: { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: join(home, ".codex") }, ...(timeoutMs === undefined ? {} : { signal: AbortSignal.timeout(timeoutMs + 100) }) });
      const [stdout, stderr, codigo] = await Promise.all([new Response(processo.stdout).text(), new Response(processo.stderr).text(), processo.exited]);
      return { codigo, saida: stdout + stderr };
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
  const posicionais = args.slice(1).filter((item) => item !== "--agente" && item !== "todos");
  const flag = args.indexOf("--agente");
  const valorFlag = flag >= 0 ? args[flag + 1] : undefined;
  const nomesArg = valorFlag === "todos" ? [] : valorFlag ? [valorFlag] : posicionais;
  const nomes: Agente[] = nomesArg.filter((item): item is Agente => ["claude", "codex", "gemini", "copilot"].includes(item));
  if (args.filter((item) => item === "--agente").length > 1 || (flag >= 0 && (!valorFlag || !["todos", "claude", "codex", "gemini", "copilot"].includes(valorFlag))) || posicionais.some((item) => !["claude", "codex", "gemini", "copilot"].includes(item)) || (valorFlag && posicionais.length > 0)) { console.error("Uso: anvilore mcp [ligar|desligar|estado] [--agente claude|codex|gemini|copilot|todos]"); return 2; }
  const selecionados = nomes.length ? registradores.filter(r => nomes.includes(r.agente)) : registradores;
  const raiz = raizDoClone();
  const comando = ["bun", resolve(raiz, "src/cli.ts"), "mcp"];
  if (acao === "ligar") {
    const relatorio = await nucleoDaRaiz(raiz).indexar(); console.log(`Índice atualizado: ${JSON.stringify(relatorio)}`);
    let ligados = 0;
    for (const r of selecionados) {
      try { if (await r.ligar(comando, amb) === "ligado") ligados++; }
      catch { console.warn(`AVISO: falha ao configurar ${r.agente}; seguindo para o próximo agente.`); }
    }
    return ligados ? 0 : 1;
  }
  if (acao === "desligar") {
    let removidos = 0;
    for (const r of selecionados) {
      try { if (await r.desligar(amb, join(raiz, "src", "cli.ts")) === "removido") removidos++; }
      catch { console.warn(`AVISO: não foi possível consultar ou desligar ${r.agente}; seguindo para o próximo agente.`); }
    }
    console.log(`MCP removido de ${removidos} agente(s).`); return 0;
  }
  if (acao !== "estado") { console.error("Uso: anvilore mcp [ligar|desligar|estado] [--agente claude|codex|gemini|copilot|todos]"); return 2; }
  const ligados = [];
  for (const r of selecionados) {
    try { if (await r.ligado(amb, join(raiz, "src", "cli.ts"))) ligados.push(r.agente); }
    catch { /* agente indisponível não interrompe o estado dos demais */ }
  }
  const nucleo = nucleoDaRaiz(raiz);
  const resumo = await nucleo.resumoDaWiki();
  const arquivoIndice = join(process.env.ANVILORE_DIR ? resolve(process.env.ANVILORE_DIR) : join(raiz, ".anvilore"), "indice.db");
  let ultimaReindexacao = "desconhecida";
  try { ultimaReindexacao = statSync(arquivoIndice).mtime.toISOString(); } catch { /* índice ainda não criado */ }
  console.log(`Agentes MCP ligados: ${ligados.join(", ") || "nenhum"}\nPáginas: ${resumo.paginas}\nÍndice: ${arquivoIndice}\nÚltima reindexação: ${ultimaReindexacao}`);
  return 0;
}
