import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type Entrada = { id: string; url: string; sha256: string };

function entradasDoManifesto(manifesto: unknown): Entrada[] {
  const ruim = () => new Error("Manifesto inválido: formato, plataformas, URL HTTPS oficial e SHA-256 são obrigatórios.");
  const objeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  if (!objeto(manifesto) || manifesto.formato !== 1 || !objeto(manifesto.dependencias)) throw ruim();
  const entradas: Entrada[] = [];
  const origens: Record<string, string> = { bun: "oven-sh/bun", rg: "BurntSushi/ripgrep", portablegit: "git-for-windows/git" };
  for (const [nome, dep] of Object.entries(manifesto.dependencias)) {
    if (!objeto(dep) || !objeto(dep.plataformas) || !Object.keys(dep.plataformas).length || !origens[nome]) throw ruim();
    for (const [plataforma, e] of Object.entries(dep.plataformas)) {
      if (!objeto(e) || typeof e.url !== "string" || typeof e.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(e.sha256)) throw ruim();
      const prefixo = `https://github.com/${origens[nome]}/releases/download/`;
      if (!e.url.startsWith(prefixo) || !/^[^/?#]+\/[^/?#]+$/.test(e.url.slice(prefixo.length))) throw ruim();
      entradas.push({ id: `${nome}/${plataforma}`, url: e.url, sha256: e.sha256 });
    }
  }
  if (!entradas.length) throw ruim();
  return entradas;
}

// Sem cache de sucesso: todo gate relê os bytes de cada entrada, inclusive plataformas não executadas no runner.
export async function verificarDependencias(manifesto: unknown, obter: typeof fetch = fetch): Promise<string[]> {
  const resultados: string[] = [];
  for (const e of entradasDoManifesto(manifesto)) {
    let resposta: Response;
    const sinal = AbortSignal.timeout(180_000);
    try { resposta = await obter(e.url, { signal: sinal, headers: { "Cache-Control": "no-cache" } }); }
    catch { throw new Error(`Download falhou: ${e.id}`); }
    if (!resposta.ok || !resposta.body) {
      await resposta.body?.cancel();
      throw new Error(`HTTP ${resposta.status}: ${e.id}`);
    }
    const hash = createHash("sha256");
    try {
      for await (const bloco of resposta.body) hash.update(bloco);
    } catch { throw new Error(`Download falhou: ${e.id}`); }
    if (hash.digest("hex") !== e.sha256) throw new Error(`SHA-256 divergente: ${e.id}`);
    resultados.push(`${e.id}: SHA-256 confere`);
  }
  return resultados;
}

if (import.meta.main) {
  if (process.argv.length !== 2) {
    console.error("Uso: bun scripts/verificar-dependencias-release.ts (usa instalador/dependencias.json)");
    process.exit(2);
  }
  try {
    const manifesto: unknown = JSON.parse(await readFile(resolve(import.meta.dir, "../instalador/dependencias.json"), "utf8"));
    for (const resultado of await verificarDependencias(manifesto)) console.log(resultado);
  } catch (e) { console.error((e as Error).message); process.exit(1); }
}
