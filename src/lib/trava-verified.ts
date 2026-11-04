import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { dentroDe } from "./caminhos";
import { caminhoWiki } from "./wiki-repo";

export type Decisao = { acao: "liberar" | "bloquear"; motivo: string };
type Json = Record<string, unknown>;
type Token = { texto: string; operador: boolean };

const TERMINAIS = new Set([
  "bash", "exec_command", "shell_command", "shell", "local_shell", "run_shell_command", "powershell", "pwsh", "run_in_terminal",
]);

const LEITURAS_TERMINAL = new Set([
  "cat", "rg", "grep", "ls", "head", "tail", "wc", "echo", "printf", "pwd", "stat", "file", "diff",
  "cut", "du", "sha256sum", "md5sum", "shasum", "basename", "dirname", "realpath", "readlink",
  "nl", "tac", "od", "strings", "test", "[", "true", "false", "pdfinfo",
  "get-content", "gc", "type", "dir", "get-childitem", "gci", "select-string", "sls", "get-item", "gi", "get-filehash",
]);

const GIT_LEITURA = new Set([
  "log", "show", "diff", "status", "blame", "grep", "ls-files", "ls-tree", "rev-parse", "cat-file", "describe", "shortlog",
  "reflog", "rev-list",
]);

const ENVOLVEDORES = new Set([
  "busybox", "xargs", "parallel", "env", "nice", "nohup", "time", "sudo", "doas", "command", "builtin", "exec", "timeout", "stdbuf", "ionice", "setsid",
]);

const CMDLETS_ESCRITA_PS = new Set([
  "set-content", "sc", "add-content", "ac", "out-file", "export-csv", "export-clixml", "set-item", "new-item", "ni",
]);

function mapa(valor: unknown): valor is Json {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor);
}

export function blocoVerified(texto: string): string {
  const linhas = texto.split(/\r?\n/);
  const inicioFrontmatter = linhas[0] === "---" ? 1 : 0;
  const fimFrontmatter = linhas.indexOf("---", inicioFrontmatter);
  const limite = fimFrontmatter < 0 ? linhas.length : fimFrontmatter;
  const inicio = linhas.findIndex((linha, i) => i < limite && /^\s*verified\s*:/i.test(linha));
  if (inicio < 0) {
    return linhas.flatMap((linha, i) => /^\s*-?\s*by\s*:\s*human:/i.test(linha)
      ? [linha.trim(), ...(linhas[i + 1] && /^\s+at\s*:/.test(linhas[i + 1]!) ? [linhas[i + 1]!.trim()] : [])]
      : []).join("\n");
  }
  let fim = inicio + 1;
  while (fim < limite && !/^[A-Za-z_][\w-]*\s*:/.test(linhas[fim]!)) fim++;
  return linhas.slice(inicio, fim).map(linha => linha.trim()).join("\n");
}

export function mudouBloco(anterior: string, novo: string): boolean {
  return blocoVerified(anterior) !== blocoVerified(novo);
}

function tokenizar(comando: string, windows = false): Token[] {
  const tokens: Token[] = [];
  let palavra = "", aspas = "";
  function guardar() {
    if (palavra) tokens.push({ texto: palavra, operador: false });
    palavra = "";
  }
  for (let i = 0; i < comando.length; i++) {
    const caractere = comando[i]!;
    const seguinte = comando[i + 1] ?? "";
    if (aspas) {
      if (caractere === aspas) {
        aspas = "";
      } else if (!windows && aspas === '"' && caractere === "\\" && /["\\$`]/.test(seguinte) && seguinte) {
        palavra += comando[++i];
      } else if (aspas === '"' && (caractere === "`" || (caractere === "$" && /[({]/.test(seguinte) && seguinte))) {
        throw new Error("subshell ou expansão não interpretável");
      } else {
        palavra += caractere;
      }
    } else if (caractere === "'" || caractere === '"') {
      aspas = caractere;
    } else if (!windows && caractere === "\\" && seguinte && /[\s'";|&<>\\]/.test(seguinte)) {
      palavra += comando[++i];
    } else if (caractere === "`" || caractere === "(" || caractere === ")" || (caractere === "$" && /[({]/.test(seguinte) && seguinte)) {
      throw new Error("subshell ou expansão não interpretável");
    } else if (/[;|&<>\n]/.test(caractere)) {
      guardar();
      const operador = caractere === "\n" ? ";" : caractere + (seguinte === caractere ? comando[++i] : "");
      tokens.push({ texto: operador, operador: true });
    } else if (/\s/.test(caractere)) {
      guardar();
    } else {
      palavra += caractere;
    }
  }
  if (aspas) throw new Error("aspas sem fechamento no terminal");
  guardar();
  if (!tokens.length) throw new Error("comando de terminal vazio");
  return tokens;
}

function verboNormalizado(palavra: string): string {
  return palavra.replace(/^\\/, "").split(/[\\/]/).pop()!.toLowerCase().replace(/\.exe$/, "");
}

function analisarGit(args: string[]): { subcomando?: string; globais: string[] } {
  const globais: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-C" || args[i] === "-c") globais.push(args[i]!, args[++i] ?? "");
    else if (args[i]!.startsWith("-")) globais.push(args[i]!);
    else return { subcomando: args[i]?.toLowerCase(), globais };
  }
  return { globais };
}

function decidirPatch(patchTexto: string, raiz: string, ambiente: Record<string, string | undefined>): Decisao {
  if (!patchTexto.trim()) return { acao: "liberar", motivo: "patch vazio" };
  const linhas = patchTexto.split(/\r?\n/);
  const cabecalhoRegex = /^\*\*\*\s*(?:Add|Update|Delete)\s+File:\s*(.+)$/i;

  let arquivoAtual: string | null = null;
  let arquivoEmWiki = false;
  let encontrouCabecalho = false;
  const wiki = caminhoWiki(raiz, ambiente);

  for (const linha of linhas) {
    const match = linha.match(cabecalhoRegex);
    if (match) {
      encontrouCabecalho = true;
      arquivoAtual = match[1]!.trim().replace(/^["']|["']$/g, "");
      const abs = isAbsolute(arquivoAtual) ? resolve(arquivoAtual) : resolve(raiz, arquivoAtual);
      arquivoEmWiki = dentroDe(abs, wiki);
      continue;
    }
    if (arquivoEmWiki && (linha.startsWith("+") || linha.startsWith("-"))) {
      const conteudo = linha.slice(1);
      if (/^\s*verified\s*:/i.test(conteudo) || /^\s*-?\s*by\s*:\s*human:/i.test(conteudo) || /\bby\s*:\s*human:/i.test(conteudo)) {
        return { acao: "bloquear", motivo: `patch altera verified em ${arquivoAtual}` };
      }
    }
  }

  if (!encontrouCabecalho && /verified/i.test(patchTexto)) {
    return { acao: "bloquear", motivo: "patch sem cabeçalhos reconhecíveis que cita verified (falha fechada)" };
  }

  return { acao: "liberar", motivo: "patch não altera verified em wiki/" };
}

function decidirTerminalVerified(cmdTexto: string, isWindows: boolean): Decisao {
  const citaAprovar = /(?:aprovarPaginas|aprovarPelaInterface|comandos[\\/]aprovar)/i.test(cmdTexto);
  const citaVerified = /verified/i.test(cmdTexto) || /\bby\s*:\s*human:/i.test(cmdTexto);
  const citaWikiOuMd = /(?:^|[\s"'\`\\/])wiki(?:[\\/]|$)/i.test(cmdTexto) || /\.md(?:["']|\s|$|[)\]}>;,])/i.test(cmdTexto);

  if (!citaAprovar && !(citaVerified && citaWikiOuMd)) {
    return { acao: "liberar", motivo: "terminal não altera verified nem chama aprovação" };
  }

  let tokens: Token[];
  try {
    tokens = tokenizar(cmdTexto, isWindows);
  } catch (erro) {
    return { acao: "bloquear", motivo: `comando com sintaxe não interpretável citando verified ou aprovação: ${(erro as Error).message}` };
  }

  for (const token of tokens) {
    if (token.operador && /^>{1,2}/.test(token.texto)) {
      return { acao: "bloquear", motivo: `redirecionamento de escrita (${token.texto}) em comando que cita verified ou aprovação` };
    }
  }

  // Agrupa segmentos entre ;, |, &&, ||, &
  const segmentos: string[][] = [[]];
  for (const token of tokens) {
    if (token.operador && /^[;|&]+$/.test(token.texto)) {
      segmentos.push([]);
    } else if (!token.operador) {
      segmentos.at(-1)!.push(token.texto);
    }
  }

  for (const segmento of segmentos) {
    if (!segmento.length) continue;
    let comando = segmento;
    while (comando.length > 0 && (/^[A-Za-z_]\w*=/.test(comando[0]!) || /^(?:do|then|else|elif|\{|\}|!|while|until|if)$/.test(comando[0]!))) {
      comando = comando.slice(1);
    }
    if (!comando.length) continue;
    let verbo = verboNormalizado(comando[0]!);
    while (ENVOLVEDORES.has(verbo) && comando.length > 1) {
      comando = comando.slice(1);
      while (comando.length > 0 && (comando[0]!.startsWith("-") || /^[A-Za-z_]\w*=/.test(comando[0]!))) {
        comando = comando.slice(1);
      }
      if (!comando.length) break;
      verbo = verboNormalizado(comando[0]!);
    }
    if (!verbo) continue;

    if (CMDLETS_ESCRITA_PS.has(verbo)) {
      return { acao: "bloquear", motivo: `cmdlet de escrita PowerShell (${verbo}) citando verified` };
    }

    if (verbo === "git") {
      const { subcomando, globais } = analisarGit(comando.slice(1));
      if (globais.some(opt => opt === "-c" || /^--(?:config-env|exec-path)(?:=|$)/.test(opt))) {
        return { acao: "bloquear", motivo: "git com opções de execução que citam verified" };
      }
      if (!subcomando || !GIT_LEITURA.has(subcomando)) {
        return { acao: "bloquear", motivo: `git com subcomando de escrita (${subcomando ?? "nenhum"}) citando verified` };
      }
      continue;
    }

    if (LEITURAS_TERMINAL.has(verbo)) {
      if (verbo === "rg" && comando.some(arg => arg === "--pre" || arg.startsWith("--pre="))) {
        return { acao: "bloquear", motivo: "rg com pré-processador citando verified" };
      }
      continue;
    }

    return { acao: "bloquear", motivo: `comando não leitor (${verbo}) citando verified ou aprovação` };
  }

  return { acao: "liberar", motivo: "comando de terminal apenas de leitura" };
}

export async function decidirVerified(
  payload: string,
  raiz: string,
  ambiente: Record<string, string | undefined> = process.env
): Promise<Decisao> {
  let dados: unknown;
  try {
    dados = JSON.parse(payload);
  } catch (erro) {
    throw new Error("JSON de entrada ilegível");
  }
  if (!mapa(dados)) throw new Error("payload deve ser um objeto JSON");

  const nome = String(dados.tool_name ?? dados.toolName ?? "").toLowerCase();
  let entrada: unknown = dados.tool_input ?? dados.toolInput ?? dados.toolArgs ?? dados.tool_args ?? dados.arguments ?? {};
  if (typeof entrada === "string" && ("toolArgs" in dados || "tool_args" in dados || "arguments" in dados)) {
    try {
      const parsed = JSON.parse(entrada);
      if (mapa(parsed)) entrada = parsed;
    } catch { /* texto puro */ }
  }

  const entradaMapa = mapa(entrada) ? entrada : undefined;
  const cwd = String(entradaMapa ? (entradaMapa.workdir ?? entradaMapa.cwd ?? entradaMapa.directory ?? entradaMapa.dir_path ?? dados.cwd ?? "") : (dados.cwd ?? ""));

  // 1. apply_patch (Codex)
  if (nome === "apply_patch" || (entradaMapa && typeof entradaMapa.patch === "string")) {
    const patchTexto = typeof entrada === "string" ? entrada : (entradaMapa && typeof entradaMapa.patch === "string") ? String(entradaMapa.patch) : "";
    return decidirPatch(patchTexto, raiz, ambiente);
  }

  // 2. Terminal (Claude Bash, Codex exec_command, Gemini run_shell_command, Copilot bash/powershell)
  const comandoRaw = entradaMapa ? (entradaMapa.command ?? entradaMapa.cmd) : undefined;
  if (TERMINAIS.has(nome) || comandoRaw !== undefined) {
    const cmdTexto = typeof comandoRaw === "string"
      ? comandoRaw
      : Array.isArray(comandoRaw)
        ? comandoRaw.join(" ")
        : typeof entrada === "string"
          ? entrada
          : "";
    const isWindows = nome === "powershell" || nome === "pwsh" || (Array.isArray(comandoRaw) && /^(?:powershell|pwsh)(?:\.exe)?$/i.test(String(comandoRaw[0]))) || process.platform === "win32";
    return decidirTerminalVerified(cmdTexto, isWindows);
  }

  // 3. Write / Edit / MultiEdit / NotebookEdit / write_file / replace
  const caminho = entradaMapa ? (entradaMapa.file_path ?? entradaMapa.filePath ?? entradaMapa.path ?? entradaMapa.notebook_path ?? entradaMapa.target_path) : undefined;
  if (typeof caminho === "string") {
    const wiki = caminhoWiki(raiz, ambiente);
    const abs = isAbsolute(caminho) ? resolve(caminho) : resolve(cwd || raiz, caminho);
    if (!dentroDe(abs, wiki)) {
      return { acao: "liberar", motivo: "caminho fora de wiki/" };
    }

    let atual = "";
    try {
      atual = await readFile(abs, "utf8");
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code !== "ENOENT") {
        return { acao: "bloquear", motivo: `não foi possível ler o arquivo atual: ${(erro as Error).message}` };
      }
    }

    let mudou = false;
    if (entradaMapa && typeof entradaMapa.content === "string") {
      mudou = mudouBloco(atual, entradaMapa.content);
    } else {
      const edicoes = (entradaMapa && Array.isArray(entradaMapa.edits)) ? entradaMapa.edits as unknown[] : (entradaMapa ? [entradaMapa] : []);
      let proposto = atual;
      for (const item of edicoes) {
        const edicao = mapa(item) ? item : {};
        const anterior = typeof edicao.old_string === "string" ? edicao.old_string : typeof edicao.oldText === "string" ? edicao.oldText : "";
        const novo = typeof edicao.new_string === "string" ? edicao.new_string : typeof edicao.newText === "string" ? edicao.newText : "";
        const indice = anterior ? proposto.indexOf(anterior) : -1;
        if (indice >= 0) {
          proposto = `${proposto.slice(0, indice)}${novo}${proposto.slice(indice + anterior.length)}`;
        } else if (mudouBloco(anterior, novo)) {
          mudou = true;
        }
      }
      mudou ||= mudouBloco(atual, proposto);
    }

    if (mudou) {
      return { acao: "bloquear", motivo: "tentativa de alterar o bloco verified em wiki/" };
    }
    return { acao: "liberar", motivo: "bloco verified preservado ou ausente" };
  }

  // 4. Payload genérico sem ferramentas isoláveis
  if (/(?:aprovarPaginas|aprovarPelaInterface|comandos[\\/]aprovar)/i.test(payload)) {
    return { acao: "bloquear", motivo: "payload cita aprovação (falha fechada)" };
  }
  if ((/verified/i.test(payload) || /\bby\s*:\s*human:/i.test(payload)) && (/(?:^|[\s"'\`\\/])wiki(?:[\\/]|$)/i.test(payload) || /\.md\b/i.test(payload))) {
    return { acao: "bloquear", motivo: "payload cita verified em wiki (falha fechada)" };
  }

  return { acao: "liberar", motivo: "payload sem referência a verified em wiki/" };
}
