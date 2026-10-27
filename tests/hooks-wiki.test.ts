import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { autoCommitWiki, backupGitHub, comandoHooksWiki, contextoWiki, sugerirLint } from "../src/comandos/hooks-wiki";
import { capturarConsole } from "./apoio/console";
import { configuracaoDoHook } from "../src/comandos/instalar";

let raiz: string;
beforeEach(() => { raiz = mkdtempSync(join(tmpdir(), "anvilore-hooks-")); });
afterEach(() => { rmSync(raiz, { recursive: true, force: true }); rmSync(`${raiz}-remote.git`, { recursive: true, force: true }); });

async function git(...args: string[]) {
  const p = Bun.spawn(["git", "-C", raiz, ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out, err, code };
}
async function comando(acao: string, entrada = "") {
  const filho = Bun.spawn([process.execPath, join(import.meta.dir, "../src/cli.ts"), "hooks-wiki", acao, raiz], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  filho.stdin.write(entrada); filho.stdin.end();
  const [saida, erro, codigo] = await Promise.all([new Response(filho.stdout).text(), new Response(filho.stderr).text(), filho.exited]);
  return { saida, erro, codigo };
}

describe("hooks da wiki", () => {
  test("Dado quatro agentes Quando monto configurações Então só registra eventos disponíveis", async () => {
    const claude = (await configuracaoDoHook("claude", raiz)).json as { hooks: Record<string, unknown[]> };
    expect(claude.hooks.PostToolUse).toHaveLength(1); expect(claude.hooks.FileChanged).toHaveLength(1);
    expect(claude.hooks.SessionStart).toHaveLength(1); expect(claude.hooks.Stop).toHaveLength(2);
    const codex = Bun.TOML.parse((await configuracaoDoHook("codex", raiz)).bloco!) as { hooks: Record<string, unknown[]> };
    expect(codex.hooks.FileChanged).toBeUndefined(); expect(codex.hooks.SessionStart).toHaveLength(1);
    const gemini = (await configuracaoDoHook("gemini", raiz)).json as { hooks: Record<string, unknown[]> };
    expect(gemini.hooks.AfterTool).toHaveLength(1); expect(gemini.hooks.AfterAgent).toHaveLength(1);
    expect(gemini.hooks.FileChanged).toBeUndefined(); expect(gemini.hooks.SessionStart).toBeUndefined();
    const copilot = (await configuracaoDoHook("copilot", raiz)).json as { hooks: Record<string, unknown[]> };
    expect(copilot.hooks.preToolUse).toHaveLength(1);
    expect(copilot.hooks.fileChanged).toBeUndefined(); expect(copilot.hooks.sessionStart).toBeUndefined();
  });

  test("Dado edição em wiki e git limpo Quando autoCommitWiki roda Então cria commit da página sem incluir raw", async () => {
    await git("init", "-q"); await git("config", "user.name", "Teste"); await git("config", "user.email", "teste@example.test");
    mkdirSync(join(raiz, "wiki", "concepts"), { recursive: true }); mkdirSync(join(raiz, "raw"));
    writeFileSync(join(raiz, "wiki/concepts/ideia.md"), "nova"); writeFileSync(join(raiz, "raw/fonte.md"), "não tocar");
    expect(await autoCommitWiki(raiz, "wiki/concepts/ideia.md")).toBe(true);
    expect((await git("status", "--porcelain")).out).toContain("?? raw/");
    expect((await git("log", "-1", "--pretty=%s")).out.trim()).toBe("wiki(concept): ideia");
  });

  test("Dado caminho fora de wiki ou navegação Quando autoCommitWiki roda Então não cria commit", async () => {
    await git("init", "-q"); await git("config", "user.name", "Teste"); await git("config", "user.email", "teste@example.test");
    mkdirSync(join(raiz, "wiki"), { recursive: true }); writeFileSync(join(raiz, "wiki/index.md"), "índice");
    expect(await autoCommitWiki(raiz, "wiki/index.md")).toBe(false);
    expect((await git("log", "-1", "--pretty=%s")).code).not.toBe(0);
  });

  test("Dado alteração já staged fora de wiki Quando autoCommitWiki roda Então não a inclui no commit automático", async () => {
    await git("init", "-q"); await git("config", "user.name", "Teste"); await git("config", "user.email", "teste@example.test");
    writeFileSync(join(raiz, "base.md"), "base"); await git("add", "base.md"); await git("commit", "-m", "base");
    mkdirSync(join(raiz, "wiki"), { recursive: true }); writeFileSync(join(raiz, "wiki/pagina.md"), "wiki");
    writeFileSync(join(raiz, "fora.md"), "mudança staged"); await git("add", "fora.md");
    expect(await autoCommitWiki(raiz, "wiki/pagina.md")).toBe(false);
    expect((await git("log", "-1", "--pretty=%s")).out.trim()).toBe("base");
    expect((await git("status", "--porcelain")).out).toContain("A  fora.md");
  });

  test("Dado vault sem remoto Quando backupGitHub roda Então não faz push nem reescreve histórico", async () => {
    await git("init", "-q"); await git("config", "user.name", "Teste"); await git("config", "user.email", "teste@example.test");
    writeFileSync(join(raiz, "nota.md"), "conteúdo");
    expect(await backupGitHub(raiz)).toMatchObject({ sincronizado: false });
    expect((await git("status", "--porcelain")).out).toContain("nota.md");
  });

  test("Dado compactação e wiki existente Quando contextoWiki roda Então devolve índice e últimas entradas", async () => {
    mkdirSync(join(raiz, "wiki/log"), { recursive: true });
    writeFileSync(join(raiz, "wiki/index.md"), "índice atual");
    writeFileSync(join(raiz, "wiki/log/log-2026-01-02.md"), "# Log\n## [2026-01-02] ingest | Uma fonte\nentrada recente\n## [2026-01-01] lint | Completo\nok\n");
    expect(await contextoWiki(raiz)).toContain("índice atual");
    expect(await contextoWiki(raiz)).toContain("entrada recente");
  });

  test("Dado cinco ingestões após lint Quando sugerirLint roda Então recomenda lint", async () => {
    mkdirSync(join(raiz, "wiki/log"), { recursive: true });
    writeFileSync(join(raiz, "wiki/log/log-2026-01-05.md"), [1, 2, 3, 4, 5].map((n) => `## [2026-01-0${n}] ingest | Fonte ${n}\nlinha`).join("\n"));
    expect(await sugerirLint(raiz)).toMatch(/5 ingestões.*lint/i);
  });

  test("Dado log sem cinco ingestões e sem arquivos de contexto Quando os ganchos rodam Então não inventam conteúdo nem recomendação", async () => {
    expect(await contextoWiki(raiz)).toBe("Contexto da wiki após compactação:");
    mkdirSync(join(raiz, "wiki/log"), { recursive: true }); writeFileSync(join(raiz, "wiki/log/log-2026-01-01.md"), "## [2026-01-01] ingest | Fonte\n");
    expect(await sugerirLint(raiz)).toBeUndefined();
    expect(await sugerirLint(join(raiz, "nao-existe"))).toBeUndefined();
  });

  test("Dado hooks desligados Quando os comandos de evento rodam Então não alteram Git e só avisam raw/", async () => {
    expect((await comando("autocommit", JSON.stringify({ tool_input: { file_path: "wiki/a.md" } }))).codigo).toBe(0);
    expect((await comando("backup")).codigo).toBe(0);
    expect((await comando("arquivo-raw", JSON.stringify({ file_path: `${raiz}/raw/novo.md`, event: "add" }))).saida).toContain("Diga \"ingest\"");
    expect((await comando("arquivo-raw", JSON.stringify({ file_path: `${raiz}/raw/antigo.md`, event: "change" }))).saida).toBe("");
    expect((await comando("arquivo-raw", JSON.stringify({ file_path: `${raiz}/wiki/novo.md`, event: "add" }))).saida).toBe("");
    expect((await comando("sugerir-lint")).codigo).toBe(0);
    expect((await comando("contexto")).saida).toContain("Contexto da wiki");
    expect((await comando("desconhecido")).codigo).toBe(2);
  });

  test("Dado anvilore.toml malformado Quando eventos Git rodam Então falham em modo desligado", async () => {
    writeFileSync(join(raiz, "anvilore.toml"), "[hooks\n");
    expect(await comandoHooksWiki(["autocommit", raiz], async () => JSON.stringify({ tool_input: { file_path: "wiki/a.md" } }))).toBe(0);
    expect(await comandoHooksWiki(["backup", raiz])).toBe(0);
    expect((await git("rev-parse", "--git-dir")).code).not.toBe(0);
  });

  test("Dado configuração que opta por commit automático Quando chega edição Então o hook cria só o commit da wiki", async () => {
    await git("init", "-q"); await git("config", "user.name", "Teste"); await git("config", "user.email", "teste@example.test");
    mkdirSync(join(raiz, "wiki/concepts"), { recursive: true }); writeFileSync(join(raiz, "wiki/concepts/optin.md"), "ok");
    writeFileSync(join(raiz, "anvilore.toml"), "[hooks]\nauto_commit = true\n");
    expect((await comando("autocommit", JSON.stringify({ tool_input: { file_path: "wiki/concepts/optin.md" } }))).codigo).toBe(0);
    expect((await git("log", "-1", "--pretty=%s")).out.trim()).toBe("wiki(concept): optin");
  });

  test("Dado opt-in e remoto local Quando backup roda Então envia a branch sem force", async () => {
    const remoto = `${raiz}-remote.git`;
    await git("init", "--initial-branch=main", "-q"); await git("config", "user.name", "Teste"); await git("config", "user.email", "teste@example.test");
    const init = Bun.spawnSync(["git", "init", "--bare", remoto], { stdout: "pipe", stderr: "pipe" }); expect(init.exitCode).toBe(0);
    writeFileSync(join(raiz, "nota.md"), "ok"); await git("add", "nota.md"); await git("commit", "-m", "nota"); await git("remote", "add", "origin", remoto);
    writeFileSync(join(raiz, "anvilore.toml"), "[hooks]\ngithub_backup = true\n");
    const c = capturarConsole();
    try {
      expect(await comandoHooksWiki(["backup", raiz])).toBe(0);
      expect(c.saida.join("\n")).toContain("Backup do Anvilore enviado ao GitHub");
    } finally { c.restaurar(); }
    expect((await git("rev-parse", "--verify", "origin/main")).code).toBe(0);
  });

  test("Dado comando desconhecido Quando hooks-wiki executa Então mostra o uso e sai com 2", async () => {
    const c = capturarConsole();
    try { expect(await comandoHooksWiki([], async () => "")).toBe(2); expect(c.erros.join(" ")).toContain("Uso: anvilore hooks-wiki"); }
    finally { c.restaurar(); }
  });

  test("Dado JSON de hook inválido Quando comando recebe stdin Então falha fechado sem interromper o agente", async () => {
    const c = capturarConsole();
    try {
      expect(await comandoHooksWiki(["arquivo-raw", raiz], async () => "{")).toBe(0);
      expect(c.erros.join("\n")).toContain("hooks-wiki");
    } finally { c.restaurar(); }
  });

  test("Dado evento cru com opt-in desligado Quando comando trata eventos Então não adiciona commit", async () => {
    const c = capturarConsole();
    try {
      expect(await comandoHooksWiki(["autocommit", raiz], async () => JSON.stringify({ toolInput: { filePath: "wiki/new.md" } }))).toBe(0);
      expect(await comandoHooksWiki(["arquivo-raw", raiz], async () => JSON.stringify({ file_path: "raw/new.md", event: "add" }))).toBe(0);
      expect(await comandoHooksWiki(["backup", raiz])).toBe(0);
      expect(c.saida.join("\n")).toContain("Novo arquivo em raw/");
    } finally { c.restaurar(); }
  });
});
