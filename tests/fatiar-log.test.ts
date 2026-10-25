import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ErroDeFatiamento, comandoFatiarLog, fatiarLog } from "../src/comandos/fatiar-log";
import { executar, subcomandos } from "../src/cli";

let tmp: string;
let wiki: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "anvilore-fatiar-"));
  wiki = join(tmp, "wiki");
  mkdirSync(join(wiki, "log"), { recursive: true });
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const LOG = `# Log

Registro do que foi ingerido, com data e fonte.

## [2026-09-01] ingest | Fonte A

Paginas tocadas: alfa/sources/a (1 no total)

## [2026-09-02] nota | Nota B

Corpo da nota B, com uma linha so.

## [2026-09-02] ingest | Fonte C

Segunda entrada do mesmo dia.

## [2026-09-03] revisao | Revisao D

Corpo da revisao D.
`;

function lerDia(dia: string, raiz: string = wiki): string {
  return readFileSync(join(raiz, "log", `log-${dia}.md`), "utf8");
}

function hashes(raiz: string = wiki): string {
  return readdirSync(join(raiz, "log"))
    .filter((nome) => /^log-.*\.md$/.test(nome))
    .sort()
    .map((nome) => `${createHash("sha256").update(readFileSync(join(raiz, "log", nome))).digest("hex")}  ${nome}`)
    .join("\n");
}

function novaWiki(nome: string, conteudo: string): string {
  const raiz = join(tmp, nome);
  mkdirSync(raiz, { recursive: true });
  writeFileSync(join(raiz, "log.md"), conteudo);
  return raiz;
}

async function capturar<T>(corpo: () => Promise<T>) {
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
    return { codigo, saida, erro };
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
}

describe("fatiar-log: primeira execução", () => {
  beforeEach(() => writeFileSync(join(wiki, "log.md"), LOG));

  test("Dado um log.md monolítico, Quando fatio, Então o comando sai 0", async () => {
    const r = await capturar(() => comandoFatiarLog([wiki]));
    expect(r.codigo).toBe(0);
    expect(r.erro).toEqual([]);
  });

  test("Dado um log.md com três dias, Quando fatio, Então crio 3 arquivos de dia, um por dia", async () => {
    const r = await fatiarLog(wiki);
    expect(readdirSync(join(wiki, "log")).filter((n) => /^log-.*\.md$/.test(n))).toHaveLength(3);
    for (const dia of ["2026-09-01", "2026-09-02", "2026-09-03"]) {
      expect(existsSync(join(wiki, "log", `log-${dia}.md`))).toBe(true);
    }
    expect(r.arquivosCriados).toEqual(
      ["2026-09-01", "2026-09-02", "2026-09-03"].map((d) => join(wiki, "log", `log-${d}.md`)),
    );
  });

  test("Dado dois registros no dia 02, Quando fatio, Então as duas entradas chegam inteiras no arquivo do dia", async () => {
    await fatiarLog(wiki);
    const dia = lerDia("2026-09-02");
    expect(dia).toContain("Corpo da nota B");
    expect(dia).toContain("Segunda entrada do mesmo dia");
    expect(dia.split("\n").filter((l) => l.startsWith("## [2026-09-02]"))).toHaveLength(2);
  });

  test("Dado a entrada do dia 01, Quando fatio, Então o corpo dela é preservado", async () => {
    await fatiarLog(wiki);
    expect(lerDia("2026-09-01")).toContain("Paginas tocadas: alfa/sources/a");
  });

  test("Dado um log com título e prosa antes da primeira entrada, Quando fatio, Então o preâmbulo é relatado em voz alta com a contagem de linhas", async () => {
    const r = await capturar(() => comandoFatiarLog([wiki]));
    const saida = r.saida.join("\n");
    expect(saida).toMatch(/pre[aâ]mbulo/i);
    expect(saida).toContain("AVISO: 2 linha(s) de preâmbulo");
    expect(saida).toContain(`${join(wiki, "log.md")} continua intacto`);
    expect(saida).not.toContain("scripts/indexar-log.sh");
    expect(saida).toContain("anvilore indexar-log");
  });

  test("Dado um log com preâmbulo de 2 linhas, Quando fatio, Então devolvo a contagem de linhas de preâmbulo", async () => {
    expect((await fatiarLog(wiki)).linhasDePreambulo).toBe(2);
  });

  test("Dado a migração concluída, Quando comparo o log.md de origem, Então ele continua intacto", async () => {
    await fatiarLog(wiki);
    expect(readFileSync(join(wiki, "log.md"), "utf8")).toBe(LOG);
  });

  test("Dado a migração concluída, Quando leio a saída, Então a linha OK conta entradas e arquivos", async () => {
    const r = await capturar(() => comandoFatiarLog([wiki]));
    expect(r.saida[0]).toBe(`OK: 4 entradas → 3 arquivos em ${join(wiki, "log")}`);
  });

  test("Dado dois registros no dia 02, Quando fatio, Então o arquivo do dia tem frontmatter, título e as entradas separadas por uma linha em branco", async () => {
    await fatiarLog(wiki);
    expect(lerDia("2026-09-02")).toBe(
      "---\ntype: log-day\ndate: 2026-09-02\n---\n\n# Log — 2026-09-02\n\n" +
        "## [2026-09-02] nota | Nota B\n\nCorpo da nota B, com uma linha so.\n\n" +
        "## [2026-09-02] ingest | Fonte C\n\nSegunda entrada do mesmo dia.\n",
    );
  });

  test("Dado um log sem preâmbulo, Quando fatio, Então não há aviso e a contagem é zero", async () => {
    const limpa = novaWiki("limpa", "## [2026-09-01] ingest | A\n\nCorpo.\n");
    const r = await capturar(() => comandoFatiarLog([limpa]));
    expect(r.codigo).toBe(0);
    expect(r.saida).toHaveLength(1);
    expect((await fatiarLog(novaWiki("limpa2", "## [2026-09-01] ingest | A\n\nCorpo.\n"))).linhasDePreambulo).toBe(0);
  });

  test("Dado corpos com linhas em branco no fim, Quando fatio, Então o fim em branco é aparado e o miolo é mantido", async () => {
    const w = novaWiki("brancos", "## [2026-09-01] ingest | A\n\nlinha 1\n\n\nlinha 2\n\n\n\n");
    await fatiarLog(w);
    expect(lerDia("2026-09-01", w)).toBe(
      "---\ntype: log-day\ndate: 2026-09-01\n---\n\n# Log — 2026-09-01\n\n## [2026-09-01] ingest | A\n\nlinha 1\n\n\nlinha 2\n",
    );
  });

  test("Dado um log.md com fim de linha CRLF, Quando fatio, Então os arquivos saem com LF", async () => {
    const w = novaWiki("crlf", "# Log\r\n\r\n## [2026-09-01] ingest | A\r\n\r\nCorpo.\r\n");
    await fatiarLog(w);
    expect(lerDia("2026-09-01", w)).not.toContain("\r");
    expect(lerDia("2026-09-01", w)).toContain("## [2026-09-01] ingest | A\n\nCorpo.\n");
  });

  test("Dado uma wiki sem a pasta log/, Quando fatio, Então a pasta é criada", async () => {
    const w = novaWiki("sem-pasta", "## [2026-09-01] ingest | A\n\nCorpo.\n");
    expect(existsSync(join(w, "log"))).toBe(false);
    await fatiarLog(w);
    expect(existsSync(join(w, "log", "log-2026-09-01.md"))).toBe(true);
  });
});

describe("fatiar-log: migração one-shot (recusa a segunda execução)", () => {
  beforeEach(() => writeFileSync(join(wiki, "log.md"), LOG));

  test("Dado uma wiki já fatiada, Quando rodo de novo, Então aborta com saída diferente de 0 dizendo que o destino já existe", async () => {
    await fatiarLog(wiki);
    const r = await capturar(() => comandoFatiarLog([wiki]));
    expect(r.codigo).not.toBe(0);
    expect(r.erro.join("\n")).toContain("destino já existe, nada foi escrito (migração one-shot)");
    expect(r.erro.join("\n")).toContain(join(wiki, "log", "log-2026-09-02.md"));
    expect(r.saida).toEqual([]);
  });

  test("Dado um marcador injetado num arquivo já fatiado, Quando rodo de novo, Então nenhum arquivo é tocado e o marcador sobrevive", async () => {
    await fatiarLog(wiki);
    writeFileSync(join(wiki, "log", "log-2026-09-02.md"), `${lerDia("2026-09-02")}MARCADOR-DE-MUTACAO\n`);
    const antes = hashes();
    await expect(fatiarLog(wiki)).rejects.toThrow(ErroDeFatiamento);
    expect(hashes()).toBe(antes);
    expect(lerDia("2026-09-02")).toContain("MARCADOR-DE-MUTACAO");
  });

  test("Dado destinos removidos, Quando rodo de novo, Então volta a fatiar, o hash muda e o marcador some (a asserção tem dentes)", async () => {
    await fatiarLog(wiki);
    writeFileSync(join(wiki, "log", "log-2026-09-02.md"), `${lerDia("2026-09-02")}MARCADOR-DE-MUTACAO\n`);
    const comMarcador = hashes();
    for (const nome of readdirSync(join(wiki, "log"))) rmSync(join(wiki, "log", nome));
    const r = await capturar(() => comandoFatiarLog([wiki]));
    expect(r.codigo).toBe(0);
    expect(hashes()).not.toBe(comMarcador);
    expect(lerDia("2026-09-02")).not.toContain("MARCADOR-DE-MUTACAO");
  });

  test("Dado só um destino existente entre vários, Quando fatio, Então aborta antes de escrever qualquer um e lista os existentes em ordem", async () => {
    writeFileSync(join(wiki, "log", "log-2026-09-03.md"), "antigo\n");
    writeFileSync(join(wiki, "log", "log-2026-09-01.md"), "antigo\n");
    await expect(fatiarLog(wiki)).rejects.toThrow(
      `destino já existe, nada foi escrito (migração one-shot): ${join(wiki, "log", "log-2026-09-01.md")}, ${join(wiki, "log", "log-2026-09-03.md")}`,
    );
    expect(existsSync(join(wiki, "log", "log-2026-09-02.md"))).toBe(false);
    expect(lerDia("2026-09-03")).toBe("antigo\n");
  });

  test("Dado wiki/log como arquivo, Quando fatio, Então reprova em voz alta e não lança erro cru", async () => {
    rmSync(join(wiki, "log"), { recursive: true });
    writeFileSync(join(wiki, "log"), "isto é um arquivo");
    const r = await capturar(() => comandoFatiarLog([wiki]));
    expect(r.codigo).toBe(1);
    expect(r.erro.join("\n")).toContain(`ERRO: não foi possível criar ${join(wiki, "log")}`);
  });
});

describe("fatiar-log: formato de header", () => {
  test("Dado o formato antigo ## DATA — Título, Quando fatio, Então o header é normalizado para ## [DATA] note | Título", async () => {
    const velha = join(tmp, "velha");
    mkdirSync(velha);
    writeFileSync(join(velha, "log.md"), "## 2026-08-01 — Entrada no formato antigo\n\nCorpo.\n");
    await fatiarLog(velha);
    expect(lerDia("2026-08-01", velha)).toContain("\n## [2026-08-01] note | Entrada no formato antigo\n");
  });

  test("Dado um ## dentro de bloco de código, Quando fatio, Então a linha é conteúdo e não um header", async () => {
    const w = novaWiki(
      "fence",
      "## [2026-09-01] ingest | A\n\n```md\n## [2026-09-09] falso | Não sou entrada\n## sem data\n```\n\nfim\n",
    );
    const r = await fatiarLog(w);
    expect(r.arquivosCriados).toHaveLength(1);
    expect(lerDia("2026-09-01", w)).toContain("## [2026-09-09] falso | Não sou entrada\n## sem data\n```");
  });

  test("Dado um header ## sem data parseável, Quando fatio, Então aborta com o número da linha e não escreve nada", async () => {
    const w = novaWiki("sem-data", "## [2026-09-01] ingest | A\n\nCorpo.\n\n## Sem data\n\nCorpo.\n");
    await expect(fatiarLog(w)).rejects.toThrow("header sem data parseável na linha 5: ## Sem data");
    expect(existsSync(join(w, "log"))).toBe(false);
  });

  test("Dado um preâmbulo com ## sem data antes de tudo, Quando fatio, Então também reprova", async () => {
    const w = novaWiki("preambulo-com-header", "## Introdução\n\n## [2026-09-01] ingest | A\n");
    await expect(fatiarLog(w)).rejects.toThrow("header sem data parseável na linha 1: ## Introdução");
  });
});

describe("fatiar-log: entradas ausentes", () => {
  test("Dado uma wiki sem log.md, Quando fatio, Então reprova dizendo que o arquivo não existe", async () => {
    const r = await capturar(() => comandoFatiarLog([join(tmp, "inexistente")]));
    expect(r.codigo).toBe(1);
    expect(r.erro.join("\n")).toBe(`ERRO: ${join(tmp, "inexistente", "log.md")} não existe`);
  });

  test("Dado log.md como pasta, Quando fatio, Então reprova como se não existisse", async () => {
    mkdirSync(join(tmp, "estranha", "log.md"), { recursive: true });
    await expect(fatiarLog(join(tmp, "estranha"))).rejects.toThrow("não existe");
  });

  test("Dado um log.md só com prosa, Quando fatio, Então reprova e não cria log/", async () => {
    const zerada = join(tmp, "zerada");
    mkdirSync(zerada);
    writeFileSync(join(zerada, "log.md"), "# Log\n\nSo prosa, nenhuma entrada.\n");
    const r = await capturar(() => comandoFatiarLog([zerada]));
    expect(r.codigo).toBe(1);
    expect(r.erro.join("\n")).toContain("nenhuma entrada encontrada");
    expect(existsSync(join(zerada, "log"))).toBe(false);
  });
});

const semPermissaoDeSistema = process.platform === "win32" || process.getuid?.() === 0;

describe("fatiar-log: entrada ilegível ou fora do padrão", () => {
  function diasGravados(): string[] {
    return readdirSync(join(wiki, "log")).filter((n) => /^log-.*\.md$/.test(n));
  }

  test("Dado um log.md em Latin-1 que não é UTF-8 válido, Quando fatio, Então reprova com saída 1 nomeando o arquivo e nenhum arquivo de dia é gravado", async () => {
    writeFileSync(join(wiki, "log.md"), Buffer.from("## [2026-09-01] ingest | Coração\n\nCorpo.\n", "latin1"));
    const r = await capturar(() => comandoFatiarLog([wiki]));
    expect(r.codigo).toBe(1);
    expect(r.erro).toEqual([`ERRO: ${join(wiki, "log.md")} não é UTF-8 válido`]);
    expect(diasGravados()).toEqual([]);
  });

  test("Dado um log.md com BOM antes do primeiro header, Quando fatio, Então segue o original: o BOM não é descartado e não há entrada", async () => {
    writeFileSync(join(wiki, "log.md"), "\uFEFF## [2026-09-01] ingest | A\n\nCorpo.\n");
    const r = await capturar(() => comandoFatiarLog([wiki]));
    expect(r.codigo).toBe(1);
    expect(r.erro.join("\n")).toContain("nenhuma entrada encontrada");
  });

  test.skipIf(process.platform === "win32")(
    "Dado um destino que é symlink pendurado (pulado no Windows: criar symlink exige privilégio), Quando fatio, Então aborta antes de escrever qualquer arquivo",
    async () => {
      writeFileSync(join(wiki, "log.md"), LOG);
      symlinkSync(join("..", "alvo-fora.md"), join(wiki, "log", "log-2026-09-02.md"));
      const r = await capturar(() => comandoFatiarLog([wiki]));
      expect(r.codigo).toBe(1);
      expect(r.erro.join("\n")).toContain(
        `destino já existe, nada foi escrito (migração one-shot): ${join(wiki, "log", "log-2026-09-02.md")}`,
      );
      expect(existsSync(join(wiki, "log", "log-2026-09-01.md"))).toBe(false);
      expect(existsSync(join(tmp, "alvo-fora.md"))).toBe(false);
    },
  );

  test.skipIf(semPermissaoDeSistema)(
    "Dado uma pasta log/ sem permissão de escrita (pulado no Windows e como root), Quando fatio, Então o erro de escrita vira ERRO em voz alta, sem stack trace",
    async () => {
      writeFileSync(join(wiki, "log.md"), LOG);
      chmodSync(join(wiki, "log"), 0o555);
      try {
        const r = await capturar(() => comandoFatiarLog([wiki]));
        expect(r.codigo).toBe(1);
        expect(r.erro).toHaveLength(1);
        expect(r.erro[0]).toContain(`ERRO: não foi possível gravar ${join(wiki, "log", "log-2026-09-01.md")}`);
        expect(r.erro[0]).toContain("já gravados: nenhum");
      } finally {
        chmodSync(join(wiki, "log"), 0o755);
      }
    },
  );

  test.skipIf(semPermissaoDeSistema)(
    "Dado uma wiki sem permissão de leitura (pulado no Windows e como root), Quando fatio, Então reprova nomeando o caminho e não diz que o arquivo não existe",
    async () => {
      writeFileSync(join(wiki, "log.md"), LOG);
      chmodSync(wiki, 0o000);
      try {
        const r = await capturar(() => comandoFatiarLog([wiki]));
        expect(r.codigo).toBe(1);
        expect(r.erro[0]).toContain(`ERRO: não foi possível acessar ${join(wiki, "log.md")}`);
        expect(r.erro[0]).toContain("EACCES");
        expect(r.erro[0]).not.toContain("não existe");
      } finally {
        chmodSync(wiki, 0o755);
      }
    },
  );

  test.skipIf(semPermissaoDeSistema)(
    "Dado um log.md sem permissão de leitura (pulado no Windows e como root), Quando fatio, Então reprova nomeando o arquivo e nenhum arquivo de dia é gravado",
    async () => {
      writeFileSync(join(wiki, "log.md"), LOG);
      chmodSync(join(wiki, "log.md"), 0o000);
      try {
        const r = await capturar(() => comandoFatiarLog([wiki]));
        expect(r.codigo).toBe(1);
        expect(r.erro).toEqual([`ERRO: não foi possível ler ${join(wiki, "log.md")}: EACCES`]);
        expect(diasGravados()).toEqual([]);
      } finally {
        chmodSync(join(wiki, "log.md"), 0o644);
      }
    },
  );

  test("Dado um log.md com CR solto como fim de linha, Quando fatio, Então fatia como o original (newline universal)", async () => {
    const w = novaWiki("cr", "# Log\r\r## [2026-09-01] ingest | A\rcorpo A\r\r## [2026-09-02] nota | B\rcorpo B\r");
    const r = await capturar(() => comandoFatiarLog([w]));
    expect(r.codigo).toBe(0);
    expect(r.saida[0]).toBe(`OK: 2 entradas → 2 arquivos em ${join(w, "log")}`);
    expect(r.saida[1]).toContain("AVISO: 1 linha(s) de preâmbulo");
    expect(lerDia("2026-09-01", w)).toBe(
      "---\ntype: log-day\ndate: 2026-09-01\n---\n\n# Log — 2026-09-01\n\n## [2026-09-01] ingest | A\ncorpo A\n",
    );
  });
});

describe("subcomando fatiar-log", () => {
  test("Dado a tabela de subcomandos, Quando listo, Então fatiar-log está registrado", () => {
    expect(Object.keys(subcomandos)).toContain("fatiar-log");
  });

  test("Dado fatiar-log pelo executar, Quando rodo numa wiki válida, Então devolve 0", async () => {
    writeFileSync(join(wiki, "log.md"), LOG);
    const r = await capturar(() => executar(["fatiar-log", wiki]));
    expect(r.codigo).toBe(0);
    expect(existsSync(join(wiki, "log", "log-2026-09-03.md"))).toBe(true);
  });

  test("Dado --help, Quando rodo fatiar-log, Então mostra o uso e devolve 2 sem tratar como caminho", async () => {
    const r = await capturar(() => comandoFatiarLog(["--help"]));
    expect(r.codigo).toBe(2);
    expect(r.erro.join("\n")).toContain("Uso: anvilore fatiar-log [WIKI]");
  });

  test("Dado nenhum argumento, Quando rodo fatiar-log, Então usa ./wiki a partir do diretório atual", async () => {
    const original = process.cwd();
    const raiz = join(tmp, "projeto");
    mkdirSync(join(raiz, "wiki"), { recursive: true });
    writeFileSync(join(raiz, "wiki", "log.md"), "## [2026-09-01] ingest | A\n\nCorpo.\n");
    process.chdir(raiz);
    try {
      const r = await capturar(() => comandoFatiarLog([]));
      expect(r.codigo).toBe(0);
      expect(existsSync(join(raiz, "wiki", "log", "log-2026-09-01.md"))).toBe(true);
    } finally {
      process.chdir(original);
    }
  });
});

describe("fatiar-log: atribuição", () => {
  test("Dado o módulo derivado do wiki-wonka, Quando leio o fim do arquivo, Então o rodapé de atribuição MIT está nas últimas linhas", () => {
    const fim = readFileSync(join(import.meta.dir, "..", "src", "comandos", "fatiar-log.ts"), "utf8")
      .trimEnd()
      .split("\n")
      .slice(-6)
      .join("\n");
    for (const elemento of ["https://github.com/cooperacode/wiki-wonka", "Coopera Code", "licença MIT", "LICENSE"]) {
      expect(fim).toContain(elemento);
    }
  });
});
