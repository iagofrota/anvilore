import { lerFrontmatter } from "../lib/frontmatter";
import { validarProveniencia } from "../lib/okf";

export type Estado = "manual" | "verificada" | "rascunho";

export function estadoDaPagina(
  conteudo: string,
  arquivo: string,
  raiz: string,
  agora: Date = new Date(),
): { estado: Estado; vencida: boolean; frontmatter: Record<string, unknown> | null } {
  let frontmatter: Record<string, unknown> | null;
  try {
    frontmatter = lerFrontmatter(conteudo);
  } catch {
    return { estado: "rascunho", vencida: false, frontmatter: null };
  }
  const proveniencia = validarProveniencia(frontmatter ?? {}, arquivo, raiz, agora);
  const estado = proveniencia.aprovadaPorHumano === null
    ? "manual"
    : proveniencia.aprovadaPorHumano
      ? "verificada"
      : "rascunho";
  return { estado, vencida: proveniencia.vencida, frontmatter };
}
