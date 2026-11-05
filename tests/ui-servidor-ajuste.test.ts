import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { iniciarServidorUi } from "../src/ui/servidor/servidor";
import { PonteFalsa } from "./apoio/ponte-falsa";
import { SESSAO } from "./apoio/eventos-claude";
import { argumentosDoPapel } from "../src/lib/ponte-claude-code";
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
});
