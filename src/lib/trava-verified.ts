import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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

type RegraOpcaoCurta = { recebeValor?: boolean; destino?: boolean; diretorio?: boolean; valorOpcionalColado?: boolean };
type ResultadoOpcoesCurtas = {
  operandos: string[];
  destinos: string[];
  diretorios: string[];
  letras: Set<string>;
  consumiuProximo: boolean;
  malformado: boolean;
};

const OPCOES_CURTAS_POR_VERBO: Record<string, Record<string, RegraOpcaoCurta>> = {
  cp: { t: { recebeValor: true, destino: true }, S: { recebeValor: true } },
  mv: { t: { recebeValor: true, destino: true }, S: { recebeValor: true } },
  ln: { t: { recebeValor: true, destino: true }, S: { recebeValor: true } },
  install: {
    t: { recebeValor: true, destino: true }, S: { recebeValor: true },
    m: { recebeValor: true }, o: { recebeValor: true }, g: { recebeValor: true },
  },
  sed: {
    i: { valorOpcionalColado: true }, e: { recebeValor: true }, f: { recebeValor: true }, l: { recebeValor: true },
  },
  perl: { i: { valorOpcionalColado: true }, e: { recebeValor: true }, E: { recebeValor: true } },
  // Ruby -E recebe encoding; só -e recebe código inline.
  ruby: { i: { valorOpcionalColado: true }, e: { recebeValor: true }, E: { recebeValor: true } },
  time: { o: { recebeValor: true, destino: true }, f: { recebeValor: true } },
  git: { o: { recebeValor: true, destino: true } },
  tee: {},
  // rsync -t preserva horários; não recebe valor e nunca escolhe destino.
  rsync: { t: {} },
  // tee escreve nos operandos; dd usa of=FILE. Nenhum tem opção curta de valor que selecione destino.
};

function analisarOpcoesCurtas(args: string[], regras: Record<string, RegraOpcaoCurta>): ResultadoOpcoesCurtas {
  const operandos: string[] = [];
  const destinos: string[] = [];
  const diretorios: string[] = [];
  const letras = new Set<string>();
  let consumiuProximo = false;
  let terminouOpcoes = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (terminouOpcoes) {
      operandos.push(arg);
      continue;
    }
    if (arg === "--") {
      terminouOpcoes = true;
      continue;
    }
    if (!/^-[^-]/.test(arg)) {
      if (arg === "-" || !arg.startsWith("-")) operandos.push(arg);
      continue;
    }

    const grupo = arg.slice(1);
    for (let j = 0; j < grupo.length; j++) {
      const letra = grupo[j]!;
      letras.add(letra);
      const regra = regras[letra];
      if (!regra) continue;
      const restante = grupo.slice(j + 1);
      if (regra.valorOpcionalColado) {
        // sed/perl/ruby -i aceitam sufixo só colado; -i sozinho não consome o próximo.
        break;
      }
      if (regra.recebeValor) {
        const valor = restante || args[i + 1];
        if (valor === undefined) {
          return { operandos, destinos, diretorios, letras, consumiuProximo, malformado: true };
        }
        if (regra.destino) destinos.push(valor);
        if (regra.diretorio) diretorios.push(valor);
        if (!restante) {
          i++;
          consumiuProximo = true;
        }
        break;
      }
    }
  }

  return { operandos, destinos, diretorios, letras, consumiuProximo, malformado: false };
}

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

function extrairDestinoOpcaoLongaGnu(
  arg: string,
  proximo: string | undefined,
  nomeCompleto: string
): { bateu: boolean; valor?: string; consumiuProximo: boolean } {
  if (!arg.startsWith("--") || arg.length < 3) {
    return { bateu: false, consumiuProximo: false };
  }
  const prefixoMinimo = nomeCompleto.slice(0, 3);
  if (!opcaoLongaGnu(arg, nomeCompleto, prefixoMinimo)) {
    return { bateu: false, consumiuProximo: false };
  }
  if (arg.includes("=")) {
    return { bateu: true, valor: arg.slice(arg.indexOf("=") + 1), consumiuProximo: false };
  }
  return { bateu: true, valor: proximo, consumiuProximo: proximo !== undefined };
}

function extrairDestinoGit(
  arg: string,
  proximo: string | undefined
): { bateu: boolean; valor?: string; consumiuProximo: boolean } {
  const gnuDir = extrairDestinoOpcaoLongaGnu(arg, proximo, "--output-directory");
  if (gnuDir.bateu) return gnuDir;
  return extrairDestinoOpcaoLongaGnu(arg, proximo, "--output");
}

function desembrulhar(verbo: string, args: string[]): { resto: string[]; descartados: string[]; diretorios: string[]; malformado: boolean } {
  const { valor, longas = [], posicionais = 0 } = OPCOES_ENVOLVEDOR[verbo] ?? { valor: [] };
  const diretorios: string[] = [];
  const regrasDiretorio: Record<string, RegraOpcaoCurta> = verbo === "env" ? { C: { recebeValor: true, diretorio: true } }
    : verbo === "sudo" ? { D: { recebeValor: true, diretorio: true } } : {};
  const regrasCurtas = {
    ...Object.fromEntries(valor.map(opcao => [opcao.slice(1), { recebeValor: true }])),
    ...(OPCOES_CURTAS_POR_VERBO[verbo] ?? {}),
    ...regrasDiretorio,
  };
  const sai = (i: number, extra: string[] = []) => ({ resto: [...extra, ...args.slice(i)], descartados: args.slice(0, i), diretorios, malformado: false });
  let pular = posicionais;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (/^[A-Za-z_]\w*=/.test(arg)) continue;
    if (arg === "--") return sai(i + 1);
    const ehS = verbo === "env" && ((arg.startsWith("-S") && !arg.startsWith("--")) || opcaoLongaGnu(arg, "--split-string", "--s"));
    if (ehS) {
      const colado = arg.startsWith("--") ? (arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : undefined) : arg.slice(2) || undefined;
      const texto = (colado ?? args[i + 1] ?? "").replaceAll("\\_", " ");
      return { resto: [...texto.split(/\s+/).filter(Boolean), ...args.slice(colado !== undefined ? i + 1 : i + 2)], descartados: args.slice(0, i), diretorios, malformado: false };
    }
    if (arg.startsWith("-")) {
      const longa = longas.find(([nome, minimo]) => opcaoLongaGnu(arg, nome, minimo));
      const regraCurta = OPCOES_CURTAS_POR_VERBO[verbo];
      if ((regraCurta || valor.length > 0 || Object.keys(regrasDiretorio).length > 0) && /^-[^-]/.test(arg)) {
        const curto = analisarOpcoesCurtas([arg, args[i + 1]].filter((v): v is string => v !== undefined), regrasCurtas);
        if (curto.malformado) return { resto: [], descartados: args, diretorios, malformado: true };
        diretorios.push(...curto.diretorios);
        if (curto.consumiuProximo) i++;
      } else if (valor.includes(arg) || (longa !== undefined && !longa[2] && !arg.includes("="))) {
        if (longa && ((verbo === "env" && longa[0] === "--chdir") || (verbo === "sudo" && longa[0] === "--chdir"))) {
          const dir = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args[i + 1];
          if (dir === undefined || dir === "") return { resto: [], descartados: args, diretorios, malformado: true };
          diretorios.push(dir);
        }
        i++;
      } else if (longa && ((verbo === "env" && longa[0] === "--chdir") || (verbo === "sudo" && longa[0] === "--chdir"))) {
        const dir = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args[i + 1];
        if (dir === undefined || dir === "") return { resto: [], descartados: args, diretorios, malformado: true };
        diretorios.push(dir);
        if (!arg.includes("=")) i++;
      }
      continue;
    }
    if (pular > 0) { pular--; continue; }
    return sai(i);
  }
  return { resto: [], descartados: args, diretorios, malformado: false };
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

export function temSchemaEWiki(dir: string): boolean {
  try {
    return existsSync(join(dir, "SCHEMA.md")) &&
      (existsSync(join(dir, "wiki")) || existsSync(join(dir, "WIKI")) || existsSync(join(dir, "Wiki")) || existsSync(join(dir, "wIkI")));
  } catch {
    return false;
  }
}

export function buscarAncestralVault(inicio: string): string | undefined {
  let atual = resolve(inicio);
  while (true) {
    if (temSchemaEWiki(atual)) {
      return atual;
    }
    const pai = dirname(atual);
    if (pai === atual) break;
    atual = pai;
  }
  return undefined;
}

export function resolverAncestralRealComResto(caminho: string, base?: string): string {
  return caminhoReal(caminho, base);
}

export function encontrarRaizVault(
  cwdOuAlvo?: string,
  ambiente: Record<string, string | undefined> = process.env
): string {
  if (typeof cwdOuAlvo === "string" && cwdOuAlvo.trim()) {
    const achado = buscarAncestralVault(cwdOuAlvo.trim());
    if (achado) return achado;
  }
  if (ambiente.ANVILORE_DESTINO && ambiente.ANVILORE_DESTINO.trim()) {
    return resolve(ambiente.ANVILORE_DESTINO.trim());
  }
  if (ambiente.ANVILORE_WIKI && ambiente.ANVILORE_WIKI.trim()) {
    const paiWiki = dirname(resolve(ambiente.ANVILORE_WIKI.trim()));
    if (temSchemaEWiki(paiWiki)) {
      return paiWiki;
    }
  }
  return resolve(import.meta.dir, "../..");
}

function caminhoEstaSobWikiDaRaiz(
  caminho: string,
  raizCandidata: string,
  ambiente: Record<string, string | undefined> = process.env
): boolean {
  if (ambiente.ANVILORE_WIKI) {
    const wikiEnv = resolve(ambiente.ANVILORE_WIKI);
    const rel1 = relative(wikiEnv, caminho);
    if (rel1 === "" || (rel1 !== ".." && !rel1.startsWith(`..${sep}`) && !rel1.startsWith("../") && !isAbsolute(rel1))) {
      return true;
    }
    let wikiEnvReal = wikiEnv;
    try { wikiEnvReal = realpathSync.native(wikiEnv); } catch {}
    const rel2 = relative(wikiEnvReal, caminho);
    if (rel2 === "" || (rel2 !== ".." && !rel2.startsWith(`..${sep}`) && !rel2.startsWith("../") && !isAbsolute(rel2))) {
      return true;
    }
  }

  // Raiz candidata deve ser um vault com SCHEMA.md e wiki/ (a menos que ANVILORE_WIKI defina o caminho direto)
  if (!temSchemaEWiki(raizCandidata)) {
    return false;
  }

  const rel = relative(raizCandidata, caminho);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith("../") || isAbsolute(rel)) {
    return false;
  }
  const primeiro = rel.split(/[\\/]/)[0];
  if (!primeiro) return false;
  return primeiro.replace(/[. ]+$/, "").toLowerCase() === "wiki";
}

export function estaSobWiki(
  caminhoAlvo: string,
  raizPadrao: string,
  ambiente: Record<string, string | undefined> = process.env,
  cwd?: string
): boolean {
  const cwdEfetivo = cwd ?? (typeof process !== "undefined" ? process.cwd() : raizPadrao);
  const abs = isAbsolute(caminhoAlvo) ? resolve(caminhoAlvo) : resolve(cwdEfetivo, caminhoAlvo);
  // Classifique as duas interpretações: texto lexical e percurso físico do sistema.
  // No POSIX, caminhoReal precisa receber o texto original para respeitar symlink/../.
  const real = resolverAncestralRealComResto(caminhoAlvo, cwdEfetivo);

  if (ambiente.ANVILORE_WIKI) {
    const wikiEnv = resolve(ambiente.ANVILORE_WIKI);
    let wikiEnvReal = wikiEnv;
    try { wikiEnvReal = realpathSync.native(wikiEnv); } catch {}
    if (dentroDe(abs, wikiEnv) || dentroDe(real, wikiEnv) || dentroDe(abs, wikiEnvReal) || dentroDe(real, wikiEnvReal)) {
      return true;
    }
  }

  const candidatas = new Set<string>();

  const candAbs = buscarAncestralVault(dirname(abs));
  if (candAbs) candidatas.add(candAbs);

  const candReal = buscarAncestralVault(dirname(real));
  if (candReal) candidatas.add(candReal);

  const raizA1 = encontrarRaizVault(cwd ?? raizPadrao, ambiente);
  if (raizA1 && temSchemaEWiki(raizA1)) candidatas.add(raizA1);

  if (raizPadrao && temSchemaEWiki(raizPadrao)) candidatas.add(resolve(raizPadrao));
  if (ambiente.ANVILORE_DESTINO && temSchemaEWiki(resolve(ambiente.ANVILORE_DESTINO))) candidatas.add(resolve(ambiente.ANVILORE_DESTINO));
  if (ambiente.ANVILORE_WIKI) {
    if (raizPadrao) candidatas.add(resolve(raizPadrao));
    candidatas.add(dirname(resolve(ambiente.ANVILORE_WIKI)));
  }

  for (const cand of candidatas) {
    if (caminhoEstaSobWikiDaRaiz(abs, cand, ambiente) || caminhoEstaSobWikiDaRaiz(real, cand, ambiente)) {
      return true;
    }
  }

  return false;
}

export async function verificarMudancaVerified(
  caminhoAbsoluto: string,
  novoTexto: string,
  raiz: string,
  ambiente: Record<string, string | undefined> = process.env,
  cwd?: string
): Promise<Decisao> {
  if (!estaSobWiki(caminhoAbsoluto, raiz, ambiente, cwd)) {
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

  if (!fmDepois && (/\bverified\s*:/i.test(novoTexto) || /\bby\s*:\s*human:/i.test(novoTexto))) {
    return { acao: "bloquear", motivo: `tentativa de introduzir verified em arquivo sem frontmatter válido: ${caminhoAbsoluto}` };
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
    if (!estaSobWiki(abs, raiz, ambiente, cwd)) continue;

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
        if (estaSobWiki(absOrigem, raiz, ambiente, cwd)) {
          const decisaoOrigem = await verificarMudancaVerified(absOrigem, "", raiz, ambiente, cwd);
          if (decisaoOrigem.acao === "bloquear") return decisaoOrigem;
        }
      }
    }

    const decisao = await verificarMudancaVerified(abs, novoConteudo, raiz, ambiente, cwd);
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
      } else if (!windows && aspas === '"' && caractere === "\\" && (seguinte === "\n" || (seguinte === "\r" && comando[i + 2] === "\n"))) {
        i += seguinte === "\r" ? 2 : 1;
      } else if (!windows && aspas === '"' && caractere === "\\" && /["\\$`]/.test(seguinte) && seguinte) {
        palavra += comando[++i];
      } else if (aspas === '"' && (caractere === "`" || (caractere === "$" && /[({]/.test(seguinte) && seguinte))) {
        throw new Error("subshell ou expansão não interpretável");
      } else {
        palavra += caractere;
      }
    } else if (caractere === "'" || caractere === '"') {
      aspas = caractere;
    } else if (!windows && caractere === "\\" && (seguinte === "\n" || (seguinte === "\r" && comando[i + 2] === "\n"))) {
      i += seguinte === "\r" ? 2 : 1;
    } else if (!windows && caractere === "\\" && seguinte && /[\s'";|&<>\\]/.test(seguinte)) {
      palavra += comando[++i];
    } else if (caractere === "`" || caractere === "(" || caractere === ")" || (caractere === "$" && /[({]/.test(seguinte) && seguinte)) {
      throw new Error("subshell ou expansão não interpretável");
    } else if (caractere === "<" && seguinte === "<") {
      throw new Error("heredoc não interpretável");
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

function analisarGit(args: string[]): { subcomando?: string; globais: string[]; diretorios: string[]; malformado: boolean } {
  const globais: string[] = [];
  const diretorios: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-C" || args[i] === "-c") {
      const valor = args[++i];
      if (valor === undefined || valor === "") return { globais, diretorios, malformado: true };
      globais.push(args[i - 1]!, valor);
      if (args[i - 1] === "-C") diretorios.push(valor);
    }
    else if (args[i]!.startsWith("-")) globais.push(args[i]!);
    else return { subcomando: args[i]?.toLowerCase(), globais, diretorios, malformado: false };
  }
  return { globais, diretorios, malformado: false };
}

function resolverDiretorioEfetivo(base: string, diretorio: string): string | undefined {
  // These tokens require shell expansion or describe a set of paths, so their cwd cannot be proven.
  // `~` só expande no começo da palavra: no meio é literal (RUNNER~1, o nome curto 8.3 do tmpdir() do runner do Windows).
  if (!diretorio || diretorio.startsWith("~") || /[$`*?\[\]{}]/.test(diretorio)) return undefined;
  try {
    const abs = caminhoReal(resolve(base, diretorio), base);
    return statSync(abs).isDirectory() ? abs : undefined;
  } catch {
    return undefined;
  }
}

function extrairDiretoriosC(args: string[]): { diretorios: string[]; malformado: boolean } {
  const curto = analisarOpcoesCurtas(args, { C: { recebeValor: true, diretorio: true } });
  if (curto.malformado) return { diretorios: [], malformado: true };
  const diretorios = [...curto.diretorios];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--") break;
    if (arg.startsWith("--") && opcaoLongaGnu(arg, "--directory", "--direc")) {
      const valor = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args[i + 1];
      if (valor === undefined || valor === "") return { diretorios: [], malformado: true };
      diretorios.push(valor);
      if (!arg.includes("=")) i++;
    }
  }
  return { diretorios, malformado: false };
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

  const semGlob = limpo.includes("*") || limpo.includes("?")
    ? limpo.replace(/[*?].*$/, "")
    : limpo;
  const caminhoParaResolver = semGlob || ".";

  return estaSobWiki(caminhoParaResolver, raiz, ambiente, base) || estaSobWiki(caminhoParaResolver, raiz, ambiente, raiz);
}

const MSG_TERMINAL_WIKI = "Edite páginas da wiki pelas ferramentas de edição (Write/Edit/apply_patch); o terminal não escreve em wiki/.";

function estaSobTmp(abs: string, real: string): boolean {
  const normAbs = abs.replace(/\\/g, "/");
  const normReal = real.replace(/\\/g, "/");
  if (normAbs === "/tmp" || normAbs.startsWith("/tmp/") || normReal === "/tmp" || normReal.startsWith("/tmp/")) {
    return true;
  }
  if (normAbs === "/private/tmp" || normAbs.startsWith("/private/tmp/") || normReal === "/private/tmp" || normReal.startsWith("/private/tmp/")) {
    return true;
  }
  const tDir = tmpdir().replace(/\\/g, "/");
  const tDirComBarra = tDir.endsWith("/") ? tDir : `${tDir}/`;
  if (normAbs === tDir || normAbs.startsWith(tDirComBarra) || normReal === tDir || normReal.startsWith(tDirComBarra)) {
    return true;
  }
  return false;
}

function destinoEhSeguro(
  alvo: string,
  base: string,
  raiz: string,
  ambiente: Record<string, string | undefined>
): boolean {
  const limpo = alvo.replace(/^["']|["']$/g, "").trim();
  if (!limpo) return false;
  if (limpo === "/dev/null" || limpo.toLowerCase() === "nul" || limpo === "&1" || limpo === "&2") return true;
  // Destinos com expansão de shell não podem ser classificados como caminho físico.
  if (/[$`%*?\[\]{}]/.test(limpo) || limpo.startsWith("~")) return false;

  // 1. Resolve o destino (normaliza .., realpath do pai existente) e classifica com estaSobWiki ANTES de qualquer isenção
  if (estaSobWiki(limpo, raiz, ambiente, base) || estaSobWiki(limpo, raiz, ambiente, raiz)) {
    return false;
  }

  // 2. A isenção de /tmp só vale para destino resolvido que NÃO está sob a wiki
  const abs = isAbsolute(limpo) ? resolve(limpo) : resolve(base, limpo);
  const real = resolverAncestralRealComResto(limpo, base);
  if (estaSobTmp(abs, real)) {
    return true;
  }

  if (isAbsolute(limpo)) {
    return true;
  }

  // Um caminho relativo literal fora de qualquer wiki reconhecível é seguro para esta trava.
  // estaSobWiki acima já resolve symlinks e ancestrais físicos antes desta liberação.
  return true;
}

function argumentoTocaWiki(
  arg: string,
  base: string,
  raiz: string,
  ambiente: Record<string, string | undefined>
): boolean {
  const limpo = arg.replace(/^["']|["']$/g, "").trim();
  if (!limpo) return false;
  const candidatas = [limpo];
  if (limpo.includes("=")) {
    const pos = limpo.indexOf("=");
    candidatas.push(limpo.slice(pos + 1).replace(/^["']|["']$/g, "").trim());
  }
  for (const cand of candidatas) {
    if (!cand || cand.startsWith("-")) continue;
    if (cand === "/dev/null" || cand === "&1" || cand === "&2" || cand.toLowerCase() === "nul") continue;
    if (caminhoTocaWiki(cand, base, raiz, ambiente)) return true;
  }
  return false;
}

function dividirEmComandosSimples(tokens: Token[]): Array<{ tokens: Token[]; doPipe: boolean }> {
  const comandos: Array<{ tokens: Token[]; doPipe: boolean }> = [];
  let atual: Token[] = [];
  let recebePipe = false;
  for (const token of tokens) {
    if (token.operador && /^[;&|]+$/.test(token.texto)) {
      if (atual.length > 0) {
        comandos.push({ tokens: atual, doPipe: recebePipe });
        atual = [];
      }
      // Só `|` simples alimenta o comando seguinte pela entrada padrão (`||` e `&&` não).
      recebePipe = token.texto === "|";
    } else {
      atual.push(token);
    }
  }
  if (atual.length > 0) comandos.push({ tokens: atual, doPipe: recebePipe });
  return comandos;
}

// Escrita em massa: o destino que importa não é só a wiki, é também todo ANCESTRAL dela (a raiz do cofre, a pasta acima).
// Quem escreve vários arquivos num ancestral cria descendentes na wiki (`cp -R stage/. <cofre>/` leva `stage/wiki/a.md`
// para `<cofre>/wiki/a.md`) sem que o operando de destino cite a wiki. Aqui o destino é julgado pelo disco, não pelo
// texto, e SEM a isenção de /tmp: o cofre de teste e o de muita gente moram sob /tmp.
const EXPANSAO_DE_SHELL = /[$`%*?\[\]{}]/;

function nomeEhWiki(nome: string): boolean {
  return nome.replace(/[. ]+$/, "").toLowerCase() === "wiki";
}

function wikisConhecidas(
  base: string,
  raiz: string,
  ambiente: Record<string, string | undefined>,
  raizesExtras: string[]
): Set<string> {
  const wikis = new Set<string>();
  const adicionar = (caminho: string) => {
    wikis.add(resolve(caminho));
    try { wikis.add(caminhoReal(caminho, base)); } catch { /* o destino é julgado por quem chama */ }
  };
  const raizes = new Set<string>([raiz, base, ...raizesExtras]);
  const ancestralDoBase = buscarAncestralVault(base);
  if (ancestralDoBase) raizes.add(ancestralDoBase);
  if (ambiente.ANVILORE_DESTINO?.trim()) raizes.add(resolve(ambiente.ANVILORE_DESTINO.trim()));
  if (ambiente.ANVILORE_WIKI?.trim()) {
    const wikiEnv = resolve(ambiente.ANVILORE_WIKI.trim());
    adicionar(wikiEnv);
    raizes.add(dirname(wikiEnv));
  }
  for (const candidata of raizes) {
    if (!temSchemaEWiki(candidata)) continue;
    try {
      for (const nome of readdirSync(candidata)) if (nomeEhWiki(nome)) adicionar(join(candidata, nome));
    } catch { /* sem leitura: as outras leituras do mesmo cofre continuam valendo */ }
  }
  return wikis;
}

// O destino é a própria wiki ou um ancestral dela, pelo caminho lexical e pelo físico (links seguidos).
// Falha fechada: destino que não se resolve é tratado como perigoso.
function ehDestinoPerigoso(
  destino: string,
  base: string,
  raiz: string,
  ambiente: Record<string, string | undefined>
): boolean {
  const limpo = destino.replace(/^["']|["']$/g, "").trim();
  if (!limpo) return true;
  try {
    const abs = resolve(base, limpo);
    const real = caminhoReal(limpo, base);
    const wikis = wikisConhecidas(base, raiz, ambiente, [abs, real]);
    for (const wiki of wikis) if (dentroDe(wiki, abs) || dentroDe(wiki, real)) return true;
    return false;
  } catch {
    return true;
  }
}

function origemEhArquivoRegular(origem: string, base: string): boolean {
  const limpo = origem.replace(/^["']|["']$/g, "").trim();
  if (!limpo || limpo === "-" || EXPANSAO_DE_SHELL.test(limpo) || limpo.startsWith("~")) return false;
  try {
    return lstatSync(resolve(base, limpo)).isFile();
  } catch {
    return false;
  }
}

function origemEhDiretorioOuIncerta(origem: string, base: string): boolean {
  const limpo = origem.replace(/^["']|["']$/g, "").trim();
  if (!limpo || EXPANSAO_DE_SHELL.test(limpo) || limpo.startsWith("~")) return true;
  try {
    return statSync(resolve(base, limpo)).isDirectory();
  } catch {
    return false;
  }
}

// Onde `cp`/`mv`/`ln`/`install` põem a origem quando o destino é um diretório: destino/nome-da-origem.
function destinoFinal(origem: string, diretorio: string): string | undefined {
  const nome = basename(origem.replace(/^["']|["']$/g, "").replace(/[\\/]+$/, ""));
  if (!nome || nome === "." || nome === "..") return undefined;
  return join(diretorio, nome);
}

function opcaoLongaPresente(args: string[], nomeCompleto: string, prefixoMinimo: string): boolean {
  for (const arg of args) {
    if (arg === "--") break;
    if (arg.startsWith("--") && opcaoLongaGnu(arg, nomeCompleto, prefixoMinimo)) return true;
  }
  return false;
}

function copiaRecursiva(args: string[], letras: Set<string>): boolean {
  return letras.has("r") || letras.has("R") || letras.has("a")
    || opcaoLongaPresente(args, "--recursive", "--r")
    || opcaoLongaPresente(args, "--archive", "--a")
    || opcaoLongaPresente(args, "--parents", "--p");
}

// Motivo do bloqueio quando cp/mv/ln/install/rsync escrevem em massa num destino que é a wiki ou ancestral dela.
function escritaEmMassaNoAncestral(
  verbo: string,
  args: string[],
  letras: Set<string>,
  fontes: string[],
  destinos: string[],
  base: string,
  raiz: string,
  ambiente: Record<string, string | undefined>
): string | undefined {
  const perigosos = destinos.filter(destino => ehDestinoPerigoso(destino, base, raiz, ambiente));
  if (!perigosos.length) return undefined;
  const alvo = `${verbo} com destino que é a wiki ou ancestral dela`;

  if (verbo === "rsync") return `${alvo} (rsync é recursivo; falha fechada)`;
  if (verbo === "cp" && copiaRecursiva(args, letras)) return `${alvo} (cópia recursiva cria descendentes na wiki; falha fechada)`;
  if (verbo === "mv" && (letras.has("T") || opcaoLongaPresente(args, "--no-target-directory", "--no"))) {
    return `${alvo} (mv -T; falha fechada)`;
  }

  for (const fonte of fontes) {
    if (verbo === "mv" && !origemEhArquivoRegular(fonte, base)) {
      return `${alvo} (origem não comprovada como arquivo regular; falha fechada)`;
    }
    if (verbo === "ln" && origemEhDiretorioOuIncerta(fonte, base)) {
      return `${alvo} (ln de diretório ou origem não comprovada; falha fechada)`;
    }
    for (const destino of perigosos) {
      const final = destinoFinal(fonte, resolve(base, destino));
      if (!final || caminhoTocaWiki(final, base, raiz, ambiente) || ehDestinoPerigoso(final, base, raiz, ambiente)) {
        return `${alvo} (o destino final cai na wiki; falha fechada)`;
      }
    }
  }
  return undefined;
}

function tarExtrai(args: string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--") break;
    if (arg.startsWith("--")) {
      if (opcaoLongaGnu(arg, "--extract", "--ex") || opcaoLongaGnu(arg, "--get", "--ge")) return true;
    } else if (/^-[^-]/.test(arg)) {
      if (arg.slice(1).includes("x")) return true;
    } else if (i === 0 && /^[A-Za-z]+$/.test(arg) && arg.includes("x")) {
      return true;
    }
  }
  return false;
}

function tarCaminhosAbsolutos(args: string[]): boolean {
  return args.some((arg, indice) => (/^-[^-]/.test(arg) && arg.slice(1).includes("P"))
    || (indice === 0 && /^[A-Za-z]+$/.test(arg) && arg.includes("P"))
    || (arg.startsWith("--") && opcaoLongaGnu(arg, "--absolute-names", "--abs")));
}

// Extratores que gravam sob um diretório escolhido (ou o cwd): o conteúdo do pacote decide o que nasce lá.
function extratorNoAncestral(
  verbo: string,
  args: string[],
  base: string,
  raiz: string,
  ambiente: Record<string, string | undefined>
): string | undefined {
  let diretorios: string[] | undefined;
  if (verbo === "unzip") {
    const opcoes = analisarOpcoesCurtas(args, { d: { recebeValor: true, destino: true } });
    if (opcoes.malformado) return "unzip com -d sem diretório (falha fechada)";
    if (["l", "t", "p", "v", "Z"].some(letra => opcoes.letras.has(letra))) return undefined;
    // -: e -^ mantêm caminhos absolutos e `..` do pacote: o pacote escolhe onde grava.
    if (opcoes.letras.has(":") || opcoes.letras.has("^")) return "unzip mantém caminhos do pacote (falha fechada)";
    diretorios = opcoes.destinos.length ? opcoes.destinos : ["."];
  } else if (/^7z[a-z]?$/.test(verbo)) {
    const comando = args.find(arg => !arg.startsWith("-"))?.toLowerCase();
    if (comando !== "x" && comando !== "e") return undefined;
    if (args.some(arg => /^-spf/i.test(arg))) return `${verbo} com caminhos absolutos do pacote (falha fechada)`;
    const saidas = args.filter(arg => /^-o./i.test(arg) && !arg.startsWith("--")).map(arg => arg.slice(2));
    diretorios = saidas.length ? saidas : ["."];
  }
  if (!diretorios) return undefined;
  for (const diretorio of diretorios) {
    if (EXPANSAO_DE_SHELL.test(diretorio) || diretorio.startsWith("~") || ehDestinoPerigoso(diretorio, base, raiz, ambiente)) {
      return `${verbo} extrai para a wiki ou para um ancestral dela (falha fechada)`;
    }
  }
  return undefined;
}

const GIT_SEM_ARVORE = new Set([
  ...GIT_LEITURA, "fetch", "push", "remote", "config", "ls-remote", "archive", "bundle", "format-patch",
  "for-each-ref", "show-ref", "version", "help", "init",
]);
const GIT_CLONE_COM_VALOR = new Set([
  "-b", "--branch", "-o", "--origin", "--depth", "-j", "--jobs", "--reference", "--reference-if-able", "--template",
  "--separate-git-dir", "--filter", "--config", "-c", "-u", "--upload-pack", "--shallow-since", "--shallow-exclude",
  "--server-option", "--bundle-uri", "--revision", "--ref-format",
]);

function analisarGitArvore(args: string[]): { subcomando?: string; resto: string[]; arvores: string[]; configWorktree: boolean } {
  const arvores: string[] = [];
  let configWorktree = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    // --config-env=core.worktree=VAR lê o valor de uma variável de ambiente: o valor não se prova, só a chave.
    if (arg.startsWith("--") && opcaoLongaGnu(arg, "--config-env", "--config-e")) {
      const valor = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args[++i];
      if (/^core\.worktree=/i.test(valor ?? "")) configWorktree = true;
      continue;
    }
    if (arg === "-c" && /^core\.worktree=/i.test(args[i + 1] ?? "")) arvores.push(args[i + 1]!.slice(args[i + 1]!.indexOf("=") + 1));
    if (arg === "-C" || arg === "-c") { i++; continue; }
    if (arg.startsWith("--") && opcaoLongaGnu(arg, "--work-tree", "--wo")) {
      if (arg.includes("=")) arvores.push(arg.slice(arg.indexOf("=") + 1));
      else if (args[i + 1] !== undefined) arvores.push(args[++i]!);
      continue;
    }
    if (arg.startsWith("--") && opcaoLongaGnu(arg, "--git-dir", "--gi")) {
      const valor = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args[++i];
      if (valor !== undefined) arvores.push(valor, `${valor}/..`);
      continue;
    }
    if (arg.startsWith("--") && opcaoLongaGnu(arg, "--namespace", "--na") && !arg.includes("=")) { i++; continue; }
    if (arg.startsWith("-")) continue;
    return { subcomando: arg.toLowerCase(), resto: args.slice(i + 1), arvores, configWorktree };
  }
  return { resto: [], arvores, configWorktree };
}

function posicionaisGit(resto: string[]): string[] {
  const posicionais: string[] = [];
  for (let i = 0; i < resto.length; i++) {
    const arg = resto[i]!;
    if (arg === "--") { posicionais.push(...resto.slice(i + 1)); break; }
    if (arg.startsWith("-")) {
      if (GIT_CLONE_COM_VALOR.has(arg)) i++;
      continue;
    }
    posicionais.push(arg);
  }
  return posicionais;
}

// git que grava a árvore de trabalho num cwd/worktree que é a wiki ou ancestral dela (checkout, restore, pull, clone...).
function gitNoAncestral(
  args: string[],
  arvoresDoAmbiente: string[],
  configWorktreeNoAmbiente: boolean,
  base: string,
  raiz: string,
  ambiente: Record<string, string | undefined>
): string | undefined {
  const { subcomando, resto, arvores, configWorktree } = analisarGitArvore(args);
  if (!subcomando) return undefined;
  const motivo = "git que grava a árvore de trabalho na wiki ou num ancestral dela (falha fechada)";
  // Valor que só existe em tempo de execução ($DIR, ~) não se classifica: falha fechada.
  const perigoso = (dir: string) => EXPANSAO_DE_SHELL.test(dir) || dir.startsWith("~") || ehDestinoPerigoso(dir, base, raiz, ambiente);
  const posicionais = posicionaisGit(resto);

  // core.worktree gravado na configuração fixa a árvore de trabalho dos próximos comandos: vale como o --work-tree.
  if (subcomando === "config" && !resto.some(arg => /^--(?:get|unset|list|remove|rename)/.test(arg) || arg === "-l")) {
    // Sem lista de opções com valor (as abreviações --fi, --typ mudam o que é valor) e sem confiar em `--`:
    // para cada ocorrência da chave, todo argumento depois dela é candidato a valor (ou a padrão de valor).
    for (let k = 0; k < resto.length; k++) {
      if (resto[k]!.toLowerCase() !== "core.worktree") continue;
      for (const valor of resto.slice(k + 1)) {
        // O valor relativo é lido a partir do diretório do repositório (.git).
        if (perigoso(valor) || (!isAbsolute(valor) && perigoso(join(".git", valor)))) return motivo;
      }
    }
  }
  if (configWorktree || configWorktreeNoAmbiente) {
    const gravaArvore = !(GIT_SEM_ARVORE.has(subcomando) || subcomando === "apply" || (subcomando === "worktree" && posicionais[0] === "list"));
    if (gravaArvore) return motivo;
  }

  if (subcomando === "clone") {
    const destino = posicionais.length >= 2 ? posicionais[posicionais.length - 1]! : ".";
    return perigoso(destino) ? motivo : undefined;
  }
  if (subcomando === "worktree" && posicionais[0] === "add" && posicionais.slice(1).some(perigoso)) return motivo;
  // `git apply` fica de fora: é o risco residual C18, aceito de propósito pelo desenho (DESENHO-APROVACAO.md §1).
  const somenteLeitura = GIT_SEM_ARVORE.has(subcomando) || subcomando === "apply" || (subcomando === "worktree" && posicionais[0] === "list");
  if (somenteLeitura) return undefined;
  return [".", ...arvores, ...arvoresDoAmbiente].some(perigoso) ? motivo : undefined;
}

// ---- Ferramentas de texto cuja linguagem de script grava arquivo ou executa comando (sed, awk, ed/ex/vim) ----
type EntradaDoComando = { redirecionada: boolean; dePipe: boolean; unicoComando: boolean };
type EscritaDeScript = { destinos: string[]; comandos: string[]; bloqueio?: string };

// O arquivo é lido agora, mas pode ser trocado por um comando anterior da mesma linha: com mais de um comando, não se prova.
function lerScriptLegivel(arquivo: string, base: string, unicoComando: boolean): string | undefined {
  const limpo = arquivo.replace(/^["']|["']$/g, "").trim();
  if (!unicoComando || !limpo || limpo === "-" || limpo.startsWith("/dev/") || EXPANSAO_DE_SHELL.test(limpo) || limpo.startsWith("~")) return undefined;
  try {
    const caminho = resolve(base, limpo);
    if (!statSync(caminho).isFile()) return undefined;
    return readFileSync(caminho, "utf8");
  } catch {
    return undefined;
  }
}

// sed: acha w/W (inclusive s///w), e (e s///e). O parse não é completo: token que não se prova inofensivo e pode ser w/W/e bloqueia.
function analisarScriptSed(script: string): EscritaDeScript & { dinamico: boolean } {
  const r: EscritaDeScript & { dinamico: boolean } = { destinos: [], comandos: [], dinamico: false };
  const n = script.length;
  const fimDeLinha = (de: number) => { const k = script.indexOf("\n", de); return k < 0 ? n : k; };
  const delimitado = (de: number, delimitador: string): number => {
    for (let k = de; k < n; k++) {
      if (script[k] === "\\") { k++; continue; }
      if (script[k] === delimitador) return k + 1;
    }
    return -1;
  };
  const desconhecido = () => { if (/[wWe]/.test(script)) r.bloqueio = "script do sed que não se prova inofensivo (falha fechada)"; };
  let i = 0;
  while (i < n) {
    const c = script[i]!;
    if (/\s/.test(c) || /[;{}!0-9$~+,]/.test(c)) { i++; continue; }
    if (c === "#") { i = fimDeLinha(i); continue; }
    if (c === "/" || c === "\\") {
      const delimitador = c === "/" ? "/" : script[i + 1];
      const fim = delimitador ? delimitado(c === "/" ? i + 1 : i + 2, delimitador) : -1;
      if (fim < 0) { desconhecido(); return r; }
      i = fim;
      while (i < n && /[IM]/.test(script[i]!)) i++;
      continue;
    }
    if (c === "s" || c === "y") {
      const delimitador = script[i + 1];
      if (!delimitador || delimitador === "\n" || delimitador === "\\") { desconhecido(); return r; }
      const meio = delimitado(i + 2, delimitador);
      const fim = meio < 0 ? -1 : delimitado(meio, delimitador);
      if (fim < 0) { desconhecido(); return r; }
      i = fim;
      if (c === "y") continue;
      while (i < n) {
        const flag = script[i]!;
        if (/[0-9gpiImM]/.test(flag)) { i++; continue; }
        if (flag === "e") { r.dinamico = true; i++; continue; }
        if (flag === "w") {
          const arquivo = script.slice(i + 1, fimDeLinha(i + 1)).trim();
          if (arquivo) r.destinos.push(arquivo); else r.dinamico = true;
          i = fimDeLinha(i + 1);
        }
        break;
      }
      continue;
    }
    if (c === "w" || c === "W") {
      const arquivo = script.slice(i + 1, fimDeLinha(i + 1)).trim();
      if (arquivo) r.destinos.push(arquivo); else r.dinamico = true;
      i = fimDeLinha(i + 1);
      continue;
    }
    if (c === "e") {
      const comando = script.slice(i + 1, fimDeLinha(i + 1)).trim();
      if (comando) r.comandos.push(comando); else r.dinamico = true;
      i = fimDeLinha(i + 1);
      continue;
    }
    if (c === "r" || c === "R") {
      i = fimDeLinha(i + 1);
      continue;
    }
    // Rótulo (`:a`, `b fim`, `t`, `T`) e `v` terminam em `;` ou nova linha (GNU sed): o que vem depois é outro comando.
    if (c === ":" || c === "b" || c === "t" || c === "T" || c === "v") {
      let k = i + 1;
      while (k < n && script[k] !== ";" && script[k] !== "\n") k++;
      i = k;
      continue;
    }
    if (c === "a" || c === "i" || c === "c") {
      let k = i + 1;
      while (true) {
        const fim = fimDeLinha(k);
        if (fim < n && script[fim - 1] === "\\") { k = fim + 1; continue; }
        i = fim;
        break;
      }
      continue;
    }
    if (c === "l" || c === "L" || c === "q" || c === "Q") { i++; while (i < n && /[0-9]/.test(script[i]!)) i++; continue; }
    if (/[=dDgGhHnNpPxzF]/.test(c)) { i++; continue; }
    desconhecido();
    return r;
  }
  return r;
}

// awk: print/printf com > >> | |&, system(), "cmd" | getline. Literal vira destino ou comando; o que não for literal bloqueia.
function analisarScriptAwk(script: string): EscritaDeScript {
  const r: EscritaDeScript = { destinos: [], comandos: [] };
  const n = script.length;
  const nao = (motivo: string) => { r.bloqueio ??= `${motivo} (falha fechada)`; };
  // @include/@load carregam código que o guarda não lê (a extensão inplace grava arquivos).
  if (/@(?:include|load|namespace)\b/.test(script) || /\binplace::/.test(script)) { nao("awk com @include, @load ou inplace::"); return r; }
  // `texto` tem as barras de escape resolvidas (como o awk lê); `bruto` é o que está entre as aspas (no Windows, C:\Users\x é
  // o caminho real e `\U` não é escape). Destino e comando valem nas duas leituras: qualquer uma perigosa bloqueia.
  const lerString = (de: number): { texto: string; bruto: string; fim: number } | undefined => {
    let texto = "";
    for (let k = de + 1; k < n; k++) {
      const c = script[k]!;
      if (c === "\\" && k + 1 < n) { texto += script[k + 1]; k++; continue; }
      if (c === '"') return { texto, bruto: script.slice(de + 1, k), fim: k + 1 };
      texto += c;
    }
    return undefined;
  };
  const registrar = (lista: string[], literal: { texto: string; bruto: string }) => {
    lista.push(literal.texto);
    if (literal.bruto !== literal.texto) lista.push(literal.bruto);
  };
  // `/regex/` onde se espera um operando (depois de ( , { ; ! ~ | & = < > ou no início); depois de um valor é divisão.
  const lerRegex = (de: number): number => {
    let colchete = false;
    for (let k = de + 1; k < n; k++) {
      const c = script[k]!;
      if (c === "\\") { k++; continue; }
      if (c === "\n") return -1;
      if (c === "[") colchete = true;
      else if (c === "]") colchete = false;
      else if (c === "/" && !colchete) return k + 1;
    }
    return -1;
  };
  const esperaOperando = (anterior: string | undefined) => anterior === undefined || /[(,{;!~|&=<>+\-*%^?:\n]/.test(anterior);
  // Depois do alvo literal só pode vir o fim da instrução: `"w" "iki"` concatena e o alvo real é outro.
  const fimDeInstrucao = (de: number) => { const m = /^[ \t]*(?:$|[;}\n)#])/.exec(script.slice(de)); return m !== null; };
  let ultimaString: { texto: string; bruto: string; inicio: number; fim: number } | undefined;
  let anterior: string | undefined;
  let i = 0;
  while (i < n) {
    const c = script[i]!;
    if (c === "#") { while (i < n && script[i] !== "\n") i++; continue; }
    if (c === "\n") { anterior = "\n"; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === "/" && esperaOperando(anterior)) {
      const fim = lerRegex(i);
      if (fim < 0) { nao("regex do awk sem fechamento"); return r; }
      i = fim; anterior = ")";
      continue;
    }
    if (c === '"') {
      const s1 = lerString(i);
      if (!s1) { nao("string do awk sem fechamento"); return r; }
      ultimaString = { ...s1, inicio: i };
      i = s1.fim; anterior = '"';
      continue;
    }
    if (c === "|") {
      let k = i + 1;
      if (script[k] === "&") k++;
      while (k < n && /\s/.test(script[k]!)) k++;
      if (script.startsWith("getline", k)) {
        const antes = ultimaString ? script.slice(0, ultimaString.inicio).trimEnd().slice(-1) : "";
        const solta = ultimaString && script.slice(ultimaString.fim, i).trim() === "" && (antes === "" || /[;{}(=\n]/.test(antes));
        if (solta) registrar(r.comandos, ultimaString!);
        else nao("awk com comando não literal ou concatenado em getline");
      }
      anterior = "|"; i++;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let k = i;
      while (k < n && /\w/.test(script[k]!)) k++;
      const palavra = script.slice(i, k);
      i = k; anterior = "a";
      if (palavra === "system") {
        let j = i;
        while (j < n && /\s/.test(script[j]!)) j++;
        if (script[j] === "(") {
          j++;
          while (j < n && /\s/.test(script[j]!)) j++;
          const literal = script[j] === '"' ? lerString(j) : undefined;
          if (literal && script.slice(literal.fim).trimStart().startsWith(")")) registrar(r.comandos, literal);
          else nao("awk com system() de comando não literal");
        }
      } else if (palavra === "print" || palavra === "printf") {
        let profundidade = 0;
        let ant: string | undefined = "{";
        while (i < n) {
          const d = script[i]!;
          if (/\s/.test(d)) { i++; continue; }
          if (d === "/" && esperaOperando(ant)) {
            const fim = lerRegex(i);
            if (fim < 0) { nao("regex do awk sem fechamento"); return r; }
            i = fim; ant = ")";
            continue;
          }
          if (d === '"') {
            const s2 = lerString(i);
            if (!s2) { nao("string do awk sem fechamento"); return r; }
            ultimaString = { ...s2, inicio: i };
            i = s2.fim; ant = '"';
            continue;
          }
          if (d === "(") profundidade++;
          else if (d === ")") profundidade--;
          else if (profundidade <= 0 && (d === ";" || d === "}")) break;
          else if (profundidade <= 0 && (d === ">" || d === "|")) {
            let k2 = i + 1;
            if (script[k2] === ">" || script[k2] === "&") k2++;
            while (k2 < n && /[ \t]/.test(script[k2]!)) k2++;
            const literal = script[k2] === '"' ? lerString(k2) : undefined;
            if (!literal) { nao(d === ">" ? "awk com destino de redirecionamento não literal" : "awk com comando de pipe não literal"); return r; }
            if (!fimDeInstrucao(literal.fim)) { nao("awk com alvo de redirecionamento concatenado"); return r; }
            registrar(d === ">" ? r.destinos : r.comandos, literal);
            i = literal.fim; ant = '"';
            continue;
          }
          if (d === "\n") { if (profundidade <= 0) break; i++; continue; }
          ant = d;
          i++;
        }
        anterior = ";";
      }
      continue;
    }
    // `x++ / 2`: depois de ++ ou -- (pós-fixo) a barra é divisão, não início de regex.
    if ((c === "+" || c === "-") && script[i + 1] === c) { anterior = ")"; i += 2; continue; }
    anterior = c;
    i++;
  }
  return r;
}

// Comandos ex/vim (de -c, +cmd, -S, --cmd): escrita (w, wq, x, saveas...), shell (!, r !) e comandos que podem tudo.
function analisarComandosEx(texto: string): EscritaDeScript {
  const r: EscritaDeScript = { destinos: [], comandos: [] };
  // Lista permitida: só comandos ex conhecidos como inofensivos passam; os demais (e, call, let, grep, term, normal, exe, py...)
  // podem abrir outro arquivo, executar comando ou código, então bloqueiam (falha fechada).
  const PERMITIDOS = /^(?:s|su|sub|subs|subst|substi|substit|substitu|substitut|substitute|&&?|~|d|de|del|dele|delet|delete|p|pr|pri|prin|print|nu|num|numb|numbe|number|l|li|lis|list|#|=|j|jo|joi|join|m|mo|mov|move|t|co|cop|copy|y|ya|yan|yank|u|un|und|undo|red|redo|noh|nohl|nohls|nohlse|nohlsea|nohlsear|nohlsearc|nohlsearch|q|qu|qui|quit|qa|qal|qall|quita|quitall|cq|cquit|k|ma|mar|mark|sor|sort|le|lef|left|ri|rig|righ|right|ce|cen|cent|cente|center|ret|reta|retab|a|ap|app|appe|appen|append|i|in|ins|inse|inser|insert|c|ch|cha|chan|chang|change|>+|<+)$/;
  const ESCRITA = /^(?:w|wr|wri|writ|write|wq|x|xi|xit|exi|exit|up|upd|upda|updat|update|sav|save|savea|saveas|wn|wnext|wN|wNext|wp|wprevious|wa|wal|wall|wqa|wqall|xa|xall|f|fil|file)$/i;
  const GLOBAL = /^(?:g|gl|glo|glob|globa|global|v|vg|vgl|vglo|vglob|vgloba|vglobal)$/i;
  const MODIFICADORES = /^(?:sil|silent|keepa|keepalt|keepm|keepmarks|keepj|keepjumps|noa|noautocmd|loc|lockmarks|verb|verbose|uns|unsilent|keepp|keeppatterns|leftabove|aboveleft|rightbelow|belowright|botright|topleft|vert|vertical|tab|hid|hide)$/i;
  const analisar = (linha: string, nivel: number): void => {
    if (r.bloqueio || nivel > 6) { if (nivel > 6) r.bloqueio = "comando do editor aninhado demais (falha fechada)"; return; }
    let seg = linha.trim().replace(/^[:\s]+/, "");
    if (seg.startsWith("!")) { r.comandos.push(seg.slice(1)); return; }
    // Faixa: números, ., $, %, marcas, padrões /x/ e ?x?, deslocamentos.
    while (true) {
      const antes = seg;
      seg = seg.replace(/^(?:\d+|\.|\$|%|,|;|[+-]\d*|'.|\/(?:\\.|[^/])*\/|\?(?:\\.|[^?])*\?)\s*/, "");
      if (seg === antes) break;
    }
    if (seg.startsWith("!")) { r.comandos.push(seg.slice(1)); return; }
    const m = /^([A-Za-z]+|@|\*|&&?|~|#|=|>+|<+)(!?)\s*([\s\S]*)$/.exec(seg);
    if (!m) { if (seg) r.bloqueio = "comando do editor que não se prova inofensivo (falha fechada)"; return; }
    const palavra = m[1]!;
    const resto = m[3]!;
    if (MODIFICADORES.test(palavra)) { analisar(resto, nivel + 1); return; }
    if (GLOBAL.test(palavra)) {
      const delimitador = resto[0];
      if (!delimitador || /\w/.test(delimitador)) { r.bloqueio = "global do editor sem padrão (falha fechada)"; return; }
      let k = 1;
      while (k < resto.length && resto[k] !== delimitador) k += resto[k] === "\\" ? 2 : 1;
      analisar(resto.slice(k + 1), nivel + 1);
      return;
    }
    if (/^(?:r|re|rea|read)$/i.test(palavra)) {
      // `r !cmd` e `r!cmd` leem a saída de um comando: o `!` colado cai no grupo de força.
      if (m[2] === "!") r.comandos.push(resto);
      else if (resto.startsWith("!")) r.comandos.push(resto.slice(1));
      return;
    }
    if (ESCRITA.test(palavra)) {
      const alvo = resto.replace(/^>>\s*/, "").trim();
      if (alvo.startsWith("!")) r.comandos.push(alvo.slice(1));
      else if (alvo && alvo !== "%" && alvo !== "#") r.destinos.push(alvo);
      return;
    }
    if (!PERMITIDOS.test(palavra)) r.bloqueio = `comando do editor fora da lista permitida (${palavra}; falha fechada)`;
  };
  // `\=` no substitute avalia uma expressão (system(), por exemplo): não se prova.
  if (texto.includes("\\=")) { r.bloqueio = "substitute com expressão (\\=) do editor (falha fechada)"; return r; }
  for (const linha of texto.split("\n")) {
    const trecho = linha.trim().replace(/^[:\s]+/, "");
    // `!cmd` e `r !cmd` levam o resto da linha, inclusive `|`; os demais comandos terminam em `|`.
    if (trecho.startsWith("!")) { analisar(trecho, 0); continue; }
    for (const parte of linha.split("|")) analisar(parte, 0);
  }
  return r;
}

const EDITORES = new Set(["ed", "red", "ex", "vi", "vim", "nvim", "view", "rvim", "rview", "vimdiff"]);

// Aplica a regra de destino/execução aos achados de um script. Devolve a decisão de bloqueio, se houver.
function decidirEscritaDeScript(
  achados: EscritaDeScript,
  base: string,
  raiz: string,
  ambiente: Record<string, string | undefined>,
  temMudancaDir: boolean,
  executar: (texto: string) => Decisao
): Decisao | undefined {
  if (achados.bloqueio) return { acao: "bloquear", motivo: achados.bloqueio };
  for (const alvo of achados.destinos) {
    if (alvo === "/dev/stdout" || alvo === "/dev/stderr") continue;
    if (caminhoTocaWiki(alvo, base, raiz, ambiente) || !destinoEhSeguro(alvo, base, raiz, ambiente) || temMudancaDir) {
      return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
    }
  }
  for (const comando of achados.comandos) {
    const interno = executar(comando);
    if (interno.acao === "bloquear") return interno;
  }
  return undefined;
}

function analisarFerramentaDeTexto(
  verbo: string,
  args: string[],
  base: string,
  raiz: string,
  ambiente: Record<string, string | undefined>,
  temMudancaDir: boolean,
  entrada: EntradaDoComando,
  executar: (texto: string) => Decisao
): Decisao | undefined {
  const decidir = (achados: EscritaDeScript) => decidirEscritaDeScript(achados, base, raiz, ambiente, temMudancaDir, executar);
  const bloquear = (motivo: string): Decisao => ({ acao: "bloquear", motivo });
  const valorDe = (inline: string | undefined, i: number): [string | undefined, number] =>
    inline !== undefined && inline !== "" ? [inline, i] : [args[i + 1], i + 1];

  if (verbo === "sed" || verbo === "gsed") {
    let sandbox = false;
    const scripts: Array<{ texto?: string; arquivo?: string }> = [];
    const operandos: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (arg === "--") { operandos.push(...args.slice(i + 1)); break; }
      if (arg.startsWith("--")) {
        if (opcaoLongaGnu(arg, "--sandbox", "--sa")) sandbox = true;
        else if (opcaoLongaGnu(arg, "--expression", "--e")) {
          const [valor, proximo] = valorDe(arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : undefined, i);
          if (valor === undefined) return bloquear("sed -e sem script (falha fechada)");
          scripts.push({ texto: valor }); i = proximo;
        } else if (opcaoLongaGnu(arg, "--file", "--fi")) {
          const [valor, proximo] = valorDe(arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : undefined, i);
          if (valor === undefined) return bloquear("sed -f sem arquivo (falha fechada)");
          scripts.push({ arquivo: valor }); i = proximo;
        } else if (opcaoLongaGnu(arg, "--line-length", "--li") && !arg.includes("=")) i++;
        continue;
      }
      if (/^-[^-]/.test(arg)) {
        const grupo = arg.slice(1);
        for (let j = 0; j < grupo.length; j++) {
          const letra = grupo[j]!;
          if (letra === "i") break;
          if (letra === "e" || letra === "f" || letra === "l") {
            const [valor, proximo] = valorDe(grupo.slice(j + 1) || undefined, i);
            if (valor === undefined) return bloquear("sed com opção sem valor (falha fechada)");
            if (letra === "e") scripts.push({ texto: valor }); else if (letra === "f") scripts.push({ arquivo: valor });
            i = proximo;
            break;
          }
        }
        continue;
      }
      operandos.push(arg);
    }
    if (sandbox) return undefined;
    if (!scripts.length && operandos.length) scripts.push({ texto: operandos.shift() });
    for (const script of scripts) {
      const texto = script.texto ?? lerScriptLegivel(script.arquivo!, base, entrada.unicoComando);
      if (texto === undefined) return bloquear("script do sed ilegível ou não literal (falha fechada)");
      const achados = analisarScriptSed(texto);
      if (achados.dinamico) return bloquear("sed com e ou s///e executa o que não se prova (falha fechada)");
      const decisao = decidir(achados);
      if (decisao) return decisao;
    }
    return undefined;
  }

  if (/^(?:awk|gawk|mawk|nawk)$/.test(verbo)) {
    let inplace = false;
    const destinosDeOpcao: string[] = [];
    const scripts: Array<{ texto?: string; arquivo?: string }> = [];
    const operandos: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (arg === "--") { operandos.push(...args.slice(i + 1)); break; }
      if (arg.startsWith("--")) {
        const inline = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : undefined;
        const cabeca = (nome: string, minimo: string) => opcaoLongaGnu(arg, nome, minimo);
        if ((cabeca("--dump-variables", "--d") || cabeca("--profile", "--prof") || cabeca("--pretty-print", "--pre")) && inline) destinosDeOpcao.push(inline);
        if (cabeca("--file", "--fil") || cabeca("--exec", "--e") || cabeca("--source", "--so")) {
          const [valor, proximo] = valorDe(inline, i);
          if (valor === undefined) return bloquear("awk com opção de programa sem valor (falha fechada)");
          scripts.push(cabeca("--source", "--so") ? { texto: valor } : { arquivo: valor }); i = proximo;
        } else if (cabeca("--include", "--i") || cabeca("--load", "--lo")) {
          const [valor, proximo] = valorDe(inline, i);
          if (valor !== undefined && /inplace/i.test(valor)) inplace = true;
          i = proximo;
        } else if ((cabeca("--assign", "--a") || cabeca("--field-separator", "--fie")) && inline === undefined) i++;
        continue;
      }
      if (/^-[^-]/.test(arg)) {
        const grupo = arg.slice(1);
        for (let j = 0; j < grupo.length; j++) {
          const letra = grupo[j]!;
          // -d, -o e -p [arquivo] (gawk) gravam variáveis, programa formatado e perfil; o valor só vale colado.
          if (letra === "d" || letra === "o" || letra === "p") {
            const colado = grupo.slice(j + 1);
            if (colado) destinosDeOpcao.push(colado);
            break;
          }
          if ("fFvieElW".includes(letra)) {
            const [valor, proximo] = valorDe(grupo.slice(j + 1) || undefined, i);
            if (valor === undefined) return bloquear("awk com opção sem valor (falha fechada)");
            if (letra === "f" || letra === "E") scripts.push({ arquivo: valor });
            else if (letra === "e") scripts.push({ texto: valor });
            else if ((letra === "i" || letra === "l") && /inplace/i.test(valor)) inplace = true;
            else if (letra === "W") {
              // mawk/gawk -W source=texto, exec=arquivo, file=arquivo
              const w = /^(source|exec|file)=([\s\S]*)$/i.exec(valor);
              if (w) scripts.push(w[1]!.toLowerCase() === "source" ? { texto: w[2]! } : { arquivo: w[2]! });
            }
            i = proximo;
            break;
          }
        }
        continue;
      }
      operandos.push(arg);
    }
    if (!scripts.length && operandos.length) scripts.push({ texto: operandos.shift() });
    if (destinosDeOpcao.length) {
      const decisao = decidir({ destinos: destinosDeOpcao, comandos: [] });
      if (decisao) return decisao;
    }
    if (inplace && (temMudancaDir || operandos.some(arg => argumentoTocaWiki(arg, base, raiz, ambiente)))) return bloquear(MSG_TERMINAL_WIKI);
    for (const script of scripts) {
      const texto = script.texto ?? lerScriptLegivel(script.arquivo!, base, entrada.unicoComando);
      if (texto === undefined) return bloquear("programa do awk ilegível ou não literal (falha fechada)");
      const decisao = decidir(analisarScriptAwk(texto));
      if (decisao) return decisao;
    }
    return undefined;
  }

  if (EDITORES.has(verbo)) {
    const textos: string[] = [];
    const arquivosScript: string[] = [];
    const destinos: string[] = [];
    const operandos: string[] = [];
    const letras = new Set<string>();
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (arg === "--") { operandos.push(...args.slice(i + 1)); break; }
      if (arg.startsWith("--")) {
        const inline = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : undefined;
        if (opcaoLongaGnu(arg, "--cmd", "--cm")) {
          const [valor, proximo] = valorDe(inline, i);
          if (valor === undefined) return bloquear("editor com --cmd sem valor (falha fechada)");
          textos.push(valor); i = proximo;
        } else if (opcaoLongaGnu(arg, "--log", "--lo") || opcaoLongaGnu(arg, "--startuptime", "--st")) {
          const [valor, proximo] = valorDe(inline, i);
          if (valor !== undefined) destinos.push(valor);
          i = proximo;
        }
        continue;
      }
      if (arg.startsWith("+") && arg.length > 1) { textos.push(arg.slice(1)); continue; }
      if (/^-[^-]/.test(arg)) {
        const grupo = arg.slice(1);
        const comValor = verbo === "ed" || verbo === "red" ? "cSuUitTwWpG" : "cSuUitTwW";
        for (let j = 0; j < grupo.length; j++) {
          const letra = grupo[j]!;
          letras.add(letra);
          if (letra === "V") {
            const arquivo = grupo.slice(j + 1).replace(/^\d+/, "");
            if (arquivo) destinos.push(arquivo);
            break;
          }
          if (comValor.includes(letra)) {
            const [valor, proximo] = valorDe(grupo.slice(j + 1) || undefined, i);
            if (valor === undefined) return bloquear("editor com opção sem valor (falha fechada)");
            if (letra === "c") textos.push(valor);
            else if (letra === "S") arquivosScript.push(valor);
            else if (letra === "w" || letra === "W" || letra === "i") destinos.push(valor);
            // -u/-U executam um vimrc que o guarda não lê: só NONE/NORC se prova inofensivo.
            else if ((letra === "u" || letra === "U") && !/^(?:NONE|NORC)$/i.test(valor)) return bloquear("editor com vimrc não literal (falha fechada)");
            i = proximo;
            break;
          }
        }
        continue;
      }
      if (arg !== "-") operandos.push(arg);
    }
    // O terminal não escreve em wiki/: editor com arquivo da wiki, em qualquer modo, bloqueia.
    if (temMudancaDir || operandos.some(arg => argumentoTocaWiki(arg, base, raiz, ambiente))) return bloquear(MSG_TERMINAL_WIKI);
    // Fora do modo ex, `-s` recebe um arquivo de teclas (scriptin) que o guarda não lê.
    if (letras.has("s") && !(verbo === "ed" || verbo === "red" || verbo === "ex" || letras.has("e") || letras.has("E"))) {
      return bloquear(`${verbo} -s com arquivo de teclas (não se prova; falha fechada)`);
    }
    const modoScript = verbo === "ed" || verbo === "red" || verbo === "ex" || letras.has("s") || letras.has("e") || letras.has("E");
    if (modoScript && (entrada.redirecionada || entrada.dePipe)) {
      return bloquear(`${verbo} com script vindo da entrada padrão (não se prova; falha fechada)`);
    }
    const achados: EscritaDeScript = { destinos: [...destinos], comandos: [] };
    for (const texto of textos) {
      const um = analisarComandosEx(texto);
      if (um.bloqueio) return bloquear(um.bloqueio);
      achados.destinos.push(...um.destinos); achados.comandos.push(...um.comandos);
    }
    for (const arquivo of arquivosScript) {
      const conteudo = lerScriptLegivel(arquivo, base, entrada.unicoComando);
      if (conteudo === undefined) return bloquear("script do editor ilegível ou não literal (falha fechada)");
      const um = analisarComandosEx(conteudo);
      if (um.bloqueio) return bloquear(um.bloqueio);
      achados.destinos.push(...um.destinos); achados.comandos.push(...um.comandos);
    }
    return decidir(achados);
  }
  return undefined;
}

// Comando executado por outro comando (sh -c, find -exec, eval) volta ao mesmo classificador; acima do teto, bloqueia.
type ContextoAninhado = { profundidade: number; comandosNaLinha?: number };
// Ambiente que um comando simples deixa para os seguintes da mesma invocação (export, atribuição isolada).
type AmbienteGit = { arvores: string[]; configWorktree: boolean };
function novoAmbienteGit(): AmbienteGit {
  return { arvores: [], configWorktree: false };
}
function registrarAmbienteGit(palavra: string, alvo: AmbienteGit): void {
  const arvore = /^GIT_WORK_TREE=(.*)$/.exec(palavra);
  if (arvore) alvo.arvores.push(arvore[1]!);
  // GIT_DIR sozinho não muda a árvore, mas o repositório pode apontar para o cofre: o dir e o pai dele entram.
  const gitDir = /^GIT_DIR=(.*)$/.exec(palavra);
  if (gitDir) alvo.arvores.push(gitDir[1]!, `${gitDir[1]}/..`);
  // O mesmo core.worktree por GIT_CONFIG_KEY_n / GIT_CONFIG_PARAMETERS: o valor não é conferido, só a chave.
  if (/^GIT_CONFIG_KEY_\d+=core\.worktree$/i.test(palavra)) alvo.configWorktree = true;
  if (/^GIT_CONFIG_PARAMETERS=.*core\.worktree/i.test(palavra)) alvo.configWorktree = true;
}
const VERBOS_QUE_EXPORTAM = new Set(["export", "declare", "typeset", "readonly", "local"]);
const TETO_ANINHAMENTO = 5;
// Qualquer verbo terminado em `sh` é tratado como shell (bash, zsh, fish, mksh, rbash...): falha fechada.
function ehShell(verbo: string): boolean {
  return /^(?:[a-z]*sh|yash|hush)$/.test(verbo);
}

// Textos de comando de um shell. bash/sh/zsh: `-c <texto>` (inclusive em grupo curto: -ec, -lc), com o texto no primeiro
// argumento que não é opção, depois de -o/-O valor e --rcfile arq. fish: `-c`, `--command`, `-C` e `--init-command` recebem o
// texto como valor, em qualquer posição (o fish aceita opções depois do texto) e sem exigir -c. Todo texto colhido é analisado.
function textosDeShell(verbo: string, args: string[]): { textos: string[]; semTexto: boolean } {
  const fish = verbo === "fish";
  const textos: string[] = [];
  let temC = false;
  let positional: string | undefined;
  let semTexto = false;
  const valorDe = (inline: string | undefined, indice: number): [string | undefined, number] =>
    inline !== undefined ? [inline, indice] : [args[indice + 1], indice + 1];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--") {
      if (positional === undefined && !fish) positional = args[i + 1];
      break;
    }
    if (arg.startsWith("--")) {
      // Abreviações por prefixo valem (fail closed): --comm, --init-c.
      const explicita = opcaoLongaGnu(arg, "--command", "--c") || opcaoLongaGnu(arg, "--init-command", "--i");
      if (explicita) {
        const [valor, proximo] = valorDe(arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : undefined, i);
        if (valor === undefined) semTexto = true; else textos.push(valor);
        i = proximo;
      } else if (/^--(?:rcfile|init-file)$/.test(arg)) {
        i++;
      }
      continue;
    }
    if (!/^[-+][^-+]/.test(arg)) {
      if (!fish) { positional ??= arg; break; }
      continue;
    }
    const grupo = arg.slice(1);
    for (let j = 0; j < grupo.length; j++) {
      const letra = grupo[j]!;
      if (fish && arg.startsWith("-") && (letra === "c" || letra === "C")) {
        const [valor, proximo] = valorDe(grupo.slice(j + 1) || undefined, i);
        if (valor === undefined) semTexto = true; else textos.push(valor);
        i = proximo;
        break;
      }
      if (!fish && letra === "c" && arg.startsWith("-")) temC = true;
      // Cada o/O do grupo (-oc, -Oc, -ocO) leva um valor próprio, na ordem; as letras seguintes continuam valendo.
      if (!fish && (letra === "o" || letra === "O")) {
        if (args[i + 1] === undefined) semTexto = true;
        i++;
      }
    }
  }
  if (temC) {
    if (positional === undefined) semTexto = true; else textos.push(positional);
  }
  return { textos, semTexto };
}

// O comando de `find -exec|-ok` até o terminador `;` ou `+` (sem terminador, vai até o fim).
function comandosDoFind(args: string[]): string[][] {
  const comandos: string[][] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "-exec" && args[i] !== "-ok") continue;
    let fim = i + 1;
    while (fim < args.length && args[fim] !== ";" && args[fim] !== "+") fim++;
    comandos.push(args.slice(i + 1, fim));
    i = fim;
  }
  return comandos;
}

function cortarEntradasParallel(args: string[]): string[] {
  const indice = args.findIndex(arg => arg.startsWith(":::"));
  return indice < 0 ? args : args.slice(0, indice);
}

function analisarComandoSimples(
  cmdTokens: Token[],
  base: string,
  raiz: string,
  ambiente: Record<string, string | undefined>,
  temMudancaDir: boolean,
  aninhado: ContextoAninhado = { profundidade: 0 },
  ambienteGit: AmbienteGit = novoAmbienteGit(),
  doPipe = false
): Decisao {
  let entradaRedirecionada = false;
  // 1. Extrai redirecionamentos e tokens sem operadores de redireção
  const alvosRedir: string[] = [];
  const tokensSemRedir: Token[] = [];
  for (let i = 0; i < cmdTokens.length; i++) {
    const token = cmdTokens[i]!;
    if (token.operador && (token.texto === ">" || token.texto === ">>" || token.texto === ">|" || token.texto === "&>")) {
      const proximo = cmdTokens[i + 1];
      if (!proximo || proximo.operador) {
        return { acao: "bloquear", motivo: "redirecionamento sem destino (falha fechada)" };
      }
      alvosRedir.push(proximo.texto);
      i++;
    } else if (!token.operador && /^\d+$/.test(token.texto) && cmdTokens[i + 1]?.operador && (cmdTokens[i + 1]!.texto === ">" || cmdTokens[i + 1]!.texto === ">>")) {
      const proximo = cmdTokens[i + 2];
      if (!proximo || proximo.operador) {
        return { acao: "bloquear", motivo: "redirecionamento sem destino (falha fechada)" };
      }
      alvosRedir.push(proximo.texto);
      i += 2;
    } else if (token.operador && token.texto === "<") {
      entradaRedirecionada = true;
      const proximo = cmdTokens[i + 1];
      if (proximo && !proximo.operador) {
        i++;
      }
    } else {
      tokensSemRedir.push(token);
    }
  }

  // Se algum redirecionamento toca a wiki ou não é seguro, bloqueia
  for (const alvo of alvosRedir) {
    if (alvo === "/dev/null" || alvo === "&1" || alvo === "&2" || alvo.toLowerCase() === "nul") continue;
    if (caminhoTocaWiki(alvo, base, raiz, ambiente) || !destinoEhSeguro(alvo, base, raiz, ambiente) || temMudancaDir) {
      return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
    }
  }

  // 2. Extrai palavras do comando (ignora atribuições VAR=val e palavras de controle de bloco)
  let palavras = tokensSemRedir.map(t => t.texto);
  const doComando = novoAmbienteGit();
  const guardarArvore = (palavra: string) => registrarAmbienteGit(palavra, doComando);
  while (palavras.length > 0 && (/^[A-Za-z_]\w*=/.test(palavras[0]!) || /^(?:do|then|else|elif|\{|\}|!|while|until|if)$/.test(palavras[0]!))) {
    guardarArvore(palavras[0]!);
    palavras = palavras.slice(1);
  }
  if (!palavras.length) {
    // Atribuição isolada (`GIT_WORK_TREE=x`) fica para os comandos seguintes.
    ambienteGit.arvores.push(...doComando.arvores);
    ambienteGit.configWorktree ||= doComando.configWorktree;
    return { acao: "liberar", motivo: "comando simples vazio ou sem verbo" };
  }

  // 3. Normaliza verbo e desembrulha wrappers (sudo, env, time, etc.)
  let verbo = verboNormalizado(palavras[0]!);
  while (ENVOLVEDORES.has(verbo) && palavras.length > 1) {
    const { resto, descartados, diretorios, malformado } = desembrulhar(verbo, palavras.slice(1));
    if (malformado) {
      return { acao: "bloquear", motivo: `${verbo} com grupo de opções sem valor (falha fechada)` };
    }
    descartados.forEach(guardarArvore);
    for (const diretorio of diretorios) {
      const efetivo = resolverDiretorioEfetivo(base, diretorio);
      if (!efetivo) return { acao: "bloquear", motivo: `${verbo} com diretório não literal ou inválido (falha fechada)` };
      base = efetivo;
    }
    if (verbo === "time" || verbo === "stdbuf") {
      const opcoesCurtas = analisarOpcoesCurtas(descartados, OPCOES_CURTAS_POR_VERBO[verbo] ?? {});
      if (opcoesCurtas.malformado) {
        return { acao: "bloquear", motivo: `${verbo} com grupo de opções sem valor (falha fechada)` };
      }
      for (const outTarget of opcoesCurtas.destinos) {
        if (caminhoTocaWiki(outTarget, base, raiz, ambiente) || !destinoEhSeguro(outTarget, base, raiz, ambiente) || temMudancaDir) {
          return { acao: "bloquear", motivo: `${verbo} com opção de saída em arquivo citando wiki` };
        }
      }
      for (let i = 0; i < descartados.length; i++) {
        const arg = descartados[i]!;
        let outTarget: string | undefined;
        const gnuOpt = extrairDestinoOpcaoLongaGnu(arg, descartados[i + 1], "--output");
        if (gnuOpt.bateu) {
          outTarget = gnuOpt.valor;
          if (gnuOpt.consumiuProximo) i++;
        } else if (verbo === "stdbuf" && arg === "-o") {
          outTarget = descartados[i + 1];
          if (outTarget !== undefined) i++;
        } else if (verbo === "stdbuf" && arg.startsWith("-o") && arg.length > 2 && !arg.startsWith("--")) {
          outTarget = arg.slice(2);
        }
        if (outTarget && (caminhoTocaWiki(outTarget, base, raiz, ambiente) || !destinoEhSeguro(outTarget, base, raiz, ambiente) || temMudancaDir)) {
          return { acao: "bloquear", motivo: `${verbo} com opção de saída em arquivo citando wiki` };
        }
      }
    }
    if (verbo === "parallel" && resto[0]?.startsWith(":::")) {
      return { acao: "bloquear", motivo: "parallel sem comando antes de ::: (falha fechada)" };
    }
    palavras = verbo === "parallel" ? cortarEntradasParallel(resto) : resto;
    if (!palavras.length) break;
    verbo = verboNormalizado(palavras[0]!);
  }

  if (!verbo) {
    return { acao: "bloquear", motivo: "comando com verbo vazio ou inválido (falha fechada)" };
  }

  const cmdArgs = palavras.slice(1);
  // Verbo aninhado que só existe em tempo de execução ($1, {}, glob) não se classifica: falha fechada.
  if (aninhado.profundidade > 0 && /[$`{}*?\[\]]|^~/.test(palavras[0]!)) {
    return { acao: "bloquear", motivo: "comando aninhado com verbo não literal (falha fechada)" };
  }
  if (VERBOS_QUE_EXPORTAM.has(verbo)) cmdArgs.forEach(arg => registrarAmbienteGit(arg, ambienteGit));
  const cmdTextoSimples = cmdTokens.map(t => t.texto).join(" ");

  if (verbo === "git") {
    const git = analisarGit(cmdArgs);
    if (git.malformado) return { acao: "bloquear", motivo: "git -C sem diretório literal (falha fechada)" };
    for (const diretorio of git.diretorios) {
      const efetivo = resolverDiretorioEfetivo(base, diretorio);
      if (!efetivo) return { acao: "bloquear", motivo: "git -C com diretório não literal ou inválido (falha fechada)" };
      base = efetivo;
    }
  }

  const ehTar = verbo === "tar" || verbo === "bsdtar" || verbo === "gtar";
  if (verbo === "make" || ehTar) {
    const dirs = extrairDiretoriosC(cmdArgs);
    if (dirs.malformado) return { acao: "bloquear", motivo: `${verbo} -C sem diretório literal (falha fechada)` };
    let tarDirTocaWiki = false;
    const efetivos: string[] = [];
    for (const diretorio of dirs.diretorios) {
      const efetivo = resolverDiretorioEfetivo(base, diretorio);
      if (!efetivo) return { acao: "bloquear", motivo: `${verbo} -C com diretório não literal ou inválido (falha fechada)` };
      if (ehTar && estaSobWiki(efetivo, raiz, ambiente, base)) tarDirTocaWiki = true;
      base = efetivo;
      efetivos.push(efetivo);
    }
    if (ehTar && tarExtrai(cmdArgs)) {
      // Extrair grava o que o pacote tem sob o diretório efetivo (-C ou cwd); -P deixa o pacote escolher o caminho.
      // Com vários -C a ordem de aplicação varia: cada diretório visto no comando é julgado.
      if (!efetivos.length) efetivos.push(base);
      if (tarCaminhosAbsolutos(cmdArgs) || efetivos.some(diretorio => ehDestinoPerigoso(diretorio, base, raiz, ambiente))) {
        return { acao: "bloquear", motivo: `${verbo} extrai para a wiki ou para um ancestral dela (falha fechada)` };
      }
    }
    if (ehTar && tarDirTocaWiki) {
      const lista = cmdArgs.some(arg => arg === "--list" || (/^-[^-]/.test(arg) && arg.slice(1).includes("t")));
      const grava = cmdArgs.some(arg => ["--extract", "--create", "--append", "--update"].includes(arg)
        || (/^-[^-]/.test(arg) && /[xcru]/.test(arg.slice(1))));
      if (grava || !lista) return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
    }
  }

  if (verbo === "find" && cmdArgs.some(arg => arg === "-execdir" || arg === "-okdir")) {
    return { acao: "bloquear", motivo: "find com execução em diretório variável (falha fechada)" };
  }

  // 3a. find -fprint/-fprint0/-fprintf/-fls escrevem no arquivo que vem a seguir: ele é destino de escrita.
  if (verbo === "find") {
    for (let i = 0; i < cmdArgs.length; i++) {
      if (!["-fprint", "-fprint0", "-fprintf", "-fls"].includes(cmdArgs[i]!)) continue;
      const alvo = cmdArgs[i + 1];
      if (alvo === undefined || caminhoTocaWiki(alvo, base, raiz, ambiente) || !destinoEhSeguro(alvo, base, raiz, ambiente) || temMudancaDir) {
        return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
      }
    }
  }

  // 3b. Comando executado por outro comando: sh -c, find -exec/-ok e eval passam pelo mesmo classificador.
  if (ehShell(verbo) || verbo === "find" || verbo === "eval") {
    if (aninhado.profundidade >= TETO_ANINHAMENTO) {
      return { acao: "bloquear", motivo: "comandos aninhados demais (falha fechada)" };
    }
    const proximo = { profundidade: aninhado.profundidade + 1 };
    if (ehShell(verbo)) {
      const { textos, semTexto } = textosDeShell(verbo, cmdArgs);
      if (semTexto) return { acao: "bloquear", motivo: `${verbo} com opção de comando sem texto (falha fechada)` };
      for (const trecho of textos) {
        const interno = decidirTerminalVerified(trecho, false, base, raiz, ambiente, proximo, temMudancaDir, ambienteGit);
        if (interno.acao === "bloquear") return interno;
      }
    } else if (verbo === "eval") {
      if (cmdArgs.length) {
        const interno = decidirTerminalVerified(cmdArgs.join(" "), false, base, raiz, ambiente, proximo, temMudancaDir, ambienteGit);
        if (interno.acao === "bloquear") return interno;
      }
    } else {
      for (const interno of comandosDoFind(cmdArgs)) {
        if (!interno.length) return { acao: "bloquear", motivo: "find -exec sem comando (falha fechada)" };
        const decisao = analisarComandoSimples(interno.map(texto => ({ texto, operador: false })), base, raiz, ambiente, temMudancaDir, proximo, ambienteGit);
        if (decisao.acao === "bloquear") return decisao;
      }
    }
  }

  // 4. Se cita verified ou aprovação no comando simples
  const citaVerified = /verified/i.test(cmdTextoSimples) || /\bby\s*:\s*human:/i.test(cmdTextoSimples);
  if (citaVerified) {
    if (verbo === "git") {
      const { subcomando, globais } = analisarGit(cmdArgs);
      if (globais.some(opt => opt === "-c" || /^--(?:config-env|exec-path)(?:=|$)/.test(opt))) {
        return { acao: "bloquear", motivo: "git com opções de execução que citam verified" };
      }
      for (let i = 0; i < cmdArgs.length; i++) {
        const arg = cmdArgs[i]!;
        if (arg === "--") break;
        let alvo: string | undefined;
        const gnuOpt = extrairDestinoGit(arg, cmdArgs[i + 1]);
        if (gnuOpt.bateu) {
          alvo = gnuOpt.valor;
          if (gnuOpt.consumiuProximo) i++;
        } else if (arg === "-o") {
          alvo = cmdArgs[i + 1];
          if (alvo !== undefined) i++;
        } else if (arg.startsWith("-o") && !arg.startsWith("--")) {
          alvo = arg.slice(2);
        }

        if (alvo && (caminhoTocaWiki(alvo, base, raiz, ambiente) || !destinoEhSeguro(alvo, base, raiz, ambiente))) {
          return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
        }
      }
      if (!subcomando || !GIT_LEITURA.has(subcomando)) {
        return { acao: "bloquear", motivo: `git com subcomando de escrita (${subcomando ?? "nenhum"}) citando verified` };
      }
    } else if (LEITURAS_TERMINAL.has(verbo)) {
      if (verbo === "rg" && cmdArgs.some(arg => arg === "--pre" || arg.startsWith("--pre="))) {
        return { acao: "bloquear", motivo: "rg com pré-processador citando verified" };
      }
    } else {
      return { acao: "bloquear", motivo: `comando não leitor (${verbo}) citando verified` };
    }
  }

  // 5. Destinos e indicadores de escrita em wiki/ (MSG_TERMINAL_WIKI)
  // 5.1 Cópia / Movimentação: cp, mv, ln, install, rsync
  if (["cp", "mv", "ln", "install", "rsync"].includes(verbo)) {
    const destinos: string[] = [];
    const opcoesCurtas = analisarOpcoesCurtas(cmdArgs, OPCOES_CURTAS_POR_VERBO[verbo] ?? {});
    if (opcoesCurtas.malformado) {
      return { acao: "bloquear", motivo: `${verbo} com grupo de opções sem valor (falha fechada)` };
    }
    destinos.push(...opcoesCurtas.destinos);
    const operandos = [...opcoesCurtas.operandos];
    let destinoExplicito = opcoesCurtas.destinos.length > 0;
    for (let i = 0; i < cmdArgs.length; i++) {
      const arg = cmdArgs[i]!;
      if (arg === "--") break;
      const gnuOpt = extrairDestinoOpcaoLongaGnu(arg, cmdArgs[i + 1], "--target-directory");
      if (gnuOpt.bateu) {
        destinoExplicito = true;
        if (gnuOpt.valor !== undefined) destinos.push(gnuOpt.valor);
        if (gnuOpt.consumiuProximo) {
          i++;
          const indice = operandos.indexOf(gnuOpt.valor!);
          if (indice >= 0) operandos.splice(indice, 1);
        }
      }
    }
    if (destinos.length === 0) {
      if (verbo === "ln" && operandos.length === 1) {
        destinos.push(".");
      } else if (operandos.length >= 2) {
        destinos.push(operandos[operandos.length - 1]!);
      } else {
        return { acao: "bloquear", motivo: `${verbo} sem destino reconhecível (falha fechada)` };
      }
    }
    for (const dest of destinos) {
      if (caminhoTocaWiki(dest, base, raiz, ambiente) || !destinoEhSeguro(dest, base, raiz, ambiente) || temMudancaDir) {
        return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
      }
    }
    // Destino que é ancestral da wiki: escrever vários arquivos nele cria descendentes na wiki.
    const fontes = destinoExplicito ? operandos
      : (verbo === "ln" && operandos.length === 1 ? operandos : operandos.slice(0, -1));
    // O destino do rsync pode vir depois de opções com valor (`--exclude x`): todo operando menos a origem é candidato.
    const candidatos = verbo === "rsync" ? operandos.slice(1) : destinos;
    const emMassa = escritaEmMassaNoAncestral(verbo, cmdArgs, opcoesCurtas.letras, fontes, candidatos, base, raiz, ambiente);
    if (emMassa) return { acao: "bloquear", motivo: emMassa };
  }

  // 5.1b Extratores (unzip, 7z) que gravam no diretório escolhido ou no cwd
  const extracao = extratorNoAncestral(verbo, cmdArgs, base, raiz, ambiente);
  if (extracao) return { acao: "bloquear", motivo: extracao };

  // 5.2 tee: cada operando não-flag é um arquivo de destino
  if (verbo === "tee") {
    const destinosTee = analisarOpcoesCurtas(cmdArgs, OPCOES_CURTAS_POR_VERBO.tee!).operandos;
    for (const dest of destinosTee) {
      if (caminhoTocaWiki(dest, base, raiz, ambiente) || !destinoEhSeguro(dest, base, raiz, ambiente) || temMudancaDir) {
        return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
      }
    }
  }

  // 5.3 dd: of=...
  if (verbo === "dd") {
    // O dd grava no ÚLTIMO of=, mas aqui todos são julgados: qualquer um perigoso bloqueia.
    for (const ofArg of cmdArgs.filter(arg => /^of=/i.test(arg))) {
      const destDd = ofArg.slice(3).replace(/^["']|["']$/g, "").trim();
      if (caminhoTocaWiki(destDd, base, raiz, ambiente) || !destinoEhSeguro(destDd, base, raiz, ambiente) || temMudancaDir) {
        return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
      }
    }
  }

  // 5.4 Editores com in-place: sed, perl, ruby
  if (["sed", "perl", "ruby"].includes(verbo)) {
    const opcoesCurtas = analisarOpcoesCurtas(cmdArgs, OPCOES_CURTAS_POR_VERBO[verbo]!);
    if (opcoesCurtas.malformado) {
      return { acao: "bloquear", motivo: `${verbo} com grupo de opções sem valor (falha fechada)` };
    }
    const fimOpcoes = cmdArgs.indexOf("--");
    const antesDoFim = fimOpcoes < 0 ? cmdArgs : cmdArgs.slice(0, fimOpcoes);
    const temInPlace = opcoesCurtas.letras.has("i") || antesDoFim.some(arg =>
      arg.startsWith("--") && arg.length >= 3 && opcaoLongaGnu(arg, "--in-place", "--i")
    );
    if (temInPlace) {
      const operandos = opcoesCurtas.operandos;
      if (temMudancaDir || operandos.some(arg => argumentoTocaWiki(arg, base, raiz, ambiente))) {
        return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
      }
    }
  }

  // 5.4b Linguagem de script que grava ou executa: sed (w/W/e), awk (>, |, system) e ed/ex/vim (w, !, saveas)
  const executarAninhado = (texto: string): Decisao => aninhado.profundidade >= TETO_ANINHAMENTO
    ? { acao: "bloquear", motivo: "comandos aninhados demais (falha fechada)" }
    : decidirTerminalVerified(texto, false, base, raiz, ambiente, { profundidade: aninhado.profundidade + 1 }, temMudancaDir, ambienteGit);
  const ferramentaDeTexto = analisarFerramentaDeTexto(
    verbo, cmdArgs, base, raiz, ambiente, temMudancaDir, { redirecionada: entradaRedirecionada, dePipe: doPipe, unicoComando: (aninhado.comandosNaLinha ?? 1) <= 1 }, executarAninhado
  );
  if (ferramentaDeTexto) return ferramentaDeTexto;

  // 5.5 Interpretadores com código inline
  if (/^(?:python(?:\d+(?:\.\d+)?)?|node|bun|deno|ruby|perl|php)$/i.test(verbo)) {
    const opcoesPerl = verbo === "perl" ? analisarOpcoesCurtas(cmdArgs, OPCOES_CURTAS_POR_VERBO.perl!) : undefined;
    const temInline = cmdArgs.some(arg => /^--(?:eval|print)(?:=|$)/.test(arg) || /^-[a-zA-Z0-9_]*[cepr]/.test(arg))
      || opcoesPerl?.letras.has("E") === true;
    if (temInline) {
      if (temMudancaDir || cmdArgs.some(arg => argumentoTocaWiki(arg, base, raiz, ambiente) || arg.includes("wiki/"))) {
        return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
      }
    }
  }

  // 5.6 Cmdlets de escrita PS e truncate
  if (CMDLETS_ESCRITA_PS.has(verbo) || verbo === "truncate") {
    if (temMudancaDir || cmdArgs.some(arg => argumentoTocaWiki(arg, base, raiz, ambiente))) {
      return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
    }
  }

  // 5.7 git
  if (verbo === "git") {
    const opcoesCurtas = analisarOpcoesCurtas(cmdArgs, OPCOES_CURTAS_POR_VERBO.git!);
    if (opcoesCurtas.malformado) {
      return { acao: "bloquear", motivo: "git com grupo de opções sem valor (falha fechada)" };
    }
    for (const alvo of opcoesCurtas.destinos) {
      if (caminhoTocaWiki(alvo, base, raiz, ambiente) || !destinoEhSeguro(alvo, base, raiz, ambiente) || temMudancaDir) {
        return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
      }
    }
    const { subcomando } = analisarGit(cmdArgs);
    if (subcomando && !GIT_LEITURA.has(subcomando)) {
      if (temMudancaDir || cmdArgs.some(arg => argumentoTocaWiki(arg, base, raiz, ambiente))) {
        return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
      }
    }
    for (let i = 0; i < cmdArgs.length; i++) {
      const arg = cmdArgs[i]!;
      if (arg === "--") break;
      let alvo: string | undefined;
      const gnuOpt = extrairDestinoGit(arg, cmdArgs[i + 1]);
      if (gnuOpt.bateu) {
        alvo = gnuOpt.valor;
        if (gnuOpt.consumiuProximo) i++;
      } else if (arg === "-o") {
        alvo = cmdArgs[i + 1];
        if (alvo !== undefined) i++;
      } else if (arg.startsWith("-o") && !arg.startsWith("--")) {
        alvo = arg.slice(2);
      }

      if (alvo && (caminhoTocaWiki(alvo, base, raiz, ambiente) || !destinoEhSeguro(alvo, base, raiz, ambiente) || temMudancaDir)) {
        return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
      }
    }
  }

  // 5.7b git que grava a árvore de trabalho num ancestral da wiki
  if (verbo === "git") {
    const emMassa = gitNoAncestral(
      cmdArgs, [...ambienteGit.arvores, ...doComando.arvores], ambienteGit.configWorktree || doComando.configWorktree, base, raiz, ambiente
    );
    if (emMassa) return { acao: "bloquear", motivo: emMassa };
  }

  // 5.8 eval, source, .
  if (verbo === "eval" || verbo === "source" || verbo === ".") {
    if (temMudancaDir || cmdArgs.some(arg => argumentoTocaWiki(arg, base, raiz, ambiente) || arg.includes("wiki/"))) {
      return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
    }
  }

  // 5.9 Se o próprio cwd de execução (base) está sob a wiki
  if (estaSobWiki(base, raiz, ambiente, base)) {
    const tarListOnly = ehTar
      && cmdArgs.some(arg => arg === "--list" || (/^-[^-]/.test(arg) && arg.slice(1).includes("t")))
      && !cmdArgs.some(arg => ["--extract", "--create", "--append", "--update"].includes(arg)
        || (/^-[^-]/.test(arg) && /[xcru]/.test(arg.slice(1))));
    if (!LEITURAS_TERMINAL.has(verbo) && !tarListOnly && (verbo !== "git" || !GIT_LEITURA.has(analisarGit(cmdArgs).subcomando ?? ""))) {
      return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
    }
  }

  return { acao: "liberar", motivo: "comando simples permitido" };
}

function ehComandoSimplesCli(
  cmdTokens: Token[],
  base: string,
  raiz: string,
  ambiente: Record<string, string | undefined>
): boolean {
  // A isenção só aceita um comando simples já tokenizado, sem redirecionamentos ou operadores restantes.
  if (!cmdTokens.length || cmdTokens.some(token => token.operador)) return false;

  const args = cmdTokens.map(t => t.texto);
  if (args.length === 0) return false;

  const verbo = verboNormalizado(args[0]!);
  const SUBCOMANDOS_SEGUROS = new Set([
    "validar", "doctor", "status", "metricas", "buscar", "capturar", "auditar", "checar-docs", "fechar", "aprovar", "ui", "indexar", "hook", "hooks-wiki"
  ]);

  if (verbo === "bun" || verbo === "node") {
    if (args.length < 2) return false;
    const script = args[1]!;
    if (script.startsWith("-")) return false;

    const scriptAbs = resolve(base, script);
    let scriptReal = scriptAbs;
    try { scriptReal = caminhoReal(scriptAbs, base); } catch {}
    const cliAbs = resolve(raiz, "src/cli.ts");
    let cliReal = cliAbs;
    try { cliReal = caminhoReal(cliAbs, raiz); } catch {}

    if (scriptReal !== cliReal && scriptAbs !== cliAbs) {
      return false;
    }
    const subcomando = args[2]?.toLowerCase();
    if (!subcomando || !SUBCOMANDOS_SEGUROS.has(subcomando)) {
      return false;
    }
    return true;
  }

  if (verbo === "anvilore") {
    const subcomando = args[1]?.toLowerCase();
    if (!subcomando || !SUBCOMANDOS_SEGUROS.has(subcomando)) {
      return false;
    }
    return true;
  }

  return false;
}

function decidirTerminalVerified(
  cmdTexto: string,
  isWindows: boolean,
  base: string,
  raiz: string,
  ambiente: Record<string, string | undefined>,
  aninhado: ContextoAninhado = { profundidade: 0 },
  mudancaDirHerdada = false,
  ambienteGit: AmbienteGit = novoAmbienteGit()
): Decisao {
  if (!cmdTexto.trim()) {
    return { acao: "bloquear", motivo: "comando de terminal vazio citando verified ou aprovação (falha fechada)" };
  }

  // 0. Bloqueio de chamada a rotinas internas de aprovação
  if (/(?:aprovarPaginas|aprovarPelaInterface|comandos[\\/]aprovar)/i.test(cmdTexto)) {
    return { acao: "bloquear", motivo: "chamada direta a rotinas internas de aprovação" };
  }

  // 1. Tokenização e divisão em comandos simples antes de qualquer isenção.
  let tokens: Token[];
  try {
    tokens = tokenizar(cmdTexto, isWindows);
  } catch (erro) {
    const citaVerified = /verified/i.test(cmdTexto) || /\bby\s*:\s*human:/i.test(cmdTexto);
    const motivo = citaVerified
      ? `comando com sintaxe não interpretável citando verified ou aprovação: ${(erro as Error).message}`
      : `comando com sintaxe não interpretável: ${(erro as Error).message}`;
    return { acao: "bloquear", motivo };
  }

  const comandosSimples = dividirEmComandosSimples(tokens);
  if (comandosSimples.length === 0) {
    return { acao: "bloquear", motivo: "comando de terminal vazio ou inválido (falha fechada)" };
  }

  // 2. A isenção da CLI só vale para a invocação inteira quando há exatamente um comando simples.
  if (comandosSimples.length === 1 && ehComandoSimplesCli(comandosSimples[0]!.tokens, base, raiz, ambiente)) {
    return { acao: "liberar", motivo: "comando permitido da CLI do kit" };
  }

  const temCdOuPushd = mudancaDirHerdada || tokens.some(t => !t.operador && /^(?:cd|pushd)$/i.test(t.texto)) || /\b(?:cd|pushd)\b/i.test(cmdTexto);

  const contexto: ContextoAninhado = { ...aninhado, comandosNaLinha: comandosSimples.length };
  for (const { tokens: cmdTokens, doPipe } of comandosSimples) {
    const decisao = analisarComandoSimples(cmdTokens, base, raiz, ambiente, temCdOuPushd, contexto, ambienteGit, doPipe);
    if (decisao.acao === "bloquear") {
      return decisao;
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

  // Raiz do vault: sobe a partir de dados.cwd até achar SCHEMA.md e wiki/; fallback para ANVILORE_DESTINO ou instalado
  const cwdInformado = typeof dados.cwd === "string" && dados.cwd.trim() ? dados.cwd.trim() : undefined;
  const raizVault = encontrarRaizVault(cwdInformado ?? raiz, ambiente);
  const cwd = cwdInformado ? resolve(cwdInformado) : raizVault;

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

  // Sem inferência de ferramenta por chaves de tool_input (Regra A3)
  const nomeEfetivo = nome;

  // 1. apply_patch (Codex)
  if (FERRAMENTAS_PATCH.has(nomeEfetivo)) {
    if (!entradaMapa || typeof entradaMapa.patch !== "string") {
      return { acao: "bloquear", motivo: "apply_patch sem chave patch reconhecida (falha fechada)" };
    }
    return decidirPatch(entradaMapa.patch, cwd, raizVault, ambiente);
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

    return decidirTerminalVerified(cmdTexto, isWindows, base, raizVault, ambiente);
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
    const abs = isAbsolute(caminho) ? resolve(caminho) : resolve(cwd, caminho);
    if (!estaSobWiki(abs, raizVault, ambiente, cwd)) {
      return { acao: "liberar", motivo: "caminho fora de wiki/" };
    }
    if (typeof entradaMapa.content !== "string") {
      return { acao: "bloquear", motivo: "ferramenta de escrita sem content string (falha fechada)" };
    }
    return verificarMudancaVerified(abs, entradaMapa.content, raizVault, ambiente, cwd);
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
    const abs = isAbsolute(caminho) ? resolve(caminho) : resolve(cwd, caminho);
    if (!estaSobWiki(abs, raizVault, ambiente, cwd)) {
      return { acao: "liberar", motivo: "caminho fora de wiki/" };
    }
    const oldStr = entradaMapa.old_string ?? entradaMapa.oldText;
    const newStr = entradaMapa.new_string ?? entradaMapa.newText;
    if (typeof oldStr !== "string" || typeof newStr !== "string") {
      return { acao: "bloquear", motivo: "ferramenta de edição com old_string ou new_string ausente (falha fechada)" };
    }
    const replaceAll = Boolean(entradaMapa.replace_all ?? entradaMapa.replaceAll);

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
    return verificarMudancaVerified(abs, novoTexto, raizVault, ambiente, cwd);
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
    const abs = isAbsolute(caminho) ? resolve(caminho) : resolve(cwd, caminho);
    if (!estaSobWiki(abs, raizVault, ambiente, cwd)) {
      return { acao: "liberar", motivo: "caminho fora de wiki/" };
    }
    if (!Array.isArray(entradaMapa.edits) || entradaMapa.edits.length === 0) {
      return { acao: "bloquear", motivo: "ferramenta de multiedit sem array edits (falha fechada)" };
    }

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
    return verificarMudancaVerified(abs, simulado, raizVault, ambiente, cwd);
  }

  // 6. Ferramentas de Leitura
  if (FERRAMENTAS_LEITURA.has(nomeEfetivo)) {
    return { acao: "liberar", motivo: "ferramenta de leitura" };
  }

  // 7. Ferramenta desconhecida mexendo em wiki/
  if (estaSobWiki(resolve(cwd, "wiki"), raizVault, ambiente, cwd) || estaSobWiki(cwd, raizVault, ambiente, cwd) || Boolean(ambiente.ANVILORE_WIKI || existsSync(caminhoWiki(raizVault, ambiente)))) {
    if (payload.includes("wiki/") || payload.includes("wiki\\") || payload.includes(".md") || /wiki/i.test(payload)) {
      return { acao: "bloquear", motivo: `ferramenta desconhecida (${nome || "vazia"}) referenciando wiki/ ou .md (falha fechada)` };
    }
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
