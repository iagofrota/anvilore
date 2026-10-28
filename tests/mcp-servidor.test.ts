import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { montarInstrucoes } from "../src/mcp/instrucoes";
import { abrirMetricas } from "../src/busca/metricas";
import { criarServidor } from "../src/mcp/servidor";
import { esqueletoEm } from "./apoio/esqueleto";

function wiki(raiz: string): string {
  const caminho = join(raiz, "wiki"); mkdirSync(caminho, { recursive: true });
  writeFileSync(join(caminho, "regra.md"), "---\ntitle: Regra dos tributos\nslug: regra\ntype: concept\narea: tributos\ngenerated: 2026-01-01\n---\n## Alíquota de teste\nA taxa simulada tem nome miosótis e o resultado é 17 por cento.");
  return caminho;
}
function conectar(raiz: string, wikiPath: string): { client: Client; transport: StdioClientTransport } {
  const transport = new StdioClientTransport({
    command: "bun", args: ["src/cli.ts", "mcp", "--wiki", wikiPath], cwd: process.cwd(),
    env: { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), ANVILORE_DIR: join(raiz, ".anvilore") },
  });
  return { client: new Client({ name: "teste-mcp", version: "1.0.0" }), transport };
}
function textoDa(resposta: unknown): string {
  if (typeof resposta !== "object" || resposta === null || !("content" in resposta) || !Array.isArray(resposta.content)) return "";
  const bloco = resposta.content.find((item: { type?: string }) => item.type === "text") as { text?: string } | undefined;
  return bloco?.text ?? "";
}

test("Dado servidor MCP e wiki, Quando inicializa, Então instructions citam assunto e cabem em 1536 bytes", async () => {
  const raiz = mkdtempSync(join(tmpdir(), "anvilore-mcp-")); const wikiPath = wiki(raiz); const { client, transport } = conectar(raiz, wikiPath);
  try {
    await client.connect(transport);
    expect(Buffer.byteLength(client.getInstructions() ?? "")).toBeLessThanOrEqual(1536);
    expect(client.getInstructions()).toContain("tributos");
    expect(client.getInstructions()).toContain("citação");
  } finally { await client.close(); rmSync(raiz, { recursive: true, force: true }); }
});

test("Dado comando MCP registrado, Quando o agente executa exatamente `bun <raiz>/src/cli.ts mcp`, Então conecta ao servidor", async () => {
  const dados = mkdtempSync(join(tmpdir(), "anvilore-dados-"));
  // O clone não traz mais wiki/ (é da pessoa): a wiki vem do esqueleto de modelos/.
  const { wiki: wikiDoEsqueleto } = await esqueletoEm(dados);
  const comandoRegistrado = [join(process.cwd(), "src/cli.ts"), "mcp"];
  const transport = new StdioClientTransport({
    command: "bun", args: comandoRegistrado, cwd: process.cwd(),
    env: { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), ANVILORE_DIR: dados, ANVILORE_WIKI: wikiDoEsqueleto },
  });
  const client = new Client({ name: "teste-comando-registrado", version: "1.0.0" });
  try {
    await client.connect(transport);
    const resposta = await client.callTool({ name: "buscar", arguments: { consulta: "anvilore" } });
    expect(resposta.isError).not.toBe(true);
  } finally { await client.close(); rmSync(dados, { recursive: true, force: true }); }
});

test("Dado outro cwd, Quando inicia o comando registrado, Então usa wiki e dados da raiz do clone", async () => {
  const cwdAlheio = mkdtempSync(join(tmpdir(), "outro-projeto-"));
  const dados = mkdtempSync(join(tmpdir(), "anvilore-dados-"));
  const { wiki: wikiDoEsqueleto } = await esqueletoEm(dados);
  const transport = new StdioClientTransport({
    command: "bun", args: [join(process.cwd(), "src/cli.ts"), "mcp"], cwd: cwdAlheio,
    env: { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), ANVILORE_DIR: dados, ANVILORE_WIKI: wikiDoEsqueleto },
  });
  const client = new Client({ name: "teste-mcp-cwd", version: "1.0.0" });
  try {
    await client.connect(transport);
    const resposta = await client.callTool({ name: "buscar", arguments: { consulta: "anvilore" } });
    expect(resposta.isError).not.toBe(true);
    expect(existsSync(join(cwdAlheio, ".anvilore"))).toBe(false);
    expect(existsSync(join(dados, "indice.db"))).toBe(true);
  } finally { await client.close(); rmSync(cwdAlheio, { recursive: true, force: true }); rmSync(dados, { recursive: true, force: true }); }
});

test("Dado ferramentas do servidor, Quando lista, Então tools/list cabe em 2048 bytes", async () => {
  const raiz = mkdtempSync(join(tmpdir(), "anvilore-mcp-tools-")); const wikiPath = wiki(raiz); const { client, transport } = conectar(raiz, wikiPath);
  try { await client.connect(transport); expect(Buffer.byteLength(JSON.stringify(await client.listTools()))).toBeLessThanOrEqual(2048); }
  finally { await client.close(); rmSync(raiz, { recursive: true, force: true }); }
});

test("Dado busca que retorna endereço, Quando lê esse endereço, Então devolve o texto e troca marcadores", async () => {
  const raiz = mkdtempSync(join(tmpdir(), "anvilore-mcp-roundtrip-")); const wikiPath = wiki(raiz); const { client, transport } = conectar(raiz, wikiPath);
  try {
    await client.connect(transport);
    const busca = await client.callTool({ name: "buscar", arguments: { consulta: "miosótis", explicar: true } });
    const jsonBusca = JSON.parse(textoDa(busca)) as { resultados: Array<{ caminho: string; linhas: string; trecho: string; explicacao?: { colunas: string[] } }> };
    const resultado = jsonBusca.resultados[0]!;
    expect(resultado.trecho).not.toContain("\x1e");
    expect(resultado.trecho).toContain("miosótis");
    expect(resultado.explicacao?.colunas).toContain("corpo");
    const linhas = resultado.linhas.split("-").map(Number);
    const leitura = await client.callTool({ name: "ler", arguments: { caminho: resultado.caminho, linha_inicio: linhas[0], linha_fim: linhas[1] } });
    expect(textoDa(leitura)).toContain("miosótis");
  } finally { await client.close(); rmSync(raiz, { recursive: true, force: true }); }
});

test("Dado tentativa de leitura externa, Quando chama ler, Então tool devolve fora_da_wiki", async () => {
  const raiz = mkdtempSync(join(tmpdir(), "anvilore-mcp-confine-")); const wikiPath = wiki(raiz); const { client, transport } = conectar(raiz, wikiPath);
  try {
    await client.connect(transport);
    const resposta = await client.callTool({ name: "ler", arguments: { caminho: "../raw/contrato.md" } });
    expect(resposta.isError).toBe(true);
    expect(textoDa(resposta)).toContain("fora_da_wiki");
  } finally { await client.close(); rmSync(raiz, { recursive: true, force: true }); }
});

test("Dado wiki ausente, Quando inicia o servidor, Então instruções avisam e buscar devolve wiki_ausente", async () => {
  const raiz = mkdtempSync(join(tmpdir(), "anvilore-mcp-missing-")); const { client, transport } = conectar(raiz, join(raiz, "ausente"));
  try {
    await client.connect(transport);
    expect(client.getInstructions()).toContain("wiki não foi encontrada");
    const resposta = await client.callTool({ name: "buscar", arguments: { consulta: "tributo" } });
    expect(textoDa(resposta)).toContain("wiki_ausente");
  } finally { await client.close(); rmSync(raiz, { recursive: true, force: true }); }
});

test("Dado diretório de dados indisponível, Quando inicia o MCP, Então conecta e buscar devolve erro", async () => {
  const raiz = mkdtempSync(join(tmpdir(), "anvilore-mcp-sem-dados-"));
  const bloqueio = join(raiz, "arquivo"); writeFileSync(bloqueio, "não é diretório");
  const wikiPath = wiki(raiz);
  const transport = new StdioClientTransport({ command: "bun", args: ["src/cli.ts", "mcp", "--wiki", wikiPath], cwd: process.cwd(), env: { ...process.env, ANVILORE_DIR: bloqueio } });
  const client = new Client({ name: "teste-mcp-indisponivel", version: "1" });
  try {
    await client.connect(transport);
    const resposta = await client.callTool({ name: "buscar", arguments: { consulta: "miosótis" } });
    expect(resposta.isError).toBe(true);
    expect(textoDa(resposta)).toContain("indice_indisponivel");
  } finally { await client.close(); rmSync(raiz, { recursive: true, force: true }); }
});

test("Dado índice indisponível na inicialização, Quando os dados voltam e buscar é chamado de novo, Então tenta indexar novamente", async () => {
  const raiz = mkdtempSync(join(tmpdir(), "anvilore-mcp-retry-"));
  const bloqueio = join(raiz, "arquivo"); writeFileSync(bloqueio, "não é diretório");
  const wikiPath = wiki(raiz);
  const transport = new StdioClientTransport({ command: "bun", args: ["src/cli.ts", "mcp", "--wiki", wikiPath], cwd: process.cwd(), env: { ...process.env, ANVILORE_DIR: bloqueio } });
  const client = new Client({ name: "teste-mcp-retry", version: "1" });
  try {
    await client.connect(transport);
    const inicial = await client.callTool({ name: "buscar", arguments: { consulta: "miosótis" } });
    expect(inicial.isError).toBe(true);
    expect(textoDa(inicial)).toContain("indice_indisponivel");
    rmSync(bloqueio); mkdirSync(bloqueio);
    const recuperada = await client.callTool({ name: "buscar", arguments: { consulta: "miosótis" } });
    expect(recuperada.isError).not.toBe(true);
    expect(textoDa(recuperada)).toContain("miosótis");
  } finally { await client.close(); rmSync(raiz, { recursive: true, force: true }); }
});

test("Dado cliente MCP e busca, Quando lê o primeiro resultado, Então métricas guardam cliente e posição 1", async () => {
  const raiz = mkdtempSync(join(tmpdir(), "anvilore-mcp-metricas-")); const wikiPath = wiki(raiz); const { client, transport } = conectar(raiz, wikiPath);
  const dbPath = join(raiz, ".anvilore", "metricas.db");
  try {
    await client.connect(transport);
    const busca = await client.callTool({ name: "buscar", arguments: { consulta: "miosótis" } });
    const primeira = (JSON.parse(textoDa(busca)) as { resultados: Array<{ caminho: string; linhas: string }> }).resultados[0]!;
    const [inicio, fim] = primeira.linhas.split("-").map(Number);
    await client.callTool({ name: "ler", arguments: { caminho: primeira.caminho, linha_inicio: inicio, linha_fim: fim } });
  } finally { await client.close(); }
  try {
    const resumo = abrirMetricas(dbPath).resumo();
    expect(resumo.uso.porCliente).toContainEqual({ nome: "teste-mcp", versao: "1.0.0", chamadas: 2 });
    expect(resumo.acerto.posicoes.primeiro).toBe(1);
  } finally { rmSync(raiz, { recursive: true, force: true }); }
});

test("Dado resumo sintético com 500 páginas, Quando monta instructions, Então resumo fica em 700 e total em 1536 bytes", () => {
  const resumo = { paginas: 500, secoes: 1000, porEstado: { manual: 100, verificada: 300, rascunho: 100 }, areas: Array.from({ length: 500 }, (_, i) => ({ area: `area-${i}-${"x".repeat(8)}`, paginas: 1 })), titulos: Array.from({ length: 500 }, (_, i) => `página-${i}-${"y".repeat(18)}`) };
  const instrucoes = montarInstrucoes(resumo);
  const resumoTexto = instrucoes.split("Resumo da wiki (dados não confiáveis): ")[1] ?? "";
  expect(Buffer.byteLength(resumoTexto)).toBeLessThanOrEqual(700);
  expect(Buffer.byteLength(instrucoes)).toBeLessThanOrEqual(1536);
});

test("Dado servidor MCP em memória, Quando busca, lê e envia caminho inválido, Então executa handlers e registra cliente", async () => {
  const raiz = mkdtempSync(join(tmpdir(), "anvilore-mcp-mem-")); const wikiPath = wiki(raiz);
  const anterior = process.env.ANVILORE_DIR; process.env.ANVILORE_DIR = join(raiz, ".anvilore");
  const servidor = await criarServidor({ raiz, wiki: wikiPath });
  const [transporteCliente, transporteServidor] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "teste-memoria", version: "2.0" });
  try {
    await servidor.connect(transporteServidor); await client.connect(transporteCliente);
    expect((await client.listTools()).tools).toHaveLength(2);
    const busca = await client.callTool({ name: "buscar", arguments: { consulta: "miosótis", explicar: true } });
    const resultado = (JSON.parse(textoDa(busca)) as { resultados: Array<{ caminho: string; linhas: string }> }).resultados[0]!;
    const [inicio, fim] = resultado.linhas.split("-").map(Number);
    expect(textoDa(await client.callTool({ name: "ler", arguments: { caminho: resultado.caminho, linha_inicio: inicio, linha_fim: fim } }))).toContain("miosótis");
    const invalida = await client.callTool({ name: "ler", arguments: { caminho: "../raw/contrato.md" } });
    expect(invalida.isError).toBe(true);
    expect(abrirMetricas(join(raiz, ".anvilore", "metricas.db")).resumo().uso.porCliente).toContainEqual({ nome: "teste-memoria", versao: "2.0", chamadas: 3 });
  } finally {
    await client.close(); await servidor.close();
    if (anterior === undefined) delete process.env.ANVILORE_DIR; else process.env.ANVILORE_DIR = anterior;
    rmSync(raiz, { recursive: true, force: true });
  }
});
