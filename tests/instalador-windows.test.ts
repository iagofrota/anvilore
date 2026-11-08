import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const raiz = join(import.meta.dir, "..");
const script = join(raiz, "instalador/windows/anvilore.iss");
const abrir = join(raiz, "instalador/abrir.ps1");

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

  test("Dado o setup compilado para uma versão, Quando instala os arquivos, Então inclui VERSAO junto do lançador", () => {
    const iss = readFileSync(script, "utf8");
    expect(iss).toMatch(/#ifndef VersaoFile/);
    expect(iss).toMatch(/Source:\s*"\{#VersaoFile\}";\s*DestDir:\s*"\{app\}";\s*DestName:\s*"VERSAO"/i);
    const workflow = readFileSync(join(raiz, ".github/workflows/builds-release.yml"), "utf8");
    expect(workflow).toContain("WriteAllText($versaoArquivo");
    expect(workflow).toContain("/DVersaoFile=$versaoArquivo");
  });

  test("Dado atualização pelo pacote, Quando inicia o instalador, Então prepara PATH antes e preserva os dados de atalho Inno", () => {
    const codigo = readFileSync(abrir, "utf8");
    const prepararPath = codigo.indexOf("$caminhosGerenciados =");
    const atualizar = codigo.indexOf("AnvAbrirAtualizarDoPacote -versaoPacote");
    const atualizador = codigo.match(/function AnvAbrirAtualizarDoPacote\([\s\S]*?\n\}/)?.[0] ?? "";
    expect(prepararPath).toBeGreaterThan(-1);
    expect(atualizar).toBeGreaterThan(prepararPath);
    expect(atualizador).toContain("$env:ANVILORE_ATALHO_SETUP = '1'");
    expect(atualizador).toContain("$env:ANVILORE_CONFIG_SETUP = Join-Path $origem 'pasta.txt'");
    expect(atualizador).toContain("'ANVILORE_ATALHO_SETUP'");
    expect(atualizador).toContain("'ANVILORE_CONFIG_SETUP'");
    expect(atualizador).toMatch(/finally\s*\{[\s\S]*?foreach \(\$nome in \$variaveis\)/);
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
