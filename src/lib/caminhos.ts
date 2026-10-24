export function normalizarFimDeLinha(texto: string): string {
  return texto.replaceAll("\r\n", "\n");
}

// Minúsculas e NFC: o macOS grava nomes decompostos e os discos do macOS e do
// Windows não diferenciam caixa, então slug e nome de arquivo se comparam por aqui.
export function chaveDeNome(nome: string): string {
  return nome.toLowerCase().normalize("NFC");
}

// O hook falha fechado, então o componente é normalizado como o disco faria:
// separa por / \ e : (unidade `C:raw`, fluxo `raw:x`), tira pontos e espaços do
// fim (o Win32 abre `raw.` e `raw ` como `raw`) e ignora a caixa (macOS e Windows).
export function estaEmRaw(alvo: string): boolean {
  return alvo
    .split(/[\\/:]/)
    .some((componente) => componente.replace(/[. ]+$/, "").toLowerCase() === "raw");
}
