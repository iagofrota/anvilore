import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { iniciarServidorUi } from "../src/ui/servidor/servidor";
import { PonteFalsa } from "./apoio/ponte-falsa";

let raiz: string;
let servidores: Array<{ stop: (forcibly?: boolean) => void }> = [];

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "anvilore-ui-servidor-biblioteca-"));
  for (const dir of ["wiki/pessoal/conceitos", "wiki/log", "raw/pessoal"]) {
    mkdirSync(join(raiz, dir), { recursive: true });
  }
  writeFileSync(join(raiz, "wiki/index.md"), "# Índice\n");
});

afterEach(() => {
  for (const s of servidores) s.stop(true);
  servidores = [];
  rmSync(raiz, { recursive: true, force: true });
});

async function servidor() {
  const app = await iniciarServidorUi(raiz, {
    portaInicial: 0,
    token: "token-teste",
    abrirNavegador: false,
    ponte: new PonteFalsa(),
  });
  servidores.push(app.servidor);
  const base = `http://127.0.0.1:${app.porta}`;
  return {
    base,
    chamar: (rota: string, init: RequestInit = {}) =>
      fetch(`${base}${rota}${rota.includes("?") ? "&" : "?"}token=token-teste`, {
        ...init,
        headers: { origin: base, ...(init.headers as Record<string, string> | undefined) },
      }),
  };
}

test("Dado pedido sem token ou com Host externo Quando peço Biblioteca ou Nota Então recebo 403", async () => {
  const { base } = await servidor();
  for (const rota of ["/api/biblioteca", "/api/nota?caminho=teste.md"]) {
    expect((await fetch(`${base}${rota}`)).status).toBe(403);
    expect(
      (await fetch(`${base}${rota}&token=token-teste`, { headers: { host: "externo.com" } })).status,
    ).toBe(403);
  }
});

test("Dado pedido de Biblioteca com método não permitido Então recebo 404", async () => {
  const { chamar } = await servidor();
  const res = await chamar("/api/biblioteca", { method: "POST" });
  expect(res.status).toBe(404);
});

test("Dado páginas na wiki Quando consulto /api/biblioteca Então retorna lista e totais", async () => {
  writeFileSync(
    join(raiz, "wiki/pessoal/conceitos/padrao-llm.md"),
    `---
title: Padrão LLM
type: conceito
tags: [ia]
---
# Padrão LLM
`,
  );
  const { chamar } = await servidor();
  const resposta = await chamar("/api/biblioteca");
  expect(resposta.status).toBe(200);
  const corpo = await resposta.json() as Record<string, unknown>;
  expect(corpo).toHaveProperty("paginas");
  expect(corpo).toHaveProperty("totais");
  expect(corpo).toHaveProperty("tipos");
  expect((corpo.paginas as unknown[]).length).toBe(1);
});

test("Dado pedidos de /api/nota com caminhos inválidos ou inseguros Então a API recusa com 400 ou 404", async () => {
  const { chamar } = await servidor();

  // Sem parâmetro caminho
  expect((await chamar("/api/nota")).status).toBe(400);

  // Path traversal
  expect((await chamar("/api/nota?caminho=../fora.md")).status).toBe(400);
  expect((await chamar("/api/nota?caminho=pessoal/../../fora.md")).status).toBe(400);

  // Caminho absoluto
  expect((await chamar("/api/nota?caminho=/etc/passwd")).status).toBe(400);

  // Página inexistente
  expect((await chamar("/api/nota?caminho=inexistente.md")).status).toBe(404);
});

test("Dado uma página válida Quando peço /api/nota Então retorna todos os detalhes", async () => {
  writeFileSync(
    join(raiz, "wiki/pessoal/conceitos/padrao-llm.md"),
    `---
title: Padrão LLM
type: conceito
area: pessoal
tags: [ia, llm]
generated:
  by: claude/3.5
  at: 2026-10-27T10:00:00Z
---
# Padrão LLM
Veja [[rag]].

> [!gap]
> Falta detalhe sobre escalabilidade.
`,
  );
  writeFileSync(
    join(raiz, "wiki/pessoal/conceitos/rag.md"),
    `---
title: RAG
type: conceito
---
# RAG
Citado por [[padrao-llm]].
`,
  );

  const { chamar } = await servidor();
  const resposta = await chamar("/api/nota?caminho=pessoal/conceitos/padrao-llm.md");
  expect(resposta.status).toBe(200);

  const nota = await resposta.json() as Record<string, unknown>;
  expect(nota.titulo).toBe("Padrão LLM");
  expect(nota.slug).toBe("padrao-llm");
  expect(nota.status).toBe("rascunho");
  expect(nota.aprovavel).toBe(true);
  expect((nota.lacunas as unknown[]).length).toBe(1);
  expect((nota.backlinks as unknown[]).length).toBe(1);
  expect(nota).toHaveProperty("grafoLocal");
});

test("Dado a wiki e raw com conteúdo Quando consulto Biblioteca e Nota Então wiki e raw ficam byte a byte inalterados", async () => {
  const caminhoNota = join(raiz, "wiki/pessoal/conceitos/padrao-llm.md");
  const caminhoRaw = join(raiz, "raw/pessoal/fonte.md");
  writeFileSync(caminhoNota, "---\ntitle: Padrão LLM\n---\n# Padrão\n");
  writeFileSync(caminhoRaw, "conteudo original da fonte\n");

  const antesNota = readFileSync(caminhoNota);
  const antesRaw = readFileSync(caminhoRaw);

  const { chamar } = await servidor();
  await chamar("/api/biblioteca");
  await chamar("/api/nota?caminho=pessoal/conceitos/padrao-llm.md");

  const depoisNota = readFileSync(caminhoNota);
  const depoisRaw = readFileSync(caminhoRaw);

  expect(Buffer.compare(antesNota, depoisNota)).toBe(0);
  expect(Buffer.compare(antesRaw, depoisRaw)).toBe(0);
});

