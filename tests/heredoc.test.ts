import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test, expect } from "bun:test";
import { analisarHeredocs } from "../src/lib/heredoc";

const heredoctsDisponiveis = process.platform !== "win32" && Bun.which("bash") !== null;

function comandoDoBash(comando: string, pasta: string): void {
  Bun.spawnSync(["bash", "-c", comando], { cwd: pasta, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
}

test.skipIf(!heredoctsDisponiveis)("Dado corpus gerado de heredocs Quando comparo com Bash Então só as linhas consumidas como corpo são classificadas como corpo", () => {
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
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  }
});
