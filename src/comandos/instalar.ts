import { lstat, mkdir, readFile, readdir, realpath, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fundirJson } from "../lib/fundir-json";
import { fundirBloco } from "../lib/fundir-bloco";

const fonte = resolve(import.meta.dir, "../..");
export const alvosConhecidos = ["claude", "codex", "gemini", "copilot"] as const;
export type Alvo = typeof alvosConhecidos[number];
export interface RelatorioInstalacao {
  codigo: number;
  veredito: "INALTERADO" | "MUDOU";
  mensagens: string[];
  ausentes: Alvo[];
  instalados: Alvo[];
  mudancas: number;
}

async function informacao(caminho: string) {
  try { return await lstat(caminho); }
  catch (erro) { if ((erro as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw erro; }
}

async function linkCorreto(origem: string, link: string): Promise<boolean> {
  if (!(await informacao(link))?.isSymbolicLink()) return false;
  try { return await realpath(link) === await realpath(origem); }
  catch (erro) { if ((erro as NodeJS.ErrnoException).code === "ENOENT") return false; throw erro; }
}

async function ligar(origem: string, link: string, diretorio: boolean): Promise<"criado" | "ja-correto" | "falhou"> {
  try {
    if (await linkCorreto(origem, link)) return "ja-correto";
    const info = await informacao(link);
    if (info && !info.isSymbolicLink()) throw new Error("caminho já existe — preservado");
    if (info) await unlink(link);
    const juncao = diretorio && process.platform === "win32";
    await symlink(juncao ? resolve(origem) : relative(dirname(link), origem), link, juncao ? "junction" : diretorio ? "dir" : "file");
    return "criado";
  } catch (erro) {
    console.warn(`AVISO: falha ao ligar ${link}: ${erro instanceof Error ? erro.message : String(erro)}. Nenhuma cópia foi feita.`);
    return "falhou";
  }
}

export async function ligarDiretorio(origem: string, link: string): Promise<"criado" | "ja-correto" | "falhou"> {
  return ligar(origem, link, true);
}

// A Tarefa 8 troca só estas formas; a decisão continua no hook.
export async function configuracaoDoHook(alvo: Alvo): Promise<{ arquivo: string; json?: unknown; bloco?: string }> {
  switch (alvo) {
    case "claude": return { arquivo: ".claude/settings.json", json: JSON.parse(await readFile(join(fonte, "hooks/hooks.json"), "utf8")) };
    case "codex": return { arquivo: ".codex/config.toml", bloco: '# Recusa escrita do agente em raw/. A decisão mora em hooks/proteger-raw.sh;\n# esta forma só aponta para lá.\n[[hooks.PreToolUse]]\nmatcher = "apply_patch|Edit|Write"\n\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = "./hooks/proteger-raw.sh"' };
    case "gemini": return { arquivo: ".gemini/settings.json", json: { context: { fileName: ["AGENTS.md", "GEMINI.md"] }, hooks: { BeforeTool: [{ matcher: "write_file|replace", hooks: [{ name: "proteger-raw", type: "command", command: "./hooks/proteger-raw.sh" }] }] } } };
    case "copilot": return { arquivo: ".github/copilot/settings.json", json: { hooks: { preToolUse: [{ type: "command", bash: "./hooks/proteger-raw.sh" }] } } };
  }
}

async function pecaDoEsqueleto(rel: string): Promise<string> {
  try { return await readFile(join(fonte, rel), "utf8"); }
  catch (erro) { if ((erro as NodeJS.ErrnoException).code !== "ENOENT") throw erro; }
  const git = Bun.which("git", { PATH: process.env.PATH });
  if (!git) throw new Error(`fonte sem ${rel} e git ausente do PATH — esqueleto não recuperado`);
  const processo = Bun.spawn([git, "-C", fonte, "show", `HEAD:${rel}`], { stdout: "pipe", stderr: "pipe" });
  const [texto, erro, codigo] = await Promise.all([new Response(processo.stdout).text(), new Response(processo.stderr).text(), processo.exited]);
  if (codigo !== 0) throw new Error(`fonte sem '${rel}' na árvore e no último commit: ${erro.trim()}`);
  return texto;
}

export async function instalar(opcoes: { alvos: Alvo[]; destino: string; simular: boolean }): Promise<RelatorioInstalacao> {
  const r: RelatorioInstalacao = { codigo: 0, veredito: "INALTERADO", mensagens: [], ausentes: [], instalados: [], mudancas: 0 };
  const relatar = (mensagem: string) => { r.mensagens.push(mensagem); };
  const erro = (mensagem: string) => { r.codigo = 4; relatar(`ERRO: ${mensagem}`); };
  const mudar = (mensagem: string) => { r.mudancas++; r.veredito = "MUDOU"; relatar(mensagem); };
  let destino: string;
  try {
    destino = await realpath(opcoes.destino);
    if (!(await stat(destino)).isDirectory()) throw new Error("destino não é diretório");
    for (const lar of [process.env.HOME, process.env.USERPROFILE]) {
      if (lar && destino === await realpath(lar)) throw new Error("recusado: o destino é o seu HOME; use um clone do anvilore");
    }
    for (const exigido of ["AGENTS.md", "skills", "hooks/proteger-raw.sh"]) {
      if (!(await informacao(join(destino, exigido)))) throw new Error(`recusado: destino não parece um clone do anvilore (falta '${exigido}')`);
    }
    if (opcoes.alvos.some(alvo => !alvosConhecidos.includes(alvo))) throw new Error("alvo desconhecido");
  } catch (e) {
    r.codigo = 1; relatar(`recusado: ${e instanceof Error ? e.message : String(e)}`); return r;
  }
  relatar("anvilore — instalação");
  relatar(`destino: ${destino}`);
  if (opcoes.simular) relatar("SIMULAÇÃO (nada será escrito)");

  async function escrever(rel: string, texto: string) {
    mudar(`escreve: ${rel}`);
    if (!opcoes.simular) {
      const caminho = join(destino, rel);
      await mkdir(dirname(caminho), { recursive: true }); await writeFile(caminho, texto);
    }
  }
  async function configurar(rel: string, fragmento: { json?: unknown; bloco?: string }) {
    const caminho = join(destino, rel);
    let atual: string | undefined;
    try { atual = await readFile(caminho, "utf8"); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    const novo = fragmento.bloco !== undefined
      ? fundirBloco(atual ?? "", "anvilore", fragmento.bloco, "#").resultado
      : JSON.stringify(fundirJson(atual === undefined ? {} : JSON.parse(atual), fragmento.json).resultado, null, 2) + "\n";
    if (atual === novo) relatar(`inalterado: ${rel}`); else await escrever(rel, novo);
  }
  async function instalarLink(rel: string, origem: string, diretorio: boolean) {
    const link = join(destino, rel);
    if (await linkCorreto(origem, link)) { relatar(`inalterado: ${rel}`); return; }
    const info = await informacao(link);
    if (info && !info.isSymbolicLink()) { relatar(`AVISO: ${rel} já existe — preservado, nada escrito`); return; }
    if (opcoes.simular) { mudar(`liga: ${rel}`); return; }
    await mkdir(dirname(link), { recursive: true });
    const estado = diretorio ? await ligarDiretorio(origem, link) : await ligar(origem, link, false);
    if (estado === "falhou") erro(`${rel}: falha de link; nenhuma cópia foi feita`);
    else if (estado === "criado") mudar(`liga: ${rel}`);
  }

  try {
    const fronteira = await pecaDoEsqueleto("wiki/.gitignore");
    const pecas = ["wiki/.gitignore", ...fronteira.split(/\r?\n/).filter(l => l.startsWith("!") && !l.endsWith("/") && l !== "!.gitignore").map(l => `wiki/${l.slice(1)}`)];
    for (const rel of pecas) {
      if (await informacao(join(destino, rel))) relatar(`inalterado: ${rel}`);
      else await escrever(rel, await pecaDoEsqueleto(rel));
    }
    const skills = (await readdir(join(fonte, "skills"))).sort();
    for (const alvo of [...new Set(opcoes.alvos)]) {
      if (!Bun.which(alvo, { PATH: process.env.PATH })) { r.ausentes.push(alvo); relatar(`${alvo}: CLI ausente do PATH — alvo pulado (isto não é uma falha)`); continue; }
      try {
        const config = await configuracaoDoHook(alvo);
        // Conflito é detectado antes de instalar as skills deste agente.
        await configurar(config.arquivo, config);
        for (const nome of skills) {
          const caminho = join(fonte, "skills", nome, "SKILL.md");
          if (!(await informacao(caminho))?.isFile()) continue;
          if (alvo === "gemini") {
            const texto = await readFile(caminho, "utf8");
            const descricao = /^description:\s*(.*)$/m.exec(texto)?.[1]?.trim().replace(/^"|"$/g, "") ?? "";
            await configurar(`.gemini/commands/${nome}.toml`, { bloco: `description = ${JSON.stringify(descricao)}\nprompt = """\nSiga as instruções de \`skills/${nome}/SKILL.md\`, neste repositório, do começo ao\nfim, sem pular passos. O contrato que limita o que você pode fazer está em\n\`AGENTS.md\`; leia-o antes de tocar em qualquer arquivo.\n"""` });
          } else {
            const rel = alvo === "copilot" ? `.github/agents/${nome}.agent.md` : `${alvo === "claude" ? ".claude" : ".agents"}/skills/${nome}`;
            await instalarLink(rel, alvo === "copilot" ? caminho : dirname(caminho), alvo !== "copilot");
          }
        }
        r.instalados.push(alvo);
      } catch (e) { erro(`${alvo}: ${e instanceof Error ? e.message : String(e)}`); break; }
    }
  } catch (e) { erro(e instanceof Error ? e.message : String(e)); }
  if (r.codigo) relatar("ERROS — a instalação parou onde não podia decidir sozinha.");
  else if (!r.mudancas) relatar("INALTERADO: nada a fazer — tudo já estava instalado.");
  else relatar(`${opcoes.simular ? "SIMULAÇÃO: " : ""}MUDOU: ${r.mudancas} mudança(s) ${opcoes.simular ? "seriam aplicadas" : "aplicada(s)"}.`);
  return r;
}

export async function comandoInstalar(args: string[]): Promise<number> {
  try {
    const { values } = parseArgs({ args, options: { alvo: { type: "string" }, destino: { type: "string" }, simular: { type: "boolean" }, help: { type: "boolean", short: "h" } }, allowPositionals: false, strict: true });
    if (values.help) {
      console.log(`Uso: anvilore instalar [--alvo ${alvosConhecidos.join(",")}|todos] [--destino dir] [--simular]\nConfigura um clone do anvilore; CLI ausente é relatada e pulada.\nLinux, Windows nativo e macOS: links de diretório usam junções no Windows; falhas são explícitas, sem cópia.\nPadrão: todos os alvos; destino da instalação = ANVILORE_DESTINO ou diretório do kit.`);
      return 0;
    }
    const pedidos = values.alvo ?? "todos";
    const alvos = pedidos === "todos" ? [...alvosConhecidos] : pedidos.split(",");
    if (alvos.some(alvo => !alvosConhecidos.includes(alvo as Alvo))) throw new Error(`alvo desconhecido: '${pedidos}'. Conhecidos: ${alvosConhecidos.join(", ")}, todos`);
    const r = await instalar({ alvos: alvos as Alvo[], destino: values.destino ?? process.env.ANVILORE_DESTINO ?? fonte, simular: values.simular ?? false });
    for (const mensagem of r.mensagens) console.log(mensagem);
    return r.codigo;
  } catch (e) { console.error(e instanceof Error ? e.message : String(e)); return 1; }
}
