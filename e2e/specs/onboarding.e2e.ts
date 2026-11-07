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

test("[I7-03] Dado Onboarding no fluxo real O3→O4 Quando crio áreas e clico em Ingerir fonte Então ingere em pessoal e conclui", async ({ page, app, vault }) => {
  // Prepara estado para estar no Onboarding 3 sem apagar áreas nem identidade
  await mkdir(join(vault.raw, "exemplo"), { recursive: true });
  await writeFile(join(vault.raw, "exemplo", "llm-wiki.md"), "# LLM Wiki\nTexto de teste.\n");
  await mkdir(join(vault.raiz, ".anvilore"), { recursive: true });
  await writeFile(join(vault.raiz, ".anvilore", "onboarding.json"), JSON.stringify({ etapa: 3, concluido: false }));

  await page.goto(`${app.url}#/onboarding/3`);
  await expect(page).toHaveURL(/#\/onboarding\/3$/);
  await expect(page.getByRole("heading", { name: "Você e suas áreas", level: 1 })).toBeVisible();

  // Submete áreas existentes/selecionadas em O3 e avança para O4
  await page.getByRole("button", { name: "Criar áreas →" }).click();
  await expect(page).toHaveURL(/#\/onboarding\/4$/);
  await expect(page.getByRole("heading", { name: "Faça a primeira ingestão", level: 1 })).toBeVisible();

  // Botão de ingestão usa a área pessoal real
  const botaoIngerir = page.getByRole("button", { name: "Ingerir em pessoal" });
  await expect(botaoIngerir).toBeVisible();
  await botaoIngerir.click();

  // Deve navegar para a conversa criada no chat
  await expect(page).toHaveURL(/#\/chat\/[a-z0-9-]+$/);

  // Verifica que onboarding foi marcado como concluído
  const conteudoOnboarding = JSON.parse(await readFile(join(vault.raiz, ".anvilore", "onboarding.json"), "utf8")) as Record<string, unknown>;
  expect(conteudoOnboarding.concluido).toBe(true);
});

test("[I7-04] Dado onboarding no tema claro e escuro Quando alterno o tema Então o documento reflete o tema nas 4 telas", async ({ page, app, vault }) => {
  // Limpar áreas pré-existentes da fixture para simular primeiro uso
  await rm(join(vault.wiki, "pessoal"), { recursive: true, force: true });
  await rm(join(vault.wiki, "trabalho"), { recursive: true, force: true });
  await rm(join(vault.raw, "pessoal"), { recursive: true, force: true });
  await rm(join(vault.raiz, ".anvilore", "identidade"), { force: true });
  await rm(join(vault.raiz, ".anvilore", "onboarding.json"), { force: true });

  await writeFile(join(vault.raiz, "SCHEMA.md"), "# Schema\n");
  await writeFile(join(vault.raiz, "AGENTS.md"), "# Agents\n");
  await mkdir(join(vault.raw, "exemplo"), { recursive: true });
  await writeFile(join(vault.raw, "exemplo", "llm-wiki.md"), "# Exemplo\n");

  await page.goto(`${app.url}#/onboarding/1`);
  await expect(page).toHaveURL(/#\/onboarding\/1$/);

  // Inicia em claro por padrão
  await expect(page.locator("html")).toHaveAttribute("data-theme", "claro");
  const botaoTema = page.getByRole("button", { name: "Alternar tema claro ou escuro" });
  await expect(botaoTema).toBeVisible();

  // Alterna para escuro no O1
  await botaoTema.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "escuro");

  // Avança para O2 mantendo tema escuro
  await page.getByRole("button", { name: "Continuar →" }).click();
  await expect(page).toHaveURL(/#\/onboarding\/2$/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "escuro");

  // Alterna para claro no O2
  await page.getByRole("button", { name: "Alternar tema claro ou escuro" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "claro");

  // Avança para O3 mantendo tema claro
  await page.getByRole("button", { name: "Continuar →" }).click();
  await expect(page).toHaveURL(/#\/onboarding\/3$/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "claro");

  // Avança para O4 mantendo tema
  await page.getByRole("button", { name: "Criar áreas →" }).click();
  await expect(page).toHaveURL(/#\/onboarding\/4$/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "claro");

  // Alterna para escuro no O4
  await page.getByRole("button", { name: "Alternar tema claro ou escuro" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "escuro");
});

test("[I7-05] Dado Onboarding no fluxo O3→O4 Quando crio áreas e escolho envio manual Então o Chat recebe as áreas e permite envio da fonte", async ({ page, app, vault }) => {
  // Prepara estado para estar no Onboarding 3
  await mkdir(join(vault.raiz, ".anvilore"), { recursive: true });
  await writeFile(join(vault.raiz, ".anvilore", "onboarding.json"), JSON.stringify({ etapa: 3, concluido: false }));

  await page.goto(`${app.url}#/onboarding/3`);
  await expect(page).toHaveURL(/#\/onboarding\/3$/);

  // Submete criação de áreas em O3 e avança para O4
  await page.getByRole("button", { name: "Criar áreas →" }).click();
  await expect(page).toHaveURL(/#\/onboarding\/4$/);

  // Clica no botão de envio manual ("Escolher um arquivo .md, .txt ou .pdf")
  const botaoEscolher = page.getByRole("button", { name: /Escolher um arquivo/ });
  await expect(botaoEscolher).toBeVisible();
  await botaoEscolher.click();

  // Aterrissa em #/chat
  await expect(page).toHaveURL(/#\/chat$/);

  // Verifica que o Chat recebeu a lista de áreas e selecionou uma área válida (não vazia)
  const selectArea = page.getByLabel("Área");
  await expect(selectArea).toBeVisible();
  await expect(selectArea).not.toHaveValue("");
  await expect(selectArea).toHaveValue("pessoal");

  // Envia texto na nova ingestão
  const textarea = page.getByLabel("Texto da fonte");
  await textarea.fill("# Minha primeira anotação\nConteúdo enviado pelo chat após onboarding.\n");
  await page.getByRole("button", { name: "Ingerir" }).click();

  // Verifica que a conversa foi iniciada e está associada à área pessoal
  await expect(page).toHaveURL(/#\/chat\/[a-z0-9-]+$/);
  await expect(page.getByText("Área: pessoal")).toBeVisible();
});

test("[I7-06] Dado Onboarding com áreas criadas em O3 Quando recarrego a interface e confirmo a pasta Então continua em O4 em vez de desviar ao Início", async ({ page, app, vault }) => {
  // Limpar áreas pré-existentes da fixture para simular primeiro uso
  await rm(join(vault.wiki, "pessoal"), { recursive: true, force: true });
  await rm(join(vault.wiki, "trabalho"), { recursive: true, force: true });
  await rm(join(vault.raw, "pessoal"), { recursive: true, force: true });
  await rm(join(vault.raiz, ".anvilore", "identidade"), { force: true });
  await rm(join(vault.raiz, ".anvilore", "onboarding.json"), { force: true });

  await writeFile(join(vault.raiz, "SCHEMA.md"), "# Schema\n");
  await writeFile(join(vault.raiz, "AGENTS.md"), "# Agents\n");

  // Início no O1
  await page.goto(`${app.url}#/onboarding/1`);
  await expect(page.getByRole("heading", { name: "Abra a pasta da sua wiki", level: 1 })).toBeVisible();

  // Avança O1 -> O2
  await page.getByRole("button", { name: "Continuar →" }).click();
  await expect(page).toHaveURL(/#\/onboarding\/2$/);

  // Avança O2 -> O3
  await page.getByRole("button", { name: "Continuar →" }).click();
  await expect(page).toHaveURL(/#\/onboarding\/3$/);

  // O3: Cria áreas e avança para O4
  await page.getByRole("button", { name: "Criar áreas →" }).click();
  await expect(page).toHaveURL(/#\/onboarding\/4$/);
  await expect(page.getByRole("heading", { name: "Faça a primeira ingestão", level: 1 })).toBeVisible();

  // Recarrega antes de terminar O4: a abertura inicial cai no O1 (com onboarding não concluído)
  await page.goto(app.url);
  await expect(page).toHaveURL(/#\/onboarding\/1$/);
  await expect(page.getByRole("heading", { name: "Abra a pasta da sua wiki", level: 1 })).toBeVisible();

  // Confirma a pasta no O1: deve continuar para O4, NÃO desviar para o Início
  await page.getByRole("button", { name: "Continuar →" }).click();
  await expect(page).toHaveURL(/#\/onboarding\/4$/);
  await expect(page.getByRole("heading", { name: "Faça a primeira ingestão", level: 1 })).toBeVisible();

  // Conclui o onboarding no O4
  await page.getByRole("button", { name: "Pular por agora" }).click();
  await expect(page).toHaveURL(/#\/inicio$/);
  await expect(page.getByRole("heading", { name: "Início", level: 1 })).toBeVisible();

  // Próxima abertura vai ao Início sem retornar ao onboarding
  await page.reload();
  await expect(page).toHaveURL(/#\/inicio$/);
  await expect(page.getByRole("heading", { name: "Início", level: 1 })).toBeVisible();
});
