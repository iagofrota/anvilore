export type Agente = "claude" | "codex" | "gemini" | "copilot";
export type Ambiente = { home: string; executar: (cmd: string[]) => Promise<{ codigo: number; saida: string }>; existe: (bin: string) => Promise<boolean> };
export interface Registrador { agente: Agente; ligar(comando: string[], amb: Ambiente): Promise<"ligado" | "pulado">; desligar(amb: Ambiente): Promise<"removido" | "ausente">; ligado(amb: Ambiente): Promise<boolean> }

const cli: Record<Agente, { add: (comando: string[]) => string[]; remove: string[]; list: string[] }> = {
  claude: { add: c => ["claude", "mcp", "add", "-s", "user", "anvilore", "--", ...c], remove: ["claude", "mcp", "remove", "-s", "user", "anvilore"], list: ["claude", "mcp", "list"] },
  codex: { add: c => ["codex", "mcp", "add", "anvilore", "--", ...c], remove: ["codex", "mcp", "remove", "anvilore"], list: ["codex", "mcp", "list"] },
  gemini: { add: c => ["gemini", "mcp", "add", "-s", "user", "anvilore", ...c], remove: ["gemini", "mcp", "remove", "-s", "user", "anvilore"], list: ["gemini", "mcp", "list", "-s", "user"] },
  copilot: { add: c => ["copilot", "mcp", "add", "anvilore", "--", ...c], remove: ["copilot", "mcp", "remove", "anvilore"], list: ["copilot", "mcp", "list"] },
};

export function criarRegistrador(agente: Agente): Registrador {
  return {
    agente,
    async ligar(comando, amb) {
      if (!(await amb.existe(agente))) { console.warn(`AVISO: ${agente} não encontrado; configuração pulada.`); return "pulado"; }
      const resultado = await amb.executar(cli[agente].add(comando));
      if (resultado.codigo !== 0) throw new Error(`${agente}: ${resultado.saida}`);
      return "ligado";
    },
    async desligar(amb) {
      if (!(await amb.existe(agente))) return "ausente";
      const estado = await amb.executar(cli[agente].list);
      if (estado.codigo !== 0 || !/anvilore/i.test(estado.saida)) return "ausente";
      const resultado = await amb.executar(cli[agente].remove);
      if (resultado.codigo !== 0) throw new Error(`${agente}: ${resultado.saida}`);
      return "removido";
    },
    async ligado(amb) {
      if (!(await amb.existe(agente))) return false;
      const resultado = await amb.executar(cli[agente].list);
      return resultado.codigo === 0 && /anvilore/i.test(resultado.saida);
    },
  };
}

export const registradores: Registrador[] = (["claude", "codex", "gemini", "copilot"] as const).map(criarRegistrador);
