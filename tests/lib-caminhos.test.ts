import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { caminhoReal, chaveDeNome, dentroDe, estaEmRaw, normalizarFimDeLinha } from "../src/lib/caminhos";

test("Dado texto com CRLF, Quando normalizo o fim de linha, Então só restam LF", () => {
  expect(normalizarFimDeLinha("a\r\nb\r\n")).toBe("a\nb\n");
});

test("Dado texto que já usa LF, Quando normalizo o fim de linha, Então nada muda", () => {
  expect(normalizarFimDeLinha("a\nb\n")).toBe("a\nb\n");
});

test("Dado um CR solto sem LF, Quando normalizo o fim de linha, Então ele é preservado", () => {
  expect(normalizarFimDeLinha("a\rb")).toBe("a\rb");
});

test("Dado o é composto e o é decomposto, Quando calculo a chave de nome, Então as chaves são iguais", () => {
  const composto = "caf\u00e9.md";
  const decomposto = "cafe\u0301.md";
  expect(composto).not.toBe(decomposto);
  expect(chaveDeNome(composto)).toBe(chaveDeNome(decomposto));
});

test("Dado Pagina e pagina, Quando calculo a chave de nome, Então as chaves são iguais", () => {
  expect(chaveDeNome("Pagina")).toBe(chaveDeNome("pagina"));
});

test("Dado É maiúsculo decomposto e é minúsculo composto, Quando calculo a chave de nome, Então as chaves são iguais", () => {
  expect(chaveDeNome("E\u0301")).toBe(chaveDeNome("\u00e9"));
});

test("Dado dois nomes diferentes de verdade, Quando calculo a chave de nome, Então as chaves diferem", () => {
  expect(chaveDeNome("pagina-a")).not.toBe(chaveDeNome("pagina-b"));
});

test("Dado a chave de um nome, Quando calculo a chave dela de novo, Então o resultado não muda", () => {
  const chave = chaveDeNome("Cafe\u0301");
  expect(chaveDeNome(chave)).toBe(chave);
});

test("Dado um caminho do Windows com barra invertida, Quando pergunto se está em raw, Então está", () => {
  expect(estaEmRaw("C:\\p\\raw\\a.md")).toBe(true);
});

test("Dado um caminho POSIX com raw no meio, Quando pergunto se está em raw, Então está", () => {
  expect(estaEmRaw("/proj/raw/a.md")).toBe(true);
  expect(estaEmRaw("raw/a.md")).toBe(true);
});

test("Dado o próprio diretório raw, Quando pergunto se está em raw, Então está", () => {
  expect(estaEmRaw("raw")).toBe(true);
  expect(estaEmRaw("proj/raw/")).toBe(true);
});

test("Dado rawdata/a.md, Quando pergunto se está em raw, Então não está", () => {
  expect(estaEmRaw("rawdata/a.md")).toBe(false);
});

test("Dado wiki/raw-notas.md, Quando pergunto se está em raw, Então não está", () => {
  expect(estaEmRaw("wiki/raw-notas.md")).toBe(false);
});

test("Dado um caminho sem raw, Quando pergunto se está em raw, Então não está", () => {
  expect(estaEmRaw("wiki/a.md")).toBe(false);
  expect(estaEmRaw("")).toBe(false);
});

test("Dado Raw e RAW em caixas diferentes, Quando pergunto se está em raw, Então está (disco sem distinção de caixa)", () => {
  expect(estaEmRaw("Raw/a.md")).toBe(true);
  expect(estaEmRaw("proj\\RAW\\a.md")).toBe(true);
  expect(estaEmRaw("/p/rAw/x.md")).toBe(true);
});

test("Dado caminho misturando / e \\, Quando pergunto se está em raw, Então está", () => {
  expect(estaEmRaw("C:\\p/raw\\a.md")).toBe(true);
});

test("Dado raw como parte do nome do arquivo, Quando pergunto se está em raw, Então não está", () => {
  expect(estaEmRaw("wiki/raw.md")).toBe(false);
  expect(estaEmRaw("wiki/notas.raw")).toBe(false);
});

test("Dado componente raw com ponto, espaço ou unidade do Windows, Quando pergunto se está em raw, Então está", () => {
  for (const alvo of ["C:\\p\\raw.\\a.md", "C:\\p\\raw \\a.md", "C:raw\\a.md", "p/raw./a.md", "raw:stream", "raw::$INDEX_ALLOCATION", "p/raw.. /a.md"]) {
    expect(estaEmRaw(alvo)).toBe(true);
  }
});

test("Dado caminhos com .., //, ./, UNC ou prefixo \\?\\, Quando pergunto se está em raw, Então está", () => {
  for (const alvo of ["wiki/../raw/a.md", "raw//a.md", "./raw/a.md", "\\\\srv\\share\\raw\\a.md", "\\\\?\\C:\\p\\raw\\a.md"]) {
    expect(estaEmRaw(alvo)).toBe(true);
  }
});

test("Dado nomes que só lembram raw, Quando pergunto se está em raw, Então não está", () => {
  for (const alvo of ["rawdata/a.md", "wiki/raw-notas.md", "raw.md", "wiki/raw.md", "notas.raw", "C:\\p\\raw.md", "C:\\p\\a.md"]) {
    expect(estaEmRaw(alvo)).toBe(false);
  }
});

// B1 (revisão 1 do PR #21): a fronteira de raw/ vale pelo caminho real, não pelo texto.

const linkDeDiretorio = process.platform === "win32" ? "junction" : "dir";

function cenario(montar: (base: string) => void): string {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), "anvilore-real-")));
  mkdirSync(join(base, "raw"));
  mkdirSync(join(base, "wiki"));
  montar(base);
  return base;
}

test("Dado diretório da wiki que é link para raw/ Quando resolvo um arquivo novo dentro dele Então o caminho real cai em raw/", () => {
  const base = cenario(b => symlinkSync(join(b, "raw"), join(b, "wiki", "pessoal"), linkDeDiretorio));
  try {
    expect(caminhoReal(join(base, "wiki/pessoal/sources/x.md"))).toBe(join(base, "raw/sources/x.md"));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test.skipIf(process.platform === "win32")("Dado arquivo da wiki que é link para arquivo de raw/ Quando resolvo Então o caminho real é o de raw/", () => {
  const base = cenario(b => { writeFileSync(join(b, "raw/a.md"), "x"); symlinkSync(join(b, "raw/a.md"), join(b, "wiki/a.md")); });
  try {
    expect(caminhoReal(join(base, "wiki/a.md"))).toBe(join(base, "raw/a.md"));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test.skipIf(process.platform === "win32")("Dado link pendente para raw/ Quando resolvo Então segue o link até o arquivo que seria criado", () => {
  const base = cenario(b => symlinkSync(join(b, "raw/novo.md"), join(b, "wiki/n.md")));
  try {
    expect(caminhoReal(join(base, "wiki/n.md"))).toBe(join(base, "raw/novo.md"));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test.skipIf(process.platform === "win32")("Dado links em ciclo Quando resolvo Então falha em vez de girar para sempre", () => {
  const base = cenario(b => { symlinkSync(join(b, "wiki/b.md"), join(b, "wiki/a.md")); symlinkSync(join(b, "wiki/a.md"), join(b, "wiki/b.md")); });
  try {
    expect(() => caminhoReal(join(base, "wiki/a.md"))).toThrow();
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("Dado caminho sem link Quando resolvo Então é o mesmo caminho, exista ou não", () => {
  const base = cenario(() => {});
  try {
    expect(caminhoReal(join(base, "wiki/x/y.md"))).toBe(join(base, "wiki/x/y.md"));
    expect(caminhoReal(join(base, "wiki"))).toBe(join(base, "wiki"));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("Dado dois caminhos Quando pergunto se um está dentro do outro Então o próprio e os filhos contam, o vizinho com prefixo não", () => {
  const pai = join(tmpdir(), "p", "raw");
  expect(dentroDe(join(pai, "a.md"), pai)).toBe(true);
  expect(dentroDe(pai, pai)).toBe(true);
  expect(dentroDe(`${pai}-velho`, pai)).toBe(false);
  expect(dentroDe(join(tmpdir(), "p", "wiki"), pai)).toBe(false);
});

test.skipIf(process.platform === "win32")("Dado link relativo dentro de pasta que é link Quando resolvo Então o alvo parte do diretório real do link, como no disco", () => {
  const base = cenario(b => {
    mkdirSync(join(b, "x/y/z"), { recursive: true });
    symlinkSync(join(b, "x/y/z"), join(b, "wiki/a"), "dir");
    symlinkSync("../../../raw/f.md", join(b, "x/y/z/l"));
  });
  try {
    expect(caminhoReal(join(base, "wiki/a/l"))).toBe(join(base, "raw/f.md"));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

// Revisão de segurança 2: no POSIX o `..` vem depois do link (o disco resolve o link e só então sobe), não pelo texto.
test.skipIf(process.platform === "win32")("Dado .. logo depois de pasta que é link Quando resolvo Então sobe a partir do alvo real do link", () => {
  const base = cenario(b => { mkdirSync(join(b, "raw/sub")); symlinkSync(join(b, "raw/sub"), join(b, "wiki/pessoal"), "dir"); });
  try {
    expect(caminhoReal(`${base}/wiki/pessoal/../a.md`)).toBe(join(base, "raw/a.md"));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test.skipIf(process.platform === "win32")("Dado link pendente cujo alvo relativo tem .. depois de outro link Quando resolvo Então segue o disco", () => {
  const base = cenario(b => {
    mkdirSync(join(b, "raw/fundo"));
    symlinkSync(join(b, "raw/fundo"), join(b, "wiki/atalho"), "dir");
    symlinkSync("atalho/../x.md", join(b, "wiki/l"));
  });
  try {
    expect(caminhoReal(join(base, "wiki/l"))).toBe(join(base, "raw/x.md"));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("Dado caminho relativo e uma base Quando resolvo Então parte da base", () => {
  const base = cenario(() => {});
  try {
    expect(caminhoReal("wiki/x.md", base)).toBe(join(base, "wiki/x.md"));
    expect(caminhoReal("a".repeat(300), base)).toBe(join(base, "a".repeat(300)));
  } finally { rmSync(base, { recursive: true, force: true }); }
});
