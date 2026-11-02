import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import * as arquivos from "node:fs/promises";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { iniciarServidorUi } from "../src/ui/servidor/servidor";
import { FONTE, relatorioValido, SESSAO } from "./apoio/ingestao-exemplo";
import { PonteFalsa } from "./apoio/ponte-falsa";

let raiz: string;
let servidores: Array<{ stop: (forcibly?: boolean) => void }> = [];
beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "anvilore-ui-ingestao-"));
  for (const dir of ["wiki/pessoal/sources", "wiki/pessoal/concepts", "wiki/trabalho/sources"]) mkdirSync(join(raiz, dir), { recursive: true });
  writeFileSync(join(raiz, "wiki/pessoal/concepts/segundo-cerebro.md"), "---\ntitle: Segundo cérebro\n---\nTexto.\n");
});
afterEach(() => { for (const servidor of servidores) servidor.stop(true); servidores = []; rmSync(raiz, { recursive: true, force: true }); });

async function servidor(ponte = new PonteFalsa()) {
  const app = await iniciarServidorUi(raiz, { portaInicial: 0, token: "token-teste", abrirNavegador: false, ponte, fechar: async () => ({ codigo: 0, saida: "FECHAMENTO: OK" }) });
  servidores.push(app.servidor);
  const base = `http://127.0.0.1:${app.porta}`;
  const chamar = (rota: string, init: RequestInit = {}, token = "token-teste") => fetch(`${base}${rota}?token=${token}`, {
    ...init, headers: { origin: base, ...(init.headers as Record<string, string> | undefined) },
  });
  const postar = (rota: string, corpo?: unknown) => chamar(rota, { method: "POST", ...(corpo === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) }) });
  return { app, base, chamar, postar };
}

function formulario(campos: Record<string, string | Blob>, nome?: string): FormData {
  const dados = new FormData();
  for (const [chave, valor] of Object.entries(campos)) {
    if (valor instanceof Blob) dados.append(chave, valor, nome);
    else dados.append(chave, valor);
  }
  return dados;
}

test("Dado que a gravação da parada falha Quando a UI consulta Então a API responde erro explícito em vez de rodando", async () => {
  const liberar = Promise.withResolvers<void>();
  const falhou = Promise.withResolvers<void>();
  const ponte = new PonteFalsa({ leitor: async () => {
    await liberar.promise;
    return { situacao: "concluida", sessao: SESSAO, saidaEstruturada: relatorioValido(), texto: "", recusas: [] };
  } });
  const { chamar, postar, app } = await servidor(ponte);
  const criada = await (await chamar("/api/fontes", { method: "POST", body: formulario({ area: "pessoal", arquivo: new Blob([FONTE]) }, "llm-wiki.md") })).json() as { id: string };
  const arquivo = join(raiz, ".anvilore/ui/conversas", `${criada.id}.json`);
  const rename = arquivos.rename;
  const gravacao = spyOn(arquivos, "rename").mockImplementation(async (de, para) => {
    if (para === arquivo && JSON.parse(readFileSync(de, "utf8")).situacao === "esperando") {
      falhou.resolve();
      throw new Error("ENOSPC simulado");
    }
    return rename(de, para);
  });
  try {
    expect((await postar(`/api/conversas/${criada.id}/ler`)).status).toBe(200);
    liberar.resolve();
    await falhou.promise;
    for (const rota of [`/api/conversas/${criada.id}`, "/api/ingestao", "/api/inicio"]) {
      const resposta = await chamar(rota);
      expect(resposta.status).toBe(500);
      expect(await resposta.json()).toEqual({ mensagens: [expect.stringContaining("Não foi possível salvar a ingestão")] });
    }
    expect(JSON.parse(readFileSync(arquivo, "utf8"))).toMatchObject({ passo: "leitura", situacao: "rodando" });
  } finally {
    liberar.resolve();
    await app.encerrar();
    gravacao.mockRestore();
  }
});

test("Dado a interface aberta Quando peço o estado da ingestão Então vêm o agente, as áreas e as conversas", async () => {
  const { chamar } = await servidor();
  const resposta = await chamar("/api/ingestao");
  expect(resposta.status).toBe(200);
  expect(await resposta.json()).toEqual({ agente: "Agente falso", areas: ["pessoal", "trabalho"], conversas: [], atualizador: null });
});

test("Dado uma atualização recente Quando a interface lê o estado Então mostra a versão, o resumo e a opção de voltar", async () => {
  mkdirSync(join(raiz, ".anvilore"), { recursive: true });
  writeFileSync(join(raiz, ".anvilore/atualizacao.json"), JSON.stringify({
    versao: 1, modo: "automatico", canal: "estavel", estado: "ocioso", versaoInstalada: "0.3.1",
    atualizadoEm: new Date().toISOString(),
    ultima: { id: "1-aabbccdd00", de: { versao: "0.3.0", commit: "a".repeat(40) }, para: { versao: "0.3.1", commit: "b".repeat(40) } },
  }));
  writeFileSync(join(raiz, "CHANGELOG.md"), "## [0.3.1]\n\n- Melhora atualização e reversão.\n- Mantém configurações.\n\n## [0.3.0]\n");
  const { chamar } = await servidor();
  const estado = await (await chamar("/api/ingestao")).json() as { atualizador: Record<string, unknown> };
  expect(estado.atualizador).toMatchObject({ estado: "ocioso", versaoInstalada: "0.3.1", podeVoltar: true, mudancas: ["Melhora atualização e reversão.", "Mantém configurações."] });
});

test("Dado uma reversão em que raw/ mudou Quando a interface lê o estado Então mostra o alerta e não oferece voltar", async () => {
  mkdirSync(join(raiz, ".anvilore"), { recursive: true });
  writeFileSync(join(raiz, ".anvilore/atualizacao.json"), JSON.stringify({
    versao: 1, modo: "automatico", canal: "estavel", estado: "ocioso", versaoInstalada: "0.3.0",
    alerta: "ATENÇÃO: raw/ ou wiki/ mudaram durante a atualização e o atualizador não os restaura (raw/a.md mudou).", erro: "prova: o doctor ficou pior",
  }));
  const { chamar } = await servidor();
  const estado = await (await chamar("/api/ingestao")).json() as { atualizador: Record<string, unknown> };
  expect(estado.atualizador).toMatchObject({ podeVoltar: false });
  expect(String(estado.atualizador.erro)).toContain("raw/a.md mudou");
  expect(String(estado.atualizador.erro)).toContain("o doctor ficou pior");
});

test("Dado ação inválida Quando a interface chama o atualizador Então rejeita o pedido", async () => {
  const { postar } = await servidor();
  const resposta = await postar("/api/atualizador", { acao: "desconhecida" });
  expect(resposta.status).toBe(400);
  expect(await resposta.json()).toEqual({ mensagens: ["Ação do atualizador inválida."] });
});

test("Dado um arquivo solto com a área pessoal Quando envio Então o servidor grava em raw/pessoal e devolve a conversa", async () => {
  const { chamar } = await servidor();
  const resposta = await chamar("/api/fontes", { method: "POST", body: formulario({ area: "pessoal", arquivo: new Blob([FONTE]) }, "llm-wiki.md") });
  expect(resposta.status).toBe(201);
  expect(await resposta.json()).toMatchObject({ fonte: "raw/pessoal/llm-wiki.md", passo: "fonte" });
  expect(readFileSync(join(raiz, "raw/pessoal/llm-wiki.md"), "utf8")).toBe(FONTE);
  const repetido = await (await chamar("/api/fontes", { method: "POST", body: formulario({ area: "pessoal", arquivo: new Blob(["outro"]) }, "llm-wiki.md") })).json() as { fonte: string };
  expect(repetido.fonte).toBe("raw/pessoal/llm-wiki-2.md");
  expect(readFileSync(join(raiz, "raw/pessoal/llm-wiki.md"), "utf8")).toBe(FONTE);
});

test("Dado texto colado Quando envio Então vira um .md em raw/<área>", async () => {
  const { chamar } = await servidor();
  const colado = await (await chamar("/api/fontes", { method: "POST", body: formulario({ area: "trabalho", texto: "Ata da reunião.", nome: "ata" }) })).json() as { fonte: string };
  expect(colado.fonte).toBe("raw/trabalho/ata.md");
  const semNome = await (await chamar("/api/fontes", { method: "POST", body: formulario({ area: "trabalho", texto: "Outro texto." }) })).json() as { fonte: string };
  expect(semNome.fonte).toMatch(/^raw\/trabalho\/texto-colado-\d{8}-\d{6}\.md$/);
});

test("[C13] Dado texto colado cujo FormData transporta quebras como CRLF Quando envio Então a fonte é gravada com LF", async () => {
  const { chamar } = await servidor();
  const colado = await (await chamar("/api/fontes", { method: "POST", body: formulario({ area: "pessoal", texto: "linha 1\nlinha 2\n\nfim\n", nome: "ata" }) })).json() as { fonte: string };
  expect(new Uint8Array(readFileSync(join(raiz, colado.fonte)))).toEqual(new TextEncoder().encode("linha 1\nlinha 2\n\nfim\n"));
});

test("[C11] Dado arquivo com CRLF, CR solto e bytes que não são UTF-8 Quando envio Então o arquivo é gravado byte a byte", async () => {
  const { chamar } = await servidor();
  const bytes = new Uint8Array([0x23, 0x20, 0x41, 0x0d, 0x0a, 0x42, 0x0d, 0x43, 0xff, 0xfe, 0x00, 0x0d, 0x0a]);
  const enviado = await (await chamar("/api/fontes", { method: "POST", body: formulario({ area: "pessoal", arquivo: new Blob([bytes]) }, "windows.md") })).json() as { fonte: string };
  expect(enviado.fonte).toBe("raw/pessoal/windows.md");
  expect(new Uint8Array(readFileSync(join(raiz, enviado.fonte)))).toEqual(bytes);
});

test("[C14.a–d] Dado envio sem token, sem origem, com área inválida, vazio ou grande demais Quando chega Então recuso sem gravar em raw/", async () => {
  const { chamar, base } = await servidor();
  expect((await chamar("/api/fontes", { method: "POST", body: formulario({ area: "pessoal", texto: "x" }) }, "errado")).status).toBe(403);
  expect((await fetch(`${base}/api/fontes?token=token-teste`, { method: "POST", body: formulario({ area: "pessoal", texto: "x" }) })).status).toBe(403);
  const invalida = await chamar("/api/fontes", { method: "POST", body: formulario({ area: "../fora", texto: "x" }) });
  expect(invalida.status).toBe(400);
  expect(await invalida.json()).toEqual({ mensagens: ["Escolha uma área da wiki: pessoal, trabalho."] });
  expect((await chamar("/api/fontes", { method: "POST", body: formulario({ area: "pessoal" }) })).status).toBe(400);
  expect((await chamar("/api/fontes", { method: "POST", body: "não é formulário" })).status).toBe(400);
  const grande = await chamar("/api/fontes", { method: "POST", body: formulario({ area: "pessoal", arquivo: new Blob([new Uint8Array(32 * 1024 * 1024 + 1)]) }, "g.bin") });
  expect(grande.status).toBe(413);
  expect(existsSync(join(raiz, "raw"))).toBe(false);
});

test("Dado uma fonte em raw/ Quando aperto Ingerir, decido na parada e sigo Então o servidor conduz as fases até a Revisão", async () => {
  const ponte = new PonteFalsa({
    leitor: async (_pedido, aoEvento) => {
      aoEvento({ tipo: "inicio", sessao: SESSAO, autor: "claude-opus-5-5/2.1.311" });
      return { situacao: "concluida", sessao: SESSAO, saidaEstruturada: relatorioValido(), texto: "", recusas: [] };
    },
  });
  const { chamar, postar } = await servidor(ponte);
  const criada = await (await chamar("/api/fontes", { method: "POST", body: formulario({ area: "pessoal", arquivo: new Blob([FONTE]) }, "llm-wiki.md") })).json() as { id: string };
  const lendo = await postar(`/api/conversas/${criada.id}/ler`);
  expect(lendo.status).toBe(200);
  expect(await lendo.json()).toMatchObject({ passo: "leitura" });
  let conversa: { passo: string; situacao: string } = { passo: "", situacao: "" };
  for (let i = 0; i < 200 && conversa.passo !== "parada"; i++) { await Bun.sleep(25); conversa = await (await chamar(`/api/conversas/${criada.id}`)).json() as typeof conversa; }
  expect(conversa).toMatchObject({ passo: "parada", situacao: "esperando" });
  expect((await postar(`/api/conversas/${criada.id}/seguir`, { takeaways: [], paginas: [0], comentario: "" })).status).toBe(400);
  const seguindo = await postar(`/api/conversas/${criada.id}/seguir`, { takeaways: [0, 1, 2], paginas: [0, 1], comentario: "ok" });
  expect(seguindo.status).toBe(200);
  for (let i = 0; i < 200 && conversa.passo !== "revisao"; i++) { await Bun.sleep(25); conversa = await (await chamar(`/api/conversas/${criada.id}`)).json() as typeof conversa; }
  expect(conversa).toMatchObject({ passo: "revisao", situacao: "concluida" });
  expect(ponte.pedidos.map(p => p.papel)).toEqual(["leitor", "escritor"]);
  const estado = await (await chamar("/api/ingestao")).json() as { conversas: Array<{ id: string }> };
  expect(estado.conversas.map(c => c.id)).toEqual([criada.id]);
});

test("Dado o Claude Code indisponível Quando aperto Ingerir Então recebo 503 com o motivo e nada começa", async () => {
  const ponte = new PonteFalsa();
  ponte.disponivel = { ok: false, motivo: "O Claude Code não foi encontrado neste computador." };
  const { chamar, postar } = await servidor(ponte);
  const criada = await (await chamar("/api/fontes", { method: "POST", body: formulario({ area: "pessoal", texto: "x" }) })).json() as { id: string };
  const resposta = await postar(`/api/conversas/${criada.id}/ler`);
  expect(resposta.status).toBe(503);
  expect(await resposta.json()).toEqual({ mensagens: ["O Claude Code não foi encontrado neste computador."] });
  expect(ponte.pedidos).toEqual([]);
});

test("Dado o agente rodando Quando aperto Cancelar Então a ponte cancela", async () => {
  const ponte = new PonteFalsa({ leitor: async (_p, _e, cancelamento) => { await cancelamento; return { situacao: "cancelada", recusas: [] }; } });
  const { chamar, postar } = await servidor(ponte);
  const criada = await (await chamar("/api/fontes", { method: "POST", body: formulario({ area: "pessoal", texto: FONTE }) })).json() as { id: string };
  await postar(`/api/conversas/${criada.id}/ler`);
  expect((await postar(`/api/conversas/${criada.id}/cancelar`)).status).toBe(200);
  let conversa = { situacao: "" };
  for (let i = 0; i < 200 && conversa.situacao !== "cancelada"; i++) { await Bun.sleep(25); conversa = await (await chamar(`/api/conversas/${criada.id}`)).json() as typeof conversa; }
  expect(conversa.situacao).toBe("cancelada");
  expect(ponte.cancelamentos).toBe(1);
  expect((await postar(`/api/conversas/${criada.id}/cancelar`)).status).toBe(409);
});

test("[C25.a–d] Dado ids desconhecidos, métodos errados ou corpo inválido Quando chamo Então recebo o erro certo", async () => {
  const { chamar, postar } = await servidor();
  expect((await chamar("/api/conversas/nao-existe")).status).toBe(404);
  expect((await chamar("/api/conversas/..%2f..%2fetc")).status).toBe(404);
  expect((await postar("/api/conversas/nao-existe/ler")).status).toBe(404);
  expect((await chamar("/api/conversas/nao-existe/ler")).status).toBe(404);
  const criada = await (await chamar("/api/fontes", { method: "POST", body: formulario({ area: "pessoal", texto: "x" }) })).json() as { id: string };
  const invalido = await chamar(`/api/conversas/${criada.id}/seguir`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
  expect(invalido.status).toBe(400);
  expect(readdirSync(join(raiz, "raw/pessoal"))).toHaveLength(1);
});

// --- Endpoint POST /api/conversas/de-raw ---------------------------------------------------------------------

test("Dado arquivo existente em raw/ Quando POST /api/conversas/de-raw Então cria conversa com status 201 e reaproveita pipeline", async () => {
  const { postar, chamar } = await servidor();
  mkdirSync(join(raiz, "raw/pessoal"), { recursive: true });
  const conteudo = "# Documento existente\nLinha 1\n";
  writeFileSync(join(raiz, "raw/pessoal/existente.md"), conteudo);

  const hashAntes = createHash("sha256").update(readFileSync(join(raiz, "raw/pessoal/existente.md"))).digest("hex");

  const resposta = await postar("/api/conversas/de-raw", { caminho: "raw/pessoal/existente.md" });
  expect(resposta.status).toBe(201);
  const conversa = await resposta.json() as { id: string; fonte: string; area: string; passo: string; situacao: string };
  expect(conversa).toMatchObject({
    fonte: "raw/pessoal/existente.md",
    area: "pessoal",
    passo: "fonte",
    situacao: "pronta",
  });

  const hashDepois = createHash("sha256").update(readFileSync(join(raiz, "raw/pessoal/existente.md"))).digest("hex");
  expect(hashDepois).toBe(hashAntes);

  const obtida = await (await chamar(`/api/conversas/${conversa.id}`)).json() as typeof conversa;
  expect(obtida.id).toBe(conversa.id);
});

test("Dado requisição sem token, sem Origin ou com Host externo Quando POST /api/conversas/de-raw Então 403", async () => {
  const { chamar, base } = await servidor();
  mkdirSync(join(raiz, "raw/pessoal"), { recursive: true });
  writeFileSync(join(raiz, "raw/pessoal/existente.md"), "ok");

  // Sem token
  const semToken = await fetch(`${base}/api/conversas/de-raw`, {
    method: "POST",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ caminho: "raw/pessoal/existente.md" }),
  });
  expect(semToken.status).toBe(403);

  // Sem Origin
  const semOrigin = await fetch(`${base}/api/conversas/de-raw?token=token-teste`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ caminho: "raw/pessoal/existente.md" }),
  });
  expect(semOrigin.status).toBe(403);

  // Host externo
  const hostExterno = await fetch(`${base}/api/conversas/de-raw?token=token-teste`, {
    method: "POST",
    headers: { host: "externo.test", origin: base, "content-type": "application/json" },
    body: JSON.stringify({ caminho: "raw/pessoal/existente.md" }),
  });
  expect(hostExterno.status).toBe(403);
});

test("Dado corpo inválido ou caminho ausente Quando POST /api/conversas/de-raw Então 400", async () => {
  const { postar, chamar } = await servidor();
  expect((await postar("/api/conversas/de-raw", {})).status).toBe(400);
  expect((await postar("/api/conversas/de-raw", { caminho: "" })).status).toBe(400);
  expect((await postar("/api/conversas/de-raw", { caminho: 123 })).status).toBe(400);
  const invalido = await chamar("/api/conversas/de-raw", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "não-é-json",
  });
  expect(invalido.status).toBe(400);
});

test("Dado caminho com .., absoluto ou symlink para fora Quando POST /api/conversas/de-raw Então 400", async () => {
  const { postar } = await servidor();
  mkdirSync(join(raiz, "raw/pessoal"), { recursive: true });
  writeFileSync(join(raiz, "externo.txt"), "fora");
  symlinkSync(join(raiz, "externo.txt"), join(raiz, "raw/pessoal/link-externo.md"));

  expect((await postar("/api/conversas/de-raw", { caminho: "../externo.txt" })).status).toBe(400);
  expect((await postar("/api/conversas/de-raw", { caminho: "/etc/passwd" })).status).toBe(400);
  expect((await postar("/api/conversas/de-raw", { caminho: "raw/pessoal/link-externo.md" })).status).toBe(400);
  expect((await postar("/api/conversas/de-raw", { caminho: "raw/pessoal" })).status).toBe(400);
});

test("Dado arquivo inexistente em raw/ Quando POST /api/conversas/de-raw Então 404", async () => {
  const { postar } = await servidor();
  const res = await postar("/api/conversas/de-raw", { caminho: "raw/pessoal/nao-existe.md" });
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ mensagens: ["Arquivo inexistente em raw/."] });
});

test("Dado arquivo já citado por página na wiki Quando POST /api/conversas/de-raw Então 409", async () => {
  const { postar } = await servidor();
  mkdirSync(join(raiz, "raw/pessoal"), { recursive: true });
  writeFileSync(join(raiz, "raw/pessoal/ingerida.md"), "conteudo");
  writeFileSync(
    join(raiz, "wiki/pessoal/concepts/nota.md"),
    "---\ntitle: Nota\ntype: concept\nsources:\n  - resource: raw/pessoal/ingerida.md\n---\nCorpo.\n",
  );

  const res = await postar("/api/conversas/de-raw", { caminho: "raw/pessoal/ingerida.md" });
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ mensagens: ["O arquivo já foi ingerido na wiki."] });
});

test("Dado conversa criada de-raw Quando inicio a leitura com a ponte Então conduz normalmente a leitura", async () => {
  const ponte = new PonteFalsa({
    leitor: async (_pedido, aoEvento) => {
      aoEvento({ tipo: "inicio", sessao: SESSAO, autor: "claude-opus-5-5/2.1.311" });
      return { situacao: "concluida", sessao: SESSAO, saidaEstruturada: relatorioValido(), texto: "", recusas: [] };
    },
  });
  const { postar, chamar } = await servidor(ponte);
  mkdirSync(join(raiz, "raw/pessoal"), { recursive: true });
  writeFileSync(join(raiz, "raw/pessoal/llm-wiki.md"), FONTE);

  const criada = await (await postar("/api/conversas/de-raw", { caminho: "raw/pessoal/llm-wiki.md" })).json() as { id: string };
  const lendo = await postar(`/api/conversas/${criada.id}/ler`);
  expect(lendo.status).toBe(200);

  let conversa = { passo: "", situacao: "" };
  for (let i = 0; i < 200 && conversa.passo !== "parada"; i++) {
    await Bun.sleep(25);
    conversa = await (await chamar(`/api/conversas/${criada.id}`)).json() as typeof conversa;
  }
  expect(conversa).toMatchObject({ passo: "parada", situacao: "esperando" });
});
