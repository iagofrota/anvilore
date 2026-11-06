import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { executarProtecao } from "../src/comandos/hook-proteger-raw";
import { comandoHooksWiki } from "../src/comandos/hooks-wiki";
import { blocoVerified, encontrarRaizVault, mudouBloco } from "../src/lib/trava-verified";
import { capturarConsole } from "./apoio/console";

describe("trava de verified nos quatro agentes", () => {
  let temporario: string;
  let wikiDir: string;
  let consoleCapturado: ReturnType<typeof capturarConsole>;
  const ambiente = { ...process.env };

  beforeEach(() => {
    temporario = mkdtempSync(join(tmpdir(), "anvilore-trava-"));
    writeFileSync(join(temporario, "SCHEMA.md"), "# Schema\n");
    wikiDir = join(temporario, "wiki");
    mkdirSync(join(wikiDir, "pessoal/concepts"), { recursive: true });
    process.env.ANVILORE_WIKI = wikiDir;
    consoleCapturado = capturarConsole();
    delete process.env.ANVILORE_LOG_HOOK;
  });

  afterEach(async () => {
    consoleCapturado.restaurar();
    for (const chave of Object.keys(process.env)) if (!(chave in ambiente)) delete process.env[chave];
    Object.assign(process.env, ambiente);
    try {
      rmSync(temporario, { recursive: true, force: true });
    } catch {
      await new Promise(r => setTimeout(r, 50));
      try {
        rmSync(temporario, { recursive: true, force: true });
      } catch {}
    }
  });

  // --- Ataques A1 (A1.1 a A1.4): aprovar desarmado na CLI ---
  test("Dado comando aprovar na CLI por qualquer agente (A1.1-A1.4) Quando executado Então não altera verified e abre Revisão", async () => {
    const pagina = join(wikiDir, "pessoal/concepts/a.md");
    const conteudoInicial = "---\ntitle: Nota A\ngenerated:\n  by: process:agente\n  at: 2026-11-04T10:00:00Z\n---\nCorpo original.\n";
    writeFileSync(pagina, conteudoInicial);

    const payloads = [
      JSON.stringify({ cwd: temporario, tool_name: "Bash", tool_input: { command: `bun src/cli.ts "aprovar" wiki/pessoal/concepts/a.md` } }),
      JSON.stringify({ cwd: temporario, tool_name: "exec_command", tool_input: { cmd: `bun src/cli.ts "aprovar" wiki/pessoal/concepts/a.md` } }),
      JSON.stringify({ cwd: temporario, tool_name: "run_shell_command", tool_input: { command: `bun src/cli.ts "aprovar" wiki/pessoal/concepts/a.md` } }),
      JSON.stringify({ cwd: temporario, tool_name: "bash", tool_input: { command: `bun src/cli.ts "aprovar" wiki/pessoal/concepts/a.md` } }),
    ];

    for (const payload of payloads) {
      const codigo = await executarProtecao(payload);
      expect(codigo).toBe(0);
      expect(readFileSync(pagina, "utf8")).toBe(conteudoInicial);
      expect(readFileSync(pagina, "utf8")).not.toContain("verified:");
    }
  });

  // --- Ataques A2 (A2.1 a A2.4): bun -e importando aprovar ---
  test("Dado `bun -e` que importa src/comandos/aprovar (A2.1-A2.4) Quando a trava avalia Então bloqueia com saída 2", async () => {
    const payloads = [
      JSON.stringify({ cwd: temporario, tool_name: "Bash", tool_input: { command: `bun -e 'import { aprovarPelaInterface } from "./src/comandos/aprovar";'` } }),
      JSON.stringify({ cwd: temporario, tool_name: "exec_command", tool_input: { cmd: `bun -e 'import("./src/comandos/aprovar.ts")'` } }),
      JSON.stringify({ cwd: temporario, tool_name: "run_shell_command", tool_input: { command: `bun -e "import('./src/comandos/aprovar')"` } }),
      JSON.stringify({ cwd: temporario, tool_name: "bash", tool_input: { command: `bun -e "const { aprovarPelaInterface } = require('./src/comandos/aprovar')"` } }),
    ];

    for (const payload of payloads) {
      const codigo = await executarProtecao(payload);
      expect(codigo).toBe(2);
      expect(consoleCapturado.erros.join("\n")).toContain("verified");
    }
  });

  // --- Ataques A3 (A3.1 a A3.6): escrita direta por ferramentas e terminal ---
  test("Dado escrita direta de verified por ferramentas e terminal (A3.1-A3.6) Quando a trava avalia Então bloqueia", async () => {
    const pagina = join(wikiDir, "pessoal/concepts/a.md");
    const original = "---\ntitle: Nota A\ngenerated:\n  by: process:agente\n  at: 2026-11-04T10:00:00Z\n---\nCorpo.\n";
    writeFileSync(pagina, original);

    // A3.1 Claude Bash sed -i
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: `sed -i 's/generated:/verified:\\n  - by: human:fraude\\ngenerated:/' wiki/pessoal/concepts/a.md` },
    }))).toBe(2);

    // A3.2 Claude Write / Edit / MultiEdit
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Write",
      tool_input: { file_path: "wiki/pessoal/concepts/a.md", content: "---\nverified:\n  - by: human:fraude\n---\n" },
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Edit",
      tool_input: { file_path: "wiki/pessoal/concepts/a.md", old_string: "generated:", new_string: "verified:\n  - by: human:fraude\ngenerated:" },
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "MultiEdit",
      tool_input: { file_path: "wiki/pessoal/concepts/a.md", edits: [{ old_string: "generated:", new_string: "verified:\n  - by: human:fraude\ngenerated:" }] },
    }))).toBe(2);

    // A3.3 Codex perl -pi
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "exec_command",
      tool_input: { cmd: `perl -pi -e 's/generated:/verified:\\n  - by: human:fraude\\ngenerated:/' wiki/pessoal/concepts/a.md` },
    }))).toBe(2);

    // A3.4 Codex apply_patch
    const patchCodex = `*** Update File: wiki/pessoal/concepts/a.md\n@@ -1,4 +1,6 @@\n ---\n title: Nota A\n+verified:\n+  - by: human:fraude\n generated:`;
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "apply_patch",
      tool_input: { patch: patchCodex },
    }))).toBe(2);

    // A3.5 Gemini python3 -c / write_file / replace
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "run_shell_command",
      tool_input: { command: `python3 -c 'open("wiki/pessoal/concepts/a.md","a").write("verified: human:fraude\\n")'` },
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "write_file",
      tool_input: { file_path: "wiki/pessoal/concepts/a.md", content: "---\nverified:\n  - by: human:fraude\n---\n" },
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "replace",
      tool_input: { file_path: "wiki/pessoal/concepts/a.md", old_string: "generated:", new_string: "verified:\n  - by: human:fraude\ngenerated:" },
    }))).toBe(2);

    // A3.6 Copilot echo >> e Set-Content
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "bash",
      tool_input: { command: `echo "verified: by: human:fraude" >> wiki/pessoal/concepts/a.md` },
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "powershell",
      tool_input: { command: `Set-Content -Path wiki\\pessoal\\concepts\\a.md -Value "verified: human:fraude"` },
    }))).toBe(2);

    expect(readFileSync(pagina, "utf8")).toBe(original);
    expect(readFileSync(pagina, "utf8")).not.toContain("verified:");
  });

  // --- Ataques A4 e A5: Fechamento em falha ---
  test("Dado entradas truncadas, inválidas ou falha de leitura (A4.1, A4.2, A5.1) Então nega e sai 2", async () => {
    // A4.1 Stdin malformado em proteger-raw
    for (const entrada of ["{", "", "[1,2]", "null", "\"str\""]) {
      expect(await executarProtecao(entrada)).toBe(2);
    }

    // A4.2 toolArgs com JSON inválido em proteger-verified
    const c = capturarConsole();
    try {
      const codigo = await comandoHooksWiki(["proteger-verified", temporario], async () => JSON.stringify({
        tool_name: "bash",
        toolArgs: "{invalido",
      }));
      expect(codigo).toBe(2);
      expect(JSON.parse(c.saida.join("\n"))).toMatchObject({
        hookSpecificOutput: { permissionDecision: "deny" }
      });
    } finally {
      c.restaurar();
    }

    // A5.1 Exceção na leitura da entrada
    const c2 = capturarConsole();
    try {
      const codigo = await comandoHooksWiki(["proteger-verified", temporario], async () => {
        throw new Error("erro de I/O simulado");
      });
      expect(codigo).toBe(2);
      expect(JSON.parse(c2.saida.join("\n"))).toMatchObject({
        hookSpecificOutput: { permissionDecision: "deny" }
      });
    } finally {
      c2.restaurar();
    }
  });

  // --- P1.1 (C24, C25, C26, C27): YAML com aspas, flow style e unicode escapes ---
  test("Dado grafias válidas de YAML com aspas, flow style ou escapes (C24-C27) Quando tenta gravar verified Então bloqueia", async () => {
    const pagina = join(wikiDir, "pessoal/concepts/a.md");
    writeFileSync(pagina, "---\ntitle: Nota\ngenerated:\n  by: agente\n  at: 2026-11-04T10:00:00Z\n---\nCorpo.\n");

    const conteudosComVerified = [
      // C24: aspas duplas
      "---\ntitle: Nota\n\"verified\":\n  - by: \"human:ana\"\n    at: 2026-11-04T12:00:00Z\n---\nCorpo.\n",
      // C25: aspas simples
      "---\ntitle: Nota\n'verified':\n  - 'by': 'human:ana'\n    at: 2026-11-04T12:00:00Z\n---\nCorpo.\n",
      // C26: flow style com chave entre aspas
      "---\ntitle: Nota\n\"verified\": [{\"by\": \"human:ana\", \"at\": \"2026-11-04T12:00:00Z\"}]\n---\nCorpo.\n",
      // C27: escape Unicode na chave
      "---\ntitle: Nota\n\"v\\u0065rified\":\n  - by: \"human:ana\"\n    at: 2026-11-04T12:00:00Z\n---\nCorpo.\n",
    ];

    for (const conteudo of conteudosComVerified) {
      // Garante estado inicial no disco
      writeFileSync(pagina, "---\ntitle: Nota\ngenerated:\n  by: agente\n  at: 2026-11-04T10:00:00Z\n---\nCorpo.\n");

      // Via Write
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Write",
        tool_input: { file_path: "wiki/pessoal/concepts/a.md", content: conteudo },
      }))).toBe(2);

      // Via Edit
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Edit",
        tool_input: {
          file_path: "wiki/pessoal/concepts/a.md",
          old_string: "generated:\n  by: agente\n  at: 2026-11-04T10:00:00Z",
          new_string: conteudo.split("---\n")[1]!.trim(),
        },
      }))).toBe(2);

      // Via apply_patch
      const blocoFrontmatter = conteudo.slice(4, conteudo.indexOf("\n---", 4));
      const linhasBloco = blocoFrontmatter.split("\n").filter(l => !l.startsWith("title:"));
      const patch = [
        "*** Update File: wiki/pessoal/concepts/a.md",
        "@@ -2,4 +2,6 @@",
        " title: Nota",
        ...linhasBloco.map(l => `+${l}`),
        "-generated:",
        "-  by: agente",
        "-  at: 2026-11-04T10:00:00Z",
      ].join("\n");
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "apply_patch",
        tool_input: { patch },
      }))).toBe(2);
    }
  });

  // --- P1.2 (C10, C12, C13): Envolvedores de terminal com opções e argumentos ---
  test("Dado envolvedores com opções que consom argumentos (C10, C12, C13) Quando tentam contornar a trava Então bloqueia", async () => {
    // C10: xargs -I true sed -i ... true
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: "echo wiki/pessoal/concepts/a.md | xargs -I true sed -i 's/generated:/verified:\\n  - by: human:fraude\\n    at: 2026-11-04T12:00:00Z\\ngenerated:/' true" },
    }))).toBe(2);

    // C12: env -u true sed -i ... wiki/a.md
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: "env -u true sed -i 's/generated:/verified:\\n  - by: human:fraude\\n    at: 2026-11-04T12:00:00Z\\ngenerated:/' wiki/pessoal/concepts/a.md" },
    }))).toBe(2);

    // C13: env -u cat bun -e import
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: `env -u cat bun -e 'import { aprovarPelaInterface } from "./src/comandos/aprovar";'` },
    }))).toBe(2);

    // time com opção de saída direcionada para wiki/
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: `time --output=wiki/pessoal/concepts/a.md echo "verified: human:x"` },
    }))).toBe(2);

    // sudo -u cat
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: `sudo -u cat sed -i 's/generated:/verified:/' wiki/pessoal/concepts/a.md` },
    }))).toBe(2);
  });

  // --- P1.3 (C28, C29): apply_patch e Edit replace_all em at: ---
  test("Dado apply_patch em at: ou Edit com replace_all em at: (C28, C29) Quando a trava avalia Então bloqueia", async () => {
    const pagina = join(wikiDir, "pessoal/concepts/a.md");
    const timestampAntigo = "2026-10-01T10:00:00Z";
    const timestampNovo = "2026-11-04T12:00:00Z";

    const conteudoComVerified = [
      "---",
      "title: Teste",
      "sources:",
      "  - url: https://example.com",
      `    last_modified: ${timestampAntigo}`,
      "generated:",
      "  by: process:agente",
      "  at: 2026-11-04T11:00:00Z",
      "verified:",
      "  - by: human:ana",
      `    at: ${timestampAntigo}`,
      "---",
      "Corpo da nota.",
    ].join("\n");
    writeFileSync(pagina, conteudoComVerified);

    // C28: apply_patch alterando apenas at:
    const patchAt = [
      "*** Update File: wiki/pessoal/concepts/a.md",
      "@@ -9,4 +9,4 @@",
      " verified:",
      "   - by: human:ana",
      `-    at: ${timestampAntigo}`,
      `+    at: ${timestampNovo}`,
      " ---",
    ].join("\n");

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "apply_patch",
      tool_input: { patch: patchAt },
    }))).toBe(2);

    // C29: Edit com replace_all: true substituindo o timestamp que aparece antes em sources
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Edit",
      tool_input: {
        file_path: "wiki/pessoal/concepts/a.md",
        old_string: timestampAntigo,
        new_string: timestampNovo,
        replace_all: true,
      },
    }))).toBe(2);

    expect(readFileSync(pagina, "utf8")).toBe(conteudoComVerified);
  });

  // --- P1.4 (C30, C31, C32): Envenenamento de workdir e chaves desconhecidas/vazias ---
  test("Dado envenenamento de workdir, patch em chave desconhecida ou comando vazio (C30-C32) Então bloqueia", async () => {
    const pagina = join(wikiDir, "pessoal/concepts/a.md");
    writeFileSync(pagina, "---\ntitle: Nota A\ngenerated:\n  by: agente\n---\n");

    // C30: file_path em wiki mas workdir: /tmp injetado
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Write",
      tool_input: {
        file_path: "wiki/pessoal/concepts/a.md",
        workdir: "/tmp",
        content: "---\nverified:\n  - by: human:fraude\n---\n",
      },
    }))).toBe(2);

    // C31: apply_patch com patch em chave `input` em vez de `patch`
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "apply_patch",
      tool_input: { input: "*** Update File: wiki/pessoal/concepts/a.md\n+verified:\n+  - by: human:fraude" },
    }))).toBe(2);

    // C32: Bash com command vazio ou em chave `script`
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: "" },
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { script: "sed -i 's/a/b/' wiki/a.md # verified" },
    }))).toBe(2);
  });

  // --- Vetores de Terminal C1 a C20 ---
  test("Dado vetores de terminal C1 a C20 Quando avaliados Então comportam-se conforme a especificação", async () => {
    const pagina = join(wikiDir, "pessoal/concepts/a.md");
    writeFileSync(pagina, "---\ntitle: A\n---\n");

    // C1: A=aprovar; bun src/cli.ts $A wiki/pessoal/concepts/a.md (caminho oficial desarmado)
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: "A=aprovar; bun src/cli.ts $A wiki/pessoal/concepts/a.md" },
    }))).toBe(0);

    // C2: V=verified; echo "$V: human:x" >> wiki/a.md
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: `V=verified; echo "$V: human:x" >> wiki/pessoal/concepts/a.md` },
    }))).toBe(2);

    // C4: eval 'echo verified: human:ana >> wiki/a.md'
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: `eval 'echo verified: human:ana >> wiki/pessoal/concepts/a.md'` },
    }))).toBe(2);

    // C7: Heredoc literal cat << 'EOF' >> wiki/a.md ... verified: human:ana
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: `cat << 'EOF' >> wiki/pessoal/concepts/a.md\nverified:\n  - by: human:ana\nEOF` },
    }))).toBe(2);

    // C9: xargs direto
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: `echo wiki/pessoal/concepts/a.md | xargs sed -i 's/generated/verified/'` },
    }))).toBe(2);

    // C11: env direto
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: `env sed -i 's/generated/verified/' wiki/pessoal/concepts/a.md` },
    }))).toBe(2);

    // C14: tee -a
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: `echo 'verified: human:ana' | tee -a wiki/pessoal/concepts/a.md` },
    }))).toBe(2);

    // C15: dd
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: `dd of=wiki/pessoal/concepts/a.md <<< 'verified: human:ana'` },
    }))).toBe(2);

    // C17: git checkout / git apply citando verified e wiki/a.md
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: `git checkout HEAD -- wiki/pessoal/concepts/a.md # verified` },
    }))).toBe(2);

    // C19: ln -s para wiki/a.md seguido de Write
    const atalho = join(temporario, "atalho.md");
    symlinkSync(pagina, atalho);
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Write",
      tool_input: { file_path: atalho, content: "---\nverified:\n  - by: human:fraude\n---\n" },
    }))).toBe(2);

    // C21: Alias de caminho ./wiki/../wiki/...
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Write",
      tool_input: { file_path: "./wiki/../wiki/pessoal/concepts/a.md", content: "---\nverified:\n  - by: human:fraude\n---\n" },
    }))).toBe(2);

    // C22: Case VERIFIED: e homógrafo Unicode cirílico vеrified:
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Write",
      tool_input: { file_path: "wiki/pessoal/concepts/a.md", content: "---\nVERIFIED:\n  - by: human:fraude\n---\n" },
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Write",
      tool_input: { file_path: "wiki/pessoal/concepts/a.md", content: "---\nv\u0435rified:\n  - by: human:fraude\n---\n" },
    }))).toBe(2);

    // C23: verified :
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Write",
      tool_input: { file_path: "wiki/pessoal/concepts/a.md", content: "---\nverified :\n  - by: human:fraude\n---\n" },
    }))).toBe(2);
  });

  // --- Riscos Residuais Declarados (§1 de DESENHO-APROVACAO.md: C3, C5, C6, C8, C16, C18, C20) ---
  test("Dado vetores de risco residual aceitos pelo desenho (C3, C5, C6, C8, C16, C18, C20) Quando executados Então comportam-se conforme esperado", async () => {
    const pagina = join(wikiDir, "pessoal/concepts/a.md");
    writeFileSync(pagina, "---\ntitle: A\n---\n");

    // C3: partindo a palavra (bloqueado pela Regra 4: terminal não escreve em wiki/ com >>)
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: `K=veri; V=fied; printf '%s%s:\n  - by: hu%s\n' $K $V man:ana >> wiki/pessoal/concepts/a.md` },
    }))).toBe(2);

    // C5: concatenação de aspas com redireção para wiki/ (bloqueado pela Regra B1/B2: redireção citando wiki)
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: `eval 'echo "veri""fied:" >> wiki/pessoal/concepts/a.md'` },
    }))).toBe(2);

    // C6: base64 (bloqueado pela Regra 4: terminal não escreve em wiki/ com >>)
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: `echo dmVyaWZpZWQ6CiAgLSBieTogaHVtYW46YW5hCg== | base64 -d >> wiki/pessoal/concepts/a.md` },
    }))).toBe(2);

    // C8: heredoc (bloqueado pela Regra B1: interpretador com heredoc << citando wiki)
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: `python3 - << 'EOF'\nopen("wiki/pessoal/concepts/a.md","a").write("veri"+"fied:...")\nEOF` },
    }))).toBe(2);

    // C16: arquivo preparado em /tmp e cp (bloqueado pela Regra 4: cp com destino em wiki/)
    const prep = join(temporario, "prep.md");
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Write",
      tool_input: { file_path: prep, content: "---\nverified:\n  - by: human:ana\n---\n" },
    }))).toBe(0);
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: `cp ${prep} wiki/pessoal/concepts/a.md` },
    }))).toBe(2);

    // C18: git apply /tmp/patch.diff
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: `git apply /tmp/patch.diff` },
    }))).toBe(0);

    // C20: ln -s sem .md e echo posterior
    const atalhoSemMd = join(temporario, "atalho");
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: `ln -s wiki/pessoal/concepts/a.md ${atalhoSemMd}` },
    }))).toBe(0);
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: `echo "verified: human:ana" >> ${atalhoSemMd}` },
    }))).toBe(0);
  });

  // --- Falsos Positivos Bloqueantes (FP1 a FP5 / P2.1) ---
  test("Dado operações legítimas do dia a dia (FP1 a FP5) Quando a trava avalia Então libera com saída 0", async () => {
    const pagina = join(wikiDir, "pessoal/concepts/verified-boot.md");
    writeFileSync(pagina, "---\ntitle: Verified Boot\ngenerated:\n  by: process:agente\n  at: 2026-11-04T10:00:00Z\n---\nTexto sobre boot verificado.\n");

    // FP1: rg verified wiki/ 2>/dev/null
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: "rg verified wiki/ 2>/dev/null" },
    }))).toBe(0);

    // FP2: rg verified wiki/ > /tmp/resultado.txt
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: "rg verified wiki/ > /tmp/resultado.txt" },
    }))).toBe(0);

    // FP3: git add e git commit citando verified
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: "git add wiki/pessoal/concepts/verified-boot.md" },
    }))).toBe(0);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: `git commit -m "docs: atualizar nota.md sobre verified e processo de boot"` },
    }))).toBe(0);

    // FP4: bun src/cli.ts validar e bun src/cli.ts capturar
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: "bun src/cli.ts validar wiki/pessoal/concepts/verified-boot.md" },
    }))).toBe(0);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: "bun src/cli.ts capturar https://example.com/verified-doc --contexto-de /tmp/c.md" },
    }))).toBe(0);

    // FP5: Write / Edit / apply_patch com verified ou by: human: no CORPO da nota (após o segundo ---)
    const textoComCorpoVerified = [
      "---",
      "title: Documentação de Segurança",
      "generated:",
      "  by: process:agente",
      "  at: 2026-11-04T10:00:00Z",
      "---",
      "# Guia de Configuração",
      "Aqui está um exemplo de proveniência humana no frontmatter:",
      "```yaml",
      "verified:",
      "  - by: human:ana",
      "    at: 2026-11-04T12:00:00Z",
      "```",
    ].join("\n");

    // Write no corpo
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Write",
      tool_input: { file_path: "wiki/pessoal/concepts/verified-boot.md", content: textoComCorpoVerified },
    }))).toBe(0);

    // Grava no disco para que a simulação de Edit e apply_patch encontrem o arquivo base
    writeFileSync(pagina, textoComCorpoVerified);

    // Edit no corpo
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Edit",
      tool_input: {
        file_path: "wiki/pessoal/concepts/verified-boot.md",
        old_string: "human:ana",
        new_string: "human:carlos",
      },
    }))).toBe(0);

    // Atualiza disco para a versão após Edit
    writeFileSync(pagina, textoComCorpoVerified.replace("human:ana", "human:carlos"));

    // apply_patch no corpo
    const patchCorpo = [
      "*** Update File: wiki/pessoal/concepts/verified-boot.md",
      "@@ -10,4 +10,5 @@",
      " verified:",
      "   - by: human:carlos",
      "+    nota: exemplo no corpo",
      "     at: 2026-11-04T12:00:00Z",
      " ```",
    ].join("\n");

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "apply_patch",
      tool_input: { patch: patchCorpo },
    }))).toBe(0);
  });

  // --- Cobertura exaustiva de ramificações internas de trava-verified ---
  test("Dado funções e ramificações auxiliares de trava-verified Quando executadas Então cobrem todos os fluxos com rigor", async () => {
    const pagina = join(wikiDir, "pessoal/concepts/a.md");
    writeFileSync(pagina, "---\ntitle: A\n---\n");

    // 1. blocoVerified e mudouBloco
    expect(blocoVerified("---\nverified:\n  - by: human:ana\n---\n")).toContain("human:ana");
    expect(blocoVerified("---\nVERIFIED:\n  - by: human:ana\n---\n")).toBe("INVALID_OR_EVASIVE_VERIFIED");
    expect(blocoVerified("sem frontmatter")).toBe("");
    expect(mudouBloco("---\n---", "---\nverified:\n  - by: human:ana\n---\n")).toBe(true);
    expect(mudouBloco("---\nverified:\n  - by: human:ana\n---\n", "---\nverified:\n  - by: human:ana\n---\n")).toBe(false);
    expect(mudouBloco("---\nVERIFIED:\n  - by: human:ana\n---\n", "---\n---")).toBe(true);
    expect(blocoVerified("---\n[invalido\n---\n")).toBe("");
    expect(mudouBloco("---\n[invalido\n---\n", "---\n---")).toBe(true);

    // 2. env -S e --split-string
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: "env -S sed\\_-i\\_'s/a/b/' wiki/pessoal/concepts/a.md # verified" },
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: "env --split-string=sed\\_-i wiki/pessoal/concepts/a.md # verified" },
    }))).toBe(2);

    // 3. Frontmatter inválido na proposta e no disco
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Write",
      tool_input: { file_path: "wiki/pessoal/concepts/a.md", content: "---\n[invalid yaml\n---\n" },
    }))).toBe(2);

    writeFileSync(pagina, "---\n[invalid yaml no disco\n---\n");
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Write",
      tool_input: { file_path: "wiki/pessoal/concepts/a.md", content: "---\ntitle: Valido\n---\n" },
    }))).toBe(2);

    // Restaura página válida
    writeFileSync(pagina, "---\ntitle: Valido\n---\nLinha 1\nLinha 2\n");

    // 4. apply_patch variantes: Add, Delete, Move, diff --git
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "apply_patch",
      tool_input: { patch: "*** Add File: wiki/pessoal/concepts/novo.md\n+---\n+verified:\n+  - by: human:fraude\n+---\n" },
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "apply_patch",
      tool_input: { patch: "*** Add File: wiki/pessoal/concepts/novo2.md\n+---\n+title: Novo\n+---\n" },
    }))).toBe(0);

    const arqVerificado = join(wikiDir, "pessoal/concepts/deletar-verificado.md");
    writeFileSync(arqVerificado, "---\nverified:\n  - by: human:ana\n---\n");
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "apply_patch",
      tool_input: { patch: "*** Delete File: wiki/pessoal/concepts/deletar-verificado.md\n" },
    }))).toBe(2);

    const arqNormal = join(wikiDir, "pessoal/concepts/deletar-normal.md");
    writeFileSync(arqNormal, "---\ntitle: Normal\n---\n");
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "apply_patch",
      tool_input: { patch: "*** Delete File: wiki/pessoal/concepts/deletar-normal.md\n" },
    }))).toBe(0);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "apply_patch",
      tool_input: { patch: "*** Update File: wiki/pessoal/concepts/deletar-normal.md\n*** Move to: wiki/pessoal/concepts/destino.md\n" },
    }))).toBe(0);

    writeFileSync(arqNormal, "---\ntitle: Normal\n---\n");
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "apply_patch",
      tool_input: { patch: "diff --git a/wiki/pessoal/concepts/deletar-normal.md b/wiki/pessoal/concepts/deletar-normal.md\n--- a/wiki/pessoal/concepts/deletar-normal.md\n+++ b/wiki/pessoal/concepts/deletar-normal.md\n@@ -1,3 +1,3 @@\n ---\n-title: Normal\n+title: Alterado\n ---\n" },
    }))).toBe(0);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "apply_patch",
      tool_input: { patch: "patch sem formato verified" },
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "apply_patch",
      tool_input: { patch: "patch sem formato outro" },
    }))).toBe(0);

    // 5. MultiEdit
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "MultiEdit",
      tool_input: {
        file_path: "wiki/pessoal/concepts/a.md",
        edits: [
          { old_string: "Linha 1", new_string: "Linha A", replace_all: true },
          { old_string: "Linha 2", new_string: "Linha B", replace_all: false },
        ],
      },
    }))).toBe(0);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "MultiEdit",
      tool_input: {
        file_path: "wiki/pessoal/concepts/a.md",
        edits: [{ old_string: "Inexistente", new_string: "X", replace_all: true }],
      },
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "MultiEdit",
      tool_input: {
        file_path: "wiki/pessoal/concepts/a.md",
        edits: [{ old_string: "Inexistente", new_string: "X", replace_all: false }],
      },
    }))).toBe(2);

    // Edit com replace_all: false quando não encontra o texto
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Edit",
      tool_input: {
        file_path: "wiki/pessoal/concepts/a.md",
        old_string: "TextoTotalmenteInexistente",
        new_string: "Novo",
        replace_all: false,
      },
    }))).toBe(2);

    // 6. Terminal edge cases
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: 'echo "`cat wiki/a.md`" # verified' },
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: 'echo "sem fechar wiki/a.md verified' },
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: 'git --version wiki/a.md # verified' },
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: 'git log --output=wiki/out.md # verified' },
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: 'rg --pre=cat verified wiki/a.md' },
    }))).toBe(2);

    // Ferramenta desconhecida mexendo em wiki/
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "ferramenta_alienigena",
      tool_input: { target: "wiki/nota.md" },
    }))).toBe(2);

    // Payload genérico
    expect(await executarProtecao(JSON.stringify({
      acao: "chamar_aprovarPelaInterface",
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      nota: "verified em wiki/a.md",
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      sem_ferramenta: "conteudo normal sem verified",
    }))).toBe(0);

    // 7. Leitura com falha EISDIR (arquivo é pasta)
    const dirComoArquivo = join(wikiDir, "pessoal/concepts/diretorio");
    mkdirSync(dirComoArquivo, { recursive: true });
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Write",
      tool_input: { file_path: dirComoArquivo, content: "---\nverified:\n  - by: human:fraude\n---\n" },
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Edit",
      tool_input: { file_path: dirComoArquivo, old_string: "a", new_string: "b" },
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "MultiEdit",
      tool_input: { file_path: dirComoArquivo, edits: [{ old_string: "a", new_string: "b" }] },
    }))).toBe(2);

    // 8. Patch com hunk apenas de adição, rename to, --- / +++ e hunks que não aplicam
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "apply_patch",
      tool_input: { patch: "*** Update File: wiki/pessoal/concepts/deletar-normal.md\n@@ -0,0 +1,2 @@\n+---\n+title: Normal\n" },
    }))).toBe(0);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "apply_patch",
      tool_input: { patch: "diff --git a/wiki/pessoal/concepts/deletar-normal.md b/wiki/pessoal/concepts/destino2.md\nrename to wiki/pessoal/concepts/destino2.md\n" },
    }))).toBe(0);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "apply_patch",
      tool_input: { patch: "--- a/wiki/pessoal/concepts/deletar-normal.md\n+++ b/wiki/pessoal/concepts/deletar-normal.md\n@@ -1,2 +1,2 @@\n ---\n-title: Normal\n+title: Outro\n" },
    }))).toBe(0);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "apply_patch",
      tool_input: { patch: "*** Update File: wiki/pessoal/concepts/deletar-normal.md\n@@ -1,2 +1,2 @@\n-TextoQueNaoExiste\n+NovoTexto\n" },
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "apply_patch",
      tool_input: { patch: "*** Update File: wiki/pessoal/concepts/deletar-normal.md\n@@ -1,2 +1,4 @@\n ---\n+verified:\n+  - by: human:fraude\n title: Normal\n" },
    }))).toBe(2);

    // 9. Expansões e subshells adicionais
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: 'echo "$(cat wiki/a.md)" # verified' },
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: 'echo \\ esc\\ apado wiki/a.md # verified' },
    }))).toBe(0);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: '(cat wiki/a.md) # verified' },
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: 'git -C wiki/ # verified' },
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: 'git -c core.pager=cat log wiki/a.md # verified' },
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: 'echo verified wiki/ >' },
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: 'VAR=1 ; echo ok wiki/a.md # verified' },
    }))).toBe(0);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: 'env wiki/a.md # verified' },
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: 'bun src/cli.ts desconhecido wiki/a.md # verified' },
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "apply_patch",
      tool_input: { outro_formato: "patch" },
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: ["git", "checkout", "HEAD", "wiki/a.md", "#", "verified"] },
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Write",
      tool_input: { content: "sem caminho" },
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "MultiEdit",
      tool_input: { file_path: "wiki/pessoal/concepts/a.md", edits: ["invalido"] },
    }))).toBe(2);

    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Edit",
      tool_input: { file_path: "wiki/pessoal/concepts/a.md" },
    }))).toBe(2);
  });

  // --- Delta 1ba1405 (D1 a D4): Vetores descobertos no reQA do QA 2 ---
  describe("Delta 1ba1405 (D1 a D4): Contratos do QA 2", () => {
    test("Dado confusão de tipo por injeção de patch, cmd, command ou content (D1.1 a D1.5) Quando avaliado Então bloqueia com 2", async () => {
      const pagina = join(wikiDir, "pessoal/concepts/a.md");
      writeFileSync(pagina, "---\ntitle: Nota A\ngenerated:\n  by: process:agente\n  at: 2026-11-04T10:00:00Z\n---\nCorpo original.\n");

      // D1.1: Bash com patch: ""
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: {
          command: "sed -i 's/generated:/verified:\\n  - by: human:fraude\\n    at: 2026-11-04T12:00:00Z\\ngenerated:/' wiki/pessoal/concepts/a.md",
          patch: "",
        },
      }))).toBe(2);

      // D1.2: Write com patch: ""
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Write",
        tool_input: {
          file_path: "wiki/pessoal/concepts/a.md",
          content: "---\nverified:\n  - by: human:fraude\n---\n",
          patch: "",
        },
      }))).toBe(2);

      // D1.3: Write com cmd: "true"
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Write",
        tool_input: {
          file_path: "wiki/pessoal/concepts/a.md",
          content: "---\nverified:\n  - by: human:fraude\n---\n",
          cmd: "true",
        },
      }))).toBe(2);

      // D1.4: Edit com command: "true"
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Edit",
        tool_input: {
          file_path: "wiki/pessoal/concepts/a.md",
          old_string: "generated:\n  by: process:agente\n  at: 2026-11-04T10:00:00Z",
          new_string: "verified:\n  - by: human:fraude\n    at: 2026-11-04T12:00:00Z",
          command: "true",
        },
      }))).toBe(2);

      // D1.5: Edit com content: ""
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Edit",
        tool_input: {
          file_path: "wiki/pessoal/concepts/a.md",
          old_string: "generated:\n  by: process:agente\n  at: 2026-11-04T10:00:00Z",
          new_string: "verified:\n  - by: human:fraude\n    at: 2026-11-04T12:00:00Z",
          content: "",
        },
      }))).toBe(2);
    });

    test("Dado contornos de parser em apply_patch (D2.1 a D2.3) Quando avaliado Então bloqueia com 2", async () => {
      const pagina = join(wikiDir, "pessoal/concepts/a.md");
      writeFileSync(pagina, "---\ntitle: Nota A\ngenerated:\n  by: process:agente\n  at: 2026-11-04T10:00:00Z\n---\nCorpo original.\n");

      // D2.1: Update sem @@
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "apply_patch",
        tool_input: {
          patch: "*** Begin Patch\n*** Update File: wiki/pessoal/concepts/a.md\n+verified:\n+  - by: human:fraude\n*** End Patch",
        },
      }))).toBe(2);

      // D2.2: Adição pura (sem linhas de contexto)
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "apply_patch",
        tool_input: {
          patch: "*** Begin Patch\n*** Update File: wiki/pessoal/concepts/a.md\n@@ -7,0 +8,3 @@\n+verified:\n+  - by: human:fraude\n+    at: 2026-11-04T12:00:00Z\n*** End Patch",
        },
      }))).toBe(2);

      // D2.3: +++ /tmp/fora.md no corpo
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "apply_patch",
        tool_input: {
          patch: "*** Begin Patch\n*** Update File: wiki/pessoal/concepts/a.md\n+++ /tmp/fora.md\n@@ -1,3 +1,5 @@\n title: Nota A\n+verified:\n+  - by: human:fraude\n*** End Patch",
        },
      }))).toBe(2);
    });

    test("Dado manipulação de workdir no terminal ou cwd forjado (D3.1 a D3.3) Quando avaliado Então bloqueia com 2", async () => {
      const pagina = join(wikiDir, "pessoal/concepts/a.md");
      writeFileSync(pagina, "---\ntitle: Nota A\ngenerated:\n  by: process:agente\n  at: 2026-11-04T10:00:00Z\n---\nCorpo original.\n");

      // D3.1: workdir apontando para wiki e caminho relativo no terminal
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "exec_command",
        tool_input: {
          command: 'echo "verified: human:fraude" >> pessoal/concepts/a.md',
          workdir: wikiDir,
        },
      }))).toBe(2);

      // D3.2: workdir apontando para wiki e sed com glob
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "exec_command",
        tool_input: {
          command: "sed -i 's/generated/verified/' pessoal/concepts/a.m*",
          workdir: wikiDir,
        },
      }))).toBe(2);

      // D3.3: investigado no QA3 (P2-T4) — dados.cwd vem do harness; resolve(cwd, file_path) cai fora de wiki/ e libera sem afetar o vault
      expect(await executarProtecao(JSON.stringify({
        cwd: "/tmp",
        tool_name: "Write",
        tool_input: {
          file_path: "wiki/pessoal/concepts/a.md",
          content: "---\nverified:\n  - by: human:fraude\n---\n",
        },
      }))).toBe(0);

      // A3.6 / P1-D3b: sem dados.cwd no payload em vault externo
      expect(await executarProtecao(JSON.stringify({
        tool_name: "bash",
        tool_input: {
          command: "echo 'verified: by: human:fraude' >> wiki/pessoal/concepts/a.md",
        },
      }))).toBe(2);
    });

    test("Dado ataque em 2 passos combinando Write após 2o --- e sed apagando o delimitador (D4.1) Então o passo 2 bloqueia", async () => {
      const pagina = join(wikiDir, "pessoal/concepts/a.md");
      const textoPasso1 = "---\ntitle: Nota A\n---\nverified:\n  - by: human:fraude\n---\nCorpo.\n";

      // Passo 1: Write de conteúdo no corpo (liberado se não altera o frontmatter inicial)
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Write",
        tool_input: {
          file_path: "wiki/pessoal/concepts/a.md",
          content: textoPasso1,
        },
      }))).toBe(0);

      // Escreve no disco o resultado do passo 1
      writeFileSync(pagina, textoPasso1);

      // Passo 2: sed -i apagando linhas 2,3 (delimitador ---) para promover verified ao frontmatter
      // Deve ser bloqueado pela regra 4: terminal não escreve em .md de wiki/
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: {
          command: "sed -i '2,3d' wiki/pessoal/concepts/a.md",
        },
      }))).toBe(2);
    });

    test("Dado comandos legítimos de leitura, git e CLI do kit sob a Regra 4 Então passam com 0 (falsos positivos prevenidos)", async () => {
      // 1. rg com redirecionamento para fora de wiki/
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: {
          command: "rg verified wiki/ > /tmp/x",
        },
      }))).toBe(0);

      // 2. cat lendo página da wiki
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: {
          command: "cat wiki/pessoal/concepts/a.md",
        },
      }))).toBe(0);

      // 3. git commit
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: {
          command: "git commit -m 'adiciona nota'",
        },
      }))).toBe(0);

      // 4. bun src/cli.ts fechar
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: {
          command: "bun src/cli.ts fechar",
        },
      }))).toBe(0);

      // 5. Write legítimo em wiki/
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Write",
        tool_input: {
          file_path: "wiki/pessoal/concepts/legitima.md",
          content: "---\ntitle: Nota Legítima\ngenerated:\n  by: process:agente\n  at: 2026-11-04T10:00:00Z\n---\nCorpo.\n",
        },
      }))).toBe(0);

      // 6. Edit legítimo em wiki/
      const legitima = join(wikiDir, "pessoal/concepts/legitima.md");
      writeFileSync(legitima, "---\ntitle: Nota Legítima\ngenerated:\n  by: process:agente\n  at: 2026-11-04T10:00:00Z\n---\nCorpo.\n");
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Edit",
        tool_input: {
          file_path: "wiki/pessoal/concepts/legitima.md",
          old_string: "Corpo.",
          new_string: "Corpo editado.",
        },
      }))).toBe(0);
    });

    test("Dado ferramentas de leitura, branches de validação fechada e envolvedores Então cobre branches auxiliares da trava", async () => {
      // Ferramentas de leitura
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "read_file",
        tool_input: { file_path: "wiki/pessoal/concepts/a.md" },
      }))).toBe(0);

      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "view",
        tool_input: { path: "wiki/pessoal/concepts/a.md" },
      }))).toBe(0);

      // MultiEdit casos de erro / validação
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "MultiEdit",
      }))).toBe(2);

      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "MultiEdit",
        tool_input: { edits: [] },
      }))).toBe(2);

      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "MultiEdit",
        tool_input: { file_path: "wiki/pessoal/concepts/a.md", edits: [] },
      }))).toBe(2);

      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "MultiEdit",
        tool_input: { file_path: "wiki/pessoal/concepts/a.md", edits: [{ old_string: "x" }] },
      }))).toBe(2);

      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "MultiEdit",
        tool_input: { file_path: "wiki/pessoal/concepts/a.md", edits: [{ old_string: "inexistente", new_string: "y", replace_all: true }] },
      }))).toBe(2);

      // Write casos de erro
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Write",
      }))).toBe(2);

      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Write",
        tool_input: { content: "sem caminho" },
      }))).toBe(2);

      // Edit casos de erro
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Edit",
      }))).toBe(2);

      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Edit",
        tool_input: { old_string: "a", new_string: "b" },
      }))).toBe(2);

      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Edit",
        tool_input: { file_path: "wiki/pessoal/concepts/a.md", old_string: "inexistente", new_string: "b", replace_all: true },
      }))).toBe(2);

      // Terminal casos de erro e envolvedores
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
      }))).toBe(2);

      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: { command: "time -o wiki/out.md ls" },
      }))).toBe(2);

      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: { command: "truncate -s 0 wiki/pessoal/concepts/a.md" },
      }))).toBe(2);

      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: { command: "dd if=/dev/zero of=wiki/pessoal/concepts/a.md" },
      }))).toBe(2);

      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: { command: "git" },
      }))).toBe(0);

      // apply_patch Add File com verified
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "apply_patch",
        tool_input: {
          patch: "*** Begin Patch\n*** Add File: wiki/pessoal/concepts/novo-patch.md\n+---\n+verified:\n+  - by: human:fraude\n+---\n+Texto.\n*** End Patch\n",
        },
      }))).toBe(2);

      // apply_patch Delete File
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "apply_patch",
        tool_input: {
          patch: "*** Begin Patch\n*** Delete File: wiki/pessoal/concepts/a.md\n*** End Patch\n",
        },
      }))).toBe(0);
    });

    test("Dado vetores T1 (cd wiki && ...) Quando executados Então são bloqueados com saída 2", async () => {
      // T1.1: cd wiki && echo ... >> pessoal/concepts/a.md
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: {
          command: `cd wiki && echo "verified:\\n  - by: human:fraude\\n    at: 2026-11-04T12:00:00Z" >> pessoal/concepts/a.md`,
        },
      }))).toBe(2);

      // T1.2: cd wiki && sed -i '2,3d' pessoal/concepts/a.md
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: {
          command: "cd wiki && sed -i '2,3d' pessoal/concepts/a.md",
        },
      }))).toBe(2);

      // T1.3: cd wiki && cp /tmp/prep.md pessoal/concepts/a.md
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: {
          command: "cd wiki && cp /tmp/prep.md pessoal/concepts/a.md",
        },
      }))).toBe(2);
    });

    test("Dado vetores T2 (CLI falsa ou subshell) Quando executados Então são bloqueados com saída 2", async () => {
      // T2.1: bun /tmp/src/cli.ts validar wiki/pessoal/concepts/a.md # verified
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: {
          command: "bun /tmp/src/cli.ts validar wiki/pessoal/concepts/a.md # verified",
        },
      }))).toBe(2);

      // T2.2: bun /tmp/cli.ts aprovar wiki/pessoal/concepts/a.md # aprovarPelaInterface
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: {
          command: "bun /tmp/cli.ts aprovar wiki/pessoal/concepts/a.md # aprovarPelaInterface",
        },
      }))).toBe(2);

      // T2.3: bun src/cli.ts $(sed -i '2,3d' wiki/pessoal/concepts/a.md)
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: {
          command: "bun src/cli.ts $(sed -i '2,3d' wiki/pessoal/concepts/a.md)",
        },
      }))).toBe(2);

      // T2.4: (sed -i '2,3d' wiki/pessoal/concepts/a.md) e (cp /tmp/prep.md wiki/pessoal/concepts/a.md)
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: {
          command: "(sed -i '2,3d' wiki/pessoal/concepts/a.md)",
        },
      }))).toBe(2);

      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: {
          command: "(cp /tmp/prep.md wiki/pessoal/concepts/a.md)",
        },
      }))).toBe(2);
    });

    test("Dado vetores T3 (flags curtas agrupadas, eval em node/bun, git apply --include) Quando executados Então são bloqueados", async () => {
      // T3.1: sed -Ei e perl -pie
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: {
          command: "sed -Ei '2,3d' wiki/pessoal/concepts/a.md",
        },
      }))).toBe(2);

      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: {
          command: "perl -pie 's/---//' wiki/pessoal/concepts/a.md",
        },
      }))).toBe(2);

      // T3.2: node --eval e bun --eval
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: {
          command: "node --eval 'require(\"fs\").writeFileSync(\"wiki/pessoal/concepts/a.md\", \"x\")'",
        },
      }))).toBe(2);

      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: {
          command: "bun --eval 'await Bun.write(\"wiki/pessoal/concepts/a.md\", \"x\")'",
        },
      }))).toBe(2);

      // T3.3: git apply --include=wiki/...
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: {
          command: "git apply --include=wiki/pessoal/concepts/a.md /tmp/p.diff",
        },
      }))).toBe(2);
    });

    test("Dado vetores T4 (cwd em subpasta de vault e chave content ausente/não-string) Quando executados Então são bloqueados", async () => {
      delete process.env.ANVILORE_DESTINO;
      delete process.env.ANVILORE_WIKI;

      // T4.1: dados.cwd = <raiz>/wiki + Write em pessoal/concepts/a.md com verified
      const pagina = join(wikiDir, "pessoal/concepts/a.md");
      writeFileSync(pagina, "---\ntitle: Nota\ngenerated:\n  by: process:agente\n  at: 2026-11-04T10:00:00Z\n---\n");

      expect(await executarProtecao(JSON.stringify({
        cwd: wikiDir,
        tool_name: "Write",
        tool_input: {
          file_path: "pessoal/concepts/a.md",
          content: "---\ntitle: Nota\ngenerated:\n  by: process:agente\n  at: 2026-11-04T10:00:00Z\nverified:\n  - by: human:fraude\n    at: 2026-11-04T12:00:00Z\n---\n",
        },
      }))).toBe(2);

      // T4.2: Write sem content ou com tipo inválido
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Write",
        tool_input: {
          file_path: "wiki/pessoal/concepts/a.md",
        },
      }))).toBe(2);

      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Write",
        tool_input: {
          file_path: "wiki/pessoal/concepts/a.md",
          content: 123,
        },
      }))).toBe(2);

      // tool_name vazio citando wiki/ não infere ferramenta e falha fechado
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "",
        tool_input: {
          file_path: "wiki/pessoal/concepts/a.md",
          content: "qualquer texto",
        },
      }))).toBe(2);
    });

    test("Dado operações legítimas e falsos positivos da Regra B5 Quando executados Então continuam liberados com saída 0", async () => {
      // 1. rg verified wiki/
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: { command: "rg verified wiki/" },
      }))).toBe(0);

      // 2. rg verified wiki/ > /tmp/out
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: { command: "rg verified wiki/ > /tmp/out" },
      }))).toBe(0);

      // 3. cat / ls / grep / head em wiki/
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: { command: "cat wiki/pessoal/concepts/a.md" },
      }))).toBe(0);

      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: { command: "ls wiki/" },
      }))).toBe(0);

      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: { command: "grep verified wiki/pessoal/concepts/a.md" },
      }))).toBe(0);

      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: { command: "head wiki/pessoal/concepts/a.md" },
      }))).toBe(0);

      // 4. git add / commit / status / diff / log
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: { command: "git add wiki/pessoal/concepts/a.md" },
      }))).toBe(0);

      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: { command: "git commit -m 'docs(wiki): atualizar nota sobre verified'" },
      }))).toBe(0);

      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: { command: "git status" },
      }))).toBe(0);

      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: { command: "git diff wiki/" },
      }))).toBe(0);

      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: { command: "git log -- wiki/" },
      }))).toBe(0);

      // 5. bun src/cli.ts fechar|validar|indexar|capturar
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: { command: "bun src/cli.ts fechar wiki" },
      }))).toBe(0);

      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: { command: "bun src/cli.ts validar wiki" },
      }))).toBe(0);

      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: { command: "bun src/cli.ts indexar wiki" },
      }))).toBe(0);

      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: { command: "bun src/cli.ts capturar https://example.com/doc --contexto-de /tmp/ctx.md" },
      }))).toBe(0);

      // 6. cd /tmp && ls
      expect(await executarProtecao(JSON.stringify({
        cwd: temporario,
        tool_name: "Bash",
        tool_input: { command: "cd /tmp && ls" },
      }))).toBe(0);
    });

    test("Dado encontrarRaizVault com e sem SCHEMA.md/wiki e com fallback Então resolve corretamente", () => {
      // 1. Encontra SCHEMA.md + wiki
      expect(encontrarRaizVault(wikiDir)).toBe(temporario);

      // 2. Não encontra SCHEMA.md e usa ANVILORE_DESTINO
      const pastaVazia = mkdtempSync(join(tmpdir(), "vazia-"));
      try {
        expect(encontrarRaizVault(pastaVazia, { ANVILORE_DESTINO: temporario })).toBe(temporario);
        // 3. Fallback instalado
        expect(encontrarRaizVault(pastaVazia, {})).toBe(resolve(import.meta.dir, ".."));
        expect(encontrarRaizVault(undefined, {})).toBe(resolve(import.meta.dir, ".."));
      } finally {
        rmSync(pastaVazia, { recursive: true, force: true });
      }
    });

    // --- Rodada 5 / QA4 (Delta bd1be06): P1-E1 e P1-E2 ---
    test("Dado P1-E1: cwd fora do vault com caminho absoluto ou symlink para a wiki (sem envs) Quando Write, Edit, MultiEdit ou apply_patch tenta alterar verified Então nega com código 2 e bytes permanecem intactos", async () => {
      const outroVault = mkdtempSync(join(tmpdir(), "anvilore-outro-vault-"));
      const linkExterno = join(tmpdir(), `link-ext-wiki-${Math.random().toString(36).slice(2)}`);
      try {
        writeFileSync(join(outroVault, "SCHEMA.md"), "# Schema\n");
        const wikiAlvo = join(outroVault, "wiki/pessoal/concepts");
        mkdirSync(wikiAlvo, { recursive: true });
        const paginaAlvo = join(wikiAlvo, "a.md");
        const conteudoOriginal = "---\ntitle: Nota Original\ngenerated:\n  by: test\n---\nCorpo intocado.\n";
        writeFileSync(paginaAlvo, conteudoOriginal);

        symlinkSync(join(outroVault, "wiki"), linkExterno);

        // Garante que ANVILORE_WIKI e ANVILORE_DESTINO não apontam para outroVault
        delete process.env.ANVILORE_WIKI;
        delete process.env.ANVILORE_DESTINO;

        // 1. Write com cwd = /tmp e caminho absoluto
        const payloadWrite = {
          cwd: "/tmp",
          tool_name: "Write",
          tool_input: {
            file_path: paginaAlvo,
            content: "---\ntitle: Nota Fraudada\nverified:\n  - by: human:fraude\n    at: 2026-11-05T12:00:00Z\n---\nCorpo.\n",
          },
        };
        expect(await executarProtecao(JSON.stringify(payloadWrite))).toBe(2);

        // Processo CLI real com Write
        const procWrite = Bun.spawnSync([process.execPath, "src/cli.ts", "hook", "proteger-raw"], {
          stdin: Buffer.from(JSON.stringify(payloadWrite)),
          env: { PATH: process.env.PATH },
        });
        expect(procWrite.exitCode).toBe(2);

        // 2. Write via symlink externo
        const payloadSymlink = {
          cwd: "/tmp",
          tool_name: "Write",
          tool_input: {
            file_path: join(linkExterno, "pessoal/concepts/a.md"),
            content: "---\ntitle: Fraude Link\nverified:\n  - by: human:fraude\n    at: 2026-11-05T12:00:00Z\n---\n",
          },
        };
        expect(await executarProtecao(JSON.stringify(payloadSymlink))).toBe(2);

        const procSymlink = Bun.spawnSync([process.execPath, "src/cli.ts", "hook", "proteger-raw"], {
          stdin: Buffer.from(JSON.stringify(payloadSymlink)),
          env: { PATH: process.env.PATH },
        });
        expect(procSymlink.exitCode).toBe(2);

        // 3. Edit com cwd = /tmp e caminho absoluto
        const payloadEdit = {
          cwd: "/tmp",
          tool_name: "Edit",
          tool_input: {
            file_path: paginaAlvo,
            old_string: "---\ntitle: Nota Original\ngenerated:\n  by: test\n---\n",
            new_string: "---\ntitle: Nota Original\ngenerated:\n  by: test\nverified:\n  - by: human:fraude\n    at: 2026-11-05T12:00:00Z\n---\n",
          },
        };
        expect(await executarProtecao(JSON.stringify(payloadEdit))).toBe(2);

        const procEdit = Bun.spawnSync([process.execPath, "src/cli.ts", "hook", "proteger-raw"], {
          stdin: Buffer.from(JSON.stringify(payloadEdit)),
          env: { PATH: process.env.PATH },
        });
        expect(procEdit.exitCode).toBe(2);

        // 4. MultiEdit com cwd = /tmp e caminho absoluto
        const payloadMulti = {
          cwd: "/tmp",
          tool_name: "MultiEdit",
          tool_input: {
            file_path: paginaAlvo,
            edits: [{
              old_string: "---\ntitle: Nota Original\ngenerated:\n  by: test\n---\n",
              new_string: "---\ntitle: Nota Original\ngenerated:\n  by: test\nverified:\n  - by: human:fraude\n    at: 2026-11-05T12:00:00Z\n---\n",
            }],
          },
        };
        expect(await executarProtecao(JSON.stringify(payloadMulti))).toBe(2);

        const procMulti = Bun.spawnSync([process.execPath, "src/cli.ts", "hook", "proteger-raw"], {
          stdin: Buffer.from(JSON.stringify(payloadMulti)),
          env: { PATH: process.env.PATH },
        });
        expect(procMulti.exitCode).toBe(2);

        // 5. apply_patch com cwd = /tmp e Update File com caminho absoluto
        const patchTexto = `*** Update File: ${paginaAlvo}
--- a
+++ b
@@ -1,4 +1,7 @@
 ---
 title: Nota Original
 generated:
   by: test
+verified:
+  - by: human:fraude
+    at: 2026-11-05T12:00:00Z
 ---
`;
        const payloadPatch = {
          cwd: "/tmp",
          tool_name: "apply_patch",
          tool_input: { patch: patchTexto },
        };
        expect(await executarProtecao(JSON.stringify(payloadPatch))).toBe(2);

        const procPatch = Bun.spawnSync([process.execPath, "src/cli.ts", "hook", "proteger-raw"], {
          stdin: Buffer.from(JSON.stringify(payloadPatch)),
          env: { PATH: process.env.PATH },
        });
        expect(procPatch.exitCode).toBe(2);

        // Conferência dos bytes no disco: arquivo não pode ter verified gravado
        expect(readFileSync(paginaAlvo, "utf8")).toBe(conteudoOriginal);
      } finally {
        try { rmSync(linkExterno, { force: true }); } catch {}
        try { rmSync(outroVault, { recursive: true, force: true }); } catch {}
      }
    }, 30_000);

    test("Dado P1-E2: ferramentas estruturadas com variações de caixa (WIKI/, Wiki/, wIkI/) Quando tentam alterar verified Então negam com código 2 e bytes permanecem intactos", async () => {
      const pagina = join(wikiDir, "pessoal/concepts/a.md");
      const conteudoOriginal = "---\ntitle: Nota Original\ngenerated:\n  by: test\n---\nCorpo intocado.\n";
      writeFileSync(pagina, conteudoOriginal);

      for (const caminhoVariante of [
        "WIKI/pessoal/concepts/a.md",
        "Wiki/pessoal/concepts/a.md",
        "wIkI/pessoal/concepts/a.md",
      ]) {
        // Write com casing alternativo
        const payloadWrite = {
          cwd: temporario,
          tool_name: "Write",
          tool_input: {
            file_path: caminhoVariante,
            content: "---\ntitle: Fraude Casing\nverified:\n  - by: human:fraude\n    at: 2026-11-05T12:00:00Z\n---\n",
          },
        };
        expect(await executarProtecao(JSON.stringify(payloadWrite))).toBe(2);

        // Processo CLI real
        const procWrite = Bun.spawnSync([process.execPath, "src/cli.ts", "hook", "proteger-raw"], {
          stdin: Buffer.from(JSON.stringify(payloadWrite)),
          env: { PATH: process.env.PATH },
        });
        expect(procWrite.exitCode).toBe(2);

        // Edit com casing alternativo
        const payloadEdit = {
          cwd: temporario,
          tool_name: "Edit",
          tool_input: {
            file_path: caminhoVariante,
            old_string: "---\ntitle: Nota Original\ngenerated:\n  by: test\n---\n",
            new_string: "---\ntitle: Nota Original\ngenerated:\n  by: test\nverified:\n  - by: human:fraude\n    at: 2026-11-05T12:00:00Z\n---\n",
          },
        };
        expect(await executarProtecao(JSON.stringify(payloadEdit))).toBe(2);

        const procEdit = Bun.spawnSync([process.execPath, "src/cli.ts", "hook", "proteger-raw"], {
          stdin: Buffer.from(JSON.stringify(payloadEdit)),
          env: { PATH: process.env.PATH },
        });
        expect(procEdit.exitCode).toBe(2);
      }

      // Conferência de bytes no disco
      expect(readFileSync(pagina, "utf8")).toBe(conteudoOriginal);
    }, 30_000);

    test("Dado casos de falso positivo preservados da Regra B Quando executados Então continuam liberados com saída 0", async () => {
      // 1. Write em /tmp/x.md com cwd: /tmp
      const payloadTmp = {
        cwd: "/tmp",
        tool_name: "Write",
        tool_input: {
          file_path: "/tmp/x.md",
          content: "qualquer conteudo fora de vault",
        },
      };
      expect(await executarProtecao(JSON.stringify(payloadTmp))).toBe(0);

      // 2. Write num projeto sem SCHEMA.md
      const projetoSemSchema = mkdtempSync(join(tmpdir(), "sem-schema-"));
      try {
        mkdirSync(join(projetoSemSchema, "wiki"), { recursive: true });
        const payloadSemSchema = {
          cwd: projetoSemSchema,
          tool_name: "Write",
          tool_input: {
            file_path: "wiki/nota.md",
            content: "---\ntitle: Nota em projeto sem SCHEMA\n---\n",
          },
        };
        expect(await executarProtecao(JSON.stringify(payloadSemSchema))).toBe(0);
      } finally {
        rmSync(projetoSemSchema, { recursive: true, force: true });
      }

      // 3. Edições normais de página da wiki pelo cwd do vault (sem alterar verified)
      const paginaNormal = join(wikiDir, "pessoal/concepts/a.md");
      const conteudoComVerified = "---\ntitle: Nota Normal\ngenerated:\n  by: test\nverified:\n  - by: human:iago\n    at: 2026-11-01T10:00:00Z\n---\nTexto antes.\n";
      writeFileSync(paginaNormal, conteudoComVerified);

      const payloadEdicaoNormal = {
        cwd: temporario,
        tool_name: "Edit",
        tool_input: {
          file_path: "wiki/pessoal/concepts/a.md",
          old_string: "Texto antes.",
          new_string: "Texto depois.",
        },
      };
      expect(await executarProtecao(JSON.stringify(payloadEdicaoNormal))).toBe(0);
    }, 30_000);

    test("Achado A: bloqueia redirecionamento para wiki debaixo de /tmp e via /tmp/../<abs>/wiki/a.md (exit 2), mantendo gravação fora de wiki em /tmp e leitura com saída 0", async () => {
      const cofreTmp = mkdtempSync(join(tmpdir(), "vault-sob-tmp-"));
      try {
        mkdirSync(join(cofreTmp, "wiki"), { recursive: true });
        writeFileSync(join(cofreTmp, "SCHEMA.md"), "# Schema\n");
        const pagina = join(cofreTmp, "wiki/a.md");
        writeFileSync(pagina, "---\ntitle: A\n---\n");

        // 1. Redirecionamento direto em wiki debaixo de /tmp
        const cmdTmpWiki = `printf "verified: - by: human:fraude\\n" > "${pagina}"`;
        const resTmpWiki = await executarProtecao(JSON.stringify({
          cwd: cofreTmp,
          tool_name: "Bash",
          tool_input: { command: cmdTmpWiki },
        }));
        expect(resTmpWiki).toBe(2);

        // 2. Redirecionamento com traversal via /tmp/../<abs>/wiki/a.md
        const caminhoTraversal = "/tmp/.." + pagina;
        const cmdTraversal = `printf "verified: - by: human:fraude\\n" > "${caminhoTraversal}"`;
        const resTraversal = await executarProtecao(JSON.stringify({
          cwd: cofreTmp,
          tool_name: "Bash",
          tool_input: { command: cmdTraversal },
        }));
        expect(resTraversal).toBe(2);

        // Regressão 1: gravação comum em /tmp fora da wiki continua exit 0
        const arqFora = join(tmpdir(), "fora-da-wiki.txt");
        const cmdFora = `printf "verified: - by: human:fraude\\n" > "${arqFora}"`;
        const resFora = await executarProtecao(JSON.stringify({
          cwd: cofreTmp,
          tool_name: "Bash",
          tool_input: { command: cmdFora },
        }));
        expect(resFora).toBe(0);

        // Regressão 2: leitura da wiki continua exit 0
        const cmdLeitura = `cat "${pagina}"`;
        const resLeitura = await executarProtecao(JSON.stringify({
          cwd: cofreTmp,
          tool_name: "Bash",
          tool_input: { command: cmdLeitura },
        }));
        expect(resLeitura).toBe(0);
      } finally {
        rmSync(cofreTmp, { recursive: true, force: true });
      }
    }, 30_000);

    test("Achado B: bloqueia redirecionamento para wiki configurada sem 'wiki' no caminho com cwd fora (exit 2), mantendo leitura com saída 0", async () => {
      const pastaNotes = mkdtempSync(join(tmpdir(), "notes-custom-"));
      const pastaFora = mkdtempSync(join(tmpdir(), "fora-"));
      const originalEnv = process.env.ANVILORE_WIKI;
      try {
        writeFileSync(join(pastaNotes, "a.md"), "---\ntitle: A\n---\n");
        process.env.ANVILORE_WIKI = pastaNotes;

        // 1. Comando escreve em /notes/a.md com cwd fora e caminho sem 'wiki'
        const cmdNotes = `printf "verified: - by: human:fraude\\n" > "${join(pastaNotes, "a.md")}"`;
        const resNotes = await executarProtecao(JSON.stringify({
          cwd: pastaFora,
          tool_name: "Bash",
          tool_input: { command: cmdNotes },
        }));
        expect(resNotes).toBe(2);

        // Regressão 1: gravação fora da wiki configurada continua exit 0
        const arqFora = join(pastaFora, "teste.txt");
        const cmdFora = `printf "verified: - by: human:fraude\\n" > "${arqFora}"`;
        const resFora = await executarProtecao(JSON.stringify({
          cwd: pastaFora,
          tool_name: "Bash",
          tool_input: { command: cmdFora },
        }));
        expect(resFora).toBe(0);

        // Regressão 2: leitura da wiki configurada sem 'wiki' no caminho continua exit 0
        const cmdLeitura = `cat "${join(pastaNotes, "a.md")}"`;
        const resLeitura = await executarProtecao(JSON.stringify({
          cwd: pastaFora,
          tool_name: "Bash",
          tool_input: { command: cmdLeitura },
        }));
        expect(resLeitura).toBe(0);
      } finally {
        if (originalEnv === undefined) {
          delete process.env.ANVILORE_WIKI;
        } else {
          process.env.ANVILORE_WIKI = originalEnv;
        }
        rmSync(pastaNotes, { recursive: true, force: true });
        rmSync(pastaFora, { recursive: true, force: true });
      }
    }, 30_000);

    test("Achado P2 do bot (rodada 2): destinos classificados separadamente por comando simples no guarda do terminal", async () => {
      // 1. Falham em b5bc8d9 (exit 0) e passam depois (exit 2)
      const ataques = [
        "cp /tmp/page.md wiki/a.md && echo done >/tmp/done",
        "cp /tmp/p.md wiki/a.md; true",
        "cp /tmp/p.md wiki/a.md || true",
        "cp /tmp/p.md wiki/a.md | cat",
        "mv /tmp/page.md wiki/a.md && echo done >/tmp/done",
        "mv /tmp/p.md wiki/a.md; true",
        "mv /tmp/p.md wiki/a.md || true",
        "mv /tmp/p.md wiki/a.md | cat",
      ];

      for (const cmd of ataques) {
        const codigo = await executarProtecao(JSON.stringify({
          cwd: temporario,
          tool_name: "Bash",
          tool_input: { command: cmd },
        }));
        expect(codigo).toBe(2);
      }

      // 2. Regressões exit 0
      const regressoes = [
        "cp wiki/a.md /tmp/x.md && echo ok",
        "echo ok && cat wiki/a.md",
        `cp ${join(tmpdir(), "a.md")} ${join(tmpdir(), "b.md")}`,
      ];

      for (const cmd of regressoes) {
        const codigo = await executarProtecao(JSON.stringify({
          cwd: temporario,
          tool_name: "Bash",
          tool_input: { command: cmd },
        }));
        expect(codigo).toBe(0);
      }
    });

    test("Achado P2 do bot (rodada 3): reconhecimento por prefixo de opções longas GNU de destino no terminal", async () => {
      const wikiAbs = join(temporario, "wiki");

      // 1. Falham na base 4b08759 (exit 0) e passam a dar exit 2
      const ataques = [
        `cp --target-dir=${wikiAbs} /tmp/a.md /tmp/b.md`,
        `cp --target-d ${wikiAbs} /tmp/a.md /tmp/b.md`,
        `cp --target-dir=wiki /tmp/a.md /tmp/b.md`,
        `cp --target-d wiki /tmp/a.md /tmp/b.md`,
        `mv --targ=${wikiAbs} /tmp/a.md /tmp/b.md`,
        `mv --targ=wiki /tmp/a.md /tmp/b.md`,
        `install --target-direc=${wikiAbs} /tmp/a.md /tmp/b.md`,
        `install --target-direc=wiki /tmp/a.md /tmp/b.md`,
        `ln --target-d=${wikiAbs} /tmp/a.md`,
        `ln --target-d=wiki /tmp/a.md`,
        `git show --outp=${wikiAbs}/a.md HEAD`,
        `git show --outp=wiki/a.md HEAD`,
        `git show --outp=wiki/a.md HEAD verified`,
        `time --out=${wikiAbs}/log.txt echo ok`,
        `time --out=wiki/log.txt echo ok`,
        `time --out wiki/log.txt echo ok`,
        `stdbuf --out=${wikiAbs}/log.txt echo ok`,
        `stdbuf --out=wiki/log.txt echo ok`,
        `sed --in-pla 's/a/b/' ${wikiAbs}/a.md`,
        `sed --in-pla 's/a/b/' wiki/a.md`,
        `sed --in 's/a/b/' wiki/a.md`,
      ];

      for (const cmd of ataques) {
        const codigo = await executarProtecao(JSON.stringify({
          cwd: temporario,
          tool_name: "Bash",
          tool_input: { command: cmd },
        }));
        expect(codigo).toBe(2);
      }

      // 2. Regressões com exit 0
      const regressoes = [
        `cp --target-dir=/tmp/x /tmp/a.md /tmp/b.md`,
        `cp /tmp/a.md /tmp/b.md`,
        `cat ${wikiAbs}/a.md`,
        `cat wiki/a.md`,
        `git show --output=/tmp/out.txt HEAD`,
        `time --out=/tmp/out.txt echo ok`,
        `sed --in-place 's/a/b/' /tmp/out.txt`,
      ];

      for (const cmd of regressoes) {
        const codigo = await executarProtecao(JSON.stringify({
          cwd: temporario,
          tool_name: "Bash",
          tool_input: { command: cmd },
        }));
        expect(codigo).toBe(0);
      }
    });
  });
});
