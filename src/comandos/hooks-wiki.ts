import { basename, relative, resolve, sep } from "node:path";
import { access, readFile, readdir } from "node:fs/promises";

type Json = Record<string, unknown>;
const dataLocal = (data = new Date()) => `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;

async function git(raiz: string, args: string[], timeout = 30_000): Promise<{ codigo: number; saida: string }> {
  const processo = Bun.spawn(["git", "-C", raiz, ...args], { stdout: "pipe", stderr: "pipe", timeout });
  const [saida, erro, codigo] = await Promise.all([new Response(processo.stdout).text(), new Response(processo.stderr).text(), processo.exited]);
  return { codigo, saida: `${saida}${erro}`.trim() };
}

export async function autoCommitWiki(raiz: string, arquivo: string): Promise<boolean> {
  const abs = resolve(raiz, arquivo);
  const rel = relative(resolve(raiz), abs).split(sep).join("/");
  if (!rel.startsWith("wiki/") || rel === "wiki/index.md" || rel === "wiki/log.md" || /^wiki\/[^/]+\/index\.md$/.test(rel) || /^wiki\/log\/log-\d{4}-\d{2}-\d{2}\.md$/.test(rel) || rel.includes("../")) return false;
  if ((await git(raiz, ["rev-parse", "--git-dir"])).codigo !== 0) return false;
  const areaIndex = /^wiki\/[^/]+\//.test(rel) ? rel.replace(/\/[^/]+\/[^/]+\.md$/, "/index.md") : undefined;
  const dia = dataLocal();
  const logDiario = `wiki/log/log-${dia}.md`;
  const permitidos = new Set([rel, "wiki/index.md", "wiki/log.md", logDiario, ...(areaIndex ? [areaIndex] : [])]);
  const stagedAntes = await git(raiz, ["diff", "--cached", "--name-only", "-z"]);
  if (stagedAntes.codigo !== 0 || stagedAntes.saida.split("\0").filter(Boolean).some(arquivo => !permitidos.has(arquivo))) return false;
  if ((await git(raiz, ["add", "--", rel])).codigo !== 0) return false;
  // Índices e o log do dia seguem no mesmo commit da página da wiki.
  const associados = ["wiki/index.md", "wiki/log.md", ...(areaIndex ? [areaIndex] : []), logDiario];
  const existentes: string[] = [];
  for (const caminho of associados) {
    try { await access(resolve(raiz, caminho)); existentes.push(caminho); }
    catch (erro) { if ((erro as NodeJS.ErrnoException).code !== "ENOENT") throw erro; }
  }
  if (existentes.length) await git(raiz, ["add", "--", ...existentes]);
  const stagedDepois = await git(raiz, ["diff", "--cached", "--name-only", "-z"]);
  if (stagedDepois.codigo !== 0 || stagedDepois.saida.split("\0").filter(Boolean).some(arquivo => !permitidos.has(arquivo))) return false;
  if ((await git(raiz, ["diff", "--cached", "--quiet"])).codigo === 0) return false;
  const tipo = rel.includes("/sources/") ? "ingest" : rel.includes("/concepts/") ? "concept" : rel.includes("/entities/") ? "entity" : "update";
  const slug = basename(rel).replace(/\.md$/i, "");
  return (await git(raiz, ["commit", "-m", `wiki(${tipo}): ${slug}`])).codigo === 0;
}

export async function backupGitHub(raiz: string): Promise<{ sincronizado: boolean; motivo?: string }> {
  if ((await git(raiz, ["rev-parse", "--git-dir"])).codigo !== 0) return { sincronizado: false, motivo: "não é um repositório Git" };
  const branch = await git(raiz, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (branch.codigo !== 0 || !branch.saida) return { sincronizado: false, motivo: "HEAD destacado; backup não executado" };
  const upstream = await git(raiz, ["rev-parse", "--verify", "--quiet", "@{u}"]);
  if (upstream.codigo !== 0) return { sincronizado: false, motivo: "branch sem upstream configurado; backup não executado" };
  const contagem = await git(raiz, ["rev-list", "--count", "@{u}..HEAD"]);
  if (contagem.codigo !== 0 || Number(contagem.saida) <= 0) return { sincronizado: false, motivo: "não há commits locais para enviar" };
  const envio = await git(raiz, ["push"]);
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
      if (opcoes.autoCommit) await autoCommitWiki(raiz, arquivo);
      return 0;
    }
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
    console.error("Uso: anvilore hooks-wiki <autocommit|backup|arquivo-raw|contexto|sugerir-lint|watch-paths> [raiz]");
    return 2;
  } catch (erro) { console.error(`hooks-wiki: ${(erro as Error).message}`); return 0; }
}
