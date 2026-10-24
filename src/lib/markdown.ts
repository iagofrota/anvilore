const CERCA = /^\s*(```|~~~)/;

// Esvazia o que o Markdown não renderiza como texto (bloco de código cercado e
// comentário HTML), mantendo o número de linhas.
export function linhasVisiveis(linhas: string[]): string[] {
  let cerca: string | null = null;
  let emComentario = false;
  return linhas.map((original) => {
    let linha = original;
    if (cerca !== null) {
      if (linha.trim().startsWith(cerca)) cerca = null;
      return "";
    }
    if (emComentario) {
      const fim = linha.indexOf("-->");
      if (fim === -1) return "";
      emComentario = false;
      linha = linha.slice(fim + 3);
    }
    linha = linha.replace(/<!--.*?-->/g, "");
    const abertura = linha.indexOf("<!--");
    if (abertura !== -1) {
      emComentario = true;
      linha = linha.slice(0, abertura);
    }
    const marcador = CERCA.exec(linha);
    if (marcador !== null) {
      cerca = marcador[1]!;
      return "";
    }
    return linha;
  });
}
