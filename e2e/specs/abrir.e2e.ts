import { test, expect } from "../apoio/fixtures";
import { aguardarAreas } from "../apoio/acoes";
import { semearConversa } from "../apoio/sementes";

test("[C01] Dado uma conversa salva Quando abro a interface local Então o Início oferece retomá-la e o Chat mostra áreas e agente", async ({ page, app, oraculo, vault }) => {
  await semearConversa(vault, "conversa-retomada", "fonte-inicial.md");
  await page.goto(app.url);
  await expect(page.getByRole("heading", { name: "Início", level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Telas" }).getByRole("link", { name: "Início" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Telas" })).toContainText("Nova ingestão");
  await expect(page.getByRole("navigation", { name: "Telas" })).toContainText("Revisão");
  await expect(page.getByRole("navigation", { name: "Conversas" })).toContainText("Ingerir: fonte-inicial.md");
  await page.getByRole("list", { name: "Ingestões em andamento" }).getByRole("link", { name: "Continuar" }).click();
  await expect(page).toHaveURL(/#\/chat\/conversa-retomada$/);
  await expect(page.getByText("Claude Code", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Área: pessoal", { exact: true })).toBeVisible();
  const api = await oraculo.get<{ agente: string; areas: string[]; conversas: { id: string; situacao: string }[] }>("/api/ingestao");
  expect(api).toMatchObject({ agente: "Claude Code", areas: ["pessoal", "trabalho"], conversas: [{ id: "conversa-retomada", situacao: "pronta" }] });
});

test("[C10] Dado áreas e conversas atuais Quando consulto Chat Então a navegação corresponde à API", async ({ page, app, oraculo, vault }) => {
  await semearConversa(vault, "conversa-um", "um.md");
  await semearConversa(vault, "conversa-dois", "dois.md", "erro");
  const api = await oraculo.get<{ areas: string[]; conversas: { nome: string; situacao: string }[] }>("/api/ingestao");
  await page.goto(`${app.url}#/chat`);
  await expect(page.getByRole("navigation", { name: "Conversas" })).toContainText("Ingerir: um.md");
  await expect(page.getByRole("navigation", { name: "Conversas" })).toContainText("Ingerir: dois.md");
  await aguardarAreas(page);
  await page.getByRole("link", { name: "Ingerir: um.md" }).click();
  await expect(page.getByText("Área: pessoal", { exact: true })).toBeVisible();
  for (const conversa of api.conversas) await expect(page.getByRole("navigation", { name: "Conversas" })).toContainText(`Ingerir: ${conversa.nome}`);
  expect(api.conversas.map(conversa => conversa.situacao)).toEqual(expect.arrayContaining(["pronta", "erro"]));
  await page.getByRole("link", { name: "Ingerir: dois.md" }).click();
  await expect(page.getByRole("alert")).toContainText("Falha de teste preservada.");
});
