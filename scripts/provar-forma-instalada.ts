import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { instalar, valorDoPath } from "../src/comandos/instalar";

const raiz = resolve(import.meta.dir, "..");
const AGENTES = ["claude", "codex", "gemini", "copilot"] as const;
const PAYLOADS = {
  "escrita em raw": JSON.stringify({ tool_name: "Write", tool_input: { file_path: "raw/a.md", content: "x" } }),
  "escrita em wiki": JSON.stringify({ tool_name: "Write", tool_input: { file_path: "wiki/a.md", content: "cita raw/a.md" } }),
};

export type Forma = { agente: string; campo: string; comando: string; shells: string[]; informativos?: string[]; semBunInformativo?: boolean };
type Ambiente = Record<string, string | undefined>;

// Copia só o necessário para um clone reconhecido pelo instalador, num diretório temporário.
export async function prepararClone(): Promise<{ tmp: string; clone: string }> {
  const tmp = mkdtempSync(join(tmpdir(), "forma-instalada-"));
  const clone = join(tmp, "clone com espaço");
  mkdirSync(clone);
  for (const dir of ["src", "hooks", "skills"]) cpSync(join(raiz, dir), join(clone, dir), { recursive: true });
  writeFileSync(join(clone, "AGENTS.md"), "contrato");
  return { tmp, clone };
}

// Instala os quatro agentes (CLIs de mentira no PATH) e devolve as strings EXATAS que o instalador gravou.
export async function extrairFormas(clone: string): Promise<Forma[]> {
  const bin = join(dirname(clone), "bin");
  mkdirSync(bin, { recursive: true });
  for (const nome of AGENTES) writeFileSync(join(bin, process.platform === "win32" ? `${nome}.cmd` : nome), "echo teste\n", { mode: 0o755 });
  const caminho = process.env.PATH;
  process.env.PATH = `${bin}${delimiter}${valorDoPath() ?? ""}`;
  try {
    const r = await instalar({ alvos: [...AGENTES], destino: clone, simular: false });
    if (r.codigo !== 0) throw new Error(`instalação de teste falhou: ${r.mensagens.join(" | ")}`);
  } finally {
    if (caminho === undefined) delete process.env.PATH; else process.env.PATH = caminho;
  }
  const ler = (rel: string) => readFileSync(join(clone, rel), "utf8");
  const claude = JSON.parse(ler(".claude/settings.json")).hooks.PreToolUse[0].hooks[0];
  const codex = (Bun.TOML.parse(ler(".codex/config.toml")) as any).hooks.PreToolUse[0].hooks[0];
  const gemini = JSON.parse(ler(".gemini/settings.json")).hooks.BeforeTool[0].hooks[0];
  const copilot = JSON.parse(ler(".github/copilot/settings.json")).hooks.preToolUse[0];
  const windows = process.platform === "win32";
  // Codex e Gemini (R65) levam só a chamada ao bun: rc 2 do bun tem de chegar intacto em todos os shells. Sem bun eles não
  // fecham (limite declarado), então esse cenário é só medição para eles.
  const todos = ["bash", "pwsh", ...(windows ? ["cmd", "powershell"] : [])];
  return [
    { agente: "claude", campo: "command", comando: claude.command, shells: ["bash"] },
    { agente: "codex", campo: "command", comando: codex.command, shells: todos, semBunInformativo: true },
    // `command_windows` do Codex: forma PowerShell que mapeia qualquer falha (inclusive bun ausente) para 2.
    { agente: "codex", campo: "command_windows", comando: codex.command_windows, shells: ["pwsh", ...(windows ? ["powershell"] : [])] },
    { agente: "gemini", campo: "command", comando: gemini.command, shells: todos, semBunInformativo: true },
    { agente: "copilot", campo: "bash", comando: copilot.bash, shells: ["bash"] },
    { agente: "copilot", campo: "powershell", comando: copilot.powershell, shells: ["pwsh", ...(windows ? ["powershell"] : [])] },
  ];
}

// O mesmo ambiente sem o diretório do bun: o shell é chamado pelo caminho absoluto, então só o comando `bun` some.
export function ambienteSemBun(env: Ambiente, dirBun: string): Ambiente {
  const copia: Ambiente = {};
  for (const [chave, valor] of Object.entries(env)) if (chave.toUpperCase() !== "PATH") copia[chave] = valor;
  const nomes = process.platform === "win32" ? ["bun.exe", "bun.cmd", "bun"] : ["bun"];
  copia.PATH = (valorDoPath(env) ?? "").split(delimiter)
    .filter(dir => dir && resolve(dir) !== resolve(dirBun) && !nomes.some(nome => existsSync(join(dir, nome))))
    .join(delimiter);
  return copia;
}

// O Node (spawn com shell: true), que é como os agentes chamam o hook, monta `cmd.exe /d /s /c "<comando>"` SEM escapar as aspas internas
// (windowsVerbatimArguments). O Bun, por padrão, cita o argumento e escapa as aspas como \", que o cmd não entende: o caminho do clone
// chegava partido ao bun (`Script not found ""C:\...\clone`). A prova chama o cmd como o agente chama.
export function argumentosDoCmd(comando: string): { args: string[]; verbatim: boolean } {
  return { args: ["/d", "/s", "/c", `"${comando}"`], verbatim: true };
}

type ShellResolvido = { exe: string; args: (comando: string) => string[]; verbatim?: boolean };
function resolverShell(nome: string): ShellResolvido | undefined {
  const gitBash = join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe");
  switch (nome) {
    case "bash": {
      const exe = process.platform === "win32" && existsSync(gitBash) ? gitBash : Bun.which("bash");
      return exe ? { exe, args: comando => ["-c", comando] } : undefined;
    }
    case "cmd": {
      const exe = process.env.ComSpec ?? Bun.which("cmd");
      return exe ? { exe, args: comando => argumentosDoCmd(comando).args, verbatim: true } : undefined;
    }
    case "pwsh": case "powershell": {
      const exe = Bun.which(nome);
      return exe ? { exe, args: comando => ["-NoProfile", "-NonInteractive", "-Command", comando] } : undefined;
    }
  }
  return undefined;
}

// Cenários: raw bloqueia (2), wiki libera (0) e, sem o bun no PATH, a forma tem de dar 2: é o único código que Claude, Gemini e
// Copilot tratam como bloqueio (qualquer outro não-zero é aviso ou erro que segue). Para Codex e Gemini `command` isso é só medição.
export async function rodarCenarios(formas: Forma[], cwd: string = raiz): Promise<number> {
  const dirBun = dirname(Bun.which("bun") ?? process.execPath);
  let falhas = 0;
  // Comandos de anotação do GitHub Actions: uma linha só, com %, CR e LF escapados (propriedades também escapam : e ,).
  const escapar = (texto: string, propriedade = false) => {
    const base = texto.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
    return propriedade ? base.replaceAll(":", "%3A").replaceAll(",", "%2C") : base;
  };
  const anotar = (nivel: "error" | "warning", titulo: string, mensagem: string) => {
    if (process.env.GITHUB_ACTIONS === "true") console.log(`::${nivel} title=${escapar(titulo, true)}::${escapar(mensagem)}`);
  };
  const recorte = (texto: string) => texto.trim().replace(/\s+/g, " ").slice(0, 600);
  const relatar = (linha: string, falhou: boolean, informativo: boolean, detalhes: string[] = [], anotacao?: { titulo: string; mensagem: string }) => {
    if (falhou && !informativo) falhas++;
    console.log(`${falhou ? (informativo ? "INFO" : "FALHA") : "ok"}: ${linha}`);
    if (falhou) {
      for (const detalhe of detalhes) console.log(`    ${detalhe}`);
      if (anotacao) anotar(informativo ? "warning" : "error", anotacao.titulo, anotacao.mensagem);
    }
  };
  for (const forma of formas) {
    const rotulo = `${forma.agente}.${forma.campo}`;
    for (const [nome, informativo] of [...forma.shells.map(s => [s, false] as const), ...(forma.informativos ?? []).map(s => [s, true] as const)]) {
      const shell = resolverShell(nome);
      if (!shell) {
        // No CI (ANVILORE_EXIGIR_SHELLS=1) a ausência de um shell exigido reprova; fora dele, é um aviso em voz alta.
        relatar(`${rotulo} em ${nome}: shell indisponível neste sistema`, true, informativo || process.env.ANVILORE_EXIGIR_SHELLS !== "1",
          [`PATH: ${valorDoPath() ?? "(vazio)"}`, `plataforma: ${process.platform}`],
          { titulo: `${rotulo}/${nome}`, mensagem: `shell indisponível em ${process.platform}` });
        continue;
      }
      const rodar = (payload: string, env: Ambiente) => {
        const r = Bun.spawnSync([shell.exe, ...shell.args(forma.comando)], {
          cwd, env: { ...env, CLAUDE_PROJECT_DIR: cwd }, stdin: Buffer.from(payload), stdout: "pipe", stderr: "pipe",
          windowsVerbatimArguments: shell.verbatim === true,
        });
        return { codigo: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
      };
      const casos: Array<[string, number, string, Ambiente]> = [
        ["escrita em raw", 2, PAYLOADS["escrita em raw"], process.env],
        ["escrita em wiki", 0, PAYLOADS["escrita em wiki"], process.env],
        ["sem bun no PATH", 2, PAYLOADS["escrita em raw"], ambienteSemBun(process.env, dirBun)],
      ];
      for (const [cenario, esperado, payload, env] of casos) {
        const r = rodar(payload, env);
        const falhou = r.codigo !== esperado;
        relatar(`${rotulo} em ${nome}: ${cenario} → saída ${r.codigo} (esperado ${esperado})`, falhou, informativo || (cenario === "sem bun no PATH" && forma.semBunInformativo === true), [
          `shell: ${shell.exe} ${shell.args("<comando>").slice(0, -1).join(" ")}`, `comando: ${forma.comando}`, `cwd: ${cwd}`,
          `saída: ${r.codigo}`, `stdout: ${recorte(r.stdout)}`, `stderr: ${recorte(r.stderr)}`,
        ], {
          titulo: `${rotulo}/${nome}`,
          mensagem: `${cenario}: esperado ${esperado} obtido ${r.codigo}; stdout=${recorte(r.stdout)}; stderr=${recorte(r.stderr)}`,
        });
      }
    }
  }
  return falhas ? 1 : 0;
}

// `apenas`: restringe a prova a estes shells (o teste do `bun test` usa só o bash; a etapa do CI roda a matriz inteira).
export async function provar(apenas?: string[]): Promise<number> {
  const { tmp, clone } = await prepararClone();
  try {
    const formas = (await extrairFormas(clone)).map(f => apenas ? { ...f, shells: f.shells.filter(s => apenas.includes(s)), informativos: [] } : f);
    return await rodarCenarios(formas, clone);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (import.meta.main) process.exit(await provar());
