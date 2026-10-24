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

describe("checarRelease: CHANGELOG", () => {
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
    const texto = `﻿${changelog("## [0.1.0] - 2026-10-23\n\n### Added\n\n- Projeto Bun.\n")}`.replaceAll("\n", "\r\n");
    gravar("CHANGELOG.md", texto);
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

  test("Dado que docs/knowledge_base não existe, Quando checo, Então não reprova por isso", () => {
    expect(checarRelease(raiz, "0.1.0")).toEqual({ ok: true, problemas: [] });
  });

  test("Dado uma página marcada como gerada e sem verified, Quando checo, Então reprova nomeando a página", () => {
    gravar("docs/knowledge_base/decisoes.md", pagina("generated: 2026-10-23"));
    const r = checarRelease(raiz, "0.1.0");
    expect(r.ok).toBe(false);
    expect(r.problemas.join("\n")).toContain("decisoes.md");
  });

  test("Dado uma página gerada com verified vazio, Quando checo, Então reprova", () => {
    gravar("docs/knowledge_base/decisoes.md", pagina("generated: 2026-10-23\nverified:"));
    expect(checarRelease(raiz, "0.1.0").ok).toBe(false);
  });

  test("Dado uma página gerada com verified falso, Quando checo, Então reprova", () => {
    gravar("docs/knowledge_base/decisoes.md", pagina("generated: 2026-10-23\nverified: false"));
    expect(checarRelease(raiz, "0.1.0").ok).toBe(false);
  });

  test("Dado uma página gerada com verified preenchido, Quando checo, Então passa", () => {
    gravar("docs/knowledge_base/decisoes.md", pagina("generated: 2026-10-23\nverified: 2026-10-24"));
    expect(checarRelease(raiz, "0.1.0").ok).toBe(true);
  });

  test("Dado uma página sem generated, Quando checo, Então não é afetada", () => {
    gravar("docs/knowledge_base/livre.md", pagina("title: Livre"));
    gravar("docs/knowledge_base/sem-frontmatter.md", "Só texto.\n");
    expect(checarRelease(raiz, "0.1.0").ok).toBe(true);
  });

  test("Dado páginas em subpasta e arquivos que não são .md, Quando checo, Então só as .md entram", () => {
    gravar("docs/knowledge_base/sub/fundo.md", pagina("generated: 2026-10-23"));
    gravar("docs/knowledge_base/nota.txt", "generated: 2026-10-23");
    const r = checarRelease(raiz, "0.1.0");
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toContain("sub/fundo.md");
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

  test("Dado a release pronta, Quando rodo checar-release 0.1.0, Então imprime uma linha de sucesso e devolve 0", async () => {
    gravar("CHANGELOG.md", changelog("## [0.1.0]\n\n- item\n"));
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

  test("Dado a tabela do CLI, Quando executo checar-release sem versão, Então o subcomando está registrado e devolve 2", async () => {
    expect(Object.keys(subcomandos)).toContain("checar-release");
    const r = await capturar(() => executar(["checar-release"]));
    expect(r.codigo).toBe(2);
  });
});
