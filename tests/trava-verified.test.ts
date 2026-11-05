import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { executarProtecao } from "../src/comandos/hook-proteger-raw";
import { comandoHooksWiki } from "../src/comandos/hooks-wiki";
import { blocoVerified, mudouBloco } from "../src/lib/trava-verified";
import { capturarConsole } from "./apoio/console";

describe("trava de verified nos quatro agentes", () => {
  let temporario: string;
  let wikiDir: string;
  let consoleCapturado: ReturnType<typeof capturarConsole>;
  const ambiente = { ...process.env };

  beforeEach(() => {
    temporario = mkdtempSync(join(tmpdir(), "anvilore-trava-"));
    wikiDir = join(temporario, "wiki");
    mkdirSync(join(wikiDir, "pessoal/concepts"), { recursive: true });
    process.env.ANVILORE_WIKI = wikiDir;
    consoleCapturado = capturarConsole();
    delete process.env.ANVILORE_LOG_HOOK;
  });

  afterEach(() => {
    consoleCapturado.restaurar();
    for (const chave of Object.keys(process.env)) if (!(chave in ambiente)) delete process.env[chave];
    Object.assign(process.env, ambiente);
    rmSync(temporario, { recursive: true, force: true });
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

    // C3: partindo a palavra
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: `K=veri; V=fied; printf '%s%s:\n  - by: hu%s\n' $K $V man:ana >> wiki/pessoal/concepts/a.md` },
    }))).toBe(0);

    // C5: concatenação de aspas
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: `eval 'echo "veri""fied:" >> wiki/pessoal/concepts/a.md'` },
    }))).toBe(0);

    // C6: base64
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: `echo dmVyaWZpZWQ6CiAgLSBieTogaHVtYW46YW5hCg== | base64 -d >> wiki/pessoal/concepts/a.md` },
    }))).toBe(0);

    // C8: heredoc ofuscado
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: `python3 - << 'EOF'\nopen("wiki/pessoal/concepts/a.md","a").write("veri"+"fied:...")\nEOF` },
    }))).toBe(0);

    // C16: arquivo preparado em /tmp e cp
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
    }))).toBe(0);

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
});
