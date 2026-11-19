import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "../apoio/fixtures";
import { escolherArquivo } from "../apoio/acoes";
import { init, resultado } from "../../tests/apoio/eventos-claude";
import { relatorioValido } from "../../tests/apoio/ingestao-exemplo";
import type { RoteiroDoFalso } from "../../tests/apoio/claude-falso";

const roteiroVisual = (): RoteiroDoFalso => {
  const relatorio = relatorioValido({
    fonte: "{{FONTE_ATUAL}}",
    takeaways: [
      { texto: "O essencial não se vê à primeira vista.", citacao: { trecho: "O essencial é invisível aos olhos.", secao: "A raposa" }, certeza: "comprovado" },
      { texto: "Criar laços exige tempo e cuidado.", citacao: { trecho: "Foi o tempo que perdeste com a tua rosa que tornou a tua rosa tão importante.", secao: "A raposa" }, certeza: "comprovado" },
      { texto: "A responsabilidade acompanha o afeto.", citacao: { trecho: "Tu te tornas eternamente responsável por aquilo que cativas.", secao: "A raposa" }, certeza: "comprovado" },
    ],
    paginas: [
      { caminho: "pessoal/sources/o-pequeno-principe.md", tipo: "source", acao: "criar", motivo: "Registrar a fonte lida." },
      { caminho: "pessoal/concepts/rosa-e-raposa.md", tipo: "concept", acao: "criar", motivo: "Reunir as ideias centrais sobre cuidado e vínculo." },
    ],
  });
  return {
    auth: { saida: JSON.stringify({ loggedIn: true }) },
    leitor: [{ linha: init() }, { linha: resultado({ structured_output: relatorio }) }],
  };
};

function paginaVisual(corpo: string): string {
  return [
    "---", "type: concept", "slug: cuidado-e-vinculo", "title: Cuidado e vínculo", "tags: [leitura, amizade]",
    "related_sources: []", "related_concepts: [segundo-cerebro]",
    "sources:", "  - resource: raw/pessoal/pequeno-principe.md",
    "generated:", "  by: claude-haiku-4-5/2.1.311", "  at: 2026-02-14T10:00:00-03:00", "---", "", corpo, "",
  ].join("\n");
}

const paginaBase = [
  "---", "type: concept", "slug: segundo-cerebro", "title: Segundo cérebro", "tags: [leitura]",
  "related_sources: []", "related_concepts: [cuidado-e-vinculo]", "---", "",
  "Uma wiki guarda referências que queremos reencontrar.", "",
  "Ela ganha valor quando as ideias se conectam ao longo do tempo.", "",
  "Essa prática se aproxima de [[cuidado-e-vinculo]].", "",
].join("\n");

test.use({ roteiro: roteiroVisual() });

test("gera as imagens de apresentação a partir de um vault sintético", async ({ page, app, vault }) => {
  const pasta = join(process.cwd(), "docs/imagens");
  await mkdir(pasta, { recursive: true });
  const salvar = (tela: string) => page.screenshot({ path: join(pasta, `${tela}.png`), animations: "disabled" });

  await vault.escrever("wiki/pessoal/concepts/segundo-cerebro.md", paginaBase);
  await vault.escrever("wiki/pessoal/concepts/cuidado-e-vinculo.md", paginaVisual("Criar laços pede tempo e atenção.\n\nCuidar de uma ideia é voltar a ela e observar como cresce.\n\nIsso também é uma forma de [[segundo-cerebro]]."));
  await vault.escrever("wiki/index.md", "# Índice\n\n## Área: pessoal\n\n### Conceitos\n\n- [[segundo-cerebro]]\n- [[cuidado-e-vinculo]]\n");
  await vault.escrever("wiki/pessoal/index.md", "# Pessoal\n\n- [[segundo-cerebro]]\n- [[cuidado-e-vinculo]]\n");
  await vault.escrever("wiki/log/log-2026-02-14.md", "## [2026-02-14] ingestao | Uma leitura entrou na biblioteca\n");
  await vault.escrever("raw/pessoal/pequeno-principe.md", "Uma leitura de domínio público sobre amizade e responsabilidade.\n");
  await page.goto(app.url);
  await expect(page.getByRole("heading", { name: "Início" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Saúde da wiki" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "claro");
  await salvar("inicio");

  await page.goto(`${app.url}#/biblioteca`);
  await expect(page.getByRole("heading", { name: "Biblioteca" })).toBeVisible();
  await expect(page.locator(".lib-row-title", { hasText: "Cuidado e vínculo" })).toBeVisible();
  await salvar("biblioteca");

  await vault.escrever("wiki/pessoal/concepts/cuidado-e-vinculo.md", paginaVisual("Uma ideia nova para revisar: criar laços exige tempo e cuidado.\n\nVoltar a ela ajuda a compreender seu valor.\n\nVeja também [[segundo-cerebro]]."));
  await page.goto(`${app.url}#/revisao`);
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.getByRole("option").first().click();
  await expect(page.getByRole("button", { name: "Aprovar" })).toBeEnabled();
  await salvar("revisao");

  await page.goto(`${app.url}#/chat`);
  await expect(page.getByRole("heading", { name: "Nova ingestão" })).toBeVisible();
  await escolherArquivo(page, {
    name: "o-pequeno-principe.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# O Pequeno Príncipe\n\n## A raposa\n\nO essencial é invisível aos olhos.\n\nFoi o tempo que perdeste com a tua rosa que tornou a tua rosa tão importante.\n\nTu te tornas eternamente responsável por aquilo que cativas.\n"),
  });
  await page.getByRole("button", { name: "Ingerir", exact: true }).click();
  await expect(page.locator("label.takeaway")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Pode seguir" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pode seguir" })).toBeEnabled();
  await salvar("chat");
});
