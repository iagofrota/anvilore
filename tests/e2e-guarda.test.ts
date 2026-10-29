import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { conferirFoto, fotografar } from "../e2e/apoio/guarda";

let raiz: string;
beforeEach(() => { raiz = mkdtempSync(join(tmpdir(), "anvilore-guarda-")); });
afterEach(() => { try { chmodSync(join(raiz, "fechada"), 0o755); } catch { /* não existe */ } rmSync(raiz, { recursive: true, force: true }); });

test("Dado checkout limpo sem a pasta Quando a guarda fotografa Então registra ausente", async () => {
  expect(await fotografar(join(raiz, "raw"))).toBeNull();
});

test("Dado pasta ausente antes e depois Quando confiro Então não há problema", async () => {
  expect(conferirFoto("raw", await fotografar(join(raiz, "raw")), await fotografar(join(raiz, "raw")))).toBeNull();
});

test("Dado pasta ausente antes Quando a suíte a cria Então a guarda falha", async () => {
  const antes = await fotografar(join(raiz, "raw"));
  mkdirSync(join(raiz, "raw"));
  expect(conferirFoto("raw", antes, await fotografar(join(raiz, "raw")))).toContain("não existia e foi criada");
});

test("Dado pasta existente Quando a suíte a remove Então a guarda falha", async () => {
  mkdirSync(join(raiz, "wiki"));
  const antes = await fotografar(join(raiz, "wiki"));
  rmSync(join(raiz, "wiki"), { recursive: true });
  expect(conferirFoto("wiki", antes, await fotografar(join(raiz, "wiki")))).toContain("foi removida");
});

test("Dado pasta existente Quando um arquivo muda, surge ou some Então a guarda falha; sem mudança, passa", async () => {
  mkdirSync(join(raiz, "raw/pessoal"), { recursive: true });
  writeFileSync(join(raiz, "raw/pessoal/a.md"), "um");
  const antes = await fotografar(join(raiz, "raw"));
  expect(conferirFoto("raw", antes, await fotografar(join(raiz, "raw")))).toBeNull();
  writeFileSync(join(raiz, "raw/pessoal/a.md"), "dois");
  expect(conferirFoto("raw", antes, await fotografar(join(raiz, "raw")))).toContain("hashes diferem");
  writeFileSync(join(raiz, "raw/pessoal/a.md"), "um");
  writeFileSync(join(raiz, "raw/novo.md"), "x");
  expect(conferirFoto("raw", antes, await fotografar(join(raiz, "raw")))).toContain("hashes diferem");
  rmSync(join(raiz, "raw/novo.md")); rmSync(join(raiz, "raw/pessoal/a.md"));
  expect(conferirFoto("raw", antes, await fotografar(join(raiz, "raw")))).toContain("hashes diferem");
});

test("Dado erro que não é ENOENT na raiz Quando a guarda fotografa Então o erro propaga", async () => {
  // chmod 000 não bloqueia leitura no Windows nem para root: a prova só vale em POSIX sem privilégio.
  if (process.platform === "win32" || process.getuid?.() === 0) return;
  mkdirSync(join(raiz, "fechada/raw"), { recursive: true });
  chmodSync(join(raiz, "fechada"), 0o000);
  await expect(fotografar(join(raiz, "fechada/raw"))).rejects.toMatchObject({ code: "EACCES" });
});

test("Dado pasta que é um arquivo Quando a guarda fotografa Então o erro propaga", async () => {
  writeFileSync(join(raiz, "raw"), "arquivo");
  await expect(fotografar(join(raiz, "raw"))).rejects.toMatchObject({ code: "ENOTDIR" });
});
