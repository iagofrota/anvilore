import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { criarNucleo } from "../src/busca/nucleo";

type Pagina = { path: string; title: string; slug: string; type: string; area: string; state: "manual" | "draft" | "verified"; content: string };
type Par = { consulta: string; esperado: string };
const diretorioFonte = join(import.meta.dir, "apoio", "wiki-dourada");
const paginas = JSON.parse(readFileSync(join(diretorioFonte, "pages.json"), "utf8")) as Pagina[];
const pares = JSON.parse(readFileSync(join(import.meta.dir, "apoio", "dourado.json"), "utf8")) as Par[];

function criarWikiTemporaria(prefixo: string): { raiz: string; wiki: string; nucleo: ReturnType<typeof criarNucleo> } {
  const raiz = mkdtempSync(join(tmpdir(), prefixo)); const wiki = join(raiz, "wiki"); mkdirSync(wiki, { recursive: true });
  writeFileSync(join(wiki, ".gitignore"), readFileSync(join(diretorioFonte, ".gitignore")));
  for (const pagina of paginas) {
    const destino = join(wiki, pagina.path); mkdirSync(join(destino, ".."), { recursive: true });
    const geracao = pagina.state === "manual" ? "generated: 2026-01-01\n" : "generated:\n  by: agent/model\n  at: '2026-01-01T00:00:00Z'\n";
    const aprovacao = pagina.state === "verified" ? "verified:\n  by: human:iago\n  at: '2026-01-02T00:00:00Z'\n" : "";
    writeFileSync(destino, `---\ntitle: ${pagina.title}\nslug: ${pagina.slug}\ntype: ${pagina.type}\narea: ${pagina.area}\n${geracao}${aprovacao}---\n${pagina.content}\n`);
  }
  return { raiz, wiki, nucleo: criarNucleo({ raiz, wiki, arquivoDb: join(raiz, ".anvilore", "indice.db") }) };
}

test("Dado wiki dourada de 15 páginas, Quando busca os pares dourados, Então recall@5 é pelo menos 0,8", async () => {
  const f = criarWikiTemporaria("anvilore-recall-");
  try {
    let acertos = 0; const erros: string[] = [];
    for (const par of pares) {
      const resposta = await f.nucleo.buscar(par.consulta);
      if ("erro" in resposta) { erros.push(`${par.consulta}: ${resposta.erro.codigo}`); continue; }
      const [caminho, linha] = par.esperado.split("#");
      if (resposta.resultados.slice(0, 5).some((r) => r.caminho === caminho && r.linhaInicio === Number(linha))) acertos++;
      else erros.push(par.consulta);
    }
    const recall = acertos / pares.length;
    expect(recall, `recall@5=${recall.toFixed(2)}; pares perdidos: ${erros.join(", ")}`).toBeGreaterThanOrEqual(0.8);
  } finally { rmSync(f.raiz, { recursive: true, force: true }); }
});

test("Dado resultados dourados, Quando serializa buscar limite 5, Então cada resposta tem até 2048 bytes", async () => {
  const f = criarWikiTemporaria("anvilore-budget-");
  try {
    for (const par of pares) {
      const resposta = await f.nucleo.buscar(par.consulta);
      expect(Buffer.byteLength(JSON.stringify(resposta))).toBeLessThanOrEqual(2048);
    }
  } finally { rmSync(f.raiz, { recursive: true, force: true }); }
});

test("Dado busca com limite 20, Quando mede cada resultado, Então nenhum excede 450 bytes", async () => {
  const f = criarWikiTemporaria("anvilore-item-budget-");
  try {
    for (const par of pares) {
      const resposta = await f.nucleo.buscar(par.consulta, { limite: 20 });
      if (!("erro" in resposta)) for (const resultado of resposta.resultados) expect(Buffer.byteLength(JSON.stringify(resultado))).toBeLessThanOrEqual(450);
    }
  } finally { rmSync(f.raiz, { recursive: true, force: true }); }
});

test("Dado seção que contém IBS/CBS, Quando busca IBS, Então encontra pela divisão dos tokens", async () => {
  const f = criarWikiTemporaria("anvilore-ibs-slash-");
  try {
    writeFileSync(join(f.wiki, "slash-only.md"), "---\ntitle: Teste de separadores\nslug: slash-only\ntype: concept\narea: teste\ngenerated: 2026-01-01\n---\n## Sigla\nSomente a expressão IBS/CBS aparece aqui.");
    const resposta = await f.nucleo.buscar("IBS");
    if ("erro" in resposta) throw new Error(resposta.erro.mensagem);
    expect(resposta.resultados.some((r) => r.caminho === "slash-only.md")).toBe(true);
  } finally { rmSync(f.raiz, { recursive: true, force: true }); }
});

test("Dado página com BOM e CRLF, Quando indexa, Então preserva endereço de linha", async () => {
  const f = criarWikiTemporaria("anvilore-crlf-");
  try {
    const arquivo = join(f.wiki, "periodo-teste.md"); const texto = readFileSync(arquivo, "utf8"); writeFileSync(arquivo, `\uFEFF${texto.replaceAll("\n", "\r\n")}`);
    const resposta = await f.nucleo.buscar("mosaico fiscal");
    if ("erro" in resposta) throw new Error(resposta.erro.mensagem);
    expect(resposta.resultados[0]).toMatchObject({ caminho: "periodo-teste.md", linhaInicio: 8 });
  } finally { rmSync(f.raiz, { recursive: true, force: true }); }
});
