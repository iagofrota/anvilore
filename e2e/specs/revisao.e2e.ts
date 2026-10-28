import { test, expect } from "../apoio/fixtures";
import { paginaGerada, paginaAtualizada, paginaInvalida } from "../apoio/paginas";
import { semearFila } from "../apoio/sementes";

test("[C03] Dado rascunhos novos atualizados e inválidos Quando abro Revisão Então cada estado e barreira de aprovação aparece", async ({ page, app, oraculo, vault }) => {
  await semearFila(vault);
  await page.goto(`${app.base}/?token=${encodeURIComponent(app.token)}#/revisao`);
  await expect(page.getByRole("option")).toHaveCount(3);
  await expect(page.getByRole("option").filter({ hasText: "nova" })).toBeVisible();
  await expect(page.getByRole("option").filter({ hasText: "atualizada" })).toBeVisible();
  await expect(page.getByRole("option").filter({ hasText: "erro" })).toBeVisible();
  const api = await oraculo.get<{ caminho: string; status: string; aprovavel: boolean }[]>("/api/rascunhos");
  expect(api.map(item => item.status)).toEqual(expect.arrayContaining(["nova", "atualizada", "erro"]));
  const invalida = page.getByRole("option").filter({ hasText: "Inválida" });
  await invalida.click();
  await expect(page.getByText("generated deve ser mapping")).toBeVisible();
  await expect(page.getByRole("button", { name: "Aprovar" })).toBeDisabled();
});

test("[C04] Dado páginas novas e atualizadas Quando alterno os filtros Então vejo apenas a categoria escolhida", async ({ page, app, vault }) => {
  await vault.escrever("wiki/pessoal/concepts/nova.md", paginaGerada("nova"));
  await vault.escrever("wiki/pessoal/concepts/atualizada.md", paginaAtualizada("atualizada"));
  await page.goto(`${app.base}/?token=${encodeURIComponent(app.token)}#/revisao`);
  await expect(page.getByRole("option")).toHaveCount(2);
  await page.getByRole("button", { name: "Novas" }).click();
  await expect(page.getByRole("button", { name: "Novas" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option").first()).toContainText("nova");
  await page.getByRole("button", { name: "Atualizadas" }).click();
  await expect(page.getByRole("button", { name: "Atualizadas" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option").first()).toContainText("atualizada");
  await page.getByRole("option").first().click();
  await expect(page.getByRole("region", { name: "Pré-visualização do rascunho" })).toContainText("pessoal/concepts/atualizada.md");
  await expect(page.getByRole("tab", { name: "Markdown" })).toBeVisible();
});

test("[C07] Dado um rascunho que mudou após abrir Quando tento aprovar Então a API recusa a versão antiga e atualiza a fila", async ({ page, app, vault }) => {
  const caminho = "wiki/pessoal/concepts/concorrente.md";
  await vault.escrever(caminho, paginaGerada("concorrente", "Versão que abri."));
  await page.goto(`${app.base}/?token=${encodeURIComponent(app.token)}#/revisao`);
  await expect(page.getByRole("option")).toHaveCount(1);
  await vault.escrever(caminho, paginaGerada("concorrente", "Versão que mudou no disco."));
  const aprovacao = page.waitForResponse(resposta => resposta.url().includes("/api/aprovar") && resposta.request().method() === "POST");
  await page.getByRole("button", { name: "Aprovar" }).click();
  expect((await aprovacao).status()).toBe(409);
  await expect(page.getByRole("alert")).toContainText("A página mudou desde que você abriu");
  await expect(page.getByRole("option")).toContainText("concorrente");
  expect((await vault.ler(caminho)).toString()).not.toContain("verified:");
  await expect(page.getByRole("region", { name: "Pré-visualização do rascunho" })).toContainText("Versão que mudou no disco.");
});

test("[C09] Dado uma wiki válida sem rascunhos Quando valido de novo após incluir um wikilink quebrado Então vejo o resultado real", async ({ page, app, oraculo, vault }) => {
  await vault.escrever("wiki/pessoal/index.md", "# Pessoal\n\n- [[segundo-cerebro]]\n");
  const primeira = page.waitForResponse(resposta => resposta.url().includes("/api/validar") && resposta.request().method() === "POST");
  await page.goto(`${app.base}/?token=${encodeURIComponent(app.token)}#/revisao`);
  expect((await primeira).status()).toBe(200);
  await expect(page.locator(".result-badge")).toContainText("CÓDIGO 0 · PASS");
  await vault.escrever("wiki/pessoal/index.md", "# Pessoal\n\n- [[segundo-cerebro]]\n- [[problema]]\n");
  await vault.escrever("wiki/pessoal/concepts/problema.md", "---\ntype: concept\nslug: problema\ntitle: Problema\ntags: [teste]\n---\n\n[[destino-ausente]]\n");
  const segunda = page.waitForResponse(resposta => resposta.url().includes("/api/validar") && resposta.request().method() === "POST");
  await page.getByRole("button", { name: "Validar de novo" }).click();
  const response = await segunda;
  expect(response.status()).toBe(200);
  const api = await response.json() as { codigo: number; saida: string };
  expect(api.codigo).toBe(1);
  expect(api.saida).toContain("wikilink quebrado [[destino-ausente]]");
  await expect(page.locator(".result-badge")).toContainText("CÓDIGO 1 · FAIL");
  await expect(page.locator(".validation-output")).toContainText(api.saida);
  expect((await oraculo.post<{ codigo: number; saida: string }>("/api/validar")).body.codigo).toBe(1);
});
