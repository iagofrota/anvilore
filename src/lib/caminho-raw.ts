// Metacaracteres recusados em caminhos relativos sob raw/ na rota de ingestão.
// Um glob ampliaria o alcance da leitura do agente, então qualquer metacaractere é recusado.
export const METACARACTERES_DE_RAW = /[*?[\]{}!\\]/;

export function caminhoTemMetacaracteres(caminho: string): boolean {
  return METACARACTERES_DE_RAW.test(caminho);
}
