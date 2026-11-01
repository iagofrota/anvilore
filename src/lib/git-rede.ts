// Chamadas que falam com a rede ANTES de a autenticação passar. Valem o que o Anvilore decide, não a configuração
// global da pessoa: GIT_ALLOW_PROTOCOL vence qualquer protocol.<nome>.allow (um protocol.ext.allow=always deixaria um
// `url.<ext::programa>.insteadOf` executar código), o helper de credencial é zerado e nenhum programa de senha nem
// prompt de terminal é chamado. Só o protocolo da origem oficial (https; ssh se a pessoa clonou por ssh). A config
// global continua valendo no resto (proxy em http.proxy, por exemplo).
export const VERBOS_DE_REDE = new Set(["fetch", "ls-remote", "clone", "pull"]);
export const ORIGENS_SSH = new Set(["git@github.com:iagofrota/anvilore.git", "ssh://git@github.com/iagofrota/anvilore.git"]);

export function protocolosDaOrigem(origem?: string): string {
  if (!origem) return "https";
  if (ORIGENS_SSH.has(origem) || origem.startsWith("git@") || origem.startsWith("ssh://")) return "ssh";
  // Em testes e desenvolvimento local: caminho no disco (mas nunca file:// que o atualizador recusa)
  if (origem.startsWith("/") || /^[A-Za-z]:[\\/]/.test(origem) || origem.startsWith("\\\\") || origem.startsWith("./") || origem.startsWith("../")) return "file";
  return "https";
}

export function guardaDeRede(args: string[], env: NodeJS.ProcessEnv, origem?: string): { args: string[]; env: NodeJS.ProcessEnv } {
  if (!VERBOS_DE_REDE.has(args[0] ?? "")) return { args, env };
  return {
    args: ["-c", "credential.helper=", "-c", "core.askPass=", ...args],
    env: {
      ...env,
      GIT_ALLOW_PROTOCOL: protocolosDaOrigem(origem),
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "",
    },
  };
}

export function recusouTransporte(saida: string): boolean {
  return /transport '[^']*' not allowed/i.test(saida);
}

// Sem `trim`: a saída de `status`/`diff -z` começa com caracteres significativos.
// `env: process.env` explícito: sem ele o Bun não repassa ao git o que o processo mudou em process.env depois de subir.
export function execPadrao(args: string[], cwd: string): { codigo: number; saida: string } {
  const exe = Bun.which("git") ?? "git";
  // O valor CRU de remote.origin.url (o `get-url` expandiria um insteadOf) decide o protocolo permitido.
  const origem = VERBOS_DE_REDE.has(args[0] ?? "")
    ? Bun.spawnSync([exe, "-C", cwd, "config", "--get", "remote.origin.url"], { stdout: "pipe", stderr: "pipe", env: process.env }).stdout.toString().trim()
    : undefined;
  const g = guardaDeRede(args, process.env, origem);
  const p = Bun.spawnSync([exe, "-C", cwd, ...g.args], { stdout: "pipe", stderr: "pipe", env: g.env });
  return { codigo: p.exitCode, saida: `${p.stdout.toString()}${p.stderr.toString()}` };
}
