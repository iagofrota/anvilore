import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parsearSemVer } from "../src/lib/atualizacao";

export const ASSETS_RELEASE = ["AnviloreSetup.exe", "anvilore.deb", "anvilore.rpm", "instalar.sh", "instalar.ps1", "instalar.sh.sig", "instalar.ps1.sig", "instalar.sh.sha256", "instalar.ps1.sha256"].sort();
async function ler(pasta: string, nome: string): Promise<Buffer> {
  const arquivo = join(pasta, nome), st = await lstat(arquivo);
  if (!st.isFile() || !st.size) throw new Error(`Asset vazio ou não regular: ${nome}`);
  return readFile(arquivo);
}

// Não executa Git nem GitHub. O CI só chama depois de autenticar a tag, assinar offline e passar TODOS os gates.
export async function prepararRascunho(raiz: string, pasta: string, tag: string): Promise<string[]> {
  const versao = tag.replace(/^v/, ""), semver = parsearSemVer(versao);
  const pkg = JSON.parse(await readFile(join(raiz, "package.json"), "utf8")) as { version?: unknown };
  if (!semver || pkg.version !== versao) throw new Error("Tag inválida ou versão diferente de package.json.");
  const hashes = (await ler(pasta, "SHA256SUMS")).toString("utf8");
  const entradas = hashes.trimEnd().split("\n").map(linha => /^([a-f0-9]{64})  ([A-Za-z0-9.-]+)$/.exec(linha));
  if (entradas.some(e => !e) || JSON.stringify(entradas.map(e => e![2]).sort()) !== JSON.stringify(ASSETS_RELEASE)) {
    throw new Error("SHA256SUMS não cobre exatamente os assets esperados.");
  }
  for (const entrada of entradas) {
    const [, esperado, nome] = entrada!;
    if (createHash("sha256").update(await ler(pasta, nome!)).digest("hex") !== esperado) throw new Error(`SHA-256 divergente: ${nome}`);
  }
  const notas = (await ler(pasta, "NOTAS.md")).toString("utf8");
  if (!/^[-*+]\s+\S/m.test(notas)) throw new Error("Notas da release sem itens.");
  return ["gh", "release", "create", tag, ...[...ASSETS_RELEASE, "SHA256SUMS"].map(nome => join(pasta, nome)),
    "--repo", "iagofrota/anvilore", "--draft", "--verify-tag", "--title", `Anvilore ${versao}`, "--notes-file", join(pasta, "NOTAS.md"),
    ...(semver.prerelease.length ? ["--prerelease"] : [])];
}

type OpcoesRascunho = { raiz?: string; ambiente?: NodeJS.ProcessEnv; executar?: (args: string[]) => number };
export async function comandoRascunho(args: string[], opcoes: OpcoesRascunho = {}): Promise<number> {
  try {
    const { values } = parseArgs({ args, options: { criar: { type: "boolean" }, tag: { type: "string" }, pasta: { type: "string" } }, strict: true, allowPositionals: false });
    const tag = values.tag ?? "", pasta = resolve(values.pasta ?? "dist");
    const comando = await prepararRascunho(opcoes.raiz ?? resolve(import.meta.dir, ".."), pasta, tag);
    if (!values.criar) console.log("Simulação: rascunho validado; nenhuma operação no GitHub.");
    else {
      const ambiente = opcoes.ambiente ?? process.env;
      if (ambiente.GITHUB_REF_TYPE !== "tag" || ambiente.GITHUB_REF_NAME !== tag || ambiente.GITHUB_REPOSITORY !== "iagofrota/anvilore") throw new Error("Criação restrita ao workflow da tag do repositório oficial.");
      const codigo = opcoes.executar ? opcoes.executar(comando) : Bun.spawnSync(comando, { stdout: "inherit", stderr: "inherit" }).exitCode;
      if (codigo !== 0) throw new Error(`GitHub recusou criar o rascunho (${codigo}).`);
    }
    return 0;
  } catch (e) { console.error((e as Error).message); return 1; }
}
if (import.meta.main) process.exit(await comandoRascunho(process.argv.slice(2)));
