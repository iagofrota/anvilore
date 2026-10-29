import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

test("Dado envio sem token, sem origem, com área inválida, vazio ou grande demais Quando chega Então recuso sem gravar em raw/", async () => {
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

test("Dado ids desconhecidos, métodos errados ou corpo inválido Quando chamo Então recebo o erro certo", async () => {
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
