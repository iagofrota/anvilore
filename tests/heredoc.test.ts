import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test, expect, setDefaultTimeout } from "bun:test";
import { analisarHeredocs } from "../src/lib/heredoc";
import { executarProtecao } from "../src/comandos/hook-proteger-raw";

const heredoctsDisponiveis = process.platform !== "win32" && Bun.which("bash") !== null;
setDefaultTimeout(60_000);

function comandoDoBash(comando: string, pasta: string): void {
  Bun.spawnSync(["bash", "-c", comando], { cwd: pasta, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
}

async function executarProtecaoSemLog(payload: string): Promise<number> {
  const erroOriginal = console.error;
  console.error = () => {};
  try { return await executarProtecao(payload); }
  finally { console.error = erroOriginal; }
}

function variacoesNasQuebras(comando: string): string[] {
  const variantes = new Set<string>([comando]);
  for (let i = 0; i < comando.length; i++) {
    if (comando[i] !== "\n") continue;
    for (const insercao of ["\n", "# c\n", "  # c\n"]) {
      variantes.add(`${comando.slice(0, i + 1)}${insercao}${comando.slice(i + 1)}`);
    }
  }
  const comentarioNoOperador = comando.replace(/(\|&?)(\s*)\n/, "$1$2  # c\n");
  if (comentarioNoOperador !== comando) variantes.add(comentarioNoOperador);
  return [...variantes];
}

test.skipIf(!heredoctsDisponiveis)("Dado corpus gerado de heredocs Quando comparo com Bash Então só as linhas consumidas como corpo são classificadas como corpo", async () => {
  const casos: string[] = [];
  const cabecalhos = [
    "cat <<EOF", "cat <<-EOF", "cat \\<<EOF", "cat \\<\\<EOF", "cat <\\<EOF",
    'cat "<<" EOF', "cat '<<' EOF", "cat <<<EOF", "cat #<<EOF", "cat # <<EOF", "cat x#<<EOF",
  ];
  const terminadores = ["EOF", "EOF ", "\tEOF", "  EOF", "EO"];
  const sufixos = ["", " && cat", "; cat", " | cat"];
  for (const cabecalho of cabecalhos) for (const terminador of terminadores) for (const sufixo of sufixos) {
    casos.push(`${cabecalho}${sufixo}\ntouch raw/M0\n${terminador}\ntouch raw/M1\nEOF\ntouch raw/M2`);
  }
  const delimitadores = [
    { palavra: "'E\"O\"F'", linha: 'E"O"F' },
    { palavra: "E'O'F", linha: "EOF" },
    { palavra: "\\EOF", linha: "EOF" },
    { palavra: '"\\EOF"', linha: "\\EOF" },
    { palavra: "EOF''", linha: "EOF" },
    { palavra: "$'EOF'", linha: "EOF" },
    { palavra: "'E O F'", linha: "E O F" },
  ];
  for (const d of delimitadores) casos.push(`cat <<${d.palavra}\ntouch raw/M0\n${d.linha}\ntouch raw/M1`);
  casos.push("cat <<EOF\nEOF\ntouch raw/M0\nEOF\ntouch raw/M1");
  for (const total of [2, 3]) {
    const cabecalho = Array.from({ length: total }, (_, i) => `<<D${i}`).join(" ");
    const linhas: string[] = [`cat ${cabecalho}`];
    for (let i = 0; i < total; i++) linhas.push(`touch raw/M${i}`, `D${i}`);
    linhas.push(`touch raw/M${total}`);
    casos.push(linhas.join("\n"));
  }
  casos.push("cat <<-EOF\n\ttouch raw/M0\n\tEOF\ntouch raw/M1");
  casos.push("cat <<-EOF\n\ttouch raw/M0\n  EOF\nEOF\ntouch raw/M1");
  casos.push("cat <<EOF\nEOF\ntouch raw/M0");
  casos.push("echo \"$(cat <<'EOF'\ntouch raw/M0\nEOF\ntouch raw/M1\n)\"");
  casos.push("echo `cat <<'EOF'\ntouch raw/M0\nEOF\ntouch raw/M1\n`");
  casos.push("cat <<EOF\ntouch raw/M0");

  for (const comando of casos) {
    const pasta = mkdtempSync(join(tmpdir(), "anvilore-heredoc-diff-"));
    mkdirSync(join(pasta, "raw"));
    mkdirSync(join(pasta, "wiki"));
    writeFileSync(join(pasta, "SCHEMA.md"), "# Schema\n");
    writeFileSync(join(pasta, "raw/a.md"), "bruto\n");
    writeFileSync(join(pasta, "wiki/a.md"), "---\ntitle: A\n---\n");
    try {
      comandoDoBash(comando, pasta);
      let analise: ReturnType<typeof analisarHeredocs> | undefined;
      let erro: unknown;
      try { analise = analisarHeredocs(comando); } catch (e) { erro = e; }
      const marcadores = [...comando.matchAll(/M\d+/g)].map(match => ({ nome: match[0], inicio: comando.lastIndexOf("\n", match.index!) + 1 }));
      if (erro) {
        expect(String(comando)).toContain("EOF");
        for (const marcador of marcadores) expect(existsSync(join(pasta, "raw", marcador.nome))).toBe(false);
        continue;
      }
      for (const marcador of marcadores) {
        const bashExecutou = existsSync(join(pasta, "raw", marcador.nome));
        const analisadorDizCorpo = analise!.corpos.some(corpo => marcador.inicio >= corpo.inicioCorpo && marcador.inicio < corpo.fimCorpo);
        if (analisadorDizCorpo !== !bashExecutou) throw new Error(`Bash/analisador divergem; bashExecutou=${bashExecutou}, body=${analisadorDizCorpo}, linha=${marcador.nome}, comando=${JSON.stringify(comando)}`);
      }

      // Ponta a ponta: troca cada linha marcada que Bash executou, uma por vez, por cada
      // carga perigosa. As outras linhas marcadoras viram `true` para não mascararem o alvo.
      const linhas = comando.split("\n");
      for (const marcador of marcadores) {
        if (!existsSync(join(pasta, "raw", marcador.nome))) continue;
        const indiceLinha = comando.slice(0, marcador.inicio).split("\n").length - 1;
        for (const carga of ["cp p wiki/a.md", "rm raw/a.md"]) {
          const linhasDeAtaque = linhas.map(linha => linha.replace(/touch raw\/M\d+/g, "true"));
          linhasDeAtaque[indiceLinha] = linhas[indiceLinha]!.replace(/touch raw\/M\d+/, carga);
          const comandoDeAtaque = linhasDeAtaque.join("\n");
          const codigo = await executarProtecaoSemLog(JSON.stringify({ cwd: pasta, tool_name: "Bash", tool_input: { command: comandoDeAtaque } }));
          if (codigo !== 2) throw new Error(`Proteção não bloqueou carga executável: ${JSON.stringify({ comandoDeAtaque, carga, codigo })}`);
        }
      }
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  }

  // Bash confirma que uma substituição no corpo só executa quando o delimitador não tem aspas.
  for (const delimitador of ["EOF", "'EOF'", '"EOF"']) {
    for (const carga of ["cp p wiki/a.md", "rm raw/a.md"]) {
      const pasta = mkdtempSync(join(tmpdir(), "anvilore-heredoc-body-"));
      mkdirSync(join(pasta, "raw"));
      mkdirSync(join(pasta, "wiki"));
      writeFileSync(join(pasta, "SCHEMA.md"), "# Schema\n");
      writeFileSync(join(pasta, "raw/a.md"), "bruto\n");
      writeFileSync(join(pasta, "wiki/a.md"), "---\ntitle: A\n---\n");
      try {
        const marcador = join(pasta, "raw/M0");
        comandoDoBash(`cat <<${delimitador}\n$(touch raw/M0)\nEOF`, pasta);
        const bashExecutou = existsSync(marcador);
        const comando = `cat <<${delimitador}\n$(${carga})\nEOF`;
        const codigo = await executarProtecaoSemLog(JSON.stringify({ cwd: pasta, tool_name: "Bash", tool_input: { command: comando } }));
        expect({ delimitador, carga, bashExecutou, codigo }).toEqual({
          delimitador,
          carga,
          bashExecutou: delimitador === "EOF",
          codigo: delimitador === "EOF" ? 2 : 0,
        });
      } finally {
        rmSync(pasta, { recursive: true, force: true });
      }
    }
  }

  // Linhas de operador e comandos compostos podem continuar depois do terminador.
  // O Bash é o oráculo ponta a ponta: cargas que ele executa devem ser bloqueadas.
  const continuacoes = ["|", "| ", "|&", "&&", "||", "\\"];
  const consumidores = ["sh", "bash", "sh -s", "wc -l"];
  for (const cabecalho of [
    ...continuacoes.map(op => `${["|", "| ", "|&"].includes(op) ? "cat" : op === "||" ? "false" : "true"} <<'EOF' ${op}`),
    ...consumidores.map(() => `{ cat <<'EOF' |`),
  ]) for (const consumidor of consumidores) for (const carga of ["cp p wiki/a.md", "rm raw/a.md"]) {
    const emGrupo = cabecalho.startsWith("{");
    const operadorFinal = cabecalho.trimEnd();
    const pipeOuGrupo = cabecalho.startsWith("{") || (!operadorFinal.endsWith("||") && /\|&?$/.test(operadorFinal));
    const conteudoHeredoc = pipeOuGrupo ? carga : "mensagem";
    const scriptBase = `${cabecalho}\n${conteudoHeredoc}\nEOF\n${consumidor}${pipeOuGrupo ? "" : `\n${carga}`}${emGrupo ? "\n}" : ""}`;
    for (const script of variacoesNasQuebras(scriptBase)) {
    const pasta = mkdtempSync(join(tmpdir(), "anvilore-heredoc-pipe-"));
    mkdirSync(join(pasta, "raw"));
    mkdirSync(join(pasta, "wiki"));
    writeFileSync(join(pasta, "SCHEMA.md"), "# Schema\n");
    writeFileSync(join(pasta, "p"), "origem\n");
    writeFileSync(join(pasta, "raw/a.md"), "bruto\n");
    writeFileSync(join(pasta, "wiki/a.md"), "---\ntitle: A\n---\n");
    try {
      comandoDoBash(script, pasta);
      const bashExecutouCarga = carga.startsWith("cp")
        ? (await Bun.file(join(pasta, "wiki/a.md")).text()).startsWith("origem")
        : !existsSync(join(pasta, "raw/a.md"));
      const codigoEsperado = bashExecutouCarga ? 2 : 0;
      const codigo = await executarProtecaoSemLog(JSON.stringify({ cwd: pasta, tool_name: "Bash", tool_input: { command: script } }));
      if (codigo !== codigoEsperado) throw new Error(JSON.stringify({ cabecalho, consumidor, carga, bashExecutouCarga, codigo, codigoEsperado, script }));
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
    }
  }
});

test.skipIf(!heredoctsDisponiveis)("Dado continuações com linhas vazias e comentários Quando comparo com Bash Então o guardião acompanha o consumidor do pipe", async () => {
  const comandos = [
    ...["rm raw/a.md", "cp p wiki/a.md"].map(carga => `cat <<'EOF' |\n${carga}\nEOF\nsh`),
    `cat <<'EOF' |  # c\nrm raw/a.md\nEOF\nsh`,
    `cat <<'EOF' |\nrm raw/a.md\nEOF\nwc -l`,
  ];
  const variantes = [...new Set(comandos.flatMap(variacoesNasQuebras))];
  for (const comando of variantes) {
    const pastaBash = mkdtempSync(join(tmpdir(), "anvilore-heredoc-comment-bash-"));
    mkdirSync(join(pastaBash, "raw"));
    mkdirSync(join(pastaBash, "wiki"));
    writeFileSync(join(pastaBash, "SCHEMA.md"), "# Schema\n");
    writeFileSync(join(pastaBash, "p"), "origem\n");
    writeFileSync(join(pastaBash, "raw/a.md"), "bruto\n");
    writeFileSync(join(pastaBash, "wiki/a.md"), "---\ntitle: A\n---\n");
    try {
      comandoDoBash(comando, pastaBash);
      const bashExecutou = !existsSync(join(pastaBash, "raw/a.md"))
        || (await Bun.file(join(pastaBash, "wiki/a.md")).text()).startsWith("origem");

      const pastaGuarda = mkdtempSync(join(tmpdir(), "anvilore-heredoc-comment-guard-"));
      mkdirSync(join(pastaGuarda, "raw"));
      mkdirSync(join(pastaGuarda, "wiki"));
      writeFileSync(join(pastaGuarda, "SCHEMA.md"), "# Schema\n");
      writeFileSync(join(pastaGuarda, "p"), "origem\n");
      writeFileSync(join(pastaGuarda, "raw/a.md"), "bruto\n");
      writeFileSync(join(pastaGuarda, "wiki/a.md"), "---\ntitle: A\n---\n");
      try {
        const codigo = await executarProtecaoSemLog(JSON.stringify({ cwd: pastaGuarda, tool_name: "Bash", tool_input: { command: comando } }));
        expect({ comando, bashExecutou, codigo }).toEqual({ comando, bashExecutou, codigo: bashExecutou ? 2 : 0 });
      } finally {
        rmSync(pastaGuarda, { recursive: true, force: true });
      }
    } finally {
      rmSync(pastaBash, { recursive: true, force: true });
    }
  }
});
