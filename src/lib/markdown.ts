// Abertura de cerca (CommonMark): 3 ou mais crases ou tils. Numa cerca de crases o texto de
// informação não pode ter crase (senão é código em linha, não cerca).
const CERCA_DE_CRASES = /^\s*(`{3,})([^`]*)$/;
const CERCA_DE_TILS = /^\s*(~{3,}).*$/;

type Cerca = { caractere: string; tamanho: number };

function abreCerca(linha: string): Cerca | null {
  const marcador = CERCA_DE_CRASES.exec(linha) ?? CERCA_DE_TILS.exec(linha);
  if (marcador === null) return null;
  return { caractere: marcador[1]![0]!, tamanho: marcador[1]!.length };
}

// Fecha só com o mesmo caractere, comprimento igual ou maior e nada além de espaço depois.
function fechaCerca(linha: string, cerca: Cerca): boolean {
  const texto = linha.trim();
  return texto.length >= cerca.tamanho && [...texto].every((c) => c === cerca.caractere);
}

// Esvazia o que o Markdown não renderiza como texto (bloco de código cercado e
// comentário HTML), mantendo o número de linhas.
export function linhasVisiveis(linhas: string[]): string[] {
  let cerca: Cerca | null = null;
  let emComentario = false;
  return linhas.map((original) => {
    let linha = original;
    if (cerca !== null) {
      if (fechaCerca(linha, cerca)) cerca = null;
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
    const aberta = abreCerca(linha);
    if (aberta !== null) {
      cerca = aberta;
      return "";
    }
    return linha;
  });
}
