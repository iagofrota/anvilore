import { expect, test } from "../apoio/fixtures";
import { escolherArquivo } from "../apoio/acoes";
import { guardarEvidencias } from "../apoio/visuais";

const textoDeTeste = "Rascunho que precisa sobreviver à desconexão temporária.";

async function esperarSemOverflowHorizontal(page: import("@playwright/test").Page) {
  await expect.poll(() => page.evaluate(() => {
    const largura = window.innerWidth;
    const excedentes = [...document.querySelectorAll<HTMLElement>("body *")]
      .map(elemento => {
        const caixa = elemento.getBoundingClientRect();
        return { elemento: `${elemento.tagName.toLowerCase()}${typeof elemento.className === "string" && elemento.className ? `.${elemento.className.trim().replace(/\s+/g, ".")}` : ""}`, esquerda: Math.round(caixa.left), direita: Math.round(caixa.right) };
      })
      .filter(elemento => elemento.direita > largura || elemento.esquerda < 0)
      .slice(0, 8);
    return { semOverflow: document.documentElement.scrollWidth <= largura, largura, scrollWidth: document.documentElement.scrollWidth, excedentes };
  })).toMatchObject({ semOverflow: true });
}

async function prepararConexao(page: import("@playwright/test").Page) {
  let online = true;
  let batimentos = 0;
  await page.route("**/api/batimento*", async rota => {
    batimentos++;
    if (!online) return rota.abort();
    return rota.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  return {
    desconectar: async () => {
      await expect.poll(() => batimentos).toBe(1);
      online = false;
      for (const total of [2, 3, 4]) {
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect.poll(() => batimentos).toBe(total);
      }
      await expect(page.locator(".connection-warning, [role='alert']")).toBeVisible();
    },
    reconectar: async () => {
      online = true;
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect.poll(() => batimentos).toBe(5);
      await expect(page.getByRole("status")).toHaveCount(0);
    },
  };
}

test("[C09.a][P2 texto] Dado texto não enviado Quando três batimentos falham e a conexão volta Então o formulário mantém o foco e envia o texto original", async ({ page, app, vault }) => {
  const reconectar = await prepararConexao(page);
  await page.goto(`${app.url}#/chat`);
  const campo = page.getByLabel("Texto da fonte");
  await expect(campo).toBeVisible();
  await campo.fill(textoDeTeste);
  await campo.focus();

  await reconectar.desconectar();

  await expect(campo).toHaveCount(1);
  await expect(campo).toHaveValue(textoDeTeste);
  await expect(page.getByRole("status")).toHaveText("Conexão com o Anvilore perdida. Tentando reconectar…");
  await guardarEvidencias(page, "chat");
  await page.setViewportSize({ width: 390, height: 844 });
  await esperarSemOverflowHorizontal(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await reconectar.reconectar();

  await expect(campo).toHaveValue(textoDeTeste);
  expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Texto da fonte");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const enviado = page.waitForResponse(resposta => resposta.url().includes("/api/fontes") && resposta.request().method() === "POST");
  await page.getByRole("button", { name: "Ingerir", exact: true }).click();
  const resposta = await enviado;
  expect(resposta.status()).toBe(201);
  await expect(page).toHaveURL(/#\/chat\//);
  const bruto = await vault.ler((await resposta.json() as { fonte: string }).fonte);
  expect(bruto?.toString()).toContain(textoDeTeste);
});

test("[C09.a][P2 arquivo] Dado arquivo escolhido Quando três batimentos falham e a conexão volta Então a seleção permanece e o envio usa os bytes originais", async ({ page, app, vault }) => {
  const reconectar = await prepararConexao(page);
  await page.goto(`${app.url}#/chat`);
  const bytes = Buffer.from("Arquivo selecionado antes da falha.\nConteúdo exato.", "utf8");
  await escolherArquivo(page, { name: "fonte-desconexao.md", mimeType: "text/markdown", buffer: bytes });
  await expect(page.locator(".dropzone")).toContainText("fonte-desconexao.md");

  await reconectar.desconectar();

  await expect(page.locator(".dropzone")).toHaveCount(1);
  await expect(page.locator(".dropzone")).toContainText("fonte-desconexao.md");
  await expect(page.getByRole("status")).toHaveText("Conexão com o Anvilore perdida. Tentando reconectar…");
  await guardarEvidencias(page, "chat");
  await page.setViewportSize({ width: 390, height: 844 });
  await esperarSemOverflowHorizontal(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await reconectar.reconectar();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const enviado = page.waitForResponse(resposta => resposta.url().includes("/api/fontes") && resposta.request().method() === "POST");
  await page.getByRole("button", { name: "Ingerir", exact: true }).click();
  const resposta = await enviado;
  expect(resposta.status()).toBe(201);
  await expect(page).toHaveURL(/#\/chat\//);
  expect(await vault.ler((await resposta.json() as { fonte: string }).fonte)).toEqual(bytes);
});
