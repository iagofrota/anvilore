import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import * as arquivos from "node:fs/promises";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FimDaFase, PonteDeAgente } from "../src/lib/ponte-agente";
import { FONTE, relatorioValido, SESSAO } from "./apoio/ingestao-exemplo";
import { PonteFalsa, type Roteiro } from "./apoio/ponte-falsa";
import { ErroDeIngestao, IngestaoNaInterface, lerFechamento, mensagemDoEscritor, mensagemDoLeitor, rodarFechamento, type Conversa } from "../src/lib/ui-ingestao";

const PAGINA_EXISTENTE = "---\ntitle: Segundo cérebro\ntype: concept\n---\nTexto antigo.\n";

let raiz: string;
let wiki: string;
let agora: Date;
beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "anvilore-ingestao-"));
  wiki = join(raiz, "wiki");
  mkdirSync(join(wiki, "pessoal/concepts"), { recursive: true });
  mkdirSync(join(wiki, "pessoal/sources"), { recursive: true });
  writeFileSync(join(wiki, "pessoal/concepts/segundo-cerebro.md"), PAGINA_EXISTENTE);
  writeFileSync(join(wiki, "index.md"), "# Índice\n");
  agora = new Date(2026, 9, 28, 14, 31, 0);
});
afterEach(() => rmSync(raiz, { recursive: true, force: true }));

const fechamentoSoRascunhos = async () => ({ codigo: 1, saida: "ERRO: página gerada sem aprovação humana: wiki/pessoal/sources/llm-wiki.md\nERRO: página gerada sem aprovação humana: wiki/pessoal/concepts/rag.md\nVALIDACAO: FAIL (2 violacoes de invariante)\nFECHAMENTO: FAIL no passo validar-wiki\n" });

function servico(ponte: PonteDeAgente, fechar: (raiz: string, wiki: string) => Promise<{ codigo: number; saida: string }> = fechamentoSoRascunhos) {
  return new IngestaoNaInterface(raiz, { ponte, agora: () => agora, fechar, ambiente: {} });
}

async function comFonte(ingestao: IngestaoNaInterface, conteudo = FONTE, nome = "llm-wiki.md") {
  return ingestao.criar({ area: "pessoal", nome, conteudo: new TextEncoder().encode(conteudo) });
}

const leitorValido = (relatorio: unknown = relatorioValido()): Roteiro => async (_pedido, aoEvento) => {
  aoEvento({ tipo: "inicio", sessao: SESSAO, autor: "claude-opus-5-5/2.1.311" });
  aoEvento({ tipo: "ferramenta", id: "r1", nome: "Read", caminho: join(raiz, "raw/pessoal/llm-wiki.md") });
  aoEvento({ tipo: "resultado-ferramenta", id: "r1", erro: false, texto: FONTE });
  aoEvento({ tipo: "ferramenta", id: "r2", nome: "Read", caminho: join(wiki, "index.md") });
  aoEvento({ tipo: "resultado-ferramenta", id: "r2", erro: false, texto: "" });
  aoEvento({ tipo: "ferramenta", id: "r3", nome: "Grep", padrao: "segundo", caminho: wiki });
  aoEvento({ tipo: "ferramenta", id: "r4", nome: "Glob", padrao: "**/*.md" });
  aoEvento({ tipo: "ferramenta", id: "r5", nome: "StructuredOutput" });
  aoEvento({ tipo: "texto", texto: "Li a fonte inteira." });
  return { situacao: "concluida", sessao: SESSAO, saidaEstruturada: relatorio, texto: "", recusas: [] };
};

async function naParada(ponte: PonteFalsa, ingestao = servico(ponte)) {
  const conversa = await comFonte(ingestao);
  await ingestao.ler(conversa.id);
  await ingestao.esperar(conversa.id);
  return { ingestao, conversa: (await ingestao.obter(conversa.id))! };
}

test("Dado o relatório conferido e o rename pendente Quando consulto a conversa e a lista Então a parada só aparece após persistir", async () => {
  const ingestao = servico(new PonteFalsa({ leitor: leitorValido() }));
  const conversa = await comFonte(ingestao);
  const arquivo = join(raiz, ".anvilore/ui/conversas", `${conversa.id}.json`);
  const pendente = Promise.withResolvers<void>();
  const liberar = Promise.withResolvers<void>();
  const rename = arquivos.rename;
  const gravacao = spyOn(arquivos, "rename").mockImplementation(async (de, para) => {
    if (para === arquivo && JSON.parse(readFileSync(de, "utf8")).situacao === "esperando") {
      pendente.resolve();
      await liberar.promise;
    }
    return rename(de, para);
  });
  try {
    await ingestao.ler(conversa.id);
    await pendente.promise;
    expect((await ingestao.obter(conversa.id))?.situacao).toBe("rodando");
    expect((await ingestao.listar())[0]?.situacao).toBe("rodando");
    expect(JSON.parse(readFileSync(arquivo, "utf8")).situacao).toBe("rodando");
  } finally {
    liberar.resolve();
    await ingestao.esperar(conversa.id);
    gravacao.mockRestore();
  }
  const publicada = await ingestao.obter(conversa.id);
  expect(publicada).toMatchObject({ situacao: "esperando", passo: "parada" });
  expect(publicada).toEqual(JSON.parse(readFileSync(arquivo, "utf8")));
  expect(await servico(new PonteFalsa()).obter(conversa.id)).toEqual(publicada);
});

test("Dado eventos consecutivos do leitor Quando a fila grava Então cada snapshot conserva o estado daquele evento", async () => {
  const ingestao = servico(new PonteFalsa({ leitor: leitorValido() }));
  const conversa = await comFonte(ingestao);
  const arquivo = join(raiz, ".anvilore/ui/conversas", `${conversa.id}.json`);
  const snapshots: Conversa[] = [];
  const rename = arquivos.rename;
  const gravacao = spyOn(arquivos, "rename").mockImplementation(async (de, para) => {
    if (para === arquivo) snapshots.push(JSON.parse(readFileSync(de, "utf8")) as Conversa);
    return rename(de, para);
  });
  try {
    await ingestao.ler(conversa.id);
    await ingestao.esperar(conversa.id);
  } finally { gravacao.mockRestore(); }
  expect(snapshots[1]).toMatchObject({ situacao: "rodando", sessao: SESSAO, atividade: [] });
  expect(snapshots[2]?.atividade[0]?.estado).toBe("andamento");
  expect(snapshots[3]?.atividade[0]?.estado).toBe("ok");
  expect(snapshots.at(-1)).toMatchObject({ situacao: "esperando", passo: "parada" });
});

for (const fase of ["leitura", "escrita"] as const) {
  test(`Dado que o rename final da ${fase} falha Quando consulto ou ajo Então recebo erro de persistência sem publicar sucesso`, async () => {
    const ingestao = servico(new PonteFalsa({ leitor: leitorValido() }));
    const conversa = await comFonte(ingestao);
    if (fase === "escrita") {
      await ingestao.ler(conversa.id);
      await ingestao.esperar(conversa.id);
    }
    const arquivo = join(raiz, ".anvilore/ui/conversas", `${conversa.id}.json`);
    const rename = arquivos.rename;
    const gravacao = spyOn(arquivos, "rename").mockImplementation(async (de, para) => {
      if (para === arquivo && JSON.parse(readFileSync(de, "utf8")).situacao !== "rodando") throw new Error("ENOSPC simulado");
      return rename(de, para);
    });
    try {
      if (fase === "leitura") await ingestao.ler(conversa.id);
      else await ingestao.seguir(conversa.id, { takeaways: [0], paginas: [0], comentario: "" });
      await ingestao.esperar(conversa.id);
      for (const consultar of [() => ingestao.obter(conversa.id), () => ingestao.listar(), () => ingestao.cancelar(conversa.id)]) {
        const erro: unknown = await consultar().catch((erro: unknown) => erro);
        expect(erro).toBeInstanceOf(ErroDeIngestao);
        expect((erro as ErroDeIngestao).status).toBe(500);
        expect((erro as Error).message).toContain("Não foi possível salvar a ingestão");
      }
      expect(JSON.parse(readFileSync(arquivo, "utf8"))).toMatchObject({ situacao: "rodando", passo: fase === "escrita" ? "fechamento" : "leitura" });
    } finally { gravacao.mockRestore(); }
    expect(await servico(new PonteFalsa()).obter(conversa.id)).toMatchObject({ situacao: "interrompida" });
  });
}

test("Dado que uma gravação de atividade falha Quando o próximo snapshot é salvo Então a conversa volta a ser consultável", async () => {
  const ingestao = servico(new PonteFalsa({ leitor: leitorValido() }));
  const conversa = await comFonte(ingestao);
  const arquivo = join(raiz, ".anvilore/ui/conversas", `${conversa.id}.json`);
  let falhou = false;
  const rename = arquivos.rename;
  const gravacao = spyOn(arquivos, "rename").mockImplementation(async (de, para) => {
    const snapshot = para === arquivo ? JSON.parse(readFileSync(de, "utf8")) as Conversa : undefined;
    if (!falhou && snapshot?.sessao) { falhou = true; throw new Error("EIO simulado"); }
    return rename(de, para);
  });
  try {
    await ingestao.ler(conversa.id);
    await ingestao.esperar(conversa.id);
    expect(falhou).toBe(true);
    expect(await ingestao.obter(conversa.id)).toEqual(JSON.parse(readFileSync(arquivo, "utf8")));
    expect((await ingestao.obter(conversa.id))?.situacao).toBe("esperando");
  } finally { gravacao.mockRestore(); }
});

// ── 1b-1 ───────────────────────────────────────────────────────────────────

test("Dado um arquivo solto com a área pessoal Quando confirmo Então a fonte vai para raw/pessoal e a conversa começa no passo Fonte, gravada fora de wiki/ e raw/", async () => {
  const ingestao = servico(new PonteFalsa());
  const conversa = await comFonte(ingestao);
  expect(conversa).toMatchObject({ fonte: "raw/pessoal/llm-wiki.md", nome: "llm-wiki.md", area: "pessoal", passo: "fonte", situacao: "pronta", bytes: FONTE.length });
  expect(conversa.id).toMatch(/^[a-z0-9-]+$/);
  expect(readFileSync(join(raiz, "raw/pessoal/llm-wiki.md"), "utf8")).toBe(FONTE);
  expect(JSON.parse(readFileSync(join(raiz, ".anvilore/ui/conversas", `${conversa.id}.json`), "utf8"))).toMatchObject({ fonte: "raw/pessoal/llm-wiki.md" });
  const segunda = await comFonte(ingestao);
  expect(segunda.fonte).toBe("raw/pessoal/llm-wiki-2.md");
  expect((await ingestao.listar()).map(c => c.id).sort()).toEqual([conversa.id, segunda.id].sort());
});

// ── 1b-2, 1b-3 ─────────────────────────────────────────────────────────────

test("Dado um arquivo em raw/ Quando aperto Ingerir Então o leitor é chamado e o painel mostra Leitura em andamento", async () => {
  let liberar!: () => void;
  const segura = new Promise<void>(resolver => { liberar = resolver; });
  const ponte = new PonteFalsa({ leitor: async (pedido, aoEvento, cancelamento) => { await Promise.race([segura, cancelamento]); return leitorValido()(pedido, aoEvento, cancelamento); } });
  const ingestao = servico(ponte);
  const conversa = await comFonte(ingestao);
  const lendo = await ingestao.ler(conversa.id);
  expect(lendo).toMatchObject({ passo: "leitura", situacao: "rodando" });
  expect(ponte.pedidos).toEqual([{ papel: "leitor", mensagem: mensagemDoLeitor(lendo, wiki), raiz, wiki, rota: "padrao" }]);
  expect(ponte.pedidos[0]!.mensagem).toContain("raw/pessoal/llm-wiki.md");
  liberar();
  await ingestao.esperar(conversa.id);
});

test("Dado o leitor terminou Quando o relatório chega Então a ingestão para nos takeaways com Criar, Atualizar e o que foi lido", async () => {
  const { conversa } = await naParada(new PonteFalsa({ leitor: leitorValido() }));
  expect(conversa).toMatchObject({ passo: "parada", situacao: "esperando", sessao: SESSAO, autor: "claude-opus-5-5/2.1.311", avisos: [] });
  expect(conversa.relatorio!.takeaways).toHaveLength(4);
  expect(conversa.relatorio!.paginas.filter(p => p.acao === "criar")).toHaveLength(2);
  expect(conversa.atividade.map(a => [a.verbo, a.alvo, a.estado])).toEqual([
    ["Leu", "raw/pessoal/llm-wiki.md", "ok"],
    ["Leu", "wiki/index.md", "ok"],
    ["Buscou", "segundo", "ok"],
    ["Listou", "**/*.md", "ok"],
  ]);
  expect(conversa.agora).toBeUndefined();
  expect(existsSync(join(raiz, ".anvilore/ui/conversas", conversa.id, "leitura.json"))).toBe(true);
});

// ── 1b-4 ───────────────────────────────────────────────────────────────────

test("Dado o relatório não segue o esquema Quando chega Então a ingestão para com erro visível e nada é escrito", async () => {
  const ponte = new PonteFalsa({ leitor: leitorValido({ versao: 1, fonte: "raw/pessoal/llm-wiki.md", takeaways: [] }) });
  const { conversa } = await naParada(ponte);
  expect(conversa).toMatchObject({ passo: "leitura", situacao: "erro", erro: "O relatório do leitor não passou na conferência. Nada foi escrito." });
  expect(conversa.mensagens!.join("\n")).toContain("FAIL:");
  expect(conversa.relatorio).toBeUndefined();
  expect(ponte.pedidos.map(p => p.papel)).toEqual(["leitor"]);
  expect(readFileSync(join(wiki, "pessoal/concepts/segundo-cerebro.md"), "utf8")).toBe(PAGINA_EXISTENTE);
});

test("Dado citação que não está na fonte Quando o relatório chega Então o portão do conferir-leitura recusa", async () => {
  const relatorio = relatorioValido();
  relatorio.takeaways[0]!.citacao.trecho = "Frase inventada pelo agente.";
  const { conversa } = await naParada(new PonteFalsa({ leitor: leitorValido(relatorio) }));
  expect(conversa.situacao).toBe("erro");
  expect(conversa.mensagens!.join("\n")).toContain("não aparece na fonte");
});

test("Dado relatório sobre outra fonte Quando chega Então recuso", async () => {
  mkdirSync(join(raiz, "raw/pessoal"), { recursive: true });
  writeFileSync(join(raiz, "raw/pessoal/outra.md"), FONTE);
  const { conversa } = await naParada(new PonteFalsa({ leitor: leitorValido(relatorioValido({ fonte: "raw/pessoal/outra.md" })) }));
  expect(conversa).toMatchObject({ situacao: "erro", mensagens: ["O relatório fala de raw/pessoal/outra.md, mas a fonte desta ingestão é raw/pessoal/llm-wiki.md."] });
});

test("Dado o leitor sem saída estruturada Quando responde com um bloco json Então ainda confiro o texto", async () => {
  const ponte = new PonteFalsa({ leitor: async (pedido, aoEvento, c) => {
    const fim = await leitorValido()(pedido, aoEvento, c);
    return { ...fim, saidaEstruturada: undefined, texto: "```json\n" + JSON.stringify(relatorioValido()) + "\n```" } as FimDaFase;
  } });
  const { conversa } = await naParada(ponte);
  expect(conversa.passo).toBe("parada");
});

test("Dado fonte binária Quando o relatório chega Então a parada mostra o AVISO de citações não conferidas", async () => {
  const ponte = new PonteFalsa({ leitor: leitorValido(relatorioValido({ fonte: "raw/pessoal/scan.pdf" })) });
  const ingestao = servico(ponte);
  const conversa = await comFonte(ingestao, "%PDF-1.7 binário", "scan.pdf");
  await ingestao.ler(conversa.id);
  await ingestao.esperar(conversa.id);
  const parada = (await ingestao.obter(conversa.id))!;
  expect(parada.passo).toBe("parada");
  expect(parada.avisos).toEqual([expect.stringContaining("AVISO: citações não conferidas automaticamente")]);
});

test("Dado o leitor falhou ou foi cancelado Quando a fase termina Então a conversa mostra o erro e pode ler de novo", async () => {
  const ponte = new PonteFalsa({ leitor: async () => ({ situacao: "falhou", erro: "Not logged in", recusas: [] }) });
  const ingestao = servico(ponte);
  const conversa = await comFonte(ingestao);
  await ingestao.ler(conversa.id);
  await ingestao.esperar(conversa.id);
  expect(await ingestao.obter(conversa.id)).toMatchObject({ passo: "leitura", situacao: "erro", erro: "Not logged in" });
  ponte.roteiros.leitor = leitorValido();
  await ingestao.ler(conversa.id);
  await ingestao.esperar(conversa.id);
  expect(await ingestao.obter(conversa.id)).toMatchObject({ passo: "parada", situacao: "esperando" });
  expect((await ingestao.obter(conversa.id))!.erro).toBeUndefined();
});

// ── 1b-5, 1b-7 ─────────────────────────────────────────────────────────────

const escritorQueEscreve: Roteiro = async (pedido, aoEvento) => {
  aoEvento({ tipo: "inicio", sessao: SESSAO, autor: "claude-opus-5-5/2.1.311" });
  const passos: Array<[string, string, string]> = [
    ["w1", "Write", join(wiki, "pessoal/sources/llm-wiki.md")],
    ["w2", "Edit", join(wiki, "pessoal/concepts/segundo-cerebro.md")],
    ["w3", "Edit", join(wiki, "pessoal/concepts/segundo-cerebro.md")],
    ["w4", "Edit", join(wiki, "index.md")],
    ["w5", "Write", join(wiki, "log/log-2026-10-28.md")],
  ];
  for (const [id, nome, caminho] of passos) {
    aoEvento({ tipo: "ferramenta", id, nome, caminho });
    mkdirSync(join(caminho, ".."), { recursive: true });
    writeFileSync(caminho, `escrito por ${id}\n`);
    aoEvento({ tipo: "resultado-ferramenta", id, erro: false, texto: "ok" });
  }
  aoEvento({ tipo: "ferramenta", id: "w6", nome: "Read", caminho: join(wiki, "index.md") });
  return { situacao: "concluida", sessao: pedido.sessao, texto: "Pronto.", recusas: [] };
};

test("Dado desmarquei o takeaway 4 e escrevi um comentário Quando aperto Pode seguir Então o escritor recebe só os marcados e o comentário, e o painel avança para Escrita", async () => {
  let liberar!: () => void;
  const segura = new Promise<void>(resolver => { liberar = resolver; });
  const ponte = new PonteFalsa({ leitor: leitorValido(), escritor: async (p, e, c) => { await segura; return escritorQueEscreve(p, e, c); } });
  const { ingestao, conversa } = await naParada(ponte);
  const escrevendo = await ingestao.seguir(conversa.id, { takeaways: [0, 1, 2], paginas: [0, 1, 2], comentario: "Enfatize o índice." });
  expect(escrevendo).toMatchObject({ passo: "escrita", situacao: "rodando", geracao: { by: "claude-opus-5-5/2.1.311", at: "2026-10-28T14:31:00" + escrevendo.geracao!.at.slice(19) } });
  const pedido = ponte.pedidos[1]!;
  expect(pedido).toMatchObject({ papel: "escritor", sessao: SESSAO, raiz, wiki, rota: "padrao" });
  expect(pedido.mensagem).toBe(mensagemDoEscritor(escrevendo, wiki));
  expect(pedido.mensagem).toContain("A wiki acumula.");
  expect(pedido.mensagem).toContain("Uma fonte toca muitas páginas.");
  expect(pedido.mensagem).not.toContain("Respostas viram páginas.");
  expect(pedido.mensagem).toContain("Enfatize o índice.");
  expect(pedido.mensagem).toContain("by: claude-opus-5-5/2.1.311");
  expect(pedido.mensagem).toContain(`at: ${escrevendo.geracao!.at}`);
  expect(pedido.mensagem).toContain("deixou de fora 1 takeaway");
  // Cópia de cada página a atualizar, antes de o escritor rodar, no layout que a Revisão lê.
  expect(readFileSync(join(raiz, ".anvilore/ui/copias", conversa.id, "pessoal/concepts/segundo-cerebro.md"), "utf8")).toBe(PAGINA_EXISTENTE);
  liberar();
  await ingestao.esperar(conversa.id);
});

test("Dado o escritor rodando Quando cada página é gravada Então a lista de escrita mostra verbo, caminho e rascunho, e o fechamento real é chamado", async () => {
  const chamadas: string[][] = [];
  const ponte = new PonteFalsa({ leitor: leitorValido(), escritor: escritorQueEscreve });
  const ingestao = servico(ponte, async (r, w) => { chamadas.push([r, w]); return fechamentoSoRascunhos(); });
  const { conversa } = await naParada(ponte, ingestao);
  await ingestao.seguir(conversa.id, { takeaways: [0, 1, 2, 3], paginas: [0, 1, 2], comentario: "" });
  await ingestao.esperar(conversa.id);
  const final = (await ingestao.obter(conversa.id))!;
  expect(final.atividade.filter(a => a.papel === "escritor").map(a => [a.verbo, a.alvo, a.estado])).toEqual([
    ["Criou", "wiki/pessoal/sources/llm-wiki.md", "ok"],
    ["Atualizou", "wiki/pessoal/concepts/segundo-cerebro.md", "ok"],
    ["Atualizou", "wiki/index.md", "ok"],
    ["Registrou", "wiki/log/log-2026-10-28.md", "ok"],
  ]);
  expect(chamadas).toEqual([[raiz, wiki]]);
  expect(final).toMatchObject({ passo: "revisao", situacao: "concluida", fechamento: { codigo: 1, rascunhos: 2, soRascunhos: true } });
  expect(ponte.pedidos[1]!.mensagem).toContain("A pessoa não deixou comentário.");
});

// ── 1b-6 ───────────────────────────────────────────────────────────────────

test("Dado o escritor rodando Quando ele tenta gravar em raw/ Então a tentativa é negada e a tela mostra a recusa", async () => {
  const ponte = new PonteFalsa({ leitor: leitorValido(), escritor: async (pedido, aoEvento) => {
    aoEvento({ tipo: "ferramenta", id: "x1", nome: "Write", caminho: join(raiz, "raw/pessoal/llm-wiki.md") });
    aoEvento({ tipo: "resultado-ferramenta", id: "x1", erro: true, texto: "PreToolUse:Write hook error: Bloqueado: raw/ é imutável" });
    return { situacao: "concluida", sessao: pedido.sessao, texto: "", recusas: [
      { ferramenta: "Write", id: "x1", caminho: join(raiz, "raw/pessoal/llm-wiki.md") },
      { ferramenta: "Edit", id: "x2", caminho: join(raiz, "raw/pessoal/outra.md") },
    ] };
  } });
  const { ingestao, conversa } = await naParada(ponte);
  await ingestao.seguir(conversa.id, { takeaways: [0, 1, 2], paginas: [0, 1, 2], comentario: "" });
  await ingestao.esperar(conversa.id);
  const final = (await ingestao.obter(conversa.id))!;
  expect(final.atividade.filter(a => a.estado === "recusado").map(a => [a.verbo, a.alvo, a.motivo])).toEqual([
    ["Recusado", "raw/pessoal/llm-wiki.md", "PreToolUse:Write hook error: Bloqueado: raw/ é imutável"],
    ["Recusado", "raw/pessoal/outra.md", "Negado pelas permissões da ingestão."],
  ]);
  expect(final.recusas).toHaveLength(2);
  expect(readFileSync(join(raiz, "raw/pessoal/llm-wiki.md"), "utf8")).toBe(FONTE);
});

// ── 1b-8 ───────────────────────────────────────────────────────────────────

test("Dado saídas reais do fechar Quando leio Então separo os rascunhos de qualquer outro erro", () => {
  expect(lerFechamento(0, "VALIDACAO: PASS\nFECHAMENTO: OK\n")).toEqual({ codigo: 0, saida: "VALIDACAO: PASS\nFECHAMENTO: OK", rascunhos: 0, soRascunhos: false });
  expect(lerFechamento(1, "ERRO: página gerada sem aprovação humana: wiki/a.md\nFECHAMENTO: FAIL no passo validar-wiki")).toMatchObject({ rascunhos: 1, soRascunhos: true });
  expect(lerFechamento(1, "ERRO: página gerada sem aprovação humana: wiki/a.md\nERRO: wikilink quebrado: x\nFECHAMENTO: FAIL no passo validar-wiki")).toMatchObject({ rascunhos: 1, soRascunhos: false });
  expect(lerFechamento(1, "FECHAMENTO: FAIL no passo gate-do-log")).toMatchObject({ rascunhos: 0, soRascunhos: false });
});

test("Dado o fechamento com erro que não é rascunho Quando termina Então aparece como erro", async () => {
  const ponte = new PonteFalsa({ leitor: leitorValido(), escritor: escritorQueEscreve });
  const ingestao = servico(ponte, async () => ({ codigo: 1, saida: "ERRO: página fora do índice: wiki/pessoal/concepts/rag.md\nFECHAMENTO: FAIL no passo validar-wiki" }));
  const { conversa } = await naParada(ponte, ingestao);
  await ingestao.seguir(conversa.id, { takeaways: [0, 1, 2], paginas: [0, 1, 2], comentario: "" });
  await ingestao.esperar(conversa.id);
  expect(await ingestao.obter(conversa.id)).toMatchObject({ passo: "revisao", situacao: "erro", erro: "O fechamento encontrou problemas na wiki.", fechamento: { soRascunhos: false } });
});

test("Dado uma wiki real com um rascunho Quando o servidor roda o fechar Então devolve a saída e o código reais", async () => {
  const resultado = await rodarFechamento(raiz, join(raiz, "nao-existe"));
  expect(resultado.codigo).toBe(1);
  expect(resultado.saida).toContain("FECHAMENTO: FAIL");
});

// ── 1b-9 ───────────────────────────────────────────────────────────────────

test("Dado que apertei Cancelar Quando o escritor está rodando Então a ponte cancela e a tela mostra o que já foi escrito", async () => {
  const ponte = new PonteFalsa({ leitor: leitorValido(), escritor: async (pedido, aoEvento, cancelamento) => {
    aoEvento({ tipo: "ferramenta", id: "w1", nome: "Write", caminho: join(wiki, "pessoal/sources/llm-wiki.md") });
    aoEvento({ tipo: "resultado-ferramenta", id: "w1", erro: false, texto: "ok" });
    aoEvento({ tipo: "ferramenta", id: "w2", nome: "Write", caminho: join(wiki, "pessoal/concepts/rag.md") });
    await cancelamento;
    return { situacao: "cancelada", sessao: pedido.sessao, recusas: [] };
  } });
  const { ingestao, conversa } = await naParada(ponte);
  await ingestao.seguir(conversa.id, { takeaways: [0, 1, 2], paginas: [0, 1, 2], comentario: "" });
  await Bun.sleep(5);
  expect((await ingestao.obter(conversa.id))!.agora).toBe("Escrevendo wiki/pessoal/concepts/rag.md");
  await ingestao.cancelar(conversa.id);
  await ingestao.esperar(conversa.id);
  const final = (await ingestao.obter(conversa.id))!;
  expect(ponte.cancelamentos).toBe(1);
  expect(final).toMatchObject({ passo: "escrita", situacao: "cancelada" });
  expect(final.atividade.filter(a => a.papel === "escritor").map(a => [a.verbo, a.alvo, a.estado])).toEqual([
    ["Criou", "wiki/pessoal/sources/llm-wiki.md", "ok"],
    ["Escrevendo", "wiki/pessoal/concepts/rag.md", "interrompido"],
  ]);
  await expect(ingestao.cancelar(conversa.id)).rejects.toThrow("Nada está rodando");
});

test("Dado o escritor falhou Quando a fase termina Então a conversa mostra o erro sem fechar", async () => {
  const ponte = new PonteFalsa({ leitor: leitorValido(), escritor: async () => ({ situacao: "falhou", erro: "limite de 5 h", recusas: [] }) });
  let fechou = false;
  const ingestao = servico(ponte, async () => { fechou = true; return { codigo: 0, saida: "" }; });
  const { conversa } = await naParada(ponte, ingestao);
  await ingestao.seguir(conversa.id, { takeaways: [0, 1, 2], paginas: [0, 1, 2], comentario: "" });
  await ingestao.esperar(conversa.id);
  expect(await ingestao.obter(conversa.id)).toMatchObject({ passo: "escrita", situacao: "erro", erro: "limite de 5 h" });
  expect(fechou).toBe(false);
});

// ── 1b-10 ──────────────────────────────────────────────────────────────────

test("Dado que fechei o navegador na parada dos takeaways Quando volto Então a conversa está no mesmo ponto, lida do disco", async () => {
  const { conversa } = await naParada(new PonteFalsa({ leitor: leitorValido() }));
  const outraInstancia = servico(new PonteFalsa());
  const lida = await outraInstancia.obter(conversa.id);
  expect(lida).toMatchObject({ passo: "parada", situacao: "esperando", sessao: SESSAO });
  expect(lida!.relatorio).toEqual(conversa.relatorio);
  expect((await outraInstancia.listar())[0]).toMatchObject({ id: conversa.id, passo: "parada", situacao: "esperando", nome: "llm-wiki.md" });
});

test("Dado a interface fechada no meio de uma fase Quando volto Então a conversa aparece interrompida", async () => {
  const ponte = new PonteFalsa({ leitor: async (_p, _e, cancelamento) => { await cancelamento; return { situacao: "cancelada", recusas: [] }; } });
  const ingestao = servico(ponte);
  const conversa = await comFonte(ingestao);
  await ingestao.ler(conversa.id);
  const outra = servico(new PonteFalsa());
  expect(await outra.obter(conversa.id)).toMatchObject({ passo: "leitura", situacao: "interrompida", erro: "A interface foi fechada durante esta etapa." });
  await ingestao.cancelar(conversa.id);
  await ingestao.esperar(conversa.id);
});

test("[C25.a–d] Dado ids inválidos, arquivos estranhos ou ausentes Quando leio as conversas Então ignoro sem lançar", async () => {
  const ingestao = servico(new PonteFalsa());
  expect(await ingestao.listar()).toEqual([]);
  mkdirSync(join(raiz, ".anvilore/ui/conversas"), { recursive: true });
  writeFileSync(join(raiz, ".anvilore/ui/conversas/quebrada.json"), "{");
  writeFileSync(join(raiz, ".anvilore/ui/conversas/leia-me.txt"), "x");
  expect(await ingestao.listar()).toEqual([]);
  expect(await ingestao.obter("../../etc/passwd")).toBeUndefined();
  expect(await ingestao.obter("nao-existe")).toBeUndefined();
  await expect(ingestao.ler("nao-existe")).rejects.toMatchObject({ status: 404 });
  await ingestao.esperar("nao-existe");
});

// ── 1b-11 ──────────────────────────────────────────────────────────────────

test("Dado que o claude não está no PATH ou não tem login Quando aperto Ingerir Então a tela diz isso, sem iniciar nada", async () => {
  const ponte = new PonteFalsa();
  ponte.disponivel = { ok: false, motivo: "O Claude Code está instalado, mas sem login." };
  const ingestao = servico(ponte);
  const conversa = await comFonte(ingestao);
  await expect(ingestao.ler(conversa.id)).rejects.toMatchObject({ message: "O Claude Code está instalado, mas sem login.", status: 503 });
  expect(ponte.pedidos).toEqual([]);
  expect(await ingestao.obter(conversa.id)).toMatchObject({ passo: "fonte", situacao: "pronta" });
});

// ── Guardas ────────────────────────────────────────────────────────────────

test("Dado uma ingestão rodando Quando peço outra fase Então recuso com 409", async () => {
  const ponte = new PonteFalsa({ leitor: async (_p, _e, cancelamento) => { await cancelamento; return { situacao: "cancelada", recusas: [] }; } });
  const ingestao = servico(ponte);
  const a = await comFonte(ingestao);
  const b = await comFonte(ingestao);
  await ingestao.ler(a.id);
  await expect(ingestao.ler(b.id)).rejects.toMatchObject({ status: 409, message: "Já há uma ingestão em andamento. Espere ou cancele." });
  await expect(ingestao.ler(a.id)).rejects.toMatchObject({ status: 409 });
  await expect(ingestao.seguir(a.id, { takeaways: [0], paginas: [0], comentario: "" })).rejects.toMatchObject({ status: 409 });
  await ingestao.cancelar(a.id);
  await ingestao.esperar(a.id);
  expect(await ingestao.obter(a.id)).toMatchObject({ situacao: "cancelada" });
});

test("Dado duas leituras concorrentes Quando ambas disputam a fase Então só uma inicia um agente", async () => {
  let liberarDisponibilidade!: () => void;
  const disponibilidadeLiberada = new Promise<void>(resolver => { liberarDisponibilidade = resolver; });
  let liberarDuasConsultas!: () => void;
  const duasConsultas = new Promise<void>(resolver => { liberarDuasConsultas = resolver; });
  let consultas = 0;
  const conclusoes: Array<(fim: FimDaFase) => void> = [];
  const ponte: PonteDeAgente = {
    nome: "Agente de teste",
    async disponibilidade() {
      if (++consultas === 2) liberarDuasConsultas();
      await disponibilidadeLiberada;
      return { ok: true };
    },
    executar() {
      let concluir!: (fim: FimDaFase) => void;
      const fim = new Promise<FimDaFase>(resolver => { concluir = resolver; });
      conclusoes.push(concluir);
      return { cancelar() {}, fim };
    },
  };
  const ingestao = servico(ponte);
  const a = await comFonte(ingestao, FONTE, "a.md");
  const b = await comFonte(ingestao, FONTE, "b.md");
  const primeira = ingestao.ler(a.id);
  const segunda = ingestao.ler(b.id);
  const segundaTerminou = new Promise<void>(resolver => { void segunda.then(() => resolver(), () => resolver()); });
  await Promise.race([duasConsultas, segundaTerminou]);
  liberarDisponibilidade();

  const resultados = await Promise.allSettled([primeira, segunda]);
  expect(resultados.filter(resultado => resultado.status === "fulfilled")).toHaveLength(1);
  expect(resultados.filter(resultado => resultado.status === "rejected").map(resultado => (resultado as PromiseRejectedResult).reason.status)).toEqual([409]);
  expect(conclusoes).toHaveLength(1);
  for (const concluir of conclusoes) concluir({ situacao: "falhou", erro: "fim do teste", recusas: [] });
  await Promise.all([ingestao.esperar(a.id), ingestao.esperar(b.id)]);
});

test("Dado agente ativo Quando encerro a ingestão Então cancelo e aguardo a gravação do estado final", async () => {
  const ponte = new PonteFalsa({ leitor: async (_pedido, _aoEvento, cancelamento) => {
    await cancelamento;
    return { situacao: "cancelada", recusas: [] };
  } });
  const ingestao = servico(ponte);
  const conversa = await comFonte(ingestao);
  await ingestao.ler(conversa.id);

  await ingestao.encerrar();

  expect(ponte.cancelamentos).toBe(1);
  expect(await ingestao.obter(conversa.id)).toMatchObject({ situacao: "cancelada" });
});

test("Dado uma escolha inválida na parada Quando aperto Pode seguir Então recuso sem chamar o escritor", async () => {
  const ponte = new PonteFalsa({ leitor: leitorValido() });
  const { ingestao, conversa } = await naParada(ponte);
  for (const escolha of [
    { takeaways: [], paginas: [0], comentario: "" },
    { takeaways: [9], paginas: [0], comentario: "" },
    { takeaways: [0, 0], paginas: [0], comentario: "" },
    { takeaways: [0], paginas: [1], comentario: "" },
    { takeaways: [0], paginas: [0, 7], comentario: "" },
    { takeaways: [0.5], paginas: [0], comentario: "" },
    { takeaways: [0], paginas: [0], comentario: "x".repeat(5000) },
    { takeaways: "0", paginas: [0], comentario: "" },
    null,
  ]) {
    await expect(ingestao.seguir(conversa.id, escolha as never)).rejects.toMatchObject({ status: 400 });
  }
  expect(ponte.pedidos.map(p => p.papel)).toEqual(["leitor"]);
  const semParada = await comFonte(ingestao);
  await expect(ingestao.seguir(semParada.id, { takeaways: [0], paginas: [0], comentario: "" })).rejects.toMatchObject({ status: 409 });
});

test("Dado o escritor sem login Quando aperto Pode seguir Então recuso sem iniciar a escrita", async () => {
  const ponte = new PonteFalsa({ leitor: leitorValido() });
  const { ingestao, conversa } = await naParada(ponte);
  ponte.disponivel = { ok: false, motivo: "sem login" };
  await expect(ingestao.seguir(conversa.id, { takeaways: [0], paginas: [0], comentario: "" })).rejects.toMatchObject({ status: 503 });
  expect(await ingestao.obter(conversa.id)).toMatchObject({ passo: "parada" });
});

test("Dado a página cortada da lista Quando sigo Então o escritor não a recebe e nada é copiado para ela", async () => {
  const ponte = new PonteFalsa({ leitor: leitorValido() });
  const { ingestao, conversa } = await naParada(ponte);
  await ingestao.seguir(conversa.id, { takeaways: [0, 1, 2], paginas: [0, 1], comentario: "" });
  await ingestao.esperar(conversa.id);
  expect(ponte.pedidos[1]!.mensagem).not.toContain("segundo-cerebro");
  expect(ponte.pedidos[1]!.mensagem).toContain("deixou de fora 1 página");
  expect(existsSync(join(raiz, ".anvilore/ui/copias", conversa.id))).toBe(false);
});

test("Dado fonte grande demais para qualquer janela Quando aperto Ingerir Então recuso sem chamar o agente; acima de 400 KB uso a rota grande", async () => {
  const ponte = new PonteFalsa({ leitor: async () => ({ situacao: "cancelada", recusas: [] }) });
  const ingestao = servico(ponte);
  const enorme = await comFonte(ingestao, "a".repeat(1_150_001), "enorme.md");
  await expect(ingestao.ler(enorme.id)).rejects.toMatchObject({ status: 422 });
  expect(ponte.consultas).toBe(0);
  const grande = await comFonte(ingestao, "a".repeat(400_001), "grande.md");
  await ingestao.ler(grande.id);
  await ingestao.esperar(grande.id);
  expect(ponte.pedidos[0]!.rota).toBe("grande");
});

test("Dado a fonte apagada de raw/ Quando aperto Ingerir Então recuso com a explicação", async () => {
  const ingestao = servico(new PonteFalsa());
  const conversa = await comFonte(ingestao);
  rmSync(join(raiz, "raw/pessoal/llm-wiki.md"));
  await expect(ingestao.ler(conversa.id)).rejects.toMatchObject({ status: 409, message: "A fonte raw/pessoal/llm-wiki.md não está mais em raw/." });
});

test("Dado a mensagem do leitor Quando a monto Então leva fonte, wiki, área e a regra de só ler", () => {
  const conversa = { fonte: "raw/pessoal/x.md", area: "pessoal" } as Conversa;
  const mensagem = mensagemDoLeitor(conversa, "/v/wiki");
  for (const parte of ["raw/pessoal/x.md", "/v/wiki", "Área escolhida pela pessoa: pessoal", "inteira, de uma vez", "só leitura"]) expect(mensagem).toContain(parte);
  expect(mensagemDoLeitor({ fonte: "raw/x.md", area: "" } as Conversa, "/v/wiki")).toContain("A wiki não tem áreas");
});

test("Dado erro de ingestão Quando crio Então guarda o status HTTP", () => {
  const erro = new ErroDeIngestao("x", 418);
  expect(erro).toBeInstanceOf(Error);
  expect(erro.status).toBe(418);
});

test("Dado a ponte que quebra no meio da fase Quando a fase termina Então a conversa mostra a falha inesperada", async () => {
  const ponte = new PonteFalsa({ leitor: async () => { throw new Error("stream corrompido"); } });
  const ingestao = new IngestaoNaInterface(raiz, { ponte });
  expect(ingestao.nomeDoAgente).toBe("Agente falso");
  const conversa = await comFonte(ingestao);
  await ingestao.ler(conversa.id);
  await ingestao.esperar(conversa.id);
  expect(await ingestao.obter(conversa.id)).toMatchObject({ situacao: "erro", erro: "Falha inesperada: stream corrompido" });
});

test("Dado o fechamento padrão Quando o escritor termina Então o servidor roda o fechar real na wiki", async () => {
  const ponte = new PonteFalsa({ leitor: leitorValido(), escritor: escritorQueEscreve });
  const ingestao = new IngestaoNaInterface(raiz, { ponte, ambiente: { ...process.env, ANVILORE_WIKI: "" } });
  const { conversa } = await naParada(ponte, ingestao);
  await ingestao.seguir(conversa.id, { takeaways: [0, 1, 2], paginas: [0, 1, 2], comentario: "" });
  await ingestao.esperar(conversa.id);
  const final = (await ingestao.obter(conversa.id))!;
  expect(final.passo).toBe("revisao");
  expect(final.fechamento!.saida).toContain("FECHAMENTO:");
});

// --- Ingestão a partir de arquivo existente em raw/ (de-raw) ------------------------------------------------

test("Dado arquivo existente em raw/<área> Quando crio conversa de-raw Então cria a conversa apontando para o arquivo sem alterar raw/", async () => {
  const ingestao = servico(new PonteFalsa());
  mkdirSync(join(raiz, "raw/pessoal"), { recursive: true });
  writeFileSync(join(raiz, "raw/pessoal/nota.md"), "conteúdo da nota");
  const conversa = await ingestao.criarDeRaw("raw/pessoal/nota.md");
  expect(conversa).toMatchObject({
    passo: "fonte",
    situacao: "pronta",
    fonte: "raw/pessoal/nota.md",
    area: "pessoal",
    nome: "nota.md",
    bytes: 17,
  });
  expect(await ingestao.obter(conversa.id)).toMatchObject({ id: conversa.id, fonte: "raw/pessoal/nota.md" });
  expect(readFileSync(join(raiz, "raw/pessoal/nota.md"), "utf8")).toBe("conteúdo da nota");
});

test("Dado arquivo na raiz de raw/ Quando crio conversa de-raw Então cria com área vazia", async () => {
  const ingestao = servico(new PonteFalsa());
  mkdirSync(join(raiz, "raw"), { recursive: true });
  writeFileSync(join(raiz, "raw/solta.md"), "solta");
  const conversa = await ingestao.criarDeRaw("raw/solta.md");
  expect(conversa).toMatchObject({
    passo: "fonte",
    situacao: "pronta",
    fonte: "raw/solta.md",
    area: "",
    nome: "solta.md",
    bytes: 5,
  });
});

test("Dado caminho relativo sem o prefixo raw/ Quando crio conversa de-raw Então normaliza para raw/<caminho>", async () => {
  const ingestao = servico(new PonteFalsa());
  mkdirSync(join(raiz, "raw/pessoal"), { recursive: true });
  writeFileSync(join(raiz, "raw/pessoal/guia.md"), "conteúdo");
  const conversa = await ingestao.criarDeRaw("pessoal/guia.md");
  expect(conversa.fonte).toBe("raw/pessoal/guia.md");
  expect(conversa.area).toBe("pessoal");
  expect(conversa.nome).toBe("guia.md");
});

test("Dado caminhos inválidos (vazio, absoluto ou com ..) Quando crio conversa de-raw Então recusa com 400", async () => {
  const ingestao = servico(new PonteFalsa());
  mkdirSync(join(raiz, "raw/pessoal"), { recursive: true });
  writeFileSync(join(raiz, "raw/pessoal/valido.md"), "ok");
  for (const invalido of ["", "   ", "/etc/passwd", "../fora.md", "pessoal/../../fora.md", "raw/../fora.md"]) {
    await expect(ingestao.criarDeRaw(invalido)).rejects.toMatchObject({ status: 400 });
  }
});

test("Dado symlink apontando para fora de raw/ Quando crio conversa de-raw Então recusa com 400", async () => {
  const ingestao = servico(new PonteFalsa());
  mkdirSync(join(raiz, "raw/pessoal"), { recursive: true });
  const externo = join(raiz, "externo.txt");
  writeFileSync(externo, "fora de raw");
  symlinkSync(externo, join(raiz, "raw/pessoal/link-externo.md"));
  await expect(ingestao.criarDeRaw("raw/pessoal/link-externo.md")).rejects.toMatchObject({
    status: 400,
    message: expect.stringContaining("fora de raw/"),
  });
});

test("Dado arquivo inexistente em raw/ Quando crio conversa de-raw Então recusa com 404", async () => {
  const ingestao = servico(new PonteFalsa());
  mkdirSync(join(raiz, "raw/pessoal"), { recursive: true });
  await expect(ingestao.criarDeRaw("raw/pessoal/inexistente.md")).rejects.toMatchObject({
    status: 404,
    message: "Arquivo inexistente em raw/.",
  });
});

test("Dado caminho apontando para diretório Quando crio conversa de-raw Então recusa com 400", async () => {
  const ingestao = servico(new PonteFalsa());
  mkdirSync(join(raiz, "raw/pessoal"), { recursive: true });
  await expect(ingestao.criarDeRaw("raw/pessoal")).rejects.toMatchObject({
    status: 400,
    message: "O caminho aponta para um diretório, não para um arquivo.",
  });
  await expect(ingestao.criarDeRaw("raw")).rejects.toMatchObject({
    status: 400,
    message: "O caminho aponta para um diretório, não para um arquivo.",
  });
});

test("Dado arquivo de raw/ já citado por página na wiki Quando crio conversa de-raw Então recusa com 409", async () => {
  const ingestao = servico(new PonteFalsa());
  mkdirSync(join(raiz, "raw/pessoal"), { recursive: true });
  writeFileSync(join(raiz, "raw/pessoal/ja-ingerido.md"), "dados");
  writeFileSync(
    join(wiki, "pessoal/concepts/ja-ingerido.md"),
    "---\ntitle: Já Ingerido\ntype: concept\nsources:\n  - resource: raw/pessoal/ja-ingerido.md\n---\nCorpo.\n",
  );
  await expect(ingestao.criarDeRaw("raw/pessoal/ja-ingerido.md")).rejects.toMatchObject({
    status: 409,
    message: "O arquivo já foi ingerido na wiki.",
  });
});

test("Dado o fluxo a partir de raw/ Quando crio a conversa Então raw/ permanece intacto byte a byte", async () => {
  const ingestao = servico(new PonteFalsa());
  mkdirSync(join(raiz, "raw/pessoal"), { recursive: true });
  const arq1 = join(raiz, "raw/pessoal/doc1.md");
  const arq2 = join(raiz, "raw/pessoal/doc2.bin");
  writeFileSync(arq1, "# Documento 1\nLinha A\nLinha B\n");
  writeFileSync(arq2, new Uint8Array([0x00, 0xff, 0xfe, 0x12, 0x34]));

  const hashArquivo = (caminho: string) => createHash("sha256").update(readFileSync(caminho)).digest("hex");
  const hash1Antes = hashArquivo(arq1);
  const hash2Antes = hashArquivo(arq2);

  const conversa = await ingestao.criarDeRaw("raw/pessoal/doc1.md");
  expect(conversa.id).toBeDefined();

  expect(hashArquivo(arq1)).toBe(hash1Antes);
  expect(hashArquivo(arq2)).toBe(hash2Antes);
});
