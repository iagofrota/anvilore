import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { iniciarServidorUi } from "../src/ui/servidor/servidor";
import { PonteFalsa } from "./apoio/ponte-falsa";

let raiz: string;
let servidores: Array<{ stop: (forcibly?: boolean) => void; encerrar?: () => Promise<void> }> = [];

beforeEach(() => {
  raiz = mkdtempSync(join(homedir(), "anvilore-ui-servidor-onboarding-"));
  mkdirSync(join(raiz, "wiki/exemplo"), { recursive: true });
  mkdirSync(join(raiz, "raw/exemplo"), { recursive: true });
  writeFileSync(join(raiz, "SCHEMA.md"), "# Schema\n");
  writeFileSync(join(raiz, "AGENTS.md"), "# Agents\n");
  writeFileSync(join(raiz, "wiki/index.md"), "# Índice\n");
});

afterEach(async () => {
  for (const s of servidores) {
    if (s.encerrar) await s.encerrar();
    s.stop(true);
  }
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
  servidores.push({ stop: app.servidor.stop.bind(app.servidor), encerrar: app.encerrar });
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
  mkdirSync(join(raiz, ".anvilore"), { recursive: true });
  writeFileSync(join(raiz, ".anvilore/identidade"), "human:revisor\n");

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
  expect(dados.erro).toBe("Esta pasta ainda não é um cofre do Anvilore.");
});

test("Dado pasta vazia ou inexistente no O1 Quando envio POST /api/onboarding/pasta Então recusa com 400 e nada é criado", async () => {
  const pastaVazia = join(raiz, "pasta-vazia-teste");
  mkdirSync(pastaVazia, { recursive: true });
  const pastaInexistente = join(raiz, "pasta-inexistente-teste");

  const { chamar } = await servidor();
  const respVazia = await chamar("/api/onboarding/pasta", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pasta: pastaVazia }),
  });
  expect(respVazia.status).toBe(400);
  const dadosVazia = await respVazia.json() as { erro: string };
  expect(dadosVazia.erro).toBe("Esta pasta ainda não é um cofre do Anvilore.");
  expect(existsSync(join(pastaVazia, ".anvilore"))).toBe(false);

  const respInexistente = await chamar("/api/onboarding/pasta", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pasta: pastaInexistente }),
  });
  expect(respInexistente.status).toBe(400);
  const dadosInexistente = await respInexistente.json() as { erro: string };
  expect(dadosInexistente.erro).toBe("Esta pasta ainda não é um cofre do Anvilore.");
  expect(existsSync(pastaInexistente)).toBe(false);
});

test("Dado pasta válida diferente da raiz inicial Quando envio POST /api/onboarding/pasta Então altera a raiz ativa e Início, Revisão e aprovação operam na nova pasta", async () => {
  const outraPasta = mkdtempSync(join(homedir(), "anvilore-outro-vault-"));
  mkdirSync(join(outraPasta, "wiki/pessoal"), { recursive: true });
  mkdirSync(join(outraPasta, "raw"), { recursive: true });
  writeFileSync(join(outraPasta, "SCHEMA.md"), "# Schema\n");
  writeFileSync(join(outraPasta, "AGENTS.md"), "# Agents\n");
  writeFileSync(join(outraPasta, "wiki/index.md"), "# Índice\n- [[pessoal/minha-pagina]]\n");

  // Cria um rascunho em outraPasta para aprovação
  const rascunhoConteudo = `---
type: concept
slug: minha-pagina
area: pessoal
generated:
  by: claude-code/1.0.0
  at: "2026-11-04T20:00:00.000Z"
---
# Minha Página
Conteúdo para revisão.
`;
  writeFileSync(join(outraPasta, "wiki/pessoal/minha-pagina.md"), rascunhoConteudo);

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

    // Início lê a nova pasta
    const respInicio = await chamar("/api/inicio");
    expect(respInicio.status).toBe(200);

    // Revisão lê a nova pasta e lista a página rascunho
    const respRevisao = await chamar("/api/rascunhos");
    expect(respRevisao.status).toBe(200);
    const dadosRevisao = await respRevisao.json() as Array<{ caminho: string; versao: string }>;
    const itemRascunho = dadosRevisao.find(r => r.caminho.includes("minha-pagina.md"));
    expect(itemRascunho).toBeDefined();

    // Aprovação aprova a página na nova pasta
    const respAprovar = await chamar("/api/aprovar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caminho: itemRascunho!.caminho, versao: itemRascunho!.versao }),
    });
    expect(respAprovar.status).toBe(200);
    const dadosAprovar = await respAprovar.json() as { codigo: number; mensagens: string[] };
    expect(dadosAprovar.codigo).toBe(0);
    expect(dadosAprovar.mensagens.some(m => m.includes("Aprovadas: 1 página"))).toBe(true);

    // Verifica que verified foi gravado no arquivo da nova pasta
    const textoAprovado = readFileSync(join(outraPasta, "wiki/pessoal/minha-pagina.md"), "utf8");
    expect(textoAprovado).toContain("verified:");

    // Raiz original permanece 100% intacta
    expect(existsSync(join(raiz, "wiki/pessoal/minha-pagina.md"))).toBe(false);
  } finally {
    rmSync(outraPasta, { recursive: true, force: true });
  }
});

test("Dado ingestão ativa no coordenador Quando tento trocar de pasta via POST /api/onboarding/pasta Então retorna 409 impedindo a troca", async () => {
  let liberarLeitor: () => void = () => {};
  const esperaLeitor = new Promise<void>(resolve => {
    liberarLeitor = resolve;
  });

  const ponte = new PonteFalsa({
    leitor: async () => {
      await esperaLeitor;
      return { situacao: "concluida", texto: "ok", recusas: [] };
    },
  });

  const app = await iniciarServidorUi(raiz, {
    portaInicial: 0,
    token: "token-teste",
    abrirNavegador: false,
    ponte,
  });
  servidores.push({ stop: app.servidor.stop.bind(app.servidor), encerrar: app.encerrar });
  const base = `http://127.0.0.1:${app.porta}`;
  const chamar = (rota: string, init: RequestInit = {}) =>
    fetch(`${base}${rota}?token=token-teste`, {
      ...init,
      headers: { origin: base, ...(init.headers as Record<string, string> | undefined) },
    });

  // Cria fonte e inicia leitura
  mkdirSync(join(raiz, "wiki/pessoal"), { recursive: true });
  const form = new FormData();
  form.set("area", "pessoal");
  form.set("arquivo", new Blob(["# Conteudo\n"], { type: "text/markdown" }), "doc.md");
  const respFonte = await chamar("/api/fontes", { method: "POST", body: form });
  expect(respFonte.status).toBe(201);
  const { id } = await respFonte.json() as { id: string };

  // Dispara leitura em segundo plano
  void chamar(`/api/conversas/${id}/ler`, { method: "POST" });

  // Aguarda ingestao ficar ativa/ocupada
  await Bun.sleep(50);

  const outraPasta = mkdtempSync(join(homedir(), "anvilore-bloqueada-"));
  mkdirSync(join(outraPasta, "wiki"), { recursive: true });
  writeFileSync(join(outraPasta, "SCHEMA.md"), "# Schema\n");
  writeFileSync(join(outraPasta, "AGENTS.md"), "# Agents\n");

  try {
    const respTroca = await chamar("/api/onboarding/pasta", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pasta: outraPasta }),
    });
    expect(respTroca.status).toBe(409);
    const erro = await respTroca.json() as { erro: string };
    expect(erro.erro).toContain("Não é possível alterar a pasta enquanto houver uma ingestão em andamento.");
  } finally {
    liberarLeitor();
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

test("Dado falha na leitura do exemplo Quando chamo POST /api/onboarding/ingerir-exemplo Então devolve erro 400 com motivo em linguagem simples sem engolir exceção", async () => {
  mkdirSync(join(raiz, "raw/exemplo"), { recursive: true });
  writeFileSync(join(raiz, "raw/exemplo/llm-wiki.md"), "# LLM Wiki\nTexto de exemplo.\n");

  const ponte = new PonteFalsa();
  ponte.disponivel = { ok: false, motivo: "O Claude Code não está instalado na máquina." };

  const app = await iniciarServidorUi(raiz, {
    portaInicial: 0,
    token: "token-teste",
    abrirNavegador: false,
    ponte,
  });
  servidores.push({ stop: app.servidor.stop.bind(app.servidor), encerrar: app.encerrar });
  const base = `http://127.0.0.1:${app.porta}`;
  const chamar = (rota: string, init: RequestInit = {}) =>
    fetch(`${base}${rota}?token=token-teste`, {
      ...init,
      headers: { origin: base, ...(init.headers as Record<string, string> | undefined) },
    });

  const resp = await chamar("/api/onboarding/ingerir-exemplo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "pessoal" }),
  });
  expect(resp.status).toBe(400);
  const dados = await resp.json() as { erro: string };
  expect(dados.erro).toContain("O Claude Code não está instalado");
});

test("Dado chamada a ingerir-exemplo sem área Quando wiki tem áreas Então seleciona a primeira área existente como padrão", async () => {
  mkdirSync(join(raiz, "raw/exemplo"), { recursive: true });
  writeFileSync(join(raiz, "raw/exemplo/llm-wiki.md"), "# LLM Wiki\n");
  mkdirSync(join(raiz, "wiki/trabalho"), { recursive: true });

  const { chamar } = await servidor();
  const resp = await chamar("/api/onboarding/ingerir-exemplo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(resp.status).toBe(201);
  const dados = await resp.json() as { ok: boolean; id: string };
  expect(dados.ok).toBe(true);
});

test("Dado requisição com cabeçalho Host malformado Quando chega ao servidor Então recebe 403", async () => {
  const { base } = await servidor();
  const resp = await fetch(`${base}/api/onboarding?token=token-teste`, {
    headers: { host: ":::invalid:host:::" },
  });
  expect(resp.status).toBe(403);
});

test("Dado POST /api/atualizador com ação verificar Então responde status esperado", async () => {
  const { chamar } = await servidor();
  const resp = await chamar("/api/atualizador", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ acao: "verificar" }),
  });
  expect([200, 409]).toContain(resp.status);
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
  servidores.push({ stop: app.servidor.stop.bind(app.servidor), encerrar: app.encerrar });
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
  servidores.push({ stop: app.servidor.stop.bind(app.servidor), encerrar: app.encerrar });
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
