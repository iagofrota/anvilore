import { STOPWORDS_PT } from "./stopwords";

export type Consulta = { match: string | null; termos: string[]; explicita: boolean; palavras: number };

const PALAVRA = /[\p{L}\p{N}]+/gu;
const OPERADOR = /(?:^|\s)(?:AND|OR|NOT|NEAR)(?=\s|\(|$)/;

function citar(termo: string): string {
  return `"${termo.replaceAll('"', '""')}"`;
}

function candidataLivre(termos: string[]): string {
  const expressoes: string[] = [];
  for (const termo of termos) {
    const comprimento = [...termo].length;
    expressoes.push(`${citar(termo)}${comprimento >= 4 ? "*" : ""}`);
    if (comprimento >= 5 && termo.toLocaleLowerCase("pt-BR").endsWith("s")) {
      expressoes.push(`${citar(termo.slice(0, -1))}*`);
    }
  }
  return expressoes.join(" OR ");
}

function sacoDePalavras(termos: string[]): string {
  return termos.map(citar).join(" OR ");
}

export function montarConsulta(texto: string, valida: (match: string) => boolean): Consulta {
  const normalizado = texto.normalize("NFC");
  const palavras = normalizado.match(PALAVRA) ?? [];
  const explicita = normalizado.includes('"') || OPERADOR.test(normalizado);
  const semStopwords = palavras.filter((termo) => !STOPWORDS_PT.has(termo.toLocaleLowerCase("pt-BR")));
  const termos = (semStopwords.length > 0 ? semStopwords : palavras).filter((termo, i, todos) => todos.indexOf(termo) === i);
  if (termos.length === 0) return { match: null, termos: [], explicita, palavras: palavras.length };

  const candidata = explicita ? normalizado.trim() : candidataLivre(termos);
  try {
    if (valida(candidata)) return { match: candidata, termos, explicita, palavras: palavras.length };
  } catch {
    // Texto de busca é dado do usuário; uma rejeição do parser FTS cai no modo literal.
  }
  const fallback = sacoDePalavras(termos);
  try {
    return { match: valida(fallback) ? fallback : fallback, termos, explicita, palavras: palavras.length };
  } catch {
    return { match: fallback, termos, explicita, palavras: palavras.length };
  }
}
