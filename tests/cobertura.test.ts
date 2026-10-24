import { expect, test } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const raizSrc = join(import.meta.dir, "..", "src");

// O Bun só mede o que a suíte carrega: sem este import, um módulo sem teste
// some da tabela de cobertura e a trava de 80% passa.
test("Dado todo módulo em src, Quando a suíte roda com cobertura, Então todos entram na medição", async () => {
  const arquivos = [...new Bun.Glob("**/*.ts").scanSync({ cwd: raizSrc })].sort();
  expect(arquivos.length).toBeGreaterThan(0);
  for (const arquivo of arquivos) {
    await import(pathToFileURL(join(raizSrc, arquivo)).href);
  }
});
