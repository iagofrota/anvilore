import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { iniciarServidorUi } from "../src/ui/servidor/servidor";
import { PonteFalsa } from "./apoio/ponte-falsa";

let raiz: string;
let servidores: Array<{ stop: (forcibly?: boolean) => void }> = [];

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "anvilore-ui-servidor-onboarding-"));
  mkdirSync(join(raiz, "wiki/exemplo"), { recursive: true });
  mkdirSync(join(raiz, "raw/exemplo"), { recursive: true });
  writeFileSync(join(raiz, "SCHEMA.md"), "# Schema\n");
  writeFileSync(join(raiz, "AGENTS.md"), "# Agents\n");
  writeFileSync(join(raiz, "wiki/index.md"), "# Índice\n");
});

afterEach(() => {
  for (const servidor of servidores) servidor.stop(true);
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
      fetch(`${base}${rota}?token=token-teste`, {
        ...init,
        headers: {
          origin: base,
          ...(init.headers as Record<string, string> | undefined),
        },
      }),
  };
}

test("Dado uma requisição para /api/onboarding sem token Quando chega ao servidor Então recebe 403", async () => {
  const { base } = await servidor();
  const resp = await fetch(`${base}/api/onboarding`);
  expect(resp.status).toBe(403);
});

test("Dado uma requisição para /api/onboarding com Host externo Quando chega ao servidor Então recebe 403", async () => {
  const { base } = await servidor();
  const resp = await fetch(`${base}/api/onboarding?token=token-teste`, {
    headers: { host: "externo.com" },
  });
  expect(resp.status).toBe(403);
});

test("Dado um POST para rotas de onboarding com origem divergente Quando chega ao servidor Então recebe 403", async () => {
  const { base } = await servidor();
  for (const subrota of ["/pasta", "/testar-agente", "/areas", "/concluir", "/ingerir-exemplo"]) {
    const resp = await fetch(`${base}/api/onboarding${subrota}?token=token-teste`, {
      method: "POST",
      headers: { origin: "http://malicioso.com" },
      body: JSON.stringify({}),
    });
    expect(resp.status).toBe(403);
  }
});

test("Dado primeira abertura sem wiki configurada Quando chamo GET /api/onboarding Então retorna precisaOnboarding true, travas do doctor e áreas padrão", async () => {
  const { chamar } = await servidor();
  const resp = await chamar("/api/onboarding");
  expect(resp.status).toBe(200);
  const dados = await resp.json() as Record<string, unknown>;
  expect(dados.precisaOnboarding).toBe(true);
  expect(dados.concluido).toBe(false);
  expect(dados.pasta).toBe(raiz);
  expect(dados.inspecao).toBeDefined();
  expect(dados.agente).toBeDefined();
  expect(dados.areas).toBeDefined();
  expect(dados.primeiraIngestao).toBeDefined();
});

test("Dado wiki já pronta Quando chamo GET /api/onboarding Então retorna precisaOnboarding false", async () => {
  mkdirSync(join(raiz, "wiki/pessoal/concepts"), { recursive: true });
  writeFileSync(join(raiz, "wiki/pessoal/index.md"), "# Pessoal\n");

  const { chamar } = await servidor();
  const resp = await chamar("/api/onboarding");
  expect(resp.status).toBe(200);
  const dados = await resp.json() as Record<string, unknown>;
  expect(dados.precisaOnboarding).toBe(false);
});

test("Dado pasta de vault válida no O1 Quando envio POST /api/onboarding/pasta Então valida contenção de caminho e retorna inspeção", async () => {
  const { chamar } = await servidor();
  const resp = await chamar("/api/onboarding/pasta", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pasta: raiz }),
  });
  expect(resp.status).toBe(200);
  const dados = await resp.json() as Record<string, unknown>;
  expect(dados.ok).toBe(true);
  expect(dados.inspecao).toBeDefined();
});

test("Dado pasta existente com conteúdo arbitrário Quando envio POST /api/onboarding/pasta Então recusa com erro", async () => {
  const pastaAlheia = join(raiz, "alheia");
  mkdirSync(pastaAlheia, { recursive: true });
  writeFileSync(join(pastaAlheia, "outro-projeto.js"), "console.log(1);");

  const { chamar } = await servidor();
  const resp = await chamar("/api/onboarding/pasta", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pasta: pastaAlheia }),
  });
  expect(resp.status).toBe(400);
  const dados = await resp.json() as Record<string, unknown>;
  expect(dados.erro).toBeDefined();
});

test("Dado pasta válida diferente da raiz inicial Quando envio POST /api/onboarding/pasta Então altera a raiz ativa e operações subsequentes usam a nova pasta", async () => {
  const outraPasta = mkdtempSync(join(tmpdir(), "anvilore-outro-vault-"));
  mkdirSync(join(outraPasta, "wiki"), { recursive: true });
  mkdirSync(join(outraPasta, "raw"), { recursive: true });
  writeFileSync(join(outraPasta, "SCHEMA.md"), "# Schema\n");
  writeFileSync(join(outraPasta, "AGENTS.md"), "# Agents\n");
  writeFileSync(join(outraPasta, "wiki/index.md"), "# Índice\n");

  try {
    const { chamar } = await servidor();
    const resp = await chamar("/api/onboarding/pasta", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pasta: outraPasta }),
    });
    expect(resp.status).toBe(200);
    const dados = await resp.json() as Record<string, unknown>;
    expect(dados.ok).toBe(true);
    expect(dados.pasta).toBe(outraPasta);

    const respGet = await chamar("/api/onboarding");
    const estado = await respGet.json() as Record<string, unknown>;
    expect(estado.pasta).toBe(outraPasta);

    const respAreas = await chamar("/api/onboarding/areas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ areas: ["nova-area"] }),
    });
    expect(respAreas.status).toBe(200);
    expect(existsSync(join(outraPasta, "wiki/nova-area"))).toBe(true);
    expect(existsSync(join(raiz, "wiki/nova-area"))).toBe(false);
  } finally {
    rmSync(outraPasta, { recursive: true, force: true });
  }
});

test("Dado o teste do agente no O2 Quando envio POST /api/onboarding/testar-agente Então verifica disponibilidade real sem pedir nem armazenar chave de API", async () => {
  const { chamar } = await servidor();
  const resp = await chamar("/api/onboarding/testar-agente", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(resp.status).toBe(200);
  const dados = await resp.json() as Record<string, unknown>;
  expect(dados.ok).toBe(true);
  expect(dados.mensagem).toBe("O Claude Code está disponível e conectado à sua conta.");
});

test("Dado AGENTS.md ausente Quando envio POST /api/onboarding/testar-agente Então recusa reportando que AGENTS.md não foi encontrado", async () => {
  rmSync(join(raiz, "AGENTS.md"), { force: true });
  const { chamar } = await servidor();
  const resp = await chamar("/api/onboarding/testar-agente", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(resp.status).toBe(200);
  const dados = await resp.json() as Record<string, unknown>;
  expect(dados.ok).toBe(false);
  expect(dados.mensagem).toContain("AGENTS.md não foi encontrado no vault");
});

test("Dado arquivo de exemplo presente Quando chamo POST /api/onboarding/ingerir-exemplo Então cria conversa, dispara leitura, conclui onboarding e devolve id", async () => {
  mkdirSync(join(raiz, "raw/exemplo"), { recursive: true });
  writeFileSync(join(raiz, "raw/exemplo/llm-wiki.md"), "# LLM Wiki\nTexto de exemplo para ingestão.\n");

  const { chamar } = await servidor();
  const resp = await chamar("/api/onboarding/ingerir-exemplo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "pessoal" }),
  });
  expect(resp.status).toBe(201);
  const dados = await resp.json() as { ok: boolean; id: string };
  expect(dados.ok).toBe(true);
  expect(dados.id).toBeDefined();

  // Verifica que onboarding foi concluído
  const estado = JSON.parse(readFileSync(join(raiz, ".anvilore/onboarding.json"), "utf8")) as Record<string, unknown>;
  expect(estado.concluido).toBe(true);
});

test("Dado arquivo de exemplo ausente Quando chamo POST /api/onboarding/ingerir-exemplo Então devolve 404", async () => {
  rmSync(join(raiz, "raw/exemplo"), { recursive: true, force: true });
  const { chamar } = await servidor();
  const resp = await chamar("/api/onboarding/ingerir-exemplo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(resp.status).toBe(404);
  const dados = await resp.json() as Record<string, unknown>;
  expect(dados.erro).toContain("não encontrado");
});

test("Dado escolha de áreas no O3 Quando envio POST /api/onboarding/areas Então inicializa áreas via init real e remove exemplo se solicitado", async () => {
  const { chamar } = await servidor();
  const resp = await chamar("/api/onboarding/areas", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ areas: ["pessoal", "saude"], removerExemplo: true }),
  });
  expect(resp.status).toBe(200);
  const dados = await resp.json() as Record<string, unknown>;
  expect(dados.ok).toBe(true);
  expect(dados.criadas).toBeDefined();
});

test("Dado agente indisponível Quando envio POST /api/onboarding/testar-agente Então devolve ok false com o motivo", async () => {
  class PonteIndisponivel extends PonteFalsa {
    override async disponibilidade() {
      return { ok: false as const, motivo: "Claude Code ausente no PATH." };
    }
  }
  const app = await iniciarServidorUi(raiz, {
    portaInicial: 0,
    token: "token-teste",
    abrirNavegador: false,
    ponte: new PonteIndisponivel(),
  });
  servidores.push(app.servidor);
  const base = `http://127.0.0.1:${app.porta}`;
  const resp = await fetch(`${base}/api/onboarding/testar-agente?token=token-teste`, {
    method: "POST",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(resp.status).toBe(200);
  const dados = await resp.json() as Record<string, unknown>;
  expect(dados.ok).toBe(false);
  expect(dados.mensagem).toContain("ausente");
});

test("Dado pedidos com dados inválidos para pasta ou áreas Quando chegam ao servidor Então retorna 400", async () => {
  const { chamar } = await servidor();
  const resp1 = await chamar("/api/onboarding/pasta", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pasta: 123 }),
  });
  expect(resp1.status).toBe(400);

  const resp2 = await chamar("/api/onboarding/areas", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ areas: [] }),
  });
  expect(resp2.status).toBe(400);

  const resp3 = await chamar("/api/onboarding/areas", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ areas: "nao-array" }),
  });
  expect(resp3.status).toBe(400);
});

test("Dado falha inesperada na ponte Quando envio POST /api/onboarding/testar-agente Então devolve ok false no catch", async () => {
  class PonteComExcecao extends PonteFalsa {
    override async disponibilidade(): Promise<any> {
      throw new Error("Falha catastrófica no processo.");
    }
  }
  const app = await iniciarServidorUi(raiz, {
    portaInicial: 0,
    token: "token-teste",
    abrirNavegador: false,
    ponte: new PonteComExcecao(),
  });
  servidores.push(app.servidor);
  const base = `http://127.0.0.1:${app.porta}`;
  const resp = await fetch(`${base}/api/onboarding/testar-agente?token=token-teste`, {
    method: "POST",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(resp.status).toBe(200);
  const dados = await resp.json() as Record<string, unknown>;
  expect(dados.ok).toBe(false);
  expect(dados.mensagem).toContain("catastrófica");
});

test("Dado nome de área inválido Quando envio POST /api/onboarding/areas Então retorna 400 com erro", async () => {
  const { chamar } = await servidor();
  const resp = await chamar("/api/onboarding/areas", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ areas: ["nome/com/barra"] }),
  });
  expect(resp.status).toBe(400);
  const dados = await resp.json() as Record<string, unknown>;
  expect(dados.erro).toContain("inválido");
});

test("Dado conclusão no O4 Quando envio POST /api/onboarding/concluir Então persiste estado em .anvilore/onboarding.json", async () => {
  const { chamar } = await servidor();
  const resp = await chamar("/api/onboarding/concluir", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(resp.status).toBe(200);
  const dados = await resp.json() as Record<string, unknown>;
  expect(dados.ok).toBe(true);
});
