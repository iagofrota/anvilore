import { afterEach, beforeEach, expect, test } from "bun:test";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { instalar, ligarDiretorio, comandoInstalar, valorDoPath, type Alvo } from "../src/comandos/instalar";
import { ehExemplo, pecasDoModelo } from "../src/lib/modelos";
import { executar } from "../src/cli";
import { capturarConsole } from "./apoio/console";

const raiz = resolve(import.meta.dir, "..");
let tmp: string, destino: string, lar: string;
let consoleCapturado: ReturnType<typeof capturarConsole>;
const ambiente = { ...process.env };
const comandoRelativo = "bun ./src/cli.ts hook proteger-raw || exit 2";
// R65: Codex e Gemini chamam o bun pelo caminho absoluto do clone e propagam o código com `; exit $LASTEXITCODE` (sem `||`).
const comandoWindowsCodex = () => `bun "${join(real(destino), "src", "cli.ts")}" hook proteger-raw; if ($LASTEXITCODE -ne 0) { exit 2 }`;
const comandoAbsoluto = () => `bun "${join(real(destino), "src", "cli.ts")}" hook proteger-raw; exit $LASTEXITCODE`;
const comandoPowershell = "bun ./src/cli.ts hook proteger-raw; if ($LASTEXITCODE -ne 0) { exit 2 }";
const pathOriginal = valorDoPath(ambiente);
const real = (caminho: string) => realpathSync.native(caminho);
const comBarras = (texto: string) => texto.replaceAll("\\", "/");
beforeEach(() => {
  consoleCapturado = capturarConsole();
  tmp = mkdtempSync(join(tmpdir(), "instalar-"));
  destino = join(tmp, "clone com espaço"); lar = join(tmp, "lar");
  mkdirSync(lar); mkdirSync(destino);
  writeFileSync(join(destino, "AGENTS.md"), "Contrato local");
  mkdirSync(join(destino, "skills")); mkdirSync(join(destino, "src"));
  writeFileSync(join(destino, "src/cli.ts"), "cli");
  const bin = join(tmp, "bin"); mkdirSync(bin);
  for (const alvo of ["claude", "codex", "gemini", "copilot", "rg"]) {
    writeFileSync(join(bin, process.platform === "win32" ? `${alvo}.cmd` : alvo), "echo teste\n", { mode: 0o755 });
  }
  process.env.PATH = bin; process.env.HOME = lar; process.env.USERPROFILE = lar;
  process.env.BUN_INSTALL = join(tmp, "bun");
  process.env.BUN_INSTALL_CACHE_DIR = join(tmp, "bun-cache");
  process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH = join(tmp, "bun-transpiler");
  process.env.XDG_CACHE_HOME = join(tmp, "cache");
});
afterEach(() => {
  try { expect(readdirSync(lar)).toEqual([]); }
  finally {
    consoleCapturado.restaurar();
    for (const chave of Object.keys(process.env)) if (!(chave in ambiente)) delete process.env[chave];
    Object.assign(process.env, ambiente);
    rmSync(tmp, { recursive: true, force: true });
  }
});

function captura(dir: string): unknown {
  return readdirSync(dir).sort().map(nome => {
    const caminho = join(dir, nome), info = lstatSync(caminho);
    return [nome, info.mtimeMs, info.isSymbolicLink() ? readlinkSync(caminho) : info.isDirectory() ? captura(caminho) : readFileSync(caminho, "utf8")];
  });
}
function rodar(alvos: Alvo[] = ["claude"], simular = false, opcoes: { autoCommit?: boolean; githubBackup?: boolean } = {}) { return instalar({ alvos, destino, simular, ...opcoes }); }

test("Dado rg ausente Quando instalo Então avisa sobre query sem falhar nem instalar rg", async () => {
  const rg = join(process.env.PATH!, process.platform === "win32" ? "rg.cmd" : "rg");
  rmSync(rg);
  const r = await rodar();
  expect(r.codigo).toBe(0);
  expect(r.erros).toBe(0);
  expect(r.instalados).toContain("claude");
  expect(r.mensagens.join("\n")).toMatch(/AVISO:.*query.*rg/);
  const comoObter = process.platform === "win32" ? "winget install BurntSushi.ripgrep.MSVC"
    : process.platform === "darwin" ? "brew install ripgrep" : "gerenciador de pacotes da sua distribuição";
  expect(r.mensagens.join("\n")).toContain(comoObter);
  expect(existsSync(rg)).toBe(false);
});

test("Dado destino com espaço Quando instalo quatro agentes e repito Então INALTERADO sem mudar arquivo ou HOME", async () => {
  const r = await rodar(["claude", "codex", "gemini", "copilot"]);
  expect(r.codigo).toBe(0); expect(r.veredito).toBe("MUDOU");
  expect(JSON.parse(readFileSync(join(destino, ".claude/settings.json"), "utf8")).hooks.PreToolUse.map((h: any) => h.matcher)).toEqual(["Write|Edit|NotebookEdit|Bash", "Bash", "Write|Edit|MultiEdit"]);
  expect(readFileSync(join(destino, ".codex/config.toml"), "utf8")).toContain('matcher = "apply_patch|Edit|Write|Bash"');
  expect(JSON.parse(readFileSync(join(destino, ".gemini/settings.json"), "utf8")).context.fileName).toEqual(["AGENTS.md", "GEMINI.md"]);
  expect(JSON.parse(readFileSync(join(destino, ".github/copilot/settings.json"), "utf8")).hooks.preToolUse[0]).toEqual({ type: "command", bash: comandoRelativo, powershell: comandoPowershell });
  const copilotWikiHooks = JSON.parse(readFileSync(join(destino, ".github/hooks/anvilore.json"), "utf8"));
  expect(copilotWikiHooks.version).toBe(1);
  expect(copilotWikiHooks.hooks.postToolUse).toHaveLength(1);
  expect(copilotWikiHooks.hooks.agentStop).toBeUndefined();
  expect(copilotWikiHooks.hooks.sessionEnd).toHaveLength(1);
  const antes = captura(destino);
  expect((await rodar(["claude", "codex", "gemini", "copilot"])).veredito).toBe("INALTERADO");
  expect(captura(destino)).toEqual(antes); expect(readdirSync(lar)).toEqual([]);
  for (const rel of [".claude/skills/lint/SKILL.md", ".agents/skills/lint/SKILL.md", ".github/agents/lint.agent.md"]) {
    expect(real(join(destino, rel))).toBe(real(join(raiz, "skills/lint/SKILL.md")));
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
  expect(json.hooks.PreToolUse.map((h: any) => h.matcher)).toEqual(["Bash", "Write|Edit|NotebookEdit|Bash", "Bash", "Write|Edit|MultiEdit"]);
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

test("Dado página pessoal Quando recrio esqueleto e repito Então preserva conteúdo e copia o resto dos modelos", async () => {
  mkdirSync(join(destino, "wiki/exemplo/concepts"), { recursive: true });
  writeFileSync(join(destino, "wiki/exemplo/concepts/pessoal.md"), "PESSOAL");
  await rodar();
  for (const peca of await pecasDoModelo()) {
    if (ehExemplo(peca.destino) && peca.destino.startsWith("wiki/")) continue;
    expect(readFileSync(join(destino, peca.destino))).toEqual(readFileSync(peca.origem));
  }
  expect(readFileSync(join(destino, "wiki/exemplo/concepts/pessoal.md"), "utf8")).toBe("PESSOAL");
});

test("Dado destino sem wiki/ nem raw/ Quando instalo Então o conjunto criado é exatamente o de modelos/", async () => {
  const esperados = (await pecasDoModelo()).map(peca => peca.destino).sort();
  await rodar();
  const criados = [...arquivosEm(join(destino, "wiki")).map(rel => `wiki/${rel}`), ...arquivosEm(join(destino, "raw")).map(rel => `raw/${rel}`), "SCHEMA.md"].sort();
  expect(criados).toEqual(esperados);
});

test("Dado SCHEMA.md e índice editados e exemplos apagados Quando reinstalo Então nada é sobrescrito e nada apagado volta", async () => {
  await rodar();
  writeFileSync(join(destino, "SCHEMA.md"), "MEU SCHEMA"); writeFileSync(join(destino, "wiki/index.md"), "MEU ÍNDICE");
  rmSync(join(destino, "wiki/exemplo"), { recursive: true }); rmSync(join(destino, "raw/exemplo"), { recursive: true });
  rmSync(join(destino, "wiki/log.md"));
  const r = await rodar();
  expect(r.codigo).toBe(0);
  expect(readFileSync(join(destino, "SCHEMA.md"), "utf8")).toBe("MEU SCHEMA");
  expect(readFileSync(join(destino, "wiki/index.md"), "utf8")).toBe("MEU ÍNDICE");
  expect(existsSync(join(destino, "wiki/exemplo"))).toBe(false);
  expect(existsSync(join(destino, "raw/exemplo"))).toBe(false);
  expect(existsSync(join(destino, "wiki/log.md"))).toBe(true);
});

test("Dado simulação Quando instalo Então anuncia os modelos sem escrever", async () => {
  const r = await rodar(["claude"], true);
  expect(r.mensagens.join("\n")).toContain("simula escrita: SCHEMA.md");
  expect(existsSync(join(destino, "SCHEMA.md"))).toBe(false);
});

test("Dado link antigo e diretório pessoal Quando instalo Então corrige link e preserva diretório avisando", async () => {
  mkdirSync(join(destino, ".claude/skills/lint"), { recursive: true });
  writeFileSync(join(destino, ".claude/skills/lint/meu"), "meu");
  symlinkSync(raiz, join(destino, ".claude/skills/query"), process.platform === "win32" ? "junction" : "dir");
  const r = await rodar();
  expect(r.mensagens.join("\n")).toContain("preservado");
  expect(readFileSync(join(destino, ".claude/skills/lint/meu"), "utf8")).toBe("meu");
  expect(real(join(destino, ".claude/skills/query"))).toBe(real(join(raiz, "skills/query")));
});

test("Dado diretório fonte Quando ligo e repito Então usa link ou junção sem copiar", async () => {
  const link = join(tmp, "ligacao");
  expect(await ligarDiretorio(destino, link)).toBe("criado");
  expect(await ligarDiretorio(destino, link)).toBe("ja-correto");
  writeFileSync(join(destino, "vivo"), "vivo");
  expect(readFileSync(join(link, "vivo"), "utf8")).toBe("vivo");
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  expect(await ligarDiretorio(destino, join(tmp, "pai-ausente/link"))).toBe("falhou");
  expect(consoleCapturado.avisos.join("\n")).toContain("Nenhuma cópia");
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
  expect(consoleCapturado.saida.join("\n")).toContain(`destino: ${real(destino)}`);
  expect(await comandoInstalar(["--help"])).toBe(0);
  for (const args of [["--alvo", "outro"], ["--alvo"], ["--destino"], ["--ruim"], ["extra"]]) expect(await comandoInstalar(args)).toBe(1);
  expect(consoleCapturado.erros.join("\n")).toContain("alvo desconhecido");
  expect(await comandoInstalar([`--destino=${destino}`, "--alvo=todos"])).toBe(0);
});

function copiarFonte() {
  const copia = join(tmp, "fonte"); mkdirSync(copia);
  for (const rel of ["src", "hooks", "skills", "modelos"]) cpSync(join(raiz, rel), join(copia, rel), { recursive: true });
  writeFileSync(join(copia, "AGENTS.md"), "contrato");
  return copia;
}
function executarCopia(copia: string, caminho = `${join(tmp, "bin")}${delimiter}${pathOriginal}`, args = ["--destino", destino, "--alvo", "claude,codex,copilot"]) {
  return Bun.spawnSync([process.execPath, join(copia, "src/cli.ts"), "instalar", ...args], {
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

test("Dado fonte sem modelos/ Quando instalo Então reprova em vez de inventar conteúdo, mesmo com git", () => {
  const copia = copiarFonte();
  const git = Bun.which("git", { PATH: pathOriginal }); expect(git).not.toBeNull();
  for (const args of [["init", "-q"], ["add", "."], ["-c", "user.name=Teste", "-c", "user.email=teste@exemplo", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture"]]) {
    expect(Bun.spawnSync([git!, "-C", copia, ...args], { env: { ...ambiente, HOME: lar, USERPROFILE: lar } }).exitCode).toBe(0);
  }
  rmSync(join(copia, "modelos"), { recursive: true });
  const r = executarCopia(copia);
  expect(r.exitCode).toBe(4); expect(r.stdout.toString()).toContain("modelos/");
  expect(existsSync(join(destino, "wiki"))).toBe(false);
  expect(existsSync(join(destino, "SCHEMA.md"))).toBe(false);
});

test("Dado fonte sem .git Quando instalo Então copia os modelos sem chamar git", () => {
  const copia = copiarFonte();
  const r = executarCopia(copia, join(tmp, "bin"));
  expect(r.exitCode).toBe(0);
  expect(readFileSync(join(destino, "wiki/index.md"))).toEqual(readFileSync(join(raiz, "modelos/wiki/index.md")));
  expect(readFileSync(join(destino, "SCHEMA.md"))).toEqual(readFileSync(join(raiz, "modelos/SCHEMA.md")));
});

test("Dado destino com configuração ilegível Quando instalo Então relata erro sem sucesso silencioso", async () => {
  mkdirSync(join(destino, ".claude/settings.json"), { recursive: true });
  expect((await rodar()).codigo).toBe(4);
});

test("Dado arquivo solto e pasta oculta em skills Quando instalo Então ignora e instala as skills válidas", () => {
  const copia = copiarFonte();
  for (const nome of [".DS_Store", "arquivo.txt"]) writeFileSync(join(copia, "skills", nome), "solto");
  mkdirSync(join(copia, "skills/.oculta")); writeFileSync(join(copia, "skills/.oculta/SKILL.md"), "oculta");
  mkdirSync(join(copia, "skills/sem-skill"));
  const r = executarCopia(copia);
  expect(r.exitCode).toBe(0);
  expect(readFileSync(join(destino, ".claude/skills/lint/SKILL.md"), "utf8")).toBe(readFileSync(join(copia, "skills/lint/SKILL.md"), "utf8"));
  expect(existsSync(join(destino, ".claude/skills/.oculta"))).toBe(false);
});

test("Dado skill ligada a um diretório Quando instalo Então segue o link e instala a skill", () => {
  const copia = copiarFonte();
  const externa = join(tmp, "skill-externa"); mkdirSync(externa);
  writeFileSync(join(externa, "SKILL.md"), "---\nname: ligada\ndescription: Skill ligada\n---\nCONTEUDO VIVO\n");
  symlinkSync(externa, join(copia, "skills/ligada"), process.platform === "win32" ? "junction" : "dir");
  expect(executarCopia(copia).exitCode).toBe(0);
  expect(readFileSync(join(destino, ".claude/skills/ligada/SKILL.md"), "utf8")).toContain("CONTEUDO VIVO");
});

test("Dado ANVILORE_DESTINO Quando instalo sem a flag Então escreve no destino da variável e preserva a fonte", () => {
  const copia = copiarFonte();
  process.env.ANVILORE_DESTINO = destino;
  const r = executarCopia(copia, process.env.PATH, ["--alvo", "claude"]);
  expect(r.exitCode).toBe(0);
  expect(existsSync(join(destino, ".claude/settings.json"))).toBe(true);
  expect(existsSync(join(copia, ".claude"))).toBe(false);
});

test("Dado conflito num agente Quando instalo outro depois Então segue e sai com erro no resumo", async () => {
  mkdirSync(join(destino, ".gemini")); writeFileSync(join(destino, ".gemini/settings.json"), '{"context":{"fileName":"meu"}}');
  const r = await rodar(["gemini", "copilot"]);
  expect(r.codigo).toBe(4);
  expect(existsSync(join(destino, ".github/copilot/settings.json"))).toBe(true);
  expect(r.instalados).toEqual(["copilot"]);
});

test("Dado HOME ou clone recusado Quando leio o erro Então há um só prefixo de recusa", async () => {
  const r = await instalar({ alvos: ["claude"], destino: lar, simular: false });
  expect(r.mensagens.join("\n").match(/recusado:/g)).toHaveLength(1);
  rmSync(join(destino, "AGENTS.md"));
  expect((await rodar()).mensagens.join("\n").match(/recusado:/g)).toHaveLength(1);
});

test("Dado JSON inválido ou conflitante Quando instalo Então o diagnóstico nomeia o arquivo relativo", async () => {
  mkdirSync(join(destino, ".claude")); writeFileSync(join(destino, ".claude/settings.json"), "{ruim");
  expect((await rodar()).mensagens.join("\n")).toContain(".claude/settings.json:");
  mkdirSync(join(destino, ".gemini")); writeFileSync(join(destino, ".gemini/settings.json"), '{"context":{"fileName":"meu"}}');
  expect((await rodar(["gemini"])).mensagens.join("\n")).toContain(".gemini/settings.json:");
});

test("Dado aviso e CLI ausente Quando termino Então o relatório resume alvos instalados ausentes e avisos", async () => {
  mkdirSync(join(destino, ".claude/skills/lint"), { recursive: true });
  rmSync(join(tmp, "bin", process.platform === "win32" ? "codex.cmd" : "codex"));
  const r = await rodar(["claude", "codex"]);
  const texto = r.mensagens.join("\n");
  expect(texto).toContain("alvos: claude, codex");
  expect(texto).toContain("instalados: claude");
  expect(texto).toContain("ausentes do PATH, pulados: codex");
  expect(texto).toContain("avisos: 1 (nada foi sobrescrito)");
  expect(consoleCapturado.avisos).toEqual([]);
});

test("Dado simulação Quando descrevo mudanças Então os verbos indicam que nada foi escrito", async () => {
  const texto = (await rodar(["claude"], true)).mensagens.join("\n");
  expect(texto).toContain("simula escrita:"); expect(texto).toContain("simula ligação:");
  expect(texto).not.toContain("\nescreve:");
});

test("Dado falha na instalação de links Quando termino Então o agente não aparece como instalado", async () => {
  mkdirSync(join(destino, ".claude")); writeFileSync(join(destino, ".claude/skills"), "arquivo pessoal");
  const r = await rodar();
  expect(r.codigo).toBe(4); expect(r.instalados).toEqual([]);
  expect(comBarras(r.mensagens.join("\n"))).toContain(".claude/skills");
  expect(consoleCapturado.avisos).toEqual([]);
});

test("Dado descrição só no corpo da skill Quando gero comando Gemini Então não usa o corpo como frontmatter", () => {
  const copia = copiarFonte();
  mkdirSync(join(copia, "skills/nova"));
  writeFileSync(join(copia, "skills/nova/SKILL.md"), "---\nname: nova\n---\ndescription: SOMENTE NO CORPO\n");
  expect(executarCopia(copia, process.env.PATH, ["--destino", destino, "--alvo", "gemini"]).exitCode).toBe(0);
  expect(Bun.TOML.parse(readFileSync(join(destino, ".gemini/commands/nova.toml"), "utf8"))).toHaveProperty("description", "");
});

test("Dado descrição YAML entre aspas simples Quando gero comando Gemini Então usa o valor do frontmatter", () => {
  const copia = copiarFonte(); mkdirSync(join(copia, "skills/nova"));
  writeFileSync(join(copia, "skills/nova/SKILL.md"), "---\nname: nova\ndescription: 'descrição correta'\n---\ncorpo\n");
  expect(executarCopia(copia, process.env.PATH, ["--destino", destino, "--alvo", "gemini"]).exitCode).toBe(0);
  expect(Bun.TOML.parse(readFileSync(join(destino, ".gemini/commands/nova.toml"), "utf8"))).toHaveProperty("description", "descrição correta");
});

test("Dado ajuda do instalador Quando consulto Então mostra destinos por agente e limites de plataforma e fonte", async () => {
  expect(await comandoInstalar(["--help"])).toBe(0);
  const texto = consoleCapturado.saida.join("\n");
  for (const rel of [".claude/skills", ".agents/skills", ".gemini/commands", ".github/agents", ".codex/config.toml"]) expect(texto).toContain(rel);
  expect(texto).toContain("Alvo:"); expect(texto).toContain("a confirmar pelo CI");
  expect(texto).toContain("fonte ≠ destino"); expect(texto).toContain("resolvem no destino");
});

test("Dado configuração Claude Quando instalo Então aponta para o hook único", async () => {
  await rodar();
  const config = JSON.parse(readFileSync(join(destino, ".claude/settings.json"), "utf8"));
  expect(config.hooks.PreToolUse[0].hooks[0].command).toBe('bun "$CLAUDE_PROJECT_DIR"/src/cli.ts hook proteger-raw || exit 2');
  expect(config.hooks.PreToolUse[0].matcher).toBe("Write|Edit|NotebookEdit|Bash");
  expect(config.hooks.PreToolUse[0].hooks[0]).toMatchObject({ shell: "bash", onFailure: "block" });
});

test("Dado configuração Gemini Quando instalo Então aponta para o hook único", async () => {
  await rodar(["gemini"]);
  const config = JSON.parse(readFileSync(join(destino, ".gemini/settings.json"), "utf8"));
  expect(config.hooks.BeforeTool[0].hooks[0].command).toBe(comandoAbsoluto());
  expect(config.hooks.BeforeTool[0].matcher).toBe("write_file|replace|run_shell_command");
});

test("Dado configuração Codex Quando instalo Então aponta para o hook único", async () => {
  await rodar(["codex"]);
  const config = Bun.TOML.parse(readFileSync(join(destino, ".codex/config.toml"), "utf8"));
  expect(config).toHaveProperty("hooks.PreToolUse.0.hooks.0.command", comandoAbsoluto());
  expect(config).toHaveProperty("hooks.PreToolUse.0.matcher", "apply_patch|Edit|Write|Bash");
});

function arquivosEm(dir: string): string[] {
  return [...new Bun.Glob("**/*").scanSync({ cwd: dir, dot: true, onlyFiles: true })].map(rel => rel.replaceAll("\\", "/")).sort();
}
test("Dado as formas instaladas Quando procuro a decisão do hook Então ela mora em um único arquivo", async () => {
  await rodar(["claude", "codex", "gemini", "copilot"]);
  const donos = ["src", "hooks", "skills"].flatMap(dir => arquivosEm(join(raiz, dir)).map(rel => `${dir}/${rel}`))
    .filter(rel => readFileSync(join(raiz, rel), "utf8").includes("escreveEmRaw"));
  expect(donos).toEqual(["src/comandos/hook-proteger-raw.ts"]);
  for (const rel of [".claude/settings.json", ".codex/config.toml", ".gemini/settings.json", ".github/copilot/settings.json"]) {
    expect(readFileSync(join(destino, rel), "utf8")).not.toMatch(/escreveEmRaw|Bloqueado:/);
  }
});

test("Dado comandos Gemini gerados Quando varro instruções Então não citam provedor e a isca é detectada", async () => {
  await rodar(["gemini"]);
  const provedores = /claude|anthropic|codex|openai|gemini|google|copilot|github/i;
  for (const rel of arquivosEm(join(destino, ".gemini/commands"))) expect(readFileSync(join(destino, ".gemini/commands", rel), "utf8")).not.toMatch(provedores);
  expect("Rode no Clau" + "de Code").toMatch(provedores);
});

function arquivosNovos(): string[] {
  return ["src/comandos/instalar.ts", "src/lib/fundir-json.ts", "src/lib/fundir-bloco.ts", "scripts/medir-ligacoes.ts", "tests/apoio/console.ts", "tests/instalar.test.ts", "tests/fundir-json.test.ts", "tests/fundir-bloco.test.ts", "tests/juncoes.test.ts"];
}

test("Dado arquivos novos do porte Quando varro assuntos pessoais Então não há conteúdo pessoal e as iscas são detectadas", () => {
  const pessoal = /side-projec[t]|terapi[a]|garmi[n]|planeja[i]|ank[i]|iag[o]|qualidade-softwar[e]|engenharia-softwar[e]|notio[n]|inventario-vitoria[s]|\/home[/]|raw\/meeting[s]|(wiki\/|area: *|\[\[)(trabalh[o]|pessoa[l]|ingle[s]|glob[o])/i;
  for (const rel of arquivosNovos()) expect(readFileSync(join(raiz, rel), "utf8")).not.toMatch(pessoal);
  expect("area: pesso" + "al").toMatch(pessoal);
  expect("type: concept\narea: exemplo\n").not.toMatch(pessoal);
});

test("Dado arquivos novos do porte Quando varro ferramental Então não há identificadores de sessão e as iscas são detectadas", () => {
  const ferramental = /j-[0-9]{8}-[a-z0-9]{2}|\.worktree[s]\//i;
  for (const rel of arquivosNovos()) expect(readFileSync(join(raiz, rel), "utf8")).not.toMatch(ferramental);
  expect(".worktree" + "s/exemplo").toMatch(ferramental);
  expect("j-1970" + "0101-zz").toMatch(ferramental);
  expect("tests/exemplo.test.ts").not.toMatch(ferramental);
});

test("Dado instalação na própria fonte Quando ligo skills Então os três alvos usam caminhos relativos no Unix", () => {
  const copia = copiarFonte();
  const r = executarCopia(copia, process.env.PATH, ["--destino", copia, "--alvo", "claude,codex,copilot"]);
  expect(r.exitCode).toBe(0);
  for (const rel of [".claude/skills/lint/SKILL.md", ".agents/skills/lint/SKILL.md", ".github/agents/lint.agent.md"]) expect(real(join(copia, rel))).toBe(real(join(copia, "skills/lint/SKILL.md")));
  if (process.platform !== "win32") {
    expect(readlinkSync(join(copia, ".claude/skills/lint"))).toBe("../../skills/lint");
    expect(readlinkSync(join(copia, ".agents/skills/lint"))).toBe("../../skills/lint");
    expect(readlinkSync(join(copia, ".github/agents/lint.agent.md"))).toBe("../../skills/lint/SKILL.md");
  }
});

test("Dado instalação em subprocesso Quando termino Então o HOME falso continua vazio", () => {
  expect(executarCopia(copiarFonte()).exitCode).toBe(0);
  expect(readdirSync(lar)).toEqual([]);
});

test("Dado EPERM ao criar links Quando instalo pela API Então conserva a causa no relatório e orienta o Copilot", () => {
  const driver = join(tmp, "permissao.mjs");
  writeFileSync(driver, `
import * as fs from "node:fs/promises";
import { mock } from "bun:test";
mock.module("node:fs/promises", () => ({ ...fs, symlink: async () => {
  throw Object.assign(new Error("PERMISSAO NEGADA"), { code: "EPERM" });
} }));
const { instalar } = await import(${JSON.stringify(pathToFileURL(join(raiz, "src/comandos/instalar.ts")).href)});
console.log(JSON.stringify(await instalar({ alvos: ["claude", "copilot"], destino: ${JSON.stringify(destino)}, simular: false })));
`);
  const p = Bun.spawnSync([process.execPath, driver], { env: process.env, stdout: "pipe", stderr: "pipe" });
  expect(p.exitCode).toBe(0);
  const r = JSON.parse(p.stdout.toString());
  expect(r.codigo).toBe(4);
  expect(r.mensagens.join("\n")).toContain("PERMISSAO NEGADA");
  expect(r.mensagens.join("\n")).toContain("modo desenvolvedor");
  expect(r.mensagens.join("\n")).toContain("administrador");
  expect(r.instalados).toEqual([]);
  expect(p.stderr.toString()).toBe("");
  expect(existsSync(join(destino, ".github/agents/lint.agent.md"))).toBe(false);
});

test("Dado falha anterior no CI Quando chega à medição Então roda sempre e não repete a suíte de junções", () => {
  const fluxo = Bun.YAML.parse(readFileSync(join(raiz, ".github/workflows/ci.yml"), "utf8")) as any;
  const etapas = fluxo.jobs.testes.steps as Array<{ name?: string; run?: string; if?: string }>;
  const medicao = etapas.find(etapa => etapa.name?.startsWith("Medir links"));
  expect(medicao?.if).toBe("always()");
  expect(medicao?.run).toBe("bun scripts/medir-ligacoes.ts");
  expect(etapas.filter(etapa => etapa.run?.includes("tests/juncoes.test.ts"))).toHaveLength(0);
});

test("Dado medição em temporário Quando executo Então imprime os resultados de diretório e arquivo", () => {
  const p = Bun.spawnSync([process.execPath, join(raiz, "scripts/medir-ligacoes.ts")], { env: process.env, stdout: "pipe", stderr: "pipe" });
  expect(p.exitCode).toBe(0);
  expect(p.stdout.toString()).toContain(process.platform === "win32" ? "junção: criado" : "link simbólico: criado");
  expect(p.stdout.toString()).toContain("link de arquivo: criado");
});

test("Dado falha de permissão na medição Quando executo Então imprime ambas as falhas e reprova sem copiar", () => {
  const driver = join(tmp, "medir-permissao.mjs");
  writeFileSync(driver, `
import * as fs from "node:fs/promises";
import { mock } from "bun:test";
mock.module("node:fs/promises", () => ({ ...fs, symlink: async () => {
  throw Object.assign(new Error("PERMISSAO NEGADA"), { code: "EPERM" });
} }));
const { medirLigacoes } = await import(${JSON.stringify(pathToFileURL(join(raiz, "scripts/medir-ligacoes.ts")).href)});
process.exit(await medirLigacoes());
`);
  const r = Bun.spawnSync([process.execPath, driver], { env: process.env, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode).toBe(1);
  expect(r.stdout.toString()).toContain(process.platform === "win32" ? "junção: falhou" : "link simbólico: falhou");
  expect(r.stdout.toString()).toContain("link de arquivo: falhou");
  expect(r.stderr.toString()).toContain("Nenhuma cópia");
});

test("Dado ambiente com PATH em qualquer caixa Quando leio o valor Então devolve o PATH exato antes de procurar outra caixa", () => {
  expect(valorDoPath({ PATH: "a" })).toBe("a");
  expect(valorDoPath({ Path: "b" })).toBe("b");
  expect(valorDoPath({ PATH: "a", Path: "b" })).toBe("a");
  expect(valorDoPath({ path: "c", OUTRA: "x" })).toBe("c");
  expect(valorDoPath({ OUTRA: "x" })).toBeUndefined();
});

// R52: configurações escritas pela versão anterior, que apontavam para hooks/proteger-raw.sh.
const antigas = {
  claude: ".claude/settings.json",
  gemini: ".gemini/settings.json",
  copilot: ".github/copilot/settings.json",
} as const;
function configuracaoAntiga(alvo: keyof typeof antigas): unknown {
  switch (alvo) {
    case "claude": return { hooks: { PreToolUse: [{ description: "Recusa qualquer escrita em raw/ — antiga", matcher: "Write|Edit|NotebookEdit", hooks: [{ type: "command", command: '"$CLAUDE_PROJECT_DIR"/hooks/proteger-raw.sh' }] }] } };
    case "gemini": return { context: { fileName: ["AGENTS.md", "GEMINI.md"] }, hooks: { BeforeTool: [{ matcher: "write_file|replace", hooks: [{ name: "proteger-raw", type: "command", command: "./hooks/proteger-raw.sh" }] }] } };
    case "copilot": return { hooks: { preToolUse: [{ type: "command", bash: "./hooks/proteger-raw.sh" }] } };
  }
}
function lerConfig(rel: string) { return JSON.parse(readFileSync(join(destino, rel), "utf8")); }
function gravarConfig(rel: string, conteudo: unknown) {
  mkdirSync(join(destino, rel, ".."), { recursive: true }); writeFileSync(join(destino, rel), JSON.stringify(conteudo, null, 2) + "\n");
}

for (const alvo of ["claude", "gemini", "copilot"] as const) {
  test(`Dado configuração antiga do ${alvo} com hook para o script removido Quando reinstalo Então troca a entrada velha pela nova sem acumular`, async () => {
    gravarConfig(antigas[alvo], configuracaoAntiga(alvo));
    expect((await rodar([alvo])).codigo).toBe(0);
    const texto = readFileSync(join(destino, antigas[alvo]), "utf8");
    expect(texto).not.toContain("hooks/proteger-raw.sh");
    const config = lerConfig(antigas[alvo]);
    const lista = alvo === "claude" ? config.hooks.PreToolUse : alvo === "gemini" ? config.hooks.BeforeTool : config.hooks.preToolUse;
    expect(lista.length).toBeGreaterThanOrEqual(1);
    expect(texto.split("|| exit 2").length - 1).toBe(alvo === "gemini" ? 0 : 1);
    const antes = captura(destino);
    expect((await rodar([alvo])).veredito).toBe("INALTERADO");
    expect(captura(destino)).toEqual(antes);
  });
}

test("Dado configuração antiga com entradas pessoais Quando reinstalo Então só a entrada do hook antigo sai", async () => {
  const antiga = configuracaoAntiga("claude") as { hooks: { PreToolUse: unknown[] } };
  antiga.hooks.PreToolUse.push({ matcher: "Bash", hooks: [{ type: "command", command: "meu-linter.sh" }] });
  antiga.hooks.PreToolUse.push({ matcher: "Write", hooks: [{ type: "command", command: "meu-hook.sh" }, { type: "command", command: "./hooks/proteger-raw.sh" }] });
  gravarConfig(antigas.claude, { pessoal: "meu", ...antiga, hooks: { ...antiga.hooks, PostToolUse: [{ matcher: "Edit" }] } });
  expect((await rodar(["claude"])).codigo).toBe(0);
  const config = lerConfig(antigas.claude);
  expect(config.pessoal).toBe("meu"); expect(config.hooks.PostToolUse[0]).toEqual({ matcher: "Edit" });
  expect(config.hooks.PostToolUse[1].description).toContain("commit opcional");
  expect(config.hooks.PreToolUse).toContainEqual({ matcher: "Bash", hooks: [{ type: "command", command: "meu-linter.sh" }] });
  expect(config.hooks.PreToolUse).toContainEqual({ matcher: "Write", hooks: [{ type: "command", command: "meu-hook.sh" }] });
  expect(JSON.stringify(config)).not.toContain("hooks/proteger-raw.sh");
  expect(config.hooks.PreToolUse).toHaveLength(5);
});

test("Dado instalação com opções de Git solicitadas Quando instala Então registra ambas no anvilore.toml", async () => {
  writeFileSync(join(destino, "anvilore.toml"), 'areas = ["pessoal"]\n');
  const pathFake = process.env.PATH!;
  process.env.PATH = `${pathOriginal}${delimiter}${pathFake}`;
  const r = await rodar(["claude"], false, { autoCommit: true, githubBackup: true });
  process.env.PATH = pathFake;
  expect(r.codigo).toBe(0);
  expect(Bun.TOML.parse(readFileSync(join(destino, "anvilore.toml"), "utf8"))).toEqual({ areas: ["pessoal"], hooks: { auto_commit: true, github_backup: true } });
  expect(lerConfig(".claude/settings.json").hooks.SessionEnd[0].hooks[0].timeout).toBe(15);
  expect(existsSync(join(destino, "wiki/.git"))).toBe(true);
  const ordem = r.mensagens.join("\n");
  expect(ordem.indexOf("anvilore — instalação")).toBeLessThan(ordem.indexOf("escreve: anvilore.toml"));
});

test("Dado bloco antigo do Codex Quando reinstalo Então o bloco é trocado inteiro", async () => {
  mkdirSync(join(destino, ".codex"));
  writeFileSync(join(destino, ".codex/config.toml"), `model = 'meu'\n\n# <<< anvilore\n[[hooks.PreToolUse]]\nmatcher = "apply_patch|Edit|Write"\n\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = "./hooks/proteger-raw.sh"\n# >>> anvilore\n`);
  expect((await rodar(["codex"])).codigo).toBe(0);
  const texto = readFileSync(join(destino, ".codex/config.toml"), "utf8");
  expect(texto).toContain("model = 'meu'"); expect(texto).not.toContain("hooks/proteger-raw.sh");
  expect(texto.split("[[hooks.PreToolUse]]").length - 1).toBe(1);
  expect((Bun.TOML.parse(texto) as any).hooks.PreToolUse[0].hooks[0].command).toBe(comandoAbsoluto());
});

test("Dado configuração antiga e simulação Quando instalo Então nada é escrito e o veredito é MUDOU", async () => {
  gravarConfig(antigas.copilot, configuracaoAntiga("copilot"));
  const antes = captura(destino);
  expect((await rodar(["copilot"], true)).veredito).toBe("MUDOU");
  expect(captura(destino)).toEqual(antes);
});

test("Dado destino sem o comando do hook Quando instalo Então recusa dizendo que falta src/cli.ts", async () => {
  rmSync(join(destino, "src"), { recursive: true });
  const r = await rodar();
  expect(r.codigo).toBe(1); expect(comBarras(r.mensagens.join("\n"))).toContain("src/cli.ts");
});

test("Dado a forma versionada do Claude Quando leio hooks.json Então usa o subcomando e inclui o terminal no matcher", () => {
  const forma = JSON.parse(readFileSync(join(raiz, "hooks/hooks.json"), "utf8"));
  expect(forma.hooks.PreToolUse[0].matcher).toBe("Write|Edit|NotebookEdit|Bash");
  expect(forma.hooks.PreToolUse[0].hooks[0]).toMatchObject({ shell: "bash", onFailure: "block" });
  expect(forma.hooks.PreToolUse[0].hooks[0].command).toBe('bun "$CLAUDE_PROJECT_DIR"/src/cli.ts hook proteger-raw || exit 2');
});

(process.platform === "win32" ? test.skip : test)("Dado o runtime ausente Quando o comando instalado falha Então o wrapper converte em saída 2 (fecha em vez de abrir)", () => {
  const forma = JSON.parse(readFileSync(join(raiz, "hooks/hooks.json"), "utf8"));
  const comando: string = forma.hooks.PreToolUse[0].hooks[0].command;
  expect(comando.endsWith("|| exit 2")).toBe(true);
  const r = Bun.spawnSync(["/bin/sh", "-c", comando.replace(/^bun /, "programa-que-nao-existe ")], { env: { ...process.env, CLAUDE_PROJECT_DIR: raiz }, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode).toBe(2);
});

// I8: formas da versão anterior desta mesma rodada (sem shell/onFailure/powershell) são trocadas, não acumuladas.
test("Dado forma anterior do Claude sem onFailure Quando reinstalo Então troca por uma só entrada com falha fechada", async () => {
  gravarConfig(antigas.claude, { hooks: { PreToolUse: [{ description: "v1", matcher: "Write|Edit|NotebookEdit|Bash", hooks: [{ type: "command", command: 'bun "$CLAUDE_PROJECT_DIR"/src/cli.ts hook proteger-raw || exit 2' }] }] } });
  expect((await rodar(["claude"])).codigo).toBe(0);
  const config = lerConfig(antigas.claude);
  expect(config.hooks.PreToolUse).toHaveLength(3);
  expect(config.hooks.PreToolUse[0].hooks[0]).toMatchObject({ shell: "bash", onFailure: "block" });
  const antes = captura(destino);
  expect((await rodar(["claude"])).veredito).toBe("INALTERADO"); expect(captura(destino)).toEqual(antes);
});

test("Dado forma anterior do Copilot sem powershell Quando reinstalo Então troca pela entrada com os dois shells", async () => {
  gravarConfig(antigas.copilot, { hooks: { preToolUse: [{ type: "command", bash: comandoRelativo }, { type: "command", bash: "meu-hook.sh" }] } });
  expect((await rodar(["copilot"])).codigo).toBe(0);
  const lista = lerConfig(antigas.copilot).hooks.preToolUse;
  expect(lista).toContainEqual({ type: "command", bash: "meu-hook.sh" });
  expect(lista).toContainEqual({ type: "command", bash: comandoRelativo, powershell: comandoPowershell });
  expect(lista).toHaveLength(2);
});

test("Dado entrada do hook já atual no meio da lista Quando reinstalo Então não muda a ordem nem o arquivo", async () => {
  await rodar(["copilot"]);
  const config = lerConfig(antigas.copilot);
  config.hooks.preToolUse.push({ type: "command", bash: "depois.sh" });
  gravarConfig(antigas.copilot, config);
  const antes = captura(destino);
  expect((await rodar(["copilot"])).veredito).toBe("INALTERADO"); expect(captura(destino)).toEqual(antes);
});

// R65 — Codex e Gemini: só a chamada ao bun, caminho absoluto, sem `||`.
test("Dado Codex e Gemini Quando instalo Então o comando usa o caminho absoluto, propaga o código e não tem ||", async () => {
  await rodar(["codex", "gemini"]);
  const gemini = lerConfig(".gemini/settings.json").hooks.BeforeTool[0].hooks[0].command as string;
  const codex = (Bun.TOML.parse(readFileSync(join(destino, ".codex/config.toml"), "utf8")) as any).hooks.PreToolUse[0].hooks[0].command as string;
  for (const comando of [gemini, codex]) {
    expect(comando).toBe(comandoAbsoluto());
    expect(comando).not.toMatch(/\|\||&&/); expect(comando.endsWith("; exit $LASTEXITCODE")).toBe(true);
    expect(comando).toContain("clone com espaço");
  }
});

test("Dado forma anterior de Gemini e Codex com || exit 2 Quando reinstalo Então troca por uma só entrada sem acumular", async () => {
  gravarConfig(".gemini/settings.json", { context: { fileName: ["AGENTS.md", "GEMINI.md"] }, hooks: { BeforeTool: [{ matcher: "write_file|replace|run_shell_command", hooks: [{ name: "proteger-raw", type: "command", command: comandoRelativo }] }] } });
  mkdirSync(join(destino, ".codex"));
  writeFileSync(join(destino, ".codex/config.toml"), `# <<< anvilore\n[[hooks.PreToolUse]]\nmatcher = "apply_patch|Edit|Write|Bash"\n\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = "${comandoRelativo}"\n# >>> anvilore\n`);
  expect((await rodar(["gemini", "codex"])).codigo).toBe(0);
  const gemini = lerConfig(".gemini/settings.json").hooks.BeforeTool;
  expect(gemini).toHaveLength(1); expect(gemini[0].hooks[0].command).toBe(comandoAbsoluto());
  const texto = readFileSync(join(destino, ".codex/config.toml"), "utf8");
  expect(texto).not.toContain("|| exit 2"); expect(texto.split("[[hooks.PreToolUse]]").length - 1).toBe(1);
  const antes = captura(destino);
  expect((await rodar(["gemini", "codex"])).veredito).toBe("INALTERADO"); expect(captura(destino)).toEqual(antes);
});

test("Dado clone movido para outro caminho Quando reinstalo Então a entrada do caminho antigo é trocada", async () => {
  gravarConfig(".gemini/settings.json", { context: { fileName: ["AGENTS.md", "GEMINI.md"] }, hooks: { BeforeTool: [{ matcher: "write_file|replace|run_shell_command", hooks: [{ name: "proteger-raw", type: "command", command: 'bun "/outro/lugar/src/cli.ts" hook proteger-raw' }] }] } });
  expect((await rodar(["gemini"])).codigo).toBe(0);
  const lista = lerConfig(".gemini/settings.json").hooks.BeforeTool;
  expect(lista).toHaveLength(1); expect(lista[0].hooks[0].command).toBe(comandoAbsoluto());
});

test("Dado destino com caractere que o shell interpretaria Quando instalo Codex ou Gemini Então recusa explicando o caminho", async () => {
  const estranho = join(tmp, "a$b"); mkdirSync(estranho); mkdirSync(join(estranho, "skills")); mkdirSync(join(estranho, "src"));
  writeFileSync(join(estranho, "AGENTS.md"), "x"); writeFileSync(join(estranho, "src/cli.ts"), "cli");
  const r = await instalar({ alvos: ["gemini"], destino: estranho, simular: false });
  expect(r.codigo).toBe(4); expect(r.mensagens.join("\n")).toContain("caractere que o shell interpretaria");
  expect(existsSync(join(estranho, ".gemini/settings.json"))).toBe(false);
});

// R66 parte 3 — Codex: `command_windows` com a forma PowerShell que fecha (cita learn.chatgpt.com/docs/hooks: commandWindows).
test("Dado Codex Quando instalo Então o hook traz command_windows em PowerShell que mapeia qualquer falha para 2", async () => {
  await rodar(["codex"]);
  const gancho = (Bun.TOML.parse(readFileSync(join(destino, ".codex/config.toml"), "utf8")) as any).hooks.PreToolUse[0].hooks[0];
  expect(gancho.command).toBe(comandoAbsoluto());
  expect(gancho.command_windows).toBe(comandoWindowsCodex());
});

test("Dado bloco do Codex sem command_windows Quando reinstalo Então o bloco é trocado e fica idempotente", async () => {
  mkdirSync(join(destino, ".codex"));
  writeFileSync(join(destino, ".codex/config.toml"), `model = 'meu'\n\n# <<< anvilore\n[[hooks.PreToolUse]]\nmatcher = "apply_patch|Edit|Write|Bash"\n\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = ${JSON.stringify(comandoAbsoluto())}\n# >>> anvilore\n`);
  expect((await rodar(["codex"])).codigo).toBe(0);
  const texto = readFileSync(join(destino, ".codex/config.toml"), "utf8");
  expect(texto).toContain("model = 'meu'"); expect(texto).toContain("command_windows");
  expect(texto.split("[[hooks.PreToolUse]]").length - 1).toBe(1);
  const antes = captura(destino);
  expect((await rodar(["codex"])).veredito).toBe("INALTERADO"); expect(captura(destino)).toEqual(antes);
});

// R70-G: a saída aponta o próximo passo só na instalação real; a simulação diz que nada foi alterado.
test("Dado instalação real Quando termino sem erro Então a última linha manda reabrir o agente e rodar init", async () => {
  const r = await rodar(["claude"]);
  expect(r.codigo).toBe(0);
  const ultima = r.mensagens.at(-1)!;
  expect(ultima).toBe("Próximo passo: reabra o agente neste clone (o hook só vale em sessões abertas depois da instalação) e rode `bun src/cli.ts init`.");
});

test("Dado instalação repetida sem mudanças Quando termino Então ainda aponta o próximo passo", async () => {
  await rodar(["claude"]);
  const r = await rodar(["claude"]);
  expect(r.veredito).toBe("INALTERADO");
  expect(r.mensagens.at(-1)).toContain("Próximo passo: reabra o agente");
});

test("Dado simulação Quando termino Então diz que nada foi alterado e não sugere o próximo passo nem diz instalados", async () => {
  const r = await rodar(["claude"], true);
  const texto = r.mensagens.join("\n");
  expect(texto).toContain("Nada foi alterado");
  expect(texto).not.toContain("Próximo passo");
  expect(texto).not.toMatch(/^instalados:/m);
  expect(texto).toContain("seriam instalados: claude");
});

test("Dado instalação com erro Quando termino Então não sugere o próximo passo", async () => {
  mkdirSync(join(destino, ".claude")); writeFileSync(join(destino, ".claude/settings.json"), "{ruim");
  const r = await rodar(["claude"]);
  expect(r.codigo).toBe(4);
  expect(r.mensagens.join("\n")).not.toContain("Próximo passo");
});

test("Dado só CLI ausente Quando termino Então não há o que reabrir e o próximo passo não aparece", async () => {
  rmSync(join(tmp, "bin", process.platform === "win32" ? "codex.cmd" : "codex"));
  const r = await rodar(["codex"]);
  expect(r.instalados).toEqual([]);
  expect(r.mensagens.join("\n")).not.toContain("Próximo passo");
});

test("Dado o alvo claude Quando instalo Então gera os agentes leitor e escritor dos prompts de skills/ingest e repetir não muda nada", async () => {
  const { agentesDaIngestao } = await import("../src/lib/papeis-ingestao");
  const r = await rodar(["claude"]);
  expect(r.codigo).toBe(0);
  for (const agente of await agentesDaIngestao(raiz)) {
    expect(readFileSync(join(destino, agente.rel), "utf8")).toBe(agente.conteudo);
  }
  expect(readFileSync(join(destino, ".claude/agents/anvilore-leitor.md"), "utf8")).toContain(readFileSync(join(raiz, "skills/ingest/leitor.md"), "utf8"));
  const antes = captura(destino);
  expect((await rodar(["claude"])).veredito).toBe("INALTERADO");
  expect(captura(destino)).toEqual(antes);
});

test("Dado agente gerado desatualizado e agente pessoal com o mesmo nome Quando instalo Então regrava o nosso e preserva o da pessoa", async () => {
  await rodar(["claude"]);
  writeFileSync(join(destino, ".claude/agents/anvilore-leitor.md"), "<!-- Gerado por `anvilore instalar` --> versão velha");
  writeFileSync(join(destino, ".claude/agents/anvilore-escritor.md"), "meu escritor");
  const r = await rodar(["claude"]);
  expect(r.codigo).toBe(0);
  expect(readFileSync(join(destino, ".claude/agents/anvilore-leitor.md"), "utf8")).toContain("# Papel: leitor da ingestão");
  expect(readFileSync(join(destino, ".claude/agents/anvilore-escritor.md"), "utf8")).toBe("meu escritor");
  expect(comBarras(r.mensagens.join("\n"))).toContain("AVISO: .claude/agents/anvilore-escritor.md já existe e não foi gerado pelo anvilore");
});

test("Dado alvos sem subagente com ferramentas restritas Quando instalo Então não gera agentes do Claude Code", async () => {
  await rodar(["codex", "gemini", "copilot"]);
  expect(existsSync(join(destino, ".claude/agents"))).toBe(false);
});

test("Dado agente que não dá para ler Quando instalo Então relata erro em vez de sobrescrever", async () => {
  mkdirSync(join(destino, ".claude/agents/anvilore-leitor.md"), { recursive: true });
  const r = await rodar(["claude"]);
  expect(r.codigo).toBe(4);
  expect(comBarras(r.mensagens.join("\n"))).toContain(".claude/agents/anvilore-leitor.md");
});
