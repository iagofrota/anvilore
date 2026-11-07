import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test, expect, setDefaultTimeout } from "bun:test";
import { decidir as decidirRaw, executarProtecao } from "../src/comandos/hook-proteger-raw";
import { decidirVerified } from "../src/lib/trava-verified";

const bashDisponivel = process.platform !== "win32" && Bun.which("bash") !== null;
const N_POR_SEMENTE = 60;
const SEMENTES = [12345, 777, 4242, 99991];
const CARGA_RAW = "touch raw/MARCA";
const CARGA_WIKI = "cp p wiki/MARCA.md";
const MARCADOR = "__ANVILORE_HEREDOC_0__";

const delims = ["'EOF'", "\"EOF\"", "\\EOF", "EOF", "E'O'F", "'E O'", "EOF''", "-'EOF'", "-EOF"];
const ops = ["", " |", " | ", " |&", " &&", " ||", " ;", " # c", " | # c", " \\"];
const consumidoresBase = ["sh", "bash", "wc -l", "cat", "true", MARCADOR, `sh < ${MARCADOR}`, `bash ${MARCADOR}`, `cat ${MARCADOR} | sh`, "", "# c"];
const interpretadores = ["sh", "bash", "dash", "zsh", "fish", "python", "python2", "python3", "python3.11", "node", "bun", "perl", "ruby", "php", "osascript"];
const palavrasReservadas = ["if", "then", "do", "while", "until", "case", "else", "elif", "in", "select", "{"];
const descritoresHeredoc = ["", "0", "00", "3", "9", "10"];
setDefaultTimeout(60_000);

function gerador(seedInicial: number, carga: string): () => string {
  let seed = seedInicial;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 12) % n; };
  const pick = <T,>(opcoes: T[]) => opcoes[rnd(opcoes.length)]!;
  const corpo = () => pick([
    carga, "ok", MARCADOR, `$(${carga})`, `\`${carga}\``, "EOF", "\tEOF", " EOF", "", "# x",
    `'$(${carga})'`, `\${x:-$(${carga})}`,
  ]);
  const separador = () => pick(["\n", "\n\n", "\n# c\n", "\n  # c\n", "\n\t\n"]);
  const prefixos = [
    { antes: "", depois: "" },
    { antes: "", depois: "" },
    { antes: `${carga}; `, depois: "" },
    { antes: "( ", depois: "\n)" },
    { antes: "{ ", depois: "\n}" },
    { antes: "echo \"$(", depois: "\n)\"" },
    { antes: "if ", depois: "\nthen true; fi" },
    { antes: "while ", depois: "\ndo break; done" },
    { antes: "if true; then ", depois: "\nfi" },
    { antes: "while true; do ", depois: "\nbreak; done" },
  ];
  const comandos = ["cat", "true", "git commit -F -", "sh", "x=1 cat", "cat >/dev/null", ...interpretadores];
  const consumidores = [...consumidoresBase.slice(0, 5), carga, `echo \"$(${carga})\"`, ...consumidoresBase.slice(5)];
  const blocos = [
    { antes: "", depois: "" },
    { antes: "if true; then\n", depois: "\nfi" },
    { antes: "while true; do\n", depois: "\nbreak; done" },
    { antes: "{\n", depois: "\n}" },
    { antes: "for x in a; do\n", depois: "\nbreak; done" },
    { antes: "until false; do\n", depois: "\nbreak; done" },
  ];
  return () => {
    const d = pick(delims);
    const minus = d.startsWith("-");
    const dd = minus ? d.slice(1) : d;
    const term = dd.replace(/['"\\]/g, "");
    const tab = minus && rnd(2) ? "\t" : "";
    const prefixo = pick(prefixos);
    const comando = pick(comandos);
    const descritor = pick(descritoresHeredoc);
    const operador = pick(ops);
    const bloco = pick(blocos);
    const argumentoReservado = rnd(4) === 0 ? `echo ${pick(palavrasReservadas)}\n` : "";
    let script = `${bloco.antes}${argumentoReservado}${prefixo.antes}${comando} ${descritor}<<${minus ? "-" : ""}${dd}${operador}\n`;
    const linhas = rnd(3) + 1;
    for (let i = 0; i < linhas; i++) script += tab + (rnd(5) === 0 ? `${corpo()}\\\n` : corpo()) + "\n";
    const dividirTerminador = !dd.includes("'") && !dd.includes('"') && !dd.includes("\\") && rnd(4) === 0;
    const terminador = dividirTerminador ? `${tab}${term.slice(0, -1)}\\\n${term.slice(-1)}` : `${tab}${term}`;
    const comentarioPosHeredoc = pick(["", "\n# <<'FALSO'\ntrue\nFALSO\n", "\n  # <<FALSO\ntrue\nFALSO\n"]);
    script += terminador + prefixo.depois + comentarioPosHeredoc + separador() + pick(consumidores) + bloco.depois;
    return script;
  };
}

test("Dado comandos de escrita em linhas separadas dentro de blocos Quando classifico Então a quebra continua separando comandos", async () => {
  const vault = mkdtempSync(join(tmpdir(), "anvilore-heredoc-blocos-"));
  mkdirSync(join(vault, "raw"));
  mkdirSync(join(vault, "wiki"));
  writeFileSync(join(vault, "SCHEMA.md"), "# Schema\n");
  writeFileSync(join(vault, "p"), "origem\n");
  const rawAtaques = [
    "if true; then echo if\ntouch raw/MARCA\nfi",
    "while true; do ls select;\nprintf '%s' for\necho do # then\ntouch raw/MARCA\nbreak; done",
  ];
  const wikiAtaques = [
    "if true; then echo if\ncp p wiki/MARCA.md\nfi",
    "if true; then\necho x in\ncp p wiki/MARCA.md\nfi",
    "{ echo {\ncp p wiki/MARCA.md\n}",
  ];
  const erroOriginal = console.error;
  console.error = () => {};
  try {
    for (const command of rawAtaques) {
      const payload = JSON.stringify({ cwd: vault, tool_name: "Bash", tool_input: { command } });
      expect({ command, raw: decidirRaw(payload).acao }).toEqual({ command, raw: "bloquear" });
    }
    for (const command of wikiAtaques) {
      const payload = JSON.stringify({ cwd: vault, tool_name: "Bash", tool_input: { command } });
      expect({ command, verified: (await decidirVerified(payload, vault)).acao }).toEqual({ command, verified: "bloquear" });
    }
  } finally {
    console.error = erroOriginal;
    rmSync(vault, { recursive: true, force: true });
  }
});

test.skipIf(!bashDisponivel)("Dado fuzz fixo de heredocs Quando comparo a execução no Bash com a proteção Então nenhum interpretador contorna o guarda", async () => {
  const vault = mkdtempSync(join(tmpdir(), "anvilore-heredoc-fuzz-"));
  mkdirSync(join(vault, "raw"));
  mkdirSync(join(vault, "wiki"));
  writeFileSync(join(vault, "SCHEMA.md"), "# Schema\n");
  writeFileSync(join(vault, "raw/a.md"), "bruto\n");
  writeFileSync(join(vault, "wiki/a.md"), "---\ntitle: A\n---\n");
  const furos: string[] = [];
  const erroOriginal = console.error;
  console.error = () => {};
  try {
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
      expect({ command, codigo }).toEqual({ command, codigo: 2 });
    }

    for (const mode of ["raw", "wiki"] as const) for (const seed of SEMENTES) {
      const carga = mode === "raw" ? CARGA_RAW : CARGA_WIKI;
      const gerar = gerador(seed, carga);
      for (let i = 0; i < N_POR_SEMENTE; i++) {
        const comando = gerar();
        const bashDir = mkdtempSync(join(tmpdir(), "anvilore-heredoc-fuzz-bash-"));
        mkdirSync(join(bashDir, "raw"));
        mkdirSync(join(bashDir, "wiki"));
        writeFileSync(join(bashDir, "p"), "origem\n");
        try {
          Bun.spawnSync(["bash", "-c", comando], {
            cwd: bashDir,
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
            timeout: 500,
          });
          const bashExecutou = mode === "raw"
            ? existsSync(join(bashDir, "raw/MARCA"))
            : existsSync(join(bashDir, "wiki/MARCA.md"));
          if (!bashExecutou) continue;
        } finally {
          rmSync(bashDir, { recursive: true, force: true });
        }

        const payload = JSON.stringify({
          cwd: vault,
          tool_name: "Bash",
          tool_input: { command: comando },
        });
        const protegido = mode === "raw"
          ? await executarProtecao(payload)
          : (await decidirVerified(payload, vault)).acao === "bloquear" ? 2 : 0;
        if (protegido !== 2) furos.push(`mode=${mode} seed=${seed} caso=${i} guarda=${protegido} comando=${JSON.stringify(comando)}`);
      }
    }
  } finally {
    console.error = erroOriginal;
    rmSync(vault, { recursive: true, force: true });
  }
  expect(furos).toEqual([]);
});
