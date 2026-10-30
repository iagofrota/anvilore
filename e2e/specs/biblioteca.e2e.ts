import { test, expect } from "../apoio/fixtures";
import { instantaneo, mesmaArvore } from "../apoio/arvore";
import { paginaGerada } from "../apoio/paginas";
import { guardarEvidencias } from "../apoio/visuais";

function paginaAprovada(slug: string, corpo = `Conteúdo aprovado de ${slug}.`): string {
  return [
    "---",
    "type: concept",
    `slug: ${slug}`,
    `title: ${slug}`,
    "tags: [teste]",
    "generated:",
    "  by: claude-haiku-4-5/2.1.311",
    "  at: 2026-01-02T00:00:00Z",
    "verified:",
    "  - by: human:iago",
    "    at: 2026-01-03T00:00:00Z",
    "---",
    "",
    corpo,
    "",
  ].join("\n");
}

test("[I6-01] Dado a interface aberta Quando clico em Biblioteca no menu Então a lista de páginas é exibida e o menu fica ativo", async ({ page, app, vault }) => {
  await vault.escrever("wiki/pessoal/concepts/primeira.md", paginaAprovada("primeira"));
  await page.goto(app.url);
  const menu = page.getByRole("navigation", { name: "Telas" });
  await menu.getByRole("link", { name: "Biblioteca" }).click();
  await expect(page).toHaveURL(/#\/biblioteca$/);
  await expect(page.getByRole("heading", { name: "Biblioteca", level: 1 })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Biblioteca" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".lib-rows").first()).toBeVisible();
  await expect(page.locator(".lib-row-title", { hasText: "primeira" })).toBeVisible();
});

test("[I6-02] Dado páginas de múltiplos tipos Quando seleciono uma aba de tipo Então a listagem filtra e mostra contagens", async ({ page, app, vault }) => {
  await vault.escrever("wiki/pessoal/concepts/c1.md", paginaGerada("c1"));
  await vault.escrever("wiki/pessoal/guides/g1.md", "---\ntype: guide\nslug: g1\ntitle: Guia Um\ntags: [guia]\n---\nCorpo do guia.\n");
  await vault.escrever("wiki/pessoal/notes/n1.md", "---\ntype: note\nslug: n1\ntitle: Nota Um\ntags: [anotacao]\n---\nCorpo da nota.\n");

  await page.goto(`${app.url}#/biblioteca`);
  await expect(page.getByRole("tab", { name: /Todas/i })).toContainText("4");
  await expect(page.getByRole("tab", { name: /concept/i })).toContainText("2");
  await expect(page.getByRole("tab", { name: /guide/i })).toContainText("1");
  await expect(page.getByRole("tab", { name: /note/i })).toContainText("1");

  await page.getByRole("tab", { name: /guide/i }).click();
  await expect(page.locator(".lib-row-title", { hasText: "Guia Um" })).toBeVisible();
  await expect(page.locator(".lib-row-title", { hasText: "c1" })).not.toBeVisible();
  await expect(page.locator(".lib-row-title", { hasText: "Nota Um" })).not.toBeVisible();

  await page.getByRole("tab", { name: /Todas/i }).click();
  await expect(page.locator(".lib-row-title", { hasText: "c1" })).toBeVisible();
  await expect(page.locator(".lib-row-title", { hasText: "Guia Um" })).toBeVisible();
  await expect(page.locator(".lib-row-title", { hasText: "Nota Um" })).toBeVisible();
});

test("[I6-03] Dado páginas rascunho e aprovadas Quando filtro por status Então vejo apenas as correspondentes", async ({ page, app, vault }) => {
  await vault.escrever("wiki/pessoal/concepts/rascunho.md", paginaGerada("rascunho"));
  await vault.escrever("wiki/pessoal/concepts/aprovada.md", paginaAprovada("aprovada"));

  await page.goto(`${app.url}#/biblioteca`);
  await expect(page.locator(".lib-row-title", { hasText: "rascunho" })).toBeVisible();
  await expect(page.locator(".lib-row-title", { hasText: "aprovada" })).toBeVisible();

  await page.getByLabel("Status:").selectOption("rascunho");
  await expect(page.locator(".lib-row-title", { hasText: "rascunho" })).toBeVisible();
  await expect(page.locator(".lib-row-title", { hasText: "aprovada" })).not.toBeVisible();

  await page.getByLabel("Status:").selectOption("aprovada");
  await expect(page.locator(".lib-row-title", { hasText: "aprovada" })).toBeVisible();
  await expect(page.locator(".lib-row-title", { hasText: "rascunho" })).not.toBeVisible();
});

test("[I6-04] Dado páginas na biblioteca Quando busco por texto Então filtra por título, caminho ou tag", async ({ page, app, vault }) => {
  await vault.escrever("wiki/pessoal/concepts/alfa.md", "---\ntype: concept\nslug: alfa\ntitle: Algoritmo Alfa\ntags: [arquitetura]\n---\nCorpo.\n");
  await vault.escrever("wiki/pessoal/concepts/beta.md", "---\ntype: concept\nslug: beta\ntitle: Banco Beta\ntags: [dados]\n---\nCorpo.\n");

  await page.goto(`${app.url}#/biblioteca`);
  const campoBusca = page.getByPlaceholder("Filtrar por título, slug ou tag");

  await campoBusca.fill("dados");
  await expect(page.locator(".lib-row-title", { hasText: "Banco Beta" })).toBeVisible();
  await expect(page.locator(".lib-row-title", { hasText: "Algoritmo Alfa" })).not.toBeVisible();

  await campoBusca.fill("Algoritmo");
  await expect(page.locator(".lib-row-title", { hasText: "Algoritmo Alfa" })).toBeVisible();
  await expect(page.locator(".lib-row-title", { hasText: "Banco Beta" })).not.toBeVisible();

  await campoBusca.fill("inexistente");
  await expect(page.getByText("Nenhuma página encontrada.")).toBeVisible();
});

test("[I6-05] Dado a lista de páginas Quando clico em uma página Então navega para #/nota/<caminho>", async ({ page, app, vault }) => {
  await vault.escrever("wiki/pessoal/concepts/clicavel.md", paginaAprovada("clicavel"));

  await page.goto(`${app.url}#/biblioteca`);
  await page.locator(".lib-row", { hasText: "clicavel" }).click();

  await expect(page).toHaveURL(/#\/nota\/pessoal\/concepts\/clicavel\.md$/);
  await expect(page.getByRole("heading", { name: "clicavel", level: 1 })).toBeVisible();
});

test("[I6-10] Dado a biblioteca aberta Quando a pessoa consulta e filtra Então nada é escrito na wiki nem em raw/", async ({ page, app, vault }) => {
  await vault.escrever("wiki/pessoal/concepts/fixa.md", paginaAprovada("fixa"));
  await vault.escrever("raw/pessoal/fonte.md", "conteúdo intacto");

  const [wikiAntes, rawAntes] = [await instantaneo(vault.wiki), await instantaneo(vault.raw)];
  await page.goto(`${app.url}#/biblioteca`);
  await page.getByPlaceholder("Filtrar por título, slug ou tag").fill("fixa");
  await page.getByLabel("Status:").selectOption("aprovada");

  expect(mesmaArvore(wikiAntes, await instantaneo(vault.wiki))).toBe(true);
  expect(mesmaArvore(rawAntes, await instantaneo(vault.raw))).toBe(true);
});

test("[I6-11] Dado a tela da Biblioteca Quando alterno temas Então continua legível e guarda evidências", async ({ page, app, vault }) => {
  await vault.escrever("wiki/pessoal/concepts/nota-tema.md", paginaAprovada("nota-tema"));

  await page.goto(`${app.url}#/biblioteca`);
  await expect(page.getByRole("heading", { name: "Biblioteca", level: 1 })).toBeVisible();
  await guardarEvidencias(page, "biblioteca");

  const cor = (seletor: string, propriedade: string) => page.locator(seletor).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), propriedade);
  const fundoClaro = await cor(".lib-rows", "background-color");

  await page.getByRole("button", { name: "Alternar tema claro ou escuro" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "escuro");

  const fundoEscuro = await cor(".lib-rows", "background-color");
  expect(fundoEscuro).not.toBe(fundoClaro);
  await guardarEvidencias(page, "biblioteca");
});

test("[C02] [I6-API] Dado o endpoint /api/biblioteca Quando chamado sem token ou com Host externo Então recusa com 403", async ({ page, app }) => {
  const urlSemToken = `${app.base}/api/biblioteca`;
  const respostaSemToken = await page.request.get(urlSemToken);
  expect(respostaSemToken.status()).toBe(403);

  const respostaHostExterno = await page.request.get(`${app.base}/api/biblioteca?token=${encodeURIComponent(app.token)}`, {
    headers: { host: "evil.example.com" },
  });
  expect(respostaHostExterno.status()).toBe(403);
});
