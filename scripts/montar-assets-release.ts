import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execPadrao, parsearSemVer } from "../src/lib/atualizacao";
import { consultarConfianca, filtrarAssinantes } from "../src/lib/confianca";
import { embutirInstalador, validarAssinantes } from "./embutir-instalador";

const PACOTES = ["AnviloreSetup.exe", "anvilore.deb", "anvilore.rpm"];
const SCRIPTS = ["instalar.sh", "instalar.ps1"];
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function lerArquivo(pasta: string, nome: string): Promise<Buffer> {
  try {
    const caminho = join(pasta, nome), st = await lstat(caminho);
    if (!st.isFile() || !st.size) throw new Error("vazio ou não regular");
    return await readFile(caminho);
  } catch { throw new Error(`Asset ausente, vazio ou não regular: ${nome}`); }
}

// A chave vem da âncora anterior filtrada pela lista atual do site, nunca da própria candidata.
export async function montarAssets(raiz: string, pasta: string, assinantes: string): Promise<string[]> {
  const invalida = validarAssinantes(assinantes);
  if (invalida) throw new Error(invalida);
  const arquivos = new Map<string, Buffer>();
  for (const nome of [...PACOTES, ...SCRIPTS, ...SCRIPTS.map(s => `${s}.sig`)]) arquivos.set(nome, await lerArquivo(pasta, nome));
  const manifesto = await readFile(join(raiz, "instalador/dependencias.json"), "utf8");
  const chaveEmbutida = await readFile(join(raiz, "seguranca/assinantes"), "utf8");
  const base = await readFile(join(raiz, "instalador/base-minima"), "utf8");
  const temporaria = await mkdtemp(join(tmpdir(), "anvilore-assets-assinatura-"));
  try {
    const allow = join(temporaria, "assinantes-file");
    // O arquivo do kit limita tags ao namespace git. A mesma chave autentica os scripts no namespace file.
    await writeFile(allow, assinantes.replace(/namespaces="[^"]*"/g, 'namespaces="file"'));
    for (const nome of SCRIPTS) {
      const bytes = arquivos.get(nome)!;
      const assinatura = join(pasta, `${nome}.sig`);
      const chamada = (args: string[]) => Bun.spawnSync(["ssh-keygen", "-Y", ...args, "-f", allow, "-n", "file", "-s", assinatura], { stdin: bytes, stdout: "pipe", stderr: "pipe" });
      const principais = chamada(["find-principals"]);
      if (principais.exitCode || !principais.stdout.toString().trim().split(/\r?\n/).some(p => p && chamada(["verify", "-I", p]).exitCode === 0)) {
        throw new Error(`assinatura SSH inválida ou não confiável: ${nome}`);
      }
      const modelo = await readFile(join(raiz, "instalador", nome), "utf8");
      const esperado = embutirInstalador(modelo, manifesto, chaveEmbutida, base, nome.endsWith("ps1") ? "ps1" : "sh");
      if (!bytes.equals(Buffer.from(esperado))) throw new Error(`${nome}: conteúdo difere do build de produção (manifesto, chave, base, URL ou corpo).`);
    }
  } finally { await rm(temporaria, { recursive: true, force: true }); }
  for (const nome of SCRIPTS) {
    const checksum = Buffer.from(`${sha256(arquivos.get(nome)!)}  ${nome}\n`);
    arquivos.set(`${nome}.sha256`, checksum);
  }
  const hashes = [...arquivos.keys()].sort().map(nome => `${sha256(arquivos.get(nome)!)}  ${nome}\n`).join("");
  // Só publica os hashes depois que TODOS os arquivos e assinaturas passaram.
  for (const nome of SCRIPTS) await writeFile(join(pasta, `${nome}.sha256`), arquivos.get(`${nome}.sha256`)!);
  await writeFile(join(pasta, "SHA256SUMS"), hashes);
  return [...arquivos.keys(), "SHA256SUMS"].sort();
}

if (import.meta.main) {
  const [pasta, anterior, ...extras] = process.argv.slice(2);
  if (!pasta || !anterior || !parsearSemVer(anterior.replace(/^v/, "")) || extras.length) {
    console.error("Uso: bun scripts/montar-assets-release.ts <pasta-dos-assets> <tag-anterior-publicada>"); process.exit(2);
  }
  try {
    const raiz = resolve(import.meta.dir, "..");
    const ancora = execPadrao(["show", `refs/tags/${anterior}:seguranca/assinantes`], raiz);
    if (ancora.codigo) throw new Error("Âncora da versão anterior ausente.");
    const lista = await consultarConfianca();
    const assinantes = filtrarAssinantes(ancora.saida, lista.chaves);
    console.log((await montarAssets(raiz, resolve(pasta), assinantes)).join("\n"));
  } catch (e) { console.error((e as Error).message); process.exit(1); }
}
