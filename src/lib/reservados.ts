// Dono único dos diretórios reservados: infra da wiki (índices gerados em _meta,
// log fatiado por dia), não páginas temáticas.
const reservados: ReadonlySet<string> = new Set(["_meta", "log"]);

// Dono único dos diretórios de tipo do layout plano das skills
// (wiki/sources, wiki/concepts, wiki/entities). Sob uma área, esses nomes são o
// segundo segmento do caminho.
const diretoriosDeTipo: ReadonlySet<string> = new Set(["sources", "concepts", "entities"]);

export function nomeReservado(nome: string): boolean {
  return reservados.has(nome);
}

export function diretorioDeTipo(nome: string): boolean {
  return diretoriosDeTipo.has(nome);
}
