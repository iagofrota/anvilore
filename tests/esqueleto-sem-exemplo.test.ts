import { afterEach, beforeEach, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { validarWiki } from "../src/comandos/validar";

// R73: o README manda apagar `wiki/exemplo/` e a seção `## Área: exemplo` do `wiki/index.md` antes de ligar um anvilore.toml com `areas`.
// Só apagar a pasta deixa `[[area-tematica]]` no índice e o validador reprova por wikilink quebrado.
const raiz = resolve(import.meta.dir, "..");
const readme = readFileSync(join(raiz, "README.md"), "utf8");
let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "anvilore-esqueleto-")); cpSync(join(raiz, "wiki"), join(tmp, "wiki"), { recursive: true }); });
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

test("Dado o README Quando manda remover o exemplo Então diz a pasta e a seção do índice, com o trecho exato", () => {
  expect(readme).toContain("rm -r wiki/exemplo");
  expect(readme).toContain("## Área: exemplo");
  expect(readme).toContain("[[area-tematica]]");
  expect(readme).toMatch(/até o fim do arquivo/);
});

test("Dado o esqueleto do clone Quando valido Então passa com o exemplo", async () => {
  const r = await validarWiki(join(tmp, "wiki"));
  expect(r.erros).toEqual([]);
});

test("Dado só a pasta wiki/exemplo apagada Quando valido Então o wikilink do índice reprova (o defeito que o README precisa evitar)", async () => {
  rmSync(join(tmp, "wiki", "exemplo"), { recursive: true });
  const r = await validarWiki(join(tmp, "wiki"));
  expect(r.erros.some((erro) => erro.includes("[[area-tematica]]"))).toBe(true);
});

test("Dado a pasta e a seção do índice apagadas como o README manda Quando valido Então não há erro nenhum", async () => {
  rmSync(join(tmp, "wiki", "exemplo"), { recursive: true });
  const indice = join(tmp, "wiki", "index.md");
  const texto = readFileSync(indice, "utf8");
  const inicio = texto.indexOf("## Área: exemplo");
  expect(inicio).toBeGreaterThan(0);
  // "até o fim do arquivo": a seção do exemplo é a última do índice do esqueleto.
  writeFileSync(indice, texto.slice(0, inicio).trimEnd() + "\n");
  const r = await validarWiki(join(tmp, "wiki"));
  expect(r.erros).toEqual([]);
});
