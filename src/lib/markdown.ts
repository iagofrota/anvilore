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

export type CodigoEmLinha = { inicio: number; fim: number; conteudo: string };

// Fim do parágrafo que contém `de`: a primeira linha em branco depois dele (ou o fim do texto).
function fimDoParagrafo(texto: string, de: number): number {
  const linhaEmBranco = /\n[ \t]*\n/g;
  linhaEmBranco.lastIndex = de;
  return linhaEmBranco.exec(texto)?.index ?? texto.length;
}

// Único reconhecedor de código em linha (regra de code span do CommonMark): em `i` há uma crase; uma
// sequência de N crases abre um span que fecha na próxima sequência de exatamente N, dentro do mesmo
// parágrafo (pode atravessar linhas, não uma linha em branco). Sequências de outro comprimento são
// conteúdo. Sem fecho, as N crases são texto comum (`codigo` nulo) e `fim` é o fim da sequência.
function lerCrases(texto: string, i: number): { fim: number; codigo: CodigoEmLinha | null } {
  let fimDaSequencia = i;
  while (texto[fimDaSequencia] === "`") fimDaSequencia++;
  const tamanho = fimDaSequencia - i;
  const limite = fimDoParagrafo(texto, fimDaSequencia);
  let j = fimDaSequencia;
  while (j < limite) {
    if (texto[j] !== "`") {
      j++;
      continue;
    }
    let fim = j;
    while (texto[fim] === "`") fim++;
    if (fim - j === tamanho) {
      return { fim, codigo: { inicio: i, fim, conteudo: texto.slice(fimDaSequencia, j) } };
    }
    j = fim;
  }
  return { fim: fimDaSequencia, codigo: null };
}

// Todos os códigos em linha do texto, na ordem. Uma barra escapa o caractere seguinte (crase escapada é
// texto); dentro de um span a barra é literal.
export function acharCodigosEmLinha(texto: string): CodigoEmLinha[] {
  const achados: CodigoEmLinha[] = [];
  let i = 0;
  while (i < texto.length) {
    if (texto[i] === "\\") {
      i += 2;
    } else if (texto[i] === "`") {
      const lido = lerCrases(texto, i);
      if (lido.codigo !== null) achados.push(lido.codigo);
      i = lido.fim;
    } else {
      i++;
    }
  }
  return achados;
}

// O texto com cada código em linha trocado por espaços (as quebras de linha ficam), o que preserva
// os índices e as linhas.
export function mascararCodigoEmLinha(texto: string): string {
  let saida = "";
  let ate = 0;
  for (const { inicio, fim } of acharCodigosEmLinha(texto)) {
    saida += texto.slice(ate, inicio) + texto.slice(inicio, fim).replace(/[^\n]/g, " ");
    ate = fim;
  }
  return saida + texto.slice(ate);
}

// Fim (exclusivo) do comentário HTML que abre em `i`: `<!-->` e `<!--->` já são comentários completos
// (CommonMark 0.31); senão fecha no próximo `-->`. -1 se não fecha na linha.
function fimDoComentario(linha: string, i: number): number {
  if (linha.startsWith(">", i + 4)) return i + 5;
  if (linha.startsWith("->", i + 4)) return i + 6;
  const fim = linha.indexOf("-->", i + 4);
  return fim === -1 ? -1 : fim + 3;
}

// Tira os comentários HTML da linha lendo da esquerda para a direita, para que `<!--` dentro de código
// em linha não abra comentário. Aqui o código em linha só é visto dentro da linha (o comentário é
// removido linha a linha); o conteúdo do código é mantido, porque quem lê as menções entre crases
// precisa dele. Dentro de comentário não existe código em linha: o `-->` fecha mesmo entre crases.
function tirarComentarios(linha: string, emComentario: boolean): { texto: string; emComentario: boolean } {
  let i = 0;
  if (emComentario) {
    const fim = linha.indexOf("-->");
    if (fim === -1) return { texto: "", emComentario: true };
    i = fim + 3;
  }
  let texto = "";
  while (i < linha.length) {
    if (linha[i] === "\\") {
      texto += linha.slice(i, i + 2);
      i += 2;
    } else if (linha[i] === "`") {
      const { fim } = lerCrases(linha, i);
      texto += linha.slice(i, fim);
      i = fim;
    } else if (linha.startsWith("<!--", i)) {
      const fim = fimDoComentario(linha, i);
      if (fim === -1) return { texto, emComentario: true };
      i = fim;
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
    // A linha de abertura de cerca não é HTML: o `<!--` no texto de informação não abre comentário.
    const abertura = emComentario ? null : abreCerca(original);
    if (abertura !== null) {
      cerca = abertura;
      return "";
    }
    const limpa = tirarComentarios(original, emComentario);
    emComentario = limpa.emComentario;
    const aberta = abreCerca(limpa.texto);
    if (aberta !== null) {
      cerca = aberta;
      // O `<!--` que sobrou no texto de informação desta linha não abre comentário.
      emComentario = false;
      return "";
    }
    return limpa.texto;
  });
}
