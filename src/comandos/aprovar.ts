import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { caminhoWiki } from "../lib/wiki-repo";

export type ResultadoAprovacao = { codigo: number; mensagens: string[] };

function identidadeSugerida(raiz: string, wiki: string): string {
  const git = Bun.spawnSync(["git", "-C", wiki, "config", "user.name"], { stdout: "pipe", stderr: "ignore" });
  const usuario = git.exitCode === 0 && git.stdout.toString().trim()
    ? git.stdout.toString().trim()
    : Bun.spawnSync(["git", "-C", raiz, "config", "user.name"], { stdout: "pipe", stderr: "ignore" }).stdout.toString().trim();
  const slug = usuario.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug ? `human:${slug}` : "";
}

function provenienciaAprovada(texto: string, identidade: string): string {
  const linhas = texto.split(/\r?\n/);
  if (linhas[0] !== "---") throw new Error("página sem frontmatter YAML");
  const fim = linhas.indexOf("---", 1);
  if (fim < 0) throw new Error("frontmatter sem fechamento");
  const frente = linhas.slice(1, fim).join("\n");
  if (!/^generated\s*:/m.test(frente)) throw new Error("página sem generated; não há rascunho para aprovar");
  if (/^verified\s*:/m.test(frente)) throw new Error("página já tem verified");
  linhas.splice(fim, 0, "verified:", `  - by: ${identidade}`, `    at: ${new Date().toISOString()}`);
  return linhas.join("\n");
}

export async function aprovarPaginas(raiz: string, arquivos: string[], ambiente: Record<string, string | undefined> = process.env, identidadeConfirmada?: string): Promise<ResultadoAprovacao> {
  if (arquivos.length === 0) return { codigo: 2, mensagens: ["Uso: anvilore aprovar <página.md> [página.md ...]"] };
  const wiki = caminhoWiki(raiz, ambiente);
  const preparados: Array<{ caminho: string; texto: string }> = [];
  try {
    for (const arquivo of arquivos) {
      const caminho = isAbsolute(arquivo) ? resolve(arquivo) : resolve(raiz, arquivo);
      const rel = relative(wiki, caminho);
      if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !rel.toLowerCase().endsWith(".md")) throw new Error(`página fora de wiki/: ${arquivo}`);
      const original = await readFile(caminho, "utf8");
      preparados.push({ caminho, texto: original });
    }
    const identidadeArquivo = resolve(raiz, ".anvilore/identidade");
    let identidade: string | undefined;
    try { identidade = (await readFile(identidadeArquivo, "utf8")).trim(); }
    catch (erro) { if ((erro as NodeJS.ErrnoException).code !== "ENOENT") throw erro; }
    if (identidade) {
      if (identidadeConfirmada && identidadeConfirmada !== identidade) throw new Error("a identidade local já foi confirmada e não pode ser trocada por este comando");
    } else {
      identidade = identidadeSugerida(raiz, wiki);
      if (!/^human:[a-z0-9_-]+$/.test(identidade)) throw new Error("configure git user.name antes da primeira aprovação");
      if (identidadeConfirmada !== identidade) throw new Error(`confirme a identidade sugerida com --identidade ${identidade}`);
    }
    if (!/^human:[a-z0-9_-]+$/.test(identidade)) throw new Error("identidade local inválida em .anvilore/identidade");
    const alteradas = preparados.map(item => ({ ...item, texto: provenienciaAprovada(item.texto, identidade) }));
    await mkdir(resolve(raiz, ".anvilore"), { recursive: true });
    await writeFile(identidadeArquivo, `${identidade}\n`);
    for (const item of alteradas) await writeFile(item.caminho, item.texto);
    return { codigo: 0, mensagens: [`Aprovadas: ${alteradas.length} ${alteradas.length === 1 ? "página" : "páginas"} (${identidade}).`] };
  } catch (erro) {
    return { codigo: 1, mensagens: [`Aprovação recusada: ${(erro as Error).message}`] };
  }
}

export async function comandoAprovar(args: string[]): Promise<number> {
  const raiz = process.env.ANVILORE_DESTINO ?? process.cwd();
  const arquivos = [...args];
  let identidade: string | undefined;
  const indice = arquivos.indexOf("--identidade");
  if (indice >= 0) {
    identidade = arquivos[indice + 1];
    arquivos.splice(indice, 2);
  }
  const resultado = await aprovarPaginas(raiz, arquivos, process.env, identidade);
  for (const mensagem of resultado.mensagens) console.log(mensagem);
  return resultado.codigo;
}
