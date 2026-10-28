import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  conferirCitacoes,
  conferirLeitura,
  conferirPaginas,
  CAMINHO_ESQUEMA_RELATORIO_LEITOR,
  esquemaRelatorioLeitor,
  extrairJson,
  validarContraEsquema,
  validarRelatorioLeitor,
} from "../src/lib/relatorio-leitor";

const raiz = resolve(import.meta.dir, "..");

function valido(): any {
  return {
    versao: 1,
    fonte: "raw/exemplo/llm-wiki.md",
    takeaways: [
      { texto: "A wiki acumula conhecimento.", citacao: { trecho: "a wiki acumula", secao: "Ideia central" }, certeza: "comprovado" },
      { texto: "O agente mantém as páginas.", citacao: { trecho: "o agente mantém", secao: "Papéis" }, certeza: "provavel" },
      { texto: "A pessoa cura.", citacao: { trecho: "a pessoa cura", secao: "Papéis" }, certeza: "inferencia" },
    ],
    paginas: [
      { caminho: "pessoal/sources/llm-wiki.md", tipo: "source", acao: "criar", motivo: "resumo da fonte" },
      { caminho: "pessoal/concepts/wiki-viva.md", tipo: "concept", acao: "atualizar", motivo: "acrescenta a ideia central" },
    ],
    lacunas: ["A fonte não diz como medir a qualidade."],
    contradicoes: [{ pagina: "pessoal/concepts/wiki-viva.md", descricao: "Diz que o agente cura; a fonte diz que é a pessoa." }],
  };
}

const fonte = "# Ideia central\n\nA wiki acumula conhecimento.\n\n## Papéis\n\nO agente   mantém\nas páginas e a pessoa cura.\n";

describe("relatório do leitor: o arquivo de esquema é a fonte única", () => {
  test("Dado o esquema versionado Quando o carrego Então é o mesmo arquivo de skills/ingest/", () => {
    const arquivo = JSON.parse(readFileSync(join(raiz, "skills/ingest/relatorio-leitor.schema.json"), "utf8"));
    expect(CAMINHO_ESQUEMA_RELATORIO_LEITOR).toBe(join(raiz, "skills/ingest/relatorio-leitor.schema.json"));
    expect(esquemaRelatorioLeitor()).toEqual(arquivo);
  });

  test("Dado o esquema Quando declara os campos Então exige versão, fonte, takeaways, páginas, lacunas e contradições", () => {
    expect(esquemaRelatorioLeitor().required).toEqual(["versao", "fonte", "takeaways", "paginas", "lacunas", "contradicoes"]);
    expect(esquemaRelatorioLeitor().properties.takeaways.minItems).toBe(3);
    expect(esquemaRelatorioLeitor().properties.takeaways.maxItems).toBe(5);
  });

  test("Dado um esquema com palavra-chave que o validador não conhece Quando valido Então recusa em vez de ignorar", () => {
    expect(() => validarContraEsquema({ type: "string", pattern: "^a" }, "a")).toThrow("palavra-chave não suportada: pattern");
  });

  test("Dado um esquema com tipo que o validador não conhece Quando valido Então recusa", () => {
    expect(() => validarContraEsquema({ type: "number" }, 1)).toThrow("tipo não suportado: number");
  });

  test("Dado regras genéricas do subconjunto Quando valido Então mínimo de texto, lista sem items e objeto aberto funcionam", () => {
    expect(validarContraEsquema({ type: "string", minLength: 3 }, "ab")).toEqual(["$: no mínimo 3 caracteres"]);
    expect(validarContraEsquema({ type: "integer" }, 7)).toEqual([]);
    expect(validarContraEsquema({ type: "array" }, [1, "x"])).toEqual([]);
    expect(validarContraEsquema({ type: "object", properties: { a: { type: "string" } } }, { a: "x", b: 1 })).toEqual([]);
    expect(validarContraEsquema({ type: "object" }, {})).toEqual([]);
  });
});

describe("relatório do leitor: validação do esquema", () => {
  test("Dado um relatório completo Quando valido Então aprova sem erros", () => {
    const r = validarRelatorioLeitor(valido());
    expect(r.erros).toEqual([]);
    expect(r.ok).toBe(true);
  });

  test("Dado um valor que não é objeto Quando valido Então reprova pelo tipo", () => {
    expect(validarRelatorioLeitor([]).erros).toEqual(["$: esperado objeto"]);
    expect(validarRelatorioLeitor(null).erros).toEqual(["$: esperado objeto"]);
  });

  test("Dado dois takeaways Quando valido Então reprova: são de 3 a 5", () => {
    const r = valido();
    r.takeaways = r.takeaways.slice(0, 2);
    expect(validarRelatorioLeitor(r).erros).toEqual(["$.takeaways: no mínimo 3 itens (veio 2)"]);
  });

  test("Dado seis takeaways Quando valido Então reprova: são de 3 a 5", () => {
    const r = valido();
    r.takeaways = [...r.takeaways, ...r.takeaways];
    expect(validarRelatorioLeitor(r).erros).toEqual(["$.takeaways: no máximo 5 itens (veio 6)"]);
  });

  test("Dado takeaway sem citação Quando valido Então reprova pelo campo ausente", () => {
    const r = valido();
    delete r.takeaways[0].citacao;
    expect(validarRelatorioLeitor(r).erros).toEqual(["$.takeaways[0]: falta o campo citacao"]);
  });

  test("Dado trecho vazio Quando valido Então reprova: citação sem texto não sustenta nada", () => {
    const r = valido();
    r.takeaways[1].citacao.trecho = "";
    expect(validarRelatorioLeitor(r).erros).toEqual(["$.takeaways[1].citacao.trecho: texto vazio"]);
  });

  test("Dado certeza fora da lista Quando valido Então reprova e mostra as opções", () => {
    const r = valido();
    r.takeaways[0].certeza = "certo";
    expect(validarRelatorioLeitor(r).erros).toEqual(['$.takeaways[0].certeza: valor fora da lista ("comprovado", "provavel", "inferencia")']);
  });

  test("Dado campo a mais Quando valido Então reprova: o esquema é fechado", () => {
    const r = valido();
    r.resumo = "extra";
    expect(validarRelatorioLeitor(r).erros).toEqual(["$: campo não previsto: resumo"]);
  });

  test("Dado versão diferente de 1 ou não inteira Quando valido Então reprova", () => {
    const r = valido();
    r.versao = 2;
    expect(validarRelatorioLeitor(r).erros).toEqual(["$.versao: valor fora da lista (1)"]);
    r.versao = 1.5;
    expect(validarRelatorioLeitor(r).erros).toEqual(["$.versao: esperado inteiro"]);
  });

  test("Dado lacunas que não são lista de texto Quando valido Então reprova cada item errado", () => {
    const r = valido();
    r.lacunas = "nenhuma";
    expect(validarRelatorioLeitor(r).erros).toEqual(["$.lacunas: esperado lista"]);
    r.lacunas = ["ok", 3];
    expect(validarRelatorioLeitor(r).erros).toEqual(["$.lacunas[1]: esperado texto"]);
  });

  test("Dado listas vazias de lacunas e contradições Quando valido Então aprova: a fonte pode não ter nenhuma", () => {
    const r = valido();
    r.lacunas = [];
    r.contradicoes = [];
    expect(validarRelatorioLeitor(r).erros).toEqual([]);
  });

  test("Dado vários erros Quando valido Então lista todos de uma vez", () => {
    const r = valido();
    r.versao = 2;
    r.paginas[0].acao = "apagar";
    expect(validarRelatorioLeitor(r).erros).toEqual([
      "$.versao: valor fora da lista (1)",
      '$.paginas[0].acao: valor fora da lista ("criar", "atualizar")',
    ]);
  });
});

describe("relatório do leitor: regras além do esquema", () => {
  test("Dado fonte fora de raw/ Quando valido Então reprova: só se ingere de raw/", () => {
    const r = valido();
    r.fonte = "wiki/pessoal/x.md";
    expect(validarRelatorioLeitor(r).erros).toEqual(["$.fonte: a fonte tem de estar em raw/ (veio wiki/pessoal/x.md)"]);
  });

  test("Dado fonte com .. ou absoluta Quando valido Então reprova", () => {
    for (const caminho of ["raw/../wiki/x.md", "/raw/x.md", "raw\\x.md"]) {
      const r = valido();
      r.fonte = caminho;
      expect(validarRelatorioLeitor(r).erros).toEqual([`$.fonte: a fonte tem de estar em raw/ (veio ${caminho})`]);
    }
  });

  test("Dado página com caminho inseguro Quando valido Então reprova o caminho", () => {
    const casos = ["/pessoal/sources/x.md", "../raw/sources/x.md", "pessoal\\sources\\x.md", "pessoal/sources/x.txt", "raw/sources/x.md"];
    for (const caminho of casos) {
      const r = valido();
      r.paginas[0].caminho = caminho;
      expect(validarRelatorioLeitor(r).erros).toEqual([
        `$.paginas[0].caminho: caminho relativo à wiki, terminado em .md, fora de raw/ e sem .. (veio ${caminho})`,
      ]);
    }
  });

  test("Dado página em diretório reservado ou no índice Quando valido Então reprova: índice e log não são páginas", () => {
    for (const caminho of ["index.md", "log.md", "log/sources/x.md", "_meta/sources/x.md", "pessoal/_meta/sources/x.md"]) {
      const r = valido();
      r.paginas[0].caminho = caminho;
      expect(validarRelatorioLeitor(r).erros[0]).toContain("$.paginas[0].caminho:");
    }
  });

  test("Dado tipo que não casa com o diretório Quando valido Então reprova", () => {
    const r = valido();
    r.paginas[1].caminho = "pessoal/entities/wiki-viva.md";
    expect(validarRelatorioLeitor(r).erros).toEqual(["$.paginas[1].caminho: página do tipo concept mora em concepts/ (veio pessoal/entities/wiki-viva.md)"]);
  });

  test("Dado layout plano Quando valido Então aceita o caminho sem área", () => {
    const r = valido();
    r.paginas[0].caminho = "sources/llm-wiki.md";
    r.paginas[1].caminho = "concepts/wiki-viva.md";
    expect(validarRelatorioLeitor(r).erros).toEqual([]);
  });

  test("Dado a mesma página duas vezes Quando valido Então reprova a repetição", () => {
    const r = valido();
    r.paginas.push({ ...r.paginas[1] });
    expect(validarRelatorioLeitor(r).erros).toEqual(["$.paginas[2].caminho: página repetida (pessoal/concepts/wiki-viva.md)"]);
  });

  test("Dado nenhuma ou duas páginas de fonte Quando valido Então reprova: é exatamente uma", () => {
    const r = valido();
    r.paginas[0].tipo = "entity";
    r.paginas[0].caminho = "pessoal/entities/llm-wiki.md";
    expect(validarRelatorioLeitor(r).erros).toEqual(["$.paginas: exatamente uma página do tipo source (veio 0)"]);
    r.paginas.push({ caminho: "pessoal/sources/a.md", tipo: "source", acao: "criar", motivo: "x" });
    r.paginas.push({ caminho: "pessoal/sources/b.md", tipo: "source", acao: "criar", motivo: "x" });
    expect(validarRelatorioLeitor(r).erros).toEqual(["$.paginas: exatamente uma página do tipo source (veio 2)"]);
  });

  test("Dado erro de esquema Quando valido Então não roda as regras extras sobre dado quebrado", () => {
    const r = valido();
    r.paginas = "nenhuma";
    expect(validarRelatorioLeitor(r).erros).toEqual(["$.paginas: esperado lista"]);
  });
});

describe("relatório do leitor: conferência com a fonte e com a wiki", () => {
  test("Dado trechos que aparecem na fonte, com espaços e quebras diferentes Quando confiro Então aprova", () => {
    expect(conferirCitacoes(valido(), fonte)).toEqual([]);
  });

  test("Dado trecho que não existe na fonte Quando confiro Então reprova o takeaway", () => {
    const r = valido();
    r.takeaways[2].citacao.trecho = "a pessoa escreve";
    expect(conferirCitacoes(r, fonte)).toEqual(['$.takeaways[2].citacao.trecho: não aparece na fonte ("a pessoa escreve")']);
  });

  test("Dado trecho só com espaços Quando confiro Então reprova: texto vazio não sustenta takeaway", () => {
    const r = valido();
    r.takeaways[0].citacao.trecho = "  \n ";
    expect(conferirCitacoes(r, fonte)).toEqual(['$.takeaways[0].citacao.trecho: não aparece na fonte ("  \\n ")']);
  });

  test("Dado fonte com CRLF e caixa diferente Quando confiro Então compara sem caixa e sem fim de linha", () => {
    expect(conferirCitacoes(valido(), fonte.replaceAll("\n", "\r\n").toUpperCase())).toEqual([]);
  });

  test("Dado página a criar que já existe ou a atualizar que não existe Quando confiro Então reprova a ação", () => {
    const r = valido();
    const existe = (caminho: string) => caminho === "pessoal/sources/llm-wiki.md";
    expect(conferirPaginas(r, existe)).toEqual([
      "$.paginas[0].acao: pessoal/sources/llm-wiki.md já existe; use atualizar",
      "$.paginas[1].acao: pessoal/concepts/wiki-viva.md não existe; use criar",
    ]);
    expect(conferirPaginas(r, caminho => caminho === "pessoal/concepts/wiki-viva.md")).toEqual([]);
  });

  test("Dado um relatório válido Quando confiro tudo Então junta esquema, citações e páginas", () => {
    const existe = (caminho: string) => caminho === "pessoal/concepts/wiki-viva.md";
    expect(conferirLeitura(valido(), { textoFonte: fonte, existe })).toEqual({ ok: true, erros: [] });
    const r = valido();
    r.takeaways[0].citacao.trecho = "inventado";
    expect(conferirLeitura(r, { textoFonte: fonte, existe })).toEqual({ ok: false, erros: ['$.takeaways[0].citacao.trecho: não aparece na fonte ("inventado")'] });
  });

  test("Dado fonte sem texto conferível Quando confiro tudo Então pula as citações e confere o resto", () => {
    const existe = (caminho: string) => caminho === "pessoal/concepts/wiki-viva.md";
    const r = valido();
    r.takeaways[0].citacao.trecho = "trecho que só existe no PDF";
    expect(conferirLeitura(r, { textoFonte: undefined, existe })).toEqual({ ok: true, erros: [] });
    expect(conferirLeitura(r, { textoFonte: undefined, existe: () => false }).erros).toEqual(["$.paginas[1].acao: pessoal/concepts/wiki-viva.md não existe; use criar"]);
  });

  test("Dado relatório fora do esquema Quando confiro tudo Então para no esquema", () => {
    expect(conferirLeitura({}, { textoFonte: fonte, existe: () => false }).erros[0]).toBe("$: falta o campo versao");
  });
});

describe("relatório do leitor: extrair o JSON da resposta", () => {
  test("Dado JSON puro Quando extraio Então devolve o objeto", () => {
    expect(extrairJson('{"a":1}')).toEqual({ a: 1 });
  });

  test("Dado resposta com texto e bloco json cercado Quando extraio Então usa o último bloco json", () => {
    expect(extrairJson('Segue.\n```json\n{"a":1}\n```\nDepois:\n```json\n{"a":2}\n```\n')).toEqual({ a: 2 });
  });

  test("Dado resposta sem JSON válido Quando extraio Então explica o erro", () => {
    expect(() => extrairJson("nada aqui")).toThrow("a resposta do leitor não é JSON");
    expect(() => extrairJson("```json\n{quebrado\n```")).toThrow("a resposta do leitor não é JSON");
  });
});
