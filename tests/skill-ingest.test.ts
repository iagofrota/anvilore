import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { validarWiki } from "../src/comandos/validar";

const raiz = resolve(import.meta.dir, "..");
const skill = readFileSync(join(raiz, "skills/ingest/SKILL.md"), "utf8");
const leitor = readFileSync(join(raiz, "skills/ingest/leitor.md"), "utf8");
const escritor = readFileSync(join(raiz, "skills/ingest/escritor.md"), "utf8");
const agents = readFileSync(join(raiz, "AGENTS.md"), "utf8");

// Os blocos ```yaml que o prompt do escritor manda copiar para cada tipo de página (fonte, entidade, conceito).
function modelos(): Record<string, string> {
  const achados: Record<string, string> = {};
  for (const bloco of escritor.matchAll(/```yaml\n(---\n[\s\S]*?\n---)\n```/g)) {
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
  test("Dado o escritor Quando registra Então escreve no log do dia e proíbe editar log.md", () => {
    expect(escritor).toContain("log/log-AAAA-MM-DD.md");
    expect(escritor).toContain("**Não edite `log.md`**");
    expect(skill).toContain("nem edite `wiki/log.md`");
  });

  test("Dado o último passo Quando fecha Então roda o fechamento e não declara concluído se reprovar por outro motivo", () => {
    expect(skill).toContain("fechar wiki");
    expect(skill).toMatch(/não declare o ingest concluído/i);
    expect(skill).toContain("Aprovar estas N páginas?");
    expect(skill).not.toContain("bun src/cli.ts fechar wiki");
    expect(skill).not.toContain("verified:\n  - by: human:<seu-id>");
  });

  test("Dado o Passo 0 Quando escolhe onde gravar Então usa a área (única, sugerida na parada ou nenhuma) e grava area no frontmatter", () => {
    expect(skill).toContain("wiki/<área>/sources/<slug>.md");
    expect(skill).toMatch(/Uma só área[\s\S]*?use-a, sem perguntar/);
    expect(skill).toMatch(/Várias áreas.*o leitor sugere uma e ela confirma na\s+parada/);
    expect(skill).toContain("layout plano");
    expect(leitor).toContain("Área: uma só área, use-a.");
    expect(escritor).toContain("## Área: <nome>");
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

// W06/I2: o R70 dispensava subagentes abaixo de 400.000 bytes para não pressupor o Claude Code.
// Agora os papéis são sempre dois; a portabilidade fica: sem subagente restrito, a própria sessão faz
// os dois papéis, guiada pelos mesmos arquivos. O tamanho decide só a janela.
describe("skill ingest: leitor e escritor sempre separados (W06)", () => {
  test("Dado qualquer fonte Quando a skill descreve o fluxo Então há leitor, uma parada e escritor, sem limite de tamanho para separar", () => {
    expect(skill).toContain("A ingestão tem dois papéis e uma parada só.");
    expect(skill).not.toContain("pule o Passo 0 inteiro");
    expect(skill.indexOf("## Passo 1 — O leitor")).toBeLessThan(skill.indexOf("## Passo 2 — A parada"));
    expect(skill.indexOf("## Passo 2 — A parada")).toBeLessThan(skill.indexOf("## Passo 3 — O escritor"));
  });

  test("Dado o Claude Code Quando a skill despacha Então usa os agentes gerados dos prompts", () => {
    expect(skill).toContain("`anvilore-leitor` e `anvilore-escritor`");
    expect(skill).toContain("`anvilore-leitor-grande` e `anvilore-escritor-grande`");
  });

  test("Dado agente sem subagente restrito Quando a skill orienta Então a sessão faz os dois papéis com os mesmos arquivos", () => {
    expect(skill).toMatch(/Codex, Gemini, Copilot[^\n]*faça os dois papéis em\s+sequência, nesta sessão/);
    expect(skill).toContain("Leia `skills/ingest/leitor.md`");
    expect(skill).toContain("leia `skills/ingest/escritor.md`");
  });

  test("Dado fonte grande Quando a skill escolhe a rota Então pede só a janela grande, e o modelo é exemplo", () => {
    expect(skill).toContain("rota-ingestao <fonte>");
    expect(skill).toContain("acima de 400.000 bytes");
    expect(skill).toContain("exemplo, não requisito");
    expect(skill).toContain("`dividir` (sai com 3)");
  });

  test("Dado o fluxo Quando há paradas humanas antes da escrita Então é uma só, com takeaways e páginas juntos", () => {
    expect(skill).toContain("Esta é a **única** parada antes da escrita.");
    expect(skill).not.toContain("Pergunte ao usuário se a lista parece certa");
    expect(skill.match(/Espere a resposta/g)?.length).toBe(1);
  });

  test("Dado o relatório do leitor Quando volta Então a ferramenta o confere antes de mostrar", () => {
    expect(skill).toContain("execute `conferir-leitura .anvilore/ingest/leitura.json`");
    expect(skill).toContain("Relatório de subagente não é prova.");
  });

  test("Dado fonte binária (PDF, imagem) Quando a conferência avisa que não conferiu as citações Então o aviso vai para a pessoa na parada", () => {
    expect(skill).toContain("citações não conferidas automaticamente");
    expect(skill).toMatch(/mostre o `AVISO` na parada/);
  });

  test("Dado a skill Quando fala de comandos Então quem roda é a ferramenta, nunca a pessoa", () => {
    expect(skill).toContain("**Quem roda os comandos é você, nunca a pessoa.**");
    expect(skill).not.toContain("bun src/cli.ts");
    expect(skill).not.toMatch(/(peça|pede) (à|a|para a) pessoa (que )?(rode|execute|rodar|executar)/);
    for (const prompt of [leitor, escritor]) expect(prompt).not.toContain("bun src/cli.ts");
  });

  test("Dado os prompts dos papéis Quando restringem ferramentas Então o leitor só lê e o escritor não roda comando nem toca raw/", () => {
    expect(leitor).toContain("**Você só lê:** usa `Read`, `Grep` e `Glob`.");
    expect(escritor).toContain("Você **nunca** escreve em\n`raw/`, não roda comando (sem `Bash`)");
    expect(escritor).toContain("**Você nunca escreve `verified`.**");
  });

  test("Dado o escritor sem relógio Quando a hora não vem Então ele para em vez de inventar", () => {
    expect(skill).toContain("O escritor não roda comando e não tem relógio");
    expect(escritor).toContain("Se faltar o `at`, pare");
  });

  test("Dado o leitor Quando devolve o relatório Então segue o esquema versionado e as regras da wiki-wonka", () => {
    expect(leitor).toContain("`relatorio-leitor.schema.json` (versão 1)");
    expect(leitor).toContain("Uma afirmação, uma citação.");
    expect(leitor).toContain("**Empresa não é produto.**");
    expect(leitor).toContain("**Conceito novo precisa merecer página.**");
    expect(leitor).toContain("**Sigla ou apelido não é entidade existente.**");
  });
});
