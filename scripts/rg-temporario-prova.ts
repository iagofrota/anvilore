import { appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { imprimirProva, provarBusca } from "./provar-busca";
import { pacoteDoRg, conferirHash } from "./pacote-rg-prova";

export async function instalarRgTemporario() {
  const pacote = pacoteDoRg();
  const tmp = mkdtempSync(join(tmpdir(), "anvilore-rg-prova-"));
  try {
    const resposta = await fetch(pacote.url, { signal: AbortSignal.timeout(60_000) });
    if (!resposta.ok) throw new Error(`download do rg temporário: HTTP ${resposta.status}`);
    const bytes = new Uint8Array(await resposta.arrayBuffer());
    conferirHash(bytes, pacote.sha256);
    const arquivo = join(tmp, pacote.arquivo);
    writeFileSync(arquivo, bytes);
    const tar = Bun.spawnSync(["tar", "-xf", arquivo, "-C", tmp], { stdout: "pipe", stderr: "pipe" });
    if (tar.exitCode !== 0) throw new Error(`extração do rg temporário: ${tar.stderr.toString()}`);
    const bin = join(tmp, pacote.pasta);
    const exe = join(bin, process.platform === "win32" ? "rg.exe" : "rg");
    const versao = Bun.spawnSync([exe, "--version"], { stdout: "pipe", stderr: "pipe" });
    if (versao.exitCode !== 0 || !versao.stdout.toString().startsWith("ripgrep 15.1.0")) throw new Error("rg temporário não executou a versão esperada");
    writeFileSync(join(tmp, "anvilore-prova-rg"), pacote.sha256);
    console.log(`RG_TEMPORARIO ${JSON.stringify({ ...pacote, tmp, exe, versao: versao.stdout.toString() })}`);
    return { tmp, bin };
  } catch (erro) {
    rmSync(tmp, { recursive: true, force: true });
    throw erro;
  }
}

export function limparRgTemporario(dir = process.env.ANVILORE_RG_PROVA_DIR) {
  if (!dir) return;
  if (dirname(resolve(dir)) !== resolve(tmpdir()) || !basename(dir).startsWith("anvilore-rg-prova-")
    || !existsSync(join(dir, "anvilore-prova-rg"))) throw new Error("diretório de limpeza não foi criado pelo ensaio");
  rmSync(dir, { recursive: true, force: true });
  console.log("rg temporário removido");
}

async function prepararCI() {
  const arquivoPath = process.env.GITHUB_PATH, arquivoEnv = process.env.GITHUB_ENV;
  if (!arquivoPath || !arquivoEnv) throw new Error("preparação exclusiva do CI (GITHUB_PATH/GITHUB_ENV ausentes)");
  console.log("BASELINE: PATH original do runner; ausência de rg é resultado do diagnóstico, não será ocultada pela preparação.");
  const original = provarBusca();
  imprimirProva(original);
  if (original.shells.some(s => !s.exe)) throw new Error("shell exigido ausente no runner");
  if (!original.shells.some(s => s.erro)) return;
  const rg = await instalarRgTemporario();
  try {
    appendFileSync(arquivoPath, `${rg.bin}\n`);
    appendFileSync(arquivoEnv, `ANVILORE_RG_PROVA_DIR=${rg.tmp}\nANVILORE_RG_PROVA_CONTEXTO=rg 15.1.0 temporário, após baseline sem rg\n`);
  } catch (erro) { limparRgTemporario(rg.tmp); throw erro; }
}

if (import.meta.main) {
  if (process.argv.includes("--limpar")) limparRgTemporario();
  else await prepararCI();
}
