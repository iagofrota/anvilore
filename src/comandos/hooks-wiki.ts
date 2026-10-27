import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { access, readFile, readdir } from "node:fs/promises";
import { caminhoWiki, repositorioDaWiki } from "../lib/wiki-repo";

type Json = Record<string, unknown>;
const dataLocal = (data = new Date()) => `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;

async function git(raiz: string, args: string[], timeout = 30_000): Promise<{ codigo: number; saida: string }> {
  const processo = Bun.spawn(["git", "-C", raiz, ...args], { stdout: "pipe", stderr: "pipe", timeout });
  const [saida, erro, codigo] = await Promise.all([new Response(processo.stdout).text(), new Response(processo.stderr).text(), processo.exited]);
  return { codigo, saida: `${saida}${erro}`.trim() };
}

export async function autoCommitWiki(raiz: string, arquivo: string): Promise<boolean> {
  const wiki = caminhoWiki(raiz);
  const abs = isAbsolute(arquivo) ? resolve(arquivo) : resolve(raiz, arquivo);
  const rel = relative(wiki, abs).split(sep).join("/");
  if (!rel || rel.startsWith("../") || rel === ".." || rel === "index.md" || rel === "log.md" || /^[^/]+\/index\.md$/.test(rel) || /^log\/log-\d{4}-\d{2}-\d{2}\.md$/.test(rel)) return false;
  if (!(await repositorioDaWiki(wiki))) return false;
  const areaIndex = /^[^/]+\//.test(rel) ? rel.replace(/\/[^/]+\/[^/]+\.md$/, "/index.md") : undefined;
  const dia = dataLocal();
  const logDiario = `log/log-${dia}.md`;
  const permitidos = new Set([rel, "index.md", "log.md", logDiario, ...(areaIndex ? [areaIndex] : [])]);
  const stagedAntes = await git(wiki, ["diff", "--cached", "--name-only", "-z"]);
  if (stagedAntes.codigo !== 0 || stagedAntes.saida.split("\0").filter(Boolean).some(arquivo => !permitidos.has(arquivo))) return false;
  if ((await git(wiki, ["add", "--", rel])).codigo !== 0) return false;
  // Índices e o log do dia seguem no mesmo commit da página da wiki.
  const associados = ["index.md", "log.md", ...(areaIndex ? [areaIndex] : []), logDiario];
  const existentes: string[] = [];
  for (const caminho of associados) {
    try { await access(resolve(wiki, caminho)); existentes.push(caminho); }
    catch (erro) { if ((erro as NodeJS.ErrnoException).code !== "ENOENT") throw erro; }
  }
  if (existentes.length) await git(wiki, ["add", "--", ...existentes]);
  const stagedDepois = await git(wiki, ["diff", "--cached", "--name-only", "-z"]);
  if (stagedDepois.codigo !== 0 || stagedDepois.saida.split("\0").filter(Boolean).some(arquivo => !permitidos.has(arquivo))) return false;
  if ((await git(wiki, ["diff", "--cached", "--quiet"])).codigo === 0) return false;
  const tipo = rel.includes("sources/") ? "ingest" : rel.includes("concepts/") ? "concept" : rel.includes("entities/") ? "entity" : "update";
  const slug = basename(rel).replace(/\.md$/i, "");
  return (await git(wiki, ["commit", "-m", `wiki(${tipo}): ${slug}`])).codigo === 0;
}

export async function backupGitHub(raiz: string): Promise<{ sincronizado: boolean; motivo?: string }> {
  const wiki = caminhoWiki(raiz);
  if (!(await repositorioDaWiki(wiki))) return { sincronizado: false, motivo: "wiki não é um repositório Git" };
  const branch = await git(wiki, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (branch.codigo !== 0 || !branch.saida) return { sincronizado: false, motivo: "HEAD destacado; backup não executado" };
  const upstream = await git(wiki, ["rev-parse", "--verify", "--quiet", "@{u}"]);
  if (upstream.codigo !== 0) return { sincronizado: false, motivo: "branch sem upstream configurado; backup não executado" };
  const contagem = await git(wiki, ["rev-list", "--count", "@{u}..HEAD"]);
  if (contagem.codigo !== 0 || Number(contagem.saida) <= 0) return { sincronizado: false, motivo: "não há commits locais para enviar" };
  const envio = await git(wiki, ["push"]);
  return envio.codigo === 0 ? { sincronizado: true } : { sincronizado: false, motivo: envio.saida || "falha no push para origin" };
}

export async function contextoWiki(raiz: string): Promise<string> {
  const partes: string[] = ["Contexto da wiki após compactação:"];
  try { partes.push("--- Índice atual (wiki/index.md) ---", ...(await readFile(resolve(raiz, "wiki/index.md"), "utf8")).split(/\r?\n/)); }
  catch (erro) { if ((erro as NodeJS.ErrnoException).code !== "ENOENT") throw erro; }
  const entradas = await entradasRecentes(raiz);
  if (entradas.length) partes.push("--- Últimas entradas do log diário ---", ...entradas);
  return partes.join("\n");
}

async function entradasRecentes(raiz: string): Promise<string[]> {
  let arquivos: string[];
  try { arquivos = (await readdir(resolve(raiz, "wiki/log"))).filter(nome => /^log-\d{4}-\d{2}-\d{2}\.md$/.test(nome)).sort().reverse(); }
  catch (erro) { if ((erro as NodeJS.ErrnoException).code === "ENOENT") return []; throw erro; }
  const resultado: string[] = [];
  for (const nome of arquivos) {
    const texto = await readFile(resolve(raiz, "wiki/log", nome), "utf8");
    const linhas = texto.split(/\r?\n/);
    const inicios = linhas.map((linha, i) => /^## \[\d{4}-\d{2}-\d{2}\] /.test(linha) ? i : -1).filter(i => i >= 0);
    for (let n = inicios.length - 1; n >= 0; n--) {
      const indice = inicios[n]!;
      const proximo = inicios[n + 1] ?? linhas.length;
      resultado.push(...linhas.slice(indice, proximo));
      if (resultado.filter(linha => /^## \[\d{4}-\d{2}-\d{2}\] /.test(linha)).length >= 5) return resultado;
    }
  }
  return resultado;
}

export async function sugerirLint(raiz: string): Promise<string | undefined> {
  let arquivos: string[];
  try { arquivos = (await readdir(resolve(raiz, "wiki/log"))).filter(nome => /^log-\d{4}-\d{2}-\d{2}\.md$/.test(nome)).sort().reverse(); }
  catch (erro) { if ((erro as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw erro; }
  let ingestoes = 0;
  for (const nome of arquivos) {
    const linhas = (await readFile(resolve(raiz, "wiki/log", nome), "utf8")).split(/\r?\n/).reverse();
    for (const linha of linhas) {
      if (/^## \[.*\] lint\s*\|/i.test(linha)) return ingestoes >= 5 ? sugestao(ingestoes) : undefined;
      if (/^## \[.*\] ingest\s*\|/i.test(linha)) ingestoes++;
    }
  }
  return ingestoes >= 5 ? sugestao(ingestoes) : undefined;
}

const sugestao = (ingestoes: number) => `Anvilore: ${ingestoes} ingestões desde o último lint. Considere rodar a skill lint.`;
const notificar = (mensagem: string) => console.log(JSON.stringify({ systemMessage: mensagem }));

async function config(raiz: string): Promise<{ autoCommit: boolean; backup: boolean }> {
  try {
    const texto = await readFile(resolve(raiz, "anvilore.toml"), "utf8");
    const toml = Bun.TOML.parse(texto) as Json;
    const hooks = (toml.hooks && typeof toml.hooks === "object" ? toml.hooks : {}) as Json;
    return { autoCommit: hooks.auto_commit === true, backup: hooks.github_backup === true };
  } catch { return { autoCommit: false, backup: false }; }
}

function negarPermissao(evento: "PreToolUse", mensagem: string): void {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: evento, permissionDecision: "deny", permissionDecisionReason: mensagem } }));
}

function dentro(base: string, alvo: string): boolean {
  const rel = relative(resolve(base), resolve(alvo));
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function protegerAprovacao(raiz: string, entrada: string): Promise<void> {
  let payload: Json;
  try { payload = JSON.parse(entrada) as Json; }
  catch { negarPermissao("PreToolUse", "Não foi possível conferir o modo da sessão; aprovação recusada."); return; }
  const ferramenta = (payload.tool_input ?? payload.toolInput ?? {}) as Json;
  const comando = ferramenta.command;
  if (typeof comando !== "string" || !/(?:^|[\s;&|])(?:bun\s+[^\n;&|]*\s+|anvilore\s+)aprovar(?:\s|$)/i.test(comando)) return;
  if (payload.permission_mode !== "default") negarPermissao("PreToolUse", "Para aprovar, saia do modo automático (Shift+Tab) e peça de novo");
}

async function protegerVerified(raiz: string, entrada: string): Promise<void> {
  let payload: Json;
  try { payload = JSON.parse(entrada) as Json; } catch { return; }
  const ferramenta = (payload.tool_input ?? payload.toolInput ?? {}) as Json;
  const caminho = ferramenta.file_path ?? ferramenta.filePath ?? ferramenta.path;
  if (typeof caminho !== "string") return;
  const base = caminhoWiki(raiz);
  const abs = isAbsolute(caminho) ? resolve(caminho) : resolve(typeof payload.cwd === "string" ? payload.cwd : raiz, caminho);
  if (!dentro(base, abs)) return;
  const blocoVerified = (texto: string): string => {
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
  };
  const mudouBloco = (anterior: string, novo: string) => blocoVerified(anterior) !== blocoVerified(novo);
  let mudou = false;
  if (typeof ferramenta.content === "string") {
    let atual = "";
    try { atual = await readFile(abs, "utf8"); }
    catch (erro) { if ((erro as NodeJS.ErrnoException).code !== "ENOENT") { negarPermissao("PreToolUse", "Não foi possível comparar verified com o arquivo atual."); return; } }
    mudou = mudouBloco(atual, ferramenta.content);
  } else {
    const edicoes = Array.isArray(ferramenta.edits) ? ferramenta.edits as Json[] : [ferramenta];
    mudou = edicoes.some(edicao => {
      const anterior = typeof edicao.old_string === "string" ? edicao.old_string : "";
      const novo = typeof edicao.new_string === "string" ? edicao.new_string : "";
      return mudouBloco(anterior, novo);
    });
  }
  if (mudou) negarPermissao("PreToolUse", "Só o comando de aprovação pode alterar verified em wiki/.");
}

export async function comandoHooksWiki(args: string[], lerEntrada: () => Promise<string> = () => Bun.stdin.text()): Promise<number> {
  const [acao, raizArg] = args;
  const raiz = resolve(raizArg ?? process.cwd());
  try {
    if (acao === "contexto") { console.log(await contextoWiki(raiz)); return 0; }
    if (acao === "watch-paths") {
      console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", watchPaths: [resolve(raiz, "raw")] } })); return 0;
    }
    if (acao === "sugerir-lint") { const mensagem = await sugerirLint(raiz); if (mensagem) notificar(mensagem); return 0; }
    if (acao === "autocommit") {
      const textoEntrada = await lerEntrada(); const payload = JSON.parse(textoEntrada) as Json;
      const dadosFerramenta = (payload.tool_input ?? payload.toolInput ?? payload.toolArgs) as Json | undefined;
      const arquivo = dadosFerramenta?.file_path ?? dadosFerramenta?.filePath ?? dadosFerramenta?.path;
      if (typeof arquivo !== "string") return 0;
      const opcoes = await config(raiz);
      if (opcoes.autoCommit && !(await autoCommitWiki(raiz, arquivo))) {
        notificar("Commit automático não realizado; confira o repositório Git da wiki com `anvilore doctor`.");
      }
      return 0;
    }
    if (acao === "proteger-aprovacao") { await protegerAprovacao(raiz, await lerEntrada()); return 0; }
    if (acao === "proteger-verified") { await protegerVerified(raiz, await lerEntrada()); return 0; }
    if (acao === "backup") {
      if (!(await config(raiz)).backup) return 0;
      const resultado = await backupGitHub(raiz);
      // SessionEnd não exibe saída para a pessoa; a condição sem upstream é diagnosticada pelo doctor.
      if (!resultado.sincronizado && resultado.motivo && resultado.motivo.includes("upstream")) {
        console.error(`Backup não realizado: ${resultado.motivo}`); return 2;
      }
      else if (resultado.motivo) console.error(`Backup não realizado: ${resultado.motivo}`);
      return 0;
    }
    if (acao === "arquivo-raw") {
      const payload = JSON.parse(await lerEntrada()) as Json;
      const arquivo = payload.file_path;
      if (payload.event === "add" && typeof arquivo === "string" && /(?:^|[\\/])raw(?:[\\/]|$)/i.test(arquivo)) notificar(`Novo arquivo em raw/: ${arquivo}. Diga "ingest" para processá-lo.`);
      return 0;
    }
    console.error("Uso: anvilore hooks-wiki <autocommit|backup|arquivo-raw|contexto|sugerir-lint|watch-paths|proteger-aprovacao|proteger-verified> [raiz]");
    return 2;
  } catch (erro) { console.error(`hooks-wiki: ${(erro as Error).message}`); return 0; }
}
