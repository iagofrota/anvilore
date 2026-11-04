import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { executarProtecao } from "../src/comandos/hook-proteger-raw";
import { capturarConsole } from "./apoio/console";

describe("trava de verified nos quatro agentes", () => {
  let temporario: string;
  let consoleCapturado: ReturnType<typeof capturarConsole>;
  const ambiente = { ...process.env };

  beforeEach(() => {
    temporario = mkdtempSync(join(tmpdir(), "trava-verified-"));
    consoleCapturado = capturarConsole();
    delete process.env.ANVILORE_LOG_HOOK;
  });

  afterEach(() => {
    consoleCapturado.restaurar();
    for (const chave of Object.keys(process.env)) if (!(chave in ambiente)) delete process.env[chave];
    Object.assign(process.env, ambiente);
    rmSync(temporario, { recursive: true, force: true });
  });

  test("Dado `bun -e` que importa src/comandos/aprovar Quando a trava avalia Então bloqueia com saída 2", async () => {
    // Ataque 2: Claude (Bash), Codex (exec_command), Gemini (run_shell_command), Copilot (bash)
    const payloads = [
      JSON.stringify({ tool_name: "Bash", tool_input: { command: `bun -e 'import { aprovarPaginas } from "./src/comandos/aprovar";'` } }),
      JSON.stringify({ tool_name: "exec_command", tool_input: { cmd: `bun -e 'import("./src/comandos/aprovar.ts")'` } }),
      JSON.stringify({ tool_name: "run_shell_command", tool_input: { command: `bun -e "import('./src/comandos/aprovar')"` } }),
      JSON.stringify({ tool_name: "bash", tool_input: { command: `bun -e "const { aprovarPaginas } = require('./src/comandos/aprovar')"` } }),
    ];

    for (const payload of payloads) {
      const codigo = await executarProtecao(payload);
      expect(codigo).toBe(2);
      expect(consoleCapturado.erros.join("\n")).toContain("verified");
    }
  });

  test("Dado `sed -i`, `perl -pi`, `python3 -c` ou `echo … >>` que escreve verified em wiki/a.md Quando a trava avalia Então bloqueia com saída 2", async () => {
    // Ataque 3
    const comandos = [
      `sed -i 's/^generated:.*/verified:\\n  - by: human:fraude/' wiki/a.md`,
      `perl -pi -e 's/generated/verified/g' wiki/a.md`,
      `python3 -c 'open("wiki/a.md","a").write("verified: human:x\\n")'`,
      `echo "verified:\\n  - by: human:fraude" >> wiki/a.md`,
      `echo "$(printf 'verified: human:ana\\n' >> wiki/a.md)"`,
      `echo "\`printf 'verified: human:ana\\n' >> wiki/a.md\`"`,
      `git show --format='verified: human:ana' --output=wiki/a.md HEAD`,
      `git diff --output wiki/a.md HEAD:verified.md`,
    ];

    for (const comando of comandos) {
      const payload = JSON.stringify({ tool_name: "Bash", tool_input: { command: comando } });
      const codigo = await executarProtecao(payload);
      expect(codigo).toBe(2);
      expect(consoleCapturado.erros.join("\n")).toContain("verified");
    }
  });

  test("Dado apply_patch que acrescenta `by: human:x` em wiki/a.md Quando a trava avalia Então bloqueia", async () => {
    const patch = [
      "*** Update File: wiki/a.md",
      "--- a/wiki/a.md",
      "+++ b/wiki/a.md",
      "@@ -1,3 +1,5 @@",
      " ---",
      " generated: agente",
      "+verified:",
      "+  - by: human:fraude",
      " ---",
    ].join("\n");

    const payload = JSON.stringify({
      tool_name: "apply_patch",
      tool_input: { patch },
    });

    const codigo = await executarProtecao(payload);
    expect(codigo).toBe(2);
    expect(consoleCapturado.erros.join("\n")).toContain("verified");
  });

  test("Dado apply_patch com Move to para wiki Quando tenta forjar verified Então bloqueia", async () => {
    const patch = [
      "*** Update File: /tmp/fora.md",
      "*** Move to: wiki/fraude.md",
      "@@ -1,3 +1,5 @@",
      " ---",
      " generated: agente",
      "+verified:",
      "+  - by: human:fraude",
      " ---",
    ].join("\n");

    const payload = JSON.stringify({
      tool_name: "apply_patch",
      tool_input: { patch },
    });

    const codigo = await executarProtecao(payload);
    expect(codigo).toBe(2);
    expect(consoleCapturado.erros.join("\n")).toContain("verified");
  });

  test("Dado apply_patch em caminho com symlink para wiki Quando tenta forjar verified Então bloqueia", async () => {
    const wikiDir = join(temporario, "wiki");
    mkdirSync(wikiDir, { recursive: true });
    const link = join(temporario, "alias-wiki");
    symlinkSync(wikiDir, link, "dir");
    process.env.ANVILORE_WIKI = wikiDir;

    const patch = [
      `*** Add File: ${join(link, "fraude.md")}`,
      "+---",
      "+title: Fraude",
      "+generated:",
      "+  by: processo",
      "+verified:",
      "+  by: human:fraude",
      "+---",
      "+Conteúdo",
    ].join("\n");

    const payload = JSON.stringify({
      tool_name: "apply_patch",
      tool_input: { patch },
    });

    const codigo = await executarProtecao(payload);
    expect(codigo).toBe(2);
    expect(consoleCapturado.erros.join("\n")).toContain("verified");
  });

  test("Dado Set-Content do PowerShell com verified em wiki\\a.md (Copilot no Windows) Quando a trava avalia Então bloqueia", async () => {
    const comandos = [
      `Set-Content -Path wiki\\a.md -Value "verified: human:fraude"`,
      `"verified: human:x" | Set-Content wiki\\a.md`,
    ];

    for (const cmd of comandos) {
      const payload = JSON.stringify({
        tool_name: "powershell",
        tool_input: { command: cmd },
      });
      const codigo = await executarProtecao(payload);
      expect(codigo).toBe(2);
      expect(consoleCapturado.erros.join("\n")).toContain("verified");
    }
  });

  test("Dado `rg verified wiki/`, `git log -- wiki/`, `bun src/cli.ts fechar wiki` ou `bun test -t verified` Quando a trava avalia Então libera", async () => {
    const permitidos = [
      JSON.stringify({ tool_name: "Bash", tool_input: { command: "rg verified wiki/" } }),
      JSON.stringify({ tool_name: "Bash", tool_input: { command: "git log -- wiki/" } }),
      JSON.stringify({ tool_name: "Bash", tool_input: { command: "bun src/cli.ts fechar wiki" } }),
      JSON.stringify({ tool_name: "Bash", tool_input: { command: "bun test -t verified" } }),
      JSON.stringify({ tool_name: "Bash", tool_input: { command: "echo verified > /tmp/x" } }),
    ];

    for (const payload of permitidos) {
      const codigo = await executarProtecao(payload);
      expect(codigo).toBe(0);
    }
  });

  test("Dado Write que preserva o bloco verified de página aprovada Quando a trava avalia Então libera", async () => {
    const wikiDir = join(temporario, "wiki");
    mkdirSync(wikiDir, { recursive: true });
    process.env.ANVILORE_WIKI = wikiDir;

    const arquivo = join(wikiDir, "a.md");
    const bloco = "verified:\n  - by: human:ana\n    at: 2026-10-27T11:00:00Z";
    writeFileSync(arquivo, `---\ngenerated: agente\n${bloco}\n---\nTexto antigo.\n`);

    const payload = JSON.stringify({
      tool_name: "Write",
      tool_input: {
        file_path: arquivo,
        content: `---\ngenerated: agente\n${bloco}\n---\nTexto novo atualizado.\n`,
      },
    });

    const codigo = await executarProtecao(payload);
    expect(codigo).toBe(0);
  });

  test("Dado apply_patch sem cabeçalhos ou em outros arquivos Quando avalia Então decide corretamente", async () => {
    // Vazio
    expect(await executarProtecao(JSON.stringify({ tool_name: "apply_patch", tool_input: { patch: "" } }))).toBe(0);
    // Fora de wiki
    expect(await executarProtecao(JSON.stringify({ tool_name: "apply_patch", tool_input: { patch: "*** Update File: docs/nota.md\n+verified: human:x" } }))).toBe(0);
    // Sem cabeçalho mas cita verified (falha fechada)
    expect(await executarProtecao(JSON.stringify({ tool_name: "apply_patch", tool_input: { patch: "diff sem cabecalho verified: human:x" } }))).toBe(2);
    // Sem cabeçalho e sem verified
    expect(await executarProtecao(JSON.stringify({ tool_name: "apply_patch", tool_input: { patch: "diff sem cabecalho texto comum" } }))).toBe(0);
  });

  test("Dado comandos de terminal com wrappers, git ou erros de sintaxe Quando avalia Então protege", async () => {
    // Sintaxe com erro que cita verified em wiki
    expect(await executarProtecao(JSON.stringify({ tool_name: "Bash", tool_input: { command: "echo $(cat wiki/a.md) verified" } }))).toBe(2);
    // Aspas sem fechamento
    expect(await executarProtecao(JSON.stringify({ tool_name: "Bash", tool_input: { command: `echo "verified wiki/a.md` } }))).toBe(2);
    // git com subcomando de escrita citando verified em wiki
    expect(await executarProtecao(JSON.stringify({ tool_name: "Bash", tool_input: { command: "git checkout wiki/a.md # verified" } }))).toBe(2);
    // git com opção perigosa
    expect(await executarProtecao(JSON.stringify({ tool_name: "Bash", tool_input: { command: "git -c alias.x=foo log wiki/ # verified" } }))).toBe(2);
    // rg com pré-processador
    expect(await executarProtecao(JSON.stringify({ tool_name: "Bash", tool_input: { command: "rg --pre=cat verified wiki/" } }))).toBe(2);
    // wrapper env / time com comando de leitura
    expect(await executarProtecao(JSON.stringify({ tool_name: "Bash", tool_input: { command: "env VAR=1 time rg verified wiki/" } }))).toBe(0);
    // wrapper env com comando de escrita
    expect(await executarProtecao(JSON.stringify({ tool_name: "Bash", tool_input: { command: "env VAR=1 sed -i 's/a/b/' wiki/a.md # verified" } }))).toBe(2);
  });

  test("Dado payload com toolArgs serializado ou genérico Quando avalia Então decide", async () => {
    // toolArgs serializado como string JSON (Copilot)
    expect(await executarProtecao(JSON.stringify({
      tool_name: "bash",
      toolArgs: JSON.stringify({ command: "bun -e 'import(\"./src/comandos/aprovar\")'" }),
    }))).toBe(2);
    // toolArgs como texto puro de comando
    expect(await executarProtecao(JSON.stringify({
      tool_name: "bash",
      toolArgs: "sed -i 's/a/b/' wiki/a.md # verified",
    }))).toBe(2);
    // payload genérico citando aprovação
    expect(await executarProtecao(JSON.stringify({
      mensagem: "executar comandos/aprovar agora",
    }))).toBe(2);
    // payload genérico citando verified em wiki
    expect(await executarProtecao(JSON.stringify({
      mensagem: "tentando verified em wiki/a.md",
    }))).toBe(2);
    // payload genérico sem nada perigoso
    expect(await executarProtecao(JSON.stringify({
      mensagem: "apenas um texto qualquer",
    }))).toBe(0);
  });

  test("Dado edição em wiki com edits array Quando altera verified Então bloqueia e quando preserva libera", async () => {
    const wikiDir = join(temporario, "wiki");
    mkdirSync(wikiDir, { recursive: true });
    process.env.ANVILORE_WIKI = wikiDir;

    const arquivo = join(wikiDir, "edits.md");
    const bloco = "verified:\n  - by: human:ana\n    at: 2026-10-27T11:00:00Z";
    writeFileSync(arquivo, `---\ngenerated: agente\n${bloco}\n---\nCorpo.\n`);

    // Altera verified via edits
    const bloq = await executarProtecao(JSON.stringify({
      tool_name: "Edit",
      tool_input: {
        file_path: arquivo,
        edits: [{ old_string: "human:ana", new_string: "human:fraude" }],
      },
    }));
    expect(bloq).toBe(2);

    // Preserva verified via edits
    const lib = await executarProtecao(JSON.stringify({
      tool_name: "Edit",
      tool_input: {
        file_path: arquivo,
        edits: [{ old_string: "Corpo.", new_string: "Corpo atualizado." }],
      },
    }));
    expect(lib).toBe(0);

    // Edição fora de wiki
    expect(await executarProtecao(JSON.stringify({
      tool_name: "Edit",
      tool_input: {
        file_path: join(temporario, "fora.md"),
        content: "verified: human:x",
      },
    }))).toBe(0);

    // edits com old_string inexistente mas que altera verified
    const bloqInexistente = await executarProtecao(JSON.stringify({
      tool_name: "Edit",
      tool_input: {
        file_path: arquivo,
        edits: [{ old_string: "texto_inexistente", new_string: "verified:\n  - by: human:fraude" }],
      },
    }));
    expect(bloqInexistente).toBe(2);
  });

  test("Dado blocoVerified e caminhos adicionais de terminal e payload Quando testados Então cobrem casos de borda", async () => {
    // Array de comando
    expect(await executarProtecao(JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: ["git", "pull", "wiki/", "#", "verified"] },
    }))).toBe(2);

    // Loop de terminal com palavras reservadas
    expect(await executarProtecao(JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "for f in wiki/*.md; do sed -i 's/a/b/' $f; done # verified" },
    }))).toBe(2);

    // Escapamento com barra invertida
    expect(await executarProtecao(JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "echo\\ verified wiki/a.md" },
    }))).toBe(2);
  });
});
