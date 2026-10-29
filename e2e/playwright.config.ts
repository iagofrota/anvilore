import { defineConfig } from "@playwright/test";

const ci = process.env.CI === "true";

export default defineConfig({
  testDir: "./specs",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  workers: ci ? 2 : undefined,
  retries: 0,
  forbidOnly: ci,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  globalSetup: "./apoio/global-setup.ts",
  globalTeardown: "./apoio/global-teardown.ts",
  reporter: ci
    ? [["list"], ["html", { outputFolder: "resultados/relatorio", open: "never" }], ["github"]]
    : [["list"], ["html", { outputFolder: "resultados/relatorio", open: "never" }]],
  outputDir: "resultados/artefatos",
  use: {
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: process.env.E2E_VIDEO === "1" ? "on" : "off",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
