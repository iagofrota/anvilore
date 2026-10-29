import { tmpdir } from "node:os";

// Variáveis que redirecionam o kit ou o Git para fora do vault descartável. O servidor de teste nunca as recebe:
// `aprovarPaginas` e `caminhoWiki` leem `ANVILORE_WIKI` do ambiente, então herdá-la faria "Aprovar" gravar na wiki real.
const PROIBIDAS = /^(ANVILORE_|CLAUDE|ANTHROPIC_|GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|NAMESPACE)$)/;

export function variaveisProibidas(ambiente: NodeJS.ProcessEnv): string[] {
  return Object.keys(ambiente).filter(nome => PROIBIDAS.test(nome) && ambiente[nome] !== undefined).sort();
}

export function ambienteHermetico(origem: NodeJS.ProcessEnv, home: string): Record<string, string> {
  const nulo = process.platform === "win32" ? "NUL" : "/dev/null";
  return {
    PATH: origem.PATH ?? "",
    LANG: origem.LANG ?? "C.UTF-8",
    HOME: home,
    USERPROFILE: home,
    TMPDIR: tmpdir(),
    GIT_CONFIG_GLOBAL: nulo,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
}
