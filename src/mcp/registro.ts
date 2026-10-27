import { resolve } from "node:path";

export type Agente = "claude" | "codex" | "gemini" | "copilot";
export type Ambiente = { home: string; executar: (cmd: string[], timeoutMs?: number) => Promise<{ codigo: number; saida: string }>; existe: (bin: string) => Promise<boolean> };
export interface Registrador { agente: Agente; ligar(comando: string[], amb: Ambiente): Promise<"ligado" | "pulado">; desligar(amb: Ambiente, cliEsperada?: string): Promise<"removido" | "ausente">; ligado(amb: Ambiente, cliEsperada?: string): Promise<boolean> }

function linhaAnvilore(saida: string): string | undefined {
  const limpa = saida.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
  return limpa.split(/\r?\n/).find((linha) => /(?:^|[^\/\\\p{L}\p{N}_])anvilore(?:\s|:|$)/iu.test(linha));
}
function correspondeComando(linha: string | undefined, cliEsperada?: string): boolean {
  if (!linha || !/(?:^|[\\/])src[\\/]cli\.ts(?:\s|["']|$)/i.test(linha) || !/\bmcp\b/i.test(linha)) return false;
  if (!cliEsperada) return true;
  const normalizar = (caminho: string) => resolve(caminho).replaceAll("\\", "/");
  const esperado = normalizar(cliEsperada).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const flags = process.platform === "win32" ? "i" : "";
  return new RegExp(`(?:^|[\\s"'])${esperado}(?:["'])?\\s+mcp(?:\\s|$)`, flags).test(linha.replaceAll("\\", "/"));
}

const cli: Record<Agente, { add: (comando: string[]) => string[]; remove: string[]; list: string[] }> = {
  claude: { add: c => ["claude", "mcp", "add", "-s", "user", "anvilore", "--", ...c], remove: ["claude", "mcp", "remove", "-s", "user", "anvilore"], list: ["claude", "mcp", "list"] },
  codex: { add: c => ["codex", "mcp", "add", "anvilore", "--", ...c], remove: ["codex", "mcp", "remove", "anvilore"], list: ["codex", "mcp", "list"] },
  gemini: { add: c => ["gemini", "mcp", "add", "-s", "user", "anvilore", "--", ...c], remove: ["gemini", "mcp", "remove", "-s", "user", "anvilore"], list: ["gemini", "mcp", "list", "-s", "user"] },
  copilot: { add: c => ["copilot", "mcp", "add", "anvilore", "--", ...c], remove: ["copilot", "mcp", "remove", "anvilore"], list: ["copilot", "mcp", "list"] },
};

export function criarRegistrador(agente: Agente, timeoutMs = 5_000): Registrador {
  async function listarComTimeout(amb: Ambiente): Promise<{ codigo: number; saida: string }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        amb.executar(cli[agente].list, timeoutMs),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout ao consultar ${agente}`)), timeoutMs); }),
      ]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
  return {
    agente,
    async ligar(comando, amb) {
      if (!(await amb.existe(agente))) { console.warn(`AVISO: ${agente} não encontrado; configuração pulada.`); return "pulado"; }
      const estado = await listarComTimeout(amb);
      const cliEsperada = comando.find((parte) => /(?:^|[\\/])src[\\/]cli\.ts$/i.test(parte));
      if (estado.codigo !== 0) { console.warn(`AVISO: não foi possível consultar a configuração de ${agente}; configuração preservada.`); return "pulado"; }
      if (estado.codigo === 0 && linhaAnvilore(estado.saida)) {
        if (correspondeComando(linhaAnvilore(estado.saida), cliEsperada)) return "ligado";
        console.warn(`AVISO: ${agente} já tem um servidor chamado anvilore com outro comando; configuração preservada.`);
        return "pulado";
      }
      const resultado = await amb.executar(cli[agente].add(comando));
      if (resultado.codigo !== 0) { console.warn(`AVISO: não foi possível configurar ${agente}; configuração pulada.`); return "pulado"; }
      return "ligado";
    },
    async desligar(amb, cliEsperada) {
      if (!(await amb.existe(agente))) return "ausente";
      const estado = await listarComTimeout(amb);
      const linha = estado.codigo === 0 ? linhaAnvilore(estado.saida) : undefined;
      if (linha && !correspondeComando(linha, cliEsperada)) console.warn(`AVISO: ${agente} tem um servidor chamado anvilore com outro comando; configuração preservada.`);
      if (!correspondeComando(linha, cliEsperada)) return "ausente";
      const resultado = await amb.executar(cli[agente].remove);
      if (resultado.codigo !== 0) {
        console.warn(`AVISO: não foi possível remover ${agente}; configuração preservada${resultado.saida ? ` (${resultado.saida})` : ""}.`);
        return "ausente";
      }
      return "removido";
    },
    async ligado(amb, cliEsperada) {
      if (!(await amb.existe(agente))) return false;
      try {
        const resultado = await listarComTimeout(amb);
        return resultado.codigo === 0 && correspondeComando(linhaAnvilore(resultado.saida), cliEsperada);
      } catch (erro) {
        if (erro instanceof Error && erro.message.startsWith("timeout ao consultar ")) console.warn(`AVISO: não foi possível consultar ${agente}; a consulta excedeu ${timeoutMs} ms.`);
        throw erro;
      }
    },
  };
}

export const registradores: Registrador[] = (["claude", "codex", "gemini", "copilot"] as const).map(criarRegistrador);
