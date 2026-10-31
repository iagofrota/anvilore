import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { linhasDe } from "../src/lib/frontmatter";

const raiz = join(import.meta.dir, "..");
const usos = linhasDe(readFileSync(join(raiz, ".github", "workflows", "ci.yml"), "utf8"))
  .map((linha) => /^\s*-?\s*uses:\s*(\S+)(.*)$/.exec(linha))
  .filter((achado) => achado !== null);

describe("workflow de CI: ações de terceiros", () => {
  test("Dado o ci.yml, Quando listo as ações usadas, Então há pelo menos uma", () => {
    expect(usos.length).toBeGreaterThan(0);
  });

  test("Dado cada ação do ci.yml, Quando leio a referência, Então é um SHA de commit completo e a versão fica em comentário", () => {
    for (const uso of usos.filter(uso => !uso![1]!.startsWith("./"))) {
      expect(uso![1]).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
      expect(uso![2]).toMatch(/^\s+#\s*v\d+\.\d+\.\d+\s*$/);
    }
  });
  test("Dado workflow local reutilizado, Quando leio a referência, Então aponta somente para workflow versionado existente", () => {
    for (const uso of usos.filter(uso => uso![1]!.startsWith("./"))) {
      expect(uso![1]).toMatch(/^\.\/\.github\/workflows\/[a-z0-9-]+\.yml$/);
      expect(existsSync(join(raiz, uso![1]!))).toBe(true);
    }
  });
});
