import { test, expect } from "../apoio/fixtures";
import { instantaneo, mesmaArvore } from "../apoio/vault";
import { FONTE } from "../../tests/apoio/ingestao-exemplo";
import { paginaGerada } from "../apoio/paginas";
import { guardarEvidencias } from "../apoio/visuais";
import { roteiroComEscritorParado, roteiroComFechamentoComErro, roteiroComLeitorParado, roteiroComRecusaRaw, roteiroDeLeituraInvalida, roteiroSemLogin } from "../apoio/roteiros";

const chamada = (rota: string) => (url: URL) => url.pathname === rota;

test("[C11][C16][C18][C20][C05][C06] Dado uma fonte escolhida Quando a pessoa conduz a parada e aprova Então a wiki só muda após o aval e fica validada", async ({ page, app, agente, oraculo, vault }) => {
  let conversaId = "";
  const segundoCerebroAntes = await vault.ler("wiki/pessoal/concepts/segundo-cerebro.md");
  await test.step("[C11] abrir a interface e enviar a fonte pela tela", async () => {
    await vault.escrever("wiki/pessoal/index.md", "# Pessoal\n\n- [[segundo-cerebro]]\n- [[llm-wiki]]\n");
    await page.goto(app.url);
    await expect(page.getByRole("navigation", { name: "Telas" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Revisão" })).toBeVisible();
    await guardarEvidencias(page, "chat");
    const antesDaPausa = await instantaneo(vault.wiki);
    const enviou = page.waitForResponse(resposta => chamada("/api/fontes")(new URL(resposta.url())) && resposta.request().method() === "POST");
    await page.locator('input[type="file"]').setInputFiles({ name: "llm-wiki.md", mimeType: "text/markdown", buffer: Buffer.from(FONTE) });
    await page.getByRole("button", { name: "Ingerir", exact: true }).click();
    const respostaEnviada = await enviou;
    expect(respostaEnviada.status()).toBe(201);
    conversaId = (await respostaEnviada.json() as { id: string }).id;
    await expect(page.getByRole("button", { name: "Pode seguir" })).toBeVisible();
    const conversa = await oraculo.get<{ fonte: string; situacao: string; passo: string }>(`/api/conversas/${conversaId}`);
    expect(conversa).toMatchObject({ fonte: "raw/pessoal/llm-wiki.md", situacao: "esperando", passo: "parada" });
    expect(await vault.ler("raw/pessoal/llm-wiki.md")).toEqual(Buffer.from(FONTE));
    expect(mesmaArvore(antesDaPausa, await instantaneo(vault.wiki))).toBe(true);
    expect(await oraculo.get<unknown[]>("/api/rascunhos")).toEqual([]);
    expect(await agente.invocacoes("leitor")).toHaveLength(1);
    expect(await agente.invocacoes("escritor")).toHaveLength(0);
  });

  await test.step("[C16][C18] escolher pontos e páginas; o escritor recebe as escolhas", async () => {
    await page.getByLabel("pessoal/concepts/rag.md").uncheck();
    await page.getByLabel("Comentário para o escritor").fill("Use apenas o conceito central e mantenha o exemplo curto.");
    const seguiu = page.waitForResponse(resposta => resposta.url().includes("/seguir") && resposta.request().method() === "POST");
    await page.getByRole("button", { name: "Pode seguir" }).click();
    expect((await seguiu).status()).toBe(200);
    await expect(page.getByText("2 rascunhos esperam você")).toBeVisible();
    const [registro] = await agente.invocacoes("escritor");
    const argv = registro?.argv as string[];
    const pedido = argv[argv.indexOf("-p") + 1]!;
    expect(pedido).toContain("Use apenas o conceito central e mantenha o exemplo curto.");
    expect(pedido).toContain("deixou de fora 1 página");
    expect(pedido).not.toContain("pessoal/concepts/rag.md");
    expect(argv).toContain("--resume");
    expect(await vault.ler(`.anvilore/ui/copias/${conversaId}/pessoal/concepts/segundo-cerebro.md`)).toEqual(segundoCerebroAntes);
    await expect(page.getByRole("link", { name: "Revisar agora" })).toBeVisible();
  });

  await test.step("[C20][C05][C06] revisar mudanças, aprovar e conferir a saída real", async () => {
    const rawAntes = await instantaneo(vault.raw);
    await page.getByRole("link", { name: "Revisar agora" }).click();
    const itemAtualizado = page.getByRole("option").filter({ hasText: "Segundo cérebro" });
    await expect(itemAtualizado).toBeVisible();
    await itemAtualizado.click();
    await page.getByRole("tab", { name: "Mudanças" }).click();
    await expect(page.locator(".diff-line.adicionada").filter({ hasText: "Versão revisada pelo" })).toBeVisible();
    await expect(page.locator(".diff-line.removida").filter({ hasText: "Versão anterior da" })).toBeVisible();
    await page.getByRole("tab", { name: "Markdown" }).click();
    await expect(page.locator(".markdown-view")).toContainText("Versão revisada pelo escritor.");
    const original = await vault.ler("wiki/pessoal/concepts/segundo-cerebro.md");
    const aprovacao = page.waitForResponse(resposta => resposta.url().includes("/api/aprovar") && resposta.request().method() === "POST");
    await page.getByRole("button", { name: "Aprovar" }).click();
    expect((await aprovacao).status()).toBe(200);
    await expect(page.getByText("1 aguardando você")).toBeVisible();
    const validacao = page.waitForResponse(resposta => resposta.url().includes("/api/validar") && resposta.request().method() === "POST");
    await page.getByRole("button", { name: "Aprovar" }).click();
    expect((await validacao).status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Tudo revisado" })).toBeVisible();
    await expect(page.locator(".result-badge")).toContainText("CÓDIGO 0 · PASS");
    const final = (await vault.ler("wiki/pessoal/concepts/segundo-cerebro.md")).toString();
    const semVerified = (conteudo: string) => conteudo.replace(/^verified:\n(?:[ \t].*\n)*/m, "");
    expect(semVerified(final)).toBe(semVerified(original.toString()));
    expect(final).toContain("by: human:teste");
    expect((await vault.ler("wiki/pessoal/concepts/segundo-cerebro.md")).toString()).toContain("Versão revisada pelo escritor.");
    expect(mesmaArvore(rawAntes, await instantaneo(vault.raw))).toBe(true);
    expect((await vault.ler("wiki/pessoal/concepts/rag.md").catch(() => Buffer.from(""))).byteLength).toBe(0);
  });
});

test.describe("[C17] relatório de leitura inválido", () => {
  test.use({ roteiro: roteiroDeLeituraInvalida() });
  test("Dado um relatório que cita trecho inexistente Quando a leitura termina Então nada é escrito e a falha persiste ao recarregar", async ({ page, app, oraculo, vault }) => {
    await vault.escrever("wiki/pessoal/index.md", "# Pessoal\n\n- [[segundo-cerebro]]\n");
    const antes = await instantaneo(vault.wiki);
    await page.goto(app.url);
    await page.locator('input[type="file"]').setInputFiles({ name: "llm-wiki.md", mimeType: "text/markdown", buffer: Buffer.from(FONTE) });
    await page.getByRole("button", { name: "Ingerir", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("O relatório do leitor não passou na conferência. Nada foi escrito.");
    await expect(page.getByRole("button", { name: "Ler de novo" })).toBeVisible();
    const id = new URL(page.url()).hash.split("/").at(-1)!;
    await expect.poll(async () => (await oraculo.get<{ situacao: string }>(`/api/conversas/${id}`)).situacao).toBe("erro");
    expect(mesmaArvore(antes, await instantaneo(vault.wiki))).toBe(true);
    await page.reload();
    await expect(page.getByRole("alert")).toContainText("O relatório do leitor não passou na conferência. Nada foi escrito.");
    expect(mesmaArvore(antes, await instantaneo(vault.wiki))).toBe(true);
    expect(await oraculo.get<unknown[]>("/api/rascunhos")).toEqual([]);
  });
});

test.describe("[C19] exibir a recusa e conferir o contrato enviado", () => {
  test.use({ roteiro: roteiroComRecusaRaw() });
  test("Dado o escritor falso tenta gravar em raw Quando a ferramenta devolve recusa Então a tela a mostra e os bytes continuam iguais", async ({ page, app, agente, vault }) => {
    const original = Buffer.from(FONTE);
    await page.goto(app.url);
    await page.locator('input[type="file"]').setInputFiles({ name: "llm-wiki.md", mimeType: "text/markdown", buffer: original });
    await page.getByRole("button", { name: "Ingerir", exact: true }).click();
    await expect(page.getByRole("button", { name: "Pode seguir" })).toBeVisible();
    await page.getByRole("button", { name: "Pode seguir" }).click();
    await expect(page.getByText("Recusado", { exact: true })).toBeVisible();
    await expect(page.getByText("Bloqueado: raw/ é imutável")).toBeVisible();
    await expect(page.getByText("só na wiki", { exact: true })).toBeVisible();
    expect(await vault.ler("raw/pessoal/llm-wiki.md")).toEqual(original);
    const [registro] = await agente.invocacoes("escritor");
    const argv = registro?.argv as string[];
    expect(argv).toContain("--disallowedTools");
    expect(argv.join(" ")).toContain("Edit(//");
    expect(argv.join(" ")).toContain("/raw/**");
    expect(argv).toContain("Bash");
  });
});

test.describe("[C21] fechamento encontra erro além de rascunhos", () => {
  test.use({ roteiro: roteiroComFechamentoComErro() });
  test("Dado uma página gerada com wikilink quebrado Quando o fechamento roda Então a interface mostra erro e permite abrir Revisão", async ({ page, app, vault }) => {
    await vault.escrever("wiki/pessoal/index.md", "# Pessoal\n\n- [[segundo-cerebro]]\n- [[problema]]\n");
    await page.goto(app.url);
    await page.locator('input[type="file"]').setInputFiles({ name: "llm-wiki.md", mimeType: "text/markdown", buffer: Buffer.from(FONTE) });
    await page.getByRole("button", { name: "Ingerir", exact: true }).click();
    await expect(page.getByRole("button", { name: "Pode seguir" })).toBeVisible();
    await page.getByRole("button", { name: "Pode seguir" }).click();
    await expect(page.getByRole("alert")).toContainText("O fechamento encontrou problemas");
    await expect(page.locator(".validation-output")).toContainText("wikilink quebrado");
    const link = page.getByRole("link", { name: "Revisar os 1 rascunhos" });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.getByRole("heading", { name: "Revisão" })).toBeVisible();
    await expect(page.getByRole("option").filter({ hasText: "Problema" })).toBeVisible();
  });
});

test.describe("[C22] recarregar enquanto o leitor está rodando", () => {
  test.use({ roteiro: roteiroComLeitorParado("reload") });
  test("Dado a leitura parada numa barreira Quando recarrego Então retomo o estado sem iniciar outro leitor", async ({ page, app, agente, oraculo }) => {
    await page.goto(app.url);
    await page.locator('input[type="file"]').setInputFiles({ name: "llm-wiki.md", mimeType: "text/markdown", buffer: Buffer.from(FONTE) });
    const fonteEnviada = page.waitForResponse(resposta => chamada("/api/fontes")(new URL(resposta.url())) && resposta.request().method() === "POST");
    await page.getByRole("button", { name: "Ingerir", exact: true }).click();
    const id = (await (await fonteEnviada).json() as { id: string }).id;
    await agente.pronto("reload");
    await page.reload();
    await expect(page.getByRole("button", { name: "Cancelar ingestão" })).toBeVisible();
    await expect.poll(async () => (await oraculo.get<{ situacao: string }>(`/api/conversas/${id}`)).situacao).toBe("rodando");
    expect(await agente.invocacoes("leitor")).toHaveLength(1);
    await agente.liberar("reload");
    await expect(page.getByRole("button", { name: "Pode seguir" })).toBeVisible();
    expect(await agente.invocacoes("leitor")).toHaveLength(1);
  });
});

test.describe("[C23] cancelamento enquanto o leitor trabalha", () => {
  test.use({ roteiro: roteiroComLeitorParado("cancel-leitor") });
  test("Dado o leitor esperando a barreira Quando cancelo Então a conversa termina sem escrita", async ({ page, app, agente, oraculo, vault }) => {
    const antesWiki = await instantaneo(vault.wiki);
    await page.goto(app.url);
    await page.locator('input[type="file"]').setInputFiles({ name: "llm-wiki.md", mimeType: "text/markdown", buffer: Buffer.from(FONTE) });
    const fonteEnviada = page.waitForResponse(resposta => chamada("/api/fontes")(new URL(resposta.url())) && resposta.request().method() === "POST");
    await page.getByRole("button", { name: "Ingerir", exact: true }).click();
    const id = (await (await fonteEnviada).json() as { id: string }).id;
    await agente.pronto("cancel-leitor");
    await expect(page.getByRole("button", { name: "Cancelar ingestão" })).toBeVisible();
    const cancelar = page.waitForResponse(resposta => resposta.url().includes("/cancelar") && resposta.request().method() === "POST");
    await page.getByRole("button", { name: "Cancelar ingestão" }).click();
    expect((await cancelar).status()).toBe(200);
    await expect(page.getByText("Ingestão cancelada. Nada foi escrito.")).toBeVisible();
    await expect.poll(async () => (await oraculo.get<{ situacao: string }>(`/api/conversas/${id}`)).situacao).toBe("cancelada");
    expect(mesmaArvore(antesWiki, await instantaneo(vault.wiki))).toBe(true);
    expect(await agente.invocacoes("leitor")).toHaveLength(1);
  });
});

test.describe("[C23] cancelamento enquanto o escritor trabalha", () => {
  test.use({ roteiro: roteiroComEscritorParado("cancel-escritor") });
  test("Dado o escritor gravou um rascunho e espera a barreira Quando cancelo Então a escrita existente permanece como rascunho", async ({ page, app, agente, oraculo, vault }) => {
    await vault.escrever("wiki/pessoal/index.md", "# Pessoal\n\n- [[segundo-cerebro]]\n- [[parcial]]\n");
    await page.goto(app.url);
    await page.locator('input[type="file"]').setInputFiles({ name: "llm-wiki.md", mimeType: "text/markdown", buffer: Buffer.from(FONTE) });
    await page.getByRole("button", { name: "Ingerir", exact: true }).click();
    await expect(page.getByRole("button", { name: "Pode seguir" })).toBeVisible();
    const id = new URL(page.url()).hash.split("/").at(-1)!;
    await page.getByRole("button", { name: "Pode seguir" }).click();
    await agente.pronto("cancel-escritor");
    await expect(page.getByRole("button", { name: "Cancelar ingestão" })).toBeVisible();
    const cancelar = page.waitForResponse(resposta => resposta.url().includes("/cancelar") && resposta.request().method() === "POST");
    await page.getByRole("button", { name: "Cancelar ingestão" }).click();
    expect((await cancelar).status()).toBe(200);
    await expect(page.getByText("O que já foi escrito ficou na wiki como rascunho.")).toBeVisible();
    await expect.poll(async () => (await oraculo.get<{ situacao: string }>(`/api/conversas/${id}`)).situacao).toBe("cancelada");
    expect((await vault.ler("wiki/pessoal/concepts/parcial.md")).toString()).toContain("generated:");
    expect((await oraculo.get<{ caminho: string }[]>("/api/rascunhos")).map(item => item.caminho)).toContain("pessoal/concepts/parcial.md");
  });
});

test.describe("[C24] agente indisponível", () => {
  test.describe("sem login", () => {
    test.use({ roteiro: roteiroSemLogin() });
    test("Dado Claude Code sem sessão Quando envio uma fonte Então a UI mostra como resolver sem iniciar leitura", async ({ page, app, agente, vault }) => {
      await page.goto(app.url);
      await page.locator('input[type="file"]').setInputFiles({ name: "llm-wiki.md", mimeType: "text/markdown", buffer: Buffer.from(FONTE) });
      await page.getByRole("button", { name: "Ingerir", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("sem login");
      expect(await vault.ler("raw/pessoal/llm-wiki.md")).toEqual(Buffer.from(FONTE));
      expect(await agente.invocacoes("leitor")).toHaveLength(0);
      expect(await agente.invocacoes("auth")).toHaveLength(1);
    });
  });
  test.describe("comando ausente", () => {
    test.use({ agenteAusente: true });
    test("Dado Claude Code não está no PATH Quando envio uma fonte Então a UI mostra que o agente não foi encontrado", async ({ page, app, agente, vault }) => {
      await page.goto(app.url);
      await page.locator('input[type="file"]').setInputFiles({ name: "llm-wiki.md", mimeType: "text/markdown", buffer: Buffer.from(FONTE) });
      await page.getByRole("button", { name: "Ingerir", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("não foi encontrado");
      expect(await vault.ler("raw/pessoal/llm-wiki.md")).toEqual(Buffer.from(FONTE));
      expect(await agente.invocacoes()).toHaveLength(0);
    });
  });
});
