import { expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ligarDiretorio } from "../src/comandos/instalar";

test("Dado diretório temporário Quando crio ligação Então imprime resultado e confirma leitura sem cópia", async () => {
  const dir = await mkdtemp(join(tmpdir(), "juncao-"));
  try {
    const fonte = join(dir, "fonte"), link = join(dir, "link"); await mkdir(fonte);
    const resultado = await ligarDiretorio(fonte, link);
    console.log(`${process.platform === "win32" ? "junção" : "link simbólico"}: ${resultado} (${process.platform})`);
    expect(resultado).toBe("criado");
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    await writeFile(join(fonte, "vivo"), "alterado depois da ligação");
    expect(await readFile(join(link, "vivo"), "utf8")).toBe("alterado depois da ligação");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
