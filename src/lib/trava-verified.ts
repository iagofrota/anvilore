import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { caminhoReal, dentroDe } from "./caminhos";
import { lerFrontmatter } from "./frontmatter";
import { caminhoWiki } from "./wiki-repo";

export type Decisao = { acao: "liberar" | "bloquear"; motivo: string };
type Json = Record<string, unknown>;
type Token = { texto: string; operador: boolean };

const FERRAMENTAS_TERMINAL = new Set([
  "bash", "exec_command", "shell_command", "shell", "local_shell", "run_shell_command", "powershell", "pwsh", "run_in_terminal", "sh", "zsh", "dash", "ksh",
]);
const TERMINAIS = FERRAMENTAS_TERMINAL;

const FERRAMENTAS_PATCH = new Set(["apply_patch"]);
const FERRAMENTAS_WRITE = new Set(["write", "write_file"]);
const FERRAMENTAS_EDIT = new Set(["edit", "replace"]);
const FERRAMENTAS_MULTIEDIT = new Set(["multiedit"]);
const FERRAMENTAS_LEITURA = new Set(["read_file", "view", "show", "cat", "read"]);

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
      return null;
    }
    const qtdAntigo = hunk.antigo.length;
    let encontrou = -1;
    let totalCasamentos = 0;
    for (let i = 0; i <= linhas.length - qtdAntigo; i++) {
      let casa = true;
      for (let j = 0; j < qtdAntigo; j++) {
        if (linhas[i + j] !== hunk.antigo[j]) {
          casa = false;
          break;
        }
      }
      if (casa) {
        totalCasamentos++;
        encontrou = i;
      }
    }
    if (totalCasamentos !== 1 || encontrou < 0) return null;
    linhas.splice(encontrou, qtdAntigo, ...hunk.novo);
  }
  return linhas.join("\n");
}

function parsearPatchCodex(patchTexto: string): ArquivoPatch[] {
  const linhas = patchTexto.split(/\r?\n/);
  const arquivos: ArquivoPatch[] = [];
  let atual: ArquivoPatch | null = null;
  let hunkAtual: Hunk | null = null;
  const temDelimitador = patchTexto.includes("*** Begin Patch");
  let dentroDoBloco = !temDelimitador;

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i]!;

    if (linha.trim() === "*** Begin Patch") {
      dentroDoBloco = true;
      continue;
    }
    if (linha.trim() === "*** End Patch") {
      dentroDoBloco = false;
      continue;
    }
    if (!dentroDoBloco) continue;

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

function parsearPatchUnified(patchTexto: string): ArquivoPatch[] {
  const linhas = patchTexto.split(/\r?\n/);
  const arquivos: ArquivoPatch[] = [];
  let atual: ArquivoPatch | null = null;
  let hunkAtual: Hunk | null = null;

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i]!;

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

function parsearPatch(patchTexto: string): ArquivoPatch[] {
  if (patchTexto.includes("*** Begin Patch") || /^\*\*\*\s*(?:Add|Update|Delete|Move)\s+File/im.test(patchTexto)) {
    return parsearPatchCodex(patchTexto);
  }
  return parsearPatchUnified(patchTexto);
}

async function decidirPatch(
  patchTexto: string,
  cwd: string,
  raiz: string,
  ambiente: Record<string, string | undefined>
): Promise<Decisao> {
  if (!patchTexto.trim()) return { acao: "bloquear", motivo: "patch vazio (falha fechada)" };

  const arquivos = parsearPatch(patchTexto);
  if (!arquivos.length) {
    if (/verified/i.test(patchTexto)) {
      return { acao: "bloquear", motivo: "patch sem cabeçalhos reconhecíveis citando verified (falha fechada)" };
    }
    return { acao: "liberar", motivo: "patch sem cabeçalhos nem referências a verified" };
  }

  for (const arq of arquivos) {
    const caminhoRef = arq.destino ?? arq.origem;
    if (!caminhoRef) continue;

    const abs = isAbsolute(caminhoRef) ? resolve(caminhoRef) : resolve(cwd, caminhoRef);
    let absReal = abs;
    try { absReal = caminhoReal(abs, cwd); } catch {}

    const wiki = caminhoWiki(raiz, ambiente);
    let wikiReal = wiki;
    try { wikiReal = caminhoReal(wiki, raiz); } catch {}

    const tocaWiki = dentroDe(abs, wiki) || dentroDe(absReal, wikiReal);
    if (!tocaWiki) continue;

    if (arq.acao === "update") {
      if (arq.hunks.length === 0) {
        if (!arq.destino || arq.destino === arq.origem) {
          return { acao: "bloquear", motivo: "Update File em wiki/ sem hunks aplicáveis (falha fechada)" };
        }
      }
      for (const hunk of arq.hunks) {
        if (hunk.antigo.length === 0) {
          return { acao: "bloquear", motivo: "inclua linhas de contexto no patch" };
        }
      }
    }

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
      if (arq.hunks.length > 0) {
        const aplicado = aplicarHunks(textoAtual, arq.hunks);
        if (aplicado === null) {
          return { acao: "bloquear", motivo: `patch não aplica limpo em ${caminhoRef} (falha fechada)` };
        }
        novoConteudo = aplicado;
      } else {
        novoConteudo = textoAtual;
      }
      if (arq.destino && arq.origem && arq.destino !== arq.origem) {
        const absOrigem = isAbsolute(arq.origem) ? resolve(arq.origem) : resolve(cwd, arq.origem);
        let absOrigemReal = absOrigem;
        try { absOrigemReal = caminhoReal(absOrigem, cwd); } catch {}
        if (dentroDe(absOrigem, wiki) || dentroDe(absOrigemReal, wikiReal)) {
          const decisaoOrigem = await verificarMudancaVerified(absOrigem, "", raiz, ambiente);
          if (decisaoOrigem.acao === "bloquear") return decisaoOrigem;
        }
      }
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

export function caminhoTocaWiki(
  caminhoStr: string,
  base: string,
  raiz: string,
  ambiente: Record<string, string | undefined>
): boolean {
  const limpo = caminhoStr.replace(/^["']|["']$/g, "").trim();
  if (!limpo) return false;
  if (limpo === "/dev/null" || limpo.toLowerCase() === "nul" || limpo === "&1" || limpo === "&2") return false;

  const wiki = caminhoWiki(raiz, ambiente);
  const wikiExiste = Boolean(ambiente.ANVILORE_WIKI || existsSync(wiki));
  if (!wikiExiste) return false;

  let wikiReal = wiki;
  try { wikiReal = caminhoReal(wiki, raiz); } catch {}

  const semGlob = limpo.includes("*") || limpo.includes("?")
    ? limpo.replace(/[*?].*$/, "")
    : limpo;
  const caminhoParaResolver = semGlob || ".";

  const absBase = isAbsolute(caminhoParaResolver) ? resolve(caminhoParaResolver) : resolve(base, caminhoParaResolver);
  let absBaseReal = absBase;
  try { absBaseReal = caminhoReal(absBase, base); } catch {}

  if (dentroDe(absBase, wiki) || dentroDe(absBaseReal, wikiReal) || absBase === wiki || absBaseReal === wikiReal) {
    return true;
  }

  const absRaiz = isAbsolute(caminhoParaResolver) ? resolve(caminhoParaResolver) : resolve(raiz, caminhoParaResolver);
  let absRaizReal = absRaiz;
  try { absRaizReal = caminhoReal(absRaiz, raiz); } catch {}

  if (dentroDe(absRaiz, wiki) || dentroDe(absRaizReal, wikiReal) || absRaiz === wiki || absRaizReal === wikiReal) {
    return true;
  }

  return false;
}

function extrairAlvosSed(args: string[]): string[] {
  let temScriptExplicit = false;
  const naoFlags: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "-e" || arg === "-f") {
      temScriptExplicit = true;
      i++;
      continue;
    }
    if (arg.startsWith("-e") || arg.startsWith("-f")) {
      temScriptExplicit = true;
      continue;
    }
    if (arg.startsWith("-")) continue;
    naoFlags.push(arg);
  }
  return temScriptExplicit ? naoFlags : naoFlags.slice(1);
}

const MSG_TERMINAL_WIKI = "Edite páginas da wiki pelas ferramentas de edição (Write/Edit/apply_patch); o terminal não escreve em wiki/.";

function decidirTerminalVerified(
  cmdTexto: string,
  isWindows: boolean,
  base: string,
  raiz: string,
  ambiente: Record<string, string | undefined>
): Decisao {
  if (!cmdTexto.trim()) {
    return { acao: "bloquear", motivo: "comando de terminal vazio citando verified ou aprovação (falha fechada)" };
  }

  const citaAprovar = /(?:aprovarPaginas|aprovarPelaInterface|comandos[\\/]aprovar)/i.test(cmdTexto);
  const citaVerified = /verified/i.test(cmdTexto) || /\bby\s*:\s*human:/i.test(cmdTexto);

  let tokens: Token[];
  try {
    tokens = tokenizar(cmdTexto, isWindows);
  } catch (erro) {
    if (citaVerified || citaAprovar) {
      return { acao: "bloquear", motivo: `comando com sintaxe não interpretável citando verified ou aprovação: ${(erro as Error).message}` };
    }
    return { acao: "liberar", motivo: "comando de terminal com sintaxe não interpretável sem citação a verified ou aprovação" };
  }

  // 1. Redirecionamentos de escrita
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.operador && /^>{1,2}$/.test(token.texto)) {
      let alvo = tokens[i + 1];
      if (alvo?.operador && /^[|&]$/.test(alvo.texto)) alvo = tokens[i + 2];
      if (alvo !== undefined && !alvo.operador) {
        if (caminhoTocaWiki(alvo.texto, base, raiz, ambiente)) {
          return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
        }
      } else {
        return { acao: "bloquear", motivo: "redirecionamento de escrita sem alvo claro (falha fechada)" };
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
      return { acao: "bloquear", motivo: "comando com verbo vazio ou inválido (falha fechada)" };
    }

    // A. Allowlist: CLI do próprio kit
    const ehAnvilore = verbo === "anvilore";
    const ehCliTs = (verbo === "bun" || verbo === "node") && comando.length > 1 && /(?:^|[\\/])(?:src[\\/])?cli\.ts$/i.test(comando[1]!);
    if (ehAnvilore || ehCliTs) {
      const offset = ehAnvilore ? 1 : 2;
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

    // B. Bloqueio de aprovação interna
    const textoSegmento = comando.join(" ");
    if (/(?:aprovarPaginas|aprovarPelaInterface|comandos[\\/]aprovar)/i.test(textoSegmento)) {
      return { acao: "bloquear", motivo: "chamada direta a rotinas internas de aprovação" };
    }

    // C. Editores in-place: sed, perl, ruby
    if (verbo === "sed" || verbo === "perl" || verbo === "ruby") {
      const temInPlace = comando.slice(1).some(arg => arg === "-i" || arg.startsWith("-i") || arg === "--in-place" || arg.startsWith("--in-place="));
      if (temInPlace) {
        const alvos = verbo === "sed" ? extrairAlvosSed(comando.slice(1)) : comando.slice(1).filter(arg => !arg.startsWith("-"));
        if (alvos.some(arg => caminhoTocaWiki(arg, base, raiz, ambiente)) || (alvos.length === 0 && caminhoTocaWiki(".", base, raiz, ambiente))) {
          return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
        }
      }
    }

    // D. tee
    if (verbo === "tee") {
      const alvos = comando.slice(1).filter(arg => !arg.startsWith("-"));
      if (alvos.some(arg => caminhoTocaWiki(arg, base, raiz, ambiente))) {
        return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
      }
    }

    // E. Escrita direta de arquivos: cp, mv, ln, install, rsync, truncate, dd
    const ESCRITAS_ARQUIVO = new Set(["cp", "mv", "ln", "install", "rsync", "truncate", "dd"]);
    if (ESCRITAS_ARQUIVO.has(verbo)) {
      if (verbo === "dd") {
        const argOf = comando.slice(1).find(arg => /^of=/i.test(arg));
        const alvo = argOf ? argOf.slice(3) : undefined;
        if (alvo && caminhoTocaWiki(alvo, base, raiz, ambiente)) {
          return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
        }
      } else if (verbo === "truncate") {
        const alvos = comando.slice(1).filter(arg => !arg.startsWith("-"));
        if (alvos.some(arg => caminhoTocaWiki(arg, base, raiz, ambiente))) {
          return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
        }
      } else {
        const optT = comando.slice(1).find(arg => arg.startsWith("-t=") || arg.startsWith("--target-directory="));
        let destino = optT ? optT.split("=")[1] : undefined;
        if (!destino) {
          const idxT = comando.slice(1).findIndex(arg => arg === "-t" || arg === "--target-directory");
          if (idxT >= 0) destino = comando.slice(1)[idxT + 1];
        }
        if (!destino) {
          destino = comando.slice(1).filter(arg => !arg.startsWith("-")).pop();
        }
        if (destino && caminhoTocaWiki(destino, base, raiz, ambiente)) {
          return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
        }
      }
    }

    // F. git
    if (verbo === "git") {
      const { subcomando, globais } = analisarGit(comando.slice(1));
      if (globais.some(opt => opt === "-c" || /^--(?:config-env|exec-path)(?:=|$)/.test(opt))) {
        return { acao: "bloquear", motivo: "git com opções de execução que citam verified" };
      }
      if (subcomando === "checkout" || subcomando === "restore" || subcomando === "apply") {
        const alvos = comando.slice(1).filter(arg => !arg.startsWith("-") && arg !== subcomando);
        if (alvos.some(arg => caminhoTocaWiki(arg, base, raiz, ambiente))) {
          return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
        }
      }
      for (let i = 0; i < comando.slice(1).length; i++) {
        const arg = comando.slice(1)[i]!;
        let alvo: string | undefined;
        if (arg.startsWith("--output=")) alvo = arg.slice("--output=".length);
        else if (arg === "--output" || arg === "-o") alvo = comando.slice(1)[i + 1];
        else if (arg.startsWith("-o") && !arg.startsWith("--")) alvo = arg.slice(2);
        else if (arg.startsWith("--output-directory=")) alvo = arg.slice("--output-directory=".length);
        else if (arg === "--output-directory") alvo = comando.slice(1)[i + 1];

        if (alvo && caminhoTocaWiki(alvo, base, raiz, ambiente)) {
          return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
        }
      }
      if (citaVerified) {
        if (!subcomando || !GIT_LEITURA.has(subcomando)) {
          return { acao: "bloquear", motivo: `git com subcomando de escrita (${subcomando ?? "nenhum"}) citando verified` };
        }
      }
      continue;
    }

    // G. Interpretadores com -c ou -e
    const INTERPRETES_EVAL = new Set(["python", "python3", "node", "bun", "perl", "ruby", "bash", "sh", "zsh"]);
    if (INTERPRETES_EVAL.has(verbo)) {
      const temEval = comando.slice(1).some(arg => arg === "-c" || arg === "-e" || arg.startsWith("-c=") || arg.startsWith("-e="));
      if (temEval) {
        const textoResto = comando.slice(1).join(" ");
        const tocaWiki = comando.slice(1).some(arg => caminhoTocaWiki(arg, base, raiz, ambiente)) ||
          (Boolean(ambiente.ANVILORE_WIKI || existsSync(caminhoWiki(raiz, ambiente))) && /(?:^|[\s"'`\\/])wiki(?:[\\/]|$)/i.test(textoResto));
        if (tocaWiki) {
          return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
        }
      }
    }

    // H. Cmdlets de escrita PowerShell
    if (CMDLETS_ESCRITA_PS.has(verbo)) {
      const alvos: string[] = [];
      const args = comando.slice(1);
      for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (/^-(?:p|pa|pat|path|lit|literal|literalpath|dest|destination|file|filepath|outfile|target)(?::.*)?$/i.test(arg)) {
          if (arg.includes(":")) {
            alvos.push(arg.slice(arg.indexOf(":") + 1));
          } else if (i + 1 < args.length) {
            alvos.push(args[++i]!);
          }
        } else if (!arg.startsWith("-")) {
          alvos.push(arg);
        }
      }
      if (alvos.some(arg => caminhoTocaWiki(arg, base, raiz, ambiente))) {
        return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
      }
    }

    // I. Leitores puros
    if (LEITURAS_TERMINAL.has(verbo)) {
      if (verbo === "rg" && comando.some(arg => arg === "--pre" || arg.startsWith("--pre="))) {
        return { acao: "bloquear", motivo: "rg com pré-processador citando verified" };
      }
      continue;
    }

    // J. Se cita verified ou aprovação em comando não leitor
    if (/verified/i.test(textoSegmento) || /\bby\s*:\s*human:/i.test(textoSegmento)) {
      return { acao: "bloquear", motivo: `comando não leitor (${verbo}) citando verified` };
    }
  }

  return { acao: "liberar", motivo: "comando de terminal permitido" };
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

  const nome = String(dados.tool_name ?? dados.toolName ?? "").toLowerCase().trim();

  // cwd padrão: dados.cwd se fornecido, senão raiz
  const cwd = typeof dados.cwd === "string" && dados.cwd.trim() ? dados.cwd.trim() : raiz;

  let entrada: unknown = dados.tool_input ?? dados.toolInput ?? dados.toolArgs ?? dados.tool_args ?? dados.arguments;

  if (typeof entrada === "string" && ("toolArgs" in dados || "tool_args" in dados || "arguments" in dados)) {
    try {
      const parsed = JSON.parse(entrada);
      if (mapa(parsed)) entrada = parsed;
    } catch (erro) {
      throw new Error(`toolArgs com JSON inválido: ${(erro as Error).message}`);
    }
  }

  const entradaMapa = mapa(entrada) ? entrada : undefined;

  let nomeEfetivo = nome;
  if (!nomeEfetivo && entradaMapa && (entradaMapa.file_path || entradaMapa.filePath || entradaMapa.path || entradaMapa.target_path)) {
    if (typeof entradaMapa.content === "string") {
      nomeEfetivo = "write";
    } else if (typeof entradaMapa.old_string === "string" || typeof entradaMapa.oldText === "string") {
      nomeEfetivo = "edit";
    } else if (Array.isArray(entradaMapa.edits)) {
      nomeEfetivo = "multiedit";
    }
  }

  // 1. apply_patch (Codex)
  if (FERRAMENTAS_PATCH.has(nomeEfetivo)) {
    if (!entradaMapa || typeof entradaMapa.patch !== "string") {
      return { acao: "bloquear", motivo: "apply_patch sem chave patch reconhecida (falha fechada)" };
    }
    return decidirPatch(entradaMapa.patch, cwd, raiz, ambiente);
  }

  // 2. Terminal
  if (FERRAMENTAS_TERMINAL.has(nomeEfetivo)) {
    if (!entradaMapa && typeof entrada !== "string") {
      return { acao: "bloquear", motivo: "ferramenta de terminal sem comando (falha fechada)" };
    }
    const comandoRaw = entradaMapa ? (entradaMapa.command ?? entradaMapa.cmd) : entrada;
    if (typeof comandoRaw !== "string" && !Array.isArray(comandoRaw)) {
      return { acao: "bloquear", motivo: "ferramenta de terminal com comando inválido (falha fechada)" };
    }
    const cmdTexto = typeof comandoRaw === "string" ? comandoRaw : comandoRaw.join(" ");

    const workdirRel = entradaMapa ? (entradaMapa.workdir ?? entradaMapa.dir_path ?? ".") : ".";
    const base = isAbsolute(String(workdirRel)) ? resolve(String(workdirRel)) : resolve(cwd, String(workdirRel));

    const isWindows = nomeEfetivo === "powershell" || nomeEfetivo === "pwsh" ||
      (Array.isArray(comandoRaw) && /^(?:powershell|pwsh)(?:\.exe)?$/i.test(String(comandoRaw[0]))) ||
      (process.platform === "win32" && !/bash/i.test(nomeEfetivo));

    return decidirTerminalVerified(cmdTexto, isWindows, base, raiz, ambiente);
  }

  // 3. Write / write_file
  if (FERRAMENTAS_WRITE.has(nomeEfetivo)) {
    if (!entradaMapa) {
      return { acao: "bloquear", motivo: "ferramenta de escrita sem entrada (falha fechada)" };
    }
    const caminho = entradaMapa.file_path ?? entradaMapa.filePath ?? entradaMapa.path ?? entradaMapa.target_path;
    if (typeof caminho !== "string" || !caminho.trim()) {
      return { acao: "bloquear", motivo: "ferramenta de escrita sem caminho de arquivo (falha fechada)" };
    }
    const conteudo = typeof entradaMapa.content === "string" ? entradaMapa.content : "";

    const wiki = caminhoWiki(raiz, ambiente);
    const abs = isAbsolute(caminho)
      ? resolve(caminho)
      : (caminho.startsWith("wiki/") || caminho.startsWith("wiki\\"))
        ? resolve(wiki, caminho.slice(5))
        : resolve(cwd, caminho);

    return verificarMudancaVerified(abs, conteudo, raiz, ambiente);
  }

  // 4. Edit / replace
  if (FERRAMENTAS_EDIT.has(nomeEfetivo)) {
    if (!entradaMapa) {
      return { acao: "bloquear", motivo: "ferramenta de edição sem entrada (falha fechada)" };
    }
    const caminho = entradaMapa.file_path ?? entradaMapa.filePath ?? entradaMapa.path ?? entradaMapa.target_path;
    if (typeof caminho !== "string" || !caminho.trim()) {
      return { acao: "bloquear", motivo: "ferramenta de edição sem caminho de arquivo (falha fechada)" };
    }
    const oldStr = entradaMapa.old_string ?? entradaMapa.oldText;
    const newStr = entradaMapa.new_string ?? entradaMapa.newText;
    if (typeof oldStr !== "string" || typeof newStr !== "string") {
      return { acao: "bloquear", motivo: "ferramenta de edição com old_string ou new_string ausente (falha fechada)" };
    }
    const replaceAll = Boolean(entradaMapa.replace_all ?? entradaMapa.replaceAll);

    const wiki = caminhoWiki(raiz, ambiente);
    const abs = isAbsolute(caminho)
      ? resolve(caminho)
      : (caminho.startsWith("wiki/") || caminho.startsWith("wiki\\"))
        ? resolve(wiki, caminho.slice(5))
        : resolve(cwd, caminho);

    let textoAtual = "";
    try {
      textoAtual = await readFile(abs, "utf8");
    } catch (erro) {
      return { acao: "bloquear", motivo: `falha ao ler arquivo em wiki/ para edição: ${(erro as Error).message}` };
    }

    let novoTexto = textoAtual;
    if (replaceAll) {
      if (!textoAtual.includes(oldStr)) {
        return { acao: "bloquear", motivo: "texto original não encontrado no arquivo (falha fechada)" };
      }
      novoTexto = textoAtual.replaceAll(oldStr, newStr);
    } else {
      const idx = textoAtual.indexOf(oldStr);
      if (idx < 0) {
        return { acao: "bloquear", motivo: "texto original não encontrado no arquivo (falha fechada)" };
      }
      novoTexto = textoAtual.slice(0, idx) + newStr + textoAtual.slice(idx + oldStr.length);
    }
    return verificarMudancaVerified(abs, novoTexto, raiz, ambiente);
  }

  // 5. MultiEdit
  if (FERRAMENTAS_MULTIEDIT.has(nomeEfetivo)) {
    if (!entradaMapa) {
      return { acao: "bloquear", motivo: "ferramenta de multiedit sem entrada (falha fechada)" };
    }
    const caminho = entradaMapa.file_path ?? entradaMapa.filePath ?? entradaMapa.path ?? entradaMapa.target_path;
    if (typeof caminho !== "string" || !caminho.trim()) {
      return { acao: "bloquear", motivo: "ferramenta de multiedit sem caminho de arquivo (falha fechada)" };
    }
    if (!Array.isArray(entradaMapa.edits) || entradaMapa.edits.length === 0) {
      return { acao: "bloquear", motivo: "ferramenta de multiedit sem array edits (falha fechada)" };
    }

    const wiki = caminhoWiki(raiz, ambiente);
    const abs = isAbsolute(caminho)
      ? resolve(caminho)
      : (caminho.startsWith("wiki/") || caminho.startsWith("wiki\\"))
        ? resolve(wiki, caminho.slice(5))
        : resolve(cwd, caminho);

    let textoAtual = "";
    try {
      textoAtual = await readFile(abs, "utf8");
    } catch (erro) {
      return { acao: "bloquear", motivo: `falha ao ler arquivo em wiki/ para edição: ${(erro as Error).message}` };
    }

    let simulado = textoAtual;
    for (const item of entradaMapa.edits) {
      if (!mapa(item)) return { acao: "bloquear", motivo: "edição inválida no edits (falha fechada)" };
      const ant = typeof item.old_string === "string" ? item.old_string : typeof item.oldText === "string" ? String(item.oldText) : undefined;
      const nov = typeof item.new_string === "string" ? item.new_string : typeof item.newText === "string" ? String(item.newText) : undefined;
      if (ant === undefined || nov === undefined) {
        return { acao: "bloquear", motivo: "edição com old_string ou new_string ausente em edits (falha fechada)" };
      }
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

  // 6. Ferramentas de Leitura
  if (FERRAMENTAS_LEITURA.has(nomeEfetivo)) {
    return { acao: "liberar", motivo: "ferramenta de leitura" };
  }

  // 7. Ferramenta desconhecida mexendo em wiki/
  if (payload.includes("wiki/") || payload.includes(".md")) {
    return { acao: "bloquear", motivo: `ferramenta desconhecida (${nome}) referenciando wiki/ ou .md (falha fechada)` };
  }

  // 8. Payload genérico sem ferramentas isoláveis
  if (/(?:aprovarPaginas|aprovarPelaInterface|comandos[\\/]aprovar)/i.test(payload)) {
    return { acao: "bloquear", motivo: "payload cita aprovação (falha fechada)" };
  }
  if ((/verified/i.test(payload) || /\bby\s*:\s*human:/i.test(payload)) && (/(?:^|[\s"'\`\\/])wiki(?:[\\/]|$)/i.test(payload) || /\.md\b/i.test(payload))) {
    return { acao: "bloquear", motivo: "payload cita verified em wiki (falha fechada)" };
  }

  return { acao: "liberar", motivo: "payload sem referência a verified em wiki/" };
}
