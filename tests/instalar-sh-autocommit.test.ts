import { afterEach, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import type { criarCenario as CriarCenario, Cenario } from "./apoio/instalar-sh";

const linux = process.platform === "linux";
const apoio = linux ? await import("./apoio/instalar-sh") : undefined;
const cenarios: Cenario[] = [];
afterEach(async () => { await Promise.all(cenarios.splice(0).map(c => c.limpar())); });
async function novo(...args: Parameters<typeof CriarCenario>) { const c = await apoio!.criarCenario(...args); cenarios.push(c); return c; }

test.skipIf(!linux)("Dado JSON malformado que contém autoCommit true, Quando reinstalo, Então a opção fica desligada", async () => {
  const c = await novo();
  const primeira = c.rodar();
  expect(primeira.codigo, primeira.tudo).toBe(0);
  expect((await c.estado()).autoCommit).toBe(true);

  await writeFile(`${c.pasta}/.anvilore/atualizacao.json`, '{"autoCommit":true,');
  const reinstalacao = c.rodar();
  expect(reinstalacao.codigo, reinstalacao.tudo).toBe(0);

  const chamadasInstalar = (await c.chamadas()).filter(chamada => chamada.startsWith("instalar "));
  expect(chamadasInstalar.at(-1)).not.toContain("--auto-commit");
  expect((await c.estado()).autoCommit).toBe(false);
});
