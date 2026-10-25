export function fundirBloco(texto: string, marcador: string, conteudo: string, comentario: string): { resultado: string; veredito: "INALTERADO" | "MUDOU" } {
  const abertura = `${comentario} <<< ${marcador}`, fechamento = `${comentario} >>> ${marcador}`;
  const bloco = `${abertura}\n${conteudo.replace(/\n+$/, "")}\n${fechamento}\n`;
  const linhas = texto.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const inicio = linhas.findIndex(linha => linha.trim() === abertura);
  const fim = inicio < 0 ? -1 : linhas.findIndex((linha, i) => i > inicio && linha.trim() === fechamento);
  const resultado = fim >= 0
    ? linhas.slice(0, inicio).join("") + bloco + linhas.slice(fim + 1).join("")
    : texto + (texto && !texto.endsWith("\n") ? "\n" : "") + (texto ? "\n" : "") + bloco;
  return { resultado, veredito: resultado === texto ? "INALTERADO" : "MUDOU" };
}
