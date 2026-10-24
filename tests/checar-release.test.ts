import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checarRelease, comandoChecarRelease } from "../src/comandos/checar-release";
import { executar, subcomandos } from "../src/cli";

let raiz: string;

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "anvilore-release-"));
});
afterEach(() => {
  rmSync(raiz, { recursive: true, force: true });
});

function gravar(relativo: string, conteudo: string): void {
  const caminho = join(raiz, relativo);
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, conteudo);
}

const cabecalho = "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- algo em andamento\n\n";
const naoResolvido = "### Não resolvido nesta versão\n\n- Não protege contra vazamento de documentos internos.\n\n";

function changelog(secaoVersao: string): string {
  return cabecalho + secaoVersao;
}

function pagina(frontmatter: string): string {
  return `---\n${frontmatter}\n---\n\nCorpo.\n`;
}

function kbRevisada(): void {
  gravar("docs/knowledge_base/README.md", pagina("generated: 2026-10-23\nverified: 2026-10-24"));
}

describe("checarRelease: CHANGELOG", () => {
  // KB com uma página revisada, para isolar o que estes testes cobrem.
  beforeEach(kbRevisada);

  test("Dado a versão 0.1.0 sem seção no CHANGELOG, Quando checo, Então reprova e nomeia a versão", () => {
    gravar("CHANGELOG.md", changelog("## [0.0.9] - 2026-01-01\n\n### Added\n\n- antigo\n"));
    const r = checarRelease(raiz, "0.1.0");
    expect(r.ok).toBe(false);
    expect(r.problemas.join("\n")).toContain("0.1.0");
  });

  test("Dado um repositório sem CHANGELOG.md, Quando checo, Então reprova dizendo que o arquivo não existe", () => {
    const r = checarRelease(raiz, "0.1.0");
    expect(r.ok).toBe(false);
    expect(r.problemas.join("\n")).toContain("CHANGELOG.md");
  });

  test("Dado a seção da versão sem nenhum item, Quando checo, Então reprova", () => {
    gravar("CHANGELOG.md", changelog("## [0.1.0] - 2026-10-23\n\n### Added\n\n"));
    const r = checarRelease(raiz, "0.1.0");
    expect(r.ok).toBe(false);
    expect(r.problemas.join("\n")).toContain("0.1.0");
  });

  test("Dado a seção só com o Não resolvido, Quando checo, Então reprova porque nada foi declarado como entregue", () => {
    gravar("CHANGELOG.md", changelog(`## [0.1.0] - 2026-10-23\n\n${naoResolvido}`));
    const r = checarRelease(raiz, "0.1.0");
    expect(r.ok).toBe(false);
  });

  test("Dado a seção com um item fora do Não resolvido, Quando checo, Então passa", () => {
    gravar("CHANGELOG.md", changelog(`## [0.1.0] - 2026-10-23\n\n### Added\n\n- Projeto Bun.\n\n${naoResolvido}`));
    const r = checarRelease(raiz, "0.1.0");
    expect(r).toEqual({ ok: true, problemas: [] });
  });

  test("Dado a seção com item e sem a data no título, Quando checo, Então passa", () => {
    gravar("CHANGELOG.md", changelog("## [0.1.0]\n\n### Added\n\n* Projeto Bun.\n"));
    expect(checarRelease(raiz, "0.1.0").ok).toBe(true);
  });

  test("Dado itens só na seção seguinte, Quando checo a versão vazia, Então reprova", () => {
    gravar("CHANGELOG.md", changelog("## [0.1.0] - 2026-10-23\n\n## [0.0.9] - 2026-01-01\n\n- antigo\n"));
    expect(checarRelease(raiz, "0.1.0").ok).toBe(false);
  });

  test("Dado o item só em Unreleased, Quando checo a versão, Então reprova", () => {
    gravar("CHANGELOG.md", cabecalho);
    expect(checarRelease(raiz, "0.1.0").ok).toBe(false);
  });

  test("Dado CHANGELOG com CRLF e BOM, Quando checo, Então lê a seção normalmente", () => {
    const texto = `\uFEFF${changelog("## [0.1.0] - 2026-10-23\n\n### Added\n\n- Projeto Bun.\n")}`.replaceAll("\n", "\r\n");
    gravar("CHANGELOG.md", texto);
    expect(checarRelease(raiz, "0.1.0").ok).toBe(true);
  });

  test("Dado a seção só com Nada ainda, Quando checo, Então reprova", () => {
    gravar("CHANGELOG.md", changelog("## [0.1.0]\n\n### Added\n\n- Nada ainda.\n"));
    expect(checarRelease(raiz, "0.1.0").ok).toBe(false);
  });

  test.each(["nada", "TBD", "TODO", "-", "...", "N/A.", "Nada."])(
    "Dado o item vazio de sentido %p, Quando checo, Então reprova",
    (item) => {
      gravar("CHANGELOG.md", changelog(`## [0.1.0]\n\n- ${item}\n`));
      expect(checarRelease(raiz, "0.1.0").ok).toBe(false);
    },
  );

  test("Dado um item só dentro de bloco de código, Quando checo, Então reprova", () => {
    gravar("CHANGELOG.md", changelog("## [0.1.0]\n\n```\n- exemplo\n```\n\n~~~\n- outro\n~~~\n"));
    expect(checarRelease(raiz, "0.1.0").ok).toBe(false);
  });

  test("Dado um exemplo dentro de cerca de 4 crases com 3 crases no meio, Quando checo, Então reprova (não há entrega fora do bloco)", () => {
    gravar("CHANGELOG.md", changelog("## [0.1.0]\n````markdown\n```\n- Exemplo, não entrega.\n````\n"));
    expect(checarRelease(raiz, "0.1.0").ok).toBe(false);
  });

  test("Dado o mesmo exemplo em cerca de 4 tils com 3 tils no meio, Quando checo, Então reprova", () => {
    gravar("CHANGELOG.md", changelog("## [0.1.0]\n~~~~\n~~~\n- Exemplo, não entrega.\n~~~~\n"));
    expect(checarRelease(raiz, "0.1.0").ok).toBe(false);
  });

  test("Dado um fechamento com texto depois e um item real só depois da cerca de verdade, Quando checo, Então passa", () => {
    gravar("CHANGELOG.md", changelog("## [0.1.0]\n```\n``` texto\n- dentro\n```\n- real\n"));
    expect(checarRelease(raiz, "0.1.0").ok).toBe(true);
  });

  test("Dado um item real depois de uma cerca de 4 crases com 3 no meio, Quando checo, Então passa", () => {
    gravar("CHANGELOG.md", changelog("## [0.1.0]\n````markdown\n```\n````\n- real\n"));
    expect(checarRelease(raiz, "0.1.0").ok).toBe(true);
  });

  test("Dado um item só dentro de comentário HTML, Quando checo, Então reprova", () => {
    gravar("CHANGELOG.md", changelog("## [0.1.0]\n\n<!--\n- escondido\n-->\n<!-- - aqui também -->\n"));
    expect(checarRelease(raiz, "0.1.0").ok).toBe(false);
  });

  test("Dado um item depois do fim do bloco de código e do comentário, Quando checo, Então passa", () => {
    gravar("CHANGELOG.md", changelog("## [0.1.0]\n\n```\n- exemplo\n```\n<!-- x -->\n- real\n"));
    expect(checarRelease(raiz, "0.1.0").ok).toBe(true);
  });

  test("Dado o título ## [0.1.0] só dentro de bloco de código, Quando checo, Então não conta como seção", () => {
    gravar("CHANGELOG.md", changelog("```\n## [0.1.0]\n\n- item\n```\n"));
    const r = checarRelease(raiz, "0.1.0");
    expect(r.ok).toBe(false);
    expect(r.problemas.join("\n")).toContain("não tem a seção");
  });

  test("Dado o título ## [0.1.0] só dentro de comentário HTML, Quando checo, Então não conta como seção", () => {
    gravar("CHANGELOG.md", changelog("<!--\n## [0.1.0]\n- item\n-->\n"));
    expect(checarRelease(raiz, "0.1.0").ok).toBe(false);
  });

  test("Dado um ## dentro de bloco de código na seção, Quando checo, Então não encerra a seção", () => {
    gravar("CHANGELOG.md", changelog("## [0.1.0]\n\n```\n## falso\n```\n- real\n"));
    expect(checarRelease(raiz, "0.1.0").ok).toBe(true);
  });

  test("Dado Não resolvido com um #### e um item, Quando checo, Então o item continua não contando como entregue", () => {
    gravar("CHANGELOG.md", changelog("## [0.1.0]\n\n### Não resolvido nesta versão\n\n#### Detalhes\n\n- x\n"));
    expect(checarRelease(raiz, "0.1.0").ok).toBe(false);
  });

  test("Dado Nao resolvido sem acento em caixa alta, Quando checo, Então também não conta como entregue", () => {
    gravar("CHANGELOG.md", changelog("## [0.1.0]\n\n### NAO RESOLVIDO\n\n- x\n"));
    expect(checarRelease(raiz, "0.1.0").ok).toBe(false);
  });

  test("Dado um ### novo depois do Não resolvido, Quando checo, Então os itens dele contam", () => {
    gravar("CHANGELOG.md", changelog(`## [0.1.0]\n\n${naoResolvido}### Added\n\n- real\n`));
    expect(checarRelease(raiz, "0.1.0").ok).toBe(true);
  });

  test("Dado 0.1.0 pedida e só existir 0.1.01, Quando checo, Então não confunde as versões", () => {
    gravar("CHANGELOG.md", changelog("## [0.1.01]\n\n- item\n"));
    expect(checarRelease(raiz, "0.1.0").ok).toBe(false);
  });
});

describe("checarRelease: knowledge base", () => {
  const changelogOk = changelog("## [0.1.0]\n\n### Added\n\n- Projeto Bun.\n");

  beforeEach(() => gravar("CHANGELOG.md", changelogOk));

  test("Dado que docs/knowledge_base não existe, Quando checo, Então reprova dizendo que ela não existe", () => {
    const r = checarRelease(raiz, "0.1.0");
    expect(r.ok).toBe(false);
    expect(r.problemas.join("\n")).toContain("docs/knowledge_base não existe");
  });

  test("Dado uma knowledge base existente e vazia, Quando checo, Então reprova dizendo que não há página e não afirma revisão", () => {
    mkdirSync(join(raiz, "docs", "knowledge_base"), { recursive: true });
    const r = checarRelease(raiz, "0.1.0");
    expect(r.ok).toBe(false);
    expect(r.problemas).toEqual(["docs/knowledge_base não tem nenhuma página .md"]);
  });

  test("Dado uma knowledge base só com arquivos que não são .md, Quando checo, Então reprova", () => {
    gravar("docs/knowledge_base/nota.txt", "qualquer coisa");
    expect(checarRelease(raiz, "0.1.0").problemas.join("\n")).toContain("nenhuma página");
  });

  test("Dado docs/knowledge_base como arquivo, Quando checo, Então reprova sem lançar exceção", () => {
    gravar("docs/knowledge_base", "isto é um arquivo");
    const r = checarRelease(raiz, "0.1.0");
    expect(r.ok).toBe(false);
    expect(r.problemas.join("\n")).toContain("não é uma pasta");
  });

  test("Dado uma pasta chamada x.md na knowledge base, Quando checo, Então ela é ignorada e o resto é conferido sem exceção", () => {
    mkdirSync(join(raiz, "docs", "knowledge_base", "x.md"), { recursive: true });
    gravar("docs/knowledge_base/real.md", pagina("generated: 2026-10-23"));
    const r = checarRelease(raiz, "0.1.0");
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toContain("real.md");
  });

  test("Dado que docs/knowledge_base não existe, Quando checo, Então a mensagem traz o cwd e manda rodar na raiz do repositório", () => {
    const texto = checarRelease(raiz, "0.1.0").problemas.join("\n");
    expect(texto).toContain(process.cwd());
    expect(texto).toContain("rode na raiz do repositório");
  });

  test("Dado uma página com verified em AAAA-MM-DD, Quando checo, Então passa", () => {
    gravar("docs/knowledge_base/decisoes.md", pagina("generated: 2026-10-23\nverified: 2026-10-24"));
    expect(checarRelease(raiz, "0.1.0")).toEqual({ ok: true, problemas: [] });
  });

  test("Dado uma página sem generated mas com verified, Quando checo, Então passa", () => {
    gravar("docs/knowledge_base/livre.md", pagina("verified: 2026-10-24"));
    expect(checarRelease(raiz, "0.1.0").ok).toBe(true);
  });

  test("Dado uma página gerada e sem verified, Quando checo, Então reprova nomeando a página e pedindo revisão humana com data", () => {
    gravar("docs/knowledge_base/decisoes.md", pagina("generated: 2026-10-23"));
    const r = checarRelease(raiz, "0.1.0");
    expect(r.ok).toBe(false);
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toContain("decisoes.md");
    expect(r.problemas[0]).toContain("revisão humana");
    expect(r.problemas[0]).toContain("AAAA-MM-DD");
  });

  test("Dado uma página sem generated e sem verified, Quando checo, Então reprova", () => {
    gravar("docs/knowledge_base/livre.md", pagina("title: Livre"));
    expect(checarRelease(raiz, "0.1.0").problemas.join("\n")).toContain("livre.md");
  });

  test("Dado uma página sem frontmatter, Quando checo, Então reprova nomeando a página", () => {
    gravar("docs/knowledge_base/solta.md", "Só texto.\n");
    const r = checarRelease(raiz, "0.1.0");
    expect(r.ok).toBe(false);
    expect(r.problemas[0]).toContain("solta.md");
  });

  test.each(["TODO", "no", "true", "false", "0", "{}", "''", "", "2026-1-5", "24/10/2026", "2026-10-24T10:00"])(
    "Dado verified %p, Quando checo, Então reprova",
    (valor) => {
      gravar("docs/knowledge_base/a.md", pagina(`generated: 2026-10-23\nverified: ${valor}`));
      const r = checarRelease(raiz, "0.1.0");
      expect(r.ok).toBe(false);
      expect(r.problemas[0]).toContain("a.md");
    },
  );

  test("Dado verified com data entre aspas, Quando checo, Então passa", () => {
    gravar("docs/knowledge_base/a.md", pagina('verified: "2026-10-24"'));
    expect(checarRelease(raiz, "0.1.0").ok).toBe(true);
  });

  test("Dado páginas em subpasta, extensão .MD e arquivos que não são .md, Quando checo, Então só as .md entram", () => {
    gravar("docs/knowledge_base/sub/fundo.md", pagina("generated: 2026-10-23"));
    gravar("docs/knowledge_base/MAIUSCULA.MD", pagina("title: x"));
    gravar("docs/knowledge_base/nota.txt", "qualquer coisa");
    const r = checarRelease(raiz, "0.1.0");
    expect(r.problemas).toHaveLength(2);
    expect(r.problemas.join("\n")).toContain("sub/fundo.md");
    expect(r.problemas.join("\n")).toContain("MAIUSCULA.MD");
  });

  test("Dado uma página com frontmatter inválido, Quando checo, Então reprova nomeando o arquivo em vez de pular", () => {
    gravar("docs/knowledge_base/quebrada.md", "---\ntitle: [aberto\n---\n\nCorpo.\n");
    gravar("docs/knowledge_base/sem-fecho.md", "---\ntitle: x\n\nCorpo.\n");
    const r = checarRelease(raiz, "0.1.0");
    expect(r.ok).toBe(false);
    expect(r.problemas).toHaveLength(2);
    expect(r.problemas.join("\n")).toContain("quebrada.md");
    expect(r.problemas.join("\n")).toContain("sem-fecho.md");
  });

  test("Dado CHANGELOG sem a seção e página não revisada, Quando checo, Então lista os dois problemas", () => {
    gravar("CHANGELOG.md", cabecalho);
    gravar("docs/knowledge_base/a.md", pagina("generated: 2026-10-23"));
    expect(checarRelease(raiz, "0.1.0").problemas).toHaveLength(2);
  });
});

describe("subcomando checar-release", () => {
  function capturar<T>(corpo: () => Promise<T>) {
    const saida: string[] = [];
    const erro: string[] = [];
    const log = spyOn(console, "log").mockImplementation((...a) => {
      saida.push(a.join(" "));
    });
    const err = spyOn(console, "error").mockImplementation((...a) => {
      erro.push(a.join(" "));
    });
    return corpo()
      .then((codigo) => ({ codigo, saida, erro }))
      .finally(() => {
        log.mockRestore();
        err.mockRestore();
      });
  }

  test.each(["Unreleased", "v0.1.0", "0.1", "abc", "1.0.0 "])(
    "Dado a versão %p que não é SemVer, Quando rodo checar-release, Então devolve 2 com mensagem",
    async (versao) => {
      const r = await capturar(() => comandoChecarRelease([versao], raiz));
      expect(r.codigo).toBe(2);
      expect(r.erro.join("\n")).toContain("SemVer");
    },
  );

  test("Dado uma versão com pré-lançamento, Quando rodo checar-release, Então aceita o formato", async () => {
    gravar("CHANGELOG.md", changelog("## [0.1.0-rc.1]\n\n- item\n"));
    kbRevisada();
    const r = await capturar(() => comandoChecarRelease(["0.1.0-rc.1"], raiz));
    expect(r.codigo).toBe(0);
  });

  test("Dado a release pronta, Quando rodo checar-release 0.1.0, Então imprime uma linha de sucesso e devolve 0", async () => {
    gravar("CHANGELOG.md", changelog("## [0.1.0]\n\n- item\n"));
    kbRevisada();
    const r = await capturar(() => comandoChecarRelease(["0.1.0"], raiz));
    expect(r.codigo).toBe(0);
    expect(r.saida).toHaveLength(1);
    expect(r.saida[0]).toContain("0.1.0");
  });

  test("Dado problemas, Quando rodo checar-release, Então imprime um por linha e devolve 1", async () => {
    gravar("CHANGELOG.md", cabecalho);
    gravar("docs/knowledge_base/a.md", pagina("generated: 2026-10-23"));
    const r = await capturar(() => comandoChecarRelease(["0.1.0"], raiz));
    expect(r.codigo).toBe(1);
    expect(r.erro).toHaveLength(2);
    expect(r.saida).toHaveLength(0);
  });

  test("Dado nenhuma versão, Quando rodo checar-release, Então devolve 2 com o uso", async () => {
    const r = await capturar(() => comandoChecarRelease([], raiz));
    expect(r.codigo).toBe(2);
    expect(r.erro.join("\n")).toContain("Uso: anvilore checar-release <versao>");
  });

  test("Dado um argumento extra além da versão, Quando rodo checar-release, Então recusa com o uso e devolve 2, sem conferir a release", async () => {
    gravar("CHANGELOG.md", changelog("## [0.1.0]\n\n- item\n"));
    kbRevisada();
    const r = await capturar(() => comandoChecarRelease(["0.1.0", "outra"], raiz));
    expect(r.codigo).toBe(2);
    expect(r.saida).toEqual([]);
    expect(r.erro.join("\n")).toContain("Uso: anvilore checar-release <versao>");
  });

  test("Dado --help, Quando rodo checar-release, Então imprime o uso e devolve 2, sem acusar versão inválida", async () => {
    const r = await capturar(() => comandoChecarRelease(["--help"], raiz));
    expect(r.codigo).toBe(2);
    expect(r.erro.join("\n")).toContain("Uso: anvilore checar-release <versao>");
    expect(r.erro.join("\n")).not.toContain("Versão inválida");
  });

  test("Dado a tabela do CLI, Quando executo checar-release sem versão, Então o subcomando está registrado e devolve 2", async () => {
    expect(Object.keys(subcomandos)).toContain("checar-release");
    const r = await capturar(() => executar(["checar-release"]));
    expect(r.codigo).toBe(2);
  });
});
