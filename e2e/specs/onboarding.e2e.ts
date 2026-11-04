import { test, expect } from "../apoio/fixtures";
import { rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

test("[I7-01] Dado primeira abertura sem wiki configurada Quando abro a interface Então cai no Onboarding 1 e segue do O1 ao O4 até o Início", async ({ page, app, vault }) => {
  // Limpar áreas pré-existentes da fixture para simular primeiro uso
  await rm(join(vault.wiki, "pessoal"), { recursive: true, force: true });
  await rm(join(vault.wiki, "trabalho"), { recursive: true, force: true });
  await rm(join(vault.raw, "pessoal"), { recursive: true, force: true });
  await rm(join(vault.raiz, ".anvilore", "identidade"), { force: true });
  await rm(join(vault.raiz, ".anvilore", "onboarding.json"), { force: true });

  // Garantir contratos e fonte de exemplo
  await writeFile(join(vault.raiz, "SCHEMA.md"), "# Schema\n");
  await writeFile(join(vault.raiz, "AGENTS.md"), "# Agents\n");
  await mkdir(join(vault.raw, "exemplo"), { recursive: true });
  await writeFile(join(vault.raw, "exemplo", "llm-wiki.md"), "# LLM Wiki\nTexto de exemplo para primeira ingestão.\n");

  // Abertura inicial da interface
  await page.goto(app.url);

  // Deve redirecionar automaticamente para o Onboarding 1
  await expect(page).toHaveURL(/#\/onboarding\/1$/);
  await expect(page.getByRole("heading", { name: "Abra a pasta da sua wiki", level: 1 })).toBeVisible();

  // Verifica inspeção da pasta
  const inputPasta = page.getByLabel("Pasta do vault");
  await expect(inputPasta).toHaveValue(vault.raiz);
  await expect(page.getByText("Encontrado nesta pasta")).toBeVisible();
  await expect(page.getByText("wiki/")).toBeVisible();
  await expect(page.getByText("raw/")).toBeVisible();
  await expect(page.getByText("SCHEMA.md · AGENTS.md")).toBeVisible();

  // Avança para o Onboarding 2
  await page.getByRole("button", { name: "Continuar →" }).click();
  await expect(page).toHaveURL(/#\/onboarding\/2$/);

  // Onboarding 2: Agente
  await expect(page.getByRole("heading", { name: "Conecte o seu agente", level: 1 })).toBeVisible();
  await expect(page.getByText("Claude Code", { exact: true })).toBeVisible();
  await expect(page.getByText("O Anvilore não pede nem guarda chave de API.")).toBeVisible();
  // Nunca pede nem exibe campo de chave de API
  await expect(page.locator('input[type="password"]')).toHaveCount(0);

  // Clica no teste rápido do agente
  const botaoTestar = page.getByRole("button", { name: /Testar/ });
  await botaoTestar.click();
  await expect(page.getByText("O Claude Code está disponível e conectado à sua conta.")).toBeVisible();

  // Avança para o Onboarding 3
  await page.getByRole("button", { name: "Continuar →" }).click();
  await expect(page).toHaveURL(/#\/onboarding\/3$/);

  // Onboarding 3: Áreas (Sem campo de ID!)
  await expect(page.getByRole("heading", { name: "Você e suas áreas", level: 1 })).toBeVisible();
  await expect(page.getByText("pessoal")).toBeVisible();
  await expect(page.getByText("profissional")).toBeVisible();
  await expect(page.getByText("projetos-paralelos")).toBeVisible();
  await expect(page.getByText("saude")).toBeVisible();

  // Garante que NÃO existe campo de ID de revisor (regra explícita do brief)
  await expect(page.getByLabel(/identificador|revisor|seu id/i)).toHaveCount(0);

  // Adiciona uma área personalizada
  const inputNovaArea = page.getByPlaceholder("nova-area");
  await inputNovaArea.fill("estudos");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.getByText("estudos", { exact: true })).toBeVisible();

  // Submete criação de áreas
  await page.getByRole("button", { name: "Criar áreas →" }).click();
  await expect(page).toHaveURL(/#\/onboarding\/4$/);

  // Onboarding 4: Primeira Ingestão
  await expect(page.getByRole("heading", { name: "Faça a primeira ingestão", level: 1 })).toBeVisible();
  await expect(page.getByText("LLM Wiki — Andrej Karpathy")).toBeVisible();
  await expect(page.getByText("raw/exemplo/llm-wiki.md")).toBeVisible();

  // Pula por agora para concluir
  await page.getByRole("button", { name: "Pular por agora" }).click();

  // Deve aterrissar no Início
  await expect(page).toHaveURL(/#\/inicio$/);
  await expect(page.getByRole("heading", { name: "Início", level: 1 })).toBeVisible();

  // Verifica persistência de estado em .anvilore/
  const conteudoOnboarding = JSON.parse(await readFile(join(vault.raiz, ".anvilore", "onboarding.json"), "utf8")) as Record<string, unknown>;
  expect(conteudoOnboarding.concluido).toBe(true);

  const conteudoIdentidade = (await readFile(join(vault.raiz, ".anvilore", "identidade"), "utf8")).trim();
  expect(conteudoIdentidade).toMatch(/^human:/);

  // Recarrega a página: o onboarding não deve voltar
  await page.reload();
  await expect(page).toHaveURL(/#\/inicio$/);
  await expect(page.getByRole("heading", { name: "Início", level: 1 })).toBeVisible();
});

test("[I7-02] Dado wiki já configurada Quando tento acessar o onboarding Então sou redirecionado ao Início", async ({ page, app }) => {
  // O fixture vault padrão já tem wiki/pessoal e wiki/trabalho
  await page.goto(`${app.url}#/onboarding/1`);
  await expect(page).toHaveURL(/#\/inicio$/);
  await expect(page.getByRole("heading", { name: "Início", level: 1 })).toBeVisible();
});

test("[I7-03] Dado Onboarding 4 Quando clico em Ingerir fonte Então conclui e navega para o chat", async ({ page, app, vault }) => {
  // Prepara estado para estar no Onboarding 4
  await mkdir(join(vault.raw, "exemplo"), { recursive: true });
  await writeFile(join(vault.raw, "exemplo", "llm-wiki.md"), "# LLM Wiki\nTexto de teste.\n");
  await rm(join(vault.raiz, ".anvilore", "identidade"), { force: true });
  await mkdir(join(vault.raiz, ".anvilore"), { recursive: true });
  await writeFile(join(vault.raiz, ".anvilore", "onboarding.json"), JSON.stringify({ etapa: 4, concluido: false }));

  // Remove áreas existentes para permitir visualização do onboarding
  await rm(join(vault.wiki, "pessoal"), { recursive: true, force: true });
  await rm(join(vault.wiki, "trabalho"), { recursive: true, force: true });

  await page.goto(`${app.url}#/onboarding/4`);
  await expect(page).toHaveURL(/#\/onboarding\/4$/);
  await expect(page.getByRole("heading", { name: "Faça a primeira ingestão", level: 1 })).toBeVisible();

  // Clica no botão de ingestão da fonte
  const botaoIngerir = page.getByRole("button", { name: /Ingerir em/ });
  await expect(botaoIngerir).toBeVisible();
  await botaoIngerir.click();

  // Deve navegar para a conversa criada no chat
  await expect(page).toHaveURL(/#\/chat\/[a-z0-9-]+$/);

  // Verifica que onboarding foi marcado como concluído
  const conteudoOnboarding = JSON.parse(await readFile(join(vault.raiz, ".anvilore", "onboarding.json"), "utf8")) as Record<string, unknown>;
  expect(conteudoOnboarding.concluido).toBe(true);
});
