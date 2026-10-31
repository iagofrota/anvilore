import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validarAssinantes } from "./embutir-instalador";

// Recebe somente chaves públicas da confiança anterior. Não lê chave privada nem produz assinaturas.
export async function verificarAssinaturaInstalador(bytes: Uint8Array, assinatura: string, assinantes: string, nome: string): Promise<void> {
  const invalida = validarAssinantes(assinantes);
  if (invalida) throw new Error(invalida);
  try {
    const st = await lstat(assinatura);
    if (!st.isFile() || !st.size) throw new Error("não regular");
  } catch { throw new Error(`assinatura pública offline ausente, vazia ou não regular: ${nome}`); }
  const temporaria = await mkdtemp(join(tmpdir(), "anvilore-assinatura-release-"));
  try {
    const allow = join(temporaria, "assinantes-file"), copia = join(temporaria, "assinatura.sig");
    await writeFile(copia, await readFile(assinatura));
    // O kit limita tags ao namespace git; a mesma chave autentica scripts no namespace file.
    await writeFile(allow, assinantes.replace(/namespaces="[^"]*"/g, 'namespaces="file"'));
    const chamada = (args: string[]) => Bun.spawnSync(["ssh-keygen", "-Y", ...args, "-f", allow, "-n", "file", "-s", copia], { stdin: bytes, stdout: "pipe", stderr: "pipe" });
    const principais = chamada(["find-principals"]);
    if (principais.exitCode || !principais.stdout.toString().trim().split(/\r?\n/).some(p => p && chamada(["verify", "-I", p]).exitCode === 0)) {
      throw new Error(`assinatura SSH inválida ou não confiável: ${nome}`);
    }
  } finally { await rm(temporaria, { recursive: true, force: true }); }
}
