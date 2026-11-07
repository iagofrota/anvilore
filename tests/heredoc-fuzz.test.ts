import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test, expect, setDefaultTimeout } from "bun:test";
import { executarProtecao } from "../src/comandos/hook-proteger-raw";
import { decidirVerified, extrairSubstituicoesComando } from "../src/lib/trava-verified";

const bashDisponivel = process.platform !== "win32" && Bun.which("bash") !== null;
const N_POR_SEMENTE = 180;
const SEMENTES = [12345, 777, 4242, 99991];
const CARGA = "touch raw/MARCA";
const MARCADOR = "__ANVILORE_HEREDOC_0__";

const delims = ["'EOF'", "\"EOF\"", "\\EOF", "EOF", "E'O'F", "'E O'", "EOF''", "-'EOF'", "-EOF"];
const ops = ["", " |", " | ", " |&", " &&", " ||", " ;", " # c", " | # c", " \\"];
const consumidores = ["sh", "bash", "wc -l", "cat", "true", CARGA, `echo \"$(${CARGA})\"`, MARCADOR, `sh < ${MARCADOR}`, `bash ${MARCADOR}`, `cat ${MARCADOR} | sh`, "", "# c"];
const interpretadores = ["sh", "bash", "dash", "zsh", "fish", "python", "python2", "python3", "python3.11", "node", "bun", "perl", "ruby", "php", "osascript"];
const palavrasReservadas = ["if", "then", "do", "while", "until", "case", "else", "elif", "in", "select", "{"];
const prefixos = [
  { antes: "", depois: "" },
  { antes: "", depois: "" },
  { antes: `${CARGA}; `, depois: "" },
  { antes: "( ", depois: "\n)" },
  { antes: "{ ", depois: "\n}" },
  { antes: "echo \"$(", depois: "\n)\"" },
  { antes: "if ", depois: "\nthen true; fi" },
  { antes: "while ", depois: "\ndo break; done" },
  { antes: "if true; then ", depois: "\nfi" },
  { antes: "while true; do ", depois: "\nbreak; done" },
];
const comandos = ["cat", "true", "git commit -F -", "sh", "x=1 cat", "cat >/dev/null", ...interpretadores];
setDefaultTimeout(60_000);

function gerador(seedInicial: number): () => string {
  let seed = seedInicial;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const pick = <T,>(opcoes: T[]) => opcoes[rnd(opcoes.length)]!;
  const corpo = () => pick([
    CARGA, "ok", MARCADOR, `$(${CARGA})`, `\`${CARGA}\``, "EOF", "\tEOF", " EOF", "", "# x",
    `'$(${CARGA})'`, `\${x:-$(${CARGA})}`,
  ]);
  const separador = () => pick(["\n", "\n\n", "\n# c\n", "\n  # c\n", "\n\t\n"]);
  return () => {
    const d = pick(delims);
    const minus = d.startsWith("-");
    const dd = minus ? d.slice(1) : d;
    const term = dd.replace(/['"\\]/g, "");
    const tab = minus && rnd(2) ? "\t" : "";
    const prefixo = pick(prefixos);
    const comando = pick(comandos);
    const operador = pick(ops);
    const argumentoReservado = rnd(4) === 0 ? `echo ${pick(palavrasReservadas)}\n` : "";
    let script = `${argumentoReservado}${prefixo.antes}${comando} <<${minus ? "-" : ""}${dd}${operador}\n`;
    const linhas = rnd(3) + 1;
    for (let i = 0; i < linhas; i++) script += tab + (rnd(5) === 0 ? `${corpo()}\\\n` : corpo()) + "\n";
    const dividirTerminador = !dd.includes("'") && !dd.includes('"') && !dd.includes("\\") && rnd(4) === 0;
    const terminador = dividirTerminador ? `${tab}${term.slice(0, -1)}\\\n${term.slice(-1)}` : `${tab}${term}`;
    script += terminador + prefixo.depois + separador() + pick(consumidores);
    return script;
  };
}

test.skipIf(!bashDisponivel)("Dado fuzz fixo de heredocs Quando comparo a execução no Bash com a proteção Então nenhum interpretador contorna o guarda", async () => {
  const vault = mkdtempSync(join(tmpdir(), "anvilore-heredoc-fuzz-"));
  mkdirSync(join(vault, "raw"));
  mkdirSync(join(vault, "wiki"));
  writeFileSync(join(vault, "SCHEMA.md"), "# Schema\n");
  writeFileSync(join(vault, "raw/a.md"), "bruto\n");
  writeFileSync(join(vault, "wiki/a.md"), "---\ntitle: A\n---\n");
  writeFileSync(join(vault, "__ANVILORE_HEREDOC_0__"), "rm raw/a.md\n");
  const furos: string[] = [];
  const erroOriginal = console.error;
  console.error = () => {};
  try {
    const marcador = MARCADOR;
    const ataquesComMarcador = [
      `sh < ${marcador}`,
      `cat <<'EOF' >/dev/null\nok\nEOF\nsh < ${marcador}`,
      `cat <<'EOF' >/dev/null\nok\nEOF\nbash ${marcador}`,
      `cat <<'EOF' >/dev/null\nok\nEOF\ncat ${marcador} | sh`,
      `cat <<'EOF' >/dev/null\nok\nEOF\npython3 < ${marcador}`,
      `cat <<'EOF' | sh\nok\nEOF\nsh < ${marcador}`,
    ];
    for (const command of ataquesComMarcador) {
      const payload = JSON.stringify({ cwd: vault, tool_name: "Bash", tool_input: { command } });
      expect({ command, raw: await executarProtecao(payload) }).toEqual({ command, raw: 2 });
      expect({ command, verified: (await decidirVerified(payload, vault)).acao }).toEqual({ command, verified: "bloquear" });
    }
    const extraido = extrairSubstituicoesComando("cat <<'EOF'\nok\nEOF");
    expect(extraido.texto).not.toContain("__ANVILORE_HEREDOC_");
    expect(extraido.heredocs[0]?.inicio).toEqual(expect.any(Number));

    const ataquesConhecidos = [
      "if sh <<'EOF'\nrm raw/a.md\nEOF\nthen true; fi",
      "if sh <<-EOF\nrm raw/a.md\nEOF\nthen true; fi",
      "while bash <<'EOF'\nrm raw/a.md\nEOF\ndo break; done",
      "if true; then sh <<'EOF'\nrm raw/a.md\nEOF\nfi",
      "if python3 <<'EOF'\nimport os; os.system(\"rm raw/a.md\")\nEOF\nthen true; fi",
    ];
    for (const command of ataquesConhecidos) {
      const codigo = await executarProtecao(JSON.stringify({ cwd: vault, tool_name: "Bash", tool_input: { command } }));
      expect({ command, codigo }).toEqual({ command, codigo: 2 });
    }

    for (const command of [
      "sh <<'EOF'\ntrue\nEOF",
      "if sh <<'EOF'\ntrue\nEOF\nthen true; fi",
      "cat <<'EOF' |\ntrue\nEOF\nsh",
    ]) {
      const codigo = await executarProtecao(JSON.stringify({ cwd: vault, tool_name: "Bash", tool_input: { command } }));
      expect({ command, codigo }).toEqual({ command, codigo: 0 });
    }

    for (const seed of SEMENTES) {
      const gerar = gerador(seed);
      for (let i = 0; i < N_POR_SEMENTE; i++) {
        const comando = gerar();
        const bashDir = mkdtempSync(join(tmpdir(), "anvilore-heredoc-fuzz-bash-"));
        mkdirSync(join(bashDir, "raw"));
        try {
          Bun.spawnSync(["bash", "-c", comando], {
            cwd: bashDir,
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
            timeout: 3000,
          });
          if (!existsSync(join(bashDir, "raw/MARCA"))) continue;
        } finally {
          rmSync(bashDir, { recursive: true, force: true });
        }

        const protegido = await executarProtecao(JSON.stringify({
          cwd: vault,
          tool_name: "Bash",
          tool_input: { command: comando.replaceAll(CARGA, "rm raw/a.md") },
        }));
        if (protegido !== 2) furos.push(`seed=${seed} caso=${i} guarda=${protegido} comando=${JSON.stringify(comando)}`);
      }
    }
  } finally {
    console.error = erroOriginal;
    rmSync(vault, { recursive: true, force: true });
  }
  expect(furos).toEqual([]);
});
