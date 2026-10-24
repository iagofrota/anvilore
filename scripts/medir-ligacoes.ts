import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ligarArquivo, ligarDiretorio } from "../src/comandos/instalar";

export async function medirLigacoes(): Promise<number> {
  const temporario = await mkdtemp(join(tmpdir(), "medir-ligacoes-"));
  try {
    const fonte = join(temporario, "fonte");
    await mkdir(fonte);
    const arquivo = join(fonte, "vivo.md");
    await writeFile(arquivo, "antes");
    const diretorio = join(temporario, "diretorio");
    const linkArquivo = join(temporario, "arquivo.md");
    const estadoDiretorio = await ligarDiretorio(fonte, diretorio);
    const estadoArquivo = await ligarArquivo(arquivo, linkArquivo);
    console.log(`${process.platform === "win32" ? "junção" : "link simbólico"}: ${estadoDiretorio} (${process.platform})`);
    console.log(`link de arquivo: ${estadoArquivo} (${process.platform})`);
    if (estadoDiretorio !== "criado" || estadoArquivo !== "criado") return 1;
    await writeFile(arquivo, "depois");
    const ligados = (await lstat(diretorio)).isSymbolicLink() && (await lstat(linkArquivo)).isSymbolicLink();
    const vivos = await readFile(join(diretorio, "vivo.md"), "utf8") === "depois"
      && await readFile(linkArquivo, "utf8") === "depois";
    if (!ligados || !vivos) {
      console.error("Ligação não preservou o acesso à fonte; nenhuma cópia alternativa foi feita.");
      return 1;
    }
    return 0;
  } finally {
    await rm(temporario, { recursive: true, force: true });
  }
}

if (import.meta.main) process.exit(await medirLigacoes());
