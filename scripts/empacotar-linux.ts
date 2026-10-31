import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { embutirInstalador, conferirEmbutidos } from "./embutir-instalador";
import { parsearSemVer } from "../src/lib/atualizacao";

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

// O nFPM grava no control do DEB a pré-release separada por til (0.3.1-rc.1 → 0.3.1~rc.1), para o dpkg ordená-la
// antes da versão final; o metadado de build (+...) fica igual. Só o hífen que separa a pré-release muda.
export function versaoDeb(versao: string): string {
  if (!parsearSemVer(versao)) throw new Error(`Versão SemVer inválida: ${JSON.stringify(versao)}.`);
  const mais = versao.indexOf("+");
  const nucleo = mais === -1 ? versao : versao.slice(0, mais), build = mais === -1 ? "" : versao.slice(mais);
  return nucleo.replace("-", "~") + build;
}

export async function obterVersao(versaoParam?: string): Promise<string> {
  const pkgJson = JSON.parse(await readFile(join(raiz, "package.json"), "utf8"));
  const origem = versaoParam ?? (process.env.ANVILORE_VERSAO || undefined)
    ?? (process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined)
    ?? pkgJson.version;
  const versao = typeof origem === "string" ? origem.replace(/^v/, "") : "";
  if (!parsearSemVer(versao)) throw new Error(`Versão SemVer inválida: ${JSON.stringify(origem)}. Use X.Y.Z, por exemplo 0.3.0 ou 0.3.0-rc.1.`);
  return versao;
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
    throw new Error(`Falha de rede ao baixar nfpm de ${url}: ${String(erro)}`);
  }

  if (!resposta.ok) {
    throw new Error(`HTTP ${resposta.status} ao baixar nfpm de ${url}`);
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
  teste?: boolean;
  assinantes?: string;
  baseMinima?: string;
  urlConfianca?: string;
}): Promise<{ deb: string; rpm: string }> {
  const versao = await obterVersao(opcoes.versao);
  if (!opcoes.teste && (opcoes.assinantes !== undefined || opcoes.baseMinima !== undefined || opcoes.urlConfianca !== undefined)) {
    throw new Error("Assinantes, base e URL customizados exigem --teste explícito; produção usa os arquivos e a URL oficiais.");
  }
  const ler = (caminho: string) => readFile(resolve(raiz, caminho), "utf8");
  const [modelo, manifesto, assinantes, baseMinima] = await Promise.all([
    ler("instalador/instalar.sh"), ler("instalador/dependencias.json"),
    ler(opcoes.assinantes ?? "seguranca/assinantes"), ler(opcoes.baseMinima ?? "instalador/base-minima"),
  ]);
  const url = { urlConfianca: opcoes.urlConfianca, urlDeTeste: opcoes.teste === true };
  // Reusa todas as validações do embutidor, inclusive quando recebemos --instalar-sh.
  const gerado = embutirInstalador(modelo, manifesto, assinantes, baseMinima, "sh", url);
  const instalador = opcoes.instalarSh ? await ler(opcoes.instalarSh) : gerado;
  const problemas = conferirEmbutidos(instalador, manifesto, assinantes, baseMinima, "sh", url);
  if (problemas.length) throw new Error(`Instalador não conferido: ${problemas.join(" ")}`);

  const saida = resolve(raiz, opcoes.saida ?? "dist");
  const config = resolve(raiz, opcoes.config ?? "instalador/linux/nfpm.yaml");
  const configuracao = await ler(config);
  if (!configuracao.includes('"${ANVILORE_INSTALAR_SH}"')) throw new Error("A configuração nfpm precisa usar ${ANVILORE_INSTALAR_SH} como origem do instalar.sh conferido.");
  await mkdir(saida, { recursive: true });
  // Mesmo filesystem do destino: os renames de publicação não cruzam volumes.
  const staging = await mkdtemp(join(saida, ".anvilore-staging-"));
  const destinos = [join(saida, "anvilore.deb"), join(saida, "anvilore.rpm")];
  const backups: number[] = [], publicados: number[] = [];
  try {
    const instalarSh = join(staging, "instalar.sh");
    await writeFile(instalarSh, instalador, { mode: 0o755 });
    // nfpm expande version, mas não contents.src. JSON é um escalar YAML com caminho escapado.
    const configPronta = join(staging, "nfpm.yaml");
    await writeFile(configPronta, configuracao.replaceAll('"${ANVILORE_INSTALAR_SH}"', JSON.stringify(instalarSh)));
    const nfpmBin = opcoes.nfpmBin || process.env.NFPM_BIN || await baixarEVerificarNfpm(staging, { hashInvalidoTeste: opcoes.hashInvalidoTeste });
    const env = { ...process.env, ANVILORE_VERSAO: versao, ANVILORE_INSTALAR_SH: instalarSh };
    console.log(`Empacotando Anvilore ${versao} para Linux (deb e rpm)${opcoes.teste ? " [TESTE: não publicar]" : ""}...`);
    const formatos = ["deb", "rpm"] as const;
    for (const formato of formatos) {
      const arquivo = join(staging, `anvilore.${formato}`);
      const p = Bun.spawnSync([nfpmBin, "package", "-f", configPronta, "-p", formato, "-t", arquivo], { cwd: raiz, env, stdout: "pipe", stderr: "pipe" });
      if (p.exitCode !== 0) throw new Error(`nfpm ${formato} falhou (${p.exitCode}): ${p.stderr.toString()}`);
      const cabecalho = Buffer.from(await Bun.file(arquivo).slice(0, 8).arrayBuffer());
      const assinatura = formato === "deb" ? Buffer.from("!<arch>\n") : Buffer.from([0xed, 0xab, 0xee, 0xdb]);
      if (!cabecalho.subarray(0, assinatura.length).equals(assinatura) || (await stat(arquivo)).size <= 8) {
        throw new Error(`nfpm ${formato} não gerou um pacote válido.`);
      }
    }
    // Só publica após gerar e conferir ambos. Qualquer erro de publicação restaura o par anterior.
    for (const [i, destino] of destinos.entries()) {
      try { await rename(destino, join(staging, `anterior-${i}`)); backups.push(i); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    }
    for (const [i, destino] of destinos.entries()) {
      await rename(join(staging, `anvilore.${formatos[i]}`), destino);
      publicados.push(i);
    }
    console.log(`Pacotes criados em:\n  - ${destinos[0]}\n  - ${destinos[1]}`);
    return { deb: destinos[0]!, rpm: destinos[1]! };
  } catch (e) {
    for (const i of publicados) await rm(destinos[i]!, { force: true });
    for (const i of backups) await rename(join(staging, `anterior-${i}`), destinos[i]!);
    throw e;
  } finally {
    await rm(staging, { recursive: true, force: true });
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
      teste: { type: "boolean" },
      assinantes: { type: "string" },
      "base-minima": { type: "string" },
      "url-confianca": { type: "string" },
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
      teste: values.teste,
      assinantes: values.assinantes,
      baseMinima: values["base-minima"],
      urlConfianca: values["url-confianca"],
      nfpmBin: values["nfpm-bin"],
      hashInvalidoTeste: values["hash-nfpm-teste-invalido"],
    });
  } catch (erro) {
    console.error(`Erro: ${String(erro)}`);
    process.exit(1);
  }
}
