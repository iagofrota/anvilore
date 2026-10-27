import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { criarNucleo } from "../src/busca/nucleo";

const temporarios: string[] = [];
afterEach(() => { for (const dir of temporarios.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function raizTemporaria(): string {
  const raiz = mkdtempSync(join(tmpdir(), "anvilore-nucleo-")); temporarios.push(raiz); return raiz;
}
function escrever(raiz: string, caminho: string, texto: string): void {
  const arquivo = join(raiz, "wiki", caminho); mkdirSync(join(arquivo, ".."), { recursive: true }); writeFileSync(arquivo, texto);
}
function frontmatter({ generated = false, verified = false, type = "concept", area = "tributos" }: { generated?: boolean; verified?: boolean; type?: string; area?: string } = {}): string {
  if (!generated) return `---\ntitle: IBS\nslug: ibs\ntype: ${type}\narea: ${area}\n---\n`;
  return `---\ntitle: IBS\nslug: ibs\ntype: ${type}\narea: ${area}\ngenerated:\n  by: agent/model\n  at: '2026-01-01T00:00:00Z'\n${verified ? "verified:\n  by: human:iago\n  at: '2026-01-02T00:00:00Z'\n" : ""}---\n`;
}
function nucleo(raiz: string, wiki = join(raiz, "wiki")) { return criarNucleo({ raiz, wiki, arquivoDb: join(raiz, ".anvilore", "indice.db") }); }

test("Dado arquivo criado após criarNucleo, Quando busca, Então sincroniza e encontra", async () => {
  const raiz = raizTemporaria(); const n = nucleo(raiz); escrever(raiz, "novo.md", `${frontmatter()}## IBS\nnovidade exclusiva`);
  const resposta = await n.buscar("novidade");
  expect("erro" in resposta).toBe(false);
  if (!("erro" in resposta)) expect(resposta.resultados[0]?.caminho).toBe("novo.md");
});

test("Dado páginas verificadas e rascunho equivalentes, Quando busca, Então verificada vem primeiro e rascunho é marcado", async () => {
  const raiz = raizTemporaria();
  escrever(raiz, "a-rascunho.md", `${frontmatter({ generated: true })}## Crédito\ncrédito IBS comum`);
  escrever(raiz, "b-verificada.md", `${frontmatter({ generated: true, verified: true })}## Crédito\ncrédito IBS comum`);
  const resposta = await nucleo(raiz).buscar("crédito comum");
  if ("erro" in resposta) throw new Error(resposta.erro.mensagem);
  expect(resposta.resultados.map((r) => r.estado)).toEqual(["verificada", "rascunho"]);
});

test("Dado seção com contradição, Quando aparece na busca, Então traz aviso", async () => {
  const raiz = raizTemporaria(); escrever(raiz, "a.md", `${frontmatter()}## Regra\n> [!contradiction]\ncontribuição divergente`);
  const resposta = await nucleo(raiz).buscar("contribuição divergente");
  if ("erro" in resposta) throw new Error(resposta.erro.mensagem);
  expect(resposta.resultados[0]?.avisos).toEqual(["contradicao"]);
});

test("Dado termo sem correspondência, Quando busca, Então devolve vazia verdadeira", async () => {
  const raiz = raizTemporaria(); escrever(raiz, "a.md", `${frontmatter()}## Regra\ncontribuição`);
  const resposta = await nucleo(raiz).buscar("imposto extraordinário");
  if ("erro" in resposta) throw new Error(resposta.erro.mensagem);
  expect(resposta).toMatchObject({ vazia: true, resultados: [] });
});

test("Dado consulta vazia, Quando busca, Então devolve vazia sem erro", async () => {
  const raiz = raizTemporaria(); mkdirSync(join(raiz, "wiki"));
  const resposta = await nucleo(raiz).buscar("?!");
  expect("erro" in resposta).toBe(false);
  if (!("erro" in resposta)) expect(resposta.vazia).toBe(true);
});

test("Dado índice existente, Quando indexa completo, Então força reindexação", async () => {
  const raiz = raizTemporaria(); escrever(raiz, "a.md", `${frontmatter()}## X\ntexto`); const n = nucleo(raiz);
  await n.indexar();
  expect((await n.indexar({ completo: true })).reindexadas).toBe(1);
});

test("Dado categoria log, Quando busca padrão e inclui log, Então só a segunda busca inclui", async () => {
  const raiz = raizTemporaria(); escrever(raiz, "conhecimento.md", `${frontmatter()}## registro\ntermo exclusivo`); escrever(raiz, "log/hoje.md", `${frontmatter()}## registro\ntermo exclusivo`);
  const n = nucleo(raiz); const normal = await n.buscar("exclusivo"); const comLog = await n.buscar("exclusivo", { incluir: ["log"] });
  if ("erro" in normal || "erro" in comLog) throw new Error("erro de busca");
  expect(normal.resultados.map((r) => r.caminho)).toEqual(["conhecimento.md"]);
  expect(comLog.resultados.map((r) => r.caminho).sort()).toEqual(["conhecimento.md", "log/hoje.md"]);
});

test("Dado tipo e área, Quando filtra, Então retorna apenas páginas compatíveis", async () => {
  const raiz = raizTemporaria(); escrever(raiz, "a.md", `${frontmatter({ type: "concept", area: "tributos" })}## X\ntermo`); escrever(raiz, "b.md", `${frontmatter({ type: "source", area: "saude" })}## X\ntermo`);
  const resposta = await nucleo(raiz).buscar("termo", { tipo: ["source"], area: ["saude"] });
  if ("erro" in resposta) throw new Error(resposta.erro.mensagem);
  expect(resposta.resultados.map((r) => [r.tipo, r.area])).toEqual([["source", "saude"]]);
});

test("Dado 25 páginas compatíveis, Quando pede limite 50, Então retorna no máximo 20", async () => {
  const raiz = raizTemporaria(); for (let i = 0; i < 25; i++) escrever(raiz, `${i}.md`, `${frontmatter()}## X\ntermo comum`);
  const resposta = await nucleo(raiz).buscar("termo", { limite: 50 });
  if ("erro" in resposta) throw new Error(resposta.erro.mensagem);
  expect(resposta.resultados).toHaveLength(20);
});

test("Dado explicação opcional, Quando ativa, Então traz bm25, autoridade e termos", async () => {
  const raiz = raizTemporaria(); escrever(raiz, "a.md", `${frontmatter()}## X\ntermo`); const n = nucleo(raiz);
  const sim = await n.buscar("termo", { explicar: true }); const nao = await n.buscar("termo");
  if ("erro" in sim || "erro" in nao) throw new Error("erro de busca");
  expect(sim.resultados[0]?.explicacao).toMatchObject({ autoridade: 1.1, termos: ["termo"] });
  expect("explicacao" in (nao.resultados[0] ?? {})).toBe(false);
});

test("Dado wiki inexistente, Quando busca, Então retorna wiki_ausente", async () => {
  const raiz = raizTemporaria(); const resposta = await nucleo(raiz).buscar("termo");
  expect(resposta).toMatchObject({ erro: { codigo: "wiki_ausente" } });
});

test("Dado wiki inexistente, Quando resume, Então devolve resumo vazio", async () => {
  const raiz = raizTemporaria();
  expect(await nucleo(raiz).resumoDaWiki()).toEqual({ paginas: 0, secoes: 0, porEstado: { manual: 0, verificada: 0, rascunho: 0 }, areas: [], titulos: [] });
});

test("Dado sintaxe explícita inválida, Quando busca, Então usa fallback literal", async () => {
  const raiz = raizTemporaria(); escrever(raiz, "a.md", `${frontmatter()}## X\nfrase de teste`);
  const resposta = await nucleo(raiz).buscar('"frase');
  expect("erro" in resposta).toBe(false);
});

test("Dado caminho do índice ocupado por diretório, Quando busca, Então devolve indice_corrompido", async () => {
  const raiz = raizTemporaria(); mkdirSync(join(raiz, "wiki")); mkdirSync(join(raiz, ".anvilore", "indice.db"), { recursive: true });
  expect(await nucleo(raiz).buscar("termo")).toMatchObject({ erro: { codigo: "indice_corrompido" } });
});

test("Dado arquivo SQLite corrompido, Quando busca, Então reconstrói uma vez e encontra", async () => {
  const raiz = raizTemporaria(); escrever(raiz, "a.md", `${frontmatter()}## X\ntermo`); mkdirSync(join(raiz, ".anvilore")); writeFileSync(join(raiz, ".anvilore", "indice.db"), "lixo");
  const resposta = await nucleo(raiz).buscar("termo");
  if ("erro" in resposta) throw new Error(resposta.erro.mensagem);
  expect(resposta.resultados).toHaveLength(1);
});

test("Dado seção endereçada, Quando lê sem linhaFim, Então devolve a seção inteira", async () => {
  const raiz = raizTemporaria(); escrever(raiz, "a.md", `${frontmatter()}## Um\nlinha A\nlinha B\n## Dois\nlinha C`); const n = nucleo(raiz);
  const leitura = await n.ler({ caminho: "a.md", linhaInicio: 7 });
  expect(leitura).toMatchObject({ linhaInicio: 7, linhaFim: 9, conteudo: "## Um\nlinha A\nlinha B" });
});

test("Dado página com 130 linhas, Quando lê, Então limita 120 e 8 KB", async () => {
  const raiz = raizTemporaria(); escrever(raiz, "a.md", `${frontmatter()}## Grande\n${Array.from({ length: 130 }, (_, i) => `${i}: ${"x".repeat(100)}`).join("\n")}`);
  const leitura = await nucleo(raiz).ler({ caminho: "a.md" });
  expect(leitura).toMatchObject({ truncado: true });
  if (!("erro" in leitura)) { expect(leitura.conteudo.split("\n").length).toBeLessThanOrEqual(120); expect(Buffer.byteLength(leitura.conteudo)).toBeLessThanOrEqual(8 * 1024); }
});

test("Dado caminho fora de wiki, Quando lê, Então recusa traversal, absoluto, drive e raw", async () => {
  const raiz = raizTemporaria(); escrever(raiz, "a.md", `${frontmatter()}## X\ntexto`); const n = nucleo(raiz);
  for (const caminho of ["../raw/a.md", join(raiz, "raw.md"), "C:\\raw\\a.md", "raw/a.md"]) expect(await n.ler({ caminho })).toMatchObject({ erro: { codigo: "fora_da_wiki" } });
});

test("Dado symlink para fora da wiki, Quando lê, Então recusa o alvo real", async () => {
  if (process.platform === "win32") return;
  const raiz = raizTemporaria(); const fora = join(raiz, "fora.md"); writeFileSync(fora, "segredo"); mkdirSync(join(raiz, "wiki"));
  try { symlinkSync(fora, join(raiz, "wiki", "link.md")); } catch { return; }
  expect(await nucleo(raiz).ler({ caminho: "link.md" })).toMatchObject({ erro: { codigo: "fora_da_wiki" } });
});

test("Dado caminho de página inexistente e linha além do arquivo, Quando lê, Então retorna erros estáveis", async () => {
  const raiz = raizTemporaria(); escrever(raiz, "a.md", `${frontmatter()}## X\ntexto`); const n = nucleo(raiz);
  expect(await n.ler({ caminho: "nao.md" })).toMatchObject({ erro: { codigo: "arquivo_inexistente" } });
  expect(await n.ler({ caminho: "a.md", linhaInicio: 99 })).toMatchObject({ erro: { codigo: "linha_fora_do_arquivo" } });
});

test("Dado página com UTF-8 inválido, Quando tenta ler, Então não devolve texto substituto", async () => {
  const raiz = raizTemporaria(); mkdirSync(join(raiz, "wiki")); writeFileSync(join(raiz, "wiki", "ruim.md"), new Uint8Array([0xC3, 0x28]));
  expect(await nucleo(raiz).ler({ caminho: "ruim.md" })).toMatchObject({ erro: { codigo: "indice_corrompido" } });
});

test("Dado caminho em NFD, Quando lê arquivo NFC, Então resolve nome normalizado", async () => {
  const raiz = raizTemporaria(); escrever(raiz, "tributação.md", `${frontmatter()}## X\ntexto`);
  const leitura = await nucleo(raiz).ler({ caminho: "tributac\u0327a\u0303o.md" });
  expect("erro" in leitura).toBe(false);
});

test("Dado páginas com estados e áreas, Quando resume wiki, Então agrega contagens e títulos", async () => {
  const raiz = raizTemporaria(); escrever(raiz, "a.md", `${frontmatter()}## X\ntexto`); escrever(raiz, "b.md", `${frontmatter({ area: "saude" })}## Y\ntexto`);
  const resumo = await nucleo(raiz).resumoDaWiki();
  expect(resumo).toMatchObject({ paginas: 2, secoes: 2, porEstado: { manual: 2, verificada: 0, rascunho: 0 } });
  expect(resumo.areas).toEqual([{ area: "saude", paginas: 1 }, { area: "tributos", paginas: 1 }]);
});
