import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { executar } from "../src/cli";
import { comandoValidar, validarWiki } from "../src/comandos/validar";
import { esqueletoEm } from "./apoio/esqueleto";

let raiz: string;
let wiki: string;

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "anvilore-validar-"));
  wiki = join(raiz, "wiki");
  mkdirSync(wiki);
});
afterEach(() => {
  rmSync(raiz, { recursive: true, force: true });
});

function gravar(relativo: string, conteudo: string, base: string = wiki): void {
  const caminho = join(base, relativo);
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, conteudo);
}

// Página de conteúdo válida; `extra` entra no frontmatter e `corpo` depois dele.
function pagina(slug: string, opcoes: { tipo?: string; extra?: string; corpo?: string } = {}): string {
  const { tipo = "concept", extra = "", corpo = "Corpo.\n" } = opcoes;
  return `---\ntitle: "T"\nslug: ${slug}\ntype: ${tipo}\n${extra}tags: [teste]\n---\n\n${corpo}`;
}

function indice(...slugs: string[]): string {
  return `# Índice\n\n${slugs.map((slug) => `- [[${slug}]]`).join("\n")}\n`;
}

async function capturar(corpo: () => Promise<number>) {
  const saida: string[] = [];
  const erro: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...a) => {
    saida.push(a.join(" "));
  });
  const err = spyOn(console, "error").mockImplementation((...a) => {
    erro.push(a.join(" "));
  });
  try {
    const codigo = await corpo();
    return { codigo, saida: saida.join("\n"), erro: erro.join("\n") };
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
}

const rodar = (dir: string = wiki) => capturar(() => comandoValidar([dir]));

// O disco distingue Pagina.md de pagina.md? Linux sim; macOS e Windows, em geral, não.
function discoDistingueCaixa(): boolean {
  const sonda = mkdtempSync(join(tmpdir(), "anvilore-caixa-"));
  try {
    writeFileSync(join(sonda, "A.md"), "");
    writeFileSync(join(sonda, "a.md"), "");
    return readdirSync(sonda).length === 2;
  } finally {
    rmSync(sonda, { recursive: true, force: true });
  }
}

describe("validar: invariantes da wiki", () => {
  test("Dado uma página válida com dívida registrada, Quando valido, Então passa com código 0 e conta o gap", async () => {
    gravar("valida.md", pagina("valida", { corpo: "> [!gap]\n> Falta a definição de X.\n" }));
    gravar("index.md", indice("valida"));
    const r = await rodar();
    expect(r.saida).toContain("VALIDACAO: PASS");
    expect(r.codigo).toBe(0);
    expect(r.saida).toContain("Divida: 1 gaps, 0 contradicoes");
  });

  test("Dado callouts de gap e de contradição, Quando valido, Então conta cada linha e devolve o resultado", async () => {
    gravar("a.md", pagina("a", { corpo: "> [!gap]\n> x\n\n> [!gap]\n> y\n\n> [!contradiction]\n> z\n" }));
    gravar("index.md", indice("a"));
    const r = await validarWiki(wiki, {});
    expect(r).toMatchObject({ ok: true, erros: [], gaps: 2, contradicoes: 1, vencidas: 0, geradasAposVerificacao: 0 });
  });

  test("Dado index.md e log.md sem frontmatter, Quando valido, Então são ignorados", async () => {
    gravar("valida.md", pagina("valida"));
    gravar("index.md", indice("valida"));
    gravar("log.md", "# Log\n");
    const r = await rodar();
    expect(r.saida).toContain("VALIDACAO: PASS");
  });

  test("Dado uma página sem frontmatter, Quando valido, Então reprova com código 1 nomeando o arquivo", async () => {
    gravar("quebrada.md", "Sem nada.\n");
    const r = await rodar();
    expect(r.saida).toContain("VALIDACAO: FAIL");
    expect(r.codigo).toBe(1);
    expect(r.saida).toContain("sem frontmatter: quebrada.md");
  });

  test("Dado type fora do schema, Quando valido, Então reprova com 'type invalido'", async () => {
    gravar("tipo-errado.md", pagina("tipo-errado", { tipo: "memory" }));
    const r = await rodar();
    expect(r.saida).toContain("type invalido ('memory'): tipo-errado.md");
    expect(r.codigo).toBe(1);
  });

  test("Dado os três tipos do schema, Quando valido, Então todos passam", async () => {
    gravar("fonte.md", pagina("fonte", { tipo: "source" }));
    gravar("conceito.md", pagina("conceito", { tipo: "concept" }));
    gravar("entidade.md", pagina("entidade", { tipo: "entity" }));
    gravar("index.md", indice("fonte", "conceito", "entidade"));
    expect((await rodar()).codigo).toBe(0);
  });

  test("Dado slug diferente do nome do arquivo, Quando valido, Então reprova com 'nao bate com o nome do arquivo'", async () => {
    gravar("slug-errado.md", pagina("outro-nome-qualquer"));
    const r = await rodar();
    expect(r.saida).toContain("slug 'outro-nome-qualquer' nao bate com o nome do arquivo: slug-errado.md");
  });

  test("Dado slug entre aspas no frontmatter, Quando valido, Então o YAML o lê sem as aspas", async () => {
    gravar("citado.md", `---\ntitle: "T"\nslug: "citado"\ntype: concept\ntags: []\n---\n\nCorpo.\n`);
    gravar("index.md", indice("citado"));
    expect((await rodar()).codigo).toBe(0);
  });

  test("Dado frontmatter vazio, Quando valido, Então reprova o type e o slug", async () => {
    gravar("vazia.md", "---\n---\n\nCorpo.\n");
    const r = await rodar();
    expect(r.saida).toContain("type invalido ('')");
    expect(r.saida).toContain("slug '' nao bate com o nome do arquivo");
  });

  test("Dado um diretório inexistente, Quando valido, Então imprime VALIDACAO: FAIL e devolve 1 (nunca PASS)", async () => {
    const r = await rodar(join(raiz, "nao-existe"));
    expect(r.saida).toContain("VALIDACAO: FAIL");
    expect(r.saida).not.toContain("PASS");
    expect(r.saida).toContain("diretorio nao encontrado");
    expect(r.codigo).toBe(1);
  });

  test("Dado um caminho que é um arquivo, Quando valido, Então reprova como diretório inexistente", async () => {
    gravar("arquivo.md", pagina("arquivo"));
    const r = await rodar(join(wiki, "arquivo.md"));
    expect(r.saida).toContain("VALIDACAO: FAIL");
    expect(r.codigo).toBe(1);
  });

  test("Dado um diretório sem página nenhuma, Quando valido, Então reprova com código 1", async () => {
    const r = await rodar();
    expect(r.saida).toContain("nenhuma pagina .md encontrada");
    expect(r.saida).toContain("VALIDACAO: FAIL");
    expect(r.codigo).toBe(1);
  });

  test("Dado uma wiki recém-criada só com index.md e log.md, Quando valido, Então passa", async () => {
    gravar("index.md", "# Indice\n");
    gravar("log.md", "# Log\n");
    const r = await rodar();
    expect(r.saida).toContain("VALIDACAO: PASS");
    expect(r.codigo).toBe(0);
  });

  test("Dado duas execuções sobre a mesma wiki, Quando comparo, Então a saída é idêntica", async () => {
    gravar("exemplo/concepts/certa.md", pagina("certa", { extra: "area: exemplo\n" }));
    gravar("exemplo/concepts/quebrada.md", "sem frontmatter\n");
    gravar("a.md", "sem frontmatter\n");
    const primeira = await rodar();
    const segunda = await rodar();
    expect(segunda).toEqual(primeira);
  });

  test("Dado várias páginas com problema, Quando valido, Então os erros saem em ordem alfabética do caminho", async () => {
    gravar("b.md", "sem\n");
    gravar("a/z.md", "sem\n");
    gravar("a.md", "sem\n");
    const { erros } = await validarWiki(wiki, {});
    expect(erros.map((e) => e.split(": ")[1])).toEqual(["a.md", "a/z.md", "b.md"]);
  });

  test("Dado uma página com fim de linha CRLF, Quando valido, Então é lida como a de LF", async () => {
    gravar("crlf.md", pagina("crlf", { corpo: "> [!gap]\n> x\n" }).replaceAll("\n", "\r\n"));
    gravar("index.md", indice("crlf"));
    const r = await validarWiki(wiki, {});
    expect(r).toMatchObject({ ok: true, gaps: 1 });
  });

  test("Dado uma página com BOM, Quando valido, Então o frontmatter é lido", async () => {
    gravar("bom.md", `﻿${pagina("bom")}`);
    gravar("index.md", indice("bom"));
    expect((await validarWiki(wiki, {})).ok).toBe(true);
  });

  test("Dado um frontmatter sem o --- de fechamento, Quando valido, Então reprova nomeando o arquivo", async () => {
    gravar("aberto.md", "---\ntitle: T\nslug: aberto\ntype: concept\n\nCorpo.\n");
    const r = await rodar();
    expect(r.saida).toContain("frontmatter YAML invalido, nao foi possivel ler: aberto.md");
    expect(r.codigo).toBe(1);
  });

  test("Dado um frontmatter que não é um mapa, Quando valido, Então reprova nomeando o arquivo", async () => {
    gravar("lista.md", "---\n- a\n- b\n---\n\nCorpo.\n");
    expect((await rodar()).saida).toContain("frontmatter YAML invalido, nao foi possivel ler: lista.md");
  });

  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "Dado uma página que não dá para ler, Quando valido, Então reprova nomeando o arquivo em vez de quebrar",
    async () => {
      gravar("a.md", pagina("a"));
      gravar("fechada.md", pagina("fechada"));
      chmodSync(join(wiki, "fechada.md"), 0o000);
      try {
        const r = await rodar();
        expect(r.codigo).toBe(1);
        expect(r.saida).toContain("nao foi possivel ler: fechada.md");
      } finally {
        chmodSync(join(wiki, "fechada.md"), 0o644);
      }
    },
  );

  test("Dado um arquivo que não é .md, Quando valido, Então não é página", async () => {
    gravar("notas.txt", "sem frontmatter\n");
    gravar("index.md", "# Indice\n");
    expect((await rodar()).codigo).toBe(0);
  });
});

describe("validar: áreas e diretórios reservados", () => {
  test("Dado a área do frontmatter igual ao diretório, Quando valido, Então passa", async () => {
    gravar("index.md", indice("certa"));
    gravar("exemplo/concepts/certa.md", pagina("certa", { extra: "area: exemplo\n" }));
    const r = await rodar();
    expect(r.saida).toContain("VALIDACAO: PASS");
    expect(r.codigo).toBe(0);
  });

  test("Dado área do frontmatter diferente do diretório, Quando valido, Então reprova nomeando o arquivo e as duas áreas", async () => {
    gravar("index.md", indice("divergente"));
    gravar("exemplo/concepts/divergente.md", pagina("divergente", { extra: "area: outra\n" }));
    const r = await rodar();
    expect(r.codigo).toBe(1);
    const linha = r.saida.split("\n").find((l) => l.includes("divergente.md"))!;
    expect(linha).toContain("exemplo");
    expect(linha).toContain("outra");
    expect(linha).toContain("diverge");
  });

  test("Dado campo area numa página solta na raiz, Quando valido, Então a wiki plana continua válida", async () => {
    gravar("index.md", indice("solta-com-area"));
    gravar("solta-com-area.md", pagina("solta-com-area", { extra: "area: exemplo\n" }));
    expect((await rodar()).saida).toContain("VALIDACAO: PASS");
  });

  test("Dado markdown comum em _meta/ e log/, Quando valido, Então os reservados passam sem frontmatter", async () => {
    gravar("index.md", "# Indice\n");
    gravar("_meta/lacunas.md", "# Lacunas\n\nqualquer conteudo comum\n");
    gravar("log/2026-09-05.md", "# 2026-09-05\n\nlog do dia\n");
    const r = await rodar();
    expect(r.saida).toContain("VALIDACAO: PASS");
    expect(r.codigo).toBe(0);
  });

  test("Dado frontmatter com type index em _meta/ e log/, Quando valido, Então a isenção não depende de frontmatter", async () => {
    gravar("index.md", "# Indice\n");
    gravar("_meta/lacunas.md", '---\ntitle: "Indice de lacunas"\ntype: index\n---\n');
    gravar("log/2026-09-05.md", '---\ntitle: "Log"\ntype: index\n---\n');
    expect((await rodar()).codigo).toBe(0);
  });

  test("Dado callout dentro de um diretório reservado, Quando valido, Então não entra na dívida", async () => {
    gravar("index.md", "# Indice\n");
    gravar("_meta/lacunas.md", "> [!gap]\n> x\n");
    expect((await validarWiki(wiki, {})).gaps).toBe(0);
  });

  for (const comArea of [false, true]) {
    test(`Dado o layout das skills (sources/concepts/entities no topo) ${comArea ? "com" : "sem"} area preenchido, Quando valido, Então passa`, async () => {
      const extra = comArea ? "area: minha-area\n" : "";
      gravar("index.md", indice("fonte-x", "conceito-y", "entidade-z"));
      gravar("sources/fonte-x.md", pagina("fonte-x", { tipo: "source", extra }));
      gravar("concepts/conceito-y.md", pagina("conceito-y", { tipo: "concept", extra }));
      gravar("entities/entidade-z.md", pagina("entidade-z", { tipo: "entity", extra }));
      const r = await rodar();
      expect(r.saida).toContain("VALIDACAO: PASS");
      expect(r.codigo).toBe(0);
    });
  }

  test("Dado a wiki versionada no próprio repositório, Quando valido, Então passa e informa a dívida", async () => {
    const { wiki: esqueleto } = await esqueletoEm(raiz);
    const r = await capturar(() => comandoValidar([esqueleto]));
    expect(r.saida).toContain("VALIDACAO: PASS");
    expect(r.saida).toContain("Divida:");
    expect(r.codigo).toBe(0);
  });
});

describe("validar: nomes de arquivo entre sistemas", () => {
  test("Dado o slug 'é' decomposto no nome do arquivo e composto no frontmatter, Quando valido, Então aprova", async () => {
    gravar("é.md", pagina("é"));
    gravar("index.md", indice("é"));
    const r = await validarWiki(wiki, {});
    expect(r.erros).toEqual([]);
  });

  test("Dado o slug 'é' composto no nome do arquivo e decomposto no frontmatter, Quando valido, Então aprova", async () => {
    gravar("é.md", pagina("é"));
    gravar("index.md", indice("é"));
    expect((await validarWiki(wiki, {})).erros).toEqual([]);
  });

  test("Dado slug que difere só na caixa do nome do arquivo, Quando valido, Então reprova (a caixa conta no slug)", async () => {
    gravar("Pagina.md", pagina("pagina"));
    expect((await rodar()).saida).toContain("nao bate com o nome do arquivo");
  });

  test.skipIf(!discoDistingueCaixa())(
    "Dados Pagina.md e pagina.md na mesma pasta, Quando valido, Então reprova apontando conflito de caixa",
    async () => {
      gravar("Pagina.md", pagina("Pagina"));
      gravar("pagina.md", pagina("pagina"));
      const r = await rodar();
      expect(r.codigo).toBe(1);
      const linha = r.saida.split("\n").find((l) => l.includes("conflito de caixa"))!;
      expect(linha).toContain("Pagina.md");
      expect(linha).toContain("pagina.md");
    },
  );

  test.skipIf(!discoDistingueCaixa())(
    "Dados nomes iguais em pastas diferentes, Quando valido, Então não há conflito de caixa",
    async () => {
      gravar("a/Pagina.md", pagina("Pagina"));
      gravar("b/pagina.md", pagina("pagina"));
      expect((await rodar()).saida).not.toContain("conflito de caixa");
    },
  );
});

describe("validar: perfil de proveniência (OKF)", () => {
  const okf = `sources:
  - id: fonte-teste
    resource: https://example.com/fonte
    author: human:autor
    last_modified: 2026-09-03T10:00:00-03:00
generated:
  by: process:anvilore-ingest
  at: 2026-09-03T10:30:00-03:00
verified:
  - by: human:revisor
    at: 2026-09-03T11:00:00-03:00
stale_after: 2099-09-03T00:00:00-03:00
`;

  async function comOkf(bloco: string, slug = "okf") {
    gravar(`${slug}.md`, pagina(slug, { tipo: "source", extra: bloco }));
    gravar("index.md", indice(slug));
    return rodar();
  }

  test("Dado o perfil completo bem formado, Quando valido, Então passa com código 0", async () => {
    const r = await comOkf(okf);
    expect(r.saida).toContain("VALIDACAO: PASS");
    expect(r.codigo).toBe(0);
  });

  test("Dado uma página sem nenhum campo de proveniência, Quando valido, Então a ausência não reprova", async () => {
    const r = await comOkf("");
    expect(r.saida).toContain("VALIDACAO: PASS");
    expect(r.codigo).toBe(0);
  });

  for (const [campo, bloco] of [
    ["sources", "sources:\n  - author: human:autor\n"],
    ["generated", "generated:\n  by: nao-e-ator-valido\n"],
    ["verified", "verified:\n  - at: 2026-09-03T11:00:00-03:00\n"],
    ["stale_after", "stale_after: 2027-09-03\n"],
  ] as const) {
    test(`Dado ${campo} malformado, Quando valido, Então reprova com código 1 citando o arquivo e o campo`, async () => {
      const slug = `okf-${campo}`.replace("_", "-");
      const r = await comOkf(bloco, slug);
      expect(r.codigo).toBe(1);
      expect(r.saida).toContain(campo);
      expect(r.saida).toContain(`${slug}.md`);
    });
  }

  test("Dado resource com caminho inexistente, Quando valido, Então reprova nomeando o caminho", async () => {
    const r = await comOkf("sources:\n  - resource: raw/nao/existe.md\n");
    expect(r.codigo).toBe(1);
    expect(r.saida).toContain("raw/nao/existe.md");
  });

  test("Dado resource que é descritor de escopo, Quando valido, Então não é checado", async () => {
    const r = await comOkf("sources:\n  - resource: todas as sessoes de 2026\n");
    expect(r.codigo).toBe(0);
  });

  test("Dado resource com espaço que existe na raiz do repositório, Quando valido, Então passa", async () => {
    gravar("raw/notas do dia.md", "bruto\n", raiz);
    const r = await comOkf("sources:\n  - resource: raw/notas do dia.md\n");
    expect(r.codigo).toBe(0);
  });

  test("Dado resource com espaço que não existe, Quando valido, Então reprova nomeando o caminho", async () => {
    const r = await comOkf("sources:\n  - resource: raw/reuniao sem arquivo.md\n");
    expect(r.codigo).toBe(1);
    expect(r.saida).toContain("raw/reuniao sem arquivo.md");
  });

  test("Dado página vencida, Quando valido, Então passa e a métrica okf_stale a acusa", async () => {
    const r = await comOkf("stale_after: 2000-01-01T00:00:00-03:00\n");
    expect(r.codigo).toBe(0);
    expect(r.saida).toContain("METRIC: okf_stale=1");
    expect(r.saida).toContain("METRIC: okf_modified_after_verified=0");
  });

  test("Dado geração depois da última verificação humana, Quando valido, Então a métrica acusa e o resultado informa", async () => {
    gravar("a.md", pagina("a", { extra: "generated:\n  by: process:x\n  at: 2026-09-05T10:00:00-03:00\nverified:\n  - by: human:ana\n    at: 2026-09-03T10:00:00-03:00\n" }));
    gravar("index.md", indice("a"));
    // a verificação humana é anterior à geração: reprova pelo portão, e a métrica também acusa
    const r = await validarWiki(wiki, {});
    expect(r.geradasAposVerificacao).toBe(1);
    expect(r.ok).toBe(false);
    expect((await rodar()).saida).toContain("METRIC: okf_modified_after_verified=1");
  });

  test("Dado YAML inválido no frontmatter, Quando valido, Então reprova nomeando o arquivo e nunca pula a checagem", async () => {
    const r = await comOkf("sources: [nao-fecha\n", "okf-yaml-quebrado");
    expect(r.codigo).toBe(1);
    expect(r.saida).toContain("okf-yaml-quebrado.md");
    expect(r.saida).toContain("frontmatter YAML invalido");
  });

  test("Dado uma página gerada sem aprovação humana, Quando valido, Então reprova e o fluxo só fecha com a verificação", async () => {
    const gerada = "generated:\n  by: claude-opus/2026-10\n  at: 2026-10-24T10:00:00-03:00\n";
    const rascunho = await comOkf(gerada, "rascunho");
    expect(rascunho.codigo).toBe(1);
    expect(rascunho.saida).toContain("página gerada sem aprovação humana: rascunho.md");

    const aprovada = await comOkf(`${gerada}verified:\n  - by: human:ana\n    at: 2026-10-24T11:00:00-03:00\n`, "rascunho");
    expect(aprovada.codigo).toBe(0);
  });

  test("Dado página gerada com fração Quando a aprovação é anterior no mesmo segundo Então o comando reprova até haver igualdade", async () => {
    const gerada = "generated:\n  by: process:ingest\n  at: 2026-10-24T10:00:00.1004Z\n";
    const antes = await comOkf(`${gerada}verified:\n  - by: human:ana\n    at: 2026-10-24T10:00:00.1001Z\n`);
    expect(antes.codigo).toBe(1);
    expect(antes.saida).toContain("página gerada sem aprovação humana: okf.md");
    const igual = await comOkf(`${gerada}verified:\n  - by: human:ana\n    at: 2026-10-24T10:00:00.1004Z\n`);
    expect(igual.codigo).toBe(0);
  });
});

describe("validar: proveniência também nos arquivos fora das páginas de conteúdo", () => {
  test("Dado YAML inválido num index.md, Quando valido, Então reprova nomeando o arquivo", async () => {
    gravar("a.md", pagina("a"));
    gravar("index.md", "---\nsources: [nao-fecha\n---\n\n- [[a]]\n");
    const r = await rodar();
    expect(r.codigo).toBe(1);
    expect(r.saida).toContain("frontmatter YAML invalido, nao foi possivel ler: index.md");
  });

  test("Dado YAML inválido num log.md, Quando valido, Então reprova nomeando o arquivo", async () => {
    gravar("log.md", "---\nx: [y\n---\n");
    expect((await rodar()).saida).toContain("nao foi possivel ler: log.md");
  });

  test("Dado resource inexistente em _meta/, Quando valido, Então reprova nomeando o arquivo e o caminho", async () => {
    gravar("index.md", "# Indice\n");
    gravar("_meta/x.md", "---\nsources:\n  - resource: raw/nao/existe.md\n---\n");
    const r = await rodar();
    expect(r.codigo).toBe(1);
    expect(r.saida).toContain("sources[].resource inexistente: _meta/x.md");
  });

  test("Dado YAML inválido em log/, Quando valido, Então reprova", async () => {
    gravar("index.md", "# Indice\n");
    gravar("log/2026-09-05.md", "---\nx: [y\n---\n");
    expect((await rodar()).saida).toContain("log/2026-09-05.md");
  });

  test("Dado stale_after vencido num reservado, Quando valido, Então conta na métrica sem reprovar", async () => {
    gravar("index.md", "# Indice\n");
    gravar("_meta/x.md", "---\nstale_after: 2000-01-01T00:00:00-03:00\n---\n");
    const r = await validarWiki(wiki, {});
    expect(r).toMatchObject({ ok: true, vencidas: 1 });
  });

  test("Dado frontmatter sem fechamento ou que não é mapa num reservado ou index, Quando valido, Então segue pulando como o original (é só markdown comum)", async () => {
    gravar("index.md", "---\n\n# Indice com régua\n");
    gravar("log.md", "---\n- a\n---\n");
    gravar("_meta/x.md", "---\ntexto solto\n---\n");
    expect((await validarWiki(wiki, {})).erros).toEqual([]);
  });

  test("Dado generated sem aprovação humana num index.md ou reservado, Quando valido, Então o portão não se aplica (não são páginas)", async () => {
    gravar("index.md", "---\ngenerated:\n  by: process:x\n  at: 2026-10-24T10:00:00-03:00\n---\n");
    gravar("_meta/x.md", "---\ngenerated:\n  by: process:x\n---\n");
    expect((await validarWiki(wiki, {})).erros).toEqual([]);
  });

  test("Dado index.md e reservados sem frontmatter, Quando valido, Então continuam isentos de type, slug e índice", async () => {
    gravar("index.md", "# Indice\n");
    gravar("log.md", "# Log\n");
    gravar("_meta/x.md", "# x\n");
    gravar("exemplo/index.md", "# Indice da área\n");
    gravar("exemplo/concepts/a.md", pagina("a", { extra: "area: exemplo\n" }));
    gravar("exemplo/index.md", indice("a"));
    expect((await validarWiki(wiki, {})).erros).toEqual([]);
  });
});

describe("validar: diretório ilegível", () => {
  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "Dada uma subpasta sem permissão de leitura, Quando valido, Então reprova nomeando a pasta, com VALIDACAO: FAIL e código 1",
    async () => {
      gravar("a.md", pagina("a"));
      gravar("index.md", indice("a"));
      gravar("fechada/x.md", pagina("x"));
      chmodSync(join(wiki, "fechada"), 0o000);
      try {
        const r = await rodar();
        expect(r.codigo).toBe(1);
        expect(r.saida).toContain("nao foi possivel ler o diretorio: fechada");
        expect(r.saida).toContain("VALIDACAO: FAIL");
      } finally {
        chmodSync(join(wiki, "fechada"), 0o755);
      }
    },
  );

  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "Dada a própria pasta da wiki sem permissão de leitura, Quando valido, Então reprova com VALIDACAO: FAIL",
    async () => {
      gravar("a.md", pagina("a"));
      chmodSync(wiki, 0o000);
      try {
        const r = await rodar();
        expect(r.codigo).toBe(1);
        expect(r.saida).toContain("VALIDACAO: FAIL");
        expect(r.saida).toContain("nao foi possivel ler o diretorio");
      } finally {
        chmodSync(wiki, 0o755);
      }
    },
  );
});

describe("validar: wikilinks e índice (R29)", () => {
  test("Dado um wikilink que não resolve, Quando valido, Então reprova nomeando a página e o alvo", async () => {
    gravar("a.md", pagina("a", { corpo: "Veja [[fantasma]].\n" }));
    gravar("index.md", indice("a"));
    const r = await rodar();
    expect(r.codigo).toBe(1);
    expect(r.saida).toContain("wikilink quebrado [[fantasma]]");
    expect(r.saida).toContain("a.md");
  });

  test("Dado wikilink com rótulo ou seção, Quando valido, Então resolve pelo alvo", async () => {
    gravar("a.md", pagina("a", { corpo: "[[b|o outro]] e [[b#seção]] e [[b#^bloco|x]] e [[#aqui]] e [[a]].\n" }));
    gravar("b.md", pagina("b"));
    gravar("index.md", indice("a", "b"));
    expect((await validarWiki(wiki, {})).erros).toEqual([]);
  });

  test("Dado rótulo ou seção com alvo inexistente, Quando valido, Então reprova pelo alvo", async () => {
    gravar("a.md", pagina("a", { corpo: "[[ghost|rótulo]] e [[outro#sec]]\n" }));
    gravar("index.md", indice("a"));
    const { erros } = await validarWiki(wiki, {});
    expect(erros.some((e) => e.includes("[[ghost]]"))).toBe(true);
    expect(erros.some((e) => e.includes("[[outro]]"))).toBe(true);
  });

  test("Dado o mesmo link quebrado repetido na página, Quando valido, Então reporta uma vez", async () => {
    gravar("a.md", pagina("a", { corpo: "[[x]] [[x]] [[x|y]]\n" }));
    gravar("index.md", indice("a"));
    const { erros } = await validarWiki(wiki, {});
    expect(erros.filter((e) => e.includes("[[x]]"))).toHaveLength(1);
  });

  test("Dado wikilink em bloco de código, em código em linha ou em comentário HTML, Quando valido, Então não é link", async () => {
    gravar(
      "a.md",
      pagina("a", { corpo: "```\n[[no-bloco]]\n```\n\nUse `[[em-linha]]` assim.\n\n<!-- [[no-comentario]] -->\n" }),
    );
    gravar("index.md", indice("a"));
    expect((await validarWiki(wiki, {})).erros).toEqual([]);
  });

  test("Dado wikilink em código que atravessa linhas Quando valido Então ignora o código e continua conferindo texto visível", async () => {
    gravar("index.md", indice("a"));
    for (const corpo of ["Use `começo [[inexistente]]\nfim`.\n", "Use ``começo [[inexistente]]\nfim``.\n", "Use `[[inexistente]]` assim.\n"]) {
      gravar("a.md", pagina("a", { corpo }));
      const r = await rodar();
      expect(r.codigo).toBe(0);
      expect(r.saida).not.toContain("wikilink quebrado");
    }
    for (const corpo of ["Veja [[inexistente]].\n", "Uma `crase sem fecho\nVeja [[inexistente]].\n"]) {
      gravar("a.md", pagina("a", { corpo }));
      const r = await rodar();
      expect(r.codigo).toBe(1);
      expect(r.saida).toContain("wikilink quebrado [[inexistente]]");
    }
  });

  test("Dado índice com wikilink só em código que atravessa linhas Quando valido Então a página continua fora do índice", async () => {
    gravar("a.md", pagina("a"));
    for (const corpo of ["Use `começo [[a]]\nfim`.\n", "Use `[[a]]` assim.\n"]) {
      gravar("index.md", `# Índice\n\n${corpo}`);
      const r = await rodar();
      expect(r.codigo).toBe(1);
      expect(r.saida).toContain("página fora do índice: a.md");
    }
    gravar("index.md", "# Índice\n\nUse `começo [[a]]\nfim`.\n\n- [[a]]\n");
    expect((await rodar()).codigo).toBe(0);
  });

  test("Dado wikilink que difere só na caixa ou na normalização do slug, Quando valido, Então resolve", async () => {
    gravar("a.md", pagina("a", { corpo: "[[B]] e [[é]]\n" }));
    gravar("b.md", pagina("b"));
    gravar("é.md", pagina("é"));
    gravar("index.md", indice("a", "b", "é"));
    expect((await validarWiki(wiki, {})).erros).toEqual([]);
  });

  test("Dado wikilink para uma página em outra área, Quando valido, Então resolve pelo slug", async () => {
    gravar("x/concepts/a.md", pagina("a", { extra: "area: x\n", corpo: "[[b]]\n" }));
    gravar("y/concepts/b.md", pagina("b", { extra: "area: y\n" }));
    expect((await validarWiki(wiki, {})).erros).toEqual([]);
  });

  test("Dado wikilink com caminho para página que existe, Quando valido, Então reprova como quebrado (o link é só o slug)", async () => {
    gravar("sources/x.md", pagina("x", { tipo: "source" }));
    gravar("a.md", pagina("a", { corpo: "Veja [[sources/x]].\n" }));
    gravar("index.md", indice("a", "x"));
    const { erros } = await validarWiki(wiki, {});
    expect(erros).toEqual(["wikilink quebrado [[sources/x]] em a.md: nenhuma pagina com esse slug"]);
  });

  test("Dado wikilink para index ou log, Quando valido, Então não resolve: não são páginas", async () => {
    gravar("a.md", pagina("a", { corpo: "[[index]] [[log]]\n" }));
    gravar("index.md", indice("a"));
    const { erros } = await validarWiki(wiki, {});
    expect(erros).toHaveLength(2);
  });

  test("Dado link quebrado no index.md, Quando valido, Então reprova nomeando o índice", async () => {
    gravar("a.md", pagina("a"));
    gravar("index.md", indice("a", "fantasma"));
    const { erros } = await validarWiki(wiki, {});
    expect(erros).toHaveLength(1);
    expect(erros[0]).toContain("[[fantasma]]");
    expect(erros[0]).toContain("index.md");
  });

  test("Dado wikilink apenas dentro de um diretório reservado, Quando valido, Então não é varrido", async () => {
    gravar("a.md", pagina("a"));
    gravar("index.md", indice("a"));
    gravar("_meta/x.md", "[[fantasma]]\n");
    gravar("log.md", "[[outro-fantasma]]\n");
    expect((await validarWiki(wiki, {})).erros).toEqual([]);
  });

  test("Dado uma página plana que não aparece no index.md, Quando valido, Então reprova nomeando o arquivo", async () => {
    gravar("a.md", pagina("a"));
    gravar("b.md", pagina("b"));
    gravar("index.md", indice("a"));
    const r = await rodar();
    expect(r.codigo).toBe(1);
    expect(r.saida).toContain("página fora do índice: b.md");
    expect(r.saida).not.toContain("fora do índice: a.md");
  });

  test("Dado uma página sob sources/, Quando falta no index.md, Então reprova do mesmo jeito", async () => {
    gravar("sources/s.md", pagina("s", { tipo: "source" }));
    gravar("index.md", "# Indice\n");
    expect((await rodar()).saida).toContain("página fora do índice: sources/s.md");
  });

  test("Dada uma wiki sem index.md, Quando valido, Então avisa que a conferência do índice não foi feita e não reprova", async () => {
    gravar("a.md", pagina("a"));
    const r = await rodar();
    expect(r.codigo).toBe(0);
    expect(r.saida).toContain("AVISO: sem index.md: conferência do índice não feita");
    expect(r.saida).toContain("VALIDACAO: PASS");
    expect((await validarWiki(wiki, {})).avisos).toEqual(["sem index.md: conferência do índice não feita"]);
  });

  test("Dada uma wiki com index.md, Quando valido, Então não há aviso", async () => {
    gravar("a.md", pagina("a"));
    gravar("index.md", indice("a"));
    expect((await validarWiki(wiki, {})).avisos).toEqual([]);
  });

  test("Dada uma wiki só com o index.md de uma área, Quando a página de outra área não tem índice, Então avisa", async () => {
    gravar("x/concepts/a.md", pagina("a", { extra: "area: x\n" }));
    gravar("x/index.md", indice("a"));
    gravar("y/concepts/b.md", pagina("b", { extra: "area: y\n" }));
    const r = await validarWiki(wiki, {});
    expect(r.ok).toBe(true);
    expect(r.avisos).toHaveLength(1);
  });

  test("Dado uma área com index.md que não lista a página, Quando valido, Então reprova", async () => {
    gravar("exemplo/concepts/a.md", pagina("a", { extra: "area: exemplo\n" }));
    gravar("exemplo/index.md", "# Indice da área\n");
    gravar("index.md", indice("a"));
    expect((await rodar()).saida).toContain("página fora do índice: exemplo/concepts/a.md");
  });

  test("Dado uma área com index.md que lista a página, Quando valido, Então passa mesmo sem o índice da raiz listá-la", async () => {
    gravar("exemplo/concepts/a.md", pagina("a", { extra: "area: exemplo\n" }));
    gravar("exemplo/index.md", indice("a"));
    gravar("index.md", "# Indice\n");
    expect((await rodar()).codigo).toBe(0);
  });

  test("Dada página de área sem index próprio e ausente do wiki/index.md, Quando valido, Então reprova", async () => {
    gravar("exemplo/concepts/a.md", pagina("a", { extra: "area: exemplo\n" }));
    gravar("index.md", "# Indice\n");
    expect((await rodar()).saida).toContain("página fora do índice: exemplo/concepts/a.md");
  });

  test("Dada página de área sem index próprio e listada no wiki/index.md, Quando valido, Então passa", async () => {
    gravar("exemplo/concepts/a.md", pagina("a", { extra: "area: exemplo\n" }));
    gravar("index.md", indice("a"));
    expect((await rodar()).codigo).toBe(0);
  });

  test("Dado um index.md em subpasta de tipo, Quando valido, Então não é página nem exige frontmatter", async () => {
    gravar("exemplo/concepts/index.md", "# sem frontmatter\n");
    gravar("exemplo/concepts/a.md", pagina("a", { extra: "area: exemplo\n" }));
    expect((await rodar()).codigo).toBe(0);
  });
});

describe("validar: perfil da empresa (anvilore.toml)", () => {
  function toml(conteudo: string): void {
    writeFileSync(join(raiz, "anvilore.toml"), conteudo);
  }

  test("Dado um anvilore.toml que permite só produto e plataforma e uma página com area: pessoal, Quando valido, Então reprova nomeando o arquivo e a área", async () => {
    toml('areas = ["produto", "plataforma"]\n');
    gravar("pessoal/concepts/diario.md", pagina("diario", { extra: "area: pessoal\n" }));
    gravar("produto/concepts/roadmap.md", pagina("roadmap", { extra: "area: produto\n" }));
    const r = await rodar();
    expect(r.codigo).toBe(1);
    expect(r.saida).toContain("area 'pessoal' nao permitida pelo anvilore.toml: pessoal/concepts/diario.md");
    expect(r.saida).not.toContain("roadmap.md");
  });

  test("Dado área fora do perfil só pelo diretório, sem campo area, Quando valido, Então reprova do mesmo jeito", async () => {
    toml('areas = ["produto"]\n');
    gravar("pessoal/concepts/diario.md", pagina("diario"));
    const r = await rodar();
    expect(r.saida).toContain("area 'pessoal' nao permitida pelo anvilore.toml: pessoal/concepts/diario.md");
  });

  test("Dado área do campo diferente da do diretório e ambas fora do perfil, Quando valido, Então cita as duas", async () => {
    toml('areas = ["produto"]\n');
    gravar("pessoal/concepts/diario.md", pagina("diario", { extra: "area: saude\n" }));
    const { erros } = await validarWiki(wiki);
    expect(erros.some((e) => e.includes("area 'pessoal' nao permitida"))).toBe(true);
    expect(erros.some((e) => e.includes("area 'saude' nao permitida"))).toBe(true);
  });

  test("Dado área permitida e página plana sem área, Quando valido, Então passa", async () => {
    toml('areas = ["produto"]\n');
    gravar("produto/concepts/roadmap.md", pagina("roadmap", { extra: "area: produto\n" }));
    gravar("plana.md", pagina("plana"));
    expect((await validarWiki(wiki)).erros).toEqual([]);
  });

  test("Dado um perfil passado por parâmetro, Quando valido, Então ele vale no lugar do arquivo", async () => {
    toml('areas = ["produto"]\n');
    gravar("pessoal/concepts/diario.md", pagina("diario", { extra: "area: pessoal\n" }));
    expect((await validarWiki(wiki, {})).ok).toBe(true);
    expect((await validarWiki(wiki, { areas: ["pessoal"] })).ok).toBe(true);
    expect((await validarWiki(wiki, { areas: ["produto"] })).ok).toBe(false);
  });

  test("Dado o perfil com tipos permitidos, Quando uma página usa outro tipo do schema, Então reprova nomeando o tipo", async () => {
    toml('tipos = ["concept"]\n');
    gravar("fonte.md", pagina("fonte", { tipo: "source" }));
    gravar("conceito.md", pagina("conceito"));
    const r = await rodar();
    expect(r.codigo).toBe(1);
    expect(r.saida).toContain("type 'source' nao permitido pelo anvilore.toml: fonte.md");
    expect(r.saida).not.toContain("conceito.md");
  });

  test("Dado tipo fora do schema e fora do perfil, Quando valido, Então reporta só o tipo inválido", async () => {
    toml('tipos = ["concept"]\n');
    gravar("x.md", pagina("x", { tipo: "memory" }));
    const { erros } = await validarWiki(wiki);
    expect(erros).toHaveLength(1);
    expect(erros[0]).toContain("type invalido");
  });

  test("Dado campos obrigatórios no perfil, Quando uma página não os tem ou os deixa vazios, Então reprova nomeando arquivo e campo", async () => {
    toml('campos_obrigatorios = ["owner", "revisao"]\n');
    gravar("sem.md", pagina("sem"));
    gravar("vazio.md", pagina("vazio", { extra: 'owner: ""\nrevisao: []\n' }));
    gravar("nulo.md", pagina("nulo", { extra: "owner:\nrevisao: 2026-10-01\n" }));
    gravar("ok.md", pagina("ok", { extra: "owner: ana\nrevisao: 2026-10-01\n" }));
    const { erros } = await validarWiki(wiki);
    const texto = erros.join("\n");
    expect(texto).toContain("campo obrigatorio 'owner' ausente (anvilore.toml): sem.md");
    expect(texto).toContain("campo obrigatorio 'revisao' ausente (anvilore.toml): sem.md");
    expect(texto).toContain("campo obrigatorio 'owner' ausente (anvilore.toml): vazio.md");
    expect(texto).toContain("campo obrigatorio 'revisao' ausente (anvilore.toml): vazio.md");
    expect(texto).toContain("campo obrigatorio 'owner' ausente (anvilore.toml): nulo.md");
    expect(texto).not.toContain("'revisao' ausente (anvilore.toml): nulo.md");
    expect(texto).not.toContain("ok.md");
  });

  test("Dado um anvilore.toml inválido, Quando valido, Então reprova nomeando o arquivo de perfil e nunca cai no SCHEMA.md", async () => {
    toml('areas = ["produto"\n');
    gravar("a.md", pagina("a"));
    const r = await rodar();
    expect(r.codigo).toBe(1);
    expect(r.saida).toContain("anvilore.toml");
    expect(r.saida).toContain("VALIDACAO: FAIL");
  });

  test("Dado uma chave desconhecida no anvilore.toml, Quando valido, Então reprova nomeando a chave", async () => {
    toml('area = ["produto"]\n');
    gravar("a.md", pagina("a"));
    const r = await rodar();
    expect(r.codigo).toBe(1);
    expect(r.saida).toContain('chave desconhecida "area"');
  });

  test("Dado um anvilore.toml na pasta da wiki e não na raiz, Quando valido, Então ele não vale", async () => {
    writeFileSync(join(wiki, "anvilore.toml"), 'areas = ["produto"]\n');
    gravar("pessoal/concepts/diario.md", pagina("diario", { extra: "area: pessoal\n" }));
    expect((await validarWiki(wiki)).ok).toBe(true);
  });
});

describe("comandoValidar: saída e códigos", () => {
  test("Dado uma wiki limpa, Quando rodo, Então a saída traz a dívida, as métricas e VALIDACAO: PASS", async () => {
    gravar("a.md", pagina("a"));
    gravar("index.md", indice("a"));
    const r = await rodar();
    expect(r.saida.split("\n")).toEqual([
      "Divida: 0 gaps, 0 contradicoes",
      "Registrar uma contradicao nao e criar uma contradicao — e torna-la visivel.",
      "METRIC: okf_stale=0",
      "METRIC: okf_modified_after_verified=0",
      "VALIDACAO: PASS",
    ]);
  });

  test("Dado violações, Quando rodo, Então cada erro sai antes e o FAIL conta as violações", async () => {
    gravar("a.md", "sem\n");
    gravar("b.md", "sem\n");
    const r = await rodar();
    expect(r.saida).toContain("ERRO: sem frontmatter: a.md");
    expect(r.saida).toContain("VALIDACAO: FAIL (2 violacoes de invariante)");
  });

  test("Dado nenhum argumento, Quando rodo, Então valida a pasta wiki do diretório de trabalho", async () => {
    gravar("a.md", pagina("a"));
    const r = await capturar(() => comandoValidar([], raiz));
    expect(r.saida).toContain("VALIDACAO: PASS");
    const semWiki = await capturar(() => comandoValidar([], join(raiz, "outro")));
    expect(semWiki.codigo).toBe(1);
  });

  test("Dado um caminho relativo, Quando rodo, Então ele resolve a partir do diretório de trabalho", async () => {
    gravar("a.md", pagina("a"));
    const r = await capturar(() => comandoValidar(["wiki"], raiz));
    expect(r.codigo).toBe(0);
  });

  test("Dado argumento a mais ou opção desconhecida, Quando rodo, Então mostra o uso e devolve 2", async () => {
    for (const args of [["a", "b"], ["--x"]]) {
      const r = await capturar(() => comandoValidar(args));
      expect(r.codigo).toBe(2);
      expect(r.erro).toContain("Uso: anvilore validar [diretorio]");
    }
  });

  test("Dado o subcomando validar, Quando executo pela CLI, Então ele está registrado", async () => {
    gravar("a.md", pagina("a"));
    const r = await capturar(() => executar(["validar", wiki]));
    expect(r.codigo).toBe(0);
    expect(r.saida).toContain("VALIDACAO: PASS");
  });
});
