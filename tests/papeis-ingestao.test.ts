import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { comandoRotaIngestao, rotaDoArquivo } from "../src/comandos/rota-ingestao";
import { lerFrontmatter } from "../src/lib/frontmatter";
import {
  agentesDaIngestao,
  conferirAgentesDaIngestao,
  FERRAMENTAS,
  LIMITE_DIVIDIR_BYTES,
  LIMITE_GRANDE_BYTES,
  nomeDoAgente,
  rotaDaIngestao,
} from "../src/lib/papeis-ingestao";
import { capturarConsole } from "./apoio/console";

const raiz = resolve(import.meta.dir, "..");
const prompt = (papel: string) => readFileSync(join(raiz, `skills/ingest/${papel}.md`), "utf8");

describe("papéis da ingestão: rota pelo tamanho da fonte", () => {
  test("Dado fonte até 400 000 bytes Quando escolho a rota Então é a padrão", () => {
    expect(rotaDaIngestao(12_347)).toBe("padrao");
    expect(rotaDaIngestao(LIMITE_GRANDE_BYTES)).toBe("padrao");
  });

  test("Dado fonte acima de 400 000 bytes Quando escolho a rota Então pede janela grande", () => {
    expect(rotaDaIngestao(LIMITE_GRANDE_BYTES + 1)).toBe("grande");
    expect(rotaDaIngestao(LIMITE_DIVIDIR_BYTES)).toBe("grande");
  });

  test("Dado fonte que não cabe nem na janela grande Quando escolho a rota Então manda dividir", () => {
    expect(rotaDaIngestao(LIMITE_DIVIDIR_BYTES + 1)).toBe("dividir");
  });

  test("Dado os papéis Quando nomeio os agentes Então a rota grande ganha sufixo", () => {
    expect(nomeDoAgente("leitor", "padrao")).toBe("anvilore-leitor");
    expect(nomeDoAgente("escritor", "grande")).toBe("anvilore-escritor-grande");
  });
});

describe("papéis da ingestão: ferramentas por papel", () => {
  test("Dado o leitor Quando listo as ferramentas Então só lê", () => {
    expect(FERRAMENTAS.leitor).toEqual(["Read", "Grep", "Glob"]);
  });

  test("Dado o escritor Quando listo as ferramentas Então edita, mas não roda comando", () => {
    expect(FERRAMENTAS.escritor).toEqual(["Read", "Grep", "Glob", "Edit", "Write"]);
    expect(FERRAMENTAS.escritor).not.toContain("Bash");
  });
});

describe("papéis da ingestão: agentes do Claude Code gerados dos prompts", () => {
  test("Dado os prompts de skills/ingest Quando gero os agentes Então são quatro, com corpo igual ao prompt", async () => {
    const agentes = await agentesDaIngestao(raiz);
    expect(agentes.map(a => a.rel)).toEqual([
      ".claude/agents/anvilore-leitor.md",
      ".claude/agents/anvilore-escritor.md",
      ".claude/agents/anvilore-leitor-grande.md",
      ".claude/agents/anvilore-escritor-grande.md",
    ]);
    for (const agente of agentes) {
      const papel = agente.rel.includes("leitor") ? "leitor" : "escritor";
      expect(agente.conteudo.endsWith(prompt(papel))).toBe(true);
    }
  });

  test("Dado um agente gerado Quando leio o frontmatter Então traz nome, ferramentas do papel e modelo só na rota grande", async () => {
    const [leitor, escritor, leitorGrande] = await agentesDaIngestao(raiz);
    const fm = (texto: string) => lerFrontmatter(texto) as Record<string, unknown>;
    expect(fm(leitor!.conteudo)).toMatchObject({ name: "anvilore-leitor", tools: "Read, Grep, Glob" });
    expect(fm(leitor!.conteudo).model).toBeUndefined();
    expect(fm(escritor!.conteudo)).toMatchObject({ name: "anvilore-escritor", tools: "Read, Grep, Glob, Edit, Write" });
    expect(fm(leitorGrande!.conteudo)).toMatchObject({ name: "anvilore-leitor-grande", model: "sonnet[1m]" });
    expect(String(fm(leitor!.conteudo).description)).toContain("não escreve");
  });

  test("Dado um agente gerado Quando leio o corpo Então avisa que é gerado e não se edita à mão", async () => {
    const [leitor] = await agentesDaIngestao(raiz);
    expect(leitor!.conteudo).toContain("Gerado por `anvilore instalar` a partir de `skills/ingest/leitor.md`");
  });
});

describe("papéis da ingestão: conferência dos agentes instalados", () => {
  let destino: string;
  beforeEach(() => { destino = mkdtempSync(join(tmpdir(), "anvilore-agentes-")); });
  afterEach(() => rmSync(destino, { recursive: true, force: true }));

  async function gravarTodos() {
    for (const agente of await agentesDaIngestao(raiz)) {
      const caminho = join(destino, agente.rel);
      await Bun.write(caminho, agente.conteudo);
    }
  }

  test("Dado os quatro agentes iguais aos prompts Quando confiro Então não há problema", async () => {
    await gravarTodos();
    expect(await conferirAgentesDaIngestao(destino, raiz)).toEqual([]);
  });

  test("Dado um agente ausente e outro desatualizado Quando confiro Então aponta os dois", async () => {
    await gravarTodos();
    rmSync(join(destino, ".claude/agents/anvilore-escritor.md"));
    writeFileSync(join(destino, ".claude/agents/anvilore-leitor.md"), "velho");
    expect(await conferirAgentesDaIngestao(destino, raiz)).toEqual([
      ".claude/agents/anvilore-leitor.md desatualizado",
      ".claude/agents/anvilore-escritor.md não existe",
    ]);
  });
});

describe("papéis da ingestão: comando rota-ingestao", () => {
  let pasta: string;
  let consoleCapturado: ReturnType<typeof capturarConsole>;
  beforeEach(() => { pasta = mkdtempSync(join(tmpdir(), "anvilore-rota-")); consoleCapturado = capturarConsole(); });
  afterEach(() => { consoleCapturado.restaurar(); rmSync(pasta, { recursive: true, force: true }); });

  test("Dado fonte pequena Quando peço a rota Então indica os agentes padrão e sai 0", async () => {
    writeFileSync(join(pasta, "fonte.md"), "x".repeat(1_000));
    expect(await rotaDoArquivo(join(pasta, "fonte.md"))).toEqual({
      codigo: 0,
      mensagens: ["padrao: 1000 bytes; agentes anvilore-leitor e anvilore-escritor."],
    });
  });

  test("Dado fonte grande Quando peço a rota Então indica os agentes de janela grande", async () => {
    writeFileSync(join(pasta, "fonte.md"), "x".repeat(LIMITE_GRANDE_BYTES + 1));
    const r = await rotaDoArquivo(join(pasta, "fonte.md"));
    expect(r.codigo).toBe(0);
    expect(r.mensagens[0]).toStartWith("grande: 400001 bytes; agentes anvilore-leitor-grande e anvilore-escritor-grande");
  });

  test("Dado fonte que não cabe Quando peço a rota Então sai 3 e pede para combinar a divisão", async () => {
    writeFileSync(join(pasta, "fonte.md"), "x".repeat(LIMITE_DIVIDIR_BYTES + 1));
    const r = await rotaDoArquivo(join(pasta, "fonte.md"));
    expect(r.codigo).toBe(3);
    expect(r.mensagens[0]).toContain("dividir:");
  });

  test("Dado fonte inexistente ou uso errado Quando peço a rota Então sai 2", async () => {
    expect((await rotaDoArquivo(join(pasta, "sumiu.md"))).codigo).toBe(2);
    expect(await comandoRotaIngestao([])).toBe(2);
    expect(await comandoRotaIngestao(["--help"])).toBe(0);
    writeFileSync(join(pasta, "f.md"), "abc");
    expect(await comandoRotaIngestao([join(pasta, "f.md")])).toBe(0);
    expect(consoleCapturado.saida.join("\n")).toContain("padrao: 3 bytes");
  });
});
