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

export type Forma = { agente: string; campo: string; comando: string; shells: string[]; informativos?: string[] };
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
  const comBarras = ["bash", "pwsh", ...(windows ? ["cmd"] : [])];
  return [
    { agente: "claude", campo: "command", comando: claude.command, shells: ["bash"] },
    { agente: "codex", campo: "command", comando: codex.command, shells: comBarras, informativos: windows ? ["powershell"] : [] },
    { agente: "gemini", campo: "command", comando: gemini.command, shells: comBarras, informativos: windows ? ["powershell"] : [] },
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

function resolverShell(nome: string): { exe: string; args: (comando: string) => string[] } | undefined {
  const gitBash = join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe");
  switch (nome) {
    case "bash": {
      const exe = process.platform === "win32" && existsSync(gitBash) ? gitBash : Bun.which("bash");
      return exe ? { exe, args: comando => ["-c", comando] } : undefined;
    }
    case "cmd": {
      const exe = process.env.ComSpec ?? Bun.which("cmd");
      return exe ? { exe, args: comando => ["/d", "/s", "/c", comando] } : undefined;
    }
    case "pwsh": case "powershell": {
      const exe = Bun.which(nome);
      return exe ? { exe, args: comando => ["-NoProfile", "-NonInteractive", "-Command", comando] } : undefined;
    }
  }
  return undefined;
}

// Cenários: raw bloqueia (2), wiki libera (0) e, sem o bun no PATH, a forma NÃO pode liberar (saída diferente de 0).
export async function rodarCenarios(formas: Forma[], cwd: string = raiz): Promise<number> {
  const dirBun = dirname(Bun.which("bun") ?? process.execPath);
  let falhas = 0;
  const relatar = (linha: string, falhou: boolean, informativo: boolean) => {
    if (falhou && !informativo) falhas++;
    console.log(`${falhou ? (informativo ? "INFO" : "FALHA") : "ok"}: ${linha}`);
  };
  for (const forma of formas) {
    const rotulo = `${forma.agente}.${forma.campo}`;
    for (const [nome, informativo] of [...forma.shells.map(s => [s, false] as const), ...(forma.informativos ?? []).map(s => [s, true] as const)]) {
      const shell = resolverShell(nome);
      if (!shell) {
        // No CI (ANVILORE_EXIGIR_SHELLS=1) a ausência de um shell exigido reprova; fora dele, é um aviso em voz alta.
        relatar(`${rotulo} em ${nome}: shell indisponível neste sistema`, true, informativo || process.env.ANVILORE_EXIGIR_SHELLS !== "1");
        continue;
      }
      const rodar = (payload: string, env: Ambiente) => Bun.spawnSync([shell.exe, ...shell.args(forma.comando)], {
        cwd, env: { ...env, CLAUDE_PROJECT_DIR: cwd }, stdin: Buffer.from(payload), stdout: "pipe", stderr: "pipe",
      }).exitCode;
      const casos: Array<[string, number | undefined, number, Ambiente]> = [
        ["escrita em raw", 2, rodar(PAYLOADS["escrita em raw"], process.env), process.env],
        ["escrita em wiki", 0, rodar(PAYLOADS["escrita em wiki"], process.env), process.env],
        ["sem bun no PATH", undefined, rodar(PAYLOADS["escrita em raw"], ambienteSemBun(process.env, dirBun)), process.env],
      ];
      for (const [cenario, esperado, obtido] of casos) {
        const falhou = esperado === undefined ? obtido === 0 : obtido !== esperado;
        relatar(`${rotulo} em ${nome}: ${cenario} → saída ${obtido} (esperado ${esperado ?? "diferente de 0"})`, falhou, informativo);
      }
    }
  }
  return falhas ? 1 : 0;
}

export async function provar(): Promise<number> {
  const { tmp, clone } = await prepararClone();
  try {
    return await rodarCenarios(await extrairFormas(clone), clone);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (import.meta.main) process.exit(await provar());
