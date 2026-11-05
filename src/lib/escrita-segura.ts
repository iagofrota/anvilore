import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { caminhoReal, dentroDe, estaEmRaw } from "./caminhos";

export class ErroDeEscritaSegura extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeEscritaSegura";
  }
}

function resolverAlvo(raizAbs: string, caminhoAlvo: string): string {
  if (isAbsolute(caminhoAlvo)) return caminhoAlvo;
  const aPartirDeCwd = resolve(caminhoAlvo);
  if (dentroDe(aPartirDeCwd, raizAbs)) return aPartirDeCwd;
  return resolve(raizAbs, caminhoAlvo);
}

function resolverDestinoReal(raizReal: string, alvoAbs: string, rel: string): string {
  try {
    return caminhoReal(alvoAbs);
  } catch (erro) {
    const code = (erro as NodeJS.ErrnoException).code;
    // No macOS, realpathSync.native falha com EACCES em arquivo sem permissão de leitura (ex.: chmod 000).
    // O lstatSync subsequente nos segmentos detecta se for link; se não for, o caminho sob raizReal serve para validar raw/ e raiz.
    if (code === "EACCES") {
      return resolve(raizReal, rel);
    }
    throw erro;
  }
}

// Confere que um caminho alvo (existente ou a ser criado) reside estritamente dentro da raiz da wiki:
// (a) o alvo não é um link simbólico;
// (b) nenhum diretório ancestral entre a raiz da wiki e o alvo é um link simbólico, e o caminho real não sai da raiz;
// (c) o caminho real não cai dentro de raw/.
export function validarEscritaNaWiki(raizWiki: string, caminhoAlvo: string): {
  raizReal: string;
  alvoAbs: string;
  paiAbs: string;
} {
  const raizAbs = resolve(raizWiki);
  if (!existsSync(raizAbs)) {
    throw new ErroDeEscritaSegura(`raiz da wiki não encontrada: ${raizWiki}`);
  }
  const raizReal = caminhoReal(raizAbs);
  if (estaEmRaw(raizReal)) {
    throw new ErroDeEscritaSegura(`a raiz da wiki fica dentro de raw/: ${raizWiki}`);
  }

  const alvoAbs = resolverAlvo(raizAbs, caminhoAlvo);
  const rel = relative(raizAbs, alvoAbs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new ErroDeEscritaSegura(`caminho fora da raiz da wiki: ${caminhoAlvo}`);
  }

  const destinoReal = resolverDestinoReal(raizReal, alvoAbs, rel);
  if (estaEmRaw(destinoReal)) {
    throw new ErroDeEscritaSegura(`o caminho real fica dentro de raw/: ${caminhoAlvo}`);
  }
  if (!dentroDe(destinoReal, raizReal)) {
    throw new ErroDeEscritaSegura(`o caminho real sai da raiz da wiki: ${caminhoAlvo}`);
  }

  const segmentos = rel.split(/[\\/]+/).filter(Boolean);
  let atual = raizAbs;
  for (let i = 0; i < segmentos.length; i++) {
    atual = join(atual, segmentos[i]!);
    const ehAlvoFinal = i === segmentos.length - 1;

    let stats: Stats | null = null;
    try {
      stats = lstatSync(atual);
    } catch (erro) {
      const code = (erro as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw new ErroDeEscritaSegura(`não foi possível acessar ${atual}: ${code ?? (erro as Error).message}`);
      }
    }

    if (stats !== null && stats.isSymbolicLink()) {
      if (ehAlvoFinal) {
        throw new ErroDeEscritaSegura(`o alvo é um link simbólico: ${caminhoAlvo}`);
      } else {
        throw new ErroDeEscritaSegura(`diretório ancestral é um link simbólico: ${atual}`);
      }
    }
  }

  return { raizReal, alvoAbs, paiAbs: dirname(alvoAbs) };
}

// Confere diretório da wiki (existente ou a ser criado): não pode ser link nem sair da wiki nem cair em raw/.
export function validarDiretorioWiki(raizWiki: string, caminhoDiretorio: string): void {
  const raizAbs = resolve(raizWiki);
  if (!existsSync(raizAbs)) {
    throw new ErroDeEscritaSegura(`raiz da wiki não encontrada: ${raizWiki}`);
  }
  const raizReal = caminhoReal(raizAbs);
  if (estaEmRaw(raizReal)) {
    throw new ErroDeEscritaSegura(`a raiz da wiki fica dentro de raw/: ${raizWiki}`);
  }

  const dirAbs = resolverAlvo(raizAbs, caminhoDiretorio);
  const rel = relative(raizAbs, dirAbs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new ErroDeEscritaSegura(`diretório fora da raiz da wiki: ${caminhoDiretorio}`);
  }
  if (rel === "") return;

  const destinoReal = resolverDestinoReal(raizReal, dirAbs, rel);
  if (estaEmRaw(destinoReal)) {
    throw new ErroDeEscritaSegura(`o caminho real fica dentro de raw/: ${caminhoDiretorio}`);
  }
  if (!dentroDe(destinoReal, raizReal)) {
    throw new ErroDeEscritaSegura(`o caminho real sai da raiz da wiki: ${caminhoDiretorio}`);
  }

  const segmentos = rel.split(/[\\/]+/).filter(Boolean);
  let atual = raizAbs;
  for (let i = 0; i < segmentos.length; i++) {
    atual = join(atual, segmentos[i]!);
    let stats: Stats | null = null;
    try {
      stats = lstatSync(atual);
    } catch (erro) {
      const code = (erro as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw new ErroDeEscritaSegura(`não foi possível acessar ${atual}: ${code ?? (erro as Error).message}`);
      }
    }
    if (stats !== null && stats.isSymbolicLink()) {
      throw new ErroDeEscritaSegura(`diretório é um link simbólico: ${atual}`);
    }
  }
}

// Confere se um arquivo existente pode ser lido como arquivo pertencente à wiki (sem links e sem raw/).
export function validarLeituraNaWiki(raizWiki: string, caminhoAlvo: string): void {
  const raizAbs = resolve(raizWiki);
  if (!existsSync(raizAbs)) {
    throw new ErroDeEscritaSegura(`raiz da wiki não encontrada: ${raizWiki}`);
  }
  const raizReal = caminhoReal(raizAbs);
  if (estaEmRaw(raizReal)) {
    throw new ErroDeEscritaSegura(`a raiz da wiki fica dentro de raw/: ${raizWiki}`);
  }

  const alvoAbs = resolverAlvo(raizAbs, caminhoAlvo);
  const rel = relative(raizAbs, alvoAbs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new ErroDeEscritaSegura(`caminho fora da raiz da wiki: ${caminhoAlvo}`);
  }

  const destinoReal = resolverDestinoReal(raizReal, alvoAbs, rel);
  if (estaEmRaw(destinoReal)) {
    throw new ErroDeEscritaSegura(`o caminho real fica dentro de raw/: ${caminhoAlvo}`);
  }
  if (!dentroDe(destinoReal, raizReal)) {
    throw new ErroDeEscritaSegura(`o caminho real sai da raiz da wiki: ${caminhoAlvo}`);
  }

  const segmentos = rel.split(/[\\/]+/).filter(Boolean);
  let atual = raizAbs;
  for (let i = 0; i < segmentos.length; i++) {
    atual = join(atual, segmentos[i]!);
    const ehAlvoFinal = i === segmentos.length - 1;
    let stats: Stats;
    try {
      stats = lstatSync(atual);
    } catch (erro) {
      const code = (erro as NodeJS.ErrnoException).code;
      throw new ErroDeEscritaSegura(`não foi possível acessar ${atual}: ${code ?? (erro as Error).message}`);
    }
    if (stats.isSymbolicLink()) {
      if (ehAlvoFinal) {
        throw new ErroDeEscritaSegura(`o alvo é um link simbólico: ${caminhoAlvo}`);
      } else {
        throw new ErroDeEscritaSegura(`diretório ancestral é um link simbólico: ${atual}`);
      }
    }
  }
}

// Retorna se o caminho é seguro para gravação, sem lançar erro (útil para rejuntar-linhas pular links com aviso).
export function podeGravarNaWiki(raizWiki: string, caminhoAlvo: string): boolean {
  try {
    validarEscritaNaWiki(raizWiki, caminhoAlvo);
    return true;
  } catch {
    return false;
  }
}

// Grava um arquivo na wiki de forma segura: confere confinamento, recusa symlinks e usa gravação atômica na mesma pasta.
export async function gravarArquivoWiki(
  raizWiki: string,
  caminhoAlvo: string,
  conteudo: string | Uint8Array,
  opcoes?: { encoding?: BufferEncoding; flag?: string },
): Promise<void> {
  const { alvoAbs, paiAbs } = validarEscritaNaWiki(raizWiki, caminhoAlvo);
  if (opcoes?.flag === "wx") {
    try {
      lstatSync(alvoAbs);
      throw Object.assign(new Error(`EEXIST: file already exists, open '${alvoAbs}'`), { code: "EEXIST" });
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code !== "ENOENT") throw erro;
    }
    await mkdir(paiAbs, { recursive: true });
    validarDiretorioWiki(raizWiki, paiAbs);
    await writeFile(alvoAbs, conteudo, { encoding: opcoes?.encoding ?? "utf8", flag: "wx" });
    return;
  }

  try {
    accessSync(alvoAbs, constants.W_OK);
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code !== "ENOENT") throw erro;
  }

  await mkdir(paiAbs, { recursive: true });
  validarDiretorioWiki(raizWiki, paiAbs);
  const temp = join(paiAbs, `.${basename(alvoAbs)}.${randomUUID()}.tmp`);
  await writeFile(temp, conteudo, { encoding: opcoes?.encoding ?? "utf8" });
  try {
    await rename(temp, alvoAbs);
  } catch (erro) {
    try { await rm(temp, { force: true }); } catch {}
    throw erro;
  }
}

// Versão síncrona de gravarArquivoWiki.
export function gravarArquivoWikiSync(
  raizWiki: string,
  caminhoAlvo: string,
  conteudo: string | Uint8Array,
  opcoes?: { encoding?: BufferEncoding; flag?: string },
): void {
  const { alvoAbs, paiAbs } = validarEscritaNaWiki(raizWiki, caminhoAlvo);
  if (opcoes?.flag === "wx") {
    try {
      lstatSync(alvoAbs);
      throw Object.assign(new Error(`EEXIST: file already exists, open '${alvoAbs}'`), { code: "EEXIST" });
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code !== "ENOENT") throw erro;
    }
    mkdirSync(paiAbs, { recursive: true });
    validarDiretorioWiki(raizWiki, paiAbs);
    writeFileSync(alvoAbs, conteudo, { encoding: opcoes?.encoding ?? "utf8", flag: "wx" });
    return;
  }

  try {
    accessSync(alvoAbs, constants.W_OK);
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code !== "ENOENT") throw erro;
  }

  mkdirSync(paiAbs, { recursive: true });
  validarDiretorioWiki(raizWiki, paiAbs);
  const temp = join(paiAbs, `.${basename(alvoAbs)}.${randomUUID()}.tmp`);
  writeFileSync(temp, conteudo, { encoding: opcoes?.encoding ?? "utf8" });
  try {
    renameSync(temp, alvoAbs);
  } catch (erro) {
    try { rmSync(temp, { force: true }); } catch {}
    throw erro;
  }
}
