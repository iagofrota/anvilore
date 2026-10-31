import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const raiz = resolve(import.meta.dir, "..");

export const NFPM_VERSAO = "2.47.0";
export const NFPM_HASHES: Record<string, { arquivo: string; sha256: string }> = {
  x64: {
    arquivo: `nfpm_${NFPM_VERSAO}_Linux_x86_64.tar.gz`,
    sha256: "0660ca602b2d2d2ae4781a06c692b3eeb9d437ffea05b831d76e41f4a3188783",
  },
  arm64: {
    arquivo: `nfpm_${NFPM_VERSAO}_Linux_arm64.tar.gz`,
    sha256: "1c0f5f2999b9a974bfb04fdb0cc3306096de530ac5dbb25d739cc5f5219c919c",
  },
};

export async function obterVersao(versaoParam?: string): Promise<string> {
  if (versaoParam) return versaoParam.replace(/^v/, "");
  if (process.env.ANVILORE_VERSAO) return process.env.ANVILORE_VERSAO.replace(/^v/, "");
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME.replace(/^v/, "");

  const pkgJson = JSON.parse(await readFile(join(raiz, "package.json"), "utf8"));
  return (pkgJson.version ?? "0.0.0").replace(/^v/, "");
}

export async function baixarEVerificarNfpm(diretorioTmp: string, opcoes?: { hashInvalidoTeste?: boolean }): Promise<string> {
  const arq = process.arch;
  const info = NFPM_HASHES[arq];
  if (!info) {
    throw new Error(`Arquitetura não suportada para download do nfpm: ${arq}`);
  }

  const url = `https://github.com/goreleaser/nfpm/releases/download/v${NFPM_VERSAO}/${info.arquivo}`;
  let resposta: Response;
  try {
    resposta = await fetch(url);
  } catch (erro) {
    throw new Error(`SKIP_OFFLINE: falha de rede ao baixar nfpm de ${url}: ${String(erro)}`);
  }

  if (!resposta.ok) {
    throw new Error(`SKIP_OFFLINE: HTTP ${resposta.status} ao baixar nfpm de ${url}`);
  }

  const dados = Buffer.from(await resposta.arrayBuffer());
  const hashObtido = createHash("sha256").update(dados).digest("hex");
  const hashEsperado = opcoes?.hashInvalidoTeste ? "hash_invalido_teste_00000000000000000000000000000000" : info.sha256;

  if (hashObtido !== hashEsperado) {
    throw new Error(`SHA-256 do nfpm divergente (esperado ${hashEsperado}, obtido ${hashObtido})`);
  }

  const arquivoTar = join(diretorioTmp, info.arquivo);
  await writeFile(arquivoTar, dados);

  const extrair = Bun.spawnSync(["tar", "-xzf", arquivoTar, "-C", diretorioTmp], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (extrair.exitCode !== 0) {
    throw new Error(`Falha ao descompactar ${arquivoTar}: ${extrair.stderr.toString()}`);
  }

  const nfpmBin = join(diretorioTmp, "nfpm");
  await chmod(nfpmBin, 0o755);
  return nfpmBin;
}

export async function empacotarLinux(opcoes: {
  saida?: string;
  versao?: string;
  config?: string;
  instalarSh?: string;
  nfpmBin?: string;
  hashInvalidoTeste?: boolean;
}): Promise<{ deb: string; rpm: string }> {
  const versao = await obterVersao(opcoes.versao);
  const saida = resolve(raiz, opcoes.saida ?? "dist");
  let config = resolve(raiz, opcoes.config ?? "instalador/linux/nfpm.yaml");

  await mkdir(saida, { recursive: true });

  let diretorioTmp: string | null = null;
  let nfpmBin = opcoes.nfpmBin ?? process.env.NFPM_BIN;

  try {
    if (!nfpmBin || opcoes.instalarSh) {
      diretorioTmp = await mkdtemp(join(tmpdir(), "anvilore-nfpm-"));
    }

    if (!nfpmBin) {
      nfpmBin = await baixarEVerificarNfpm(diretorioTmp!, { hashInvalidoTeste: opcoes.hashInvalidoTeste });
    }

    if (opcoes.instalarSh) {
      const conteudoOriginal = await readFile(config, "utf8");
      const caminhoInstalarAbsoluto = resolve(raiz, opcoes.instalarSh);
      const conteudoCustomizado = conteudoOriginal.replace(
        "./instalador/instalar.sh",
        caminhoInstalarAbsoluto,
      );
      const configCustom = join(diretorioTmp!, "nfpm.custom.yaml");
      await writeFile(configCustom, conteudoCustomizado, "utf8");
      config = configCustom;
    }

    const env = { ...process.env, ANVILORE_VERSAO: versao };
    const debDestino = join(saida, "anvilore.deb");
    const rpmDestino = join(saida, "anvilore.rpm");

    console.log(`Empacotando Anvilore ${versao} para Linux (deb e rpm)...`);

    const pDeb = Bun.spawnSync([nfpmBin, "package", "-f", config, "-p", "deb", "-t", debDestino], {
      cwd: raiz,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (pDeb.exitCode !== 0) {
      throw new Error(`nfpm deb falhou (${pDeb.exitCode}): ${pDeb.stderr.toString()}`);
    }

    const pRpm = Bun.spawnSync([nfpmBin, "package", "-f", config, "-p", "rpm", "-t", rpmDestino], {
      cwd: raiz,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (pRpm.exitCode !== 0) {
      throw new Error(`nfpm rpm falhou (${pRpm.exitCode}): ${pRpm.stderr.toString()}`);
    }

    console.log(`Pacotes criados em:\n  - ${debDestino}\n  - ${rpmDestino}`);
    return { deb: debDestino, rpm: rpmDestino };
  } finally {
    if (diretorioTmp) {
      await rm(diretorioTmp, { recursive: true, force: true });
    }
  }
}

// Execução como script principal
if (import.meta.main) {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      versao: { type: "string", short: "v" },
      saida: { type: "string", short: "o" },
      config: { type: "string", short: "c" },
      "instalar-sh": { type: "string" },
      "nfpm-bin": { type: "string" },
      "hash-nfpm-teste-invalido": { type: "boolean" },
    },
    allowPositionals: true,
  });

  const saida = values.saida ?? positionals[0];

  try {
    await empacotarLinux({
      saida,
      versao: values.versao,
      config: values.config,
      instalarSh: values["instalar-sh"],
      nfpmBin: values["nfpm-bin"],
      hashInvalidoTeste: values["hash-nfpm-teste-invalido"],
    });
  } catch (erro) {
    const msg = String(erro);
    if (msg.includes("SKIP_OFFLINE")) {
      console.warn(msg);
      process.exit(0);
    }
    console.error(`Erro: ${msg}`);
    process.exit(1);
  }
}
