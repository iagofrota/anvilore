import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";

export type TipoCaptura = "nota" | "site" | "video" | "imagem" | "arquivo";
export const PASTA_DO_TIPO: Record<TipoCaptura, string> = { nota: "notas", site: "sites", video: "videos", imagem: "imagens", arquivo: "arquivos" };
export function validarAssunto(s: string): string | undefined {
  if (s.length > 60 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) return "assunto inválido: use até 60 letras minúsculas ou números separados por hífen";
}
export function validarSubpasta(s: string): string | undefined {
  if (s.toLowerCase() === "raw" || !/^[\p{L}\p{N}][\p{L}\p{N} _-]{0,59}$/u.test(s)) return "subpasta inválida: use um único nome de até 60 caracteres";
}
export function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
export type Proveniencia = { capturado_em: string; origem: string; tipo: TipoCaptura; contexto?: string; sha256: string; metodo?: string; [extra: string]: string | boolean | undefined };
export function montarMd(p: Proveniencia, corpo: Uint8Array): Uint8Array {
  const ordem = ["capturado_em", "origem", "tipo", "contexto", "sha256", "metodo"];
  const chaves = [...ordem, ...Object.keys(p).filter(k => !ordem.includes(k)).sort()];
  const linhas = chaves.filter(k => p[k] !== undefined).map(k => `${k}: ${JSON.stringify(p[k])}`);
  const cabecalho = new TextEncoder().encode(`---\n${linhas.join("\n")}\n---\n`);
  const md = new Uint8Array(cabecalho.length + corpo.length); md.set(cabecalho); md.set(corpo, cabecalho.length); return md;
}
export function agoraComOffset(d = new Date()): string {
  const dois = (n: number) => String(n).padStart(2, "0"); const offset = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${dois(d.getMonth()+1)}-${dois(d.getDate())}T${dois(d.getHours())}:${dois(d.getMinutes())}:${dois(d.getSeconds())}${offset < 0 ? "-" : "+"}${dois(Math.floor(Math.abs(offset)/60))}:${dois(Math.abs(offset)%60)}`;
}
export type Arquivo = { ext: string; bytes: Uint8Array };
type Publicador = { link: (temporario: string, final: string) => Promise<void> };
async function existe(p: string): Promise<boolean> {
  try { await lstat(p); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return false; throw e; }
}
async function escreverNovo(p: string, bytes: Uint8Array): Promise<void> {
  const f = await open(p, "wx");
  try { await f.writeFile(bytes); await f.sync(); } finally { await f.close(); }
}
export async function gravarCaptura(raiz: string, tipo: TipoCaptura, subpasta: string | undefined, assunto: string, arquivos: Arquivo[], data = new Date(), deps: Publicador = { link }): Promise<string[]> {
  const erro = validarAssunto(assunto) ?? (subpasta === undefined ? undefined : validarSubpasta(subpasta));
  if (erro) throw new Error(erro);
  if (!arquivos.length || arquivos.some(a => !/^[a-z0-9]+$/.test(a.ext)) || new Set(arquivos.map(a => a.ext)).size !== arquivos.length) throw new Error("extensões de captura inválidas ou repetidas");
  const pasta = ["raw", PASTA_DO_TIPO[tipo], ...(subpasta === undefined ? [] : [subpasta])].join("/");
  await mkdir(join(raiz, pasta), { recursive: true });
  for (let n = 1; ; n++) {
    const base = `${agoraComOffset(data).slice(0,10)}-${assunto}${n === 1 ? "" : `-${n}`}`;
    const caminhos = arquivos.map(a => `${pasta}/${base}.${a.ext}`);
    if ((await Promise.all(caminhos.map(p => existe(join(raiz,p))))).some(Boolean)) continue;
    let repetir = false;
    for (let i = 0; i < arquivos.length; i++) {
      const tmp = join(raiz, pasta, `.captura-${randomUUID()}.tmp`);
      const final = join(raiz, caminhos[i]!); let criado = false;
      try {
        const f = await open(tmp, "wx"); criado = true;
        try { await f.writeFile(arquivos[i]!.bytes); await f.sync(); } finally { await f.close(); }
        try { await deps.link(tmp, final); }
        catch (e) {
          if (!["EPERM", "ENOTSUP", "EXDEV", "ENOSYS"].includes((e as NodeJS.ErrnoException).code ?? "")) throw e;
          // Sem hardlink, wx continua exclusivo, mas a escrita final não é atômica.
          await escreverNovo(final, arquivos[i]!.bytes);
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        if (i > 0) throw new Error("outro processo gravou ao mesmo tempo; nada foi sobrescrito");
        repetir = true; break;
      } finally { if (criado) await unlink(tmp); }
    }
    if (!repetir) return caminhos;
  }
}
