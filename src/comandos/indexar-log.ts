import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type ResultadoIndexarLog = { escreveu: boolean; saida: string };

async function arquivosDeDia(wiki: string): Promise<string[]> {
  try {
    const entradas = await readdir(join(wiki, "log"), { withFileTypes: true });
    return entradas
      .filter((entrada) => entrada.isFile() && /^log-.*\.md$/.test(entrada.name))
      .map((entrada) => entrada.name)
      .sort()
      .reverse();
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw erro;
  }
}

function resumoDoDia(conteudo: string): { total: number; resumo: string } {
  const contagens = new Map<string, number>();
  let total = 0;
  let emCerca = false;
  for (const linha of conteudo.split(/\r?\n/)) {
    if (linha.startsWith("```")) {
      emCerca = !emCerca;
      continue;
    }
    if (emCerca || !linha.startsWith("## [")) continue;
    total++;
    const tipo = linha
      .replace(/^## \[[0-9-]+\] /, "")
      .replace(/ *\|.*$/, "")
      .trim();
    contagens.set(tipo, (contagens.get(tipo) ?? 0) + 1);
  }
  const tipos = [...contagens].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const resumo = `${total}${tipos.length ? ` · ${tipos.map(([tipo, n]) => `${tipo} ×${n}`).join(", ")}` : ""}`;
  return { total, resumo };
}

export async function indexarLog(wiki: string, opcoes: { stdout?: boolean } = {}): Promise<ResultadoIndexarLog> {
  const arquivos = await arquivosDeDia(wiki);
  if (arquivos.length === 0) {
    return {
      escreveu: false,
      saida: `LOG: nada a indexar — ${join(wiki, "log")} sem arquivo log-*.md; ${join(wiki, "log.md")} preservado`,
    };
  }

  const dias = await Promise.all(
    arquivos.map(async (arquivo) => {
      const data = arquivo.slice(4, -3);
      const { total, resumo } = resumoDoDia(await readFile(join(wiki, "log", arquivo), "utf8"));
      return { data, mes: data.slice(0, 7), total, resumo };
    }),
  );
  const total = dias.reduce((soma, dia) => soma + dia.total, 0);
  const linhas = [
    "---",
    "type: log-index",
    "---",
    "",
    "# Log",
    "",
    `_${total} entradas em ${dias.length} dias. Gerado por \`bun src/cli.ts indexar-log\` — não edite à mão._`,
  ];
  let mesAtual = "";
  for (const dia of dias) {
    if (dia.mes !== mesAtual) {
      mesAtual = dia.mes;
      const totalDoMes = dias.filter((item) => item.mes === mesAtual).reduce((soma, item) => soma + item.total, 0);
      linhas.push("", `## ${mesAtual} — ${totalDoMes} entradas`);
    }
    linhas.push(`- [[log-${dia.data}]] — ${dia.resumo}`);
  }
  const conteudo = `${linhas.join("\n")}\n`;
  if (opcoes.stdout) return { escreveu: false, saida: conteudo };
  await writeFile(join(wiki, "log.md"), conteudo);
  return { escreveu: true, saida: `LOG: ${total} entradas em ${dias.length} dias → ${join(wiki, "log.md")}` };
}

export async function comandoIndexarLog(args: string[]): Promise<number> {
  let wiki = "wiki";
  let stdout = false;
  for (const arg of args) {
    if (arg === "--stdout") stdout = true;
    else if (arg.startsWith("-")) {
      console.error(`FAIL: flag desconhecida: ${arg}`);
      return 1;
    } else wiki = arg;
  }
  try {
    const resultado = await indexarLog(wiki, { stdout });
    console.log(resultado.saida.trimEnd());
    return 0;
  } catch (erro) {
    const falha = erro as NodeJS.ErrnoException;
    if (falha.code === "ENOTDIR" && falha.syscall === "scandir") {
      console.error(`AVISO: ${join(wiki, "log")} não é diretório`);
      console.log(`LOG: nada a indexar — ${join(wiki, "log")} sem arquivo log-*.md; ${join(wiki, "log.md")} preservado`);
      return 0;
    }
    const caminho = falha.path ?? wiki;
    console.error(`FAIL: ${caminho}: ${falha.message}`);
    return 1;
  }
}

// Obra derivada de wiki-wonka (https://github.com/cooperacode/wiki-wonka),
// Coopera Code, licença MIT. Aviso de copyright original em LICENSE.
