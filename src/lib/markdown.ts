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
  const limite = linhaEmBranco.exec(texto)?.index ?? texto.length;
  let inicio = texto.indexOf("\n", de);
  while (inicio !== -1 && inicio < limite) {
    const fim = texto.indexOf("\n", inicio + 1);
    const linha = texto.slice(inicio + 1, fim === -1 ? texto.length : fim);
    if (abreCerca(linha) !== null || /^ {0,3}<!--/.test(linha)) return inicio;
    inicio = fim;
  }
  return limite;
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

const PONTUACAO = /[!-/:-@[-`{-~]/;
const ESCAPE = /\\([!-/:-@[-`{-~])/g;
type Destino = { alvo: string; fim: number };
export type LinkMarkdown = Destino & { inicio: number };

function pularEspacos(texto: string, i: number, limite: number): number {
  while (i < limite && /[ \t\n]/.test(texto[i]!)) i++;
  return i;
}

function lerDestino(texto: string, i: number, limite: number): Destino | null {
  const angular = texto[i] === "<";
  const inicio = angular ? ++i : i;
  let profundidade = 0;
  while (i < limite) {
    const c = texto[i]!;
    if (c === "\\" && i + 1 < limite && PONTUACAO.test(texto[i + 1]!)) {
      i += 2;
      continue;
    }
    if (angular && c === ">") return { alvo: texto.slice(inicio, i).replace(ESCAPE, "$1"), fim: i + 1 };
    if (c === "<" || (angular && c === "\n")) return null;
    if (!angular) {
      if (/[\x00-\x20\x7f]/.test(c) || (c === ")" && profundidade === 0)) break;
      if (c === "(") profundidade++;
      if (c === ")") profundidade--;
    }
    i++;
  }
  if (angular || profundidade !== 0) return null;
  return { alvo: texto.slice(inicio, i).replace(ESCAPE, "$1"), fim: i };
}

function lerTitulo(texto: string, i: number, limite: number): number | null {
  const abertura = texto[i];
  if (abertura !== '"' && abertura !== "'" && abertura !== "(") return null;
  const fecho = abertura === "(" ? ")" : abertura;
  for (i++; i < limite; i++) {
    if (texto[i] === "\\" && i + 1 < limite && PONTUACAO.test(texto[i + 1]!)) i++;
    else if (texto[i] === fecho) return i + 1;
    else if (abertura === "(" && texto[i] === "(") return null;
  }
  return null;
}

function lerLinkInline(texto: string, i: number, limite: number): Destino | null {
  if (texto[i] !== "(") return null;
  i = pularEspacos(texto, i + 1, limite);
  const destino = lerDestino(texto, i, limite);
  if (destino === null) return null;
  i = pularEspacos(texto, destino.fim, limite);
  if (i > destino.fim && texto[i] !== ")") {
    const fim = lerTitulo(texto, i, limite);
    if (fim === null) return null;
    i = pularEspacos(texto, fim, limite);
  }
  return texto[i] === ")" && i < limite ? { alvo: destino.alvo, fim: i + 1 } : null;
}

// Pilha de colchetes: colchetes literais podem aninhar; um link interno desativa
// o link externo, enquanto uma imagem pode fazer parte do texto de outro link.
export function acharLinks(texto: string): LinkMarkdown[] {
  const links: LinkMarkdown[] = [];
  const abertos: { inicio: number; imagem: boolean; ativo: boolean }[] = [];
  let i = 0;
  let limite = fimDoParagrafo(texto, 0);
  while (i < texto.length) {
    if (i >= limite) {
      abertos.length = 0;
      limite = fimDoParagrafo(texto, i + 1);
    }
    if (texto[i] === "\\" && PONTUACAO.test(texto[i + 1] ?? "")) i += 2;
    else if (texto[i] === "`") i = lerCrases(texto, i).fim;
    else if (texto[i] === "[") {
      abertos.push({ inicio: i, imagem: texto[i - 1] === "!" && (i < 2 || texto[i - 2] !== "\\"), ativo: true });
      i++;
    } else if (texto[i] === "]") {
      const aberto = abertos.pop();
      const destino = aberto?.ativo ? lerLinkInline(texto, i + 1, limite) : null;
      if (destino !== null) {
        links.push({ inicio: aberto!.inicio, ...destino });
        if (!aberto!.imagem) for (const anterior of abertos) if (!anterior.imagem) anterior.ativo = false;
        i = destino.fim;
      } else i++;
    } else i++;
  }
  return links;
}

// Fim (exclusivo) do comentário HTML que abre em `i`: `<!-->` e `<!--->` já são comentários completos
// (CommonMark 0.31); senão fecha no próximo `-->`. -1 se não fecha na linha.
function fimDoComentario(linha: string, i: number): number {
  if (linha.startsWith(">", i + 4)) return i + 5;
  if (linha.startsWith("->", i + 4)) return i + 6;
  const fim = linha.indexOf("-->", i + 4);
  return fim === -1 ? -1 : fim + 3;
}

// Esvazia o que o Markdown não renderiza como texto (bloco de código cercado e
// comentário HTML), mantendo o número de linhas.
export function linhasVisiveis(linhas: string[]): string[] {
  const completo = linhas.join("\n");
  let cerca: Cerca | null = null;
  let comentarioAte = 0;
  let codigoAte = 0;
  let posicao = 0;
  return linhas.map((original) => {
    const inicio = posicao;
    posicao += original.length + 1;
    if (cerca !== null) {
      if (fechaCerca(original, cerca)) cerca = null;
      return "";
    }
    const abertura = comentarioAte > inicio || codigoAte > inicio ? null : abreCerca(original);
    if (abertura !== null) {
      cerca = abertura;
      return "";
    }
    let texto = "";
    let i = inicio;
    const limite = inicio + original.length;
    while (i < limite) {
      if (i < comentarioAte) {
        i = Math.min(comentarioAte, limite);
      } else if (i < codigoAte) {
        const fim = Math.min(codigoAte, limite);
        texto += completo.slice(i, fim);
        i = fim;
      } else if (completo[i] === "\\") {
        texto += completo.slice(i, Math.min(i + 2, limite));
        i += 2;
      } else if (completo[i] === "`") {
        codigoAte = lerCrases(completo, i).fim;
      } else if (completo.startsWith("<!--", i)) {
        const fim = fimDoComentario(completo, i);
        // Só um comentário em início de linha pode consumir a página sem fecho.
        const bloco = /^ {0,3}$/.test(completo.slice(inicio, i));
        if (fim !== -1 || bloco) {
          comentarioAte = fim === -1 ? completo.length : fim;
        } else {
          texto += completo[i++];
        }
      } else {
        texto += completo[i++];
      }
    }
    return texto;
  });
}
