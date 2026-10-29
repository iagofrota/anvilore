import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";

export async function guardarEvidencias(page: Page, tela: "inicio" | "chat" | "revisao"): Promise<void> {
  if (process.env.E2E_EVIDENCIA_VISUAL !== "1") return;
  const pasta = "e2e/resultados/evidencias";
  mkdirSync(pasta, { recursive: true });
  const tema = await page.evaluate(() => document.documentElement.dataset.theme ?? "claro");
  await page.screenshot({ path: `${pasta}/${tela}-${tema}-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${pasta}/${tela}-${tema}-390px.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
}
