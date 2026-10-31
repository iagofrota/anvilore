import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parsearSemVer } from "../src/lib/atualizacao";
import { embutirInstalador } from "./embutir-instalador";

export function extrairNotasRelease(changelog: string, versao: string): string {
  const linhas = changelog.split(/\r?\n/);
  const inicio = linhas.findIndex(l => l.startsWith(`## [${versao}] - `));
  if (inicio < 0) throw new Error("CHANGELOG sem seção datada para a versão.");
  const resto = linhas.slice(inicio + 1), fim = resto.findIndex(l => /^##\s/.test(l));
  const notas = `${(fim < 0 ? resto : resto.slice(0, fim)).join("\n").trim()}\n`;
  if (!/^[-*+]\s+\S/m.test(notas)) throw new Error("CHANGELOG sem itens na seção da versão.");
  return notas;
}

// Preparo local, sem subprocessos, rede ou acesso à chave privada. Sem --preparar, apenas descreve a saída.
export async function prepararRelease(raiz: string, versao: string, saida: string, escrever = false): Promise<{ arquivos: string[]; notas: string }> {
  const pacote = JSON.parse(await readFile(join(raiz, "package.json"), "utf8")) as { version?: unknown };
  if (!parsearSemVer(versao) || pacote.version !== versao) throw new Error("Versão inválida ou diferente de package.json.");
  const changelog = await readFile(join(raiz, "CHANGELOG.md"), "utf8");
  const notas = extrairNotasRelease(changelog, versao);
  const manifesto = await readFile(join(raiz, "instalador/dependencias.json"), "utf8");
  const assinantes = await readFile(join(raiz, "seguranca/assinantes"), "utf8");
  const base = await readFile(join(raiz, "instalador/base-minima"), "utf8");
  const conteudos = new Map<string, string>();
  for (const dialeto of ["sh", "ps1"] as const) {
    const nome = `instalar.${dialeto}`;
    conteudos.set(nome, embutirInstalador(await readFile(join(raiz, "instalador", nome), "utf8"), manifesto, assinantes, base, dialeto));
  }
  conteudos.set("NOTAS.md", notas);
  if (escrever) {
    for (const nome of conteudos.keys()) {
      const existe = await lstat(join(saida, nome)).then(() => true, (e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return false; throw e; });
      if (existe) throw new Error(`${nome} já existe; use uma pasta de preparo nova para preservar os artefatos anteriores.`);
    }
    await mkdir(saida, { recursive: true });
    for (const [nome, texto] of conteudos) await writeFile(join(saida, nome), texto, { flag: "wx", mode: nome.endsWith(".sh") ? 0o755 : 0o644 });
  }
  return { arquivos: [...conteudos.keys()], notas };
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({ options: { preparar: { type: "boolean" }, versao: { type: "string" }, saida: { type: "string" } }, strict: true, allowPositionals: false });
    const raiz = resolve(import.meta.dir, "..");
    const pacote = JSON.parse(await readFile(join(raiz, "package.json"), "utf8")) as { version: string };
    const resultado = await prepararRelease(raiz, values.versao ?? pacote.version, resolve(values.saida ?? "dist"), values.preparar);
    console.log(values.preparar ? "Preparo local gravado. Faltam assinatura offline, pacotes e gates da release." : "Simulação: nenhum arquivo foi alterado.");
    console.log(resultado.arquivos.join("\n"));
  } catch (e) { console.error((e as Error).message); process.exit(1); }
}
