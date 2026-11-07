import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type EstadoUi = {
  pid: number;
  porta: number;
  token: string;
  pasta: string;
  inicio?: string;
};

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

export function caminhoEstadoUi(ambiente: Record<string, string | undefined> = process.env): string {
  if (ambiente.XDG_RUNTIME_DIR) {
    return join(ambiente.XDG_RUNTIME_DIR, "anvilore-ui.json");
  }
  const stateHome = ambiente.XDG_STATE_HOME || join(ambiente.HOME ?? tmpdir(), ".local/state");
  return join(stateHome, "anvilore", "anvilore-ui.json");
}

function ehDonoAtual(uid: number): boolean {
  if (typeof process.getuid !== "function") return true;
  return uid === process.getuid();
}

export async function obterEstadoUi(ambiente: Record<string, string | undefined> = process.env): Promise<EstadoUi | null> {
  const caminho = caminhoEstadoUi(ambiente);
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
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function gravarEstadoUi(estado: EstadoUi, ambiente: Record<string, string | undefined> = process.env): Promise<void> {
  const caminho = caminhoEstadoUi(ambiente);
  const pasta = dirname(caminho);

  if (!estado.inicio && typeof estado.pid === "number") {
    estado.inicio = await obterInicioProcesso(estado.pid);
  }

  await mkdir(pasta, { recursive: true, mode: 0o700 });
  const pastaInfo = await lstat(pasta);
  if (pastaInfo.isSymbolicLink() || !ehDonoAtual(pastaInfo.uid)) {
    throw new Error(`Pasta de estado inválida ou insegura: ${pasta}`);
  }

  const tmp = join(pasta, `.anvilore-ui.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  await writeFile(tmp, JSON.stringify(estado, null, 2), { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, caminho);
}

export async function removerEstadoUi(pid?: number, ambiente: Record<string, string | undefined> = process.env): Promise<void> {
  const caminho = caminhoEstadoUi(ambiente);
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

export async function verificarInstanciaExistente(
  pasta: string,
  ambiente: Record<string, string | undefined> = process.env,
): Promise<{ ativa: boolean; estado?: EstadoUi; url?: string }> {
  const estado = await obterEstadoUi(ambiente);
  if (!estado) return { ativa: false };

  const pastaCanonica = resolve(pasta);
  const pastaEstadoCanonica = resolve(estado.pasta);
  if (pastaCanonica !== pastaEstadoCanonica) {
    return { ativa: false };
  }

  try {
    process.kill(estado.pid, 0);
  } catch {
    await removerEstadoUi(undefined, ambiente);
    return { ativa: false };
  }

  // P2-C: validação de início do processo contra PID reaproveitado
  if (estado.inicio) {
    const inicioAtual = await obterInicioProcesso(estado.pid);
    if (!inicioAtual || inicioAtual !== estado.inicio) {
      await removerEstadoUi(undefined, ambiente);
      return { ativa: false };
    }
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

  await removerEstadoUi(undefined, ambiente);
  return { ativa: false };
}
