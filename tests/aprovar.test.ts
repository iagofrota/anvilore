import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aprovarPaginas, comandoAprovar } from "../src/comandos/aprovar";

let raiz: string;
beforeEach(() => { raiz = mkdtempSync(join(tmpdir(), "anvilore-aprovar-")); mkdirSync(join(raiz, "wiki/pessoal"), { recursive: true }); });
afterEach(() => rmSync(raiz, { recursive: true, force: true }));

test("Dado nome Git e página gerada Quando aprovo Então registra identidade local e proveniência humana", async () => {
  const wiki = join(raiz, "wiki");
  for (const args of [["init", "-q"], ["config", "user.name", "Iago Ávila"]]) {
    const resultado = Bun.spawnSync(["git", "-C", wiki, ...args], { stdout: "pipe", stderr: "pipe" });
    expect(resultado.exitCode).toBe(0);
  }
  const pagina = join(wiki, "pessoal/ideia.md");
  writeFileSync(pagina, "---\ntitle: Ideia\ngenerated:\n  by: agente\n  at: 2026-10-27T10:00:00-03:00\n---\n\nCorpo.\n");
  expect(await aprovarPaginas(raiz, ["wiki/pessoal/ideia.md"], process.env, "human:iago-avila")).toEqual({ codigo: 0, mensagens: ["Aprovadas: 1 página (human:iago-avila)."] });
  expect(readFileSync(join(raiz, ".anvilore/identidade"), "utf8")).toBe("human:iago-avila\n");
  expect(readFileSync(pagina, "utf8")).toMatch(/verified:\n  - by: human:iago-avila\n    at: \d{4}-\d\d-\d\dT.*Z\n---/);
});

test("Dado página fora de wiki Quando aprovo Então recusa sem alterar o arquivo", async () => {
  const pagina = join(raiz, "fora.md");
  writeFileSync(pagina, "---\ngenerated: agente\n---\n");
  const resultado = await aprovarPaginas(raiz, [pagina]);
  expect(resultado.codigo).toBe(1);
  expect(readFileSync(pagina, "utf8")).not.toContain("verified:");
});

test("Dado página sem generated ou já aprovada Quando aprovo Então recusa", async () => {
  const semGerada = join(raiz, "wiki/sem-gerada.md");
  const jaAprovada = join(raiz, "wiki/aprovada.md");
  writeFileSync(semGerada, "---\ntitle: rascunho\n---\n");
  writeFileSync(jaAprovada, "---\ngenerated: agente\nverified: human:ana\n---\n");
  expect((await aprovarPaginas(raiz, ["wiki/sem-gerada.md"])).codigo).toBe(1);
  expect((await aprovarPaginas(raiz, ["wiki/aprovada.md"])).codigo).toBe(1);
});

test("Dado lista vazia Quando aprovo Então informa o uso", async () => {
  expect(await aprovarPaginas(raiz, [])).toEqual({ codigo: 2, mensagens: ["Uso: anvilore aprovar <página.md> [página.md ...]"] });
});

test("Dado identidade local diferente Quando tento aprovar Então recusa trocar a pessoa", async () => {
  const pagina = join(raiz, "wiki/pessoal/ideia.md");
  mkdirSync(join(raiz, ".anvilore"), { recursive: true });
  writeFileSync(join(raiz, ".anvilore/identidade"), "human:iago-avila\n");
  writeFileSync(pagina, "---\ngenerated: agente\n---\n");
  const resultado = await aprovarPaginas(raiz, ["wiki/pessoal/ideia.md"], process.env, "human:outra-pessoa");
  expect(resultado.codigo).toBe(1);
  expect(resultado.mensagens.join(" ")).toContain("não pode ser trocada");
});

test("Dado identidade armazenada inválida Quando aprovo Então recusa sem aprovar página", async () => {
  const pagina = join(raiz, "wiki/pessoal/ideia.md");
  mkdirSync(join(raiz, ".anvilore"), { recursive: true });
  writeFileSync(join(raiz, ".anvilore/identidade"), "alguém\n");
  const original = "---\ngenerated: agente\n---\n";
  writeFileSync(pagina, original);
  expect((await aprovarPaginas(raiz, ["wiki/pessoal/ideia.md"])).codigo).toBe(1);
  expect(readFileSync(pagina, "utf8")).toBe(original);
});

test("Dado comando com caminhos absolutos Quando aprovo Então aceita página na wiki", async () => {
  const wiki = join(raiz, "wiki");
  for (const args of [["init", "-q"], ["config", "user.name", "Iago Avila"]]) {
    expect(Bun.spawnSync(["git", "-C", wiki, ...args], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
  }
  const pagina = join(wiki, "pessoal/absoluta.md");
  writeFileSync(pagina, "---\ngenerated: agente\n---\n");
  expect(await aprovarPaginas(raiz, [pagina], process.env, "human:iago-avila")).toMatchObject({ codigo: 0 });
});

test("Dado parser da CLI Quando a identidade vem após o caminho Então aprova a página", async () => {
  const wiki = join(raiz, "wiki");
  for (const args of [["init", "-q"], ["config", "user.name", "Iago Avila"]]) {
    expect(Bun.spawnSync(["git", "-C", wiki, ...args], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
  }
  const pagina = join(wiki, "pessoal/cli.md");
  writeFileSync(pagina, "---\ngenerated: agente\n---\n");
  const raizAnterior = process.env.ANVILORE_DESTINO;
  process.env.ANVILORE_DESTINO = raiz;
  try {
    expect(await comandoAprovar(["wiki/pessoal/cli.md", "--identidade", "human:iago-avila"])).toBe(0);
  } finally {
    if (raizAnterior === undefined) delete process.env.ANVILORE_DESTINO;
    else process.env.ANVILORE_DESTINO = raizAnterior;
  }
});
