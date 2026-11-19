import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./prints",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: "./apoio/global-setup.ts",
  globalTeardown: "./apoio/global-teardown.ts",
  reporter: "list",
  outputDir: "./resultados/prints",
  use: {
    locale: "pt-BR",
    timezoneId: "America/Fortaleza",
    viewport: { width: 1280, height: 800 },
    colorScheme: "light",
    trace: "off",
    screenshot: "off",
    browserName: "chromium",
  },
});
