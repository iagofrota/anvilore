import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
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

  const linhaVerified = /^(?:verified|"verified"|'verified')\s*:/;
  const indicesVerified = linhas.flatMap((linha, indice) => indice > 0 && indice < fim && linhaVerified.test(linha) ? [indice] : []);
  if (indicesVerified.length > 1) throw new Error("página tem chaves verified duplicadas");
  const indiceVerified = indicesVerified[0] ?? -1;
  if (indiceVerified < 0) {
    if (Object.hasOwn(frontmatter, "verified")) throw new Error("não foi possível localizar a chave verified sem alterar o frontmatter");
    linhas.splice(fim, 0, ...secao);
  }
  else {
    let fimVerified = fim;
    for (let indice = indiceVerified + 1; indice < fim; indice++) {
      const linha = linhas[indice]!;
      if (linha.length > 0 && !/^\s/.test(linha) && !linha.startsWith("#") && !linha.startsWith("- ")) { fimVerified = indice; break; }
    }
    linhas.splice(indiceVerified, fimVerified - indiceVerified, ...secao);
  }
  const aprovado = linhas.join(quebra);
  const esperado = lerFrontmatter(["---", ...secao, "---"].join(quebra));
  const resultado = lerFrontmatter(aprovado);
  if (!esperado || !resultado) throw new Error("não foi possível preservar o frontmatter ao registrar a aprovação");
  const { verified: _verifiedAnterior, ...camposAnteriores } = frontmatter;
  const { verified: verifiedNovo, ...camposNovos } = resultado;
  if (!isDeepStrictEqual(camposNovos, camposAnteriores) || !isDeepStrictEqual(verifiedNovo, esperado.verified)) {
    throw new Error("não foi possível preservar o frontmatter ao registrar a aprovação");
  }
  return aprovado;
}

export async function aprovarPaginas(raiz: string, arquivos: string[], ambiente: Record<string, string | undefined> = process.env, versaoEsperada?: string): Promise<ResultadoAprovacao> {
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
      if (versaoEsperada && createHash("sha256").update(original).digest("hex") !== versaoEsperada) {
        return { codigo: 3, mensagens: ["A página mudou desde que você abriu. Recarregue para revisar a versão nova."] };
      }
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
