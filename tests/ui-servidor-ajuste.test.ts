import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { iniciarServidorUi } from "../src/ui/servidor/servidor";
import { PonteFalsa } from "./apoio/ponte-falsa";
import { SESSAO } from "./apoio/eventos-claude";
import type { Conversa } from "../src/lib/ui-ingestao";

let raiz: string;
let servidores: Array<{ stop: (forcibly?: boolean) => void }> = [];

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "anvilore-ui-ajuste-"));
  for (const dir of ["wiki/pessoal/sources", "wiki/pessoal/concepts", "raw/pessoal"]) {
    mkdirSync(join(raiz, dir), { recursive: true });
  }
});

afterEach(() => {
  for (const servidor of servidores) servidor.stop(true);
  servidores = [];
  rmSync(raiz, { recursive: true, force: true });
});

async function subirServidor(ponte = new PonteFalsa(), fecharRetorno = { codigo: 0, saida: "FECHAMENTO: OK" }) {
  const app = await iniciarServidorUi(raiz, {
    portaInicial: 0,
    token: "token-teste",
    abrirNavegador: false,
    ponte,
    fechar: async () => fecharRetorno,
  });
  servidores.push(app.servidor);
  const base = `http://127.0.0.1:${app.porta}`;
  const chamar = (rota: string, init: RequestInit = {}, token = "token-teste") =>
    fetch(`${base}${rota}?token=${token}`, {
      ...init,
      headers: { origin: base, ...(init.headers as Record<string, string> | undefined) },
    });
  const postar = (rota: string, corpo?: unknown) =>
    chamar(rota, {
      method: "POST",
      ...(corpo === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) }),
    });
  return { app, base, chamar, postar };
}

describe("Servidor UI — Pedir ajuste na Revisão", () => {
  test("Dado uma página na fila de revisão Quando peço ajuste com pedido válido Então cria conversa de ajuste com a versão (SHA) e página, e o escritor roda restrito àquela página", async () => {
    const caminhoRelativo = "pessoal/concepts/segundo-cerebro.md";
    const conteudoInicial = [
      "---",
      "type: concept",
      "slug: segundo-cerebro",
      "title: Segundo cérebro",
      "tags: [produtividade]",
      "generated:",
      "  by: claude-opus/2026-10",
      "  at: 2026-10-26T14:35:00-03:00",
      "---",
      "",
      "Texto original que precisa de ajuste.",
    ].join("\n");
    writeFileSync(join(raiz, "wiki", caminhoRelativo), conteudoInicial);
    const versao = createHash("sha256").update(conteudoInicial).digest("hex");

    const ponte = new PonteFalsa({
      escritor: async (pedido, aoEvento) => {
        expect(pedido.pagina).toBe(caminhoRelativo);
        expect(pedido.mensagem).toContain("Segunda versão após pedido");
        expect(pedido.papel).toBe("escritor");
        aoEvento({ tipo: "inicio", sessao: SESSAO, autor: "claude-haiku/2.1.311" });
        aoEvento({ tipo: "ferramenta", id: "w1", nome: "Edit", caminho: join(raiz, "wiki", caminhoRelativo) });
        // Simula escrita do novo conteúdo
        const conteudoNovo = conteudoInicial.replace("Texto original que precisa de ajuste.", "Texto ajustado conforme o pedido.");
        writeFileSync(join(raiz, "wiki", caminhoRelativo), conteudoNovo);
        aoEvento({ tipo: "resultado-ferramenta", id: "w1", erro: false, texto: "Editado com sucesso" });
        return { situacao: "concluida", sessao: SESSAO, texto: "Ajuste concluído.", recusas: [] };
      },
    });

    const { postar, chamar, app } = await subirServidor(ponte);

    const resposta = await postar("/api/ajuste", {
      caminho: caminhoRelativo,
      versao,
      pedido: "Segunda versão após pedido: ajuste o texto.",
    });

    expect(resposta.status).toBe(201);
    const conversa = (await resposta.json()) as Conversa;
    expect(conversa.id).toBeDefined();
    expect(conversa.tipo).toBe("ajuste");
    expect(conversa.pagina).toBe(caminhoRelativo);
    expect(conversa.versaoEsperada).toBe(versao);
    expect(conversa.pedido).toBe("Segunda versão após pedido: ajuste o texto.");

    // Aguarda o término da fase
    await app.servidor; // assegura que está rodando
    // Espera a fase concluir
    let obtida: Conversa | undefined;
    for (let i = 0; i < 20; i++) {
      const res = await chamar(`/api/conversas/${conversa.id}`);
      obtida = (await res.json()) as Conversa;
      if (obtida.situacao === "concluida") break;
      await new Promise(r => setTimeout(r, 50));
    }
    expect(obtida?.situacao).toBe("concluida");
    expect(obtida?.passo).toBe("revisao");

    // Verifica que uma cópia de segurança foi gravada em .anvilore/ui/copias/<id>/...
    const copia = join(raiz, ".anvilore/ui/copias", conversa.id, caminhoRelativo);
    expect(existsSync(copia)).toBe(true);
    expect(readFileSync(copia, "utf8")).toBe(conteudoInicial);
  });

  test("Dado um pedido de ajuste com texto vazio Quando envio Então a API recusa com 400", async () => {
    const caminhoRelativo = "pessoal/concepts/segundo-cerebro.md";
    const conteudo = "---\ngenerated:\n  by: claude/2.1\n  at: 2026-10-26T14:35:00-03:00\n---\nCorpo\n";
    writeFileSync(join(raiz, "wiki", caminhoRelativo), conteudo);
    const versao = createHash("sha256").update(conteudo).digest("hex");

    const { postar } = await subirServidor();

    const resposta = await postar("/api/ajuste", {
      caminho: caminhoRelativo,
      versao,
      pedido: "   ",
    });
    expect(resposta.status).toBe(400);
    expect((await resposta.json()) as { mensagens: string[] }).toEqual({
      mensagens: ["O pedido de ajuste não pode ser vazio."],
    });
  });

  test("Dado uma página que mudou no disco entre a exibição e o envio Quando envio Então a API recusa com 409 e aviso para recarregar", async () => {
    const caminhoRelativo = "pessoal/concepts/segundo-cerebro.md";
    const conteudoInicial = "---\ngenerated:\n  by: claude/2.1\n  at: 2026-10-26T14:35:00-03:00\n---\nVersão 1\n";
    writeFileSync(join(raiz, "wiki", caminhoRelativo), conteudoInicial);
    const versaoAntiga = createHash("sha256").update(conteudoInicial).digest("hex");

    // Página é alterada no disco antes de a pessoa enviar o pedido
    writeFileSync(join(raiz, "wiki", caminhoRelativo), conteudoInicial + "\nAlteração externa no disco.\n");

    const { postar } = await subirServidor();

    const resposta = await postar("/api/ajuste", {
      caminho: caminhoRelativo,
      versao: versaoAntiga,
      pedido: "Mudar algo",
    });

    expect(resposta.status).toBe(409);
    const corpo = (await resposta.json()) as { mensagens: string[] };
    expect(corpo.mensagens[0]).toContain("A página mudou desde que você abriu");
  });

  test("Dado uma tentativa do escritor de editar outra página durante o ajuste Quando ele tenta Então a operação é negada e registrada como recusa", async () => {
    const caminhoRelativo = "pessoal/concepts/segundo-cerebro.md";
    const conteudoInicial = "---\ngenerated:\n  by: claude/2.1\n  at: 2026-10-26T14:35:00-03:00\n---\nCorpo\n";
    writeFileSync(join(raiz, "wiki", caminhoRelativo), conteudoInicial);
    const versao = createHash("sha256").update(conteudoInicial).digest("hex");

    const ponte = new PonteFalsa({
      escritor: async (_pedido, aoEvento) => {
        aoEvento({ tipo: "inicio", sessao: SESSAO, autor: "claude-haiku/2.1.311" });
        // Tenta editar outra página não permitida
        aoEvento({ tipo: "ferramenta", id: "w-outra", nome: "Edit", caminho: join(raiz, "wiki/pessoal/concepts/outra.md") });
        aoEvento({ tipo: "resultado-ferramenta", id: "w-outra", erro: true, texto: "Negado pelas permissões da ingestão." });
        return {
          situacao: "concluida",
          sessao: SESSAO,
          texto: "",
          recusas: [{ ferramenta: "Edit", id: "w-outra", caminho: join(raiz, "wiki/pessoal/concepts/outra.md") }],
        };
      },
    });

    const { postar, chamar } = await subirServidor(ponte);

    const res = await postar("/api/ajuste", {
      caminho: caminhoRelativo,
      versao,
      pedido: "Ajuste restrito",
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    let conversa: Conversa | undefined;
    for (let i = 0; i < 20; i++) {
      conversa = (await (await chamar(`/api/conversas/${id}`)).json()) as Conversa;
      if (conversa.situacao === "concluida") break;
      await new Promise(r => setTimeout(r, 50));
    }

    expect(conversa?.recusas.length).toBeGreaterThan(0);
    expect(conversa?.recusas[0]?.caminho).toContain("outra.md");
    expect(conversa?.atividade.some(a => a.verbo === "Recusado" && a.alvo.includes("outra.md"))).toBe(true);
  });

  test("Dado um pedido de ajuste para caminho fora da wiki Quando envio Então a API recusa com 400", async () => {
    const { postar } = await subirServidor();

    const resposta = await postar("/api/ajuste", {
      caminho: "../../etc/passwd",
      versao: "a".repeat(64),
      pedido: "Invadir",
    });
    expect(resposta.status).toBe(400);
  });

  test("Dado o ajuste concluído com sucesso Quando o fechamento roda Então a página volta para a fila como nova geração e a aprovação anterior deixa de valer", async () => {
    const caminhoRelativo = "pessoal/concepts/segundo-cerebro.md";
    const conteudoInicial = [
      "---",
      "type: concept",
      "slug: segundo-cerebro",
      "title: Segundo cérebro",
      "tags: [produtividade]",
      "generated:",
      "  by: claude-opus/2026-10",
      "  at: 2026-10-20T10:00:00-03:00",
      "verified:",
      "  - by: human:iago",
      "    at: 2026-10-20T11:00:00-03:00",
      "---",
      "",
      "Texto aprovado anteriormente.",
    ].join("\n");
    writeFileSync(join(raiz, "wiki", caminhoRelativo), conteudoInicial);
    const versaoAntiga = createHash("sha256").update(conteudoInicial).digest("hex");

    const ponte = new PonteFalsa({
      escritor: async (_pedido, aoEvento) => {
        aoEvento({ tipo: "inicio", sessao: SESSAO, autor: "claude-haiku/2.1.311" });
        aoEvento({ tipo: "ferramenta", id: "w1", nome: "Edit", caminho: join(raiz, "wiki", caminhoRelativo) });
        // Simula atualização com nova geração posterior à aprovação
        const conteudoNovo = [
          "---",
          "type: concept",
          "slug: segundo-cerebro",
          "title: Segundo cérebro",
          "tags: [produtividade]",
          "generated:",
          "  by: claude-haiku/2.1.311",
          "  at: 2026-11-01T21:00:00-03:00",
          "verified:",
          "  - by: human:iago",
          "    at: 2026-10-20T11:00:00-03:00",
          "---",
          "",
          "Texto ajustado com nova geração.",
        ].join("\n");
        writeFileSync(join(raiz, "wiki", caminhoRelativo), conteudoNovo);
        aoEvento({ tipo: "resultado-ferramenta", id: "w1", erro: false, texto: "Editado" });
        return { situacao: "concluida", sessao: SESSAO, texto: "Pronto", recusas: [] };
      },
    });

    const { postar, chamar } = await subirServidor(ponte, { codigo: 1, saida: "ERRO: página gerada sem aprovação humana: pessoal/concepts/segundo-cerebro.md\nFECHAMENTO: FAIL no passo validar-wiki" });

    const res = await postar("/api/ajuste", {
      caminho: caminhoRelativo,
      versao: versaoAntiga,
      pedido: "Atualizar parágrafo",
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    let conversa: Conversa | undefined;
    for (let i = 0; i < 20; i++) {
      conversa = (await (await chamar(`/api/conversas/${id}`)).json()) as Conversa;
      if (conversa.situacao === "concluida") break;
      await new Promise(r => setTimeout(r, 50));
    }
    expect(conversa?.situacao).toBe("concluida");
    expect(conversa?.passo).toBe("revisao");

    // Consulta fila de rascunhos pela API
    const filaRes = await chamar("/api/rascunhos");
    expect(filaRes.status).toBe(200);
    const fila = (await filaRes.json()) as Array<{ caminho: string; status: string; versao: string; aprovacaoAnterior?: string }>;
    const item = fila.find(r => r.caminho === caminhoRelativo);
    expect(item).toBeDefined();
    expect(item?.status).toBe("atualizada");
    expect(item?.aprovacaoAnterior).toBe("deixa de valer");
    expect(item?.versao).not.toBe(versaoAntiga);

    // Tentativa de aprovar com a versão antiga é recusada
    const aprovarVelha = await postar("/api/aprovar", { caminho: caminhoRelativo, versao: versaoAntiga });
    expect(aprovarVelha.status).toBe(409);

    // Aprovação com a nova versão é aceita
    const aprovarNova = await postar("/api/aprovar", { caminho: caminhoRelativo, versao: item!.versao });
    expect(aprovarNova.status).toBe(200);
  });
});
