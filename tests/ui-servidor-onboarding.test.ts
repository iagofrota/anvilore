import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fontesSemIngestao } from "../src/lib/ui-inicio";
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

function prepararAjusteInterrompido(pasta: string, id: string, conteudoAprovado: string, conteudoAtual: string): void {
  const caminho = "pessoal/minha-pagina.md";
  const pastaConversa = join(pasta, ".anvilore/ui/conversas");
  const pastaCopia = join(pasta, ".anvilore/ui/copias", id, "pessoal");
  mkdirSync(pastaConversa, { recursive: true });
  mkdirSync(pastaCopia, { recursive: true });
  writeFileSync(join(pasta, "wiki", caminho), conteudoAtual);
  writeFileSync(join(pastaCopia, "minha-pagina.md"), conteudoAprovado);
  writeFileSync(join(pastaConversa, `${id}.json`), JSON.stringify({
    versao: 1,
    id,
    criadaEm: "2026-11-06T20:00:00.000Z",
    atualizadaEm: "2026-11-06T20:00:00.000Z",
    tipo: "ajuste",
    pagina: caminho,
    versaoEsperada: createHash("sha256").update(conteudoAprovado).digest("hex"),
    pedido: "Ajustar a página",
    geracao: { by: "claude-haiku/2.1.311", at: "2026-11-06T20:00:00.000Z" },
    area: "pessoal",
    fonte: `wiki/${caminho}`,
    nome: "minha-pagina.md",
    bytes: Buffer.byteLength(conteudoAprovado),
    passo: "escrita",
    situacao: "rodando",
    atividade: [],
    avisos: [],
    recusas: [],
  }));
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

test("Dado onboarding.json ligado a raw Quando confirmo a pasta no O1 Então recusa e preserva os bytes brutos", async () => {
  mkdirSync(join(raiz, ".anvilore"), { recursive: true });
  const fonte = join(raiz, "raw/x.json");
  const bytes = Buffer.from("{\r\n  \"concluido\": false\n}\n");
  writeFileSync(fonte, bytes);
  symlinkSync(fonte, join(raiz, ".anvilore/onboarding.json"));

  const { chamar } = await servidor();
  const resp = await chamar("/api/onboarding/pasta", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pasta: raiz }),
  });
  expect(resp.status).toBe(400);
  const dados = await resp.json() as { erro: string };
  expect(dados.erro).toMatch(/onboarding|raw/i);
  expect(readFileSync(fonte)).toEqual(bytes);
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

test("Dado um ajuste interrompido no cofre escolhido em O1 Quando peço a fila pela primeira vez Então a página alterada já aparece como rascunho", async () => {
  const outroVault = mkdtempSync(join(homedir(), "anvilore-vault-ajuste-interrompido-"));
  mkdirSync(join(outroVault, "wiki/pessoal"), { recursive: true });
  mkdirSync(join(outroVault, "raw"), { recursive: true });
  writeFileSync(join(outroVault, "SCHEMA.md"), "# Schema\n");
  writeFileSync(join(outroVault, "AGENTS.md"), "# Agents\n");
  writeFileSync(join(outroVault, "wiki/index.md"), "# Índice\n");
  const aprovada = [
    "---", "type: concept", "slug: minha-pagina", "title: Minha página", "generated:",
    "  by: claude-opus/2026-10", "  at: 2026-11-04T20:00:00.000Z", "verified:",
    "  by: human:iago", "  at: 2030-01-01T00:00:00.000Z", "---", "", "Conteúdo aprovado.",
  ].join("\n");
  const alterada = aprovada.replace("Conteúdo aprovado.", "Conteúdo alterado durante o ajuste.");
  prepararAjusteInterrompido(outroVault, "ajuste-persistido", aprovada, alterada);

  try {
    const { chamar } = await servidor();
    const confirmar = await chamar("/api/onboarding/pasta", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pasta: outroVault }),
    });
    expect(confirmar.status).toBe(200);

    const filaResposta = await chamar("/api/rascunhos");
    expect(filaResposta.status).toBe(200);
    const fila = await filaResposta.json() as Array<{ caminho: string; status: string; aprovavel: boolean }>;
    expect(fila.find(item => item.caminho === "pessoal/minha-pagina.md")).toMatchObject({ status: "atualizada", aprovavel: true });
  } finally {
    rmSync(outroVault, { recursive: true, force: true });
  }
});

test("Dado um ajuste interrompido sem mudança de bytes no cofre escolhido em O1 Quando peço a fila pela primeira vez Então preserva a aprovação e os bytes", async () => {
  const outroVault = mkdtempSync(join(homedir(), "anvilore-vault-ajuste-sem-mudanca-"));
  mkdirSync(join(outroVault, "wiki/pessoal"), { recursive: true });
  mkdirSync(join(outroVault, "raw"), { recursive: true });
  writeFileSync(join(outroVault, "SCHEMA.md"), "# Schema\n");
  writeFileSync(join(outroVault, "AGENTS.md"), "# Agents\n");
  writeFileSync(join(outroVault, "wiki/index.md"), "# Índice\n");
  const aprovada = [
    "---", "type: concept", "slug: minha-pagina", "title: Minha página", "generated:",
    "  by: claude-opus/2026-10", "  at: 2026-11-04T20:00:00.000Z", "verified:",
    "  by: human:iago", "  at: 2030-01-01T00:00:00.000Z", "---", "", "Conteúdo aprovado.",
  ].join("\n");
  prepararAjusteInterrompido(outroVault, "ajuste-persistido-inalterado", aprovada, aprovada);

  try {
    const { chamar } = await servidor();
    const confirmar = await chamar("/api/onboarding/pasta", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pasta: outroVault }),
    });
    expect(confirmar.status).toBe(200);

    const filaResposta = await chamar("/api/rascunhos");
    expect(filaResposta.status).toBe(200);
    const fila = await filaResposta.json() as Array<{ caminho: string }>;
    expect(fila.some(item => item.caminho === "pessoal/minha-pagina.md")).toBe(false);
    expect(readFileSync(join(outroVault, "wiki/pessoal/minha-pagina.md"), "utf8")).toBe(aprovada);
  } finally {
    rmSync(outroVault, { recursive: true, force: true });
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

test("Dado onboarding.json ligado a raw Quando escolho áreas no O3 Então recusa e preserva os bytes brutos", async () => {
  mkdirSync(join(raiz, ".anvilore"), { recursive: true });
  const fonte = join(raiz, "raw/x.json");
  const bytes = Buffer.from("{\r\n  \"concluido\": false\n}\n");
  writeFileSync(fonte, bytes);
  symlinkSync(fonte, join(raiz, ".anvilore/onboarding.json"));

  const { chamar } = await servidor();
  const resp = await chamar("/api/onboarding/areas", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ areas: ["pessoal"] }),
  });
  expect(resp.status).toBe(400);
  const dados = await resp.json() as { erro: string };
  expect(dados.erro).toMatch(/onboarding|raw/i);
  expect(readFileSync(fonte)).toEqual(bytes);
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

test("Dado O3 com áreas criadas e onboarding em andamento Quando confirmo a pasta Então servidor devolve etapa 4 e precisaOnboarding true até concluir", async () => {
  const { chamar } = await servidor();
  // 1. O1 confirma a pasta inicialmente
  const respO1 = await chamar("/api/onboarding/pasta", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pasta: raiz }),
  });
  expect(respO1.status).toBe(200);

  // 2. O3 cria áreas
  const respAreas = await chamar("/api/onboarding/areas", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ areas: ["pessoal", "projetos"] }),
  });
  expect(respAreas.status).toBe(200);

  // 3. Confirma a pasta (como acontece ao recarregar e voltar ao O1)
  const respPasta = await chamar("/api/onboarding/pasta", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pasta: raiz }),
  });
  expect(respPasta.status).toBe(200);
  const dadosPasta = await respPasta.json() as Record<string, unknown>;
  expect(dadosPasta.precisaOnboarding).toBe(true);
  expect(dadosPasta.concluido).toBe(false);
  expect(dadosPasta.etapa).toBe(4);

  // 4. Conclui no O4
  const respConcluir = await chamar("/api/onboarding/concluir", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(respConcluir.status).toBe(200);

  // 5. Próxima leitura/confirmação relata concluído e sem onboarding pendente
  const respFinal = await chamar("/api/onboarding/pasta", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pasta: raiz }),
  });
  const dadosFinal = await respFinal.json() as Record<string, unknown>;
  expect(dadosFinal.precisaOnboarding).toBe(false);
  expect(dadosFinal.concluido).toBe(true);
});

function arquivosEm(base: string, prefixo = ""): string[] {
  const achados: string[] = [];
  for (const entrada of readdirSync(join(base, prefixo), { withFileTypes: true })) {
    const relativo = prefixo ? `${prefixo}/${entrada.name}` : entrada.name;
    if (entrada.isDirectory()) achados.push(...arquivosEm(base, relativo));
    else achados.push(relativo);
  }
  return achados.sort();
}

async function iniciarExemplo(chamar: (rota: string, init?: RequestInit) => Promise<Response>) {
  const resp = await chamar("/api/onboarding/ingerir-exemplo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ area: "pessoal" }),
  });
  return { resp, dados: await resp.json() as { ok: boolean; id: string } };
}

test("Dado o exemplo em raw/ Quando inicio a ingestão no O4 Então a conversa cita o original raw/exemplo/llm-wiki.md, raw/ não ganha arquivo e o Início oferece a conversa em vez de duplicar", async () => {
  writeFileSync(join(raiz, "raw/exemplo/llm-wiki.md"), "# LLM Wiki\nTexto de exemplo para ingestão.\n");
  mkdirSync(join(raiz, "wiki/pessoal"), { recursive: true });
  const antes = arquivosEm(join(raiz, "raw"));

  const { chamar } = await servidor();
  const { resp, dados } = await iniciarExemplo(chamar);
  expect(resp.status).toBe(201);

  const conversa = await (await chamar(`/api/conversas/${dados.id}`)).json() as { fonte: string; nome: string };
  expect(conversa.fonte).toBe("raw/exemplo/llm-wiki.md");
  expect(arquivosEm(join(raiz, "raw"))).toEqual(antes);

  const wiki = join(raiz, "wiki");
  const pendentes = await fontesSemIngestao(raiz, wiki, new Map([[conversa.fonte, dados.id]]));
  expect(pendentes.filter(f => f.caminho === "raw/exemplo/llm-wiki.md")).toEqual([
    { caminho: "raw/exemplo/llm-wiki.md", area: "exemplo", bytes: 44, conversa: dados.id },
  ]);

  // A ingestão concluída cita o original em sources[].resource: o exemplo sai da lista.
  writeFileSync(
    join(wiki, "pessoal/llm-wiki.md"),
    "---\ntitle: LLM Wiki\nsources:\n  - resource: raw/exemplo/llm-wiki.md\n---\n# LLM Wiki\n",
  );
  expect((await fontesSemIngestao(raiz, wiki)).map(f => f.caminho)).not.toContain("raw/exemplo/llm-wiki.md");
});

test("Dado o exemplo em raw/ Quando repito a tentativa no O4 Então nenhuma cópia com sufixo aparece em raw/", async () => {
  writeFileSync(join(raiz, "raw/exemplo/llm-wiki.md"), "# LLM Wiki\nTexto de exemplo para ingestão.\n");
  mkdirSync(join(raiz, "wiki/pessoal"), { recursive: true });
  const antes = arquivosEm(join(raiz, "raw"));

  const { chamar } = await servidor();
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const { resp, dados } = await iniciarExemplo(chamar);
    expect(resp.status).toBe(201);
    const conversa = await (await chamar(`/api/conversas/${dados.id}`)).json() as { fonte: string };
    expect(conversa.fonte).toBe("raw/exemplo/llm-wiki.md");
  }
  expect(arquivosEm(join(raiz, "raw"))).toEqual(antes);
});
