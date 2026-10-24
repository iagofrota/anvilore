import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizarFimDeLinha } from "../lib/caminhos";

// Fatia `<WIKI>/log.md` em um arquivo por dia sob `<WIKI>/log/`.
//
// Migração one-shot: não apaga nem sobrescreve nada. Se algum arquivo de destino já existir, aborta
// antes de escrever o primeiro. O critério de idempotência é a RECUSA, não a saída repetida.
//
// O preâmbulo anterior à primeira entrada (título e prosa do `log.md` que vem no clone) é tolerado, mas
// relatado em voz alta com a contagem de linhas: conteúdo que não vai para lugar nenhum não sai de cena
// calado. O cabeçalho do `log.md` é regenerado por `scripts/indexar-log.sh` depois da migração.

export class ErroDeFatiamento extends Error {}

export type ResultadoDoFatiamento = {
  arquivosCriados: string[];
  linhasDePreambulo: number;
  entradas: number;
};

type Entrada = { data: string; header: string; corpo: string[] };

const HEADER_NOVO = /^## \[(\d{4}-\d{2}-\d{2})\] .+$/;
const HEADER_ANTIGO = /^## (\d{4}-\d{2}-\d{2}) — (.+)$/;

// Dentro de um bloco ``` uma linha `## ` é conteúdo, não header. Header em formato antigo
// (`## DATA — Título`) vira `## [DATA] note | Título`: `note` porque essas entradas não declaram tipo.
function fatiar(texto: string): { entradas: Entrada[]; linhasDePreambulo: number } {
  const entradas: Entrada[] = [];
  let dentroDeFence = false;
  let linhasDePreambulo = 0;
  normalizarFimDeLinha(texto)
    .split("\n")
    .forEach((linha, indice) => {
      if (linha.startsWith("```")) {
        dentroDeFence = !dentroDeFence;
      } else if (!dentroDeFence && linha.startsWith("## ")) {
        const antigo = HEADER_ANTIGO.exec(linha);
        if (HEADER_NOVO.test(linha)) {
          entradas.push({ data: linha.slice(4, 14), header: linha, corpo: [] });
          return;
        }
        if (antigo !== null) {
          entradas.push({ data: antigo[1]!, header: `## [${antigo[1]}] note | ${antigo[2]}`, corpo: [] });
          return;
        }
        throw new ErroDeFatiamento(`header sem data parseável na linha ${indice + 1}: ${linha}`);
      }
      const atual = entradas.at(-1);
      if (atual === undefined) {
        if (linha.trim() !== "") linhasDePreambulo += 1;
      } else {
        atual.corpo.push(linha);
      }
    });
  return { entradas, linhasDePreambulo };
}

// Corpo preservado linha a linha, sem sobra em branco no fim de cada entrada.
function renderizar(data: string, entradas: Entrada[]): string {
  const blocos = entradas.map(({ header, corpo }) => {
    const aparado = [...corpo];
    while (aparado.length > 0 && aparado.at(-1)!.trim() === "") aparado.pop();
    return [header, ...aparado].join("\n");
  });
  return `---\ntype: log-day\ndate: ${data}\n---\n\n# Log — ${data}\n\n${blocos.join("\n\n")}\n`;
}

function ehArquivo(caminho: string): boolean {
  try {
    return statSync(caminho).isFile();
  } catch {
    return false;
  }
}

export async function fatiarLog(wiki: string): Promise<ResultadoDoFatiamento> {
  const origem = join(wiki, "log.md");
  if (!ehArquivo(origem)) throw new ErroDeFatiamento(`${origem} não existe`);

  const { entradas, linhasDePreambulo } = fatiar(await readFile(origem, "utf8"));
  if (entradas.length === 0) throw new ErroDeFatiamento(`nenhuma entrada encontrada em ${origem}`);

  const porData = new Map<string, Entrada[]>();
  for (const entrada of entradas) {
    const grupo = porData.get(entrada.data) ?? [];
    grupo.push(entrada);
    porData.set(entrada.data, grupo);
  }

  const pastaDestino = join(wiki, "log");
  const destinos = new Map([...porData.keys()].map((data) => [data, join(pastaDestino, `log-${data}.md`)]));
  const existentes = [...destinos.values()].filter((destino) => existsSync(destino)).sort();
  if (existentes.length > 0) {
    throw new ErroDeFatiamento(
      `destino já existe, nada foi escrito (migração one-shot): ${existentes.join(", ")}`,
    );
  }

  try {
    await mkdir(pastaDestino, { recursive: true });
  } catch (erro) {
    throw new ErroDeFatiamento(`não foi possível criar ${pastaDestino}: ${(erro as Error).message}`);
  }
  for (const [data, destino] of destinos) {
    // `wx`: nunca sobrescreve, nem se o arquivo aparecer entre a checagem e a escrita.
    await writeFile(destino, renderizar(data, porData.get(data)!), { encoding: "utf8", flag: "wx" });
  }

  return { arquivosCriados: [...destinos.values()], linhasDePreambulo, entradas: entradas.length };
}

export async function comandoFatiarLog(args: string[]): Promise<number> {
  if (args[0] === "--help") {
    console.error("Uso: anvilore fatiar-log [WIKI]");
    return 2;
  }
  const wiki = args[0] ?? "wiki";
  try {
    const { arquivosCriados, linhasDePreambulo, entradas } = await fatiarLog(wiki);
    console.log(`OK: ${entradas} entradas → ${arquivosCriados.length} arquivos em ${join(wiki, "log")}`);
    if (linhasDePreambulo > 0) {
      console.log(
        `AVISO: ${linhasDePreambulo} linha(s) de preâmbulo antes da primeira entrada não foram para nenhum ` +
          `arquivo de dia. ${join(wiki, "log.md")} continua intacto; o cabeçalho de log.md é regenerado por ` +
          "scripts/indexar-log.sh.",
      );
    }
    return 0;
  } catch (erro) {
    if (!(erro instanceof ErroDeFatiamento)) throw erro;
    console.error(`ERRO: ${erro.message}`);
    return 1;
  }
}

// Este módulo é obra derivada de `wiki-wonka`
// (https://github.com/cooperacode/wiki-wonka) (Coopera Code, licença MIT),
// traduzido para português do Brasil e adaptado. Aviso de copyright original
// em `LICENSE`.
