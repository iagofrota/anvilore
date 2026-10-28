export const CONTEUDO_ATUALIZADO = [
  "---", "type: concept", "slug: segundo-cerebro", "title: Segundo cérebro", "tags: [teste]",
  "generated:", "  by: claude-haiku-4-5/2.1.311", "  at: 2026-01-02T00:00:00Z",
  "verified:", "  - by: human:teste", "    at: 2026-01-01T00:00:00Z", "---", "", "Versão revisada pelo escritor.", "",
].join("\n");

export const CONTEUDO_FONTE_WIKI = [
  "---", "type: source", "slug: llm-wiki", "title: LLM Wiki", "tags: [teste]",
  "generated:", "  by: claude-haiku-4-5/2.1.311", "  at: 2026-01-02T00:00:00Z", "---", "", "Fonte incorporada como rascunho.", "",
].join("\n");

export const CONTEUDO_LINK_QUEBRADO = [
  "---", "type: concept", "slug: problema", "title: Problema", "tags: [teste]",
  "generated:", "  by: claude-haiku-4-5/2.1.311", "  at: 2026-01-02T00:00:00Z", "---", "", "[[destino-ausente]]", "",
].join("\n");

export function paginaGerada(slug: string, corpo = `Conteúdo de ${slug}.`, extras = ""): string {
  return [
    "---", "type: concept", `slug: ${slug}`, `title: ${slug}`,
    "generated:", "  by: claude-haiku-4-5/2.1.311", "  at: 2026-01-02T00:00:00Z", extras.trimEnd(), "---", "", corpo, "",
  ].filter(Boolean).join("\n");
}

export function paginaAtualizada(slug: string, corpo = `Conteúdo atualizado de ${slug}.`): string {
  return paginaGerada(slug, corpo, "verified:\n  - by: human:teste\n    at: 2026-01-01T00:00:00Z");
}

export function paginaInvalida(slug: string): string {
  return `---\ntype: concept\nslug: ${slug}\ntitle: Inválida\ngenerated: ontem\n---\nConteúdo inválido.\n`;
}
