// Contrato estático do instalador do Windows. O comportamento (PowerShell de verdade) é provado pelos testes Pester em
// tests/instalar-ps1/, que rodam no job `instalar-ps1` do CI (windows-latest, Windows PowerShell 5.1): o Bun não executa PowerShell.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { lerEmbutidos } from "../scripts/embutir-instalador";

const raiz = join(import.meta.dir, "..");
const caminho = join(raiz, "instalador/instalar.ps1");
const bytes = readFileSync(caminho);
const texto = bytes.toString("utf8");
const codigo = texto.split("\n").filter(l => !l.trimStart().startsWith("#")).join("\n");

describe("instalar.ps1: forma do arquivo", () => {
  test("Dado o instalador, Quando leio os bytes, Então é UTF-8 sem BOM", () => {
    expect([bytes[0], bytes[1], bytes[2]]).not.toEqual([0xef, 0xbb, 0xbf]);
  });

  test("Dado o instalador lido como ANSI pelo PowerShell 5.1, Quando procuro bytes que viram aspas tipográficas, Então não há nenhum", () => {
    // 0x84 e 0x91-0x94 em CP1252 são „ ‘ ’ “ ”, que o PowerShell trata como aspas: um travessão ou um Ó/Ô quebraria a leitura.
    const ruins = [...bytes].filter(b => b === 0x84 || (b >= 0x91 && b <= 0x94));
    expect(ruins).toHaveLength(0);
  });

  test("Dado o instalador, Quando procuro `exit`, Então não existe (num irm | iex fecharia o terminal)", () => {
    expect(codigo).not.toMatch(/^\s*exit\b/m);
  });

  test("Dado o instalador, Quando procuro bloco param no topo do arquivo ou -ExecutionPolicy, Então não há (GPO vence o parâmetro)", () => {
    expect(codigo).not.toMatch(/^param\s*\(/m);
    expect(codigo).not.toMatch(/-ExecutionPolicy/);
  });
});

describe("instalar.ps1: requisitos do passo a passo", () => {
  test.each([
    ["clone sem conversão de fim de linha", /core\.autocrlf=false/],
    ["saída em UTF-8", /OutputEncoding/],
    ["Constrained Language Mode cai para reg.exe", /LanguageMode[\s\S]*reg\.exe|reg\.exe[\s\S]*LanguageMode/],
    ["perguntas desligáveis", /ANVILORE_SEM_PERGUNTAS/],
    ["origem trocável", /ANVILORE_ORIGEM/],
    ["registro em .anvilore\\instalacao.log", /instalacao\.log/],
    ["confere a assinatura da tag", /verify-tag/],
    ["PortableGit em %LOCALAPPDATA%\\Anvilore\\git", /Anvilore\\git/],
  ])("Dado o instalador, Quando procuro: %s, Então está lá", (_nome, padrao) => {
    expect(codigo).toMatch(padrao);
  });

  test("Dado o passo 10 (atalhos), Então é só um ponto de chamada para a U6: sem .lnk, sem WScript.Shell e sem abrir.ps1", () => {
    expect(codigo).toMatch(/function AnvInstalarAtalhos/);
    expect(codigo).not.toMatch(/WScript\.Shell|CreateShortcut|\.lnk/);
    expect(existsSync(join(raiz, "instalador/abrir.ps1"))).toBe(false);
  });

  test("Dado o instalador sem build de release, Então as regiões embutidas estão vazias: sem chave, nada é confiável", () => {
    expect(lerEmbutidos(texto, "ps1")).toEqual({ manifesto: "", assinantes: "" });
    expect(texto).toMatch(/# >>> ANVILORE:MANIFESTO[^\n]*\n\$script:AnvManifestoEmbutido = @'\n'@\n# <<< ANVILORE:MANIFESTO/);
    expect(texto).toMatch(/# >>> ANVILORE:ASSINANTES[^\n]*\n\$script:AnvAssinantesEmbutido = @'\n'@\n# <<< ANVILORE:ASSINANTES/);
  });
});

describe("instalar.ps1: manifesto real", () => {
  const m = JSON.parse(readFileSync(join(raiz, "instalador/dependencias.json"), "utf8"));

  test("Dado o manifesto, Então traz PortableGit, Bun (com baseline) e rg para windows-x64", () => {
    for (const [nome, plataforma] of [["portablegit", "windows-x64"], ["bun", "windows-x64"], ["bun", "windows-x64-baseline"], ["rg", "windows-x64"]] as const) {
      const e = m.dependencias[nome].plataformas[plataforma];
      expect(e.url).toMatch(/^https:\/\//);
      expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("Dado o Bun do manifesto, Quando comparo com o packageManager do package.json, Então a versão é a mesma", () => {
    const pm = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8")).packageManager as string;
    expect(m.dependencias.bun.versao).toBe(pm.replace(/^bun@/, ""));
  });
});

describe("CI do instalador do Windows", () => {
  test("Dado o ci.yml, Então há um job no windows-latest que roda os testes unitários e a prova de ponta a ponta", () => {
    const ci = readFileSync(join(raiz, ".github/workflows/ci.yml"), "utf8");
    const job = /\n  instalar-ps1:[\s\S]*?(?=\n  [a-z0-9-]+:\n|$)/.exec(ci)?.[0] ?? "";
    expect(job).toContain("windows-latest");
    expect(job).toContain("tests/instalar-ps1/instalar.Tests.ps1");
    expect(job).toContain("tests/instalar-ps1/e2e.Tests.ps1");
  });
});
