import { expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ligarArquivo, ligarDiretorio } from "../src/comandos/instalar";
import { capturarConsole } from "./apoio/console";
import { medirLigacoes } from "../scripts/medir-ligacoes";

test("Dado diretório temporário Quando crio ligação Então confirma leitura sem cópia", async () => {
  const dir = await mkdtemp(join(tmpdir(), "juncao-"));
  try {
    const fonte = join(dir, "fonte"), link = join(dir, "link"); await mkdir(fonte);
    const resultado = await ligarDiretorio(fonte, link);
    expect(resultado).toBe("criado");
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    await writeFile(join(fonte, "vivo"), "alterado depois da ligação");
    expect(await readFile(join(link, "vivo"), "utf8")).toBe("alterado depois da ligação");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Dado arquivo temporário Quando ligo e repito Então acompanha edições e falha explicitamente sem copiar", async () => {
  const consoleCapturado = capturarConsole();
  const dir = await mkdtemp(join(tmpdir(), "link-arquivo-"));
  try {
    const fonte = join(dir, "fonte.md"), link = join(dir, "link.md");
    await writeFile(fonte, "antes");
    expect(await ligarArquivo(fonte, link)).toBe("criado");
    expect(await ligarArquivo(fonte, link)).toBe("ja-correto");
    await writeFile(fonte, "depois");
    expect(await readFile(link, "utf8")).toBe("depois");
    expect(await ligarArquivo(fonte, join(dir, "ausente/link.md"))).toBe("falhou");
    expect(consoleCapturado.avisos.join("\n")).toContain("Nenhuma cópia");
    expect(consoleCapturado.avisos.join("\n")).toContain("modo desenvolvedor");
  } finally {
    consoleCapturado.restaurar();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Dado medição das ligações Quando executo Então relata diretório e arquivo e limpa o temporário", async () => {
  const consoleCapturado = capturarConsole();
  try {
    expect(await medirLigacoes()).toBe(0);
    expect(consoleCapturado.saida.join("\n")).toContain("criado");
    expect(consoleCapturado.saida.join("\n")).toContain("link de arquivo: criado");
  } finally { consoleCapturado.restaurar(); }
});
