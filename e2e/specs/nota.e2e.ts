import { test, expect } from "../apoio/fixtures";
import { instantaneo, mesmaArvore } from "../apoio/arvore";
import { guardarEvidencias } from "../apoio/visuais";

test("[I6-06] Dado uma página existente na wiki Quando abro a Nota Então vejo propriedades, corpo renderizado e nenhum campo editável", async ({ page, app, vault }) => {
  await vault.escrever("wiki/pessoal/concepts/exemplo.md", [
    "---",
    "type: concept",
    "slug: exemplo",
    "title: Nota de Exemplo",
    "tags: [teste, arquitetura]",
    "---",
    "",
    "## Seção Principal",
    "",
    "Este é o corpo da nota com **negrito** e `código inline`.",
    "",
  ].join("\n"));

  await page.goto(`${app.url}#/nota/pessoal/concepts/exemplo.md`);
  await expect(page.locator(".note-article-title")).toHaveText("Nota de Exemplo");
  await expect(page.locator(".note-type-badge")).toHaveText("concept");
  await expect(page.locator(".note-props")).toContainText("pessoal");
  await expect(page.locator(".note-tags-list")).toContainText("teste");
  await expect(page.locator(".note-tags-list")).toContainText("arquitetura");

  await expect(page.getByRole("heading", { name: "Seção Principal", level: 2 })).toBeVisible();
  await expect(page.locator(".note-body strong")).toHaveText("negrito");
  await expect(page.locator(".note-body code")).toHaveText("código inline");

  // Estritamente leitura: nenhum input ou textarea
  await expect(page.locator(".note-main input, .note-main textarea")).toHaveCount(0);
});

test("[I6-07] Dado uma página com callouts de lacuna e contradição Quando a Nota é exibida Então vejo callouts destacados e botão para buscar fonte", async ({ page, app, vault }) => {
  await vault.escrever("wiki/pessoal/concepts/com-lacuna.md", [
    "---",
    "type: concept",
    "slug: com-lacuna",
    "title: Nota Com Lacuna",
    "tags: [lacunas]",
    "---",
    "",
    "> [!gap] Falta definir o orçamento",
    "> [!contradiction] O prazo diverge da proposta",
    "",
  ].join("\n"));

  await page.goto(`${app.url}#/nota/pessoal/concepts/com-lacuna.md`);
  await expect(page.locator(".callout-gap")).toContainText("Falta definir o orçamento");
  await expect(page.locator(".callout-contradiction")).toContainText("O prazo diverge da proposta");

  const linkBusca = page.locator(".callout-gap a.callout-chat-btn");
  await expect(linkBusca).toBeVisible();
  await expect(linkBusca).toHaveAttribute("href", /#\/chat\?lacuna=/);
});

test("[I6-08] Dado uma página com proveniência completa Quando abro a Nota Então vejo fonte, gerador e verificação", async ({ page, app, vault }) => {
  await vault.escrever("raw/pessoal/origem.md", "conteúdo original da fonte");
  await vault.escrever("wiki/pessoal/concepts/proveniente.md", [
    "---",
    "type: concept",
    "slug: proveniente",
    "title: Nota Proveniente",
    "tags: [prov]",
    "generated:",
    "  by: claude-haiku-4-5/2.1.311",
    "  at: 2026-01-02T00:00:00Z",
    "verified:",
    "  - by: human:iago",
    "    at: 2026-01-03T00:00:00Z",
    "sources:",
    "  - resource: raw/pessoal/origem.md",
    "---",
    "",
    "Corpo da nota.",
    "",
  ].join("\n"));

  await page.goto(`${app.url}#/nota/pessoal/concepts/proveniente.md`);
  const prov = page.getByRole("region", { name: "Proveniência" });
  await expect(prov).toBeVisible();
  await expect(prov).toContainText("raw/pessoal/origem.md");
  await expect(prov).toContainText("claude-haiku-4-5/2.1.311");
  await expect(prov).toContainText("human:iago");
});

test("[I6-09] Dado páginas interligadas por wikilinks Quando abro a Nota Então vejo backlinks e o grafo local", async ({ page, app, vault }) => {
  await vault.escrever("wiki/pessoal/concepts/origem.md", [
    "---",
    "type: concept",
    "slug: origem",
    "title: Origem",
    "tags: [link]",
    "---",
    "",
    "Veja a [[destino]] para detalhes da implementação.",
    "",
  ].join("\n"));

  await vault.escrever("wiki/pessoal/concepts/destino.md", [
    "---",
    "type: concept",
    "slug: destino",
    "title: Destino",
    "tags: [link]",
    "---",
    "",
    "Conteúdo de destino.",
    "",
  ].join("\n"));

  await page.goto(`${app.url}#/nota/pessoal/concepts/destino.md`);
  const backlinks = page.getByRole("region", { name: "Backlinks" });
  await expect(backlinks).toBeVisible();
  await expect(backlinks).toContainText("Origem");
  await expect(backlinks).toContainText("Veja a [[destino]] para detalhes");

  const grafo = page.getByRole("region", { name: "Grafo local" });
  await expect(grafo).toBeVisible();
  await expect(grafo.locator("svg.local-graph-svg")).toBeVisible();
  await expect(grafo.locator("text", { hasText: "Destino" })).toBeVisible();
  await expect(grafo.locator("text", { hasText: "Origem" })).toBeVisible();
});

test("[I6-10] Dado a tela da Nota aberta Quando a pessoa lê a nota Então a wiki e raw/ permanecem inalterados", async ({ page, app, vault }) => {
  await vault.escrever("wiki/pessoal/concepts/leitura.md", [
    "---",
    "type: concept",
    "slug: leitura",
    "title: Leitura Pura",
    "tags: [leitura]",
    "---",
    "",
    "Conteúdo que não deve mudar.",
    "",
  ].join("\n"));
  await vault.escrever("raw/pessoal/fonte.md", "evidência intocada");

  const [wikiAntes, rawAntes] = [await instantaneo(vault.wiki), await instantaneo(vault.raw)];
  await page.goto(`${app.url}#/nota/pessoal/concepts/leitura.md`);
  await expect(page.locator(".note-article-title")).toHaveText("Leitura Pura");

  expect(mesmaArvore(wikiAntes, await instantaneo(vault.wiki))).toBe(true);
  expect(mesmaArvore(rawAntes, await instantaneo(vault.raw))).toBe(true);
});

test("[I6-11] Dado a tela da Nota Quando alterno temas Então continua legível e guarda evidências", async ({ page, app, vault }) => {
  await vault.escrever("wiki/pessoal/concepts/nota-tema.md", [
    "---",
    "type: concept",
    "slug: nota-tema",
    "title: Tema na Nota",
    "tags: [tema]",
    "---",
    "",
    "Testando cores clara e escura.",
    "",
  ].join("\n"));

  await page.goto(`${app.url}#/nota/pessoal/concepts/nota-tema.md`);
  await expect(page.locator(".note-article-title")).toHaveText("Tema na Nota");
  await guardarEvidencias(page, "nota");

  const cor = (seletor: string, propriedade: string) => page.locator(seletor).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), propriedade);
  const fundoClaro = await cor(".note-main", "background-color");

  await page.getByRole("button", { name: "Alternar tema claro ou escuro" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "escuro");

  const fundoEscuro = await cor(".note-main", "background-color");
  expect(fundoEscuro).not.toBe(fundoClaro);
  await guardarEvidencias(page, "nota");
});

test("[C02] [C15] [I6-API] Dado o endpoint /api/nota Quando chamado com caminho malicioso ou inexistente Então bloqueia adequadamente", async ({ page, app }) => {
  const semToken = await page.request.get(`${app.base}/api/nota?caminho=pessoal/concepts/teste.md`);
  expect(semToken.status()).toBe(403);

  const inexistente = await page.request.get(`${app.base}/api/nota?token=${encodeURIComponent(app.token)}&caminho=inexistente.md`);
  expect(inexistente.status()).toBe(404);

  const traversal = await page.request.get(`${app.base}/api/nota?token=${encodeURIComponent(app.token)}&caminho=../fora.md`);
  expect(traversal.status()).toBe(400);

  const absoluto = await page.request.get(`${app.base}/api/nota?token=${encodeURIComponent(app.token)}&caminho=/etc/passwd`);
  expect(absoluto.status()).toBe(400);

  const gitConfig = await page.request.get(`${app.base}/api/nota?token=${encodeURIComponent(app.token)}&caminho=.git/config`);
  expect(gitConfig.status()).toBe(400);

  const env = await page.request.get(`${app.base}/api/nota?token=${encodeURIComponent(app.token)}&caminho=.env`);
  expect(env.status()).toBe(400);

  const oculta = await page.request.get(`${app.base}/api/nota?token=${encodeURIComponent(app.token)}&caminho=pessoal/.oculta.md`);
  expect(oculta.status()).toBe(400);

  const meta = await page.request.get(`${app.base}/api/nota?token=${encodeURIComponent(app.token)}&caminho=_meta/x.md`);
  expect(meta.status()).toBe(400);
});
