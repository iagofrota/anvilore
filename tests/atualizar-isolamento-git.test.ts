import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Os testes do atualizador nunca podem escrever no ~/.gitconfig de quem os roda (achado P2 do Codex no PR #35).
// A configuração global do git que o teste precisa vem de um arquivo temporário escolhido por GIT_CONFIG_GLOBAL.
const fonte = readFileSync(join(import.meta.dir, "atualizar.test.ts"), "utf8");

test("Dado tests/atualizar.test.ts, Quando procuro o HOME, Então nenhum teste monta o caminho do ~/.gitconfig real", () => {
  expect(fonte).not.toMatch(/\.gitconfig/);
  expect(fonte).not.toMatch(/process\.env\.HOME/);
  expect(fonte).not.toMatch(/homedir\(/);
});

test("Dado tests/atualizar.test.ts, Quando procuro o gitconfig dos testes de assinatura, Então ele é um arquivo temporário escolhido por GIT_CONFIG_GLOBAL", () => {
  expect(fonte).toMatch(/comGitconfigGlobal\(/);
  expect(fonte).toMatch(/process\.env\.GIT_CONFIG_GLOBAL = /);
});
