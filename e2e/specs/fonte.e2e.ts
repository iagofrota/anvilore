import { test, expect } from "../apoio/fixtures";
import { FONTE } from "../../tests/apoio/ingestao-exemplo";

test("[C12] Dado que raw já contém um arquivo com o nome escolhido Quando envio outro Então o original fica intacto e a fonte ganha sufixo", async ({ page, app, vault }) => {
  const original = Buffer.from("Fonte anterior que precisa permanecer byte a byte igual.\n");
  await vault.escrever("raw/pessoal/llm-wiki.md", original);
  await page.goto(app.url);
  const upload = page.waitForResponse(resposta => resposta.url().includes("/api/fontes") && resposta.request().method() === "POST");
  await page.locator('input[type="file"]').setInputFiles({ name: "llm-wiki.md", mimeType: "text/markdown", buffer: Buffer.from(FONTE) });
  await page.getByRole("button", { name: "Ingerir", exact: true }).click();
  const conversa = await (await upload).json() as { fonte: string };
  expect(conversa.fonte).toBe("raw/pessoal/llm-wiki-2.md");
  expect(await vault.ler("raw/pessoal/llm-wiki.md")).toEqual(original);
  expect(await vault.ler(conversa.fonte)).toEqual(Buffer.from(FONTE));
  await expect(page.getByRole("button", { name: "Pode seguir" })).toBeVisible();
  await expect(page.locator("code.source-path")).toContainText(conversa.fonte);
});

test("[C13] Dado texto no Chat Quando envio Então ele vira fonte Markdown datada em raw e inicia leitura", async ({ page, app, agente, oraculo, vault }) => {
  await page.goto(app.url);
  await page.getByLabel("Texto da fonte").fill(FONTE);
  const envio = page.waitForResponse(resposta => resposta.url().includes("/api/fontes") && resposta.request().method() === "POST");
  await page.getByRole("button", { name: "Ingerir", exact: true }).click();
  const conversa = await (await envio).json() as { id: string; fonte: string; situacao: string };
  expect(conversa.fonte).toMatch(/^raw\/pessoal\/texto-colado-\d{8}-\d{6}\.md$/);
  expect(await vault.ler(conversa.fonte)).toEqual(Buffer.from(FONTE));
  await expect(page.getByRole("button", { name: "Pode seguir" })).toBeVisible();
  expect(await oraculo.get<{ fonte: string; situacao: string }>(`/api/conversas/${conversa.id}`)).toMatchObject({ fonte: conversa.fonte, situacao: "esperando" });
  expect(await agente.invocacoes("leitor")).toHaveLength(1);
});
