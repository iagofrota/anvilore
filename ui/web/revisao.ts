export type LinhaDiferenca = { tipo: "igual" | "adicionada" | "removida"; texto: string };

export function indiceVizinho(indice: number, direcao: -1 | 1, tamanho: number): number {
  if (tamanho === 0) return -1;
  return Math.max(0, Math.min(tamanho - 1, indice + direcao));
}

export function diffLinhas(antes: string, depois: string): LinhaDiferenca[] {
  const a = antes.replaceAll("\r\n", "\n").split("\n");
  const b = depois.replaceAll("\r\n", "\n").split("\n");
  if (a.at(-1) === "") a.pop();
  if (b.at(-1) === "") b.pop();
  if (a.length * b.length > 1_000_000) return [...a.map(texto => ({ tipo: "removida" as const, texto })), ...b.map(texto => ({ tipo: "adicionada" as const, texto }))];
  const tabela = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    tabela[i]![j] = a[i] === b[j] ? tabela[i + 1]![j + 1]! + 1 : Math.max(tabela[i + 1]![j]!, tabela[i]![j + 1]!);
  }
  const linhas: LinhaDiferenca[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { linhas.push({ tipo: "igual", texto: a[i]! }); i++; j++; }
    else if (i < a.length && (j === b.length || tabela[i + 1]![j]! >= tabela[i]![j + 1]!)) { linhas.push({ tipo: "removida", texto: a[i++]! }); }
    else { linhas.push({ tipo: "adicionada", texto: b[j++]! }); }
  }
  return linhas;
}
