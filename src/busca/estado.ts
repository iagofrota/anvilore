import { lerFrontmatter } from "../lib/frontmatter";
import { ehMapa, estadoAprovacaoHumana, validarProveniencia } from "../lib/okf";

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
  const fm = frontmatter ?? {};
  const proveniencia = validarProveniencia(fm, arquivo, raiz, agora);
  let estado: Estado;
  if (fm.generated === undefined) {
    estado = "manual";
  } else if (!ehMapa(fm.generated)) {
    estado = "rascunho";
  } else {
    estado = estadoAprovacaoHumana(fm) === "vigente" ? "verificada" : "rascunho";
  }
  return { estado, vencida: proveniencia.vencida, frontmatter };
}
