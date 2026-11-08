import { createHash, randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { chmod, lstat, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type EstadoUi = {
  pid: number;
  porta: number;
  token: string;
  pasta: string;
  inicio?: string;
  soRevisao?: boolean;
};

export function chaveCofreUi(pasta: string): string {
  let canonica: string;
  try {
    canonica = realpathSync(pasta);
  } catch {
    canonica = resolve(pasta);
  }
  return createHash("sha256").update(canonica).digest("hex").slice(0, 16);
}

export async function obterInicioProcesso(pid: number): Promise<string | undefined> {
  try {
    const statStr = await readFile(`/proc/${pid}/stat`, "utf8");
    const posParenteses = statStr.lastIndexOf(")");
    if (posParenteses === -1) return undefined;
    const campos = statStr.slice(posParenteses + 2).trim().split(/\s+/);
    return campos[19];
  } catch {
    return undefined;
  }
}

export function caminhoEstadoUi(pasta: string, ambiente: Record<string, string | undefined> = process.env): string {
  const chave = chaveCofreUi(pasta);
  if (ambiente.XDG_RUNTIME_DIR) {
    return join(ambiente.XDG_RUNTIME_DIR, `anvilore-ui-${chave}.json`);
  }
  const stateHome = ambiente.XDG_STATE_HOME || join(ambiente.HOME ?? tmpdir(), ".local/state");
  return join(stateHome, "anvilore", `anvilore-ui-${chave}.json`);
}

export function caminhoTravaUi(pasta: string, ambiente: Record<string, string | undefined> = process.env): string {
  const chave = chaveCofreUi(pasta);
  if (ambiente.XDG_RUNTIME_DIR) {
    return join(ambiente.XDG_RUNTIME_DIR, `anvilore-ui-${chave}.lock`);
  }
  const stateHome = ambiente.XDG_STATE_HOME || join(ambiente.HOME ?? tmpdir(), ".local/state");
  return join(stateHome, "anvilore", `anvilore-ui-${chave}.lock`);
}

function ehDonoAtual(uid: number): boolean {
  if (typeof process.getuid !== "function") return true;
  return uid === process.getuid();
}

export async function obterEstadoUi(pasta: string, ambiente: Record<string, string | undefined> = process.env): Promise<EstadoUi | null> {
  const caminho = caminhoEstadoUi(pasta, ambiente);
  try {
    const linfo = await lstat(caminho);
    if (linfo.isSymbolicLink()) return null;
    if (!ehDonoAtual(linfo.uid)) return null;

    const conteudo = await readFile(caminho, "utf8");
    const dados = JSON.parse(conteudo) as Record<string, unknown>;
    if (
      typeof dados.pid === "number" &&
      typeof dados.porta === "number" &&
      typeof dados.token === "string" &&
      typeof dados.pasta === "string"
    ) {
      return {
        pid: dados.pid,
        porta: dados.porta,
        token: dados.token,
        pasta: dados.pasta,
        inicio: typeof dados.inicio === "string" ? dados.inicio : undefined,
        soRevisao: typeof dados.soRevisao === "boolean" ? dados.soRevisao : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function gravarEstadoUi(estado: EstadoUi, ambiente: Record<string, string | undefined> = process.env): Promise<void> {
  const caminho = caminhoEstadoUi(estado.pasta, ambiente);
  const pasta = dirname(caminho);

  if (!estado.inicio && typeof estado.pid === "number") {
    estado.inicio = await obterInicioProcesso(estado.pid);
  }
  if (typeof estado.soRevisao !== "boolean") {
    estado.soRevisao = false;
  }

  await mkdir(pasta, { recursive: true, mode: 0o700 });
  const pastaInfo = await lstat(pasta);
  if (pastaInfo.isSymbolicLink() || !ehDonoAtual(pastaInfo.uid)) {
    throw new Error(`Pasta de estado inválida ou insegura: ${pasta}`);
  }

  const chave = chaveCofreUi(estado.pasta);
  const tmp = join(pasta, `.anvilore-ui-${chave}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  await writeFile(tmp, JSON.stringify(estado, null, 2), { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, caminho);
}

export async function removerEstadoUi(pasta: string, pid?: number, ambiente: Record<string, string | undefined> = process.env): Promise<void> {
  const caminho = caminhoEstadoUi(pasta, ambiente);
  try {
    const linfo = await lstat(caminho);
    if (linfo.isSymbolicLink() || !ehDonoAtual(linfo.uid)) return;
    if (pid !== undefined) {
      const conteudo = await readFile(caminho, "utf8");
      const dados = JSON.parse(conteudo) as { pid?: unknown };
      if (dados.pid !== pid) return;
    }
    await rm(caminho, { force: true });
  } catch {}
}

export type OpcoesVerificarInstancia = {
  soRevisao?: boolean;
};

export async function verificarInstanciaExistente(
  pasta: string,
  ambiente: Record<string, string | undefined> = process.env,
  opcoes?: OpcoesVerificarInstancia,
): Promise<{ ativa: boolean; estado?: EstadoUi; url?: string }> {
  const estado = await obterEstadoUi(pasta, ambiente);
  if (!estado) return { ativa: false };

  // Item B: chave canônica (realpath) garante que symlinks e caminhos reais batam exatamente
  if (chaveCofreUi(pasta) !== chaveCofreUi(estado.pasta)) {
    return { ativa: false };
  }

  try {
    process.kill(estado.pid, 0);
  } catch {
    await removerEstadoUi(pasta, undefined, ambiente);
    return { ativa: false };
  }

  // P2-C: validação de início do processo contra PID reaproveitado
  if (estado.inicio) {
    const inicioAtual = await obterInicioProcesso(estado.pid);
    if (!inicioAtual || inicioAtual !== estado.inicio) {
      await removerEstadoUi(pasta, undefined, ambiente);
      return { ativa: false };
    }
  }

  // Compatibilidade de modo (P2-1):
  // Uma instância completa (soRevisao === false) serve a pedidos completos ou de revisão.
  // Uma instância só de revisão (soRevisao === true) NÃO serve a pedidos completos.
  // Estado legado sem soRevisao é tratado como incompatível para evitar reaproveitamento indevido.
  const modoDesejado = opcoes?.soRevisao ?? false;
  if (typeof estado.soRevisao !== "boolean") {
    return { ativa: false };
  }
  if (estado.soRevisao && !modoDesejado) {
    return { ativa: false, estado };
  }

  const url = `http://127.0.0.1:${estado.porta}/?token=${encodeURIComponent(estado.token)}`;
  try {
    const resposta = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (resposta.status === 200) {
      return { ativa: true, estado, url };
    }
  } catch (err: any) {
    const ehTimeout = err?.name === "TimeoutError" || err?.name === "AbortError";
    if (ehTimeout) {
      try {
        process.kill(estado.pid, 0);
        if (estado.inicio) {
          const inicioAtual = await obterInicioProcesso(estado.pid);
          if (inicioAtual && inicioAtual === estado.inicio) {
            return { ativa: true, estado, url };
          }
        } else {
          return { ativa: true, estado, url };
        }
      } catch {}
    }
  }

  await removerEstadoUi(pasta, undefined, ambiente);
  return { ativa: false };
}
