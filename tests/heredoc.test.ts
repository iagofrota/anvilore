import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test, expect } from "bun:test";
import { avaliarGateHeredoc } from "../src/lib/heredoc";
import { decidir as decidirRaw, executarProtecao } from "../src/comandos/hook-proteger-raw";
import { decidirVerified } from "../src/lib/trava-verified";

test("Dado entradas com heredoc Quando aplico o gate compartilhado Então só os formatos A, B e C são normalizados", () => {
  const permitidos = [
    ["git commit -F - <<'EOF'\nmsg\nEOF", "git commit -F -"],
    ["git commit --amend -F - <<\"EOF\"\nmsg\nEOF", "git commit --amend -F -"],
    ["git commit --file=- <<'MSG'\nmsg\nMSG", "git commit --file=-"],
    ["git commit --file - <<'MSG'\nmsg\nMSG", "git commit --file -"],
    ["git commit -m \"$(cat <<'EOF'\nfix\nEOF\n)\"", 'git commit -m "__ANVILORE_MENSAGEM_HEREDOC__"'],
    ["git commit -m \"$(cat <<'EOF'\nfix\n\nCo-Authored-By: x\nEOF\n)\"", 'git commit -m "__ANVILORE_MENSAGEM_HEREDOC__"'],
    ["git tag -a v1 -m \"$(cat <<'EOF'\nrelease\nEOF\n)", 'git tag -a v1 -m "__ANVILORE_MENSAGEM_HEREDOC__"'],
    ["git tag -a v1 -m \"$(cat <<'EOF'\nrelease\nEOF\n)\"", 'git tag -a v1 -m "__ANVILORE_MENSAGEM_HEREDOC__"'],
    ["gh pr create --title t --body \"$(cat <<'EOF'\ncorpo\nEOF\n)\"", 'gh pr create --title t --body "__ANVILORE_MENSAGEM_HEREDOC__"'],
    ["gh pr comment 1 --body \"$(cat <<'EOF'\ncorpo\nEOF\n)\"", 'gh pr comment 1 --body "__ANVILORE_MENSAGEM_HEREDOC__"'],
    ["gh pr edit 1 --body \"$(cat <<'EOF'\ncorpo\nEOF\n)\"", 'gh pr edit 1 --body "__ANVILORE_MENSAGEM_HEREDOC__"'],
    ["gh pr review 1 --body \"$(cat <<'EOF'\ncorpo\nEOF\n)\"", 'gh pr review 1 --body "__ANVILORE_MENSAGEM_HEREDOC__"'],
    ["gh issue create --title t --body \"$(cat <<'EOF'\ncorpo\nEOF\n)\"", 'gh issue create --title t --body "__ANVILORE_MENSAGEM_HEREDOC__"'],
    ["gh issue comment 1 --body \"$(cat <<'EOF'\ncorpo\nEOF\n)\"", 'gh issue comment 1 --body "__ANVILORE_MENSAGEM_HEREDOC__"'],
    ["gh issue edit 1 --body \"$(cat <<'EOF'\ncorpo\nEOF\n)\"", 'gh issue edit 1 --body "__ANVILORE_MENSAGEM_HEREDOC__"'],
    ["gh pr create --title t --body \"$(cat <<'EOF'\nx\nEOF\n)\"", 'gh pr create --title t --body "__ANVILORE_MENSAGEM_HEREDOC__"'],
    ["cat <<'EOF' > /tmp/notas.md\n# t\nEOF", "cat > /tmp/notas.md"],
    ["cat > /tmp/n.md <<'EOF'\nx\nEOF", "cat > /tmp/n.md"],
    ['cat > "wiki/a notes.md" <<\'EOF\'\nx\nEOF', 'cat > "wiki/a notes.md"'],
    ["cat <<'EOF' >> /tmp/n.md\nx\nEOF", "cat >> /tmp/n.md"],
    ["tee /tmp/n.md <<'EOF'\nx\nEOF", "tee /tmp/n.md"],
    ["tee -a /tmp/n.md <<'EOF'\nx\nEOF", "tee -a /tmp/n.md"],
  ] as const;
  for (const [comando, normalizado] of permitidos) {
    expect(avaliarGateHeredoc(comando)).toEqual({ aceito: true, comando: normalizado });
  }
  expect(avaliarGateHeredoc("bun test tests/heredoc.test.ts")).toEqual({ aceito: true, comando: "bun test tests/heredoc.test.ts" });

  const negados = [
    "git commit -F - <<EOF\nmsg\nEOF",
    "cat <<-'EOF' > /tmp/n.md\nx\nEOF",
    "cat 0<<'EOF' > /tmp/n.md\nx\nEOF",
    "cat 3<<'EOF' > /tmp/n.md\nx\nEOF",
    "cat <<\\EOF > /tmp/n.md\nx\nEOF",
    "cat <<E'O'F > /tmp/n.md\nx\nEOF",
    "cat <<'EOF'' > /tmp/n.md\nx\nEOF",
    "cat <<'EOF' > /tmp/n.md\nx\nEOF ",
    "cat <<'EOF' > /tmp/n.md\nx\nEOF\nrm raw/a.md",
    "cat <<'EOF' > /tmp/n.md\nx\nEOF\n# c",
    "cat <<'EOF' > /tmp/n.md\nx\nEOF\n",
    "cat <<'EOF' > /tmp/n.md\nEOF\nx\nEOF",
    "git commit -F - <<'EOF'\nEOF)\nmsg\nEOF",
    "git commit -F - <<'EOF'\nEOFX\nmsg\nEOF",
    "git commit -m \"$(cat <<'EOF'\nEOF )\nmsg\nEOF\n)\"",
    "cat <<'EOF' > /tmp/n.md\nEOF)\nx\nEOF",
    "cat <<'A' <<'B' > /tmp/n.md\nx\nA\ny\nB",
    "cat <<< 'x'",
    "cat <<'EOF' > /tmp/n.md\nx\nEOF\r",
    "wc -l <<'EOF'\nx\nEOF",
    "cat <<'EOF' | wc -l\nx\nEOF",
    "cat <<'EOF' | sh\nx\nEOF",
    "sh <<'EOF'\nx\nEOF",
    "python3 - <<'EOF'\nprint(1)\nEOF",
    "sh -c \"$(cat <<'EOF'\ntrue\nEOF\n)\"",
    "eval \"$(cat <<'EOF'\ntrue\nEOF\n)\"",
    "git commit -F - <<'EOF' ; true\nmsg\nEOF",
    "git commit -F - <<'EOF' && true\nmsg\nEOF",
    "git commit -F - <<'EOF' | cat\nmsg\nEOF",
    "git commit -F - <<'EOF' # comment\nmsg\nEOF",
    "git commit -F - <<'EOF' $VAR\nmsg\nEOF",
    "git commit -F - <<'EOF' `date`\nmsg\nEOF",
    "cat <<'EOF' > /tmp/*.md\nx\nEOF",
    "cat <<'EOF' > ~/n.md\nx\nEOF",
    "cat <<'EOF' > /tmp/my notes.md\nx\nEOF",
    'cat > "$HOME/n.md" <<\'EOF\'\nx\nEOF',
    "echo '<<' # still detected",
    "git commit -F - <<'EOF'\nmsg\nEOF\0",
  ];
  for (const comando of negados) expect(avaliarGateHeredoc(comando)).toEqual({ aceito: false });
});

test("Dado palavras reservadas como argumentos Quando classifico quebras Então os dois guardas julgam a próxima linha", async () => {
  const vault = mkdtempSync(join(tmpdir(), "anvilore-heredoc-reservada-"));
  mkdirSync(join(vault, "raw"));
  mkdirSync(join(vault, "wiki"));
  writeFileSync(join(vault, "SCHEMA.md"), "# Schema\n");
  writeFileSync(join(vault, "raw/a.md"), "bruto\n");
  writeFileSync(join(vault, "wiki/a.md"), "---\ntitle: A\n---\n");
  const palavras = ["if", "then", "do", "while", "until", "case", "else", "elif", "in", "select", "{"];
  const comandos = [
    ...palavras.map(palavra => `echo ${palavra}\nrm raw/a.md`),
    "echo x if\nrm raw/a.md",
    "echo > if\nrm raw/a.md",
    "> if echo x\nrm raw/a.md",
    "printf '%s' while\nrm raw/a.md",
    "ls do;\nrm raw/a.md",
  ];
  const erroOriginal = console.error;
  console.error = () => {};
  try {
    for (const command of comandos) {
      const payload = JSON.stringify({ cwd: vault, tool_name: "Bash", tool_input: { command } });
      expect(await executarProtecao(payload)).toBe(2);
      const commandVerified = command.replace("rm raw/a.md", "cp p wiki/a.md");
      const payloadVerified = JSON.stringify({ cwd: vault, tool_name: "Bash", tool_input: { command: commandVerified } });
      expect((await decidirVerified(payloadVerified, vault)).acao).toBe("bloquear");
    }
  } finally {
    console.error = erroOriginal;
    rmSync(vault, { recursive: true, force: true });
  }
});

test("Dado os formatos A, B e C Quando aplico o gate pelos guardas Então preservo as regras de destino", async () => {
  const vault = mkdtempSync(join(tmpdir(), "anvilore-heredoc-lista-"));
  mkdirSync(join(vault, "raw"));
  mkdirSync(join(vault, "wiki"));
  writeFileSync(join(vault, "SCHEMA.md"), "# Schema\n");
  writeFileSync(join(vault, "raw/a.md"), "bruto\n");
  writeFileSync(join(vault, "wiki/a.md"), "---\ntitle: A\n---\n");
  writeFileSync(join(vault, "p"), "origem\n");
  const aceitos: Array<{ comando: string; raw: number; verified: "liberar" | "bloquear" }> = [
    { comando: "git commit -F - <<'EOF'\nmsg\nEOF", raw: 0, verified: "liberar" },
    { comando: "git commit --amend -F - <<\"EOF\"\nmsg\nEOF", raw: 0, verified: "liberar" },
    { comando: "git commit -m \"$(cat <<'EOF'\nfix\n\nCo-Authored-By: x\nEOF\n)\"", raw: 0, verified: "liberar" },
    { comando: "gh pr create --title t --body \"$(cat <<'EOF'\ncorpo\nEOF\n)\"", raw: 0, verified: "liberar" },
    { comando: "cat <<'EOF' > /tmp/notas.md\n# t\nEOF", raw: 0, verified: "liberar" },
    { comando: "cat > /tmp/n.md <<'EOF'\nx\nEOF", raw: 0, verified: "liberar" },
    { comando: "cat > raw/x.md <<'EOF'\nx\nEOF", raw: 2, verified: "liberar" },
    { comando: "tee raw/x.md <<'EOF'\nx\nEOF", raw: 2, verified: "liberar" },
    { comando: "cat <<'EOF' >> raw/a.md\nx\nEOF", raw: 2, verified: "liberar" },
    { comando: "cat > wiki/x.md <<'EOF'\n---\nverified: true\n---\nEOF", raw: 0, verified: "bloquear" },
  ];
  const rejeitados = [
    "git commit -F - <<EOF\nmsg\nEOF",
    "<<-'EOF'",
    "0<<'EOF'",
    "\\EOF",
    "E'O'F",
    "EOF''",
    "EOF ",
    "EOF\nrm raw/a.md",
    "EOF\n# c",
    "EOF\n",
    "EOF repetido no corpo\nEOF",
    "dois << operadores",
    "<<< aqui string",
    "retorno CR \r inesperado",
    "consumer wc -l",
    "pipe cat <<EOF | sh",
    "consumer sh",
    "consumer python3",
    "B sh -c",
    "B eval",
    "linha com ;",
    "linha com &&",
    "linha com |",
    "linha com #",
    "linha com $VAR",
    "linha com `date`",
  ];
  const erroOriginal = console.error;
  console.error = () => {};
  const falhas: string[] = [];
  try {
    for (const caso of aceitos) {
      const payload = JSON.stringify({ cwd: vault, tool_name: "Bash", tool_input: { command: caso.comando } });
      const raw = decidirRaw(payload).acao === "bloquear" ? 2 : 0;
      const verified = (await decidirVerified(payload, vault)).acao;
      if (raw !== caso.raw) falhas.push(`raw esperado=${caso.raw}, atual=${raw}: ${JSON.stringify(caso.comando)}`);
      if (verified !== caso.verified) falhas.push(`verified esperado=${caso.verified}, atual=${verified}: ${JSON.stringify(caso.comando)}`);
    }
    for (const amostra of rejeitados) {
      const comando = amostra.startsWith("git commit -F") ? amostra : `cat <<'EOF'\n${amostra}\nEOF`;
      const payload = JSON.stringify({ cwd: vault, tool_name: "Bash", tool_input: { command: comando } });
      const raw = decidirRaw(payload).acao === "bloquear" ? 2 : 0;
      const verified = (await decidirVerified(payload, vault)).acao;
      if (raw !== 2) falhas.push(`raw esperava bloquear, atual=${raw}: ${JSON.stringify(comando)}`);
      if (verified !== "bloquear") falhas.push(`verified esperava bloquear, atual=${verified}: ${JSON.stringify(comando)}`);
    }
    expect(falhas).toEqual([]);
  } finally {
    console.error = erroOriginal;
    rmSync(vault, { recursive: true, force: true });
  }
});
