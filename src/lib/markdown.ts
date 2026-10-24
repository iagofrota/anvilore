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

// Início do fecho de um código em linha: a próxima sequência de crases com exatamente `tamanho`
// crases (regra de code span do CommonMark). Sequências de outro comprimento são conteúdo.
function acharFecho(linha: string, de: number, tamanho: number): number {
  let i = de;
  while (i < linha.length) {
    if (linha[i] !== "`") {
      i++;
      continue;
    }
    let fim = i;
    while (linha[fim] === "`") fim++;
    if (fim - i === tamanho) return i;
    i = fim;
  }
  return -1;
}

// Tira os comentários HTML da linha lendo da esquerda para a direita, para que `<!--` dentro de código
// em linha não abra comentário. Só enxerga código em linha dentro de uma linha (é o subconjunto que o
// leitor cobre); o conteúdo do código é mantido, porque quem lê as menções entre crases precisa dele.
// Dentro de comentário não existe código em linha: o `-->` fecha mesmo entre crases.
function tirarComentarios(linha: string, emComentario: boolean): { texto: string; emComentario: boolean } {
  let i = 0;
  if (emComentario) {
    const fim = linha.indexOf("-->");
    if (fim === -1) return { texto: "", emComentario: true };
    i = fim + 3;
  }
  let texto = "";
  while (i < linha.length) {
    if (linha[i] === "`") {
      let fimDaSequencia = i;
      while (linha[fimDaSequencia] === "`") fimDaSequencia++;
      const tamanho = fimDaSequencia - i;
      const fecho = acharFecho(linha, fimDaSequencia, tamanho);
      // Sem fecho do mesmo comprimento, as crases são texto comum.
      const ate = fecho === -1 ? fimDaSequencia : fecho + tamanho;
      texto += linha.slice(i, ate);
      i = ate;
    } else if (linha.startsWith("<!--", i)) {
      const fim = linha.indexOf("-->", i + 4);
      if (fim === -1) return { texto, emComentario: true };
      i = fim + 3;
    } else {
      texto += linha[i];
      i++;
    }
  }
  return { texto, emComentario: false };
}

// Esvazia o que o Markdown não renderiza como texto (bloco de código cercado e
// comentário HTML), mantendo o número de linhas.
export function linhasVisiveis(linhas: string[]): string[] {
  let cerca: Cerca | null = null;
  let emComentario = false;
  return linhas.map((original) => {
    if (cerca !== null) {
      if (fechaCerca(original, cerca)) cerca = null;
      return "";
    }
    const limpa = tirarComentarios(original, emComentario);
    emComentario = limpa.emComentario;
    const aberta = abreCerca(limpa.texto);
    if (aberta !== null) {
      cerca = aberta;
      return "";
    }
    return limpa.texto;
  });
}
