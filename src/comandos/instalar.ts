import { lstat, mkdir, readFile, readdir, realpath, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { lerFrontmatter } from "../lib/frontmatter";
import { fundirJson } from "../lib/fundir-json";
import { fundirBloco } from "../lib/fundir-bloco";
import { agentesDaIngestao, MARCA_DE_GERADO } from "../lib/papeis-ingestao";
import { avisoRg } from "../lib/rg";
import { escreverPeca, planejarModelos } from "../lib/modelos";
import { inicializarRepositorioWiki } from "../lib/wiki-repo";

const fonte = resolve(import.meta.dir, "../..");
export const alvosConhecidos = ["claude", "codex", "gemini", "copilot"] as const;
export type Alvo = typeof alvosConhecidos[number];
type OpcoesInstalacao = { alvos: Alvo[]; destino: string; simular: boolean; autoCommit?: boolean; githubBackup?: boolean };
type EstadoLink = "criado" | "ja-correto" | "falhou";
type Fragmento = { json?: unknown; bloco?: string };

export interface RelatorioInstalacao {
  codigo: number;
  veredito: "INALTERADO" | "MUDOU";
  mensagens: string[];
  ausentes: Alvo[];
  instalados: Alvo[];
  mudancas: number;
  avisos: number;
  erros: number;
}

type Contexto = { destino: string; simular: boolean; relatorio: RelatorioInstalacao };

function motivo(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

function registrarErro(contexto: Contexto, mensagem: string): void {
  contexto.relatorio.codigo = 4;
  contexto.relatorio.erros++;
  contexto.relatorio.mensagens.push(`ERRO: ${mensagem}`);
}

function registrarAviso(contexto: Contexto, mensagem: string): void {
  contexto.relatorio.avisos++;
  contexto.relatorio.mensagens.push(`AVISO: ${mensagem}`);
}

function registrarMudanca(contexto: Contexto, mensagem: string): void {
  contexto.relatorio.mudancas++;
  contexto.relatorio.veredito = "MUDOU";
  contexto.relatorio.mensagens.push(mensagem);
}

async function informacao(caminho: string) {
  try {
    return await lstat(caminho);
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw erro;
  }
}

async function linkCorreto(origem: string, link: string): Promise<boolean> {
  if (!(await informacao(link))?.isSymbolicLink()) return false;
  try {
    return await realpath(link) === await realpath(origem);
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw erro;
  }
}

async function ligarComRelato(origem: string, link: string, diretorio: boolean): Promise<{ estado: EstadoLink; aviso?: string }> {
  try {
    if (await linkCorreto(origem, link)) return { estado: "ja-correto" };
    const info = await informacao(link);
    if (info && !info.isSymbolicLink()) throw new Error("caminho já existe — preservado");
    if (info) await unlink(link);
    const juncao = diretorio && process.platform === "win32";
    const apontado = juncao ? resolve(origem) : relative(dirname(link), origem);
    await symlink(apontado, link, juncao ? "junction" : diretorio ? "dir" : "file");
    return { estado: "criado" };
  } catch (erro) {
    const permissao = !diretorio
      ? " Para permissões de link de arquivo no Windows, ative o modo desenvolvedor ou execute como administrador."
      : "";
    return { estado: "falhou", aviso: `falha ao ligar ${link}: ${motivo(erro)}. Nenhuma cópia foi feita.${permissao}` };
  }
}

async function ligarPublicamente(origem: string, link: string, diretorio: boolean): Promise<EstadoLink> {
  const resultado = await ligarComRelato(origem, link, diretorio);
  if (resultado.aviso) console.warn(`AVISO: ${resultado.aviso}`);
  return resultado.estado;
}

export async function ligarDiretorio(origem: string, link: string): Promise<EstadoLink> {
  return ligarPublicamente(origem, link, true);
}

export async function ligarArquivo(origem: string, link: string): Promise<EstadoLink> {
  return ligarPublicamente(origem, link, false);
}

// `|| exit 2` fecha o hook quando o Bun falta, em sh e cmd. Claude fixa `shell: "bash"` e `onFailure: "block"`; o Copilot ganha o
// campo `powershell` (o `||` não existe no PowerShell 5.1). Codex e Gemini (R65) não levam `||`: em PowerShell o `|| exit 2` faz o
// bloqueio (saída 2 do bun) virar saída 1, que o Gemini trata como aviso, e a chamada pura também (`-Command` devolve 1). Levam o
// caminho absoluto do clone e `; exit $LASTEXITCODE`, que devolve o código do bun em sh, PowerShell e (como argumentos ignorados pelo
// subcomando) cmd. O custo, declarado em plataformas.md e governanca.md, é que bun ausente deixa esses dois sem hook; o
// `anvilore doctor` trata o bun como pré-requisito.
const COMANDO_HOOK = "bun ./src/cli.ts hook proteger-raw || exit 2";
const COMANDO_POWERSHELL = "bun ./src/cli.ts hook proteger-raw; if ($LASTEXITCODE -ne 0) { exit 2 }";
const HOOK_ANTIGO = "hooks/proteger-raw.sh";

// A decisão mora em `anvilore hook proteger-raw`; estas formas só apontam para lá.
function chamadaAbsoluta(destino: string): string {
  if (/["$`%\r\n]/.test(destino)) {
    throw new Error(`o caminho do clone tem caractere que o shell interpretaria ($, crase, aspas, % ou quebra de linha): ${destino}`);
  }
  return `bun "${join(destino, "src", "cli.ts")}" hook proteger-raw`;
}
const comandoSemOperador = (destino: string) => `${chamadaAbsoluta(destino)}; exit $LASTEXITCODE`;
// Codex tem `commandWindows` (https://learn.chatgpt.com/docs/hooks): no Windows vale a forma PowerShell, que também fecha sem o bun.
const comandoPowershellAbsoluto = (destino: string) => `${chamadaAbsoluta(destino)}; if ($LASTEXITCODE -ne 0) { exit 2 }`;
const comandoEvento = (destino: string, evento: string) => `bun "${join(destino, "src", "cli.ts")}" hooks-wiki ${evento} "${destino}"`;
const comandoEventoRelativo = (evento: string) => `bun ./src/cli.ts hooks-wiki ${evento}`;

export async function configuracaoDoHook(alvo: Alvo, destino: string): Promise<Fragmento & { arquivo: string }> {
  switch (alvo) {
    case "claude":
      return { arquivo: ".claude/settings.json", json: JSON.parse(await readFile(join(fonte, "hooks/hooks.json"), "utf8")) };
    case "codex":
      return {
        arquivo: ".codex/config.toml",
        bloco: `# Recusa escrita do agente em raw/. A decisão mora em \`anvilore hook proteger-raw\`;
# esta forma só aponta para lá.
[[hooks.PreToolUse]]
matcher = "apply_patch|Edit|Write|Bash"

[[hooks.PreToolUse.hooks]]
type = "command"
command = ${JSON.stringify(comandoSemOperador(destino))}
command_windows = ${JSON.stringify(comandoPowershellAbsoluto(destino))}

# Eventos de ferramenta e sessão disponíveis no Codex. As opções de Git leem anvilore.toml.
[[hooks.PostToolUse]]
matcher = "Write|Edit|apply_patch"

[[hooks.PostToolUse.hooks]]
type = "command"
command = ${JSON.stringify(`${comandoEvento(destino, "autocommit")}; exit $LASTEXITCODE`)}
command_windows = ${JSON.stringify(`${comandoEvento(destino, "autocommit")}; exit $LASTEXITCODE`)}

[[hooks.SessionStart]]
matcher = "compact"

[[hooks.SessionStart.hooks]]
type = "command"
command = ${JSON.stringify(`${comandoEvento(destino, "contexto")}; exit $LASTEXITCODE`)}
command_windows = ${JSON.stringify(`${comandoEvento(destino, "contexto")}; exit $LASTEXITCODE`)}

[[hooks.SessionStart]]

[[hooks.SessionStart.hooks]]
type = "command"
command = ${JSON.stringify(`${comandoEvento(destino, "atualizar")}; exit $LASTEXITCODE`)}
command_windows = ${JSON.stringify(`${comandoEvento(destino, "atualizar")}; exit $LASTEXITCODE`)}

[[hooks.Stop]]

[[hooks.Stop.hooks]]
type = "command"
command = ${JSON.stringify(`${comandoEvento(destino, "sugerir-lint")}; exit $LASTEXITCODE`)}
command_windows = ${JSON.stringify(`${comandoEvento(destino, "sugerir-lint")}; exit $LASTEXITCODE`)}

[[hooks.SessionEnd]]

[[hooks.SessionEnd.hooks]]
type = "command"
command = ${JSON.stringify(`${comandoEvento(destino, "backup")}; exit $LASTEXITCODE`)}
command_windows = ${JSON.stringify(`${comandoEvento(destino, "backup")}; exit $LASTEXITCODE`)}
timeout = 3`,
      };
    case "gemini":
      return {
        arquivo: ".gemini/settings.json",
        json: {
          context: { fileName: ["AGENTS.md", "GEMINI.md"] },
          hooks: {
            BeforeTool: [{
              matcher: "write_file|replace|run_shell_command",
              hooks: [{ name: "proteger-raw", type: "command", command: comandoSemOperador(destino) }],
            }],
            AfterTool: [{
              matcher: "write_file|replace",
              hooks: [{ name: "anvilore-autocommit", type: "command", command: comandoEventoRelativo("autocommit") }],
            }],
            AfterAgent: [{ hooks: [{ name: "anvilore-sugerir-lint", type: "command", command: comandoEventoRelativo("sugerir-lint") }] }],
            SessionEnd: [{ hooks: [{ name: "anvilore-backup", type: "command", command: comandoEventoRelativo("backup") }] }],
          },
        },
      };
    case "copilot":
      return {
        arquivo: ".github/copilot/settings.json",
        json: { hooks: { preToolUse: [{ type: "command", bash: COMANDO_HOOK, powershell: COMANDO_POWERSHELL }] } },
      };
  }
}

export function valorDoPath(ambiente: Record<string, string | undefined> = process.env): string | undefined {
  if (ambiente.PATH !== undefined) return ambiente.PATH;
  return Object.entries(ambiente).find(([chave]) => chave.toUpperCase() === "PATH")?.[1];
}

async function validarDestino(opcoes: OpcoesInstalacao): Promise<string> {
  const destino = await realpath(opcoes.destino);
  if (!(await stat(destino)).isDirectory()) throw new Error("destino não é diretório");
  for (const lar of [process.env.HOME, process.env.USERPROFILE]) {
    if (lar && destino === await realpath(lar)) throw new Error("o destino é o seu HOME; use um clone do anvilore");
  }
  for (const exigido of ["AGENTS.md", "skills", "src/cli.ts"]) {
    if (!(await informacao(join(destino, exigido)))) throw new Error(`destino não parece um clone do anvilore (falta '${exigido}')`);
  }
  if (opcoes.alvos.some(alvo => !alvosConhecidos.includes(alvo))) throw new Error("alvo desconhecido");
  return destino;
}

async function escrever(contexto: Contexto, rel: string, texto: string): Promise<void> {
  registrarMudanca(contexto, `${contexto.simular ? "simula escrita" : "escreve"}: ${rel}`);
  if (contexto.simular) return;
  const caminho = join(contexto.destino, rel);
  await mkdir(dirname(caminho), { recursive: true });
  await writeFile(caminho, texto);
}

type ItemDeHook = { command?: unknown; bash?: unknown; powershell?: unknown; hooks?: unknown };

function citaHook(item: ItemDeHook | null, trecho: string): boolean {
  return [item?.command, item?.bash, item?.powershell].some(valor => typeof valor === "string" && valor.includes(trecho));
}

// Itens (entrada e itens internos) que o fragmento esperado traz: a forma atual, que a reinstalação preserva.
function itensEsperados(esperado: unknown): unknown[] {
  const hooks = (esperado as { hooks?: Record<string, unknown> } | undefined)?.hooks ?? {};
  return Object.values(hooks).flatMap(entradas => Array.isArray(entradas) ? entradas.flatMap(entrada => [entrada, ...(Array.isArray((entrada as ItemDeHook).hooks) ? (entrada as { hooks: unknown[] }).hooks : [])]) : []);
}

// R52: a fusão de listas só acrescenta, então sai antes dela a entrada que aponta para o script removido e, quando
// `esperado` vem junto, a entrada de uma forma anterior de `hook proteger-raw` (sem shell, onFailure ou powershell).
// A entrada atual fica onde está: reinstalar não muda a ordem. (A do anvilore passa para o fim na primeira migração.)
export function tirarHookAntigo(config: unknown, esperado?: unknown): unknown {
  if (config === null || typeof config !== "object" || Array.isArray(config)) return config;
  const hooks = (config as { hooks?: unknown }).hooks;
  if (hooks === null || typeof hooks !== "object" || Array.isArray(hooks)) return config;
  const atuais = esperado === undefined ? [] : itensEsperados(esperado);
  const obsoleto = (item: ItemDeHook | null) => citaHook(item, HOOK_ANTIGO) || (esperado !== undefined && citaHook(item, "hook proteger-raw") && !atuais.some(atual => isDeepStrictEqual(atual, item)));
  const novos: Record<string, unknown> = {};
  for (const [evento, entradas] of Object.entries(hooks)) {
    if (!Array.isArray(entradas)) { novos[evento] = entradas; continue; }
    novos[evento] = entradas.flatMap((entrada: unknown) => {
      if (entrada === null || typeof entrada !== "object") return [entrada];
      if (obsoleto(entrada as ItemDeHook)) return [];
      const internos = (entrada as ItemDeHook).hooks;
      if (!Array.isArray(internos)) return [entrada];
      const restantes = internos.filter((interno: ItemDeHook | null) => !obsoleto(interno));
      if (restantes.length === internos.length) return [entrada];
      return restantes.length ? [{ ...entrada, hooks: restantes }] : [];
    });
  }
  return { ...config, hooks: novos };
}

async function configurar(contexto: Contexto, rel: string, fragmento: Fragmento): Promise<void> {
  try {
    let atual: string | undefined;
    try {
      atual = await readFile(join(contexto.destino, rel), "utf8");
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code !== "ENOENT") throw erro;
    }
    const novo = fragmento.bloco !== undefined
      ? fundirBloco(atual ?? "", "anvilore", fragmento.bloco, "#").resultado
      : JSON.stringify(fundirJson(atual === undefined ? {} : tirarHookAntigo(JSON.parse(atual), fragmento.json), fragmento.json).resultado, null, 2) + "\n";
    if (atual === novo) contexto.relatorio.mensagens.push(`inalterado: ${rel}`);
    else await escrever(contexto, rel, novo);
  } catch (erro) {
    throw new Error(`${rel}: ${motivo(erro)}`, { cause: erro });
  }
}

async function instalarLink(contexto: Contexto, rel: string, origem: string, diretorio: boolean): Promise<void> {
  const link = join(contexto.destino, rel);
  if (await linkCorreto(origem, link)) {
    contexto.relatorio.mensagens.push(`inalterado: ${rel}`);
    return;
  }
  const info = await informacao(link);
  if (info && !info.isSymbolicLink()) {
    registrarAviso(contexto, `${rel} já existe — preservado, nada escrito`);
    return;
  }
  if (contexto.simular) {
    registrarMudanca(contexto, `simula ligação: ${rel}`);
    return;
  }
  await mkdir(dirname(link), { recursive: true });
  const resultado = await ligarComRelato(origem, link, diretorio);
  if (resultado.aviso) registrarAviso(contexto, resultado.aviso);
  if (resultado.estado === "falhou") registrarErro(contexto, `${rel}: falha de link; nenhuma cópia foi feita`);
  else if (resultado.estado === "criado") registrarMudanca(contexto, `liga: ${rel}`);
}

// O esqueleto vem de `modelos/`, nunca do `git ls-files` da fonte: copia só o que falta e nunca sobrescreve. O exemplo
// só nasce em instalação nova (sem `wiki/` ou sem `raw/`); o que a pessoa apagou continua apagado.
async function instalarEsqueleto(contexto: Contexto): Promise<void> {
  const plano = await planejarModelos(contexto.destino, { exemplo: true });
  for (const rel of plano.existentes) contexto.relatorio.mensagens.push(`inalterado: ${rel}`);
  for (const peca of plano.copiar) {
    registrarMudanca(contexto, `${contexto.simular ? "simula escrita" : "escreve"}: ${peca.destino}`);
    if (!contexto.simular) await escreverPeca(contexto.destino, peca);
  }
}

async function listarSkills(): Promise<string[]> {
  const entradas = await readdir(join(fonte, "skills"), { withFileTypes: true });
  const nomes = entradas.filter(entrada => !entrada.name.startsWith("."))
    .map(entrada => entrada.name).sort();
  const skills: string[] = [];
  for (const nome of nomes) {
    if (!(await stat(join(fonte, "skills", nome))).isDirectory()) continue;
    if ((await informacao(join(fonte, "skills", nome, "SKILL.md")))?.isFile()) skills.push(nome);
  }
  return skills;
}

async function comandoGemini(nome: string): Promise<string> {
  const rel = `skills/${nome}/SKILL.md`;
  let descricao: unknown;
  try {
    descricao = lerFrontmatter(await readFile(join(fonte, rel), "utf8"))?.description;
  } catch (erro) {
    throw new Error(`${rel}: ${motivo(erro)}`, { cause: erro });
  }
  return `description = ${JSON.stringify(typeof descricao === "string" ? descricao : "")}
prompt = """
Siga as instruções de \`skills/${nome}/SKILL.md\`, neste repositório, do começo ao
fim, sem pular passos. O contrato que limita o que você pode fazer está em
\`AGENTS.md\`; leia-o antes de tocar em qualquer arquivo.
"""`;
}

async function instalarSkills(contexto: Contexto, alvo: Alvo, skills: string[]): Promise<void> {
  for (const nome of skills) {
    if (alvo === "gemini") {
      await configurar(contexto, `.gemini/commands/${nome}.toml`, { bloco: await comandoGemini(nome) });
      continue;
    }
    const diretorio = alvo !== "copilot";
    const pasta = alvo === "claude" ? ".claude" : ".agents";
    const rel = diretorio ? `${pasta}/skills/${nome}` : `.github/agents/${nome}.agent.md`;
    const origem = join(fonte, "skills", nome, ...(diretorio ? [] : ["SKILL.md"]));
    await instalarLink(contexto, rel, origem, diretorio);
  }
}

// Os agentes do Claude Code são cópia gerada dos prompts de skills/ingest/ (o Agent tool não
// restringe ferramentas por chamada; o arquivo de agente, sim). Arquivo nosso desatualizado é
// regravado; arquivo da pessoa com o mesmo nome é preservado.
async function instalarAgentesDaIngestao(contexto: Contexto): Promise<void> {
  for (const agente of await agentesDaIngestao(fonte)) {
    let atual: string | undefined;
    try {
      atual = await readFile(join(contexto.destino, agente.rel), "utf8");
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`${agente.rel}: ${motivo(erro)}`, { cause: erro });
    }
    if (atual === agente.conteudo) contexto.relatorio.mensagens.push(`inalterado: ${agente.rel}`);
    else if (atual === undefined || atual.includes(MARCA_DE_GERADO)) await escrever(contexto, agente.rel, agente.conteudo);
    else registrarAviso(contexto, `${agente.rel} já existe e não foi gerado pelo anvilore — preservado, nada escrito`);
  }
}

function resumir(contexto: Contexto): RelatorioInstalacao {
  const relatorio = contexto.relatorio;
  if (relatorio.instalados.length) relatorio.mensagens.push(`${contexto.simular ? "seriam instalados" : "instalados"}: ${relatorio.instalados.join(", ")}`);
  if (relatorio.ausentes.length) relatorio.mensagens.push(`ausentes do PATH, pulados: ${relatorio.ausentes.join(", ")}`);
  if (relatorio.avisos) relatorio.mensagens.push(`avisos: ${relatorio.avisos} (nada foi sobrescrito)`);
  if (relatorio.erros) {
    relatorio.mensagens.push(`ERROS: ${relatorio.erros} — a instalação encontrou erros; os demais alvos foram processados.`);
  } else if (!relatorio.mudancas) {
    relatorio.mensagens.push("INALTERADO: nada a fazer — tudo já estava instalado.");
  } else if (contexto.simular) {
    relatorio.mensagens.push(`SIMULAÇÃO: MUDOU: ${relatorio.mudancas} mudança(s) seriam aplicadas. Nada foi alterado: nenhum arquivo foi escrito.`);
  } else {
    relatorio.mensagens.push(`MUDOU: ${relatorio.mudancas} mudança(s) aplicada(s).`);
  }
  // R70-G: só a instalação real, sem erro e com algum agente instalado, aponta o que fazer depois.
  if (!contexto.simular && !relatorio.erros && relatorio.instalados.length) {
    relatorio.mensagens.push("Próximo passo: reabra o agente neste clone (o hook só vale em sessões abertas depois da instalação) e rode `bun src/cli.ts init`.");
  }
  return relatorio;
}

export async function instalar(opcoes: OpcoesInstalacao): Promise<RelatorioInstalacao> {
  const relatorio: RelatorioInstalacao = {
    codigo: 0, veredito: "INALTERADO", mensagens: [], ausentes: [], instalados: [], mudancas: 0, avisos: 0, erros: 0,
  };
  let destino: string;
  try {
    destino = await validarDestino(opcoes);
  } catch (erro) {
    relatorio.codigo = 1;
    relatorio.mensagens.push(`recusado: ${motivo(erro)}`);
    return relatorio;
  }
  const contexto: Contexto = { destino, simular: opcoes.simular, relatorio };
  const alvos = [...new Set(opcoes.alvos)];
  relatorio.mensagens.push("anvilore — instalação", `destino: ${destino}`, `alvos: ${alvos.join(", ")}`);
  if (opcoes.simular) relatorio.mensagens.push("SIMULAÇÃO (nada será escrito)");
  if (opcoes.autoCommit || opcoes.githubBackup) {
    try {
      const caminho = join(destino, "anvilore.toml");
      let texto = "";
      try { texto = await readFile(caminho, "utf8"); } catch (erro) { if ((erro as NodeJS.ErrnoException).code !== "ENOENT") throw erro; }
      const gravar = (chave: string) => {
        const secao = /^\[hooks\]\s*$/m.exec(texto);
        if (!secao) { texto = `${texto.trimEnd()}${texto.trim() ? "\n\n" : ""}[hooks]\n${chave}\n`; return; }
        const inicio = secao.index + secao[0].length;
        const proxima = texto.indexOf("\n[", inicio);
        const fim = proxima < 0 ? texto.length : inicio + proxima + 1;
        const bloco = texto.slice(inicio, fim);
        const nome = chave.split(" = ")[0]!;
        const nova = new RegExp(`^${nome}\\s*=.*$`, "m");
        texto = nova.test(bloco) ? texto.slice(0, inicio) + bloco.replace(nova, chave) + texto.slice(fim) : texto.slice(0, fim) + `${chave}\n` + texto.slice(fim);
      };
      if (opcoes.autoCommit) gravar("auto_commit = true");
      if (opcoes.githubBackup) gravar("github_backup = true");
      if (opcoes.autoCommit || opcoes.githubBackup) await escrever(contexto, "anvilore.toml", texto);
    } catch (erro) { registrarErro(contexto, `anvilore.toml: ${motivo(erro)}`); }
  }
  const aviso = avisoRg(valorDoPath());
  if (aviso) registrarAviso(contexto, aviso);
  try {
    await instalarEsqueleto(contexto);
    if (!opcoes.simular && (opcoes.autoCommit || opcoes.githubBackup)) {
      const repo = await inicializarRepositorioWiki(destino);
      if (repo.criado) registrarMudanca(contexto, `inicializa repositório Git próprio da wiki: ${repo.caminho}`);
    }
  } catch (erro) {
    registrarErro(contexto, motivo(erro));
  }
  for (const alvo of alvos) {
    if (!Bun.which(alvo, { PATH: valorDoPath() })) {
      relatorio.ausentes.push(alvo);
      relatorio.mensagens.push(`${alvo}: CLI ausente do PATH — alvo pulado (isto não é uma falha)`);
      continue;
    }
    const errosAntes = relatorio.erros;
    try {
      const config = await configuracaoDoHook(alvo, destino);
      await configurar(contexto, config.arquivo, config);
      if (alvo === "copilot") {
        await configurar(contexto, ".github/hooks/anvilore.json", { json: { version: 1, hooks: {
          postToolUse: [{ type: "command", bash: comandoEventoRelativo("autocommit"), powershell: comandoEventoRelativo("autocommit"), cwd: "." }],
          sessionEnd: [{ type: "command", bash: comandoEventoRelativo("backup"), powershell: comandoEventoRelativo("backup"), cwd: "." }],
        } } });
      }
      const skills = await listarSkills();
      await instalarSkills(contexto, alvo, skills);
      if (alvo === "claude" && skills.includes("ingest")) await instalarAgentesDaIngestao(contexto);
      if (relatorio.erros === errosAntes) relatorio.instalados.push(alvo);
    } catch (erro) {
      registrarErro(contexto, `${alvo}: ${motivo(erro)}`);
    }
  }
  return resumir(contexto);
}

function ajuda(): string {
    return `Uso: anvilore instalar [--alvo ${alvosConhecidos.join(",")}|todos] [--destino dir] [--simular] [--auto-commit] [--github-backup]
Configura um clone do anvilore; CLI ausente é relatada e pulada.
Padrão: todos os alvos; destino = ANVILORE_DESTINO ou diretório do kit.
--simular calcula as mudanças sem escrever em disco.
--auto-commit e --github-backup ligam os recursos opcionais em anvilore.toml; ambos vêm desligados.

Agente   Skills/comandos                      Configuração do hook
claude   .claude/skills/<nome>                 .claude/settings.json
         .claude/agents/anvilore-*.md (leitor e escritor da ingestão, gerados de skills/ingest/)
codex    .agents/skills/<nome>                 .codex/config.toml
gemini   .gemini/commands/<nome>.toml           .gemini/settings.json
copilot  .github/agents/<nome>.agent.md         .github/copilot/settings.json
Claude, Codex e Copilot ligam as skills à fonte; Gemini aponta para o caminho da skill no clone.
AGENTS.md é o contrato; no Gemini, context.fileName passa a incluí-lo.

Alvo: Linux, Windows nativo e macOS; suporte fora do Linux a confirmar pelo CI da Onda 1.
Diretórios usam junções no Windows; falha de link é explícita, sem cópia alternativa.
fonte ≠ destino: os links de skills apontam à fonte; o hook e os comandos Gemini resolvem no destino.
O destino precisa do hook e, para Gemini, também das skills. Mover uma das árvores pode quebrar links.`;
}

export async function comandoInstalar(args: string[]): Promise<number> {
  try {
    const { values } = parseArgs({
      args,
      options: {
        alvo: { type: "string" }, destino: { type: "string" }, simular: { type: "boolean" }, "auto-commit": { type: "boolean" }, "github-backup": { type: "boolean" }, help: { type: "boolean", short: "h" },
      },
      allowPositionals: false,
      strict: true,
    });
    if (values.help) {
      console.log(ajuda());
      return 0;
    }
    const pedidos = values.alvo ?? "todos";
    const alvos = pedidos === "todos" ? [...alvosConhecidos] : pedidos.split(",");
    if (alvos.some(alvo => !alvosConhecidos.includes(alvo as Alvo))) {
      throw new Error(`alvo desconhecido: '${pedidos}'. Conhecidos: ${alvosConhecidos.join(", ")}, todos`);
    }
    const relatorio = await instalar({
      alvos: alvos as Alvo[],
      destino: values.destino ?? process.env.ANVILORE_DESTINO ?? fonte,
      simular: values.simular ?? false,
      autoCommit: values["auto-commit"] ?? false,
      githubBackup: values["github-backup"] ?? false,
    });
    for (const mensagem of relatorio.mensagens) console.log(mensagem);
    return relatorio.codigo;
  } catch (erro) {
    console.error(motivo(erro));
    return 1;
  }
}
