// Chamadas que falam com a rede ANTES de a autenticação passar. Valem o que o Anvilore decide, não a configuração
// global da pessoa: GIT_ALLOW_PROTOCOL vence qualquer protocol.<nome>.allow (um protocol.ext.allow=always deixaria um
// `url.<ext::programa>.insteadOf` executar código), o helper de credencial é zerado e nenhum programa de senha nem
// prompt de terminal é chamado. Só o protocolo da origem oficial (https; ssh se a pessoa clonou por ssh). A config
// global continua valendo no resto (proxy em http.proxy, por exemplo).
export const VERBOS_DE_REDE = new Set(["fetch", "ls-remote", "clone", "pull"]);
export const ORIGENS_SSH = new Set(["git@github.com:iagofrota/anvilore.git", "ssh://git@github.com/iagofrota/anvilore.git"]);

export function ehSsh(origem?: string): boolean {
  if (!origem) return false;
  if (ORIGENS_SSH.has(origem) || origem.startsWith("git@") || origem.startsWith("ssh://")) return true;
  // Sintaxe SCP alternativa do Git: [user@]host.xz:caminho/do/repo.git/
  // Deve conter ':' antes de qualquer barra, sem '::' ou '://', e sem ser letra de unidade do Windows.
  if (origem.includes("://") || origem.includes("::")) return false;
  if (origem.startsWith("/") || origem.startsWith("\\") || origem.startsWith("./") || origem.startsWith("../")) return false;
  if (/^[A-Za-z]:/.test(origem)) return false;
  return /^(?:[a-zA-Z0-9_.-]+@)?[a-zA-Z0-9_.-]+:[^:].*$/.test(origem);
}

export function protocolosDaOrigem(origem?: string): string {
  if (!origem) return "https";
  if (ehSsh(origem)) return "ssh";
  // URLs com esquema explícito (https://, file://, ext::, etc.): nunca file
  if (origem.includes("://") || origem.includes("::")) return "https";
  // Qualquer outro caminho no disco (absoluto, com drive letter, com ./ ou ../, ou relativo simples como remotes/origem.git)
  return "file";
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

export function resolverOrigem(args: string[], cwd: string, exe: string | null = Bun.which("git")): string | undefined {
  if (!exe) return undefined;
  if (!VERBOS_DE_REDE.has(args[0] ?? "")) return undefined;

  // 1. Procura se algum argumento posicional após o verbo indica o repositório/remoto (ex: git fetch origin, git clone <url>)
  let pos: string | undefined;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === "--") {
      pos = args[i + 1];
      break;
    }
    if (a.startsWith("-")) {
      if (a === "--depth" || a === "--upload-pack" || a === "-o" || a === "--server-option") {
        i++;
      }
      continue;
    }
    pos = a;
    break;
  }

  const primeiraUrl = (remoto: string): string | undefined => {
    // Quando um remoto possui múltiplas URLs, o Git utiliza a primeira para fetch.
    // `config --get` retornaria a última, portanto usamos `--get-all` e pegamos a primeira linha.
    const saida = Bun.spawnSync([exe, "-C", cwd, "config", "--get-all", `remote.${remoto}.url`], { stdout: "pipe", stderr: "pipe", env: process.env }).stdout.toString().trim();
    if (!saida) return undefined;
    return saida.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
  };

  if (pos) {
    // Se o argumento posicional for o nome de um remoto configurado, lê o valor CRU da primeira URL de remote.<pos>.url
    const url = primeiraUrl(pos);
    if (url) return url;
    return pos;
  }

  // 2. Sem argumento posicional no comando (ex: `git pull --ff-only`), Git usa o remoto configurado para o ramo atual
  const ramo = Bun.spawnSync([exe, "-C", cwd, "symbolic-ref", "--short", "-q", "HEAD"], { stdout: "pipe", stderr: "pipe", env: process.env }).stdout.toString().trim();
  const remotoDoRamo = ramo
    ? Bun.spawnSync([exe, "-C", cwd, "config", "--get", `branch.${ramo}.remote`], { stdout: "pipe", stderr: "pipe", env: process.env }).stdout.toString().trim()
    : "";
  const remoto = remotoDoRamo || "origin";

  const url = primeiraUrl(remoto);
  if (url) return url;

  if (remotoDoRamo && !remotoDoRamo.includes("://") && !remotoDoRamo.includes("::")) {
    return remotoDoRamo;
  }

  return undefined;
}

// Sem `trim`: a saída de `status`/`diff -z` começa com caracteres significativos.
// `env: process.env` explícito: sem ele o Bun não repassa ao git o que o processo mudou em process.env depois de subir.
export function execPadrao(args: string[], cwd: string): { codigo: number; saida: string } {
  const exe = Bun.which("git");
  if (exe === null) return { codigo: 127, saida: "git ausente do PATH" };
  try {
    // O valor CRU de remote.<remoto>.url (o `get-url` expandiria um insteadOf) decide o protocolo permitido.
    const origem = resolverOrigem(args, cwd, exe);
    const g = guardaDeRede(args, process.env, origem);
    const p = Bun.spawnSync([exe, "-C", cwd, ...g.args], { stdout: "pipe", stderr: "pipe", env: g.env });
    return { codigo: p.exitCode, saida: `${p.stdout.toString()}${p.stderr.toString()}` };
  } catch (erro) {
    return { codigo: 126, saida: erro instanceof Error ? erro.message : String(erro) };
  }
}
