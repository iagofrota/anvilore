import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
import { readdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "../apoio/fixtures";
import { escolherArquivo } from "../apoio/acoes";
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

test("[C02] Dado um rascunho pendente Quando uma página de outra origem envia POST no-cors com aprovação válida Então o servidor responde 403 e só a origem da sessão aprova", async ({ page, app, oraculo, vault, origensExternas }) => {
  const caminho = "wiki/pessoal/concepts/protegida.md";
  await vault.escrever(caminho, paginaGerada("protegida", "Sem aprovação."));
  const item = (await oraculo.get<{ caminho: string; versao: string }[]>("/api/rascunhos")).find(rascunho => rascunho.caminho === "pessoal/concepts/protegida.md")!;
  expect(item.versao).toMatch(/^[a-f0-9]{64}$/);
  // Página atacante em outra porta: o Origin enviado pelo navegador é diferente de `app.base`, sem alterar a CSP do produto.
  const atacante = createServer((_pedido, resposta) => { resposta.setHeader("content-type", "text/html; charset=utf-8"); resposta.end("<!doctype html><title>atacante</title>"); });
  await new Promise<void>(resolvePorta => atacante.listen(0, "127.0.0.1", resolvePorta));
  const origemAtacante = `http://127.0.0.1:${(atacante.address() as AddressInfo).port}`;
  expect(origemAtacante).not.toBe(app.base);
  origensExternas.add(origemAtacante);
  try {
    await page.goto(origemAtacante);
    const recusa = page.waitForResponse(resposta => resposta.url().includes("/api/aprovar") && resposta.request().method() === "POST");
    const visto = await page.evaluate(async ({ base, token, corpo }) => {
      const resposta = await fetch(`${base}/api/aprovar?token=${encodeURIComponent(token)}`, { method: "POST", mode: "no-cors", headers: { "content-type": "text/plain" }, body: JSON.stringify(corpo) });
      return { tipo: resposta.type, status: resposta.status, origem: location.origin };
    }, { base: app.base, token: app.token, corpo: { caminho: item.caminho, versao: item.versao } });
    expect(visto).toEqual({ tipo: "opaque", status: 0, origem: origemAtacante });
    const resposta = await recusa;
    expect(resposta.status()).toBe(403);
  } finally { await new Promise(resolveFim => atacante.close(resolveFim)); }
  expect((await vault.ler(caminho)).toString()).not.toContain("verified:");
  // Controle positivo: a mesma carga, com o Origin da sessão, é válida e aprova.
  const controle = await oraculo.post<{ codigo: number }>("/api/aprovar", { caminho: item.caminho, versao: item.versao });
  expect(controle.status).toBe(200);
  expect((await vault.ler(caminho)).toString()).toContain("verified:");
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
    await escolherArquivo(page, { name: "llm-wiki.md", mimeType: "text/markdown", buffer: Buffer.from(FONTE) });
    await page.getByRole("button", { name: "Ingerir", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("aponta para fora");
    await expect(page.getByText("llm-wiki.md")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ingerir", exact: true })).toBeEnabled();
    expect(await readdir(vault.fora)).toEqual([]);
    expect((await oraculo.get<{ conversas: unknown[] }>("/api/ingestao")).conversas).toEqual([]);
    expect(existsSync(join(vault.raw, "pessoal", "llm-wiki.md"))).toBe(false);
  });
}
