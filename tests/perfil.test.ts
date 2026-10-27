import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PerfilInvalido, areaPermitida, carregarPerfil } from "../src/lib/perfil";

let raiz: string;

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "anvilore-perfil-"));
});
afterEach(() => {
  rmSync(raiz, { recursive: true, force: true });
});

function toml(conteudo: string): void {
  writeFileSync(join(raiz, "anvilore.toml"), conteudo);
}

describe("carregarPerfil", () => {
  test("Dado uma raiz sem anvilore.toml, Quando carrego, Então devolve {} e vale o SCHEMA.md", async () => {
    expect(await carregarPerfil(raiz)).toEqual({});
  });

  test("Dado um anvilore.toml com as três chaves, Quando carrego, Então devolve o perfil", async () => {
    toml('areas = ["produto", "plataforma"]\ntipos = ["concept", "source"]\ncampos_obrigatorios = ["tags", "owner"]\n');
    expect(await carregarPerfil(raiz)).toEqual({
      areas: ["produto", "plataforma"],
      tipos: ["concept", "source"],
      camposObrigatorios: ["tags", "owner"],
    });
  });

  test("Dado opções de ganchos no anvilore.toml, Quando carrego, Então reconhece opt-in booleano", async () => {
    toml('[hooks]\nauto_commit = true\ngithub_backup = false\n');
    expect(await carregarPerfil(raiz)).toEqual({ hooks: { autoCommit: true, githubBackup: false } });
  });

  test("Dado um anvilore.toml só com as áreas, Quando carrego, Então as outras chaves ficam ausentes", async () => {
    toml('areas = ["produto"]\n');
    expect(await carregarPerfil(raiz)).toEqual({ areas: ["produto"] });
  });

  test("Dado um anvilore.toml vazio, Quando carrego, Então devolve {}", async () => {
    toml("# só um comentário\n");
    expect(await carregarPerfil(raiz)).toEqual({});
  });

  test("Dado um anvilore.toml salvo no Windows, com BOM e CRLF, Quando carrego, Então lê igual", async () => {
    toml('﻿areas = ["produto"]\r\ntipos = ["concept"]\r\n');
    expect(await carregarPerfil(raiz)).toEqual({ areas: ["produto"], tipos: ["concept"] });
  });

  test("Dado uma lista vazia, Quando carrego, Então ela vale literalmente: nada é permitido", async () => {
    toml("areas = []\n");
    expect(await carregarPerfil(raiz)).toEqual({ areas: [] });
  });

  test("Dado TOML com sintaxe inválida, Quando carrego, Então falha nomeando o arquivo e nunca devolve {}", async () => {
    toml('areas = ["produto"\n');
    const erro = await carregarPerfil(raiz).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(PerfilInvalido);
    expect((erro as Error).message).toContain("anvilore.toml");
  });

  test("Dado uma chave desconhecida, Quando carrego, Então falha nomeando a chave (regra com typo não é ignorada)", async () => {
    toml('area = ["produto"]\n');
    const erro = await carregarPerfil(raiz).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(PerfilInvalido);
    expect((erro as Error).message).toContain("area");
  });

  test("Dado uma chave que não é lista de textos, Quando carrego, Então falha nomeando a chave", async () => {
    for (const linha of ['areas = "produto"', "tipos = [1, 2]", 'campos_obrigatorios = ["ok", ""]']) {
      toml(`${linha}\n`);
      const erro = await carregarPerfil(raiz).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(PerfilInvalido);
      expect((erro as Error).message).toContain(linha.split(" ")[0]!);
    }
  });

  test("Dado anvilore.toml que é um diretório, Quando carrego, Então falha em vez de ignorar", async () => {
    mkdirSync(join(raiz, "anvilore.toml"));
    await expect(carregarPerfil(raiz)).rejects.toBeInstanceOf(PerfilInvalido);
  });
});

describe("areaPermitida: a política única de init e validar", () => {
  test("Dado perfil sem areas, Quando pergunto, Então tudo é permitido", () => {
    expect(areaPermitida(undefined, "qualquer")).toBe(true);
  });
  test("Dado perfil com areas, Quando comparo, Então a comparação é exata, sem caixa nem normalização Unicode", () => {
    expect(areaPermitida(["pessoal", "Saúde"], "pessoal")).toBe(true);
    expect(areaPermitida(["pessoal"], "Pessoal")).toBe(false);
    expect(areaPermitida(["Pessoal"], "pessoal")).toBe(false);
    expect(areaPermitida(["saúde"], "saúde")).toBe(false);
    expect(areaPermitida([], "pessoal")).toBe(false);
  });
});
