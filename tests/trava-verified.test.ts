import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { executarProtecao } from "../src/comandos/hook-proteger-raw";
import { comandoHooksWiki } from "../src/comandos/hooks-wiki";
import { blocoVerified, decidirVerified, encontrarRaizVault, mudouBloco } from "../src/lib/trava-verified";
import { capturarConsole } from "./apoio/console";

// Julga cada comando pelo hook real e, quando o código difere, devolve na mensagem o comando, o código obtido e o motivo da
// trava (o log do CI só mostra o mapa comando → código, que não diz por que o Windows decidiu diferente).
async function esperarCodigos(comandos: string[], codigo: number, cwd: string): Promise<void> {
  const divergencias: string[] = [];
  for (const command of comandos) {
    const payload = JSON.stringify({ cwd, tool_name: "Bash", tool_input: { command } });
    const obtido = await executarProtecao(payload);
    if (obtido === codigo) continue;
    let motivo: string;
    try {
      const decisao = await decidirVerified(payload, cwd);
      motivo = `${decisao.acao}: ${decisao.motivo}`;
    } catch (erro) {
      motivo = `exceção: ${(erro as Error).message}`;
    }
    divergencias.push(`  ${command}\n    esperado ${codigo}, obtido ${obtido}; trava de verified: ${motivo}`);
  }
  if (divergencias.length) throw new Error(`Comandos com resultado inesperado (${divergencias.length} de ${comandos.length}), cwd ${cwd}:\n${divergencias.join("\n")}`);
}

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

  test("Dado comando de escrita com diretório trocado Quando o terminal é julgado Então bloqueia se o diretório efetivo é a wiki", async () => {
    const ataques = [
      "env -C wiki sed -i s/a/b/ a.md",
      "env -Cwiki sed -i s/a/b/ a.md",
      "env --chdir=wiki sed -i s/a/b/ a.md",
      "env --ch wiki sed -i s/a/b/ a.md",
      "env -C $DIR sed -i s/a/b/ a.md",
      "env -C ~/wiki sed -i s/a/b/ a.md",
      "sudo -D wiki sed -i s/a/b/ a.md",
      "sudo --chdir=wiki sed -i s/a/b/ a.md",
      "git -C $DIR checkout -- a.md",
      "git -C wiki checkout -- a.md",
      "git -C wiki apply x.patch",
      "make -C wiki",
      "make --directory=wiki",
      "make -C $DIR",
      "tar -C wiki -xf /tmp/x.tar",
      "tar -Cwiki -xf /tmp/x.tar",
      "tar --directory=wiki -xf /tmp/x.tar",
      "tar -C $DIR -xf /tmp/x.tar",
      "find wiki -execdir sed -i s/a/b/ a.md \\;",
      "find . -okdir sed -i s/a/b/ a.md \\;",
      "cd wiki; sed -i s/a/b/ a.md",
      "(cd wiki; sed -i s/a/b/ a.md)",
      "pushd wiki; sed -i s/a/b/ a.md",
    ];
    const resultados = await Promise.all(ataques.map(command => executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command },
    }))));
    expect(Object.fromEntries(ataques.map((command, index) => [command, resultados[index]]))).toEqual(
      Object.fromEntries(ataques.map(command => [command, 2]))
    );
  });

  test("Dado troca de diretório literal para fora da wiki ou só leitura Quando o terminal é julgado Então libera", async () => {
    // `/tmp` literal não existe no Windows: o diretório de -C tem de ser uma pasta real, e tmpdir() é em qualquer sistema.
    const comandos = [
      `env -C ${tmpdir()} sed -i s/a/b/ x.md`,
      "env -C wiki cat a.md",
      "git -C wiki log",
    ];
    await esperarCodigos(comandos, 0, temporario);
  });

  test("Dado CLI segura seguida de outro comando Quando o terminal é julgado Então a isenção só cobre o primeiro comando", async () => {
    const ataques = [
      "anvilore validar\ncp /tmp/page.md wiki/a.md",
      "anvilore validar\r\ncp /tmp/page.md wiki/a.md",
      "anvilore validar && \\" + "\n" + "cp /tmp/page.md wiki/a.md",
      "anvilore validar\nprintf 'verified: fraud' > wiki/a.md",
    ];
    const resultados = await Promise.all(ataques.map(command => executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command },
    }))));
    expect(Object.fromEntries(ataques.map((command, index) => [command, resultados[index]]))).toEqual(
      Object.fromEntries(ataques.map(command => [command, 2]))
    );
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: "anvilore validar" },
    }))).toBe(0);
    expect(await executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command: "anvilore validar && echo ok" },
    }))).toBe(0);
  });

  test("Dado destino em outro vault sem wiki padrão Quando o terminal tenta escrever Então classifica o ancestral do destino", async () => {
    const outroVault = mkdtempSync(join(tmpdir(), "anvilore-outro-vault-"));
    try {
      writeFileSync(join(outroVault, "SCHEMA.md"), "# Schema\n");
      mkdirSync(join(outroVault, "wiki"), { recursive: true });
      const destino = join(outroVault, "wiki/a.md");
      delete process.env.ANVILORE_WIKI;
      delete process.env.ANVILORE_DESTINO;
      const ataques = [
        `cp /tmp/page.md ${destino}`,
        `sed -i s/a/b/ ${destino}`,
        `printf 'body' > ${destino}`,
      ];
      const resultados = await Promise.all(ataques.map(command => executarProtecao(JSON.stringify({
        cwd: "/tmp",
        tool_name: "Bash",
        tool_input: { command },
      }))));
      expect(Object.fromEntries(ataques.map((command, index) => [command, resultados[index]]))).toEqual(
        Object.fromEntries(ataques.map(command => [command, 2]))
      );
      expect(await executarProtecao(JSON.stringify({
        cwd: "/tmp",
        tool_name: "Bash",
        tool_input: { command: "cp /tmp/a.md /tmp/b.md" },
      }))).toBe(0);
    } finally {
      rmSync(outroVault, { recursive: true, force: true });
    }
  });

  test("Dado opções curtas agrupadas que escolhem destino Quando o terminal é julgado Então bloqueia cópia ou edição na wiki", async () => {
    const ataques = [
      "cp -ft wiki /tmp/page.md",
      `cp -ft ${wikiDir} /tmp/page.md`,
      "mv -ft wiki /tmp/page.md",
      `mv -ft ${wikiDir} /tmp/page.md`,
      `ln -sft ${wikiDir} /tmp/page.md`,
      `install -Dt ${wikiDir} /tmp/page.md`,
      "install -gusers -m600 -otest -Dt wiki /tmp/page.md",
      "time -ao wiki/time.txt true",
      `time -ao${join(wikiDir, "time.txt")} true`,
      `perl -E 'open my $f, ">", $ARGV[0]' ${join("wiki", "pessoal/concepts/a.md")}`,
    ];

    const resultados = await Promise.all(ataques.map(command => executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command },
    }))));
    expect(Object.fromEntries(ataques.map((command, index) => [command, resultados[index]]))).toEqual(
      Object.fromEntries(ataques.map(command => [command, 2]))
    );
  });

  test("Dado opções curtas de valor e modos seguros Quando o terminal é julgado Então não confunde valores com destinos", async () => {
    const comandos = [
      "cp -av /tmp/a.md /tmp/b.md",
      "cp -ft /tmp/x /tmp/page.md",
      "cp -r wiki/ /tmp/backup",
      "cp -S .bak /tmp/a.md /tmp/b.md",
      "cp -fS.bak /tmp/a.md /tmp/b.md",
      "cp -- -t /tmp/a.md /tmp/b.md",
      "install -m 600 -o user -g group /tmp/a.md /tmp/b.md",
      "sed -n p wiki/a.md",
      "sed -- -i wiki/a.md",
      "sed -ni 's/a/b/' /tmp/a.md",
      "sed -Ei.bak 's/a/b/' /tmp/a.md",
      "perl -pi -e 's/a/b/' /tmp/a.md",
      "perl -pi.bak -e 's/a/b/' /tmp/a.md",
      "ruby -EUTF-8 -e 'puts 1' /tmp/a.md",
      "time -ao /tmp/time.txt true",
      "rsync -t /tmp/a.md /tmp/b.md",
    ];
    const resultados = await Promise.all(comandos.map(command => executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command },
    }))));
    expect(Object.fromEntries(comandos.map((command, index) => [command, resultados[index]]))).toEqual(
      Object.fromEntries(comandos.map(command => [command, 0]))
    );
  });

  test("Dado grupo de escrita com argumento obrigatório ausente Quando o terminal é julgado Então bloqueia por falha fechada", async () => {
    const comandos = [
      "cp -ft",
      "mv -S",
      "install -g",
      "install -m",
      "sed -e",
      "sed -l",
      "perl -E",
      "ruby -e",
      "ruby -E",
      "time -ao",
      "git format-patch -o",
    ];
    const resultados = await Promise.all(comandos.map(command => executarProtecao(JSON.stringify({
      cwd: temporario,
      tool_name: "Bash",
      tool_input: { command },
    }))));
    expect(Object.fromEntries(comandos.map((command, index) => [command, resultados[index]]))).toEqual(
      Object.fromEntries(comandos.map(command => [command, 2]))
    );
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
        // `/tmp/..` + caminho absoluto só forma um caminho válido no POSIX; aqui a pasta temporária do sistema faz o papel de /tmp.
        const caminhoTraversal = `${tmpdir()}/../${basename(tmpdir())}/${basename(cofreTmp)}/wiki/a.md`;
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

    test("Achado P2 do bot (rodada 4): resolução física antes de colapsar segmentos pai (..)", async () => {
      const subDir = join(wikiDir, "sub");
      mkdirSync(subDir, { recursive: true });
      const alias = join(temporario, "alias");
      symlinkSync(subDir, alias, "dir");

      const pastaFora = mkdtempSync(join(tmpdir(), "anvilore-fora-"));
      const alias2 = join(temporario, "alias2");
      symlinkSync(pastaFora, alias2, "dir");

      try {
        // 1. Falham na base 78cf186 (exit 0) e passam a dar exit 2:
        // - alias -> wiki/sub e cp /tmp/page.md <vault>/alias/../a.md
        // - o mesmo com mv
        // - redirecionamento printf 'verified: …' > <vault>/alias/../a.md
        // - relativo a partir do cofre cp /tmp/p.md alias/../a.md
        const ataques = [
          `cp /tmp/page.md ${alias}/../a.md`,
          `mv /tmp/page.md ${alias}/../a.md`,
          `printf 'verified: human' > ${alias}/../a.md`,
          `cp /tmp/p.md alias/../a.md`,
        ];

        // No POSIX o link é seguido antes do `..` seguinte (alias/../a.md cai na wiki). No Windows o `..` é lexical, como o próprio
        // Windows faz (src/lib/caminhos.ts, caminhoReal): alias\..\a.md é <cofre>\a.md, fora da wiki, então o ataque não existe lá.
        await esperarCodigos(ataques, process.platform === "win32" ? 0 : 2, temporario);

        // 2. Regressões com exit 0:
        // - cp /tmp/a.md /tmp/b.md
        // - alias2 -> /tmp/fora e cp /tmp/p.md <vault>/alias2/../x.md quando o destino físico fica fora da wiki (e não é raw/)
        // - leitura cat wiki/a.md
        const regressoes = [
          `cp /tmp/a.md /tmp/b.md`,
          `cp /tmp/p.md ${alias2}/../x.md`,
          `cp /tmp/p.md alias2/../x.md`,
          `cat wiki/a.md`,
        ];

        await esperarCodigos(regressoes, 0, temporario);
      } finally {
        rmSync(pastaFora, { recursive: true, force: true });
      }
    });

    // Dado um cofre com wiki/ e uma pasta de preparo fora dele com wiki/a.md de aprovação forjada
    const prepararRodada8 = () => {
      const fora = mkdtempSync(join(tmpdir(), "anvilore-stage-"));
      const stage = join(fora, "stage");
      mkdirSync(join(stage, "wiki"), { recursive: true });
      writeFileSync(join(stage, "wiki/a.md"), "---\nverified:\n  by: human:x\n---\n");
      writeFileSync(join(fora, "a.md"), "# a\n");
      writeFileSync(join(fora, "c.md"), "# c\n");
      mkdirSync(join(fora, "y"));
      const cofre = temporario;

      const julgar = async (comandos: string[], cwd = cofre) => {
        const codigos = await Promise.all(comandos.map(command => executarProtecao(JSON.stringify({
          cwd,
          tool_name: "Bash",
          tool_input: { command },
        }))));
        return Object.fromEntries(comandos.map((command, indice) => [command, codigos[indice]]));
      };
      const todos = (comandos: string[], codigo: number) => Object.fromEntries(comandos.map(command => [command, codigo]));
      const esperar = (comandos: string[], codigo: number, cwd = cofre) => esperarCodigos(comandos, codigo, cwd);
      return { fora, stage, cofre, julgar, todos, esperar };
    };

    test("Achado P2 do bot (rodada 8): escrita em massa num destino que é ancestral da wiki cria descendentes nela", async () => {
      const { fora, stage, cofre, esperar } = prepararRodada8();
      try {
        // Falham na base 2372e20 (exit 0) e passam a dar exit 2
        const ataques = [
          `cp -R ${stage}/. ${cofre}/`,
          `cp -a ${stage}/. ${cofre}`,
          `cp -rT ${stage} ${cofre}`,
          `cp --recursive ${stage}/. ${cofre}/`,
          `cp --recur ${stage}/. ${cofre}/`,
          `cp --archive ${stage}/. ${cofre}/`,
          `cp -R ${stage}/. .`,
          `cp -R ${stage}/. ..`,
          `cp -rt ${cofre} ${stage}`,
          `cp --target-directory=${cofre} -r ${stage}/wiki`,
          `cp --parents wiki/a.md ${cofre}/`,
          `mv ${stage}/wiki ${cofre}/`,
          `mv -t ${cofre} ${stage}/wiki`,
          `mv ${fora}/nao-existe.md ${cofre}/`,
          `mv -T ${fora}/a.md ${cofre}`,
          `rsync -a ${stage}/ ${cofre}/`,
          `rsync -r ${stage}/ ${cofre}/`,
          `rsync -a ${stage}/ ${cofre}/ --exclude x`,
          `tar -C ${cofre} -xf ${fora}/x.tar`,
          `tar xf ${fora}/x.tar -C ${cofre}`,
          `tar --directory=${cofre} --extract -f ${fora}/x.tar`,
          `tar -xf ${fora}/x.tar`,
          `tar -xPf ${fora}/x.tar -C ${fora}/y`,
          `env -C ${cofre} tar -xf ${fora}/x.tar`,
          `unzip ${fora}/x.zip -d ${cofre}`,
          `unzip -d ${cofre} ${fora}/x.zip`,
          `unzip -o ${fora}/x.zip -d${cofre}`,
          `unzip ${fora}/x.zip`,
          `7z x ${fora}/x.7z -o${cofre}`,
          `7z x ${fora}/x.7z`,
          `git -C ${cofre} checkout .`,
          `git -C ${cofre} restore .`,
          `git -C ${cofre} pull`,
          `git -C ${cofre} worktree add ${fora}/wt`,
          `git clone ${fora}/repo ${cofre}`,
          `git clone ${fora}/repo`,
          `git --work-tree=${cofre} checkout .`,
          `git --work-tree ${cofre} checkout .`,
          `GIT_WORK_TREE=${cofre} git -C ${fora}/y checkout .`,
          `env GIT_WORK_TREE=${cofre} git -C ${fora}/y checkout .`,
          `bsdtar -xf ${fora}/x.tar -C ${cofre}`,
          `ln -s ${stage}/wiki ${cofre}/`,
          `ln -s ${stage} ${cofre}/`,
        ];
        await esperar(ataques, 2);
      } finally {
        rmSync(fora, { recursive: true, force: true });
      }
    });

    test("Achado P2 do bot (rodada 8): escrita de um arquivo só, destino fora do cofre e leitura continuam liberados", async () => {
      const { fora, stage, cofre, esperar } = prepararRodada8();
      try {
        const regressoes = [
          `cp ${fora}/a.md ${cofre}/a.md`,
          `cp ${fora}/a.md ${cofre}/`,
          `cp -t ${cofre} ${fora}/a.md`,
          `cp -R ${stage} ${fora}/y/copia`,
          `cp -R ${cofre}/wiki ${fora}/backup`,
          `mv ${fora}/c.md ${cofre}/b.md`,
          `mv ${fora}/c.md ${cofre}/`,
          `rsync -a ${cofre}/ ${fora}/y/`,
          `tar -cf ${fora}/b.tar -C ${cofre} .`,
          `tar -xf ${fora}/x.tar -C ${fora}/y`,
          `tar -tf ${fora}/x.tar`,
          `unzip -l ${fora}/x.zip`,
          `unzip ${fora}/x.zip -d ${fora}/y`,
          `7z l ${fora}/x.7z`,
          `git -C ${cofre} log`,
          `git -C ${cofre} status`,
          `git -C ${cofre} worktree list`,
          `git -C ${cofre} fetch`,
          `unzip -p ${fora}/x.zip`,
          `git clone ${fora}/repo ${fora}/y/clone`,
          `ln -s ${fora}/a.md ${cofre}/atalho.md`,
        ];
        await esperar(regressoes, 0);
      } finally {
        rmSync(fora, { recursive: true, force: true });
      }
    });

    test("Achado preventivo (rodada 9): comando executado por outro comando (sh -c, find -exec, xargs, parallel, eval) é analisado", async () => {
      const { fora, stage, cofre, esperar } = prepararRodada8();
      const aninhado = (niveis: number, interno = `cp -R ${stage}/. ${cofre}/`) => {
        let comando = interno;
        for (let i = 0; i < niveis; i++) comando = `sh -c '${comando.replaceAll("'", "'\\''")}'`;
        return comando;
      };
      try {
        // Dado o verbo de escrita aninhado, Quando o terminal é julgado, Então vale a mesma regra do comando direto
        const ataques = [
          `sh -c "cp -R ${stage}/. ${cofre}/"`,
          `bash -ec "printf x > ${cofre}/wiki/a.md"`,
          `sh -c "sh -c 'cp -R ${stage}/. ${cofre}/'"`,
          `zsh -lc "cp -a ${stage}/. ${cofre}/"`,
          `bash --norc -c "cp -R ${stage}/. ${cofre}/"`,
          `bash -o pipefail -c "cp -R ${stage}/. ${cofre}/"`,
          `bash --rcfile ${fora}/rc -c "cp -R ${stage}/. ${cofre}/"`,
          `sh -c "echo ok; cp -R ${stage}/. ${cofre}/"`,
          `env FOO=1 sh -c "cp -R ${stage}/. ${cofre}/"`,
          `sudo bash -c "mv ${stage}/wiki ${cofre}/"`,
          `busybox sh -c "rsync -a ${stage}/ ${cofre}/"`,
          `timeout 5 sh -c "tar -C ${cofre} -xf ${fora}/x.tar"`,
          `sh -c 'cp $(echo x) ${fora}/y'`,
          `sh -c`,
          aninhado(8),
          `find ${stage} -exec cp -r {} ${cofre}/ \\;`,
          `find ${stage} -exec cp {} ${cofre}/wiki/ +`,
          `find ${stage} -ok mv {} ${cofre}/ \\;`,
          `find ${stage} -exec sh -c 'cp -R "$0" ${cofre}/' {} \\;`,
          `find ${stage} -exec cp -r {} ${cofre}/`,
          `parallel cp -R {} ${cofre}/ ::: ${stage}`,
          `xargs -I{} cp -r {} ${cofre}/`,
          `xargs cp -R -t ${cofre}`,
          `xargs sh -c 'cp -R "$0" ${cofre}/'`,
          `eval 'cp -R ${stage}/. ${cofre}/'`,
        ];
        await esperar(ataques, 2);

        // Regressões com exit 0: comandos aninhados que só leem ou escrevem fora da wiki
        const regressoes = [
          `sh -c "echo ok"`,
          aninhado(3, `cp ${fora}/a.md ${fora}/b.md`),
          `bash -c "cp ${fora}/a.md ${fora}/b.md"`,
          `bash -c "cp ${fora}/a.md ${cofre}/"`,
          `sh ${fora}/script.sh`,
          `sh -c "tar -tf ${fora}/x.tar"`,
          `find ${cofre}/wiki -name '*.md'`,
          `find ${cofre}/wiki -exec cat {} \\;`,
          `find ${fora}/x -exec cp {} ${fora}/y/ \\;`,
          `find ${stage} -exec cp {} ${cofre}/ \\;`,
          `xargs cat`,
          `parallel echo {} ::: a b`,
          `eval 'echo ok'`,
        ];
        await esperar(regressoes, 0);
      } finally {
        rmSync(fora, { recursive: true, force: true });
      }
    });

    test("Achados da revisão automática da rodada 8: tar com P na forma antiga e vários -C, unzip -:, 7z -spf e caixa do comando, git -c core.worktree", async () => {
      const { fora, cofre, esperar } = prepararRodada8();
      try {
        const ataques = [
          `tar xPf ${fora}/x.tar -C ${fora}/y`,
          `tar -C ${cofre} -C ${fora}/y -xf ${fora}/x.tar`,
          `tar -C ${fora}/y -C ${cofre} -xf ${fora}/x.tar`,
          `unzip -: ${fora}/x.zip -d ${fora}/y`,
          `unzip -^ ${fora}/x.zip -d ${fora}/y`,
          `7z x ${fora}/x.7z -spf -o${fora}/y`,
          `7z X ${fora}/x.7z -o${cofre}`,
          `git -c core.worktree=${cofre} -C ${fora}/y checkout .`,
        ];
        await esperar(ataques, 2);
        const regressoes = [
          `tar -C ${fora}/y -xf ${fora}/x.tar`,
          `tar xf ${fora}/x.tar -C ${fora}/y`,
          `7z x ${fora}/x.7z -o${fora}/y`,
          `git -c user.name=x -C ${cofre} log`,
        ];
        await esperar(regressoes, 0);
      } finally {
        rmSync(fora, { recursive: true, force: true });
      }
    });

    test("Rodada 10 (a): GIT_WORK_TREE e GIT_DIR atribuídos num comando simples anterior valem para o git seguinte", async () => {
      const { fora, cofre, esperar } = prepararRodada8();
      const longe = join(fora, "y");
      try {
        // Dado o cwd fora do cofre, Quando um comando anterior fixa a árvore de trabalho no cofre, Então o git que grava bloqueia
        const ataques = [
          `export GIT_WORK_TREE=${cofre}; git checkout .`,
          `export GIT_WORK_TREE=${cofre} && git restore .`,
          `GIT_WORK_TREE=${cofre}; git checkout .`,
          `declare -x GIT_WORK_TREE=${cofre}; git pull`,
          `export FOO=1; export GIT_WORK_TREE=${cofre}; echo ok; git checkout .`,
          `export GIT_DIR=${cofre}/.git; git checkout .`,
          `git --git-dir=${cofre}/.git checkout .`,
          `git --git-dir ${cofre}/.git checkout .`,
          `export GIT_WORK_TREE=$DIR; git checkout .`,
          `sh -c "export GIT_WORK_TREE=${cofre}; git checkout ."`,
        ];
        await esperar(ataques, 2, longe);

        const regressoes = [
          `export GIT_WORK_TREE=${longe}; git checkout .`,
          `export GIT_WORK_TREE=${cofre}; git log`,
          `export FOO=1; git -C ${cofre} log`,
          `git checkout .; export GIT_WORK_TREE=${cofre}`,
          `GIT_WORK_TREE=${cofre} true; git checkout .`,
          `GIT_DIR=${longe}/.git git log`,
          `git checkout .`,
        ];
        await esperar(regressoes, 0, longe);
      } finally {
        rmSync(fora, { recursive: true, force: true });
      }
    });

    test("Rodada 10 (b): git config core.worktree para a wiki ou ancestral bloqueia, e --config-env", async () => {
      const { fora, cofre, esperar } = prepararRodada8();
      const longe = join(fora, "y");
      try {
        const ataques = [
          `git config core.worktree ${cofre}`,
          `git config --global core.worktree ${cofre}`,
          `git config --add core.worktree ${cofre}`,
          `git config --file ${fora}/cfg core.worktree ${cofre}`,
          `git config set core.worktree ${cofre}`,
          `git config Core.WorkTree ${cofre}`,
          `git config core.worktree ${cofre}/wiki`,
          `git config core.worktree $DIR`,
          `git --config-env=core.worktree=WT checkout .`,
          `git --config-env core.worktree=WT checkout .`,
          `git -c core.worktree=${cofre}/wiki checkout .`,
          `fish --command "cp -R ${cofre}/../x ${cofre}/"`,
        ];
        await esperar(ataques, 2, longe);

        const regressoes = [
          `git config core.worktree`,
          `git config --get core.worktree`,
          `git config user.name x`,
          `git config core.worktree ${longe}`,
          `git --config-env=user.name=NAME log`,
          `git -c user.name=x log`,
        ];
        await esperar(regressoes, 0, longe);
      } finally {
        rmSync(fora, { recursive: true, force: true });
      }
    });

    test("Rodada 10 (c): find -fprint, -fprint0, -fprintf e -fls escrevem no arquivo informado", async () => {
      const { fora, cofre, esperar } = prepararRodada8();
      const longe = join(fora, "y");
      try {
        const ataques = [
          `find ${fora} -fprint ${cofre}/wiki/a.md`,
          `find ${fora} -fprint0 ${cofre}/wiki/a.md`,
          `find ${fora} -fprintf ${cofre}/wiki/a.md '%p\\n'`,
          `find ${fora} -fls ${cofre}/wiki/a.md`,
          `find . -fprint wiki/a.md`,
          `find ${fora} -name x -fprint`,
          `sh -c "find ${fora} -fprint ${cofre}/wiki/a.md"`,
          `find ${fora} -fprint $OUT`,
        ];
        await esperar(ataques, 2, cofre);

        const regressoes = [
          `find ${fora} -fprint ${longe}/lista.txt`,
          `find ${fora} -fprint0 ${longe}/lista.txt`,
          `find ${fora} -fprintf ${longe}/lista.txt '%p\\n'`,
          `find ${fora} -fls ${longe}/lista.txt`,
          `find ${cofre}/wiki -name '*.md' -fprint ${longe}/saida.txt`,
          `find ${cofre}/wiki -name x -fprint /dev/null`,
          `find ${cofre}/wiki -name '*.md'`,
        ];
        await esperar(regressoes, 0, cofre);
      } finally {
        rmSync(fora, { recursive: true, force: true });
      }
    });

    test("Rodada 10 (extras da revisão automática da rodada 9): verbo aninhado não literal, parallel sem comando, shells por padrão, fish e GIT_CONFIG_*", async () => {
      const { fora, stage, cofre, esperar } = prepararRodada8();
      const longe = join(fora, "y");
      try {
        const ataques = [
          `bash -c '$1 -R "$2" ${cofre}/' _ cp ${stage}`,
          `find ${stage} -exec {} \\;`,
          `parallel ::: 'cp -R ${stage}/. ${cofre}/'`,
          `mksh -c "cp -R ${stage}/. ${cofre}/"`,
          `rbash -c "cp -R ${stage}/. ${cofre}/"`,
          `fish -C "cp -R ${stage}/. ${cofre}/" -c true`,
          `fish --command="cp -R ${stage}/. ${cofre}/"`,
          `fish --command "cp -R ${stage}/. ${cofre}/"`,
          `GIT_CONFIG_KEY_0=core.worktree GIT_CONFIG_VALUE_0=${cofre} git checkout .`,
          `export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.worktree GIT_CONFIG_VALUE_0=${cofre}; git checkout .`,
          `GIT_CONFIG_PARAMETERS="'core.worktree'='${cofre}'" git checkout .`,
        ];
        await esperar(ataques, 2, longe);

        const regressoes = [
          `bash -c 'cp "$1" ${longe}/' _ ${fora}/a.md`,
          `sh -c 'echo $1' _ x`,
          `fish --command="echo ok"`,
          `parallel echo {} ::: a b`,
          `GIT_CONFIG_KEY_0=user.name git log`,
          `GIT_CONFIG_KEY_0=core.worktree git log`,
        ];
        await esperar(regressoes, 0, longe);
      } finally {
        rmSync(fora, { recursive: true, force: true });
      }
    });

    test("Rodada 10 (revisão automática 3): fish com várias opções de comando, -C só no fish e git config com opção abreviada", async () => {
      const { fora, stage, cofre, esperar } = prepararRodada8();
      const longe = join(fora, "y");
      const atacar = `cp -R ${stage}/. ${cofre}/`;
      try {
        const ataques = [
          `fish --command true --init-command "${atacar}"`,
          `fish --command "true" -C "${atacar}"`,
          `fish --init-command "${atacar}"`,
          `fish -C "${atacar}"`,
          `fish "-C${atacar}" -c true`,
          `fish -c true -C "${atacar}"`,
          `fish --comm "${atacar}"`,
          `fish --init-c "${atacar}"`,
          `bash -C -c "${atacar}"`,
          `git config --fi ${fora}/cfg core.worktree ${cofre}`,
          `git config --typ bool core.worktree ${cofre}`,
          `git config --def x core.worktree ${cofre}`,
        ];
        await esperar(ataques, 2, longe);

        const regressoes = [
          `fish -c "echo ok"`,
          `fish --command "echo ok" --init-command "echo ok"`,
          `bash -C -c "echo ok"`,
          `git config --file ${fora}/cfg core.worktree ${longe}`,
          `git config --fi ${fora}/cfg user.name x`,
        ];
        await esperar(regressoes, 0, longe);
      } finally {
        rmSync(fora, { recursive: true, force: true });
      }
    });

    const prepararRodada11 = () => {
      const { fora, stage, cofre, julgar, todos, esperar } = prepararRodada8();
      const wikiA = `${cofre}/wiki/a.md`;
      writeFileSync(join(fora, "script.sed"), `1d\nw ${wikiA}\n`);
      writeFileSync(join(fora, "limpo.sed"), "s/a/b/\n");
      writeFileSync(join(fora, "script.awk"), `{ print > "${wikiA}" }\n`);
      writeFileSync(join(fora, "p.md"), "# p\n");
      return { fora, stage, cofre, julgar, todos, esperar, wikiA };
    };

    test("Achado P2 do bot (rodada 11): sed, awk e ed/ex/vim cujo script grava ou executa", async () => {
      const { fora, stage, cofre, esperar, wikiA } = prepararRodada11();
      try {
        // Dado o cwd no cofre e caminho absoluto, Quando o script da ferramenta de texto grava ou executa, Então bloqueia
        const ataques = [
          `sed -n 'w ${wikiA}' ${fora}/p.md`,
          `sed -n 'w wiki/a.md' ${fora}/p.md`,
          `sed 's/x/y/w ${wikiA}' ${fora}/p.md`,
          `sed 's/x/y/gw ${wikiA}' ${fora}/p.md`,
          `sed -e '1W ${wikiA}' ${fora}/p.md`,
          `sed --expression='w ${wikiA}' ${fora}/p.md`,
          `sed -n -e p -e 'w ${wikiA}' ${fora}/p.md`,
          `sed -e '/x/{w ${wikiA}' -e '}' ${fora}/p.md`,
          `sed -f ${fora}/script.sed ${fora}/p.md`,
          `sed --file=${fora}/script.sed ${fora}/p.md`,
          `sed -f ${fora}/nao-existe.sed ${fora}/p.md`,
          `sed '1e cp -R ${stage}/. .' ${fora}/p.md`,
          `sed 's/x/y/e' ${fora}/p.md`,
          `sed e ${fora}/p.md`,
          `gsed -n 'w ${wikiA}' ${fora}/p.md`,
          `busybox sed -n 'w ${wikiA}' ${fora}/p.md`,
          `awk '{print > "${wikiA}"}' ${fora}/p.md`,
          `awk '{print >> "${wikiA}"}' ${fora}/p.md`,
          `awk '{printf "%s", $0 > "wiki/a.md"}' ${fora}/p.md`,
          `awk '{print > $1}' ${fora}/p.md`,
          `awk '{print | "cat > ${wikiA}"}' ${fora}/p.md`,
          `awk '{print | cmd}' ${fora}/p.md`,
          `awk 'BEGIN{system("cp -R ${stage}/. .")}'`,
          `awk 'BEGIN{system(cmd)}'`,
          `awk 'BEGIN{"cp -R ${stage}/. ." | getline x}'`,
          `awk -f ${fora}/script.awk ${fora}/p.md`,
          `awk -f ${fora}/nao-existe.awk ${fora}/p.md`,
          `gawk -i inplace '{print}' ${wikiA}`,
          `gawk --include=inplace '{print}' wiki/a.md`,
          `mawk '{print > "${wikiA}"}' ${fora}/p.md`,
          `vim -es -c 'w! ${wikiA}' -c q ${fora}/p.md`,
          `vim -es -c 'saveas ${wikiA}' -c q ${fora}/p.md`,
          `vim -es -c '!cp -R ${stage}/. .' -c q ${fora}/p.md`,
          `vim -es +'w ${wikiA}' +q ${fora}/p.md`,
          `vim -es -c 'g/x/w ${wikiA}' -c q ${fora}/p.md`,
          `vim -es -c 'normal :w wiki/a.md' -c q ${fora}/p.md`,
          `vim -es -c q ${wikiA}`,
          `nvim --headless -c 'w ${wikiA}' -c q ${fora}/p.md`,
          `ex -sc 'w ${wikiA}|q' ${fora}/p.md`,
          `ex -s -c 'wq' ${wikiA}`,
          `ed -s ${wikiA}`,
          `vi -c 'r !cp -R ${stage}/. .' -c q ${fora}/p.md`,
          `printf 'w ${wikiA}\\nq\\n' | ex -s ${fora}/p.md`,
          `ex -s ${fora}/p.md < ${fora}/script.sed`,
        ];
        await esperar(ataques, 2, cofre);
      } finally {
        rmSync(fora, { recursive: true, force: true });
      }
    });

    test("Achado P2 do bot (rodada 11): leitura da wiki, escrita fora dela e scripts sem escrita nem execução continuam liberados", async () => {
      const { fora, cofre, esperar, wikiA } = prepararRodada11();
      try {
        const regressoes = [
          `sed -n '1p' wiki/a.md`,
          `sed 's/a/b/' wiki/a.md > ${fora}/x`,
          `sed --sandbox -n 'w ${wikiA}' ${fora}/p.md`,
          `sed -n 'w ${fora}/x' ${fora}/p.md`,
          `sed -n 'w /dev/stdout' ${fora}/p.md`,
          `sed -n 's/a/b/w /dev/stderr' ${fora}/p.md`,
          `sed -n '/foo/{p;d}' ${fora}/p.md`,
          `sed -e 's/w/e/g' -e 'y/abc/wxe/' ${fora}/p.md`,
          `sed '1i\\\\wiki/a.md w e' ${fora}/p.md`,
          `sed -f ${fora}/limpo.sed ${fora}/p.md`,
          `sed '1e echo oi' ${fora}/p.md`,
          `awk '{print $1}' wiki/a.md`,
          `awk '{print > "${fora}/x"}' ${fora}/p.md`,
          `awk '$1 > 5 {print}' ${fora}/p.md`,
          `awk '{print | "cat"}' ${fora}/p.md`,
          `awk 'BEGIN{system("echo ok")}'`,
          `awk '{print "wiki/a.md > x"}' ${fora}/p.md`,
          `gawk '{print}' ${fora}/p.md`,
          `vim -es -c q ${fora}/p.md`,
          `vim -es -c 'w ${fora}/x' -c q ${fora}/p.md`,
          `ex -sc 'w ${fora}/x|q' ${fora}/p.md`,
          `vim --version`,
        ];
        await esperar(regressoes, 0, cofre);
      } finally {
        rmSync(fora, { recursive: true, force: true });
      }
    });

    test("Achado P2 do bot (rodada 11): formas adicionais de script (endereços, a\\, -S, --cmd, -w, global, getline)", async () => {
      const { fora, stage, cofre, esperar, wikiA } = prepararRodada11();
      writeFileSync(join(fora, "multi.sed"), `1a\\\ntexto\nw ${wikiA}\n`);
      writeFileSync(join(fora, "grava.vim"), `%s/a/b/\nw! ${wikiA}\nq\n`);
      writeFileSync(join(fora, "limpo.vim"), "%s/a/b/g\nq\n");
      try {
        const ataques = [
          `sed -n '2{p;w wiki/a.md}' ${fora}/p.md`,
          `sed -f ${fora}/multi.sed ${fora}/p.md`,
          `sed 's|a|b|w wiki/a.md' ${fora}/p.md`,
          `sed '/a/I,/b/w wiki/a.md' ${fora}/p.md`,
          `sed '\\,x,w wiki/a.md' ${fora}/p.md`,
          `sed -s -n '$w wiki/a.md' ${fora}/p.md`,
          `sed '/x/!w wiki/a.md' ${fora}/p.md`,
          `sed 'unknown w wiki/a.md' ${fora}/p.md`,
          `sed -e`,
          `awk -F: -v x=1 '{print > "wiki/a.md"}' ${fora}/p.md`,
          `awk --source='{print > "wiki/a.md"}' ${fora}/p.md`,
          `awk -e '{print > "wiki/a.md"}' ${fora}/p.md`,
          `awk '{ "date" | getline d; print d > "wiki/a.md" }' ${fora}/p.md`,
          `awk '{ cmd | getline d }' ${fora}/p.md`,
          `awk '{print > "wiki/a.md}' ${fora}/p.md`,
          `awk -i inplace -f ${fora}/script.awk ${wikiA}`,
          `vim -es -S ${fora}/grava.vim ${fora}/p.md`,
          `vim -es --cmd 'w wiki/a.md' -c q ${fora}/p.md`,
          `vim -es -w wiki/a.md -c q ${fora}/p.md`,
          `vim -es -V9wiki/a.md -c q ${fora}/p.md`,
          `vim -es -c 'sil! w wiki/a.md' -c q ${fora}/p.md`,
          `vim -es -c '%w wiki/a.md' -c q ${fora}/p.md`,
          `vim -es -c 'r!cp -R ${stage}/. .' -c q ${fora}/p.md`,
          `vim -es -c 'wq wiki/a.md' ${fora}/p.md`,
          `vim -es -c 'exe "w wiki/a.md"' -c q ${fora}/p.md`,
          `vim -es -S ${fora}/nao-existe.vim ${fora}/p.md`,
          `vim -es -c '1,3!cp -R ${stage}/. .' ${fora}/p.md`,
          `ed -p '> ' -s ${wikiA}`,
          `ex -s ${fora}/p.md < /dev/null`,
        ];
        await esperar(ataques, 2, cofre);

        const regressoes = [
          `sed -n '/a/I,/b/p' ${fora}/p.md`,
          `sed '1a\\\\\ntexto' ${fora}/p.md`,
          `sed 'y/a/b/;l 5;q' ${fora}/p.md`,
          `sed -s -n '$p' ${fora}/p.md`,
          `sed -n '/x/!p' ${fora}/p.md`,
          `awk -F: -v x=1 '{print $1}' ${fora}/p.md`,
          `awk --source='{print}' ${fora}/p.md`,
          `awk '{ "date" | getline d; print d }' ${fora}/p.md`,
          `vim -es -S ${fora}/limpo.vim ${fora}/p.md`,
          `vim -es -c '%s/a/b/g' -c wq ${fora}/p.md`,
          `vim -es -c 'sil! w ${fora}/x' -c q ${fora}/p.md`,
          `ed -s ${fora}/p.md`,
          `ex -s -c 'g/x/d' -c wq ${fora}/p.md`,
          `vim -es -c '!echo ok' -c q ${fora}/p.md`,
          `vim -es -c 'g/x/' -c q ${fora}/p.md`,
          `vim -es -c 'r !echo ok' -c q ${fora}/p.md`,
        ];
        await esperar(regressoes, 0, cofre);
      } finally {
        rmSync(fora, { recursive: true, force: true });
      }
    });

    test("Rodada 11 (revisão automática): rótulo do sed, prefixos, -d/-W/-l do awk, concatenação e regex, ex por lista permitida e -u/-s/-i do vim", async () => {
      const { fora, stage, cofre, esperar, wikiA } = prepararRodada11();
      writeFileSync(join(fora, "rc.vim"), "silent! !cp -R x y\n");
      writeFileSync(join(fora, "teclas"), `:w ${wikiA}\r`);
      try {
        const ataques = [
          `sed ':a;w wiki/a.md' ${fora}/p.md`,
          `sed 'b end;w wiki/a.md' ${fora}/p.md`,
          `sed 't;w wiki/a.md' ${fora}/p.md`,
          `sed --e='w wiki/a.md' ${fora}/p.md`,
          `sed --e 'w wiki/a.md' ${fora}/p.md`,
          `awk -d '{print > "wiki/a.md"}' ${fora}/p.md`,
          `awk -W 'source={print > "wiki/a.md"}' ${fora}/p.md`,
          `awk --so='{print > "wiki/a.md"}' ${fora}/p.md`,
          `awk -l inplace '{print}' ${wikiA}`,
          `awk --load=inplace '{print}' wiki/a.md`,
          `awk '@include "x"; {print}' ${fora}/p.md`,
          `awk '@load "inplace"; BEGIN{}' ${fora}/p.md`,
          `awk '{print > "w" "iki/a.md"}' ${fora}/p.md`,
          `awk '{print | "cat >" " wiki/a.md"}' ${fora}/p.md`,
          `awk 'BEGIN{"cp -R " "x" | getline}' ${fora}/p.md`,
          `awk '/"/ {print > "${fora}/x"} /"/ {print > "wiki/a.md"}' ${fora}/p.md`,
          `vim -es -c 's/x/\\=system("cp -R ${stage}/. .")/' -c q ${fora}/p.md`,
          `vim -es -c 'call system("cp -R ${stage}/. .")' -c q ${fora}/p.md`,
          `vim -es -c 'let x=system("cp")' -c q ${fora}/p.md`,
          `vim -es -c 'e wiki/a.md' -c w -c q ${fora}/p.md`,
          `vim -es -c 'term cp -R ${stage}/. .' ${fora}/p.md`,
          `vim -es -c 'grep x' ${fora}/p.md`,
          `vim -es -u ${fora}/rc.vim -c q ${fora}/p.md`,
          `vim -s ${fora}/teclas ${fora}/p.md`,
          `vim -i wiki/a.viminfo -es -c q ${fora}/p.md`,
        ];
        await esperar(ataques, 2, cofre);

        const regressoes = [
          `sed ':a;N;$!ba;s/\\n/ /g' ${fora}/p.md`,
          `sed 'b end;p;:end' ${fora}/p.md`,
          `sed --e='s/a/b/' ${fora}/p.md`,
          `awk -d '{print $1}' ${fora}/p.md`,
          `awk '/"/ {print}' ${fora}/p.md`,
          `awk '{x = 4 / 2; print x}' ${fora}/p.md`,
          `awk '{print > "${fora}/x"; print "a" "b"}' ${fora}/p.md`,
          `vim -es -u NONE -c q ${fora}/p.md`,
          `vim --clean -es -c '%s/a/b/g' -c wq ${fora}/p.md`,
        ];
        await esperar(regressoes, 0, cofre);
      } finally {
        rmSync(fora, { recursive: true, force: true });
      }
    });

    test("Rodada 11 (pendências): git config com -- e várias ocorrências, bash -oc, put/set do vim e awk x++ / 2", async () => {
      const { fora, stage, cofre, esperar, wikiA } = prepararRodada11();
      const longe = join(fora, "y");
      const atacar = `cp -R ${stage}/. ${cofre}/`;
      try {
        const ataques = [
          `git config core.worktree -- ${cofre}`,
          `git config -- core.worktree ${cofre}`,
          `git config --default core.worktree core.worktree ${cofre}`,
          `git config core.worktree ${longe} ${cofre}`,
          `git config --add core.worktree ${longe} --add core.worktree ${cofre}`,
          `bash -oc pipefail "${atacar}"`,
          `bash -Oc extglob "${atacar}"`,
          `bash -ocO pipefail extglob "${atacar}"`,
          `bash -o pipefail -oc errexit "${atacar}"`,
          `sh -oc nounset "${atacar}"`,
          `vim -es -c 'put =system("${atacar}")' -c q ${fora}/p.md`,
          `vim -es -c 'pu =execute("w ${wikiA}")' -c q ${fora}/p.md`,
          `vim -es -c 'set verbosefile=${wikiA}' -c q ${fora}/p.md`,
          `vim -es -c 'setlocal shell=x' -c q ${fora}/p.md`,
          `awk 'BEGIN{x++ / 2; print > "wiki/a.md"; y / 3}' ${fora}/p.md`,
          `awk 'BEGIN{x-- / 2; print > "wiki/a.md"; y / 3}' ${fora}/p.md`,
        ];
        await esperar(ataques, 2, longe);

        const regressoes = [
          `git config core.worktree ${longe}`,
          `git config --get core.worktree`,
          `git config core.worktree`,
          `git config --default x user.name y`,
          `bash -oc pipefail "echo ok"`,
          `bash -o pipefail -c "echo ok"`,
          `bash -ec "echo ok"`,
          `vim -es -c '%s/a/b/g' -c wq ${fora}/p.md`,
          `awk 'BEGIN{x++; y = 4 / 2; print y > "${fora}/x"}' ${fora}/p.md`,
        ];
        await esperar(regressoes, 0, longe);
      } finally {
        rmSync(fora, { recursive: true, force: true });
      }
    });

    test("Rodada 11 (revisão automática 2): script trocado na mesma linha e opções do gawk que gravam arquivo", async () => {
      const { fora, cofre, esperar, wikiA } = prepararRodada11();
      writeFileSync(join(fora, "grava.vim"), `w! ${wikiA}\nq\n`);
      writeFileSync(join(fora, "limpo.vim"), "q\n");
      try {
        const ataques = [
          `cp ${fora}/script.sed ${fora}/limpo.sed && sed -f ${fora}/limpo.sed ${fora}/p.md`,
          `mv ${fora}/grava.vim ${fora}/limpo.vim; vim -es -S ${fora}/limpo.vim ${fora}/p.md`,
          `cat ${fora}/p.md | sed -f ${fora}/limpo.sed`,
          `awk -p${wikiA} 'BEGIN{}' ${fora}/p.md`,
          `awk -dwiki/a.md 'BEGIN{}' ${fora}/p.md`,
          `awk -owiki/a.md 'BEGIN{}' ${fora}/p.md`,
          `awk --dump-variables=${wikiA} 'BEGIN{}' ${fora}/p.md`,
          `awk --profile=wiki/a.md 'BEGIN{}' ${fora}/p.md`,
          `awk --pretty-print=wiki/a.md 'BEGIN{}' ${fora}/p.md`,
        ];
        await esperar(ataques, 2, cofre);

        const regressoes = [
          `sed -f ${fora}/limpo.sed ${fora}/p.md`,
          `vim -es -S ${fora}/limpo.vim ${fora}/p.md`,
          `awk --dump-variables=${fora}/v 'BEGIN{}' ${fora}/p.md`,
          `awk -d 'BEGIN{}' ${fora}/p.md`,
          `awk --pretty-print 'BEGIN{}' ${fora}/p.md`,
        ];
        await esperar(regressoes, 0, cofre);
      } finally {
        rmSync(fora, { recursive: true, force: true });
      }
    });

    test("Achado P2 do bot (rodada 12, A): dd com vários of= julga todos, porque o dd grava no último", async () => {
      const { fora, cofre, esperar, wikiA } = prepararRodada11();
      try {
        const ataques = [
          `dd if=${fora}/p.md of=${fora}/seguro.md of=wiki/a.md`,
          `dd if=${fora}/p.md of=${fora}/seguro.md of=${wikiA}`,
          `dd of=${fora}/seguro.md if=${fora}/p.md of=${wikiA} conv=notrunc`,
          `dd of=${fora}/a of=${fora}/b of=wiki/a.md`,
          `dd of=wiki/a.md of=${fora}/seguro.md`,
          `sudo dd if=${fora}/p.md of=${fora}/seguro.md of=wiki/a.md`,
        ];
        await esperar(ataques, 2, cofre);
        const regressoes = [
          `dd if=${fora}/p.md of=${fora}/seguro.md`,
          `dd if=${fora}/p.md of=${fora}/a of=${fora}/b`,
          `dd if=wiki/a.md of=${fora}/seguro.md`,
        ];
        await esperar(regressoes, 0, cofre);
      } finally {
        rmSync(fora, { recursive: true, force: true });
      }
    });

    test("Achado B (CI Windows): til no meio do caminho é literal, como em RUNNER~1 do tmpdir() do runner", async () => {
      const { fora, cofre, esperar } = prepararRodada8();
      // Dado um diretório de nome curto 8.3 (o runner do Windows usa C:\Users\RUNNER~1\...), Quando -C o escolhe, Então a pasta é literal
      const curto = join(fora, "CURTO~1");
      mkdirSync(curto);
      try {
        const regressoes = [
          `tar -xf ${fora}/x.tar -C ${curto}`,
          `tar -cf ${fora}/b.tar -C ${curto} .`,
          `env -C ${curto} cat a.md`,
          `git -C ${curto} log`,
          `make -C ${curto}`,
        ];
        await esperar(regressoes, 0, cofre);
        // O til no começo da palavra continua sendo expansão e continua bloqueando.
        const ataques = [`env -C ~/x sed -i s/a/b/ a.md`, `tar -C ~ -xf ${fora}/x.tar`];
        await esperar(ataques, 2, cofre);
      } finally {
        rmSync(fora, { recursive: true, force: true });
      }
    });
  });
});
