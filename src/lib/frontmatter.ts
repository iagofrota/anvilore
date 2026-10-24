import { basename } from "node:path";
import { normalizarFimDeLinha } from "./caminhos";

export class FrontmatterInvalido extends Error {
  override name = "FrontmatterInvalido";
  arquivo?: string;

  constructor(mensagem: string, opcoes: { arquivo?: string; cause?: unknown } = {}) {
    super(mensagem, opcoes.cause === undefined ? undefined : { cause: opcoes.cause });
    if (opcoes.arquivo !== undefined) this.arquivo = opcoes.arquivo;
  }
}

const DELIMITADOR = "---";

// Tira o BOM UTF-8 inicial (readFileSync "utf8" o mantém) e normaliza CRLF.
export function linhasDe(conteudo: string): string[] {
  const semBom = conteudo.startsWith("\uFEFF") ? conteudo.slice(1) : conteudo;
  return normalizarFimDeLinha(semBom).split("\n");
}

// Valor de `campo: valor` dentro do frontmatter; "" se ausente. Casa o prefixo
// literal `campo: ` (como o awk antigo) e lê até o segundo --- ou o fim do arquivo.
export function extrairCampo(conteudo: string, campo: string): string {
  const linhas = linhasDe(conteudo);
  if (linhas[0] !== DELIMITADOR) return "";
  const prefixo = `${campo}: `;
  for (const linha of linhas.slice(1)) {
    if (linha === DELIMITADOR) break;
    if (linha.startsWith(prefixo)) return linha.slice(prefixo.length);
  }
  return "";
}

export function temFrontmatter(conteudo: string): boolean {
  return linhasDe(conteudo)[0] === DELIMITADOR;
}

export function slugDe(caminho: string): string {
  return basename(caminho, ".md");
}

// null se não há frontmatter; FrontmatterInvalido se ele existe e não é um mapa YAML válido.
export function lerFrontmatter(conteudo: string): Record<string, unknown> | null {
  const linhas = linhasDe(conteudo);
  if (linhas[0] !== DELIMITADOR) return null;
  const fim = linhas.indexOf(DELIMITADOR, 1);
  if (fim === -1) throw new FrontmatterInvalido("frontmatter sem o --- de fechamento");

  let valor: unknown;
  try {
    valor = Bun.YAML.parse(linhas.slice(1, fim).join("\n"));
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    throw new FrontmatterInvalido(`YAML do frontmatter inválido: ${motivo}`, { cause: erro });
  }
  if (valor === null || valor === undefined) return {};
  if (typeof valor !== "object" || Array.isArray(valor)) {
    throw new FrontmatterInvalido("o frontmatter deve ser um mapa de campos");
  }
  return valor as Record<string, unknown>;
}
