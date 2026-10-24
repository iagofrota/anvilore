export function normalizarFimDeLinha(texto: string): string {
  return texto.replaceAll("\r\n", "\n");
}

// Minúsculas e NFC: o macOS grava nomes decompostos e os discos do macOS e do
// Windows não diferenciam caixa, então slug e nome de arquivo se comparam por aqui.
export function chaveDeNome(nome: string): string {
  return nome.toLowerCase().normalize("NFC");
}

// `raw` entra sem diferenciar caixa e aceita / e \ como separador, porque o hook
// falha fechado: em disco que não diferencia caixa, Raw/ é o mesmo raw/.
export function estaEmRaw(alvo: string): boolean {
  return alvo.split(/[\\/]/).some((componente) => componente.toLowerCase() === "raw");
}
