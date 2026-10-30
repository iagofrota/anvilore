import { test, expect } from "../apoio/fixtures";
import { aguardarAreas, escolherArquivo } from "../apoio/acoes";
import { FONTE } from "../../tests/apoio/ingestao-exemplo";

test("[C12] Dado que raw já contém um arquivo com o nome escolhido Quando envio outro Então o original fica intacto e a fonte ganha sufixo", async ({ page, app, vault }) => {
  const original = Buffer.from("Fonte anterior que precisa permanecer byte a byte igual.\n");
  await vault.escrever("raw/pessoal/llm-wiki.md", original);
  await page.goto(`${app.url}#/chat`);
  const upload = page.waitForResponse(resposta => resposta.url().includes("/api/fontes") && resposta.request().method() === "POST");
  await escolherArquivo(page, { name: "llm-wiki.md", mimeType: "text/markdown", buffer: Buffer.from(FONTE) });
  await page.getByRole("button", { name: "Ingerir", exact: true }).click();
  const conversa = await (await upload).json() as { fonte: string };
  expect(conversa.fonte).toBe("raw/pessoal/llm-wiki-2.md");
  expect(await vault.ler("raw/pessoal/llm-wiki.md")).toEqual(original);
  expect(await vault.ler(conversa.fonte)).toEqual(Buffer.from(FONTE));
  await expect(page.getByRole("button", { name: "Pode seguir" })).toBeVisible();
  await expect(page.locator("code.source-path")).toContainText(conversa.fonte);
});

test("[C13] Dado texto no Chat Quando envio Então ele vira fonte Markdown datada em raw e inicia leitura", async ({ page, app, agente, oraculo, vault }) => {
  await page.goto(`${app.url}#/chat`);
  await aguardarAreas(page);
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

test("[C11] Dado um arquivo com CRLF, CR solto e bytes que não são UTF-8 Quando envio pela tela Então raw guarda exatamente os bytes escolhidos", async ({ page, app, oraculo, vault }) => {
  const bytes = Buffer.from([0x23, 0x20, 0x41, 0x0d, 0x0a, 0x42, 0x0d, 0x43, 0xff, 0xfe, 0x00, 0x0d, 0x0a]);
  await page.goto(`${app.url}#/chat`);
  const envio = page.waitForResponse(resposta => resposta.url().includes("/api/fontes") && resposta.request().method() === "POST");
  await escolherArquivo(page, { name: "windows.md", mimeType: "text/markdown", buffer: bytes });
  await page.getByRole("button", { name: "Ingerir", exact: true }).click();
  const conversa = await (await envio).json() as { id: string; fonte: string };
  expect(conversa.fonte).toBe("raw/pessoal/windows.md");
  expect(await vault.ler(conversa.fonte)).toEqual(bytes);
  await expect.poll(async () => (await oraculo.get<{ situacao: string }>(`/api/conversas/${conversa.id}`)).situacao).not.toBe("rodando");
  expect(await vault.ler(conversa.fonte)).toEqual(bytes);
});
