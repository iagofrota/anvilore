import { existsSync } from "node:fs";
import { readdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "../apoio/fixtures";
import { paginaGerada } from "../apoio/paginas";
import { FONTE } from "../../tests/apoio/ingestao-exemplo";

test("[C02] Dado uma sessão local Quando o token falta ou é inválido Então o servidor responde 403 e recusa o acesso", async ({ page, app }) => {
  const semToken = new URL(app.url);
  semToken.searchParams.delete("token");
  const sem = await page.goto(semToken.toString());
  expect(sem?.status()).toBe(403);
  await expect(page.getByText("Acesso recusado", { exact: true })).toBeVisible();
  const errado = new URL(app.url);
  errado.searchParams.set("token", "token-invalido");
  const invalido = await page.goto(errado.toString());
  expect(invalido?.status()).toBe(403);
  await expect(page.getByText("Acesso recusado", { exact: true })).toBeVisible();
});

test("[C02] Dado um rascunho pendente Quando o navegador envia POST no-cors de outra origem Então o servidor recusa sem aprovar", async ({ page, app, oraculo, vault }) => {
  await vault.escrever("wiki/pessoal/concepts/protegida.md", paginaGerada("protegida", "Sem aprovação."));
  const localHostUrl = `http://localhost:${app.porta}/?token=${encodeURIComponent(app.token)}`;
  await page.goto(localHostUrl);
  const resultado = await page.evaluate(async porta => {
    const resposta = await fetch(`http://127.0.0.1:${porta}/api/aprovar?token=${encodeURIComponent(new URL(location.href).searchParams.get("token")!)}`, {
      method: "POST", mode: "no-cors", headers: { "content-type": "text/plain" }, body: "{}",
    });
    return { type: resposta.type, status: resposta.status };
  }, app.porta);
  expect(resultado).toEqual({ type: "opaque", status: 0 });
  expect((await oraculo.get<{ caminho: string }[]>("/api/rascunhos")).map(item => item.caminho)).toContain("pessoal/concepts/protegida.md");
  expect((await vault.ler("wiki/pessoal/concepts/protegida.md")).toString()).not.toContain("verified:");
});

for (const variante of ["raw", "area"] as const) {
  test(`[C15] Dado ${variante === "raw" ? "raw/" : "raw/pessoal/"} ligado para fora do vault Quando envio um arquivo Então a tela recusa e nenhum arquivo externo é criado`, async ({ page, app, oraculo, vault }) => {
    test.skip(process.platform === "win32", "a prova usa symlink POSIX; junction segue coberta por bun:test");
    if (variante === "raw") {
      await rm(vault.raw, { recursive: true, force: true });
      await symlink(vault.fora, vault.raw, "dir");
    } else {
      await rm(join(vault.raw, "pessoal"), { recursive: true, force: true });
      await symlink(vault.fora, join(vault.raw, "pessoal"), "dir");
    }
    await page.goto(app.url);
    await page.locator('input[type="file"]').setInputFiles({ name: "llm-wiki.md", mimeType: "text/markdown", buffer: Buffer.from(FONTE) });
    await page.getByRole("button", { name: "Ingerir", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("aponta para fora");
    await expect(page.getByText("llm-wiki.md")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ingerir", exact: true })).toBeEnabled();
    expect(await readdir(vault.fora)).toEqual([]);
    expect((await oraculo.get<{ conversas: unknown[] }>("/api/ingestao")).conversas).toEqual([]);
    expect(existsSync(join(vault.raw, "pessoal", "llm-wiki.md"))).toBe(false);
  });
}
