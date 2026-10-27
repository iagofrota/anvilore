import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { lerFrontmatter } from "../lib/frontmatter";
import { estadoAprovacaoHumana } from "../lib/okf";
import { caminhoWiki } from "../lib/wiki-repo";
import { autoCommitWiki, opcoesHooksWiki } from "./hooks-wiki";

export type ResultadoAprovacao = { codigo: number; mensagens: string[] };

function identidadeSugerida(raiz: string, wiki: string, ambiente: Record<string, string | undefined>): string {
  const opcoes = { stdout: "pipe" as const, stderr: "ignore" as const, env: ambiente };
  const git = Bun.spawnSync(["git", "-C", wiki, "config", "user.name"], opcoes);
  const usuario = git.exitCode === 0 && git.stdout.toString().trim()
    ? git.stdout.toString().trim()
    : Bun.spawnSync(["git", "-C", raiz, "config", "user.name"], opcoes).stdout.toString().trim();
  const slug = usuario.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug ? `human:${slug}` : "human:local";
}

function serializarYaml(valor: unknown): string {
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === "string") {
    if (/^(?:human:[a-z0-9_-]+|process:[a-z0-9_-]+|[a-z0-9_-]+\/[a-z0-9._-]+)$/i.test(valor) || /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d(?::?\d\d)?)$/.test(valor)) return valor;
    return JSON.stringify(valor);
  }
  return String(valor);
}

function provenienciaAprovada(texto: string, identidade: string): string {
  const quebra = texto.includes("\r\n") ? "\r\n" : "\n";
  const linhas = texto.split(/\r?\n/);
  const frontmatter = lerFrontmatter(texto);
  if (!frontmatter) throw new Error("página sem frontmatter YAML");
  const fim = linhas.indexOf("---", 1);
  if (fim < 0) throw new Error("frontmatter sem fechamento");
  const estado = estadoAprovacaoHumana(frontmatter);
  if (estado === "invalida") throw new Error("página tem proveniência inválida");
  if (estado === "vigente") throw new Error("página já foi aprovada após sua última geração");

  const existentes = frontmatter.verified == null ? [] : Array.isArray(frontmatter.verified) ? frontmatter.verified : [frontmatter.verified];
  const aprovacoes = existentes.map((entrada, indice) => {
    if (typeof entrada !== "object" || entrada === null || Array.isArray(entrada)) throw new Error(`verified[${indice}] inválido`);
    return Object.entries(entrada as Record<string, unknown>);
  });
  aprovacoes.push([["by", identidade], ["at", new Date().toISOString()]]);
  const secao = ["verified:", ...aprovacoes.flatMap(entrada => [
    `  - by: ${serializarYaml(entrada.find(([chave]) => chave === "by")?.[1])}`,
    ...entrada.filter(([chave]) => chave !== "by").map(([chave, valor]) => `    ${chave}: ${serializarYaml(valor)}`),
  ])];

  const indiceVerified = linhas.findIndex((linha, indice) => indice < fim && /^verified\s*:/.test(linha));
  if (indiceVerified < 0) linhas.splice(fim, 0, ...secao);
  else {
    let fimVerified = fim;
    for (let indice = indiceVerified + 1; indice < fim; indice++) {
      if (/^[A-Za-z_][\w-]*\s*:/.test(linhas[indice]!)) { fimVerified = indice; break; }
    }
    linhas.splice(indiceVerified, fimVerified - indiceVerified, ...secao);
  }
  return linhas.join(quebra);
}

export async function aprovarPaginas(raiz: string, arquivos: string[], ambiente: Record<string, string | undefined> = process.env): Promise<ResultadoAprovacao> {
  if (arquivos.length === 0) return { codigo: 2, mensagens: ["Uso: anvilore aprovar <página.md> [página.md ...]"] };
  const wiki = caminhoWiki(raiz, ambiente);
  const preparados: Array<{ caminho: string; texto: string }> = [];
  try {
    for (const arquivo of arquivos) {
      const caminho = isAbsolute(arquivo) ? resolve(arquivo) : resolve(raiz, arquivo);
      const rel = relative(wiki, caminho);
      if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !rel.toLowerCase().endsWith(".md")) throw new Error(`página fora de wiki/: ${arquivo}`);
      const caminhoReal = await realpath(caminho);
      const wikiReal = await realpath(wiki);
      const relReal = relative(wikiReal, caminhoReal);
      if (relReal === ".." || relReal.startsWith(`..${sep}`) || isAbsolute(relReal)) throw new Error(`página fora de wiki/: ${arquivo}`);
      const original = await readFile(caminho, "utf8");
      preparados.push({ caminho, texto: original });
    }
    const identidadeArquivo = resolve(raiz, ".anvilore/identidade");
    let identidade: string | undefined;
    try { identidade = (await readFile(identidadeArquivo, "utf8")).trim(); }
    catch (erro) { if ((erro as NodeJS.ErrnoException).code !== "ENOENT") throw erro; }
    if (!identidade) identidade = identidadeSugerida(raiz, wiki, ambiente);
    if (!/^human:[a-z0-9_-]+$/.test(identidade)) throw new Error("identidade local inválida em .anvilore/identidade");
    const alteradas = preparados.map(item => ({ ...item, texto: provenienciaAprovada(item.texto, identidade) }));
    await mkdir(resolve(raiz, ".anvilore"), { recursive: true });
    await writeFile(identidadeArquivo, `${identidade}\n`);
    for (const item of alteradas) await writeFile(item.caminho, item.texto);
    const mensagens = [`Aprovadas: ${alteradas.length} ${alteradas.length === 1 ? "página" : "páginas"} (${identidade}).`];
    if ((await opcoesHooksWiki(raiz)).autoCommit) {
      for (const item of alteradas) if (!(await autoCommitWiki(raiz, item.caminho, "verify"))) {
        mensagens.push(`AVISO: aprovação registrada, mas commit automático não realizado para ${basename(item.caminho)}; confira o repositório Git da wiki.`);
      }
    }
    return { codigo: 0, mensagens };
  } catch (erro) {
    return { codigo: 1, mensagens: [`Aprovação recusada: ${(erro as Error).message}`] };
  }
}

export async function comandoAprovar(args: string[]): Promise<number> {
  const raiz = process.env.ANVILORE_DESTINO ?? process.cwd();
  const resultado = await aprovarPaginas(raiz, args, process.env);
  for (const mensagem of resultado.mensagens) console.log(mensagem);
  return resultado.codigo;
}
