import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { caminhoReal, dentroDe } from "./caminhos";
import { lerFrontmatter } from "./frontmatter";
import { caminhoWiki } from "./wiki-repo";

export type Decisao = { acao: "liberar" | "bloquear"; motivo: string };
type Json = Record<string, unknown>;
type Token = { texto: string; operador: boolean };

const TERMINAIS = new Set([
  "bash", "exec_command", "shell_command", "shell", "local_shell", "run_shell_command", "powershell", "pwsh", "run_in_terminal", "sh", "zsh", "dash", "ksh",
]);

const LEITURAS_TERMINAL = new Set([
  "cat", "rg", "grep", "ls", "head", "tail", "wc", "echo", "printf", "pwd", "stat", "file", "diff",
  "cut", "du", "sha256sum", "md5sum", "shasum", "basename", "dirname", "realpath", "readlink",
  "nl", "tac", "od", "strings", "test", "[", "true", "false", "pdfinfo",
  "get-content", "gc", "type", "dir", "get-childitem", "gci", "select-string", "sls", "get-item", "gi", "get-filehash",
]);

const GIT_LEITURA = new Set([
  "log", "show", "diff", "status", "blame", "grep", "ls-files", "ls-tree", "rev-parse", "cat-file", "describe", "shortlog",
  "reflog", "rev-list", "add", "commit", "branch", "tag",
]);

const ENVOLVEDORES = new Set([
  "busybox", "xargs", "parallel", "env", "nice", "nohup", "time", "sudo", "doas", "command", "builtin", "exec", "timeout", "stdbuf", "ionice", "setsid",
]);

const CMDLETS_ESCRITA_PS = new Set([
  "set-content", "sc", "add-content", "ac", "out-file", "export-csv", "export-clixml", "set-item", "new-item", "ni",
]);

const OPCOES_ENVOLVEDOR: Record<string, { valor: string[]; longas?: [string, string, boolean?][]; posicionais?: number }> = {
  env: { valor: ["-u", "-C", "-S"], longas: [["--unset", "--u"], ["--chdir", "--c"], ["--split-string", "--s"]] },
  timeout: { valor: ["-s", "-k"], longas: [["--signal", "--s"], ["--kill-after", "--k"]], posicionais: 1 },
  nice: { valor: ["-n"], longas: [["--adjustment", "--a"]] },
  ionice: { valor: ["-c", "-n", "-p", "-P", "-u"], longas: [["--class", "--class"], ["--classdata", "--classd"]] },
  sudo: { valor: ["-u", "-g", "-C", "-h", "-p", "-r", "-t", "-U", "-D", "-R", "-T"], longas: [["--user", "--u"], ["--group", "--g"], ["--chdir", "--chd"]] },
  doas: { valor: ["-u", "-C"] },
  time: { valor: ["-o", "-f"], longas: [["--output", "--o"], ["--format", "--f"]] },
  stdbuf: { valor: ["-i", "-o", "-e"], longas: [["--input", "--i"], ["--output", "--o"], ["--error", "--e"]] },
  xargs: { valor: ["-I", "-n", "-P", "-L", "-d", "-E", "-s", "-a"], longas: [
    ["--max-args", "--max-a"], ["--max-procs", "--max-p"], ["--max-lines", "--max-l"], ["--max-chars", "--max-c"],
    ["--delimiter", "--d"], ["--arg-file", "--a"], ["--replace", "--r", true], ["--eof", "--eo", true],
  ] },
  parallel: { valor: ["-j", "-S", "-a", "-N", "-n", "-L", "-I"] },
  exec: { valor: ["-a"] },
};

function opcaoLongaGnu(arg: string, nomeCompleto: string, prefixoMinimo: string): boolean {
  const nome = arg.split("=")[0]!;
  return nome.startsWith(prefixoMinimo) && nomeCompleto.startsWith(nome);
}

function desembrulhar(verbo: string, args: string[]): { resto: string[]; descartados: string[] } {
  const { valor, longas = [], posicionais = 0 } = OPCOES_ENVOLVEDOR[verbo] ?? { valor: [] };
  const sai = (i: number, extra: string[] = []) => ({ resto: [...extra, ...args.slice(i)], descartados: args.slice(0, i) });
  let pular = posicionais;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (/^[A-Za-z_]\w*=/.test(arg)) continue;
    if (arg === "--") return sai(i + 1);
    const ehS = verbo === "env" && ((arg.startsWith("-S") && !arg.startsWith("--")) || opcaoLongaGnu(arg, "--split-string", "--s"));
    if (ehS) {
      const colado = arg.startsWith("--") ? (arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : undefined) : arg.slice(2) || undefined;
      const texto = (colado ?? args[i + 1] ?? "").replaceAll("\\_", " ");
      return { resto: [...texto.split(/\s+/).filter(Boolean), ...args.slice(colado !== undefined ? i + 1 : i + 2)], descartados: args.slice(0, i) };
    }
    if (arg.startsWith("-")) {
      const longa = longas.find(([nome, minimo]) => opcaoLongaGnu(arg, nome, minimo));
      if (valor.includes(arg) || (longa !== undefined && !longa[2] && !arg.includes("="))) i++;
      continue;
    }
    if (pular > 0) { pular--; continue; }
    return sai(i);
  }
  return { resto: [], descartados: args };
}

function mapa(valor: unknown): valor is Json {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor);
}

function normalizarValorVerified(valor: unknown): unknown {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  if (valor instanceof Date) return valor.toISOString();
  if (Array.isArray(valor)) {
    return valor.map(normalizarValorVerified);
  }
  if (typeof valor === "object") {
    const ordenado: Record<string, unknown> = {};
    for (const chave of Object.keys(valor as Record<string, unknown>).sort()) {
      ordenado[chave] = normalizarValorVerified((valor as Record<string, unknown>)[chave]);
    }
    return ordenado;
  }
  return valor;
}

export function normalizarChaveFrontmatter(chave: string): string {
  return chave
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\u0435/g, "e") // cirílico ie
    .replace(/\u0456/g, "i") // cirílico i
    .replace(/\u0440/g, "p") // cirílico er
    .replace(/\u043e/g, "o") // cirílico o
    .replace(/\u0430/g, "a") // cirílico a
    .replace(/[\u0300-\u036f]/g, ""); // diacríticos
}

export function encontrarChavesVerified(fm: Record<string, unknown> | null): string[] {
  if (!fm || typeof fm !== "object") return [];
  return Object.keys(fm).filter(k => normalizarChaveFrontmatter(k) === "verified");
}

export function canonicalizarVerified(valor: unknown): string {
  if (valor === undefined) return "";
  const lista = (typeof valor === "object" && valor !== null && !Array.isArray(valor)) ? [valor] : valor;
  return JSON.stringify(normalizarValorVerified(lista));
}

// Compatibilidade para testes existentes
export function blocoVerified(texto: string): string {
  try {
    const fm = lerFrontmatter(texto);
    const chaves = encontrarChavesVerified(fm);
    if (chaves.some(k => k !== "verified")) return "INVALID_OR_EVASIVE_VERIFIED";
    return canonicalizarVerified(fm?.verified);
  } catch {
    return "";
  }
}

export function mudouBloco(anterior: string, novo: string): boolean {
  try {
    const fmAntes = lerFrontmatter(anterior);
    const fmDepois = lerFrontmatter(novo);
    const chavesAntes = encontrarChavesVerified(fmAntes);
    const chavesDepois = encontrarChavesVerified(fmDepois);
    if (chavesDepois.some(k => k !== "verified")) return true;
    if (chavesAntes.length !== chavesDepois.length || !chavesAntes.every(k => chavesDepois.includes(k))) return true;
    return canonicalizarVerified(fmAntes?.verified) !== canonicalizarVerified(fmDepois?.verified);
  } catch {
    return true;
  }
}

export async function verificarMudancaVerified(
  caminhoAbsoluto: string,
  novoTexto: string,
  raiz: string,
  ambiente: Record<string, string | undefined>
): Promise<Decisao> {
  const wiki = caminhoWiki(raiz, ambiente);
  let wikiReal = wiki;
  try { wikiReal = caminhoReal(wiki, raiz); } catch {}

  let absReal = caminhoAbsoluto;
  try { absReal = caminhoReal(caminhoAbsoluto, raiz); } catch {}

  const emWiki = dentroDe(caminhoAbsoluto, wiki) || dentroDe(absReal, wikiReal);
  if (!emWiki) {
    return { acao: "liberar", motivo: "caminho fora de wiki/" };
  }

  let textoAtual: string | null = null;
  try {
    textoAtual = await readFile(caminhoAbsoluto, "utf8");
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code !== "ENOENT") {
      return { acao: "bloquear", motivo: `falha ao ler arquivo atual em wiki/: ${(erro as Error).message}` };
    }
  }

  let fmAntes: Record<string, unknown> | null = null;
  if (textoAtual !== null) {
    try {
      fmAntes = lerFrontmatter(textoAtual);
    } catch (erro) {
      return { acao: "bloquear", motivo: `frontmatter do arquivo atual inválido em wiki/: ${(erro as Error).message}` };
    }
  }

  let fmDepois: Record<string, unknown> | null = null;
  try {
    fmDepois = lerFrontmatter(novoTexto);
  } catch (erro) {
    return { acao: "bloquear", motivo: `frontmatter proposto inválido em wiki/: ${(erro as Error).message}` };
  }

  const chavesAntes = encontrarChavesVerified(fmAntes);
  const chavesDepois = encontrarChavesVerified(fmDepois);

  // Se o novo conteúdo usa homógrafo ou case diferente de "verified", bloqueia
  const chaveNaoCanonica = chavesDepois.find(k => k !== "verified");
  if (chaveNaoCanonica) {
    return { acao: "bloquear", motivo: `chave verified com grafia não permitida em frontmatter: ${chaveNaoCanonica}` };
  }

  // Se as chaves de verified diferem em quantidade ou nome
  if (chavesAntes.length !== chavesDepois.length || !chavesAntes.every(k => chavesDepois.includes(k))) {
    return { acao: "bloquear", motivo: `tentativa de alterar chaves de verified em wiki/: ${caminhoAbsoluto}` };
  }

  const antesVerified = canonicalizarVerified(fmAntes?.verified);
  const depoisVerified = canonicalizarVerified(fmDepois?.verified);

  if (antesVerified !== depoisVerified) {
    return { acao: "bloquear", motivo: `tentativa de alterar o bloco verified em wiki/: ${caminhoAbsoluto}` };
  }

  return { acao: "liberar", motivo: "bloco verified preservado ou ausente" };
}

type Hunk = {
  antigo: string[];
  novo: string[];
};

type ArquivoPatch = {
  origem?: string;
  destino?: string;
  acao: "add" | "delete" | "update";
  hunks: Hunk[];
  linhasAdicionadas: string[];
};

function aplicarHunks(original: string, hunks: Hunk[]): string | null {
  const linhas = original.replace(/\r\n/g, "\n").split("\n");
  for (const hunk of hunks) {
    if (hunk.antigo.length === 0) {
      linhas.push(...hunk.novo);
      continue;
    }
    let encontrou = -1;
    const qtdAntigo = hunk.antigo.length;
    for (let i = 0; i <= linhas.length - qtdAntigo; i++) {
      let casa = true;
      for (let j = 0; j < qtdAntigo; j++) {
        if (linhas[i + j] !== hunk.antigo[j]) {
          casa = false;
          break;
        }
      }
      if (casa) {
        encontrou = i;
        break;
      }
    }
    if (encontrou < 0) return null;
    linhas.splice(encontrou, qtdAntigo, ...hunk.novo);
  }
  return linhas.join("\n");
}

function parsearPatch(patchTexto: string): ArquivoPatch[] {
  const linhas = patchTexto.split(/\r?\n/);
  const arquivos: ArquivoPatch[] = [];
  let atual: ArquivoPatch | null = null;
  let hunkAtual: Hunk | null = null;

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i]!;

    const matchAdd = linha.match(/^\*\*\*\s*Add\s+File:\s*(.+)$/i);
    if (matchAdd) {
      atual = { origem: matchAdd[1]!.trim().replace(/^["']|["']$/g, ""), acao: "add", hunks: [], linhasAdicionadas: [] };
      arquivos.push(atual);
      hunkAtual = null;
      continue;
    }

    const matchDelete = linha.match(/^\*\*\*\s*Delete\s+File:\s*(.+)$/i);
    if (matchDelete) {
      atual = { origem: matchDelete[1]!.trim().replace(/^["']|["']$/g, ""), acao: "delete", hunks: [], linhasAdicionadas: [] };
      arquivos.push(atual);
      hunkAtual = null;
      continue;
    }

    const matchUpdate = linha.match(/^\*\*\*\s*Update\s+File:\s*(.+)$/i);
    if (matchUpdate) {
      atual = { origem: matchUpdate[1]!.trim().replace(/^["']|["']$/g, ""), acao: "update", hunks: [], linhasAdicionadas: [] };
      arquivos.push(atual);
      hunkAtual = null;
      continue;
    }

    const matchMove = linha.match(/^(?:\*\*\*\s*(?:Move|Rename)\s+to:\s*|rename\s+to\s+)(.+)$/i);
    if (matchMove) {
      if (!atual) {
        atual = { acao: "update", hunks: [], linhasAdicionadas: [] };
        arquivos.push(atual);
      }
      atual.destino = matchMove[1]!.trim().replace(/^["']|["']$/g, "");
      continue;
    }

    const matchDiff = linha.match(/^diff --git a\/(.+) b\/(.+)$/i);
    if (matchDiff) {
      atual = { origem: matchDiff[1]!.trim(), destino: matchDiff[2]!.trim(), acao: "update", hunks: [], linhasAdicionadas: [] };
      arquivos.push(atual);
      hunkAtual = null;
      continue;
    }

    const matchOrigemDiff = linha.match(/^---\s+(?:a\/)?(.+)$/i);
    if (matchOrigemDiff && atual && !atual.origem) {
      atual.origem = matchOrigemDiff[1]!.trim().replace(/^["']|["']$/g, "");
      continue;
    }

    const matchDestinoDiff = linha.match(/^\+\+\+\s+(?:b\/)?(.+)$/i);
    if (matchDestinoDiff && atual && !atual.destino) {
      atual.destino = matchDestinoDiff[1]!.trim().replace(/^["']|["']$/g, "");
      continue;
    }

    if (linha.startsWith("@@")) {
      hunkAtual = { antigo: [], novo: [] };
      if (atual) atual.hunks.push(hunkAtual);
      continue;
    }

    if (atual?.acao === "add") {
      if (linha.startsWith("+")) atual.linhasAdicionadas.push(linha.slice(1));
      else if (!linha.startsWith("@@") && !linha.startsWith("***")) atual.linhasAdicionadas.push(linha);
      continue;
    }

    if (hunkAtual) {
      if (linha.startsWith("-")) {
        hunkAtual.antigo.push(linha.slice(1));
      } else if (linha.startsWith("+")) {
        hunkAtual.novo.push(linha.slice(1));
      } else if (linha.startsWith(" ") || linha === "") {
        const conteudo = linha.startsWith(" ") ? linha.slice(1) : linha;
        hunkAtual.antigo.push(conteudo);
        hunkAtual.novo.push(conteudo);
      }
    }
  }

  return arquivos;
}

async function decidirPatch(
  patchTexto: string,
  cwd: string,
  raiz: string,
  ambiente: Record<string, string | undefined>
): Promise<Decisao> {
  if (!patchTexto.trim()) return { acao: "liberar", motivo: "patch vazio" };

  const arquivos = parsearPatch(patchTexto);
  if (!arquivos.length) {
    if (/verified/i.test(patchTexto)) {
      return { acao: "bloquear", motivo: "patch sem cabeçalhos reconhecíveis citando verified (falha fechada)" };
    }
    return { acao: "liberar", motivo: "patch sem cabeçalhos nem referências a verified" };
  }

  for (const arq of arquivos) {
    const caminhoRef = arq.destino ?? arq.origem;
    if (!caminhoRef) {
      if (/verified/i.test(patchTexto)) {
        return { acao: "bloquear", motivo: "patch com arquivo sem caminho identificável citando verified" };
      }
      continue;
    }

    const abs = isAbsolute(caminhoRef) ? resolve(caminhoRef) : resolve(cwd, caminhoRef);
    let absReal = abs;
    try { absReal = caminhoReal(abs, cwd); } catch {}

    const wiki = caminhoWiki(raiz, ambiente);
    let wikiReal = wiki;
    try { wikiReal = caminhoReal(wiki, raiz); } catch {}

    const tocaWiki = dentroDe(abs, wiki) || dentroDe(absReal, wikiReal);
    if (!tocaWiki) continue;

    let novoConteudo = "";
    if (arq.acao === "delete") {
      novoConteudo = "";
    } else if (arq.acao === "add") {
      novoConteudo = arq.linhasAdicionadas.join("\n");
    } else {
      let textoAtual = "";
      const caminhoLeitura = arq.origem ? (isAbsolute(arq.origem) ? resolve(arq.origem) : resolve(cwd, arq.origem)) : abs;
      try {
        textoAtual = await readFile(caminhoLeitura, "utf8");
      } catch (erro) {
        return { acao: "bloquear", motivo: `falha ao ler arquivo em wiki/ para aplicar patch: ${(erro as Error).message}` };
      }
      const aplicado = aplicarHunks(textoAtual, arq.hunks);
      if (aplicado === null) {
        return { acao: "bloquear", motivo: `patch não aplica limpo em ${caminhoRef} (falha fechada)` };
      }
      novoConteudo = aplicado;
    }

    const decisao = await verificarMudancaVerified(abs, novoConteudo, raiz, ambiente);
    if (decisao.acao === "bloquear") return decisao;
  }

  return { acao: "liberar", motivo: "patch não altera verified em wiki/" };
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
  const limpo = palavra.replace(/^[\\/]+|[\\/]+$/g, "");
  const partes = limpo ? limpo.split(/[\\/]/) : [];
  return partes.pop()?.toLowerCase().replace(/\.exe$/, "") ?? "";
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

function escreveEmWiki(
  caminhoStr: string,
  cwd: string,
  raiz: string,
  ambiente: Record<string, string | undefined>
): boolean {
  const limpo = caminhoStr.replace(/^["']|["']$/g, "");
  if (limpo === "/dev/null" || limpo.toLowerCase() === "nul" || limpo === "&1" || limpo === "&2") return false;
  const wiki = caminhoWiki(raiz, ambiente);
  let wikiReal = wiki;
  try { wikiReal = caminhoReal(wiki, raiz); } catch {}
  const abs = isAbsolute(limpo) ? resolve(limpo) : resolve(cwd, limpo);
  let absReal = abs;
  try { absReal = caminhoReal(abs, cwd); } catch {}
  return dentroDe(abs, wiki) || dentroDe(absReal, wikiReal);
}

function decidirTerminalVerified(
  cmdTexto: string,
  isWindows: boolean,
  cwd: string,
  raiz: string,
  ambiente: Record<string, string | undefined>
): Decisao {
  if (!cmdTexto.trim()) {
    return { acao: "bloquear", motivo: "comando de terminal vazio citando verified ou aprovação (falha fechada)" };
  }

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

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.operador && /^>{1,2}$/.test(token.texto)) {
      let alvo = tokens[i + 1];
      if (alvo?.operador && /^[|&]$/.test(alvo.texto)) alvo = tokens[i + 2];
      if (alvo !== undefined && !alvo.operador) {
        if (escreveEmWiki(alvo.texto, cwd, raiz, ambiente)) {
          return { acao: "bloquear", motivo: `redirecionamento de escrita para wiki/ (${token.texto} ${alvo.texto}) citando verified ou aprovação` };
        }
      } else {
        return { acao: "bloquear", motivo: `redirecionamento de escrita sem alvo claro citando verified ou aprovação` };
      }
    }
  }

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
      const { resto, descartados } = desembrulhar(verbo, comando.slice(1));
      if ((verbo === "time" || verbo === "stdbuf") && descartados.some(arg => arg === "-o" || arg.startsWith("-o") || /^--(?:output)(?:=|$)/.test(arg))) {
        return { acao: "bloquear", motivo: `${verbo} com opção de saída em arquivo citando verified` };
      }
      comando = resto;
      if (!comando.length) break;
      verbo = verboNormalizado(comando[0]!);
    }

    if (!verbo) {
      return { acao: "bloquear", motivo: "comando com verbo vazio ou inválido citando verified ou aprovação" };
    }

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
      if (comando.slice(1).some(arg => arg === "--output" || arg.startsWith("--output=") || arg === "-o" || arg.startsWith("-o") || /^--(?:output|output-directory)(?:=|$)/.test(arg))) {
        return { acao: "bloquear", motivo: "git com opção de saída em arquivo citando verified" };
      }
      continue;
    }

    if (verbo === "anvilore" || ((verbo === "bun" || verbo === "node") && comando.length > 1 && /(?:^|[\\/])(?:src[\\/])?cli\.ts$/i.test(comando[1]!))) {
      const offset = verbo === "anvilore" ? 1 : 2;
      const subcomando = comando[offset]?.toLowerCase();
      const SUBCOMANDOS_SEGUROS = new Set([
        "validar", "doctor", "status", "metricas", "buscar", "capturar", "auditar", "checar-docs", "fechar", "aprovar", "ui"
      ]);
      if (subcomando && SUBCOMANDOS_SEGUROS.has(subcomando)) {
        const temEval = comando.some(arg => arg === "-e" || arg === "--eval" || arg.startsWith("-e=") || arg.startsWith("--eval="));
        if (!temEval) {
          continue;
        }
      }
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

  // Resolve cwd: SEMPRE dados.cwd ou raiz; NUNCA tool_input.workdir
  const cwd = typeof dados.cwd === "string" && dados.cwd.trim() ? dados.cwd.trim() : raiz;

  let entrada: unknown = dados.tool_input ?? dados.toolInput ?? dados.toolArgs ?? dados.tool_args ?? dados.arguments;
  if (entrada === undefined) {
    if (TERMINAIS.has(nome)) {
      return { acao: "bloquear", motivo: "ferramenta de terminal sem comando (falha fechada)" };
    }
    if (nome === "apply_patch") {
      return { acao: "bloquear", motivo: "apply_patch sem patch (falha fechada)" };
    }
  }

  if (typeof entrada === "string" && ("toolArgs" in dados || "tool_args" in dados || "arguments" in dados)) {
    try {
      const parsed = JSON.parse(entrada);
      if (mapa(parsed)) entrada = parsed;
    } catch (erro) {
      // Se toolArgs foi passado como string JSON inválida, falha fechado!
      throw new Error(`toolArgs com JSON inválido: ${(erro as Error).message}`);
    }
  }

  const entradaMapa = mapa(entrada) ? entrada : undefined;

  // 1. apply_patch (Codex)
  if (nome === "apply_patch") {
    if (!entradaMapa || typeof entradaMapa.patch !== "string") {
      return { acao: "bloquear", motivo: "apply_patch sem chave patch reconhecida (falha fechada)" };
    }
    return decidirPatch(entradaMapa.patch, cwd, raiz, ambiente);
  }
  if (entradaMapa && typeof entradaMapa.patch === "string") {
    return decidirPatch(entradaMapa.patch, cwd, raiz, ambiente);
  }

  // 2. Terminal
  const comandoRaw = entradaMapa ? (entradaMapa.command ?? entradaMapa.cmd) : undefined;
  if (TERMINAIS.has(nome) || comandoRaw !== undefined) {
    if (entradaMapa && !("command" in entradaMapa) && !("cmd" in entradaMapa)) {
      return { acao: "bloquear", motivo: "ferramenta de terminal com chave desconhecida (falha fechada)" };
    }
    const cmdTexto = typeof comandoRaw === "string"
      ? comandoRaw
      : Array.isArray(comandoRaw)
        ? comandoRaw.join(" ")
        : typeof entrada === "string"
          ? entrada
          : "";
    const isWindows = nome === "powershell" || nome === "pwsh" || (Array.isArray(comandoRaw) && /^(?:powershell|pwsh)(?:\.exe)?$/i.test(String(comandoRaw[0]))) || (process.platform === "win32" && !/bash/i.test(nome));
    return decidirTerminalVerified(cmdTexto, isWindows, cwd, raiz, ambiente);
  }

  // 3. Write / Edit / MultiEdit / NotebookEdit / write_file / replace
  const ehEdicaoConhecida = [
    "write", "edit", "multiedit", "notebookedit", "write_file", "replace",
  ].includes(nome);

  if (ehEdicaoConhecida || (entradaMapa && (entradaMapa.file_path || entradaMapa.filePath || entradaMapa.path || entradaMapa.target_path))) {
    const caminho = entradaMapa ? (entradaMapa.file_path ?? entradaMapa.filePath ?? entradaMapa.path ?? entradaMapa.notebook_path ?? entradaMapa.target_path) : undefined;
    if (typeof caminho !== "string") {
      return { acao: "bloquear", motivo: "ferramenta de edição sem caminho de arquivo (falha fechada)" };
    }

    const abs = isAbsolute(caminho) ? resolve(caminho) : resolve(cwd, caminho);

    // Caso A: Write / write_file (conteúdo novo completo)
    if (nome === "write" || nome === "write_file" || (entradaMapa && typeof entradaMapa.content === "string")) {
      const conteudo = (entradaMapa && typeof entradaMapa.content === "string") ? entradaMapa.content : "";
      return verificarMudancaVerified(abs, conteudo, raiz, ambiente);
    }

    // Caso B: Edit / replace (substituição old -> new)
    if (entradaMapa && (typeof entradaMapa.old_string === "string" || typeof entradaMapa.oldText === "string")) {
      const anterior = typeof entradaMapa.old_string === "string" ? entradaMapa.old_string : String(entradaMapa.oldText);
      const novo = typeof entradaMapa.new_string === "string" ? entradaMapa.new_string : typeof entradaMapa.newText === "string" ? String(entradaMapa.newText) : "";
      const replaceAll = Boolean(entradaMapa.replace_all ?? entradaMapa.replaceAll);

      let textoAtual = "";
      try {
        textoAtual = await readFile(abs, "utf8");
      } catch (erro) {
        return { acao: "bloquear", motivo: `falha ao ler arquivo em wiki/ para edição: ${(erro as Error).message}` };
      }

      let novoTexto = textoAtual;
      if (replaceAll) {
        if (!textoAtual.includes(anterior)) {
          return { acao: "bloquear", motivo: "texto original não encontrado no arquivo (falha fechada)" };
        }
        novoTexto = textoAtual.replaceAll(anterior, novo);
      } else {
        const idx = textoAtual.indexOf(anterior);
        if (idx < 0) {
          return { acao: "bloquear", motivo: "texto original não encontrado no arquivo (falha fechada)" };
        }
        novoTexto = textoAtual.slice(0, idx) + novo + textoAtual.slice(idx + anterior.length);
      }
      return verificarMudancaVerified(abs, novoTexto, raiz, ambiente);
    }

    // Caso C: MultiEdit (edits array)
    if (entradaMapa && Array.isArray(entradaMapa.edits)) {
      let textoAtual = "";
      try {
        textoAtual = await readFile(abs, "utf8");
      } catch (erro) {
        return { acao: "bloquear", motivo: `falha ao ler arquivo em wiki/ para edição: ${(erro as Error).message}` };
      }

      let simulado = textoAtual;
      for (const item of entradaMapa.edits) {
        if (!mapa(item)) return { acao: "bloquear", motivo: "edição inválida no edits (falha fechada)" };
        const ant = typeof item.old_string === "string" ? item.old_string : typeof item.oldText === "string" ? String(item.oldText) : "";
        const nov = typeof item.new_string === "string" ? item.new_string : typeof item.newText === "string" ? String(item.newText) : "";
        const repAll = Boolean(item.replace_all ?? item.replaceAll);

        if (repAll) {
          if (!simulado.includes(ant)) return { acao: "bloquear", motivo: "texto original não encontrado em edits (falha fechada)" };
          simulado = simulado.replaceAll(ant, nov);
        } else {
          const idx = simulado.indexOf(ant);
          if (idx < 0) return { acao: "bloquear", motivo: "texto original não encontrado em edits (falha fechada)" };
          simulado = simulado.slice(0, idx) + nov + simulado.slice(idx + ant.length);
        }
      }
      return verificarMudancaVerified(abs, simulado, raiz, ambiente);
    }

    return { acao: "bloquear", motivo: "ferramenta de edição com formato de entrada desconhecido (falha fechada)" };
  }

  // 4. Ferramenta desconhecida mexendo em wiki/
  if (payload.includes("wiki/") || payload.includes(".md")) {
    return { acao: "bloquear", motivo: `ferramenta desconhecida (${nome}) referenciando wiki/ ou .md (falha fechada)` };
  }

  // 5. Payload genérico sem ferramentas isoláveis
  if (/(?:aprovarPaginas|aprovarPelaInterface|comandos[\\/]aprovar)/i.test(payload)) {
    return { acao: "bloquear", motivo: "payload cita aprovação (falha fechada)" };
  }
  if ((/verified/i.test(payload) || /\bby\s*:\s*human:/i.test(payload)) && (/(?:^|[\s"'\`\\/])wiki(?:[\\/]|$)/i.test(payload) || /\.md\b/i.test(payload))) {
    return { acao: "bloquear", motivo: "payload cita verified em wiki (falha fechada)" };
  }

  return { acao: "liberar", motivo: "payload sem referência a verified em wiki/" };
}
