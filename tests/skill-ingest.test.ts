import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { validarWiki } from "../src/comandos/validar";

const raiz = resolve(import.meta.dir, "..");
const skill = readFileSync(join(raiz, "skills/ingest/SKILL.md"), "utf8");
const agents = readFileSync(join(raiz, "AGENTS.md"), "utf8");

// Os blocos ```yaml que a skill manda copiar para cada tipo de página (fonte, entidade, conceito).
function modelos(): Record<string, string> {
  const achados: Record<string, string> = {};
  for (const bloco of skill.matchAll(/```yaml\n(---\n[\s\S]*?\n---)\n```/g)) {
    const tipo = /^type: (\w+)$/m.exec(bloco[1]!)?.[1];
    if (tipo) achados[tipo] = bloco[1]!;
  }
  return achados;
}

describe("skill ingest: portão humano (R70-A)", () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "anvilore-skill-")); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  function gravar(rel: string, conteudo: string) {
    const caminho = join(tmp, "wiki", rel);
    mkdirSync(dirname(caminho), { recursive: true });
    writeFileSync(caminho, conteudo);
  }

  // Preenche o modelo como o agente faria: slug, título, hora atual com offset e uma fonte que existe.
  function pagina(tipo: string, slug: string, aprovada: boolean): string {
    let texto = modelos()[tipo]!
      .replace(/^title: .*$/m, `title: "${slug}"`)
      .replace(/^slug: .*$/m, `slug: ${slug}`)
      .replace(/^original_file: .*$/m, "original_file: raw/exemplo/llm-wiki.md")
      .replace(/^related_sources: .*$/m, "related_sources: [fonte-um]")
      .replace(/^ {2}by: .*$/m, "  by: claude-opus/2026-09")
      .replace(/^ {2}at: .*$/m, "  at: 2026-10-24T10:30:00-03:00")
      .replace(/^date_ingested: .*$/m, "date_ingested: 2026-10-24");
    if (aprovada) texto = texto.replace(/\n---$/, "\nverified:\n  - by: human:ana\n    at: 2026-10-24T11:00:00-03:00\n---");
    return `${texto}\n\nCorpo.\n`;
  }

  function montar(aprovada: boolean) {
    mkdirSync(join(tmp, "raw", "exemplo"), { recursive: true });
    writeFileSync(join(tmp, "raw", "exemplo", "llm-wiki.md"), "fonte");
    gravar("pessoal/sources/fonte-um.md", pagina("source", "fonte-um", aprovada));
    gravar("pessoal/concepts/conceito-um.md", pagina("concept", "conceito-um", aprovada));
    gravar("pessoal/entities/entidade-um.md", pagina("entity", "entidade-um", aprovada));
    gravar("index.md", "# Índice\n\n## Área: pessoal\n\n- [[fonte-um]] — f\n- [[conceito-um]] — c\n- [[entidade-um]] — e\n");
  }

  test("Dado os três modelos de frontmatter da skill Quando existem Então todos têm generated com by e at", () => {
    const m = modelos();
    expect(Object.keys(m).sort()).toEqual(["concept", "entity", "source"]);
    for (const modelo of Object.values(m)) {
      expect(modelo).toMatch(/^generated:\n {2}by: .+\n {2}at: .+$/m);
      expect(modelo).not.toContain("verified");
    }
  });

  test("Dado páginas escritas pelos modelos da skill Quando valido Então só o portão humano reprova, uma vez por página", async () => {
    montar(false);
    const r = await validarWiki(join(tmp, "wiki"));
    expect(r.erros.length).toBe(3);
    for (const erro of r.erros) expect(erro).toContain("página gerada sem aprovação humana");
  });

  test("Dado as mesmas páginas com verified humano posterior Quando valido Então aprova", async () => {
    montar(true);
    const r = await validarWiki(join(tmp, "wiki"));
    expect(r.erros).toEqual([]);
  });
});

describe("skill ingest: contrato do fluxo (R70-B a E)", () => {
  test("Dado o Passo 6 Quando manda registrar Então escreve em wiki/log/log-AAAA-MM-DD.md e proíbe editar wiki/log.md", () => {
    expect(skill).toContain("wiki/log/log-AAAA-MM-DD.md");
    expect(skill).toContain("**Não edite `wiki/log.md`.**");
    expect(skill).not.toMatch(/\*\*`wiki\/log\.md`\*\* — adicione/);
  });

  test("Dado o último passo Quando fecha Então roda o fechamento e não declara concluído se reprovar por outro motivo", () => {
    expect(skill).toContain("bun src/cli.ts fechar wiki");
    expect(skill).toMatch(/Não diga que o ingest está concluído se o fechamento reprovou/);
    expect(skill).toContain("verified:\n  - by: human:<seu-id>");
  });

  test("Dado o Passo 3 Quando escolhe onde gravar Então usa a área (única, perguntada ou nenhuma) e grava area no frontmatter", () => {
    expect(skill).toContain("wiki/<área>/sources/<slug>.md");
    expect(skill).toMatch(/Uma só área.*use-a, sem perguntar/);
    expect(skill).toMatch(/Várias áreas.*pergunte/);
    expect(skill).toContain("layout plano");
    expect(skill).toContain("## Área: <nome>");
  });

  test("Dado o Passo 0 Quando a fonte é pequena Então os subagentes não são exigidos e o modelo é exemplo", () => {
    expect(skill).toContain("acima de 400.000 bytes");
    expect(skill).toContain("pule o Passo 0 inteiro");
    expect(skill).toContain("exemplo, não requisito");
  });

  test("Dado fonte que é URL Quando a skill orienta Então o agente não grava em raw/ (decisão 4)", () => {
    expect(skill).toContain("Você **não** escreve em `raw/`");
    expect(skill).not.toMatch(/capture o \*\*texto integral\*\* para `raw/);
  });

  test("Dado o AGENTS.md Quando descreve o registro e a geração Então é coerente com a skill", () => {
    expect(agents).toContain("wiki/log/log-AAAA-MM-DD.md");
    expect(agents).toContain("bloco `generated`");
    expect(agents).toContain("Não escrever `verified`");
  });
});
