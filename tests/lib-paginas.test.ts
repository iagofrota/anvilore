import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { apararPython, caminhoPathlib, dataLocal, linhasPython, paginasMarkdown } from "../src/lib/paginas";

let raiz: string;

function gravar(rel: string, texto = "x\n"): void {
  const destino = join(raiz, rel);
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, texto);
}

async function relativas(ignorar?: (nome: string) => boolean): Promise<string[]> {
  return (await paginasMarkdown(raiz, ignorar)).map((p) => relative(raiz, p).split(/[\\/]/).join("/"));
}

beforeEach(() => { raiz = mkdtempSync(join(tmpdir(), "anvilore-paginas-")); });
afterEach(() => rmSync(raiz, { recursive: true, force: true }));

test.each([
  ["", []],
  ["a", ["a"]],
  ["a\n", ["a"]],
  ["a\n\n", ["a", ""]],
  ["a\r\nb", ["a", "b"]],
  ["a\rb", ["a", "b"]],
  ["a\fb\vc", ["a", "b", "c"]],
  ["a\x1cb\x1dc\x1ed", ["a", "b", "c", "d"]],
  ["a\x85b\u2028c\u2029d", ["a", "b", "c", "d"]],
] as [string, string[]][])("Dado o texto %j, Quando separo em linhas, Então reproduzo o splitlines do Python", (texto, esperado) => {
  expect(linhasPython(texto)).toEqual(esperado);
});

test.each([
  ["  a  ", "a"],
  ["\x1c\x1fa\x85\xa0", "a"],
  ["\u2003a\u3000", "a"],
  ["\uFEFFa", "\uFEFFa"],
] as const)("Dado %j, Quando aparo, Então removo só o espaço que o Python remove", (texto, esperado) => {
  expect(apararPython(texto)).toBe(esperado);
});

test.each([
  ["wiki", "wiki"],
  ["./wiki/", "wiki"],
  ["wiki//a/./b", "wiki/a/b"],
  ["wiki/../wiki", "wiki/../wiki"],
  ["", "."],
  [".", "."],
  ["/tmp/w/", "/tmp/w"],
] as const)("Dado o caminho %j, Quando normalizo, Então escrevo como o pathlib: %j", (entrada, esperado) => {
  expect(caminhoPathlib(entrada).split("\\").join("/")).toBe(esperado);
});

test("Dado a data local, Quando peço o texto, Então vem como AAAA-MM-DD", () => {
  expect(dataLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test("Dado nomes que o separador desempata, Quando listo, Então a ordem é a das partes do caminho", async () => {
  gravar("a-b/x.md");
  gravar("a/x.md");
  gravar("a.md");
  gravar("b.txt");
  expect(await relativas()).toEqual(["a/x.md", "a-b/x.md", "a.md"]);
});

test("Dado ignorar para um nome, Quando listo, Então o diretório inteiro fica de fora", async () => {
  gravar("keep/p.md");
  gravar("log/dia.md");
  gravar("keep/log/fundo.md");
  expect(await relativas((nome) => nome === "log")).toEqual(["keep/p.md"]);
});

test("Dado um diretório chamado como página, Quando listo, Então desce nele e não o lista", async () => {
  gravar("pasta.md/dentro.md");
  expect(await relativas()).toEqual(["pasta.md/dentro.md"]);
});

const testeSymlink = process.platform === "win32" ? test.skip : test;

testeSymlink("Dado symlink de página, de diretório e quebrado, Quando listo, Então segue a página e avisa os outros", async () => {
  gravar("alvo.md");
  gravar("dir/p.md");
  symlinkSync(join(raiz, "alvo.md"), join(raiz, "link.md"));
  symlinkSync(join(raiz, "dir"), join(raiz, "dirlink"));
  symlinkSync(join(raiz, "ausente.md"), join(raiz, "quebrado.md"));
  const erro = spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await relativas()).toEqual(["alvo.md", "dir/p.md", "link.md"]);
    expect(erro.mock.calls.map((c) => c.join(" "))).toEqual([
      `AVISO: symlink de diretório não seguido: ${join(raiz, "dirlink")}`,
      `AVISO: symlink quebrado: ${join(raiz, "quebrado.md")}`,
    ]);
  } finally {
    erro.mockRestore();
  }
});
