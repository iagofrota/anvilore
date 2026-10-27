import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { caminhoDaCopia, listarFilaRascunhos } from "../src/lib/ui-fila";

let raiz: string;
beforeEach(() => { raiz = mkdtempSync(join(tmpdir(), "anvilore-ui-fila-")); mkdirSync(join(raiz, "wiki/pessoal/concepts"), { recursive: true }); });
afterEach(() => rmSync(raiz, { recursive: true, force: true }));

const pagina = (slug: string, generated: string, verified = "", corpo = "Corpo original\n") =>
  writeFileSync(join(raiz, `wiki/pessoal/concepts/${slug}.md`), `---\ntype: concept\nslug: ${slug}\ntitle: ${slug}\ngenerated:\n  by: agente/teste\n  at: ${generated}\n${verified}---\n\n${corpo}`);

test("Dado página gerada sem verified Quando abro Revisão Então aparece como nova com tipo e caminho", async () => {
  pagina("nova", "2026-10-27T10:00:00Z");
  const fila = await listarFilaRascunhos(raiz);
  expect(fila).toHaveLength(1);
  expect(fila[0]).toMatchObject({ caminho: "pessoal/concepts/nova.md", titulo: "nova", tipo: "concept", status: "nova" });
});

test("Dado generated posterior ao verified humano Quando abro Revisão Então aparece atualizada com aprovação antiga", async () => {
  pagina("atualizada", "2026-10-27T12:00:00Z", "verified:\n  - by: human:ana\n    at: 2026-10-27T11:00:00Z\n");
  const fila = await listarFilaRascunhos(raiz);
  expect(fila[0]).toMatchObject({ status: "atualizada", aprovacaoAnterior: "deixa de valer" });
});

test("Dado generated dois nanos depois do verified Quando abro Revisão Então preservo a atualização", async () => {
  pagina("precisa", "2026-10-27T12:00:00.000000002Z", "verified:\n  - by: human:ana\n    at: 2026-10-27T12:00:00.000000001Z\n");
  expect(await listarFilaRascunhos(raiz)).toMatchObject([{ status: "atualizada" }]);
});

test("Dado página aprovada após generated Quando abro Revisão Então não aparece na fila", async () => {
  pagina("aprovada", "2026-10-27T10:00:00Z", "verified:\n  - by: human:ana\n    at: 2026-10-27T11:00:00Z\n");
  expect(await listarFilaRascunhos(raiz)).toHaveLength(0);
});

test("Dado frontmatter malformado Quando abro Revisão Então aparece erro real do validador e não pode aprovar", async () => {
  writeFileSync(join(raiz, "wiki/pessoal/concepts/quebrada.md"), "---\ntype: [\n---\ntexto\n");
  const fila = await listarFilaRascunhos(raiz);
  expect(fila[0]?.status).toBe("erro");
  expect(fila[0]?.erros?.join(" ")).toContain("frontmatter YAML invalido, nao foi possivel ler");
  expect(fila[0]?.aprovavel).toBe(false);
});

test("Dado generated inválido Quando abro Revisão Então mostro a reprovação do validador e bloqueio aprovação", async () => {
  writeFileSync(join(raiz, "wiki/pessoal/concepts/geracao-invalida.md"), "---\ntype: concept\nslug: geracao-invalida\ntitle: Gerada\ngenerated: ontem\n---\ntexto\n");
  const fila = await listarFilaRascunhos(raiz);
  expect(fila[0]?.status).toBe("erro");
  expect(fila[0]?.erros?.join(" ")).toContain("generated deve ser mapping");
  expect(fila[0]?.aprovavel).toBe(false);
});

test("Dado wiki configurada fora do projeto Quando listo a fila Então uso caminhoWiki", async () => {
  const externa = mkdtempSync(join(tmpdir(), "anvilore-wiki-externa-"));
  try {
    mkdirSync(join(externa, "concepts"), { recursive: true });
    writeFileSync(join(externa, "concepts/externa.md"), "---\ntype: concept\nslug: externa\ntitle: Externa\ngenerated:\n  by: agente/teste\n  at: 2026-10-27T10:00:00Z\n---\n");
    expect(await listarFilaRascunhos(raiz, { ANVILORE_WIKI: externa })).toMatchObject([{ caminho: "concepts/externa.md", status: "nova" }]);
  } finally { rmSync(externa, { recursive: true, force: true }); }
});

test("Dado cópias da página em sessões diferentes Quando procuro a cópia Então uso a mais recente", () => {
  const antiga = join(raiz, ".anvilore/ui/copias/2026-10-26/pessoal/concepts/alvo.md");
  const recente = join(raiz, ".anvilore/ui/copias/2026-10-27/pessoal/concepts/alvo.md");
  mkdirSync(join(antiga, ".."), { recursive: true }); mkdirSync(join(recente, ".."), { recursive: true });
  writeFileSync(antiga, "antes\n"); writeFileSync(recente, "depois\n");
  expect(caminhoDaCopia(raiz, "pessoal/concepts/alvo.md")).toBe(recente);
});

test("Dado caminho de cópia com sufixo semelhante Quando procuro Então ignoro a pasta que não é a página", () => {
  const falso = join(raiz, ".anvilore/ui/copias/seed/xpessoal/concepts/alvo.md");
  mkdirSync(join(falso, ".."), { recursive: true });
  writeFileSync(falso, "cópia de outra página");
  expect(caminhoDaCopia(raiz, "pessoal/concepts/alvo.md")).toBeUndefined();
});
