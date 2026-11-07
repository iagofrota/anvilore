export type CorpoHeredoc = {
  delimitador: string;
  citado: boolean;
  tabs: boolean;
  texto: string;
  inicioCorpo: number;
  fimCorpo: number;
  inicioOperador: number;
  fimDelimitador: number;
  inicioTermino: number;
  fimTermino: number;
  continuaDepois: boolean;
};

export type ResultadoHeredocs = { original: string; semCorpos: string; corpos: CorpoHeredoc[] };

type Pendente = { inicioOperador: number; fimDelimitador: number; delimitador: string; citado: boolean; tabs: boolean };

function decodificarAnsi(entrada: string): string {
  let saida = "";
  for (let i = 0; i < entrada.length; i++) {
    const c = entrada[i]!;
    if (c !== "\\") { saida += c; continue; }
    const prox = entrada[++i];
    if (prox === undefined) throw new Error("escape incompleto em delimitador ANSI-C");
    const simples: Record<string, string> = { a: "\x07", b: "\b", e: "\x1b", E: "\x1b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\", "'": "'", '"': '"', "?": "?" };
    if (prox in simples) { saida += simples[prox]!; continue; }
    if (prox === "x") {
      let hex = "";
      while (hex.length < 2 && /[0-9a-f]/i.test(entrada[i + 1] ?? "")) hex += entrada[++i]!;
      if (!hex) throw new Error("escape hexadecimal inválido em delimitador ANSI-C");
      saida += String.fromCharCode(parseInt(hex, 16));
      continue;
    }
    if (/[0-7]/.test(prox)) {
      let octal = prox;
      while (octal.length < 3 && /[0-7]/.test(entrada[i + 1] ?? "")) octal += entrada[++i]!;
      saida += String.fromCharCode(parseInt(octal, 8));
      continue;
    }
    throw new Error("escape ANSI-C não reconhecido no delimitador");
  }
  return saida;
}

function lerDelimitador(comando: string, inicio: number): { delimitador: string; citado: boolean; fim: number } {
  let i = inicio;
  while (comando[i] === " " || comando[i] === "\t") i++;
  let delimitador = "";
  let citado = false;
  let parte = false;
  let aspas: "'" | '"' | null = null;
  let ansi = false;
  let ansiInicio = 0;
  while (i < comando.length) {
    const c = comando[i]!;
    if (ansi) {
      if (c === "'" && comando[i - 1] !== "\\") {
        delimitador += decodificarAnsi(comando.slice(ansiInicio, i));
        ansi = false;
        parte = true;
        i++;
      } else i++;
      continue;
    }
    if (aspas === "'") {
      if (c === "'") aspas = null;
      else delimitador += c;
      i++;
      continue;
    }
    if (aspas === '"') {
      if (c === '"') { aspas = null; i++; continue; }
      if (c === "\\" && i + 1 < comando.length) {
        citado = true;
        const seguinte = comando[i + 1]!;
        if (/[\\"$`\n]/.test(seguinte)) { if (seguinte !== "\n") delimitador += seguinte; i += 2; }
        else { delimitador += c; i++; }
        continue;
      }
      delimitador += c;
      i++;
      continue;
    }
    if (c === "\\") {
      if (i + 1 >= comando.length || comando[i + 1] === "\n") throw new Error("delimitador heredoc com escape incompleto");
      citado = true;
      delimitador += comando[i + 1]!;
      parte = true;
      i += 2;
      continue;
    }
    if (c === "$" && comando[i + 1] === "'") {
      citado = true;
      ansi = true;
      ansiInicio = i + 2;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"') { aspas = c; citado = true; parte = true; i++; continue; }
    if (/\s/.test(c) || c === ";" || c === "|" || c === "&" || c === "<" || c === ">" || c === "(" || c === ")") break;
    delimitador += c;
    parte = true;
    i++;
  }
  if (aspas || ansi) throw new Error("delimitador heredoc com aspas sem fechar");
  if (!parte || !delimitador) throw new Error("delimitador heredoc vazio ou ilegível");
  if (delimitador.includes("$") || delimitador.includes("`") || delimitador.includes("(")) throw new Error("delimitador heredoc contém expansão não interpretável");
  return { delimitador, citado, fim: i };
}

function igualLinha(linha: string, delimitador: string, tabs: boolean): boolean {
  let inicio = 0;
  if (tabs) while (linha[inicio] === "\t") inicio++;
  const conteudo = linha.slice(inicio);
  const comparar = conteudo.endsWith("\r") ? conteudo.slice(0, -1) : conteudo;
  return comparar === delimitador;
}

export function analisarHeredocs(comando: string): ResultadoHeredocs {
  const corpos: CorpoHeredoc[] = [];
  const pendentes: Pendente[] = [];
  const mudancas: Array<{ inicio: number; fim: number; texto: string }> = [];
  let aspas: "'" | '"' | "ansi" | null = null;
  let palavraIniciada = false;
  const contextos: Array<{ tipo: "parenteses" | "crase"; profundidade: number; aspasPai: "'" | '"' | "ansi" | null; palavraPai: boolean }> = [];
  let i = 0;
  while (i < comando.length) {
    const c = comando[i]!;
    const prox = comando[i + 1] ?? "";
    if (aspas === "ansi") {
      if (c === "\\") i += 2;
      else { if (c === "'") aspas = null; i++; }
      continue;
    }
    if (aspas === "'") { if (c === "'") aspas = null; i++; continue; }
    if (aspas === '"') {
      if (c === "\\") i += Math.min(2, comando.length - i);
      else if (c === "$" && prox === "(") {
        contextos.push({ tipo: "parenteses", profundidade: 1, aspasPai: aspas, palavraPai: palavraIniciada });
        aspas = null; palavraIniciada = true; i += 2;
      } else if (c === "`") {
        contextos.push({ tipo: "crase", profundidade: 0, aspasPai: aspas, palavraPai: palavraIniciada });
        aspas = null; palavraIniciada = true; i++;
      }
      else { if (c === '"') aspas = null; i++; }
      continue;
    }
    const contexto = contextos.at(-1);
    if (contexto?.tipo === "crase" && c === "`") {
      contextos.pop(); aspas = contexto.aspasPai; palavraIniciada = contexto.palavraPai; i++; continue;
    }
    if (contexto?.tipo === "parenteses") {
      if (c === "(") contexto.profundidade++;
      else if (c === ")") {
        contexto.profundidade--;
        if (contexto.profundidade === 0) { contextos.pop(); aspas = contexto.aspasPai; palavraIniciada = contexto.palavraPai; i++; continue; }
      }
    }
    if (c === "\\") {
      if (prox === "\n") { i += 2; continue; }
      if (prox) { i += 2; palavraIniciada = true; continue; }
      i++;
      continue;
    }
    if (c === "$" && prox === "'") { aspas = "ansi"; i += 2; palavraIniciada = true; continue; }
    if (c === "$" && prox === "(") {
      contextos.push({ tipo: "parenteses", profundidade: 1, aspasPai: aspas, palavraPai: palavraIniciada });
      palavraIniciada = true; i += 2; continue;
    }
    if ((c === "<" || c === ">") && prox === "(") {
      contextos.push({ tipo: "parenteses", profundidade: 1, aspasPai: aspas, palavraPai: palavraIniciada });
      palavraIniciada = true; i += 2; continue;
    }
    if (c === "`") {
      contextos.push({ tipo: "crase", profundidade: 0, aspasPai: aspas, palavraPai: palavraIniciada });
      palavraIniciada = true; i++; continue;
    }
    if (c === "'" || c === '"') { aspas = c; i++; palavraIniciada = true; continue; }
    if (c === "#" && !palavraIniciada) {
      while (i < comando.length && comando[i] !== "\n") i++;
      continue;
    }
    if (c === "<" && prox === "<" && comando[i - 1] !== "<" && comando[i + 2] !== "<") {
      const inicioOperador = i;
      let j = i + 2;
      let tabs = false;
      if (comando[j] === "-") { tabs = true; j++; }
      const token = lerDelimitador(comando, j);
      if (token.fim <= j) throw new Error("delimitador heredoc vazio ou ilegível");
      pendentes.push({ inicioOperador, fimDelimitador: token.fim, delimitador: token.delimitador, citado: token.citado, tabs });
      mudancas.push({ inicio: inicioOperador, fim: token.fim, texto: "< /dev/null" });
      i = token.fim;
      palavraIniciada = true;
      continue;
    }
    if (c === "\n") {
      if (pendentes.length) {
        let cursor = i + 1;
        for (const pendente of pendentes.splice(0)) {
          const inicioCorpo = cursor;
          let inicioTermino = -1;
          let fimTermino = -1;
          while (cursor <= comando.length) {
            const fimLinhaOriginal = comando.indexOf("\n", cursor);
            const fimLinha = fimLinhaOriginal < 0 ? comando.length : fimLinhaOriginal;
            const linha = comando.slice(cursor, fimLinha);
            if (igualLinha(linha, pendente.delimitador, pendente.tabs)) {
              inicioTermino = cursor;
              fimTermino = fimLinha;
              cursor = fimLinhaOriginal < 0 ? comando.length : fimLinhaOriginal + 1;
              break;
            }
            if (fimLinhaOriginal < 0) break;
            cursor = fimLinhaOriginal + 1;
          }
          if (inicioTermino < 0) throw new Error("heredoc sem terminador");
          const inicioLinhaOperador = comando.lastIndexOf("\n", pendente.inicioOperador - 1) + 1;
          const fimLinhaOperador = comando.indexOf("\n", pendente.inicioOperador);
          const textoLinhaOperador = comando.slice(inicioLinhaOperador, fimLinhaOperador < 0 ? comando.length : fimLinhaOperador);
          corpos.push({
            delimitador: pendente.delimitador,
            citado: pendente.citado,
            tabs: pendente.tabs,
            texto: comando.slice(inicioCorpo, inicioTermino),
            inicioCorpo,
            fimCorpo: inicioTermino,
            inicioOperador: pendente.inicioOperador,
            fimDelimitador: pendente.fimDelimitador,
            inicioTermino,
            fimTermino,
            continuaDepois: /\\\s*$/.test(textoLinhaOperador),
          });
          // Preserve the newline after the terminator; a marker backslash keeps an escaped
          // continuation visible to the downstream shell command parsers.
          mudancas.push({ inicio: inicioCorpo, fim: inicioTermino, texto: "" });
          mudancas.push({ inicio: inicioTermino, fim: fimTermino, texto: corpos.at(-1)!.continuaDepois ? "\\" : "" });
        }
        i = cursor;
        palavraIniciada = true;
        continue;
      }
      palavraIniciada = false;
      i++;
      continue;
    }
    if (/\s/.test(c)) { palavraIniciada = false; i++; continue; }
    if (c === ";" || c === "|" || c === "&" || c === ">" || c === "(" || c === ")") { palavraIniciada = false; i++; continue; }
    palavraIniciada = true;
    i++;
  }
  if (aspas) throw new Error("aspas sem fechamento ao analisar heredoc");
  if (contextos.length) throw new Error("substituição sem fechamento ao analisar heredoc");
  if (pendentes.length) throw new Error("heredoc sem quebra de linha ou terminador");
  let semCorpos = comando;
  for (const mudanca of mudancas.sort((a, b) => b.inicio - a.inicio)) {
    semCorpos = semCorpos.slice(0, mudanca.inicio) + mudanca.texto + semCorpos.slice(mudanca.fim);
  }
  return { original: comando, semCorpos, corpos };
}

export function textoHeredocParaAnalise(analise: ResultadoHeredocs, manterCorpo: (corpo: CorpoHeredoc) => boolean = () => false): string {
  const mudancas: Array<{ inicio: number; fim: number; texto: string }> = [];
  for (const corpo of analise.corpos) {
    mudancas.push({ inicio: corpo.inicioOperador, fim: corpo.fimDelimitador, texto: "< /dev/null" });
    if (!manterCorpo(corpo)) mudancas.push({ inicio: corpo.inicioCorpo, fim: corpo.fimCorpo, texto: "" });
    // Keep the line break after the terminator marked for the shell command parser.
    mudancas.push({ inicio: corpo.inicioTermino, fim: corpo.fimTermino, texto: corpo.continuaDepois ? "\\" : "" });
  }
  let texto = analise.original;
  for (const mudanca of mudancas.sort((a, b) => b.inicio - a.inicio)) {
    texto = texto.slice(0, mudanca.inicio) + mudanca.texto + texto.slice(mudanca.fim);
  }
  return texto;
}
