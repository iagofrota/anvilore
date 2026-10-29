import { statSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { nomeReservado } from "../lib/reservados";
import { comandoIndexarLog } from "./indexar-log";
import { comandoSincronizarIndice } from "./sincronizar-indice";
import { comandoValidar } from "./validar";
import { PASTA_MODELOS, origemNoModelo } from "../lib/modelos";

// Ritual de fechamento de uma sessão na wiki: roda tudo numa chamada e cobra o que não é derivável.
//
// Passos, nesta ordem; PARA no primeiro que falha. Parar não é economia: é não deixar o passo seguinte
// reescrever um arquivo derivado a partir de um estado que já se sabe errado.
//   1. sincronizar-indice   contagem do header a partir do disco
//   2. indexar-log          reconstrói <WIKI>/log.md
//   3. validar-wiki         validação estrutural
//   4. gate do log do dia   página curada alterada hoje exige entrada no log
//
// O gate usa mtime para o conteúdo ignorado pelo git, mas dispensa arquivos rastreados iguais ao HEAD:
// o checkout do esqueleto tem mtime de hoje sem ser uma edição; o mesmo vale para o arquivo byte a byte igual ao
// original em `modelos/`. Sem Git/HEAD, vale só o mtime.
// Ignora derivados (`index.md`, `log.md`) e diretórios reservados de topo (`_meta/`, `log/`).
// `ANVILORE_PULAR_GATE_LOG=1` pula só o gate.

export type ResultadoDoFechamento = { ok: boolean; passo: string };

// Symlink de arquivo é seguido com stat e, quebrado, avisa; symlink de diretório não é descido, mas avisa.
const LINK_QUEBRADO = new Set(["ENOENT", "ELOOP", "ENOTDIR"]);

function dataLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ehDiretorio(caminho: string): boolean {
  try {
    return statSync(caminho).isDirectory();
  } catch {
    return false;
  }
}

async function ehArquivo(caminho: string): Promise<boolean> {
  try {
    return (await stat(caminho)).isFile();
  } catch {
    return false;
  }
}

// Páginas curadas tocadas depois de `desde`, relativas à wiki e em ordem.
async function curadasTocadas(wiki: string, desde: number): Promise<string[]> {
  const tocadas: string[] = [];
  async function visitar(dir: string, topo: boolean): Promise<void> {
    for (const entrada of await readdir(dir, { withFileTypes: true })) {
      if (topo && nomeReservado(entrada.name)) continue;
      const caminho = join(dir, entrada.name);
      let alvo: { isDirectory(): boolean; isFile(): boolean; mtimeMs?: number } = entrada;
      if (entrada.isSymbolicLink()) {
        try {
          alvo = await stat(caminho);
        } catch (erro) {
          if (!LINK_QUEBRADO.has((erro as NodeJS.ErrnoException).code ?? "")) throw erro;
          console.error(`AVISO: symlink quebrado: ${caminho}`);
          continue;
        }
        if (alvo.isDirectory()) {
          console.error(`AVISO: symlink de diretório não seguido: ${caminho}`);
          continue;
        }
      }
      if (alvo.isDirectory()) {
        await visitar(caminho, false);
      } else if (alvo.isFile() && entrada.name.endsWith(".md") && entrada.name !== "index.md" && entrada.name !== "log.md") {
        if ((alvo.mtimeMs ?? (await stat(caminho)).mtimeMs) > desde) tocadas.push(relative(wiki, caminho));
      }
    }
  }
  await visitar(wiki, true);
  return tocadas.sort();
}

async function versionadasSemAlteracao(wiki: string): Promise<Set<string>> {
  const lerGit = async (...args: string[]): Promise<string | null> => {
    try {
      const processo = Bun.spawn(["git", "--no-optional-locks", "-C", wiki, ...args], { stdout: "pipe", stderr: "ignore" });
      const [saida, codigo] = await Promise.all([new Response(processo.stdout).text(), processo.exited]);
      return codigo === 0 ? saida : null;
    } catch {
      return null;
    }
  };
  const rastreadas = await lerGit("ls-files", "--stage", "-z", "--", ".");
  if (!rastreadas) return new Set();
  const alteradas = await lerGit("diff", "--no-ext-diff", "--no-textconv", "--relative", "--name-only", "-z", "HEAD", "--", ".");
  if (alteradas === null) return new Set();
  const mudaram = new Set(alteradas.split("\0"));
  const limpas = new Set<string>();
  for (const registro of rastreadas.split("\0")) {
    // Symlink não prova que o conteúdo do alvo está intacto; ele continua sujeito ao mtime do alvo.
    const arquivo = /^100(?:644|755) [a-f0-9]+ 0\t([\s\S]+)$/.exec(registro)?.[1];
    if (arquivo !== undefined && !mudaram.has(arquivo)) limpas.add(arquivo);
  }
  return limpas;
}

// O kit não rastreia mais a wiki: o esqueleto que o `instalar` copiou hoje de `modelos/` tem mtime de hoje sem ser uma
// edição. Byte a byte igual ao original, não conta.
async function igualAoModelo(wiki: string, rel: string): Promise<boolean> {
  const origem = origemNoModelo(`wiki/${rel}`);
  if (origem === undefined) return false;
  try {
    return Buffer.from(await readFile(join(wiki, rel))).equals(Buffer.from(await readFile(join(PASTA_MODELOS, origem))));
  } catch {
    return false;
  }
}

async function gateDoLog(wiki: string, agora: Date): Promise<boolean> {
  if (process.env.ANVILORE_PULAR_GATE_LOG === "1") {
    console.log("gate pulado por ANVILORE_PULAR_GATE_LOG=1");
    console.log("FECHAMENTO: OK");
    return true;
  }
  const hoje = dataLocal(agora);
  const meiaNoite = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();
  const recentes = await curadasTocadas(wiki, meiaNoite);
  const limpas = recentes.length ? await versionadasSemAlteracao(wiki) : new Set<string>();
  const tocadas: string[] = [];
  for (const caminho of recentes) {
    const rel = caminho.split(sep).join("/");
    if (!limpas.has(rel) && !(await igualAoModelo(wiki, rel))) tocadas.push(caminho);
  }
  if (tocadas.length === 0) {
    console.log("nenhuma pagina curada alterada hoje — nada a cobrar");
    console.log("FECHAMENTO: OK");
    return true;
  }
  const logDoDia = join(wiki, "log", `log-${hoje}.md`);
  if ((await ehArquivo(logDoDia)) && new RegExp(`^## \\[${hoje}\\]`, "m").test(await readFile(logDoDia, "utf8"))) {
    console.log(`log do dia presente: ${logDoDia}`);
    console.log("FECHAMENTO: OK");
    return true;
  }
  console.log(`FAIL: paginas curadas alteradas hoje sem entrada em log/log-${hoje}.md:`);
  for (const rel of tocadas) console.log(`  - ${rel}`);
  console.log("");
  console.log(`Escreva a entrada no formato '## [${hoje}] <tipo> | <o que mudou>' e rode de novo.`);
  console.log("(ou ANVILORE_PULAR_GATE_LOG=1 para pular conscientemente)");
  console.log("FECHAMENTO: FAIL");
  return false;
}

export async function fecharWiki(wiki: string, opcoes: { agora?: Date } = {}): Promise<ResultadoDoFechamento> {
  if (!ehDiretorio(wiki)) {
    console.log(`FECHAMENTO: FAIL — raiz da wiki nao encontrada: ${wiki}`);
    return { ok: false, passo: "raiz-da-wiki" };
  }
  // Absoluto: os passos seguintes não dependem do diretório de quem chamou.
  const raiz = resolve(wiki);
  const passos: [string, () => Promise<number>][] = [
    ["sincronizar-indice", () => comandoSincronizarIndice([raiz])],
    ["indexar-log", () => comandoIndexarLog([raiz])],
    ["validar-wiki", () => comandoValidar([raiz])],
  ];
  for (const [indice, [nome, rodar]] of passos.entries()) {
    console.log("");
    console.log(`── ${indice + 1}/4 ${nome} ──`);
    let codigo: number;
    try {
      codigo = await rodar();
    } catch (erro) {
      console.error(`FAIL: ${(erro as Error).message}`);
      codigo = 1;
    }
    if (codigo !== 0) {
      console.log(`FECHAMENTO: FAIL no passo ${nome}`);
      return { ok: false, passo: nome };
    }
  }

  console.log("");
  console.log("── 4/4 gate do log do dia ──");
  try {
    return { ok: await gateDoLog(raiz, opcoes.agora ?? new Date()), passo: "gate-do-log" };
  } catch (erro) {
    console.error(`FAIL: ${(erro as Error).message}`);
    console.log("FECHAMENTO: FAIL no passo gate-do-log");
    return { ok: false, passo: "gate-do-log" };
  }
}

export async function comandoFechar(args: string[]): Promise<number> {
  if (args[0] === "--help" || args[0] === "-h") {
    console.error("Uso: anvilore fechar [WIKI]");
    return 0;
  }
  return (await fecharWiki(args[0] || "wiki")).ok ? 0 : 1;
}

// Este módulo é obra derivada de `wiki-wonka`
// (https://github.com/cooperacode/wiki-wonka) (Coopera Code, licença MIT),
// traduzido para português do Brasil e adaptado. Aviso de copyright original
// em `LICENSE`.
