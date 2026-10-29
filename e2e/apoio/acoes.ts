import { expect, type Page } from "@playwright/test";

// A tela só mostra o seletor de área depois de /api/ingestao responder e o React preencher o estado.
// Enviar antes disso manda a área vazia ("Escolha uma área da wiki"), então toda ingestão espera o seletor pronto.
export async function aguardarAreas(page: Page): Promise<void> {
  await expect(page.getByLabel("Área")).toHaveValue("pessoal");
}

export async function escolherArquivo(page: Page, arquivo: { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  await aguardarAreas(page);
  await page.locator('input[type="file"]').setInputFiles(arquivo);
}
