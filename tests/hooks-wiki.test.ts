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
  const wiki = join(raiz, "wiki");
  if (args[0] === "init") mkdirSync(wiki, { recursive: true });
  const p = Bun.spawn(["git", "-C", wiki, ...args], { stdout: "pipe", stderr: "pipe" });
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
    expect((claude.hooks.FileChanged![0] as any).matcher).toBeUndefined();
    expect((claude.hooks.FileChanged![0] as any).hooks[0].shell).toBe("bash");
    expect(claude.hooks.SessionStart!).toHaveLength(3); expect(claude.hooks.SessionEnd!).toHaveLength(1); expect(claude.hooks.Stop!).toHaveLength(1);
    expect((claude.hooks.SessionStart![1] as any).hooks[0].command).toContain("watch-paths");
    expect((claude.hooks.SessionStart![1] as any).hooks[0].shell).toBe("bash");
    expect((claude.hooks.Stop![0] as any).hooks[0].shell).toBe("bash");
    expect((claude.hooks.SessionEnd![0] as any).hooks[0]).toMatchObject({ shell: "bash", timeout: 15 });
    const codex = Bun.TOML.parse((await configuracaoDoHook("codex", raiz)).bloco!) as { hooks: Record<string, unknown[]> };
    expect(codex.hooks.FileChanged).toBeUndefined(); expect(codex.hooks.SessionStart).toHaveLength(2); expect(codex.hooks.SessionEnd).toHaveLength(1);
    const gemini = (await configuracaoDoHook("gemini", raiz)).json as { hooks: Record<string, unknown[]> };
    expect(gemini.hooks.AfterTool).toHaveLength(1); expect(gemini.hooks.AfterAgent).toHaveLength(1); expect(gemini.hooks.SessionEnd).toHaveLength(1);
    expect(gemini.hooks.FileChanged).toBeUndefined(); expect(gemini.hooks.SessionStart).toBeUndefined();
    const copilot = (await configuracaoDoHook("copilot", raiz)).json as { hooks: Record<string, unknown[]> };
    expect(copilot.hooks.preToolUse).toHaveLength(1); expect(copilot.hooks.sessionEnd).toBeUndefined();
    expect(copilot.hooks.fileChanged).toBeUndefined(); expect(copilot.hooks.sessionStart).toBeUndefined();
    const camposClaude = (await configuracaoDoHook("claude", raiz)).json as { permissions: { ask: string[] }; hooks: Record<string, any[]> };
    for (const grupo of Object.values(camposClaude.hooks).flat()) for (const hook of grupo.hooks ?? []) {
      if (hook.command.includes("hooks-wiki")) expect(hook.shell).toBe("bash");
    }
    expect(camposClaude.permissions.ask).toContain("Bash(bun src/cli.ts aprovar *)");
    expect(camposClaude.hooks.PreToolUse!.some(grupo => grupo.matcher === "Bash")).toBe(true);
    expect(camposClaude.hooks.PreToolUse!.some(grupo => grupo.matcher === "Write|Edit|MultiEdit")).toBe(true);
  });

  test("Dado edição em wiki e git limpo Quando autoCommitWiki roda Então cria commit da página sem incluir raw", async () => {
    await git("init", "-q"); await git("config", "user.name", "Teste"); await git("config", "user.email", "teste@example.test");
    mkdirSync(join(raiz, "wiki", "concepts"), { recursive: true }); mkdirSync(join(raiz, "raw"));
    writeFileSync(join(raiz, "wiki/concepts/ideia.md"), "nova"); writeFileSync(join(raiz, "raw/fonte.md"), "não tocar");
    expect(await autoCommitWiki(raiz, "wiki/concepts/ideia.md")).toBe(true);
    expect((await git("ls-files")).out).not.toContain("raw/");
    expect((await git("log", "-1", "--pretty=%s")).out.trim()).toBe("wiki(concept): ideia");
  });

  test("Dado ANVILORE_SEM_AUTOCOMMIT=1 Quando o hook roda Então não cria commit automático", async () => {
    await git("init", "-q"); await git("config", "user.name", "Teste"); await git("config", "user.email", "teste@example.test");
    mkdirSync(join(raiz, "wiki/concepts"), { recursive: true });
    writeFileSync(join(raiz, "wiki/concepts/ideia.md"), "nova");
    writeFileSync(join(raiz, "anvilore.toml"), "[hooks]\nauto_commit = true\n");
    const c = capturarConsole();
    const anterior = process.env.ANVILORE_SEM_AUTOCOMMIT;
    process.env.ANVILORE_SEM_AUTOCOMMIT = "1";
    try {
      expect(await comandoHooksWiki(["autocommit", raiz], async () => JSON.stringify({ tool_input: { file_path: "wiki/concepts/ideia.md" } }))).toBe(0);
      expect((await git("log", "-1", "--pretty=%s")).code).not.toBe(0);
    } finally {
      if (anterior === undefined) delete process.env.ANVILORE_SEM_AUTOCOMMIT;
      else process.env.ANVILORE_SEM_AUTOCOMMIT = anterior;
      c.restaurar();
    }
  });

  test("Dado wiki como repositório Git próprio Quando autoCommitWiki roda Então commita a página dentro desse repositório", async () => {
    mkdirSync(join(raiz, "wiki/concepts"), { recursive: true });
    await Bun.spawnSync(["git", "init", "-q", join(raiz, "wiki")]);
    await Bun.spawnSync(["git", "-C", join(raiz, "wiki"), "config", "user.name", "Teste"]);
    await Bun.spawnSync(["git", "-C", join(raiz, "wiki"), "config", "user.email", "teste@example.test"]);
    writeFileSync(join(raiz, "wiki/concepts/propria.md"), "conteúdo");
    expect(await autoCommitWiki(raiz, "wiki/concepts/propria.md")).toBe(true);
    const log = Bun.spawnSync(["git", "-C", join(raiz, "wiki"), "log", "-1", "--pretty=%s"], { stdout: "pipe" });
    expect(log.stdout.toString().trim()).toBe("wiki(concept): propria");
  });

  test("Dado caminho fora de wiki ou arquivo de navegação Quando autoCommitWiki roda Então não cria commit", async () => {
    await git("init", "-q"); await git("config", "user.name", "Teste"); await git("config", "user.email", "teste@example.test");
    mkdirSync(join(raiz, "wiki/pessoal"), { recursive: true }); writeFileSync(join(raiz, "wiki/index.md"), "índice"); writeFileSync(join(raiz, "wiki/pessoal/index.md"), "índice área");
    expect(await autoCommitWiki(raiz, "wiki/index.md")).toBe(false);
    expect(await autoCommitWiki(raiz, "wiki/pessoal/index.md")).toBe(false);
    expect(await autoCommitWiki(raiz, "wiki/log/log-2026-01-01.md")).toBe(false);
    expect((await git("log", "-1", "--pretty=%s")).code).not.toBe(0);
  });

  test("Dado alteração já staged fora de wiki Quando autoCommitWiki roda Então não a inclui no commit automático", async () => {
    await git("init", "-q"); await git("config", "user.name", "Teste"); await git("config", "user.email", "teste@example.test");
    writeFileSync(join(raiz, "wiki/base.md"), "base"); await git("add", "base.md"); await git("commit", "-m", "base");
    writeFileSync(join(raiz, "wiki/pagina.md"), "wiki");
    writeFileSync(join(raiz, "wiki/fora.md"), "mudança staged"); await git("add", "fora.md");
    expect(await autoCommitWiki(raiz, "wiki/pagina.md")).toBe(false);
    expect((await git("log", "-1", "--pretty=%s")).out.trim()).toBe("base");
    expect((await git("status", "--porcelain")).out).toContain("A  fora.md");
  });

  test("Dado vault sem remoto Quando backupGitHub roda Então não faz push nem reescreve histórico", async () => {
    await git("init", "-q"); await git("config", "user.name", "Teste"); await git("config", "user.email", "teste@example.test");
    mkdirSync(join(raiz, "wiki"), { recursive: true }); writeFileSync(join(raiz, "wiki/nota.md"), "conteúdo");
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
    const c = capturarConsole();
    try {
      expect(await comandoHooksWiki(["sugerir-lint", raiz])).toBe(0);
      expect(JSON.parse(c.saida.join("\n"))).toHaveProperty("systemMessage");
    } finally { c.restaurar(); }
  });

  test("Dado log sem cinco ingestões e sem arquivos de contexto Quando os ganchos rodam Então não inventam conteúdo nem recomendação", async () => {
    expect(await contextoWiki(raiz)).toBe("Contexto da wiki após compactação:");
    mkdirSync(join(raiz, "wiki/log"), { recursive: true }); writeFileSync(join(raiz, "wiki/log/log-2026-01-01.md"), "## [2026-01-01] ingest | Fonte\n");
    expect(await sugerirLint(raiz)).toBeUndefined();
    expect(await sugerirLint(join(raiz, "nao-existe"))).toBeUndefined();
  });

  test("Dado evento SessionStart do Claude Quando watch-paths roda Então registra raw como caminho absoluto", async () => {
    mkdirSync(join(raiz, "raw"));
    const c = capturarConsole();
    try {
      expect(await comandoHooksWiki(["watch-paths", raiz])).toBe(0);
      expect(JSON.parse(c.saida.join("\n"))).toEqual({ hookSpecificOutput: { hookEventName: "SessionStart", watchPaths: [join(raiz, "raw")] } });
    } finally { c.restaurar(); }
  });

  test("Dado hooks desligados Quando os comandos de evento rodam Então não alteram Git e só avisam raw/", async () => {
    expect((await comando("autocommit", JSON.stringify({ tool_input: { file_path: "wiki/a.md" } }))).codigo).toBe(0);
    expect((await comando("backup")).codigo).toBe(0);
    expect(JSON.parse((await comando("arquivo-raw", JSON.stringify({ file_path: `${raiz}/raw/novo.md`, event: "add" }))).saida)).toHaveProperty("systemMessage");
    expect((await comando("arquivo-raw", JSON.stringify({ file_path: `${raiz}/raw/antigo.md`, event: "change" }))).saida).toBe("");
    expect((await comando("arquivo-raw", JSON.stringify({ file_path: `${raiz}/wiki/novo.md`, event: "add" }))).saida).toBe("");
    expect((await comando("sugerir-lint")).codigo).toBe(0);
    expect((await comando("contexto")).saida).toContain("Contexto da wiki");
    expect((await comando("desconhecido")).codigo).toBe(2);
  });

  test("Dado comando de aprovação Quando o modo não garante confirmação humana Então o hook o nega", async () => {
    for (const permission_mode of ["auto", "bypassPermissions", "acceptEdits", "dontAsk", "plan", undefined, "novo-modo"]) {
      const c = capturarConsole();
      try {
        await comandoHooksWiki(["proteger-aprovacao", raiz], async () => JSON.stringify({ permission_mode, tool_input: { command: "bun src/cli.ts aprovar wiki/pessoal/a.md" } }));
        expect(JSON.parse(c.saida.join("\n"))).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "Para aprovar, saia do modo automático (Shift+Tab) e peça de novo" } });
      } finally { c.restaurar(); }
    }
  });

  test("Dado aprovação em modo manual Quando o hook avalia Então deixa permissions.ask pedir confirmação", async () => {
    const c = capturarConsole();
    try {
      await comandoHooksWiki(["proteger-aprovacao", raiz], async () => JSON.stringify({ permission_mode: "default", tool_input: { command: "bun src/cli.ts aprovar wiki/a.md" } }));
      expect(c.saida.join("\n")).toBe("");
    } finally { c.restaurar(); }
  });

  test("Dado tentativa de acrescentar verified em wiki Quando Write, Edit ou MultiEdit chama o hook Então nega", async () => {
    for (const tool_input of [
      { file_path: join(raiz, "wiki/a.md"), content: "---\nverified:\n  - by: human:x\n---" },
      { file_path: join(raiz, "wiki/a.md"), new_string: "verified: human:x" },
      { file_path: join(raiz, "wiki/a.md"), edits: [{ new_string: "verified: human:x" }] },
    ]) {
      const c = capturarConsole();
      try {
        await comandoHooksWiki(["proteger-verified", raiz], async () => JSON.stringify({ cwd: raiz, tool_input }));
        expect(JSON.parse(c.saida.join("\n"))).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
      } finally { c.restaurar(); }
    }
  });

  test("Dado página já aprovada Quando Write/Edit preservam o bloco verified Então deixa atualizar o restante", async () => {
    const pagina = join(raiz, "wiki/a.md");
    mkdirSync(join(raiz, "wiki"), { recursive: true });
    const verified = "verified:\n  - by: human:ana\n    at: 2026-10-27T11:00:00Z";
    writeFileSync(pagina, `---\ngenerated: agente\n${verified}\n---\nAntigo.\n`);
    const inputs = [
      { file_path: pagina, content: `---\ngenerated: agente\n${verified}\n---\nNovo.\n` },
      { file_path: pagina, old_string: "Antigo.", new_string: "Novo." },
    ];
    for (const tool_input of inputs) {
      const c = capturarConsole();
      try {
        await comandoHooksWiki(["proteger-verified", raiz], async () => JSON.stringify({ cwd: raiz, tool_input }));
        expect(c.saida.join("\n")).toBe("");
      } finally { c.restaurar(); }
    }
  });

  test("Dado Edit que introduz uma nova entrada verified Quando o hook avalia Então nega", async () => {
    const c = capturarConsole();
    try {
      await comandoHooksWiki(["proteger-verified", raiz], async () => JSON.stringify({ cwd: raiz, tool_input: {
        file_path: join(raiz, "wiki/a.md"), old_string: "generated: agente", new_string: "generated: agente\nverified:\n  - by: human:ana",
      } }));
      expect(JSON.parse(c.saida.join("\n"))).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    } finally { c.restaurar(); }
  });

  test("Dado Edit só da linha at dentro de verified Quando adianta a aprovação Então nega", async () => {
    const pagina = join(raiz, "wiki/a.md");
    mkdirSync(join(raiz, "wiki"), { recursive: true });
    writeFileSync(pagina, "---\ngenerated:\n  at: 2026-10-27T10:00:00Z\nverified:\n  - by: human:ana\n    at: 2026-10-27T11:00:00Z\n---\nTexto.\n");
    const c = capturarConsole();
    try {
      await comandoHooksWiki(["proteger-verified", raiz], async () => JSON.stringify({ cwd: raiz, tool_input: {
        file_path: pagina, old_string: "    at: 2026-10-27T11:00:00Z", new_string: "    at: 2026-10-27T09:00:00Z",
      } }));
      expect(JSON.parse(c.saida.join("\n"))).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    } finally { c.restaurar(); }
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
    writeFileSync(join(raiz, "wiki/nota.md"), "ok"); await git("add", "nota.md"); await git("commit", "-m", "nota"); await git("remote", "add", "origin", remoto); await git("push", "-u", "origin", "main");
    writeFileSync(join(raiz, "wiki/nota.md"), "nova versão"); await git("add", "nota.md"); await git("commit", "-m", "atualização");
    writeFileSync(join(raiz, "anvilore.toml"), "[hooks]\ngithub_backup = true\n");
    const c = capturarConsole();
    try {
      expect(await comandoHooksWiki(["backup", raiz])).toBe(0);
      expect(c.saida.join("\n")).toBe("");
    } finally { c.restaurar(); }
    expect((await git("rev-parse", "--verify", "origin/main")).code).toBe(0);
  });

  test("Dado remoto sem upstream Quando backup roda Então avisa e não cria branch remota", async () => {
    const remoto = `${raiz}-remote.git`;
    await git("init", "--initial-branch=main", "-q"); await git("config", "user.name", "Teste"); await git("config", "user.email", "teste@example.test");
    const init = Bun.spawnSync(["git", "init", "--bare", remoto], { stdout: "pipe", stderr: "pipe" }); expect(init.exitCode).toBe(0);
    writeFileSync(join(raiz, "wiki/nota.md"), "ok"); await git("add", "nota.md"); await git("commit", "-m", "nota"); await git("remote", "add", "origin", remoto);
    writeFileSync(join(raiz, "anvilore.toml"), "[hooks]\ngithub_backup = true\n");
    expect(await backupGitHub(raiz)).toMatchObject({ sincronizado: false, motivo: expect.stringContaining("upstream") });
    expect((await Bun.spawnSync(["git", "--git-dir", remoto, "branch", "--list"], { stdout: "pipe" })).stdout.toString()).toBe("");
    const c = capturarConsole();
    try {
      expect(await comandoHooksWiki(["backup", raiz])).toBe(2);
      expect(c.erros.join("\n")).toContain("upstream");
    } finally { c.restaurar(); }
  });

  test("Dado página em área e log diário Quando autoCommitWiki roda Então agrupa página, índice da área e log de hoje", async () => {
    await git("init", "-q"); await git("config", "user.name", "Teste"); await git("config", "user.email", "teste@example.test");
    mkdirSync(join(raiz, "wiki/pessoal/concepts"), { recursive: true }); mkdirSync(join(raiz, "wiki/log"), { recursive: true });
    const agora = new Date(); const dia = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}`;
    writeFileSync(join(raiz, "wiki/pessoal/concepts/ideia.md"), "nova");
    writeFileSync(join(raiz, "wiki/pessoal/index.md"), "índice área atualizado");
    writeFileSync(join(raiz, `wiki/log/log-${dia}.md`), "ingest de hoje");
    expect(await autoCommitWiki(raiz, "wiki/pessoal/concepts/ideia.md")).toBe(true);
    expect((await git("show", "--pretty=", "--name-only", "HEAD")).out.split(/\r?\n/).filter(Boolean).sort()).toEqual([
      `log/log-${dia}.md`, "pessoal/concepts/ideia.md", "pessoal/index.md",
    ]);
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
