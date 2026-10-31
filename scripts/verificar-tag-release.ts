import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compararSemVer, execPadrao, identidadeDaTag, parsearSemVer, verificarAssinaturaTag } from "../src/lib/atualizacao";
import { consultarConfianca, filtrarAssinantes } from "../src/lib/confianca";
import type { BuscarConfianca } from "../src/lib/confianca";
import { embutirInstalador } from "./embutir-instalador";
import { verificarAssinaturaInstalador } from "./assinaturas-release";

export async function verificarTagRelease(raiz: string, tag: string, anterior: string, buscar?: BuscarConfianca): Promise<{ versao: string; commit: string }> {
  const versao = tag.replace(/^v/, ""), base = anterior.replace(/^v/, "");
  if (!parsearSemVer(versao) || !parsearSemVer(base) || compararSemVer(versao, base) <= 0) {
    throw new Error("Tag candidata e versão anterior precisam ser SemVer; candidata deve ser mais nova.");
  }
  const identidade = identidadeDaTag(raiz, tag);
  if (typeof identidade === "string") throw new Error(identidade);
  if (execPadrao(["rev-parse", "HEAD"], raiz).saida.trim() !== identidade.commit) throw new Error("HEAD não corresponde ao commit da tag.");
  const ancora = execPadrao(["show", `refs/tags/${anterior}:seguranca/assinantes`], raiz);
  if (ancora.codigo !== 0 || !ancora.saida.trim()) throw new Error("Âncora da versão anterior ausente; não há fallback para a candidata.");
  const temporaria = await mkdtemp(join(tmpdir(), "anvilore-release-tag-"));
  try {
    const arquivo = join(temporaria, "assinantes");
    await writeFile(arquivo, ancora.saida);
    const confianca = await consultarConfianca(buscar);
    if (compararSemVer(versao, confianca.versaoMinima) < 0) throw new Error("Tag abaixo da versão mínima do site.");
    const problema = verificarAssinaturaTag(raiz, tag, execPadrao, tag, arquivo, confianca.chaves);
    if (problema) throw new Error(problema);
    const lerDaTag = (caminho: string) => {
      const r = execPadrao(["show", `${identidade.commit}:${caminho}`], raiz);
      if (r.codigo) throw new Error(`Arquivo ausente no commit autenticado: ${caminho}`);
      return r.saida;
    };
    const pacote = JSON.parse(lerDaTag("package.json")) as { version?: unknown };
    if (pacote.version !== identidade.versao) throw new Error("package.json não corresponde à versão da tag.");
    const manifesto = lerDaTag("instalador/dependencias.json");
    const chaveEmbutida = lerDaTag("seguranca/assinantes");
    const baseMinima = lerDaTag("instalador/base-minima");
    const confiaveis = filtrarAssinantes(ancora.saida, confianca.chaves);
    for (const dialeto of ["sh", "ps1"] as const) {
      const nome = `instalar.${dialeto}`;
      const modelo = lerDaTag(`instalador/${nome}`);
      const script = embutirInstalador(modelo, manifesto, chaveEmbutida, baseMinima, dialeto);
      const assinatura = join(temporaria, `${nome}.sig`);
      await writeFile(assinatura, lerDaTag(`instalador/assinaturas/${nome}.sig`));
      await verificarAssinaturaInstalador(Buffer.from(script), assinatura, confiaveis, nome);
    }
    return identidade;
  } finally { await rm(temporaria, { recursive: true, force: true }); }
}

if (import.meta.main) {
  const [tag, anterior, ...extras] = process.argv.slice(2);
  if (!tag || !anterior || extras.length) { console.error("Uso: bun scripts/verificar-tag-release.ts <tag> <tag-anterior-publicada>"); process.exit(2); }
  try { console.log(JSON.stringify(await verificarTagRelease(resolve(import.meta.dir, ".."), tag, anterior))); }
  catch (e) { console.error((e as Error).message); process.exit(1); }
}
