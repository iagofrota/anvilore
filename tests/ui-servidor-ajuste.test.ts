import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { iniciarServidorUi } from "../src/ui/servidor/servidor";
import { PonteFalsa } from "./apoio/ponte-falsa";
import { SESSAO } from "./apoio/eventos-claude";
import { argumentosDoPapel } from "../src/lib/ponte-claude-code";
import type { Conversa } from "../src/lib/ui-ingestao";
import { invalidarAprovacaoVigente } from "../src/lib/ui-ingestao";
import { lerFrontmatter } from "../src/lib/frontmatter";
import { estadoAprovacaoHumana } from "../src/lib/okf";

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
  test("Dado frontmatter malformado Quando peço ajuste Então a cópia-base é preservada e o ajuste começa", async () => {
    const caminhoRelativo = "pessoal/concepts/segundo-cerebro.md";
    const conteudo = "---\ntype: [malformado\n---\nTexto que ainda pode receber ajuste.";
    writeFileSync(join(raiz, "wiki", caminhoRelativo), conteudo);
    const { postar } = await subirServidor();
    const resposta = await postar("/api/ajuste", {
      caminho: caminhoRelativo,
      versao: createHash("sha256").update(conteudo).digest("hex"),
      pedido: "Ajustar mesmo com frontmatter inválido",
    });
    expect(resposta.status).toBe(201);
    const { id } = await resposta.json() as { id: string };
    expect(readFileSync(join(raiz, ".anvilore/ui/copias", id, caminhoRelativo), "utf8")).toBe(conteudo);
  });

  test("Dado ajuste aprovado Quando peço outro ajuste Então Mudanças usa a página aprovada como nova base", async () => {
    const caminhoRelativo = "pessoal/concepts/segundo-cerebro.md";
    const inicial = [
      "---", "type: concept", "slug: segundo-cerebro", "title: Segundo cérebro",
      "generated:", "  by: claude-opus/2026-10", "  at: 2026-10-26T14:35:00-03:00",
      "verified:", "  by: human:iago", "  at: 2026-10-26T14:36:00-03:00", "---", "", "Texto original aprovado.",
    ].join("\n");
    writeFileSync(join(raiz, "wiki", caminhoRelativo), inicial);
    let rodada = 0;
    const ponte = new PonteFalsa({ escritor: async (_pedido, aoEvento) => {
      rodada++;
      aoEvento({ tipo: "inicio", sessao: SESSAO, autor: "claude-haiku/2.1.311" });
      aoEvento({ tipo: "ferramenta", id: `w${rodada}`, nome: "Edit", caminho: join(raiz, "wiki", caminhoRelativo) });
      const corpo = rodada === 1 ? "Primeiro ajuste aprovado." : "Segundo ajuste pendente.";
      const conteudo = inicial.replace("Texto original aprovado.", corpo)
        .replace("2026-10-26T14:35:00-03:00", `2026-10-26T14:3${rodada + 5}:00-03:00`);
      writeFileSync(join(raiz, "wiki", caminhoRelativo), conteudo);
      aoEvento({ tipo: "resultado-ferramenta", id: `w${rodada}`, erro: false, texto: "Editado" });
      return { situacao: "concluida", sessao: SESSAO, texto: "Ajuste feito", recusas: [] };
    }});
    const { postar, chamar } = await subirServidor(ponte);
    const fazerAjuste = async () => {
      const pagina = readFileSync(join(raiz, "wiki", caminhoRelativo), "utf8");
      const resposta = await postar("/api/ajuste", { caminho: caminhoRelativo, versao: createHash("sha256").update(pagina).digest("hex"), pedido: "Ajustar" });
      expect(resposta.status).toBe(201);
      const { id } = await resposta.json() as { id: string };
      let conversa: Conversa | undefined;
      for (let i = 0; i < 30; i++) {
        const respostaConversa = await chamar(`/api/conversas/${id}`);
        if (!respostaConversa.ok) throw new Error(`GET conversa ${id}: ${respostaConversa.status} ${await respostaConversa.text()}`);
        conversa = await respostaConversa.json() as Conversa;
        if (conversa.situacao !== "rodando") break;
        await new Promise(r => setTimeout(r, 50));
      }
      expect(conversa?.situacao).toBe("concluida");
    };

    await fazerAjuste();
    const filaUm = await (await chamar("/api/rascunhos")).json() as Array<{ caminho: string; versao: string; anterior?: string }>;
    expect(filaUm.find(item => item.caminho === caminhoRelativo)?.anterior).toBe(inicial);
    const aprovar = await postar("/api/aprovar", { caminho: caminhoRelativo, versao: filaUm[0]!.versao });
    expect(aprovar.status).toBe(200);
    const aprovada = readFileSync(join(raiz, "wiki", caminhoRelativo), "utf8");

    await fazerAjuste();
    const filaDois = await (await chamar("/api/rascunhos")).json() as Array<{ caminho: string; anterior?: string }>;
    expect(filaDois.find(item => item.caminho === caminhoRelativo)?.anterior).toBe(aprovada);
  });

  test("Dado dois ajustes ainda pendentes Quando peço o segundo Então a base continua a original", async () => {
    const caminhoRelativo = "pessoal/concepts/segundo-cerebro.md";
    const inicial = "---\ntype: concept\nslug: segundo-cerebro\ntitle: Segundo cérebro\ngenerated:\n  by: agente/teste\n  at: 2026-10-26T14:35:00-03:00\n---\nTexto original pendente.";
    writeFileSync(join(raiz, "wiki", caminhoRelativo), inicial);
    let rodada = 0;
    const ponte = new PonteFalsa({ escritor: async (_pedido, aoEvento) => {
      rodada++;
      aoEvento({ tipo: "inicio", sessao: SESSAO, autor: "claude-haiku/2.1.311" });
      aoEvento({ tipo: "ferramenta", id: `w${rodada}`, nome: "Edit", caminho: join(raiz, "wiki", caminhoRelativo) });
      writeFileSync(join(raiz, "wiki", caminhoRelativo), `---\ntype: concept\nslug: segundo-cerebro\ntitle: Segundo cérebro\ngenerated:\n  by: claude-haiku/2.1.311\n  at: 2026-11-06T20:0${rodada}:00-03:00\n---\nAjuste pendente ${rodada}.`);
      aoEvento({ tipo: "resultado-ferramenta", id: `w${rodada}`, erro: false, texto: "Editado" });
      return { situacao: "concluida", sessao: SESSAO, texto: "Ajuste feito", recusas: [] };
    }});
    const { postar, chamar } = await subirServidor(ponte);
    const fazerAjuste = async () => {
      const pagina = readFileSync(join(raiz, "wiki", caminhoRelativo), "utf8");
      const resposta = await postar("/api/ajuste", { caminho: caminhoRelativo, versao: createHash("sha256").update(pagina).digest("hex"), pedido: "Ajustar" });
      expect(resposta.status).toBe(201);
      const { id } = await resposta.json() as { id: string };
      let conversa: Conversa | undefined;
      for (let i = 0; i < 30; i++) {
        conversa = await (await chamar(`/api/conversas/${id}`)).json() as Conversa;
        if (conversa.situacao !== "rodando") break;
        await new Promise(r => setTimeout(r, 50));
      }
      expect(conversa?.situacao).toBe("concluida");
    };
    await fazerAjuste();
    await fazerAjuste();
    const fila = await (await chamar("/api/rascunhos")).json() as Array<{ caminho: string; anterior?: string }>;
    expect(fila.find(item => item.caminho === caminhoRelativo)?.anterior).toBe(inicial);
  });

  async function criarAjusteComPaginaAprovada(escritor: (aoEvento: (evento: import("../src/lib/ponte-agente").EventoDoAgente) => void) => Promise<import("../src/lib/ponte-agente").FimDaFase>) {
    const caminhoRelativo = "pessoal/concepts/segundo-cerebro.md";
    const conteudoInicial = [
      "---",
      "type: concept",
      "slug: segundo-cerebro",
      "title: Segundo cérebro",
      "generated:",
      "  by: claude-opus/2026-10",
      "  at: 2026-10-26T14:35:00-03:00",
      "verified:",
      "  by: human:iago",
      "  at: 2026-10-26T14:36:00-03:00",
      "---",
      "",
      "Texto original aprovado.",
    ].join("\n");
    writeFileSync(join(raiz, "wiki", caminhoRelativo), conteudoInicial);
    const versao = createHash("sha256").update(conteudoInicial).digest("hex");
    const ponte = new PonteFalsa({ escritor: async (_pedido, aoEvento) => escritor(aoEvento) });
    const { postar, chamar } = await subirServidor(ponte);
    const resposta = await postar("/api/ajuste", { caminho: caminhoRelativo, versao, pedido: "Ajuste o texto" });
    expect(resposta.status).toBe(201);
    const { id } = (await resposta.json()) as { id: string };
    let conversa: Conversa | undefined;
    for (let i = 0; i < 30; i++) {
      conversa = (await (await chamar(`/api/conversas/${id}`)).json()) as Conversa;
      if (conversa.situacao !== "rodando") break;
      await new Promise(r => setTimeout(r, 50));
    }
    return { chamar, conversa, caminhoRelativo, conteudoInicial };
  }

  function escreverCorpoAlterado(caminhoRelativo: string) {
    return (aoEvento: (evento: import("../src/lib/ponte-agente").EventoDoAgente) => void) => {
      aoEvento({ tipo: "inicio", sessao: SESSAO, autor: "claude-haiku/2.1.311" });
      aoEvento({ tipo: "ferramenta", id: "w1", nome: "Edit", caminho: join(raiz, "wiki", caminhoRelativo) });
      const alterado = [
        "---",
        "type: concept",
        "slug: segundo-cerebro",
        "title: Segundo cérebro",
        "generated:",
        "  by: claude-haiku/2.1.311",
        "  at: 2026-10-26T14:35:00-03:00",
        "verified:",
        "  by: human:iago",
        "  at: 2026-10-26T14:36:00-03:00",
        "---",
        "",
        "Texto parcialmente alterado.",
      ].join("\n");
      writeFileSync(join(raiz, "wiki", caminhoRelativo), alterado);
      aoEvento({ tipo: "resultado-ferramenta", id: "w1", erro: false, texto: "Editado" });
    };
  }

  test("Dado que o escritor altera uma página aprovada e termina cancelado Então invalida a aprovação e a página entra na revisão", async () => {
    const caminhoRelativo = "pessoal/concepts/segundo-cerebro.md";
    const fluxo = await criarAjusteComPaginaAprovada(async aoEvento => {
      escreverCorpoAlterado(caminhoRelativo)(aoEvento);
      return { situacao: "cancelada", recusas: [] };
    });
    const conteudo = readFileSync(join(raiz, "wiki", caminhoRelativo), "utf8");
    expect(fluxo.conversa?.situacao).toBe("cancelada");
    expect(conteudo).toContain("Texto parcialmente alterado.");
    expect(estadoAprovacaoHumana(lerFrontmatter(conteudo)!)).not.toBe("vigente");
    const fila = (await (await fluxo.chamar("/api/rascunhos")).json()) as Array<{ caminho: string }>;
    expect(fila.some(item => item.caminho === caminhoRelativo)).toBe(true);
  });

  test("Dado ajuste sobre frontmatter com alias que não pode ser reescrito sem perda Quando a invalidação falha Então a conversa registra a falha e a aprovação não some em silêncio", async () => {
    const caminhoRelativo = "pessoal/concepts/segundo-cerebro.md";
    const inicial = [
      "---", "type: concept", "slug: segundo-cerebro", "generated: &geracao",
      "  by: claude-opus/2026-10", "  at: 2026-10-26T14:35:00-03:00", "title: *geracao",
      "verified:", "  by: human:iago", "  at: 2030-01-01T12:00:00-03:00", "---", "", "Texto inicial aprovado.",
    ].join("\n");
    writeFileSync(join(raiz, "wiki", caminhoRelativo), inicial);
    const ponte = new PonteFalsa({ escritor: async (_pedido, aoEvento) => {
      aoEvento({ tipo: "inicio", sessao: SESSAO, autor: "claude-haiku/2.1.311" });
      aoEvento({ tipo: "ferramenta", id: "w1", nome: "Edit", caminho: join(raiz, "wiki", caminhoRelativo) });
      writeFileSync(join(raiz, "wiki", caminhoRelativo), inicial.replace("Texto inicial aprovado.", "Texto ajustado."));
      aoEvento({ tipo: "resultado-ferramenta", id: "w1", erro: false, texto: "Editado" });
      return { situacao: "concluida", sessao: SESSAO, texto: "Ajuste feito", recusas: [] };
    }});
    const { postar, chamar } = await subirServidor(ponte);

    const resposta = await postar("/api/ajuste", {
      caminho: caminhoRelativo,
      versao: createHash("sha256").update(inicial).digest("hex"),
      pedido: "Ajustar o texto",
    });
    expect(resposta.status).toBe(201);
    const { id } = await resposta.json() as { id: string };
    let conversa: Conversa | undefined;
    for (let i = 0; i < 30; i++) {
      conversa = await (await chamar(`/api/conversas/${id}`)).json() as Conversa;
      if (conversa.situacao !== "rodando") break;
      await new Promise(r => setTimeout(r, 50));
    }

    expect(conversa).toMatchObject({ situacao: "erro", erro: "A edição não revisada foi descartada e a página aprovada foi restaurada." });
    const textoFinal = readFileSync(join(raiz, "wiki", caminhoRelativo), "utf8");
    expect(textoFinal).toBe(inicial);
    expect(conversa?.mensagens?.join(" ")).toContain("página aprovada foi restaurada");
    expect(estadoAprovacaoHumana(lerFrontmatter(textoFinal)!)).toBe("vigente");
  });

  test("Dado que o escritor deixa generated duplicado numa página aprovada Quando o ajuste conclui Então restaura os bytes aprovados e informa o descarte", async () => {
    const inicial = [
      "---", "type: concept", "slug: segundo-cerebro", "title: Segundo cérebro",
      "generated:", "  by: claude-opus/2026-10", "  at: 2026-10-26T14:35:00-03:00",
      "verified:", "  by: human:iago", "  at: 2026-10-26T14:36:00-03:00", "---", "", "Texto original aprovado.",
    ].join("\n");
    const fluxo = await criarAjusteComPaginaAprovada(async aoEvento => {
      aoEvento({ tipo: "inicio", sessao: SESSAO, autor: "claude-haiku/2.1.311" });
      aoEvento({ tipo: "ferramenta", id: "w1", nome: "Edit", caminho: join(raiz, "wiki", "pessoal/concepts/segundo-cerebro.md") });
      const geracaoDuplicada = "generated:\n  by: claude-opus/2026-10\n  at: 2026-10-26T14:35:00-03:00\n";
      const malformado = inicial.replace("verified:", `${geracaoDuplicada}verified:`)
        .replace("Texto original aprovado.", "Texto alterado não revisado.");
      writeFileSync(join(raiz, "wiki/pessoal/concepts/segundo-cerebro.md"), malformado);
      aoEvento({ tipo: "resultado-ferramenta", id: "w1", erro: false, texto: "Editado" });
      return { situacao: "concluida", sessao: SESSAO, texto: "Ajuste feito", recusas: [] };
    });
    const conteudoFinal = readFileSync(join(raiz, "wiki", fluxo.caminhoRelativo), "utf8");
    expect(fluxo.conversa).toMatchObject({ situacao: "erro" });
    expect(conteudoFinal).toBe(fluxo.conteudoInicial);
    expect(fluxo.conversa?.mensagens?.join(" ")).toContain("página aprovada foi restaurada");
  });

  test("Dado que o escritor preserva os bytes de uma página aprovada Quando o ajuste conclui Então a aprovação e os bytes permanecem iguais", async () => {
    const fluxo = await criarAjusteComPaginaAprovada(async aoEvento => {
      const caminho = join(raiz, "wiki/pessoal/concepts/segundo-cerebro.md");
      const bytesAprovados = readFileSync(caminho);
      aoEvento({ tipo: "inicio", sessao: SESSAO, autor: "claude-haiku/2.1.311" });
      aoEvento({ tipo: "ferramenta", id: "w1", nome: "Edit", caminho });
      writeFileSync(caminho, bytesAprovados);
      aoEvento({ tipo: "resultado-ferramenta", id: "w1", erro: false, texto: "Sem alteração" });
      return { situacao: "concluida", sessao: SESSAO, texto: "Sem alterações", recusas: [] };
    });
    const caminho = join(raiz, "wiki", fluxo.caminhoRelativo);
    const paginaFinal = readFileSync(caminho, "utf8");
    expect(fluxo.conversa?.situacao).toBe("concluida");
    expect(paginaFinal).toBe(fluxo.conteudoInicial);
    expect(estadoAprovacaoHumana(lerFrontmatter(paginaFinal)!)).toBe("vigente");
  });

  test("Dado ajuste rodando persistido com página aprovada malformada Quando o servidor inicia Então restaura a cópia antes da primeira rota", async () => {
    const caminhoRelativo = "pessoal/concepts/segundo-cerebro.md";
    const conteudoAprovado = [
      "---", "type: concept", "slug: segundo-cerebro", "title: Segundo cérebro",
      "generated:", "  by: claude-opus/2026-10", "  at: 2026-10-26T14:35:00-03:00",
      "verified:", "  by: human:iago", "  at: 2026-10-26T14:36:00-03:00", "---", "", "Texto original aprovado.",
    ].join("\n");
    const versaoEsperada = createHash("sha256").update(conteudoAprovado).digest("hex");
    const id = "ajuste-recuperacao";
    const copia = join(raiz, ".anvilore/ui/copias", id, caminhoRelativo);
    const conversas = join(raiz, ".anvilore/ui/conversas");
    mkdirSync(join(raiz, ".anvilore/ui/copias", id, "pessoal/concepts"), { recursive: true });
    mkdirSync(conversas, { recursive: true });
    writeFileSync(copia, conteudoAprovado);
    const geracaoDuplicada = "generated:\n  by: claude-opus/2026-10\n  at: 2026-10-26T14:35:00-03:00\n";
    writeFileSync(join(raiz, "wiki", caminhoRelativo), conteudoAprovado.replace("verified:", `${geracaoDuplicada}verified:`).replace("Texto original aprovado.", "Texto alterado não revisado."));
    writeFileSync(join(conversas, `${id}.json`), JSON.stringify({
      versao: 1, id, criadaEm: "2026-11-07T00:00:00.000Z", atualizadaEm: "2026-11-07T00:00:00.000Z",
      tipo: "ajuste", pagina: caminhoRelativo, versaoEsperada, pedido: "Ajustar", area: "pessoal",
      fonte: "raw/pessoal/origem.md", nome: "origem.md", bytes: 1, passo: "escrita", situacao: "rodando",
      atividade: [], avisos: [], recusas: [],
    }));

    const { chamar } = await subirServidor();
    const resposta = await chamar("/api/rascunhos");
    expect(resposta.status).toBe(200);
    const paginaFinal = readFileSync(join(raiz, "wiki", caminhoRelativo), "utf8");
    expect(paginaFinal).toBe(conteudoAprovado);
    expect(estadoAprovacaoHumana(lerFrontmatter(paginaFinal)!)).toBe("vigente");
  });

  test("Dado que a cópia aprovada está ausente e a invalidação falha Quando o ajuste termina Então move a página para quarentena fora da wiki", async () => {
    const raw = join(raiz, "raw/pessoal/origem-intocada.md");
    writeFileSync(raw, "bytes de raw preservados");
    const fluxo = await criarAjusteComPaginaAprovada(async aoEvento => {
      const id = readdirSync(join(raiz, ".anvilore/ui/copias"))[0]!;
      rmSync(join(raiz, ".anvilore/ui/copias", id, "pessoal/concepts/segundo-cerebro.md"));
      aoEvento({ tipo: "inicio", sessao: SESSAO, autor: "claude-haiku/2.1.311" });
      aoEvento({ tipo: "ferramenta", id: "w1", nome: "Edit", caminho: join(raiz, "wiki", "pessoal/concepts/segundo-cerebro.md") });
      const malformado = "---\ngenerated:\n  by: agente/teste\n  at: 2026-10-26T14:35:00-03:00\ngenerated:\n  by: agente/teste\n  at: 2026-10-26T14:35:00-03:00\nverified:\n  by: human:iago\n  at: 2030-01-01T00:00:00-03:00\n---\nTexto não revisado.";
      writeFileSync(join(raiz, "wiki/pessoal/concepts/segundo-cerebro.md"), malformado);
      expect(estadoAprovacaoHumana(lerFrontmatter(malformado)!)).toBe("vigente");
      expect(() => invalidarAprovacaoVigente(malformado, "agente/teste")).toThrow("generated duplicada");
      aoEvento({ tipo: "resultado-ferramenta", id: "w1", erro: false, texto: "Editado" });
      return { situacao: "concluida", sessao: SESSAO, texto: "Ajuste feito", recusas: [] };
    });
    const caminhoPagina = join(raiz, "wiki", fluxo.caminhoRelativo);
    const id = readdirSync(join(raiz, ".anvilore/ui/conversas"))[0]!.replace(/\.json$/, "");
    const quarentena = join(raiz, ".anvilore/ui/quarentena", id, fluxo.caminhoRelativo);
    expect(fluxo.conversa).toMatchObject({ situacao: "erro" });
    expect(fluxo.conversa?.mensagens?.join(" ")).toContain("quarentena");
    expect(existsSync(caminhoPagina)).toBe(false);
    expect(existsSync(quarentena)).toBe(true);
    expect(readFileSync(quarentena, "utf8")).toContain("Texto não revisado.");
    expect(readFileSync(raw, "utf8")).toBe("bytes de raw preservados");
  });

  test("Dado que o escritor altera uma página aprovada e termina com falha Então invalida a aprovação e a página entra na revisão", async () => {
    const caminhoRelativo = "pessoal/concepts/segundo-cerebro.md";
    const fluxo = await criarAjusteComPaginaAprovada(async aoEvento => {
      escreverCorpoAlterado(caminhoRelativo)(aoEvento);
      return { situacao: "falhou", erro: "falha original do escritor", recusas: [] };
    });
    const conteudo = readFileSync(join(raiz, "wiki", caminhoRelativo), "utf8");
    expect(fluxo.conversa).toMatchObject({ situacao: "erro", erro: "falha original do escritor" });
    expect(conteudo).toContain("Texto parcialmente alterado.");
    expect(estadoAprovacaoHumana(lerFrontmatter(conteudo)!)).not.toBe("vigente");
    const fila = (await (await fluxo.chamar("/api/rascunhos")).json()) as Array<{ caminho: string }>;
    expect(fila.some(item => item.caminho === caminhoRelativo)).toBe(true);
  });

  test("Dado que o escritor altera uma página aprovada e a promessa rejeita Então invalida a aprovação e a página entra na revisão", async () => {
    const caminhoRelativo = "pessoal/concepts/segundo-cerebro.md";
    const fluxo = await criarAjusteComPaginaAprovada(async aoEvento => {
      escreverCorpoAlterado(caminhoRelativo)(aoEvento);
      throw new Error("stream corrompido");
    });
    const conteudo = readFileSync(join(raiz, "wiki", caminhoRelativo), "utf8");
    expect(fluxo.conversa).toMatchObject({ situacao: "erro", erro: "Falha inesperada: stream corrompido" });
    expect(conteudo).toContain("Texto parcialmente alterado.");
    expect(estadoAprovacaoHumana(lerFrontmatter(conteudo)!)).not.toBe("vigente");
    const fila = (await (await fluxo.chamar("/api/rascunhos")).json()) as Array<{ caminho: string }>;
    expect(fila.some(item => item.caminho === caminhoRelativo)).toBe(true);
  });

  test("Dado que o ajuste é cancelado sem alterar o arquivo Então preserva a aprovação e os bytes originais", async () => {
    const caminhoRelativo = "pessoal/concepts/segundo-cerebro.md";
    const fluxo = await criarAjusteComPaginaAprovada(async () => ({ situacao: "cancelada", recusas: [] }));
    const conteudoFinal = readFileSync(join(raiz, "wiki", caminhoRelativo), "utf8");
    expect(conteudoFinal).toBe(fluxo.conteudoInicial);
    expect(estadoAprovacaoHumana(lerFrontmatter(conteudoFinal)!)).toBe("vigente");
  });

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

  test("Dado uma recusa emitida pela ferramenta durante o ajuste Quando a conversa é atualizada Então registra o evento no histórico de atividade e na lista de recusas", async () => {
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

  test("Dado um pedido de ajuste na Revisão Quando o escritor é disparado Então os argumentos do processo restringem a edição estritamente à página alvo e não incluem padrões amplos nem resume", async () => {
    const caminhoRelativo = "pessoal/concepts/segundo-cerebro.md";
    const conteudoInicial = "---\ngenerated:\n  by: claude/2.1\n  at: 2026-10-26T14:35:00-03:00\n---\nCorpo\n";
    writeFileSync(join(raiz, "wiki", caminhoRelativo), conteudoInicial);
    const versao = createHash("sha256").update(conteudoInicial).digest("hex");

    const ponte = new PonteFalsa();
    const { postar, chamar } = await subirServidor(ponte);

    const res = await postar("/api/ajuste", {
      caminho: caminhoRelativo,
      versao,
      pedido: "Ajuste estrito",
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    let conversa: Conversa | undefined;
    for (let i = 0; i < 20; i++) {
      conversa = (await (await chamar(`/api/conversas/${id}`)).json()) as Conversa;
      if (conversa.situacao === "concluida") break;
      await new Promise(r => setTimeout(r, 50));
    }

    expect(ponte.pedidos.length).toBe(1);
    const pedido = ponte.pedidos[0]!;
    expect(pedido.papel).toBe("escritor");
    expect(pedido.pagina).toBe(caminhoRelativo);

    const args = argumentosDoPapel(pedido);
    const inicioAllowed = args.indexOf("--allowedTools") + 1;
    const fimAllowed = args.findIndex((arg, i) => i >= inicioAllowed && arg.startsWith("--"));
    const allowed = args.slice(inicioAllowed, fimAllowed < 0 ? undefined : fimAllowed);
    const edits = allowed.filter(x => x.startsWith("Edit("));

    // Apenas uma regra Edit para o arquivo exato
    expect(edits).toEqual([`Edit(//${raiz.replaceAll("\\", "/").replace(/^\/+/, "")}/wiki/${caminhoRelativo})`]);
    // Sem padrão glob amplo
    expect(allowed.some(x => x.includes("*") && x.startsWith("Edit"))).toBe(false);
    // Sem resume
    expect(args).not.toContain("--resume");
  });

  test("Dado um pedido de ajuste para caminho contendo metacaracteres de glob ou backslash Quando envio Então a API recusa com 400 e mensagem explicativa", async () => {
    const { postar } = await subirServidor();
    const mensagemEsperada = "Não dá para pedir ajuste nesta página porque o nome dela ou da pasta do vault tem um caractere especial (* ? [ ] { } ! \\). Renomeie para usar o ajuste.";
    const caracteres = ["*", "?", "[", "]", "{", "}", "!", "\\"];
    for (const char of caracteres) {
      const caminho = `pessoal/concepts/nota-${char}.md`;
      const res = await postar("/api/ajuste", {
        caminho,
        versao: "a".repeat(64),
        pedido: "Ajuste com metacaractere",
      });
      expect(res.status).toBe(400);
      const json = await res.json() as { mensagens: string[] };
      expect(json.mensagens).toEqual([mensagemEsperada]);
    }
  });

  test("Dado raiz do vault com caractere especial (! ou [) Quando peço ajuste de página segura Então a API recusa com 400 e mensagem explicativa", async () => {
    const raizEspecial = mkdtempSync(join(tmpdir(), "anvilore-vault-[2026]!-"));
    try {
      mkdirSync(join(raizEspecial, "wiki/pessoal/concepts"), { recursive: true });
      const conteudo = "---\ntype: concept\nslug: nota-segura\ntitle: Segura\ngenerated:\n  by: teste/1.0\n  at: 2026-11-01T10:00:00-03:00\n---\nConteudo seguro\n";
      const caminho = "pessoal/concepts/nota-segura.md";
      writeFileSync(join(raizEspecial, "wiki", caminho), conteudo);
      const versao = createHash("sha256").update(conteudo).digest("hex");

      const app = await iniciarServidorUi(raizEspecial, { portaInicial: 0, token: "token-especial", abrirNavegador: false });
      servidores.push(app.servidor);
      const base = `http://127.0.0.1:${app.porta}`;
      const res = await fetch(`${base}/api/ajuste?token=token-especial`, {
        method: "POST",
        headers: { origin: base, "content-type": "application/json" },
        body: JSON.stringify({ caminho, versao, pedido: "Ajuste em vault especial" }),
      });
      expect(res.status).toBe(400);
      const json = await res.json() as { mensagens: string[] };
      expect(json.mensagens).toEqual(["Não dá para pedir ajuste nesta página porque o nome dela ou da pasta do vault tem um caractere especial (* ? [ ] { } ! \\). Renomeie para usar o ajuste."]);
    } finally {
      rmSync(raizEspecial, { recursive: true, force: true });
    }
  });

  test("Dado rascunhos na fila Quando consulto /api/rascunhos Então indica ajustavel: true para páginas seguras e ajustavel: false com motivo para páginas ou vaults com caracteres especiais", async () => {
    const conteudoNormal = "---\ntype: concept\nslug: normal\ntitle: Normal\ngenerated:\n  by: teste/1.0\n  at: 2026-11-01T10:00:00-03:00\n---\nNormal\n";
    const conteudoExclamacao = "---\ntype: concept\nslug: nota-alerta!\ntitle: Alerta\ngenerated:\n  by: teste/1.0\n  at: 2026-11-01T10:00:00-03:00\n---\nCom exclamacao\n";
    writeFileSync(join(raiz, "wiki/pessoal/concepts/normal.md"), conteudoNormal);
    writeFileSync(join(raiz, "wiki/pessoal/concepts/nota!.md"), conteudoExclamacao);

    const { chamar } = await subirServidor();
    const res = await chamar("/api/rascunhos");
    expect(res.status).toBe(200);
    const rascunhos = (await res.json()) as Array<{ caminho: string; ajustavel: boolean; motivoNaoAjustavel?: string }>;

    const itemNormal = rascunhos.find(r => r.caminho === "pessoal/concepts/normal.md");
    expect(itemNormal?.ajustavel).toBe(true);
    expect(itemNormal?.motivoNaoAjustavel).toBeUndefined();

    const itemExclamacao = rascunhos.find(r => r.caminho === "pessoal/concepts/nota!.md");
    expect(itemExclamacao?.ajustavel).toBe(false);
    expect(itemExclamacao?.motivoNaoAjustavel).toBe("Não dá para pedir ajuste nesta página porque o nome dela ou da pasta do vault tem um caractere especial (* ? [ ] { } ! \\). Renomeie para usar o ajuste.");
  });

  test("Dado a interface só de Revisão Quando consulto /api/rascunhos Então cada item vem com ajustavel: false e o motivo em linguagem simples", async () => {
    const conteudo = (slug: string) => `---\ntype: concept\nslug: ${slug}\ntitle: ${slug}\ngenerated:\n  by: teste/1.0\n  at: 2026-11-01T10:00:00-03:00\n---\nTexto\n`;
    writeFileSync(join(raiz, "wiki/pessoal/concepts/normal.md"), conteudo("normal"));
    writeFileSync(join(raiz, "wiki/pessoal/concepts/nota!.md"), conteudo("nota-alerta"));

    const app = await iniciarServidorUi(raiz, { portaInicial: 0, token: "token-teste", abrirNavegador: false, soRevisao: true });
    servidores.push(app.servidor);
    const res = await fetch(`http://127.0.0.1:${app.porta}/api/rascunhos?token=token-teste`);
    expect(res.status).toBe(200);
    const rascunhos = (await res.json()) as Array<{ caminho: string; ajustavel: boolean; motivoNaoAjustavel?: string }>;
    expect(rascunhos.length).toBeGreaterThanOrEqual(2);
    for (const item of rascunhos) {
      expect(item.ajustavel).toBe(false);
      expect(item.motivoNaoAjustavel).toBe("Pedir ajuste só funciona com a interface completa aberta.");
    }
  });

  test("Dado links simbólicos apontando para raw, fora da wiki ou outra página Quando envio ajuste Então a API recusa com 400 e arquivos sentinela permanecem intactos", async () => {
    // 1. Arquivo alvo legítimo e sentinela em raw
    const conteudoRaw = "DADO BRUTO EM RAW - SENTINELA";
    const rawArquivo = join(raiz, "raw/pessoal/fonte.md");
    writeFileSync(rawArquivo, conteudoRaw);

    // 2. Arquivo sentinela fora da wiki
    const foraDir = join(raiz, "fora");
    mkdirSync(foraDir, { recursive: true });
    const foraArquivo = join(foraDir, "segredo.md");
    writeFileSync(foraArquivo, "SEGREDO FORA DA WIKI - SENTINELA");

    // 3. Outra página legítima na wiki
    const outraArquivo = join(raiz, "wiki/pessoal/concepts/outra.md");
    const conteudoOutra = "---\ngenerated:\n  by: test/1.0\n  at: 2026-11-01T10:00:00-03:00\n---\nOutra página - SENTINELA";
    writeFileSync(outraArquivo, conteudoOutra);

    // 4. Cria symlinks na wiki:
    // a) symlink de arquivo apontando para raw
    const symlinkRaw = join(raiz, "wiki/pessoal/concepts/alias-raw.md");
    symlinkSync(rawArquivo, symlinkRaw);

    // b) symlink de arquivo apontando para fora da wiki
    const symlinkFora = join(raiz, "wiki/pessoal/concepts/alias-fora.md");
    symlinkSync(foraArquivo, symlinkFora);

    // c) symlink de diretório apontando para fora da wiki
    const symlinkDirFora = join(raiz, "wiki/dir-fora");
    symlinkSync(foraDir, symlinkDirFora);

    // d) symlink de arquivo apontando para outra página dentro da wiki
    const symlinkOutra = join(raiz, "wiki/pessoal/concepts/alias-outra.md");
    symlinkSync(outraArquivo, symlinkOutra);

    const hashRaw = createHash("sha256").update(conteudoRaw).digest("hex");
    const hashFora = createHash("sha256").update("SEGREDO FORA DA WIKI - SENTINELA").digest("hex");
    const hashOutra = createHash("sha256").update(conteudoOutra).digest("hex");

    const ponte = new PonteFalsa({
      escritor: async () => {
        throw new Error("Ponte não deveria ter sido executada para symlink!");
      },
    });

    const { postar } = await subirServidor(ponte);

    // Tentativa 1: symlink para raw
    const resRaw = await postar("/api/ajuste", { caminho: "pessoal/concepts/alias-raw.md", versao: hashRaw, pedido: "Ataque raw" });
    expect(resRaw.status).toBe(400);

    // Tentativa 2: symlink para fora
    const resFora = await postar("/api/ajuste", { caminho: "pessoal/concepts/alias-fora.md", versao: hashFora, pedido: "Ataque fora" });
    expect(resFora.status).toBe(400);

    // Tentativa 3: symlink de diretório para fora
    const resDirFora = await postar("/api/ajuste", { caminho: "dir-fora/segredo.md", versao: hashFora, pedido: "Ataque dir fora" });
    expect(resDirFora.status).toBe(400);

    // Tentativa 4: symlink para outra página
    const resOutra = await postar("/api/ajuste", { caminho: "pessoal/concepts/alias-outra.md", versao: hashOutra, pedido: "Ataque outra" });
    expect(resOutra.status).toBe(400);

    // Confere que zero execuções da ponte ocorreram
    expect(ponte.pedidos.length).toBe(0);

    // Confere por arquivos sentinela que os bytes NÃO mudaram
    expect(readFileSync(rawArquivo, "utf8")).toBe(conteudoRaw);
    expect(readFileSync(foraArquivo, "utf8")).toBe("SEGREDO FORA DA WIKI - SENTINELA");
    expect(readFileSync(outraArquivo, "utf8")).toBe(conteudoOutra);
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

  test("Dado um rascunho que já possui cópia de baseline de ingestão anterior Quando peço ajuste Então preserva a cópia de baseline original e não a substitui pelo rascunho intermediário", async () => {
    const caminhoRelativo = "pessoal/concepts/segundo-cerebro.md";
    const conteudoBaseOriginal = "---\ngenerated:\n  by: claude/2.1\n  at: 2026-10-20T10:00:00-03:00\nverified:\n  - by: human:iago\n    at: 2026-10-20T11:00:00-03:00\n---\nVersão baseline antes da ingestão.";
    const copiaOriginalDir = join(raiz, ".anvilore/ui/copias/ingestao-antiga", "pessoal/concepts");
    mkdirSync(copiaOriginalDir, { recursive: true });
    writeFileSync(join(copiaOriginalDir, "segundo-cerebro.md"), conteudoBaseOriginal);

    // Rascunho intermediário pendente na wiki após ingestão
    const rascunhoIntermediario = "---\ngenerated:\n  by: claude/2.1\n  at: 2026-11-01T20:00:00-03:00\nverified:\n  - by: human:iago\n    at: 2026-10-20T11:00:00-03:00\n---\nPrimeiro rascunho gerado aguardando revisão.";
    writeFileSync(join(raiz, "wiki", caminhoRelativo), rascunhoIntermediario);
    const versaoIntermediaria = createHash("sha256").update(rascunhoIntermediario).digest("hex");

    const ponte = new PonteFalsa({
      escritor: async (_pedido, aoEvento) => {
        aoEvento({ tipo: "inicio", sessao: SESSAO, autor: "claude-haiku/2.1.311" });
        aoEvento({ tipo: "ferramenta", id: "w1", nome: "Edit", caminho: join(raiz, "wiki", caminhoRelativo) });
        const conteudoAjustado = "---\ngenerated:\n  by: claude/2.1\n  at: 2026-11-01T21:00:00-03:00\nverified:\n  - by: human:iago\n    at: 2026-10-20T11:00:00-03:00\n---\nSegundo rascunho ajustado.";
        writeFileSync(join(raiz, "wiki", caminhoRelativo), conteudoAjustado);
        aoEvento({ tipo: "resultado-ferramenta", id: "w1", erro: false, texto: "Editado" });
        return { situacao: "concluida", sessao: SESSAO, texto: "Ajuste feito", recusas: [] };
      },
    });

    const { postar, chamar } = await subirServidor(ponte);

    const res = await postar("/api/ajuste", {
      caminho: caminhoRelativo,
      versao: versaoIntermediaria,
      pedido: "Ajustar texto",
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

    // Verifica que a cópia de ajuste NÃO foi criada para não sobrescrever a linha de base
    const copiaAjuste = join(raiz, ".anvilore/ui/copias", id, caminhoRelativo);
    expect(existsSync(copiaAjuste)).toBe(false);

    // Consulta rascunhos e confere que 'anterior' continua sendo o baseline original pré-ingestão
    const filaRes = await chamar("/api/rascunhos");
    const fila = (await filaRes.json()) as Array<{ caminho: string; anterior?: string }>;
    const item = fila.find(r => r.caminho === caminhoRelativo);
    expect(item?.anterior).toBe(conteudoBaseOriginal);
  });

  test("Dado uma página em ajuste ativo Quando tento aprovar Então a aprovação é recusada com 409 e código 3 e após o término a página alterada continua na fila", async () => {
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

    let liberarAprovacao!: () => void;
    const aprovacaoTentada = new Promise<void>(resolve => { liberarAprovacao = resolve; });
    let avisarInicio!: () => void;
    const inicioAjuste = new Promise<void>(resolve => { avisarInicio = resolve; });

    const ponte = new PonteFalsa({
      escritor: async (_pedido, aoEvento) => {
        avisarInicio();
        // Espera a tentativa de aprovação acontecer enquanto o ajuste está ativo
        await aprovacaoTentada;
        aoEvento({ tipo: "inicio", sessao: SESSAO, autor: "claude-haiku/2.1.311" });
        aoEvento({ tipo: "ferramenta", id: "w1", nome: "Edit", caminho: join(raiz, "wiki", caminhoRelativo) });
        const conteudoNovo = [
          "---",
          "type: concept",
          "slug: segundo-cerebro",
          "title: Segundo cérebro",
          "tags: [produtividade]",
          "generated:",
          "  by: claude-haiku/2.1.311",
          "  at: 2026-11-06T19:00:00-03:00",
          "---",
          "",
          "Texto ajustado conforme o pedido.",
        ].join("\n");
        writeFileSync(join(raiz, "wiki", caminhoRelativo), conteudoNovo);
        aoEvento({ tipo: "resultado-ferramenta", id: "w1", erro: false, texto: "Editado com sucesso" });
        return { situacao: "concluida", sessao: SESSAO, texto: "Ajuste concluído.", recusas: [] };
      },
    });

    const { postar, chamar } = await subirServidor(ponte);

    // Inicia o ajuste
    const respostaAjuste = await postar("/api/ajuste", {
      caminho: caminhoRelativo,
      versao,
      pedido: "Ajuste o texto",
    });
    expect(respostaAjuste.status).toBe(201);
    const { id } = (await respostaAjuste.json()) as { id: string };

    // Aguarda o escritor do ajuste iniciar
    await inicioAjuste;

    // Enquanto o ajuste está ativo: na fila de rascunhos, a página mostra aprovavel: false e o motivo
    const filaDuranteRes = await chamar("/api/rascunhos");
    expect(filaDuranteRes.status).toBe(200);
    const filaDurante = (await filaDuranteRes.json()) as Array<{ caminho: string; aprovavel: boolean; motivoNaoAprovavel?: string }>;
    const itemDurante = filaDurante.find(r => r.caminho === caminhoRelativo);
    expect(itemDurante).toBeDefined();
    expect(itemDurante?.aprovavel).toBe(false);
    expect(itemDurante?.motivoNaoAprovavel).toBe("Esta página está em ajuste; aprove depois que o ajuste terminar.");

    // Tentar aprovar enquanto o ajuste está ativo é recusado com 409 e código 3
    const respostaAprovar = await postar("/api/aprovar", {
      caminho: caminhoRelativo,
      versao,
    });
    expect(respostaAprovar.status).toBe(409);
    const corpoAprovar = (await respostaAprovar.json()) as { codigo: number; mensagens: string[] };
    expect(corpoAprovar.codigo).toBe(3);
    expect(corpoAprovar.mensagens).toEqual(["Esta página está em ajuste; aprove depois que o ajuste terminar."]);

    // Libera o escritor para terminar a escrita do ajuste
    liberarAprovacao();

    // Aguarda a conversa de ajuste concluir
    let conversa: Conversa | undefined;
    for (let i = 0; i < 20; i++) {
      conversa = (await (await chamar(`/api/conversas/${id}`)).json()) as Conversa;
      if (conversa.situacao === "concluida") break;
      await new Promise(r => setTimeout(r, 50));
    }
    expect(conversa?.situacao).toBe("concluida");

    // Após o ajuste terminar com o conteúdo alterado:
    // A página continua na fila de revisão (não pode ficar 'vigente')
    const filaAposRes = await chamar("/api/rascunhos");
    expect(filaAposRes.status).toBe(200);
    const filaApos = (await filaAposRes.json()) as Array<{ caminho: string; status: string; versao: string; aprovavel: boolean }>;
    const itemApos = filaApos.find(r => r.caminho === caminhoRelativo);
    expect(itemApos).toBeDefined();
    expect(itemApos?.aprovavel).toBe(true);
    expect(itemApos?.versao).not.toBe(versao);
  });

  test("Dado uma página que sofre ajuste com alteração de conteúdo e escritor preserva verified na FORMA DE MAPA com at futuro Quando o ajuste termina Então a aprovação antiga não vale e estadoAprovacaoHumana não é vigente", async () => {
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
      "Texto original.",
    ].join("\n");
    writeFileSync(join(raiz, "wiki", caminhoRelativo), conteudoInicial);
    const versao = createHash("sha256").update(conteudoInicial).digest("hex");

    const timestampFuturo = "2030-01-01T12:00:00-03:00";
    const ponte = new PonteFalsa({
      escritor: async (_pedido, aoEvento) => {
        aoEvento({ tipo: "inicio", sessao: SESSAO, autor: "claude-haiku/2.1.311" });
        aoEvento({ tipo: "ferramenta", id: "w1", nome: "Edit", caminho: join(raiz, "wiki", caminhoRelativo) });
        // Simula escritor que alterou o corpo mas incluiu verified na forma de mapa com timestamp futuro
        const conteudoNovo = [
          "---",
          "type: concept",
          "slug: segundo-cerebro",
          "title: Segundo cérebro",
          "tags: [produtividade]",
          "generated:",
          "  by: claude-haiku/2.1.311",
          `  at: ${timestampFuturo}`,
          "verified:",
          "  by: human:iago",
          `  at: ${timestampFuturo}`,
          "---",
          "",
          "Texto modificado pelo ajuste.",
        ].join("\n");
        writeFileSync(join(raiz, "wiki", caminhoRelativo), conteudoNovo);
        aoEvento({ tipo: "resultado-ferramenta", id: "w1", erro: false, texto: "Editado" });
        return { situacao: "concluida", sessao: SESSAO, texto: "Ajuste concluído.", recusas: [] };
      },
    });

    const { postar, chamar } = await subirServidor(ponte);

    const resAjuste = await postar("/api/ajuste", {
      caminho: caminhoRelativo,
      versao,
      pedido: "Mudar o texto",
    });
    expect(resAjuste.status).toBe(201);
    const { id } = (await resAjuste.json()) as { id: string };

    let conversa: Conversa | undefined;
    for (let i = 0; i < 20; i++) {
      conversa = (await (await chamar(`/api/conversas/${id}`)).json()) as Conversa;
      if (conversa.situacao === "concluida") break;
      await new Promise(r => setTimeout(r, 50));
    }
    expect(conversa?.situacao).toBe("concluida");

    // Prova final: depois do ajuste com conteúdo alterado, estadoAprovacaoHumana NÃO é vigente
    const conteudoDisco = readFileSync(join(raiz, "wiki", caminhoRelativo), "utf8");
    const fm = lerFrontmatter(conteudoDisco);
    expect(fm).toBeDefined();
    expect(estadoAprovacaoHumana(fm!)).not.toBe("vigente");
    expect(estadoAprovacaoHumana(fm!)).toBe("antiga");

    const filaRes = await chamar("/api/rascunhos");
    const fila = (await filaRes.json()) as Array<{ caminho: string; status: string; aprovacaoAnterior?: string }>;
    const item = fila.find(r => r.caminho === caminhoRelativo);
    expect(item).toBeDefined();
    expect(item?.status).toBe("atualizada");
    expect(item?.aprovacaoAnterior).toBe("deixa de valer");
  });

  test("Dado uma página que sofre ajuste com alteração de conteúdo e escritor preserva verified na FORMA DE LISTA com at futuro Quando o ajuste termina Então a aprovação antiga não vale e estadoAprovacaoHumana não é vigente", async () => {
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
      "Texto original.",
    ].join("\n");
    writeFileSync(join(raiz, "wiki", caminhoRelativo), conteudoInicial);
    const versao = createHash("sha256").update(conteudoInicial).digest("hex");

    const timestampFuturo = "2030-01-01T12:00:00-03:00";
    const ponte = new PonteFalsa({
      escritor: async (_pedido, aoEvento) => {
        aoEvento({ tipo: "inicio", sessao: SESSAO, autor: "claude-haiku/2.1.311" });
        aoEvento({ tipo: "ferramenta", id: "w1", nome: "Edit", caminho: join(raiz, "wiki", caminhoRelativo) });
        // Simula escritor que alterou o corpo mas incluiu verified na forma de lista com timestamp futuro
        const conteudoNovo = [
          "---",
          "type: concept",
          "slug: segundo-cerebro",
          "title: Segundo cérebro",
          "tags: [produtividade]",
          "generated:",
          "  by: claude-haiku/2.1.311",
          `  at: ${timestampFuturo}`,
          "verified:",
          "  - by: human:iago",
          `    at: ${timestampFuturo}`,
          "---",
          "",
          "Texto modificado pelo ajuste.",
        ].join("\n");
        writeFileSync(join(raiz, "wiki", caminhoRelativo), conteudoNovo);
        aoEvento({ tipo: "resultado-ferramenta", id: "w1", erro: false, texto: "Editado" });
        return { situacao: "concluida", sessao: SESSAO, texto: "Ajuste concluído.", recusas: [] };
      },
    });

    const { postar, chamar } = await subirServidor(ponte);

    const resAjuste = await postar("/api/ajuste", {
      caminho: caminhoRelativo,
      versao,
      pedido: "Mudar o texto",
    });
    expect(resAjuste.status).toBe(201);
    const { id } = (await resAjuste.json()) as { id: string };

    let conversa: Conversa | undefined;
    for (let i = 0; i < 20; i++) {
      conversa = (await (await chamar(`/api/conversas/${id}`)).json()) as Conversa;
      if (conversa.situacao === "concluida") break;
      await new Promise(r => setTimeout(r, 50));
    }
    expect(conversa?.situacao).toBe("concluida");

    // Prova final: depois do ajuste com conteúdo alterado, estadoAprovacaoHumana NÃO é vigente
    const conteudoDisco = readFileSync(join(raiz, "wiki", caminhoRelativo), "utf8");
    const fm = lerFrontmatter(conteudoDisco);
    expect(fm).toBeDefined();
    expect(estadoAprovacaoHumana(fm!)).not.toBe("vigente");
    expect(estadoAprovacaoHumana(fm!)).toBe("antiga");

    const filaRes = await chamar("/api/rascunhos");
    const fila = (await filaRes.json()) as Array<{ caminho: string; status: string; aprovacaoAnterior?: string }>;
    const item = fila.find(r => r.caminho === caminhoRelativo);
    expect(item).toBeDefined();
    expect(item?.status).toBe("atualizada");
    expect(item?.aprovacaoAnterior).toBe("deixa de valer");
  });

  test("Dado uma página que sofre ajuste com alteração de conteúdo e escritor preserva verified na FORMA DE MAPA com at passado Quando o ajuste termina Então a aprovação antiga não vale e estadoAprovacaoHumana não é vigente", async () => {
    const caminhoRelativo = "pessoal/concepts/segundo-cerebro.md";
    const timestampPassado = "2026-10-01T12:00:00-03:00";
    const conteudoInicial = [
      "---",
      "type: concept",
      "slug: segundo-cerebro",
      "title: Segundo cérebro",
      "tags: [produtividade]",
      "generated:",
      "  by: claude-opus/2026-10",
      `  at: ${timestampPassado}`,
      "verified:",
      "  by: human:iago",
      `  at: ${timestampPassado}`,
      "---",
      "",
      "Texto original.",
    ].join("\n");
    writeFileSync(join(raiz, "wiki", caminhoRelativo), conteudoInicial);
    const versao = createHash("sha256").update(conteudoInicial).digest("hex");

    const ponte = new PonteFalsa({
      escritor: async (_pedido, aoEvento) => {
        aoEvento({ tipo: "inicio", sessao: SESSAO, autor: "claude-haiku/2.1.311" });
        aoEvento({ tipo: "ferramenta", id: "w1", nome: "Edit", caminho: join(raiz, "wiki", caminhoRelativo) });
        // Simula escritor que alterou o corpo mas preservou verified na forma de mapa com timestamp passado
        const conteudoNovo = [
          "---",
          "type: concept",
          "slug: segundo-cerebro",
          "title: Segundo cérebro",
          "tags: [produtividade]",
          "generated:",
          "  by: claude-haiku/2.1.311",
          `  at: ${timestampPassado}`,
          "verified:",
          "  by: human:iago",
          `  at: ${timestampPassado}`,
          "---",
          "",
          "Texto modificado pelo ajuste.",
        ].join("\n");
        writeFileSync(join(raiz, "wiki", caminhoRelativo), conteudoNovo);
        aoEvento({ tipo: "resultado-ferramenta", id: "w1", erro: false, texto: "Editado" });
        return { situacao: "concluida", sessao: SESSAO, texto: "Ajuste concluído.", recusas: [] };
      },
    });

    const { postar, chamar } = await subirServidor(ponte);

    const resAjuste = await postar("/api/ajuste", {
      caminho: caminhoRelativo,
      versao,
      pedido: "Mudar o texto",
    });
    expect(resAjuste.status).toBe(201);
    const { id } = (await resAjuste.json()) as { id: string };

    let conversa: Conversa | undefined;
    for (let i = 0; i < 20; i++) {
      conversa = (await (await chamar(`/api/conversas/${id}`)).json()) as Conversa;
      if (conversa.situacao === "concluida") break;
      await new Promise(r => setTimeout(r, 50));
    }
    expect(conversa?.situacao).toBe("concluida");

    // Prova final: depois do ajuste com conteúdo alterado, estadoAprovacaoHumana NÃO é vigente
    const conteudoDisco = readFileSync(join(raiz, "wiki", caminhoRelativo), "utf8");
    const fm = lerFrontmatter(conteudoDisco);
    expect(fm).toBeDefined();
    expect(estadoAprovacaoHumana(fm!)).not.toBe("vigente");
    expect(estadoAprovacaoHumana(fm!)).toBe("antiga");

    const filaRes = await chamar("/api/rascunhos");
    const fila = (await filaRes.json()) as Array<{ caminho: string; status: string; aprovacaoAnterior?: string }>;
    const item = fila.find(r => r.caminho === caminhoRelativo);
    expect(item).toBeDefined();
    expect(item?.status).toBe("atualizada");
    expect(item?.aprovacaoAnterior).toBe("deixa de valer");
  });
});

describe("invalidarAprovacaoVigente", () => {
  test("Dado campos irmãos com chaves entre aspas depois de generated Quando invalido aprovação Então preservo os campos e só troco generated", () => {
    const conteudo = [
      "---",
      "type: concept",
      "slug: segundo-cerebro",
      "generated:",
      "  by: claude-haiku/2.1.311",
      "  at: 2026-11-06T19:00:00-03:00",
      '"verified":',
      "  by: human:iago",
      "  at: 2030-01-01T12:00:00-03:00",
      '"title": Segundo cérebro',
      "'tags': [uma, duas]",
      "---",
      "",
      "Texto.",
    ].join("\n");
    const antes = lerFrontmatter(conteudo)!;

    const depois = invalidarAprovacaoVigente(conteudo, "escritor", new Date("2026-11-06T19:00:00-03:00"));
    const fmDepois = lerFrontmatter(depois)!;
    const { generated: _geracaoAntes, ...camposAntes } = antes;
    const { generated: _geracaoDepois, ...camposDepois } = fmDepois;

    expect(camposDepois).toEqual(camposAntes);
    expect(fmDepois.generated).toMatchObject({ by: "escritor" });
  });

  test("Dado generated com chave entre aspas Quando invalido aprovação Então atualizo a única chave generated", () => {
    const conteudo = [
      "---",
      "type: concept",
      '"generated":',
      "  by: claude-haiku/2.1.311",
      "  at: 2026-11-06T19:00:00-03:00",
      '"verified":',
      "  by: human:iago",
      "  at: 2030-01-01T12:00:00-03:00",
      "---",
      "",
      "Texto.",
    ].join("\n");

    const depois = invalidarAprovacaoVigente(conteudo, "escritor", new Date("2026-11-06T19:00:00-03:00"));
    const fmDepois = lerFrontmatter(depois)!;

    expect(depois.match(/^(?:generated|\"generated\"|'generated')\s*:/gm)).toHaveLength(1);
    expect(fmDepois.generated).toMatchObject({ by: "escritor" });
  });

  test("Dado frontmatter com alias que a substituição textual não preserva Quando invalido aprovação Então falho antes de devolver texto alterado", () => {
    const conteudo = [
      "---",
      "type: concept",
      "slug: segundo-cerebro",
      "generated: &geracao",
      "  by: claude-haiku/2.1.311",
      "  at: 2026-11-06T19:00:00-03:00",
      "title: *geracao",
      "verified:",
      "  by: human:iago",
      "  at: 2030-01-01T12:00:00-03:00",
      "---",
      "",
      "Texto.",
    ].join("\n");
    expect(estadoAprovacaoHumana(lerFrontmatter(conteudo)!)).toBe("vigente");

    expect(() => invalidarAprovacaoVigente(conteudo, "escritor", new Date("2026-11-06T19:00:00-03:00"))).toThrow();
    expect(estadoAprovacaoHumana(lerFrontmatter(conteudo)!)).toBe("vigente");
  });

  test("Dado verified na forma de mapa com at futuro Quando invalido aprovação Então generated.at é estritamente maior que verified.at e estadoAprovacaoHumana é antiga", () => {
    const conteudo = [
      "---",
      "type: concept",
      "slug: segundo-cerebro",
      "title: Segundo cérebro",
      "generated:",
      "  by: claude-haiku/2.1.311",
      "  at: 2026-11-06T19:00:00-03:00",
      "verified:",
      "  by: human:iago",
      "  at: 2030-01-01T12:00:00-03:00",
      "---",
      "",
      "Texto.",
    ].join("\n");
    const novo = invalidarAprovacaoVigente(conteudo, "escritor", new Date("2026-11-06T19:00:00-03:00"));
    const fm = lerFrontmatter(novo);
    expect(fm).toBeDefined();
    expect(estadoAprovacaoHumana(fm!)).toBe("antiga");
  });

  test("Dado verified na forma de lista com at futuro Quando invalido aprovação Então generated.at é estritamente maior que o maior verified.at e estadoAprovacaoHumana é antiga", () => {
    const conteudo = [
      "---",
      "type: concept",
      "slug: segundo-cerebro",
      "title: Segundo cérebro",
      "generated:",
      "  by: claude-haiku/2.1.311",
      "  at: 2026-11-06T19:00:00-03:00",
      "verified:",
      "  - by: human:iago",
      "    at: 2030-01-01T12:00:00-03:00",
      "---",
      "",
      "Texto.",
    ].join("\n");
    const novo = invalidarAprovacaoVigente(conteudo, "escritor", new Date("2026-11-06T19:00:00-03:00"));
    const fm = lerFrontmatter(novo);
    expect(fm).toBeDefined();
    expect(estadoAprovacaoHumana(fm!)).toBe("antiga");
  });

  test("Dado verified na forma de mapa com at passado Quando invalido aprovação Então generated.at usa agora e estadoAprovacaoHumana é antiga", () => {
    const conteudo = [
      "---",
      "type: concept",
      "slug: segundo-cerebro",
      "title: Segundo cérebro",
      "generated:",
      "  by: claude-haiku/2.1.311",
      "  at: 2026-10-01T12:00:00-03:00",
      "verified:",
      "  by: human:iago",
      "  at: 2026-10-01T12:00:00-03:00",
      "---",
      "",
      "Texto.",
    ].join("\n");
    const novo = invalidarAprovacaoVigente(conteudo, "escritor", new Date("2026-11-06T19:00:00-03:00"));
    const fm = lerFrontmatter(novo);
    expect(fm).toBeDefined();
    expect(estadoAprovacaoHumana(fm!)).toBe("antiga");
  });
});
