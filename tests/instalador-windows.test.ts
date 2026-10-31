import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const raiz = join(import.meta.dir, "..");
const script = join(raiz, "instalador/windows/anvilore.iss");

describe("AnviloreSetup.exe", () => {
  test("Dado o setup, Quando confiro o escopo e a execução, Então instala por usuário e não usa -File", () => {
    const iss = readFileSync(script, "utf8");
    expect(iss).toMatch(/PrivilegesRequired=lowest/i);
    expect(iss).toMatch(/\{localappdata\}\\Programs\\Anvilore/i);
    expect(iss).toMatch(/Get-Content[\s\S]*Invoke-Expression|Get-Content[\s\S]*scriptblock/i);
    expect(iss).not.toMatch(/-File\b/i);
    expect(iss).toMatch(/ExitCode\s*<>\s*10/);
    expect(iss).toMatch(/ANVILORE_SEM_PERGUNTAS/);
  });

  test("Dado o desinstalador, Quando verifico os caminhos apagados, Então ele nunca remove a pasta da pessoa", () => {
    const iss = readFileSync(script, "utf8");
    const secao = iss.match(/\[UninstallDelete\]([\s\S]*?)(?:\n\[|$)/i)?.[1] ?? "";
    expect(secao).not.toMatch(/USERPROFILE|Anvilore\\?$/i);
  });

  test("Dado o instalador e o ícone, Quando confiro os arquivos, Então ambos existem", () => {
    expect(existsSync(script)).toBe(true);
    expect(existsSync(join(raiz, "instalador/windows/anvilore.ico"))).toBe(true);
  });
});
