import { statSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { nomeReservado } from "../lib/reservados";
import { comandoIndexarLog } from "./indexar-log";
import { comandoSincronizarIndice } from "./sincronizar-indice";
import { comandoValidar } from "./validar";

// Ritual de fechamento de uma sessão na wiki: roda tudo numa chamada e cobra o que não é derivável.
//
// Passos, nesta ordem; PARA no primeiro que falha. Parar não é economia: é não deixar o passo seguinte
// reescrever um arquivo derivado a partir de um estado que já se sabe errado.
//   1. sincronizar-indice   contagem do header a partir do disco
//   2. indexar-log          reconstrói <WIKI>/log.md
//   3. validar-wiki         validação estrutural
//   4. gate do log do dia   página curada alterada hoje exige entrada no log
//
// O gate usa a data de modificação (mtime), não o git: no anvilore o conteúdo de `wiki/` fica fora do git
// de propósito, então `git status` nunca veria uma página curada mudar. Conta a página `.md` modificada
// depois da meia-noite local de hoje; ignora o que o próprio ritual deriva (`index.md`, `log.md`) e os
// diretórios reservados de topo (`_meta/`, `log/`). `ANVILORE_PULAR_GATE_LOG=1` pula só o gate.

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

async function gateDoLog(wiki: string, agora: Date): Promise<boolean> {
  if (process.env.ANVILORE_PULAR_GATE_LOG === "1") {
    console.log("gate pulado por ANVILORE_PULAR_GATE_LOG=1");
    console.log("FECHAMENTO: OK");
    return true;
  }
  const hoje = dataLocal(agora);
  const meiaNoite = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();
  const tocadas = await curadasTocadas(wiki, meiaNoite);
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
    return 2;
  }
  return (await fecharWiki(args[0] || "wiki")).ok ? 0 : 1;
}

// Este módulo é obra derivada de `wiki-wonka`
// (https://github.com/cooperacode/wiki-wonka) (Coopera Code, licença MIT),
// traduzido para português do Brasil e adaptado. Aviso de copyright original
// em `LICENSE`.
