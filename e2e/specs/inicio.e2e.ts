import { test, expect } from "../apoio/fixtures";
import { rm } from "node:fs/promises";
import { instantaneo, mesmaArvore } from "../apoio/arvore";
import { paginaGerada } from "../apoio/paginas";
import { semearConversa, semearFila } from "../apoio/sementes";
import { guardarEvidencias } from "../apoio/visuais";

type Saude = { validar: { ok: boolean; semAprovacao: number; outrosErros: string[] }; vencidas: number; lacunas: { total: number; contradicoes: number; abertas: string[] }; auditoria: { total: number } };
type Inicio = { rascunhos: { total: number }; atividade: { resumo: string }[]; fontes: { caminho: string; conversa?: string }[] };

const contador = (page: import("@playwright/test").Page, nome: string) => page.getByRole("region", { name: "Saúde da wiki" }).locator(".health-counters div").filter({ hasText: nome }).locator("dd");

test("[I5-01] Dado a interface recém-aberta Quando carrega Então o Início é a tela inicial e Revisão e Chat seguem no menu", async ({ page, app }) => {
  await page.goto(app.url);
  await expect(page.getByRole("heading", { name: "Início", level: 1 })).toBeVisible();
  const menu = page.getByRole("navigation", { name: "Telas" });
  await expect(menu.getByRole("link", { name: "Início" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: /Bom dia|Boa tarde|Boa noite/ })).toBeVisible();
  await menu.getByRole("link", { name: "Revisão" }).click();
  await expect(page).toHaveURL(/#\/revisao$/);
  await menu.getByRole("link", { name: "Nova ingestão" }).click();
  await expect(page).toHaveURL(/#\/chat$/);
  await expect(page.getByRole("heading", { name: "Ingerir uma fonte" })).toBeVisible();
  await menu.getByRole("link", { name: "Início" }).click();
  await expect(page).toHaveURL(/#\/inicio$/);
});

test("[I5-02] Dado rascunhos pendentes Quando abro o Início Então vejo a contagem, a lista e o caminho para a Revisão", async ({ page, app, oraculo, vault }) => {
  await semearFila(vault);
  await page.goto(app.url);
  const cartao = page.getByRole("region", { name: "Para revisar" });
  const api = await oraculo.get<Inicio>("/api/inicio");
  await expect(page.getByText(`${api.rascunhos.total} páginas esperam a sua aprovação.`)).toBeVisible();
  await expect(cartao.locator(".count")).toHaveText(String(api.rascunhos.total));
  await expect(cartao).toContainText("concept · nova");
  await cartao.getByRole("link", { name: "Abrir revisão" }).click();
  await expect(page).toHaveURL(/#\/revisao$/);
  await expect(page.getByRole("option")).toHaveCount(api.rascunhos.total);
});

test("[I5-03] Dado o composer Quando escolho Ingerir uma fonte Então chego ao Chat de ingestão já existente", async ({ page, app }) => {
  await page.goto(app.url);
  await page.getByRole("link", { name: "Ingerir uma fonte" }).click();
  await expect(page).toHaveURL(/#\/chat$/);
  await expect(page.getByLabel("Texto da fonte")).toBeVisible();
});

test("[I5-04] Dado entradas em wiki/log Quando abro o Início Então a atividade mostra as mais novas primeiro", async ({ page, app, vault }) => {
  await vault.escrever("wiki/log/log-2026-10-27.md", "## [2026-10-27] ingest | Fonte antiga\n");
  await vault.escrever("wiki/log/log-2026-10-29.md", "## [2026-10-29] ingest | Primeira do dia\n\n## [2026-10-29] lint | Segunda do dia\n");
  await page.goto(app.url);
  const linhas = page.getByRole("region", { name: "Atividade recente" }).locator("li");
  await expect(linhas).toHaveCount(3);
  await expect(linhas.nth(0)).toContainText("2026-10-29");
  await expect(linhas.nth(0)).toContainText("Segunda do dia");
  await expect(linhas.nth(2)).toContainText("Fonte antiga");
});

test("[I5-05] Dado página gerada sem aprovação Quando a saúde roda Então o portão aparece como aviso e Validar agora confere de novo", async ({ page, app, oraculo, vault }) => {
  await vault.escrever("wiki/pessoal/concepts/nova.md", paginaGerada("nova"));
  const primeira = page.waitForResponse(resposta => resposta.url().includes("/api/inicio") && resposta.request().method() === "GET");
  await page.goto(app.url);
  expect((await primeira).status()).toBe(200);
  const cartao = page.getByRole("region", { name: "Saúde da wiki" });
  await expect(cartao).toContainText("Falta aprovar 1 página");
  await expect(cartao).toContainText("Isso é o portão funcionando");
  const api = await oraculo.get<Saude>("/api/saude");
  expect(api.validar).toMatchObject({ ok: false, semAprovacao: 1 });
  await expect(contador(page, "Sem aprovação")).toHaveText("1");
  await vault.escrever("wiki/pessoal/concepts/outra.md", paginaGerada("outra"));
  const segunda = page.waitForResponse(resposta => resposta.url().includes("/api/saude"));
  await cartao.getByRole("button", { name: "Validar agora" }).click();
  expect((await segunda).status()).toBe(200);
  await expect(contador(page, "Sem aprovação")).toHaveText("2");
});

test("[I5-06] Dado wikilink quebrado e lacuna aberta Quando a saúde roda Então os problemas aparecem em palavras, sem pedir comando", async ({ page, app, oraculo, vault }) => {
  await vault.escrever("wiki/pessoal/concepts/problema.md", "---\ntype: concept\nslug: problema\ntitle: Problema\ntags: [teste]\n---\n\n[[destino-ausente]]\n> [!gap] Falta o preço\n> [!contradiction] Datas divergem\n");
  await page.goto(app.url);
  const cartao = page.getByRole("region", { name: "Saúde da wiki" });
  await expect(cartao).toContainText("A validação encontrou problemas");
  await expect(cartao).toContainText("destino-ausente");
  await expect(cartao).toContainText("Falta o preço");
  await expect(contador(page, "Contradições")).toHaveText("1");
  await expect(contador(page, "Lacunas abertas")).toHaveText("1");
  await expect(page.locator("body")).not.toContainText("bun src/cli.ts");
  const api = await oraculo.get<Saude>("/api/saude");
  expect(api.validar.ok).toBe(false);
  expect(api.lacunas).toMatchObject({ total: 2, contradicoes: 1 });
});

test("[I5-07] Dado fontes em raw/ Quando abro o Início Então só as sem ingestão aparecem, e a de conversa aberta oferece Continuar", async ({ page, app, oraculo, vault }) => {
  await vault.escrever("raw/pessoal/ingerida.md", "x");
  await vault.escrever("wiki/pessoal/concepts/ligada.md", paginaGerada("ligada", "Corpo.", "sources:\n  - resource: raw/pessoal/ingerida.md"));
  await vault.escrever("raw/pessoal/solta.md", "texto solto");
  await semearConversa(vault, "conversa-aberta", "em-curso.md");
  await page.goto(app.url);
  const cartao = page.getByRole("region", { name: "Em raw/, sem ingestão" });
  await expect(cartao).toContainText("raw/pessoal/solta.md");
  await expect(cartao).not.toContainText("raw/pessoal/ingerida.md");
  await expect(cartao.locator(".count")).toHaveText("2");
  await cartao.getByRole("link", { name: "Continuar" }).click();
  await expect(page).toHaveURL(/#\/chat\/conversa-aberta$/);
  const api = await oraculo.get<Inicio>("/api/inicio");
  expect(api.fontes.map(f => f.caminho)).toEqual(["raw/pessoal/em-curso.md", "raw/pessoal/solta.md"]);
});

test("[I5-08] Dado o Início aberto Quando a pessoa o usa Então nada é escrito na wiki nem em raw/", async ({ page, app, vault }) => {
  await semearFila(vault);
  await vault.escrever("raw/pessoal/solta.md", "texto");
  const [wikiAntes, rawAntes] = [await instantaneo(vault.wiki), await instantaneo(vault.raw)];
  await page.goto(app.url);
  await expect(page.getByRole("region", { name: "Saúde da wiki" })).not.toContainText("Conferindo");
  await page.getByRole("button", { name: "Validar agora" }).click();
  await expect(page.getByRole("button", { name: "Validar agora" })).toBeEnabled();
  expect(mesmaArvore(wikiAntes, await instantaneo(vault.wiki))).toBe(true);
  expect(mesmaArvore(rawAntes, await instantaneo(vault.raw))).toBe(true);
});

test("[I5-09] Dado os temas claro e escuro Quando alterno Então o Início continua legível nos dois", async ({ page, app, vault }) => {
  await semearFila(vault);
  await page.goto(app.url);
  await expect(page.getByRole("region", { name: "Saúde da wiki" })).toContainText(/Falta aprovar|Há problemas|Pede atenção|Tudo certo/);
  await guardarEvidencias(page, "inicio");
  const cor = (seletor: string, propriedade: string) => page.locator(seletor).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), propriedade);
  const fundoClaro = await cor(".home-card", "background-color");
  const textoClaro = await cor(".home-card h3", "color");
  await page.getByRole("button", { name: "Alternar tema claro ou escuro" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "escuro");
  const fundoEscuro = await cor(".home-card", "background-color");
  const textoEscuro = await cor(".home-card h3", "color");
  expect(fundoEscuro).not.toBe(fundoClaro);
  expect(textoEscuro).not.toBe(textoClaro);
  const luz = (rgb: string) => { const [r, g, b] = rgb.match(/\d+/g)!.map(Number) as [number, number, number]; return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  expect(luz(fundoClaro)).toBeGreaterThan(200);
  expect(luz(fundoEscuro)).toBeLessThan(60);
  expect(luz(textoEscuro)).toBeGreaterThan(150);
  await expect(page.getByRole("region", { name: "Para revisar" })).toBeVisible();
  await guardarEvidencias(page, "inicio");
});

test("[I5-10] Dado a carga do Início Quando a tela abre Então pede /api/inicio uma vez e não pede /api/saude, que só Validar agora usa", async ({ page, app, vault }) => {
  await vault.escrever("wiki/pessoal/concepts/nova.md", paginaGerada("nova"));
  const pedidos: string[] = [];
  page.on("request", req => { const url = new URL(req.url()); if (url.pathname.startsWith("/api/")) pedidos.push(url.pathname); });
  await page.goto(app.url);
  await expect(page.getByRole("region", { name: "Saúde da wiki" })).toContainText("Falta aprovar 1 página");
  await expect(page.getByRole("button", { name: "Validar agora" })).toBeEnabled();
  expect(pedidos.filter(rota => rota === "/api/inicio")).toHaveLength(1);
  expect(pedidos.filter(rota => rota === "/api/saude")).toHaveLength(0);
  await vault.escrever("wiki/pessoal/concepts/outra.md", paginaGerada("outra"));
  await page.getByRole("button", { name: "Validar agora" }).click();
  await expect(contador(page, "Sem aprovação")).toHaveText("2");
  expect(pedidos.filter(rota => rota === "/api/saude")).toHaveLength(1);
});

test("[I5-11] Dado a pasta wiki ausente Quando abro o Início Então vejo o diagnóstico de saúde e os atalhos", async ({ page, app, vault }) => {
  await rm(vault.wiki, { recursive: true, force: true });
  const resposta = page.waitForResponse(resposta => resposta.url().includes("/api/inicio") && resposta.request().method() === "GET");
  await page.goto(app.url);
  expect((await resposta).status()).toBe(200);
  const saude = page.getByRole("region", { name: "Saúde da wiki" });
  await expect(saude).toBeVisible();
  await expect(saude).toContainText(/diretorio nao encontrado/i);
  await expect(page.getByRole("link", { name: "Ingerir uma fonte" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Revisar rascunhos" })).toBeVisible();
  await expect(page.getByText("Lendo a wiki…")).toHaveCount(0);
});
