import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  expect(await aprovarPaginas(raiz, ["wiki/pessoal/ideia.md"])).toEqual({ codigo: 0, mensagens: ["Aprovadas: 1 página (human:iago-avila)."] });
  expect(readFileSync(join(raiz, ".anvilore/identidade"), "utf8")).toBe("human:iago-avila\n");
  expect(readFileSync(pagina, "utf8")).toMatch(/verified:\n  - by: human:iago-avila\n    at: \d{4}-\d\d-\d\dT.*Z\n---/);
});

test("Dado git sem user.name Quando aprovo Então grava human:local sem pedir identidade", async () => {
  const wiki = join(raiz, "wiki");
  expect(Bun.spawnSync(["git", "-C", wiki, "init", "-q"], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
  const pagina = join(wiki, "pessoal/local.md");
  writeFileSync(pagina, "---\ngenerated:\n  by: agente\n  at: 2026-10-27T10:00:00Z\n---\n");
  const ambiente = { ...process.env, GIT_CONFIG_GLOBAL: join(raiz, "gitconfig-ausente"), GIT_CONFIG_NOSYSTEM: "1" };
  expect(await aprovarPaginas(raiz, ["wiki/pessoal/local.md"], ambiente)).toEqual({ codigo: 0, mensagens: ["Aprovadas: 1 página (human:local)."] });
  expect(readFileSync(join(raiz, ".anvilore/identidade"), "utf8")).toBe("human:local\n");
  expect(readFileSync(pagina, "utf8")).toContain("by: human:local");
});

test("Dado auto-commit ligado Quando aprovo Então commita verified no repo da wiki", async () => {
  const wiki = join(raiz, "wiki");
  for (const args of [["init", "-q"], ["config", "user.name", "Iago Avila"], ["config", "user.email", "iago@example.test"]]) {
    expect(Bun.spawnSync(["git", "-C", wiki, ...args], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
  }
  writeFileSync(join(raiz, "anvilore.toml"), "[hooks]\nauto_commit = true\n");
  const pagina = join(wiki, "pessoal/concepts/ideia.md");
  mkdirSync(join(wiki, "pessoal/concepts"), { recursive: true });
  writeFileSync(pagina, "---\ngenerated:\n  by: agente\n  at: 2026-10-27T10:00:00Z\n---\nIdeia.\n");
  const resultado = await aprovarPaginas(raiz, ["wiki/pessoal/concepts/ideia.md"]);
  expect(resultado.codigo).toBe(0);
  const commit = Bun.spawnSync(["git", "-C", wiki, "log", "-1", "--format=%s"], { stdout: "pipe", stderr: "pipe" });
  expect(commit.stdout.toString().trim()).toBe("wiki(verify): ideia");
  expect(Bun.spawnSync(["git", "-C", wiki, "show", "HEAD:pessoal/concepts/ideia.md"], { stdout: "pipe", stderr: "pipe" }).stdout.toString()).toContain("by: human:iago-avila");
});

test("Dado falha no commit automático Quando aprovo Então avisa sem descartar verified", async () => {
  const wiki = join(raiz, "wiki");
  for (const args of [["init", "-q"], ["config", "user.name", "Iago Avila"], ["config", "user.email", "iago@example.test"], ["add", "."], ["commit", "-qm", "base"]]) {
    if (args[0] === "add") writeFileSync(join(wiki, "alheio.txt"), "alheio\n");
    if (args[0] === "commit") expect(Bun.spawnSync(["git", "-C", wiki, ...args], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
    else expect(Bun.spawnSync(["git", "-C", wiki, ...args], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
  }
  writeFileSync(join(raiz, "anvilore.toml"), "[hooks]\nauto_commit = true\n");
  const pagina = join(wiki, "pessoal/ideia.md");
  writeFileSync(pagina, "---\ngenerated:\n  by: agente\n  at: 2026-10-27T10:00:00Z\n---\nIdeia.\n");
  writeFileSync(join(wiki, "alheio.txt"), "alterado\n");
  Bun.spawnSync(["git", "-C", wiki, "add", "alheio.txt"], { stdout: "pipe", stderr: "pipe" });
  const resultado = await aprovarPaginas(raiz, ["wiki/pessoal/ideia.md"]);
  expect(resultado.codigo).toBe(0);
  expect(resultado.mensagens.join(" ")).toContain("AVISO: aprovação registrada, mas commit automático não realizado");
  expect(readFileSync(pagina, "utf8")).toContain("by: human:iago-avila");
});

test("Dado página fora de wiki Quando aprovo Então recusa sem alterar o arquivo", async () => {
  const pagina = join(raiz, "fora.md");
  writeFileSync(pagina, "---\ngenerated:\n  by: agente\n  at: 2026-10-27T10:00:00Z\n---\n");
  const resultado = await aprovarPaginas(raiz, [pagina]);
  expect(resultado.codigo).toBe(1);
  expect(readFileSync(pagina, "utf8")).not.toContain("verified:");
});

test("Dado symlink dentro de wiki apontando para fora Quando aprovo Então recusa sem escrever no alvo", async () => {
  const fora = join(raiz, "fora.md");
  writeFileSync(fora, "---\ngenerated:\n  by: agente/teste\n  at: 2026-10-27T10:00:00Z\n---\n");
  symlinkSync(fora, join(raiz, "wiki/pessoal/atalho.md"));
  expect((await aprovarPaginas(raiz, ["wiki/pessoal/atalho.md"])).codigo).toBe(1);
  expect(readFileSync(fora, "utf8")).not.toContain("verified:");
});

test("Dado página sem generated ou aprovada depois da última geração Quando aprovo Então recusa", async () => {
  const semGerada = join(raiz, "wiki/sem-gerada.md");
  const jaAprovada = join(raiz, "wiki/aprovada.md");
  writeFileSync(semGerada, "---\ntitle: rascunho\n---\n");
  writeFileSync(jaAprovada, "---\ngenerated:\n  at: 2026-10-27T10:00:00Z\nverified:\n  - by: human:ana\n    at: 2026-10-27T11:00:00Z\n---\n");
  expect((await aprovarPaginas(raiz, ["wiki/sem-gerada.md"])).codigo).toBe(1);
  expect((await aprovarPaginas(raiz, ["wiki/aprovada.md"])).codigo).toBe(1);
});

test("Dado página aprovada antes da geração atual Quando aprovo Então acrescenta nova entrada ao verified", async () => {
  const wiki = join(raiz, "wiki");
  expect(Bun.spawnSync(["git", "-C", wiki, "init", "-q"], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
  expect(Bun.spawnSync(["git", "-C", wiki, "config", "user.name", "Iago Ávila"], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
  const pagina = join(wiki, "pessoal/atualizada.md");
  writeFileSync(pagina, "---\ngenerated:\n  by: agente\n  at: 2026-10-27T12:00:00Z\nverified:\n  - by: human:ana\n    at: 2026-10-27T11:00:00Z\n---\n\nAtualizada.\n");
  expect((await aprovarPaginas(raiz, ["wiki/pessoal/atualizada.md"])).codigo).toBe(0);
  const texto = readFileSync(pagina, "utf8");
  expect(texto).toContain("- by: human:ana\n    at: 2026-10-27T11:00:00Z");
  expect(texto).toMatch(/- by: human:iago-avila\n    at: \d{4}-\d\d-\d\dT.*Z/);
});

test("Dado página em CRLF Quando aprovo Então preservo os bytes do corpo e o fim de linha", async () => {
  const pagina = join(raiz, "wiki/pessoal/crlf.md");
  const original = Buffer.from("---\r\ntitle: CRLF\r\ngenerated:\r\n  by: agente\r\n  at: 2026-10-27T10:00:00Z\r\n---\r\nCorpo preservado.\r\n", "utf8");
  writeFileSync(pagina, original);
  expect((await aprovarPaginas(raiz, ["wiki/pessoal/crlf.md"])).codigo).toBe(0);
  const atualizado = readFileSync(pagina);
  const sufixoOriginal = Buffer.from("\r\n---\r\nCorpo preservado.\r\n", "utf8");
  expect(atualizado.subarray(atualizado.length - sufixoOriginal.length)).toEqual(sufixoOriginal);
  expect(Buffer.from(atualizado.toString("utf8").replaceAll("\r\n", ""), "utf8").includes(Buffer.from("\n"))).toBe(false);
});

test("Dado lista vazia Quando aprovo Então informa o uso", async () => {
  expect(await aprovarPaginas(raiz, [])).toEqual({ codigo: 2, mensagens: ["Uso: anvilore aprovar <página.md> [página.md ...]"] });
});

test("Dado identidade local já armazenada Quando aprovo outra página Então reutiliza a mesma pessoa sem perguntar", async () => {
  const pagina = join(raiz, "wiki/pessoal/ideia.md");
  mkdirSync(join(raiz, ".anvilore"), { recursive: true });
  writeFileSync(join(raiz, ".anvilore/identidade"), "human:iago-avila\n");
  writeFileSync(pagina, "---\ngenerated:\n  by: agente\n  at: 2026-10-27T10:00:00Z\n---\n");
  const resultado = await aprovarPaginas(raiz, ["wiki/pessoal/ideia.md"]);
  expect(resultado).toEqual({ codigo: 0, mensagens: ["Aprovadas: 1 página (human:iago-avila)."] });
});

test("Dado identidade armazenada inválida Quando aprovo Então recusa sem aprovar página", async () => {
  const pagina = join(raiz, "wiki/pessoal/ideia.md");
  mkdirSync(join(raiz, ".anvilore"), { recursive: true });
  writeFileSync(join(raiz, ".anvilore/identidade"), "alguém\n");
  const original = "---\ngenerated:\n  by: agente\n  at: 2026-10-27T10:00:00Z\n---\n";
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
  writeFileSync(pagina, "---\ngenerated:\n  by: agente\n  at: 2026-10-27T10:00:00Z\n---\n");
  expect(await aprovarPaginas(raiz, [pagina])).toMatchObject({ codigo: 0 });
});

test("Dado parser da CLI Quando a identidade vem após o caminho Então aprova a página", async () => {
  const wiki = join(raiz, "wiki");
  for (const args of [["init", "-q"], ["config", "user.name", "Iago Avila"]]) {
    expect(Bun.spawnSync(["git", "-C", wiki, ...args], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
  }
  const pagina = join(wiki, "pessoal/cli.md");
  writeFileSync(pagina, "---\ngenerated:\n  by: agente\n  at: 2026-10-27T10:00:00Z\n---\n");
  const raizAnterior = process.env.ANVILORE_DESTINO;
  process.env.ANVILORE_DESTINO = raiz;
  try {
    expect(await comandoAprovar(["wiki/pessoal/cli.md"])).toBe(0);
  } finally {
    if (raizAnterior === undefined) delete process.env.ANVILORE_DESTINO;
    else process.env.ANVILORE_DESTINO = raizAnterior;
  }
});
