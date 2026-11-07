const DELIMITADOR = "([A-Za-z_][A-Za-z0-9_]*)";
const OPACO = "__ANVILORE_MENSAGEM_HEREDOC__";

export type ResultadoGateHeredoc = { aceito: true; comando: string } | { aceito: false };

function terminadorFinal(comando: string, palavra: string, fechamentoB = false): boolean {
  const linhas = comando.split("\n");
  const ocorrencias = linhas.filter(linha => linha === palavra).length;
  if (ocorrencias !== 1) return false;
  const indiceTerminador = linhas.findIndex(linha => linha === palavra);
  if (linhas.some((linha, indice) => indice !== indiceTerminador && linha.startsWith(palavra))) return false;
  if (!fechamentoB) return linhas.at(-1) === palavra;
  return linhas.length >= 3
    && linhas.at(-2) === palavra
    && (linhas.at(-1) === ")\"" || linhas.at(-1) === ")");
}

function pathLiteral(path: string): boolean {
  let literal = path;
  const aspas = path[0];
  if ((aspas === "'" || aspas === '"') && path.at(-1) === aspas) literal = path.slice(1, -1);
  else if (/\s|['"]/.test(path)) return false;
  return literal.length > 0 && !/['"]/.test(literal) && !/[\r\n\0$`*?\[\]~\\<>|&;(){}#]/.test(literal);
}

/**
 * Positive allowlist for terminal heredocs. Returns a normalized command for the
 * existing terminal analyzers, or a deny result. Commands without `<<` pass through.
 */
export function avaliarGateHeredoc(comando: string): ResultadoGateHeredoc {
  if (!comando.includes("<<")) return { aceito: true, comando };
  if (/[\r\0]/.test(comando) || (comando.match(/<</g)?.length ?? 0) !== 1) return { aceito: false };

  const quebra = comando.indexOf("\n");
  if (quebra < 0) return { aceito: false };
  const cabecalho = comando.slice(0, quebra);

  const a = new RegExp(`^git commit(?:[ \\t]+[A-Za-z0-9_./:=+-]+)*[ \\t]+(?:-F[ \\t]+-|--file=-|--file[ \\t]+-)[ \\t]+<<(['\"])(?:${DELIMITADOR})\\1$`).exec(cabecalho);
  if (a) {
    const palavra = a[2]!;
    if (!terminadorFinal(comando, palavra)) return { aceito: false };
    return { aceito: true, comando: cabecalho.slice(0, cabecalho.lastIndexOf("<<")).trimEnd() };
  }

  const b = new RegExp(`^((?:git commit|git tag|gh pr (?:create|comment|edit|review)|gh issue (?:create|comment|edit))(?:[ \\t]+[A-Za-z0-9_./:=+-]+)*[ \\t]+)\"\\$\\(cat <<'${DELIMITADOR}'$`).exec(cabecalho);
  if (b) {
    const palavra = b[2]!;
    if (!terminadorFinal(comando, palavra, true)) return { aceito: false };
    return { aceito: true, comando: `${b[1]}\"${OPACO}\"` };
  }

  const catHeredocPrimeiro = new RegExp(`^cat[ \\t]+<<'${DELIMITADOR}'[ \\t]+(>>?)[ \\t]+(.+)$`).exec(cabecalho);
  if (catHeredocPrimeiro && pathLiteral(catHeredocPrimeiro[3]!) && terminadorFinal(comando, catHeredocPrimeiro[1]!)) {
    return { aceito: true, comando: `cat ${catHeredocPrimeiro[2]} ${catHeredocPrimeiro[3]}` };
  }

  const catDestinoPrimeiro = new RegExp(`^cat[ \\t]+>[ \\t]+(.+)[ \\t]+<<'${DELIMITADOR}'$`).exec(cabecalho);
  if (catDestinoPrimeiro && pathLiteral(catDestinoPrimeiro[1]!) && terminadorFinal(comando, catDestinoPrimeiro[2]!)) {
    return { aceito: true, comando: `cat > ${catDestinoPrimeiro[1]}` };
  }

  const tee = new RegExp(`^tee(?:[ \\t]+-a)?[ \\t]+(.+)[ \\t]+<<'${DELIMITADOR}'$`).exec(cabecalho);
  if (tee && pathLiteral(tee[1]!) && terminadorFinal(comando, tee[2]!)) {
    return { aceito: true, comando: cabecalho.slice(0, cabecalho.lastIndexOf("<<")).trimEnd() };
  }

  return { aceito: false };
}
