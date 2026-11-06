import { existsSync, readdirSync, realpathSync } from "node:fs";
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

export function resolverAncestralRealComResto(caminhoAbsoluto: string): string {
  let atual = caminhoAbsoluto;
  const cauda: string[] = [];
  while (true) {
    try {
      const real = realpathSync.native(atual);
      return cauda.length ? join(real, ...cauda.reverse()) : real;
    } catch {
      const pai = dirname(atual);
      if (pai === atual) {
        return caminhoAbsoluto;
      }
      cauda.push(basename(atual));
      atual = pai;
    }
  }
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
  const real = resolverAncestralRealComResto(abs);

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

  const semGlob = limpo.includes("*") || limpo.includes("?")
    ? limpo.replace(/[*?].*$/, "")
    : limpo;
  const caminhoParaResolver = semGlob || ".";

  return estaSobWiki(caminhoParaResolver, raiz, ambiente, base) || estaSobWiki(caminhoParaResolver, raiz, ambiente, raiz);
}

const MSG_TERMINAL_WIKI = "Edite páginas da wiki pelas ferramentas de edição (Write/Edit/apply_patch); o terminal não escreve em wiki/.";

function extrairAlvosRedirecionamento(cmdTexto: string): string[] {
  const alvos: string[] = [];
  const regex = /(?:>>|>\||&>|(?:\d+)?>(?!&[012]))\s*(?:"([^"]+)"|'([^']+)'|([^\s;|&<>()]+))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(cmdTexto)) !== null) {
    const alvo = match[1] ?? match[2] ?? match[3];
    if (alvo) alvos.push(alvo.trim());
  }
  return alvos;
}

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

  // 1. Resolve o destino (normaliza .., realpath do pai existente) e classifica com estaSobWiki ANTES de qualquer isenção
  if (estaSobWiki(limpo, raiz, ambiente, base)) {
    return false;
  }

  // 2. A isenção de /tmp só vale para destino resolvido que NÃO está sob a wiki
  const abs = isAbsolute(limpo) ? resolve(limpo) : resolve(base, limpo);
  const real = resolverAncestralRealComResto(abs);
  if (estaSobTmp(abs, real)) {
    return true;
  }

  if (isAbsolute(limpo)) {
    return true;
  }

  return false;
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

function dividirEmComandosSimples(tokens: Token[]): Token[][] {
  const comandos: Token[][] = [];
  let atual: Token[] = [];
  for (const token of tokens) {
    if (token.operador && /^[;&|]+$/.test(token.texto)) {
      if (atual.length > 0) {
        comandos.push(atual);
        atual = [];
      }
    } else {
      atual.push(token);
    }
  }
  if (atual.length > 0) {
    comandos.push(atual);
  }
  return comandos;
}

function analisarComandoSimples(
  cmdTokens: Token[],
  base: string,
  raiz: string,
  ambiente: Record<string, string | undefined>,
  temMudancaDir: boolean
): Decisao {
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
  while (palavras.length > 0 && (/^[A-Za-z_]\w*=/.test(palavras[0]!) || /^(?:do|then|else|elif|\{|\}|!|while|until|if)$/.test(palavras[0]!))) {
    palavras = palavras.slice(1);
  }
  if (!palavras.length) {
    return { acao: "liberar", motivo: "comando simples vazio ou sem verbo" };
  }

  // 3. Normaliza verbo e desembrulha wrappers (sudo, env, time, etc.)
  let verbo = verboNormalizado(palavras[0]!);
  while (ENVOLVEDORES.has(verbo) && palavras.length > 1) {
    const { resto, descartados } = desembrulhar(verbo, palavras.slice(1));
    if (verbo === "time" || verbo === "stdbuf") {
      for (let i = 0; i < descartados.length; i++) {
        const arg = descartados[i]!;
        let outTarget: string | undefined;
        const gnuOpt = extrairDestinoOpcaoLongaGnu(arg, descartados[i + 1], "--output");
        if (gnuOpt.bateu) {
          outTarget = gnuOpt.valor;
          if (gnuOpt.consumiuProximo) i++;
        } else if (arg === "-o") {
          outTarget = descartados[i + 1];
          if (outTarget !== undefined) i++;
        } else if (arg.startsWith("-o") && arg.length > 2 && !arg.startsWith("--")) {
          outTarget = arg.slice(2);
        }
        if (outTarget && (caminhoTocaWiki(outTarget, base, raiz, ambiente) || !destinoEhSeguro(outTarget, base, raiz, ambiente) || temMudancaDir)) {
          return { acao: "bloquear", motivo: `${verbo} com opção de saída em arquivo citando wiki` };
        }
      }
    }
    palavras = resto;
    if (!palavras.length) break;
    verbo = verboNormalizado(palavras[0]!);
  }

  if (!verbo) {
    return { acao: "bloquear", motivo: "comando com verbo vazio ou inválido (falha fechada)" };
  }

  const cmdArgs = palavras.slice(1);
  const cmdTextoSimples = cmdTokens.map(t => t.texto).join(" ");

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
    for (let i = 0; i < cmdArgs.length; i++) {
      const arg = cmdArgs[i]!;
      const gnuOpt = extrairDestinoOpcaoLongaGnu(arg, cmdArgs[i + 1], "--target-directory");
      if (gnuOpt.bateu) {
        if (gnuOpt.valor !== undefined) destinos.push(gnuOpt.valor);
        if (gnuOpt.consumiuProximo) i++;
      } else if (arg === "-t") {
        if (cmdArgs[i + 1]) destinos.push(cmdArgs[++i]!);
      } else if (arg.startsWith("-t") && arg.length > 2 && !arg.startsWith("--")) {
        destinos.push(arg.slice(2));
      }
    }
    const operandos = cmdArgs.filter(arg => !arg.startsWith("-"));
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
  }

  // 5.2 tee: cada operando não-flag é um arquivo de destino
  if (verbo === "tee") {
    const destinosTee = cmdArgs.filter(arg => !arg.startsWith("-"));
    for (const dest of destinosTee) {
      if (caminhoTocaWiki(dest, base, raiz, ambiente) || !destinoEhSeguro(dest, base, raiz, ambiente) || temMudancaDir) {
        return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
      }
    }
  }

  // 5.3 dd: of=...
  if (verbo === "dd") {
    const ofArg = cmdArgs.find(arg => /^of=/i.test(arg));
    if (ofArg) {
      const destDd = ofArg.slice(3).replace(/^["']|["']$/g, "").trim();
      if (caminhoTocaWiki(destDd, base, raiz, ambiente) || !destinoEhSeguro(destDd, base, raiz, ambiente) || temMudancaDir) {
        return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
      }
    }
  }

  // 5.4 Editores com in-place: sed, perl, ruby
  if (["sed", "perl", "ruby"].includes(verbo)) {
    const temInPlace = cmdArgs.some(arg =>
      (arg.startsWith("--") && arg.length >= 3 && opcaoLongaGnu(arg, "--in-place", "--i")) ||
      /^-[a-zA-Z0-9_]*i/i.test(arg)
    );
    if (temInPlace) {
      const operandos = cmdArgs.filter(arg => !arg.startsWith("-"));
      if (temMudancaDir || operandos.some(arg => argumentoTocaWiki(arg, base, raiz, ambiente))) {
        return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
      }
    }
  }

  // 5.5 Interpretadores com código inline
  if (/^(?:python(?:\d+(?:\.\d+)?)?|node|bun|deno|ruby|perl|php)$/i.test(verbo)) {
    const temInline = cmdArgs.some(arg => /^--(?:eval|print)(?:=|$)/.test(arg) || /^-[a-zA-Z0-9_]*[cepr]/.test(arg));
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
    const { subcomando } = analisarGit(cmdArgs);
    if (subcomando && !GIT_LEITURA.has(subcomando)) {
      if (temMudancaDir || cmdArgs.some(arg => argumentoTocaWiki(arg, base, raiz, ambiente))) {
        return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
      }
    }
    for (let i = 0; i < cmdArgs.length; i++) {
      const arg = cmdArgs[i]!;
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

  // 5.8 eval, source, .
  if (verbo === "eval" || verbo === "source" || verbo === ".") {
    if (temMudancaDir || cmdArgs.some(arg => argumentoTocaWiki(arg, base, raiz, ambiente) || arg.includes("wiki/"))) {
      return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
    }
  }

  // 5.9 Se o próprio cwd de execução (base) está sob a wiki
  if (estaSobWiki(base, raiz, ambiente, base)) {
    if (!LEITURAS_TERMINAL.has(verbo) && (verbo !== "git" || !GIT_LEITURA.has(analisarGit(cmdArgs).subcomando ?? ""))) {
      return { acao: "bloquear", motivo: MSG_TERMINAL_WIKI };
    }
  }

  return { acao: "liberar", motivo: "comando simples permitido" };
}

function ehComandoSimplesCli(
  cmdTexto: string,
  base: string,
  raiz: string
): boolean {
  // Allowlist só libera se o comando INTEIRO for um único comando simples
  // (sem ;, &&, ||, |, &, $(, crase, (, redireção para wiki/)
  if (/[;&|`$()]/.test(cmdTexto)) return false;

  const alvos = extrairAlvosRedirecionamento(cmdTexto);
  if (alvos.some(alvo => caminhoTocaWiki(alvo, base, raiz, process.env))) return false;

  let tokens: Token[];
  try {
    tokens = tokenizar(cmdTexto);
  } catch {
    return false;
  }

  const args = tokens.filter(t => !t.operador).map(t => t.texto);
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
  ambiente: Record<string, string | undefined>
): Decisao {
  if (!cmdTexto.trim()) {
    return { acao: "bloquear", motivo: "comando de terminal vazio citando verified ou aprovação (falha fechada)" };
  }

  // 0. Bloqueio de chamada a rotinas internas de aprovação
  if (/(?:aprovarPaginas|aprovarPelaInterface|comandos[\\/]aprovar)/i.test(cmdTexto)) {
    return { acao: "bloquear", motivo: "chamada direta a rotinas internas de aprovação" };
  }

  const wiki = caminhoWiki(raiz, ambiente);
  const wikiExiste = Boolean(ambiente.ANVILORE_WIKI || existsSync(wiki));
  if (!wikiExiste) {
    return { acao: "liberar", motivo: "wiki inexistente no vault" };
  }

  // 1. Allowlist do CLI do kit: regra 4
  if (ehComandoSimplesCli(cmdTexto, base, raiz)) {
    return { acao: "liberar", motivo: "comando permitido da CLI do kit" };
  }

  // 2. Tokenização e divisão em comandos simples
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

  const temCdOuPushd = tokens.some(t => !t.operador && /^(?:cd|pushd)$/i.test(t.texto)) || /\b(?:cd|pushd)\b/i.test(cmdTexto);

  for (const cmdTokens of comandosSimples) {
    const decisao = analisarComandoSimples(cmdTokens, base, raiz, ambiente, temCdOuPushd);
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
