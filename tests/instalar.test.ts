import { afterEach, beforeEach, expect, test } from "bun:test";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { instalar, ligarDiretorio, comandoInstalar, type Alvo } from "../src/comandos/instalar";
import { executar } from "../src/cli";

const raiz = resolve(import.meta.dir, "..");
let tmp: string, destino: string, lar: string;
const ambiente = { ...process.env };
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "instalar-"));
  destino = join(tmp, "clone com espaço"); lar = join(tmp, "lar");
  mkdirSync(lar); mkdirSync(destino);
  writeFileSync(join(destino, "AGENTS.md"), "Contrato local");
  mkdirSync(join(destino, "skills")); mkdirSync(join(destino, "hooks"));
  writeFileSync(join(destino, "hooks/proteger-raw.sh"), "hook");
  const bin = join(tmp, "bin"); mkdirSync(bin);
  for (const alvo of ["claude", "codex", "gemini", "copilot"]) {
    writeFileSync(join(bin, process.platform === "win32" ? `${alvo}.cmd` : alvo), "echo teste\n", { mode: 0o755 });
  }
  process.env.PATH = bin; process.env.HOME = lar; process.env.USERPROFILE = lar;
});
afterEach(() => {
  for (const chave of Object.keys(process.env)) if (!(chave in ambiente)) delete process.env[chave];
  Object.assign(process.env, ambiente);
  rmSync(tmp, { recursive: true, force: true });
});

function captura(dir: string): unknown {
  return readdirSync(dir).sort().map(nome => {
    const caminho = join(dir, nome), info = lstatSync(caminho);
    return [nome, info.mtimeMs, info.isSymbolicLink() ? readlinkSync(caminho) : info.isDirectory() ? captura(caminho) : readFileSync(caminho, "utf8")];
  });
}
function rodar(alvos: Alvo[] = ["claude"], simular = false) { return instalar({ alvos, destino, simular }); }

test("Dado destino com espaço Quando instalo quatro agentes e repito Então INALTERADO sem mudar arquivo ou HOME", async () => {
  const r = await rodar(["claude", "codex", "gemini", "copilot"]);
  expect(r.codigo).toBe(0); expect(r.veredito).toBe("MUDOU");
  expect(JSON.parse(readFileSync(join(destino, ".claude/settings.json"), "utf8")).hooks.PreToolUse.length).toBe(1);
  expect(readFileSync(join(destino, ".codex/config.toml"), "utf8")).toContain('matcher = "apply_patch|Edit|Write"');
  expect(JSON.parse(readFileSync(join(destino, ".gemini/settings.json"), "utf8")).context.fileName).toEqual(["AGENTS.md", "GEMINI.md"]);
  expect(JSON.parse(readFileSync(join(destino, ".github/copilot/settings.json"), "utf8")).hooks.preToolUse[0].bash).toBe("./hooks/proteger-raw.sh");
  const antes = captura(destino);
  expect((await rodar(["claude", "codex", "gemini", "copilot"])).veredito).toBe("INALTERADO");
  expect(captura(destino)).toEqual(antes); expect(readdirSync(lar)).toEqual([]);
  for (const rel of [".claude/skills/lint/SKILL.md", ".agents/skills/lint/SKILL.md", ".github/agents/lint.agent.md"]) {
    expect(realpathSync(join(destino, rel))).toBe(realpathSync(join(raiz, "skills/lint/SKILL.md")));
  }
  expect(readFileSync(join(destino, ".gemini/commands/lint.toml"), "utf8")).toContain("skills/lint/SKILL.md");
});

test("Dado simulação Quando executo Então não muda disco e a mesma chamada real muda", async () => {
  const antes = captura(destino);
  expect((await rodar(["claude", "codex", "gemini", "copilot"], true)).veredito).toBe("MUDOU");
  expect(captura(destino)).toEqual(antes);
  await rodar(); expect(captura(destino)).not.toEqual(antes);
});

test("Dado configuração pessoal Quando fundo Então preserva preferências e acrescenta o hook", async () => {
  mkdirSync(join(destino, ".claude"));
  writeFileSync(join(destino, ".claude/settings.json"), JSON.stringify({ pessoal: "meu", hooks: { PreToolUse: [{ matcher: "Bash" }] } }));
  mkdirSync(join(destino, ".codex")); writeFileSync(join(destino, ".codex/config.toml"), "model = 'meu'\n");
  expect((await rodar(["claude", "codex"])).codigo).toBe(0);
  const json = JSON.parse(readFileSync(join(destino, ".claude/settings.json"), "utf8"));
  expect(json.pessoal).toBe("meu"); expect(json.hooks.PreToolUse).toContainEqual({ matcher: "Bash" });
  expect(json.hooks.PreToolUse.length).toBe(2);
  expect(readFileSync(join(destino, ".codex/config.toml"), "utf8")).toContain("model = 'meu'\n");
});

test("Dado configuração divergente Quando instalo Então para explica caminho e preserva bytes", async () => {
  mkdirSync(join(destino, ".gemini")); const arq = join(destino, ".gemini/settings.json");
  const texto = '{"context":{"fileName":"GEMINI.md"}}\n'; writeFileSync(arq, texto);
  const r = await rodar(["gemini"]);
  expect(r.codigo).toBe(4); expect(r.mensagens.join("\n")).toContain("context.fileName");
  expect(r.mensagens.join("\n")).toContain("RECUSADO"); expect(readFileSync(arq, "utf8")).toBe(texto);
});

test("Dado JSON inválido Quando instalo Então falha explicitamente sem sobrescrever", async () => {
  mkdirSync(join(destino, ".claude")); writeFileSync(join(destino, ".claude/settings.json"), "{ruim");
  const r = await rodar(); expect(r.codigo).toBe(4); expect(r.mensagens.join("\n")).toContain("JSON");
  expect(readFileSync(join(destino, ".claude/settings.json"), "utf8")).toBe("{ruim");
});

test("Dado configuração JSON vazia Quando instalo Então recusa sem tratá-la como ausente", async () => {
  mkdirSync(join(destino, ".claude")); const caminho = join(destino, ".claude/settings.json");
  writeFileSync(caminho, "");
  expect((await rodar()).codigo).toBe(4);
  expect(readFileSync(caminho, "utf8")).toBe("");
});

test("Dado CLI ausente Quando instalo todos Então relata e pula só o ausente com sucesso", async () => {
  rmSync(join(tmp, "bin", process.platform === "win32" ? "codex.cmd" : "codex"));
  const r = await rodar(["claude", "codex"]);
  expect(r.codigo).toBe(0); expect(r.ausentes).toEqual(["codex"]);
  expect(r.mensagens.join("\n")).toContain("ausente");
  expect(existsSync(join(destino, ".claude/settings.json"))).toBe(true);
  expect(existsSync(join(destino, ".codex"))).toBe(false);
});

test("Dado página pessoal Quando recrio esqueleto e repito Então preserva conteúdo e fronteira versionada", async () => {
  mkdirSync(join(destino, "wiki/exemplo/concepts"), { recursive: true });
  writeFileSync(join(destino, "wiki/exemplo/concepts/pessoal.md"), "PESSOAL");
  await rodar();
  const esperados = ["wiki/.gitignore", ...readFileSync(join(raiz, "wiki/.gitignore"), "utf8").split("\n").filter(l => l.startsWith("!") && !l.endsWith("/") && l !== "!.gitignore").map(l => `wiki/${l.slice(1)}`)];
  for (const rel of esperados) expect(readFileSync(join(destino, rel), "utf8")).toBe(readFileSync(join(raiz, rel), "utf8"));
  expect(readFileSync(join(destino, "wiki/exemplo/concepts/pessoal.md"), "utf8")).toBe("PESSOAL");
});

test("Dado link antigo e diretório pessoal Quando instalo Então corrige link e preserva diretório avisando", async () => {
  mkdirSync(join(destino, ".claude/skills/lint"), { recursive: true });
  writeFileSync(join(destino, ".claude/skills/lint/meu"), "meu");
  symlinkSync(raiz, join(destino, ".claude/skills/query"), process.platform === "win32" ? "junction" : "dir");
  const r = await rodar();
  expect(r.mensagens.join("\n")).toContain("preservado");
  expect(readFileSync(join(destino, ".claude/skills/lint/meu"), "utf8")).toBe("meu");
  expect(realpathSync(join(destino, ".claude/skills/query"))).toBe(realpathSync(join(raiz, "skills/query")));
});

test("Dado diretório fonte Quando ligo e repito Então usa link ou junção sem copiar", async () => {
  const link = join(tmp, "ligacao");
  expect(await ligarDiretorio(destino, link)).toBe("criado");
  expect(await ligarDiretorio(destino, link)).toBe("ja-correto");
  writeFileSync(join(destino, "vivo"), "vivo");
  expect(readFileSync(join(link, "vivo"), "utf8")).toBe("vivo");
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  expect(await ligarDiretorio(destino, join(tmp, "pai-ausente/link"))).toBe("falhou");
  expect(existsSync(join(tmp, "pai-ausente/link"))).toBe(false);
});

test("Dado destino inválido ou HOME Quando executo Então recusa sem escrever", async () => {
  expect((await instalar({ alvos: ["claude"], destino: lar, simular: false })).codigo).toBe(1);
  expect((await instalar({ alvos: ["claude"], destino: join(tmp, "ausente"), simular: false })).codigo).toBe(1);
  rmSync(join(destino, "AGENTS.md"));
  const antes = captura(destino); expect((await rodar()).codigo).toBe(1);
  expect(captura(destino)).toEqual(antes); expect(readdirSync(lar)).toEqual([]);
});

test("Dado argumentos de instalar Quando comando é despachado Então valida alvos opções e ambiente", async () => {
  expect(await executar(["instalar", "--destino", destino, "--alvo", "claude"])).toBe(0);
  expect(await comandoInstalar(["--help"])).toBe(0);
  for (const args of [["--alvo", "outro"], ["--alvo"], ["--destino"], ["--ruim"], ["extra"]]) expect(await comandoInstalar(args)).toBe(1);
  process.env.ANVILORE_DESTINO = destino;
  expect(await comandoInstalar(["--alvo=codex", "--simular"])).toBe(0);
  expect(existsSync(join(destino, ".codex"))).toBe(false);
  expect(await comandoInstalar([`--destino=${destino}`, "--alvo=todos"])).toBe(0);
});

function copiarFonte() {
  const copia = join(tmp, "fonte"); mkdirSync(copia);
  for (const rel of ["src", "hooks", "skills", "wiki"]) cpSync(join(raiz, rel), join(copia, rel), { recursive: true });
  writeFileSync(join(copia, "AGENTS.md"), "contrato");
  return copia;
}
function executarCopia(copia: string, caminho = `${join(tmp, "bin")}${delimiter}${ambiente.PATH}`) {
  return Bun.spawnSync([process.execPath, join(copia, "src/cli.ts"), "instalar", "--destino", destino, "--alvo", "claude,codex,copilot"], {
    env: { ...process.env, PATH: caminho }, stdout: "pipe", stderr: "pipe",
  });
}

test("Dado fonte distinta com skill nova Quando instalo Então links apontam à fonte e recebem edições vivas", () => {
  const copia = copiarFonte();
  mkdirSync(join(copia, "skills/nova")); writeFileSync(join(copia, "skills/nova/SKILL.md"), "MARCA DA FONTE");
  mkdirSync(join(destino, "skills/lint")); writeFileSync(join(destino, "skills/lint/SKILL.md"), "MARCA DO DESTINO");
  expect(executarCopia(copia).exitCode).toBe(0);
  for (const rel of [".claude/skills/nova/SKILL.md", ".agents/skills/nova/SKILL.md", ".github/agents/nova.agent.md"]) {
    expect(readFileSync(join(destino, rel), "utf8")).toBe("MARCA DA FONTE");
  }
  writeFileSync(join(copia, "skills/lint/SKILL.md"), "EDIÇÃO VIVA");
  expect(readFileSync(join(destino, ".claude/skills/lint/SKILL.md"), "utf8")).toBe("EDIÇÃO VIVA");
  if (process.platform !== "win32") expect(readlinkSync(join(destino, ".claude/skills/lint"))).toBe("../../../fonte/skills/lint");
});

test("Dado wiki apagada na fonte Quando instalo Então recupera do último commit ou falha explicitamente sem git", () => {
  const copia = copiarFonte();
  const git = Bun.which("git", { PATH: ambiente.PATH }); expect(git).not.toBeNull();
  for (const args of [["init", "-q"], ["add", "wiki"], ["-c", "user.name=Teste", "-c", "user.email=teste@exemplo", "commit", "-qm", "fixture"]]) {
    expect(Bun.spawnSync([git!, "-C", copia, ...args], { env: { ...ambiente, HOME: lar, USERPROFILE: lar } }).exitCode).toBe(0);
  }
  rmSync(join(copia, "wiki"), { recursive: true });
  const semGit = executarCopia(copia, join(tmp, "bin"));
  expect(semGit.exitCode).toBe(4); expect(semGit.stdout.toString()).toContain("git ausente");
  const comGit = executarCopia(copia);
  expect(comGit.exitCode).toBe(0);
  expect(readFileSync(join(destino, "wiki/index.md"), "utf8")).toBe(readFileSync(join(raiz, "wiki/index.md"), "utf8"));
});

test("Dado esqueleto ausente sem commit Quando instalo Então reprova em vez de inventar conteúdo", () => {
  const copia = copiarFonte(); rmSync(join(copia, "wiki"), { recursive: true });
  const r = executarCopia(copia);
  expect(r.exitCode).toBe(4); expect(r.stdout.toString()).toContain("último commit");
  expect(existsSync(join(destino, "wiki"))).toBe(false);
});

test("Dado destino com configuração ilegível Quando instalo Então relata erro sem sucesso silencioso", async () => {
  mkdirSync(join(destino, ".claude/settings.json"), { recursive: true });
  expect((await rodar()).codigo).toBe(4);
});
