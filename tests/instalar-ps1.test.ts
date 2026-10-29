// Contrato estático do instalador do Windows. O comportamento (PowerShell de verdade) é provado pelos testes Pester em
// tests/instalar-ps1/, que rodam no job `instalar-ps1` do CI (windows-latest, Windows PowerShell 5.1): o Bun não executa PowerShell.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const raiz = join(import.meta.dir, "..");
const caminho = join(raiz, "instalador/instalar.ps1");
const bytes = readFileSync(caminho);
const texto = bytes.toString("utf8");
const codigo = texto.split("\n").filter(l => !l.trimStart().startsWith("#")).join("\n");

function bloco(nome: string): string {
  const m = new RegExp(`# ANVILORE-EMBUTIDO-INICIO ${nome}\\n([\\s\\S]*?)# ANVILORE-EMBUTIDO-FIM ${nome}`).exec(texto);
  if (!m) throw new Error(`bloco ${nome} ausente`);
  return m[1]!;
}

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

  test("Dado o instalador sem build de release, Então os blocos embutidos estão vazios: sem chave, nada é confiável", () => {
    for (const nome of ["manifesto", "assinantes"]) {
      const interior = bloco(nome).replace(/\$script:\w+\s*=\s*@'\r?\n'@/, "").trim();
      expect(interior).toBe("");
    }
  });
});

describe("instalar.ps1: manifesto de prova usado pelos testes", () => {
  const m = JSON.parse(readFileSync(join(raiz, "tests/instalar-ps1/fixtures/dependencias-prova.json"), "utf8"));
  const entradas = Object.entries(m.dependencias).flatMap(([nome, porPlataforma]) =>
    Object.entries(porPlataforma as Record<string, { url: string; sha256: string; versao: string }>).map(([plataforma, e]) => ({ nome, plataforma, ...e })));

  test("Dado cada entrada, Então tem https e SHA-256 de 64 hex", () => {
    for (const e of entradas) {
      expect(e.url).toMatch(/^https:\/\//);
      expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("Dado o Bun do manifesto, Quando comparo com o packageManager do package.json, Então a versão é a mesma", () => {
    const pm = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8")).packageManager as string;
    expect(m.dependencias.bun["windows-x64"].versao).toBe(pm.replace(/^bun@/, ""));
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
