import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "../apoio/fixtures";
import { escolherArquivo } from "../apoio/acoes";
import { paginaGerada } from "../apoio/paginas";
import { roteiroComLeitorParado } from "../apoio/roteiros";
import { FONTE } from "../../tests/apoio/ingestao-exemplo";

// Wiki "real" de isca: o runner a exporta no ambiente, como faria quem usa ANVILORE_WIKI na shell.
const isca = join(tmpdir(), `anvilore-e2e-isca-${randomBytes(5).toString("hex")}`);
const hash = (caminho: string) => createHash("sha256").update(readFileSync(caminho)).digest("hex");

test.describe("[isolamento] variáveis do runner que apontam para fora do vault", () => {
  test.use({ ambienteDoRunner: { ...process.env, ANVILORE_WIKI: join(isca, "wiki"), ANVILORE_DESTINO: isca, GIT_DIR: join(isca, ".git"), GIT_WORK_TREE: isca, CLAUDE_CONFIG_DIR: join(isca, "claude") } });
  test("Dado ANVILORE_WIKI exportado no runner Quando aprovo um rascunho do vault Então só o vault ganha verified e a wiki de isca fica intacta", async ({ page, app, vault }) => {
    const rascunhoDaIsca = join(isca, "wiki/pessoal/concepts/isca.md");
    mkdirSync(join(isca, "wiki/pessoal/concepts"), { recursive: true });
    writeFileSync(join(isca, "wiki/index.md"), "# Índice\n");
    writeFileSync(rascunhoDaIsca, paginaGerada("isca", "Rascunho que não pode ser aprovado pelo teste."));
    const antes = hash(rascunhoDaIsca);
    try {
      await vault.escrever("wiki/pessoal/concepts/protegida.md", paginaGerada("protegida", "Rascunho do vault."));
      await vault.escrever("wiki/pessoal/index.md", "# Pessoal\n\n- [[segundo-cerebro]]\n- [[protegida]]\n");
      await page.goto(`${app.base}/?token=${encodeURIComponent(app.token)}#/revisao`);
      await expect(page.getByRole("option")).toHaveCount(1);
      await expect(page.getByRole("option")).toContainText("protegida");
      const aprovacao = page.waitForResponse(resposta => resposta.url().includes("/api/aprovar") && resposta.request().method() === "POST");
      await page.getByRole("button", { name: "Aprovar" }).click();
      expect((await aprovacao).status()).toBe(200);
      // Com a fila vazia a tela valida a wiki; esperar o resultado evita um processo ainda gravando no vault ao limpar.
      await expect(page.locator(".result-badge")).toContainText("CÓDIGO 0 · PASS");
      expect((await vault.ler("wiki/pessoal/concepts/protegida.md")).toString()).toContain("by: human:teste");
      expect(hash(rascunhoDaIsca)).toBe(antes);
      expect(readFileSync(rascunhoDaIsca, "utf8")).not.toContain("verified:");
    } finally { rmSync(isca, { recursive: true, force: true }); }
  });
});

test("[isolamento] Dado o ambiente do servidor com ANVILORE_WIKI Quando ele sobe Então recusa antes de abrir porta", async ({ vault }) => {
  const resultado = spawnSync("bun", [join(process.cwd(), "e2e/apoio/servidor.ts"), join(vault.raiz, "inexistente.json")], {
    env: { PATH: process.env.PATH, ANVILORE_WIKI: join(vault.raiz, "wiki"), GIT_DIR: join(vault.raiz, ".git") }, encoding: "utf8", timeout: 15_000,
  });
  expect(resultado.status).not.toBe(0);
  expect(resultado.stdout).toBe("");
  expect(resultado.stderr).toContain("recusa subir");
  expect(resultado.stderr).toContain("ANVILORE_WIKI");
  expect(resultado.stderr).toContain("GIT_DIR");
});

test.describe("[isolamento] encerramento do servidor", () => {
  test.use({ roteiro: roteiroComLeitorParado("encerrar") });
  test("Dado o leitor rodando Quando o servidor recebe SIGTERM Então o processo do agente deixa de existir", async ({ page, app, agente, vault }) => {
    await page.goto(app.url);
    await escolherArquivo(page, { name: "llm-wiki.md", mimeType: "text/markdown", buffer: Buffer.from(FONTE) });
    await page.getByRole("button", { name: "Ingerir", exact: true }).click();
    await agente.pronto("encerrar");
    const [leitor] = await agente.invocacoes("leitor");
    const pid = leitor!.pid as number;
    expect(Number.isInteger(pid)).toBe(true);
    expect(() => process.kill(pid, 0)).not.toThrow();
    // Sem a tela aberta não há polling falhando contra o servidor que vai sair.
    await page.goto("about:blank");
    const saiu = new Promise<void>(resolveSaida => app.processo.once("exit", () => resolveSaida()));
    app.processo.kill("SIGTERM");
    await saiu;
    await expect.poll(() => { try { process.kill(pid, 0); return "vivo"; } catch (erro) { return (erro as NodeJS.ErrnoException).code; } }).toBe("ESRCH");
    expect(await realpath(vault.raiz)).toContain("anvilore-e2e-");
  });
});
