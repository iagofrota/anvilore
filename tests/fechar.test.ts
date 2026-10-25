import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import * as validar from "../src/comandos/validar";
import { comandoFechar, fecharWiki } from "../src/comandos/fechar";
import { executar, subcomandos } from "../src/cli";
import { comandoInit } from "../src/comandos/init";

let tmp: string;
const semLink = process.platform === "win32";
const semPermissao = process.platform === "win32" || process.getuid?.() === 0;

function dataLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const AGORA = new Date();
const HOJE = dataLocal(AGORA);

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "anvilore-fechar-"));
  delete process.env.ANVILORE_PULAR_GATE_LOG;
});
afterEach(() => {
  delete process.env.ANVILORE_PULAR_GATE_LOG;
  rmSync(tmp, { recursive: true, force: true });
});

function gravar(raiz: string, relativo: string, conteudo: string): string {
  const caminho = join(raiz, relativo);
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, conteudo);
  return caminho;
}

function hashDe(caminho: string): string {
  return existsSync(caminho) ? createHash("sha256").update(readFileSync(caminho)).digest("hex") : "AUSENTE";
}

// Wiki sintética íntegra, com log do dia.
function montarWiki(nome: string, hoje: string = HOJE): string {
  const w = join(tmp, nome);
  gravar(w, "alfa/concepts/conceito.md", '---\ntitle: "Conceito"\nslug: conceito\ntype: concept\narea: alfa\ntags: []\n---\n\nCorpo.\n');
  gravar(w, "alfa/sources/fonte.md", '---\ntitle: "Fonte"\nslug: fonte\ntype: source\narea: alfa\ntags: []\n---\n\nCorpo.\n');
  mkdirSync(join(w, "_meta"), { recursive: true });
  gravar(w, "index.md", "# Indice\n\nPaginas desta wiki.\n\n- [[conceito]]\n- [[fonte]]\n");
  gravar(w, "log.md", "# Log\n");
  gravar(
    w,
    `log/log-${hoje}.md`,
    `---\ntype: log-day\ndate: ${hoje}\n---\n\n# Log — ${hoje}\n\n## [${hoje}] ingest | Fechamento do dia\n\nCorpo.\n`,
  );
  return w;
}

function definirMtime(caminho: string, quando: Date): void {
  utimesSync(caminho, quando, quando);
}

function gitEm(dir: string, ...args: string[]): void {
  const r = Bun.spawnSync(["git", "-c", "core.autocrlf=false", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(String(r.stderr));
}

function clonarEsqueleto(): string {
  const origem = join(tmp, "origem");
  gravar(origem, ".gitignore", "wiki/**\n");
  gravar(origem, "wiki/exemplo/concepts/conceito.md", '---\ntitle: Conceito\nslug: conceito\ntype: concept\narea: exemplo\ntags: []\n---\n\nCorpo do esqueleto.\n');
  gravar(origem, "wiki/index.md", "# Índice\n\n- [[conceito]]\n");
  gitEm(origem, "init", "-q");
  gitEm(origem, "add", ".gitignore");
  gitEm(origem, "add", "-f", "wiki");
  gitEm(origem, "-c", "user.name=Teste", "-c", "user.email=teste@exemplo", "commit", "-qm", "fixture");
  const clone = join(tmp, "clone");
  gitEm(tmp, "clone", "--quiet", "--no-hardlinks", origem, clone);
  return clone;
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
    const valor = await corpo();
    return { valor, saida: saida.join("\n"), linhas: saida, erro: erro.join("\n") };
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
}

describe("fechar: wiki íntegra com log do dia", () => {
  test("Dado uma wiki íntegra com log do dia, Quando fecho, Então os 4 passos rodam e o ritual fecha com ok", async () => {
    const w = montarWiki("integra");
    const r = await capturar(() => fecharWiki(w));
    expect(r.valor.ok).toBe(true);
    for (const n of [1, 2, 3, 4]) expect(r.saida).toContain(`${n}/4`);
    expect(r.saida).toContain("FECHAMENTO: OK");
    expect(r.saida).toContain(`log do dia presente: ${join(w, "log", `log-${HOJE}.md`)}`);
  });

  test("Dado uma wiki íntegra, Quando fecho pelo comando, Então devolve 0", async () => {
    const w = montarWiki("integra");
    const r = await capturar(() => comandoFechar([w]));
    expect(r.valor).toBe(0);
    expect(r.saida).toContain("FECHAMENTO: OK");
  });

  test("Dado uma wiki íntegra, Quando fecho, Então cada passo é anunciado numa linha própria depois de uma linha em branco", async () => {
    const w = montarWiki("integra");
    const r = await capturar(() => fecharWiki(w));
    const i = r.linhas.indexOf("── 1/4 sincronizar-indice ──");
    expect(i).toBeGreaterThan(0);
    expect(r.linhas[i - 1]).toBe("");
    expect(r.linhas).toContain("── 2/4 indexar-log ──");
    expect(r.linhas).toContain("── 3/4 validar-wiki ──");
    expect(r.linhas).toContain("── 4/4 gate do log do dia ──");
  });

  test("Dado a wiki dada com caminho relativo, Quando fecho, Então ela é resolvida a partir do diretório atual", async () => {
    montarWiki("integra");
    const original = process.cwd();
    process.chdir(tmp);
    try {
      const r = await capturar(() => fecharWiki("integra"));
      expect(r.valor.ok).toBe(true);
    } finally {
      process.chdir(original);
    }
  });

  test("Dado nenhum argumento, Quando fecho pelo comando, Então usa ./wiki a partir do diretório atual", async () => {
    montarWiki("wiki");
    const original = process.cwd();
    process.chdir(tmp);
    try {
      const r = await capturar(() => comandoFechar([]));
      expect(r.valor).toBe(0);
    } finally {
      process.chdir(original);
    }
  });
});

describe("fechar: para no primeiro passo que falha", () => {
  test("Dado o passo 1 quebrado, Quando fecho, Então reprova nomeando sincronizar-indice e o passo 2 não é anunciado nem roda", async () => {
    const w = montarWiki("passo1");
    gravar(w, "alfa/index.md", "# Indice — alfa\n\n_2 páginas — Última atualização: 2020-01-01_\n");
    const logAntes = hashDe(join(w, "log.md"));
    const r = await capturar(() => fecharWiki(w));
    expect(r.valor).toEqual({ ok: false, passo: "sincronizar-indice" });
    expect(r.saida).toContain("FECHAMENTO: FAIL no passo sincronizar-indice");
    expect(r.saida).not.toContain("2/4");
    // O side-effect ausente é a prova: o passo 2 reescreve log.md.
    expect(hashDe(join(w, "log.md"))).toBe(logAntes);
  });

  test("Dado o passo 1 consertado, Quando fecho de novo, Então o log.md muda (o side-effect tem dentes)", async () => {
    const w = montarWiki("passo1");
    gravar(w, "alfa/index.md", "# Indice — alfa\n\n_2 páginas — Última atualização: 2020-01-01_\n");
    const logAntes = hashDe(join(w, "log.md"));
    await capturar(() => fecharWiki(w));
    rmSync(join(w, "alfa", "index.md"));
    await capturar(() => fecharWiki(w));
    expect(hashDe(join(w, "log.md"))).not.toBe(logAntes);
  });

  test("Dado o passo 2 quebrado (log.md é uma pasta), Quando fecho, Então reprova nomeando indexar-log e o passo 3 não é anunciado", async () => {
    const w = montarWiki("passo2");
    rmSync(join(w, "log.md"));
    mkdirSync(join(w, "log.md"));
    const r = await capturar(() => fecharWiki(w));
    expect(r.valor).toEqual({ ok: false, passo: "indexar-log" });
    expect(r.saida).toContain("2/4");
    expect(r.saida).toContain("FECHAMENTO: FAIL no passo indexar-log");
    expect(r.saida).not.toContain("3/4");
  });

  test("Dado o passo 3 quebrado (type inválido), Quando fecho, Então reprova nomeando validar-wiki e o passo 4 não é anunciado", async () => {
    const w = montarWiki("passo3");
    gravar(w, "alfa/concepts/torta.md", '---\ntitle: "Torta"\nslug: torta\ntype: inventado\narea: alfa\ntags: []\n---\n\nCorpo.\n');
    const r = await capturar(() => fecharWiki(w));
    expect(r.valor).toEqual({ ok: false, passo: "validar-wiki" });
    expect(r.saida).toContain("3/4");
    expect(r.saida).not.toContain("4/4");
    expect(r.saida).toContain("FECHAMENTO: FAIL no passo validar-wiki");
    expect(r.saida).toContain("VALIDACAO: FAIL");
  });

  test("Dado o comando e o passo 3 quebrado, Quando fecho, Então o código de saída é 1", async () => {
    const w = montarWiki("passo3");
    gravar(w, "alfa/concepts/torta.md", "sem frontmatter\n");
    expect((await capturar(() => comandoFechar([w]))).valor).toBe(1);
  });

  test("Dado um passo que lança exceção, Quando fecho, Então vira falha em voz alta do passo, sem stack trace", async () => {
    const w = montarWiki("lanca");
    const espiao = spyOn(validar, "comandoValidar").mockRejectedValue(new Error("explodiu"));
    try {
      const r = await capturar(() => fecharWiki(w));
      expect(r.valor).toEqual({ ok: false, passo: "validar-wiki" });
      expect(r.erro).toBe("FAIL: explodiu");
      expect(r.saida).toContain("FECHAMENTO: FAIL no passo validar-wiki");
    } finally {
      espiao.mockRestore();
    }
  });
});

describe("fechar: raiz inexistente", () => {
  test("Dado uma raiz de wiki que não existe, Quando fecho, Então reprova com o token FECHAMENTO: FAIL e nenhum passo roda", async () => {
    const r = await capturar(() => fecharWiki(join(tmp, "inexistente")));
    expect(r.valor).toEqual({ ok: false, passo: "raiz-da-wiki" });
    expect(r.saida).toBe(`FECHAMENTO: FAIL — raiz da wiki nao encontrada: ${join(tmp, "inexistente")}`);
  });

  test("Dado uma raiz de wiki que é um arquivo, Quando fecho pelo comando, Então devolve 1", async () => {
    gravar(tmp, "arquivo", "x");
    const r = await capturar(() => comandoFechar([join(tmp, "arquivo")]));
    expect(r.valor).toBe(1);
    expect(r.saida).toContain("FECHAMENTO: FAIL — raiz da wiki nao encontrada");
  });
});

describe("fechar: gate do log do dia", () => {
  test("Dado clone novo com esqueleto rastreado Quando faço init e fecho Então não cobra log pelo mtime do checkout", async () => {
    const clone = clonarEsqueleto();
    expect((await capturar(() => comandoInit(["--areas", "pessoal"], { raiz: clone, interativo: false }))).valor).toBe(0);
    const r = await capturar(() => fecharWiki(join(clone, "wiki")));
    expect(r.valor.ok).toBe(true);
    expect(r.saida).toContain("nenhuma pagina curada alterada hoje");
    expect(existsSync(join(clone, "wiki/log", `log-${HOJE}.md`))).toBe(false);

    gravar(clone, "wiki/exemplo/concepts/conceito.md", readFileSync(join(clone, "wiki/exemplo/concepts/conceito.md"), "utf8") + "\nEdição de hoje.\n");
    expect((await capturar(() => fecharWiki(join(clone, "wiki")))).valor.ok).toBe(false);
    gitEm(clone, "add", "-f", "wiki/exemplo/concepts/conceito.md");
    expect((await capturar(() => fecharWiki(join(clone, "wiki")))).valor.ok).toBe(false);
  });

  test("Dado esqueleto limpo e página nova ignorada pelo Git Quando fecho Então cobra só a página nova e o log destrava", async () => {
    const clone = clonarEsqueleto();
    const w = join(clone, "wiki");
    const limpa = await capturar(() => fecharWiki(w));
    expect(limpa.valor.ok).toBe(true);
    gravar(w, "exemplo/concepts/nova.md", '---\ntitle: Nova\nslug: nova\ntype: concept\narea: exemplo\ntags: []\n---\n\nPágina nova.\n');
    gravar(w, "index.md", "# Índice\n\n- [[conceito]]\n- [[nova]]\n");
    const r = await capturar(() => fecharWiki(w));
    expect(r.valor).toEqual({ ok: false, passo: "gate-do-log" });
    expect(r.saida).toContain(join("exemplo", "concepts", "nova.md"));
    expect(r.saida).not.toContain(`  - ${join("exemplo", "concepts", "conceito.md")}`);
    gravar(w, `log/log-${HOJE}.md`, `## [${HOJE}] ingest | Página nova\n`);
    expect((await capturar(() => fecharWiki(w))).valor.ok).toBe(true);
  });

  function semLogDoDia(nome: string): string {
    const w = montarWiki(nome);
    rmSync(join(w, "log", `log-${HOJE}.md`));
    gravar(w, "log/log-2020-01-01.md", "---\ntype: log-day\ndate: 2020-01-01\n---\n\n# Log — 2020-01-01\n\n## [2020-01-01] nota | Antiga\n");
    return w;
  }

  test("Dado página curada alterada hoje e nenhuma entrada do dia, Quando fecho, Então o gate reprova dizendo o arquivo de log, a página e como resolver", async () => {
    const w = semLogDoDia("semlog");
    const r = await capturar(() => fecharWiki(w));
    expect(r.valor).toEqual({ ok: false, passo: "gate-do-log" });
    expect(r.saida).toContain(`FAIL: paginas curadas alteradas hoje sem entrada em log/log-${HOJE}.md:`);
    expect(r.saida).toContain(`  - ${join("alfa", "concepts", "conceito.md")}`);
    expect(r.saida).toContain(`Escreva a entrada no formato '## [${HOJE}] <tipo> | <o que mudou>' e rode de novo.`);
    expect(r.saida).toContain("(ou ANVILORE_PULAR_GATE_LOG=1 para pular conscientemente)");
    expect(r.linhas.at(-1)).toBe("FECHAMENTO: FAIL");
  });

  test("Dado o gate reprovando, Quando fecho pelo comando, Então o código de saída é 1", async () => {
    const w = semLogDoDia("semlog");
    expect((await capturar(() => comandoFechar([w]))).valor).toBe(1);
  });

  test("Dado o gate reprovando, Quando fecho, Então ele ignora index.md, log.md e os diretórios reservados _meta/ e log/", async () => {
    const w = semLogDoDia("semlog");
    gravar(w, "_meta/lacunas.md", "gerado\n");
    const r = await capturar(() => fecharWiki(w));
    expect(r.saida).not.toMatch(/^ {2}- (index|log)\.md$/m);
    expect(r.saida).not.toMatch(/^ {2}- (_meta|log)[\\/]/m);
    expect(r.saida).toContain("conceito.md");
  });

  test("Dado só index.md e log.md novos em subpastas e as páginas curadas antigas, Quando fecho, Então o gate ignora os derivados e não cobra nada", async () => {
    const w = semLogDoDia("derivados");
    const ontem = new Date(AGORA.getTime() - 3 * 24 * 3600 * 1000);
    definirMtime(join(w, "alfa", "concepts", "conceito.md"), ontem);
    definirMtime(join(w, "alfa", "sources", "fonte.md"), ontem);
    gravar(w, "alfa/sub/log.md", "x\n");
    const r = await capturar(() => fecharWiki(w));
    expect(r.saida).toContain("nada a cobrar");
  });

  test("Dado a entrada do dia escrita, Quando fecho de novo, Então o gate destrava (o gate tem dentes)", async () => {
    const w = semLogDoDia("semlog");
    expect((await capturar(() => fecharWiki(w))).valor.ok).toBe(false);
    gravar(w, `log/log-${HOJE}.md`, `---\ntype: log-day\ndate: ${HOJE}\n---\n\n# Log — ${HOJE}\n\n## [${HOJE}] ingest | Entrada escrita agora\n`);
    expect((await capturar(() => fecharWiki(w))).valor).toEqual({ ok: true, passo: "gate-do-log" });
  });

  test("Dado um arquivo de log do dia sem a linha de entrada, Quando fecho, Então o gate reprova mesmo com o arquivo existindo", async () => {
    const w = semLogDoDia("semlog");
    gravar(w, `log/log-${HOJE}.md`, "# Log\n\nNada aqui.\n");
    expect((await capturar(() => fecharWiki(w))).valor.passo).toBe("gate-do-log");
  });

  test("Dado um log do dia com fim de linha CRLF, Quando fecho, Então a entrada é reconhecida", async () => {
    const w = semLogDoDia("semlog");
    gravar(w, `log/log-${HOJE}.md`, `## [${HOJE}] ingest | Entrada\r\n\r\nCorpo.\r\n`);
    expect((await capturar(() => fecharWiki(w))).valor.ok).toBe(true);
  });

  test("Dado nenhuma página curada alterada hoje, Quando fecho, Então o gate diz que não há o que cobrar e fecha", async () => {
    const w = semLogDoDia("antiga");
    const ontem = new Date(AGORA.getTime() - 3 * 24 * 3600 * 1000);
    definirMtime(join(w, "alfa", "concepts", "conceito.md"), ontem);
    definirMtime(join(w, "alfa", "sources", "fonte.md"), ontem);
    const r = await capturar(() => fecharWiki(w));
    expect(r.valor.ok).toBe(true);
    expect(r.saida).toContain("nenhuma pagina curada alterada hoje — nada a cobrar");
  });

  test("Dado o relógio fixado, Quando comparo com a meia-noite local, Então 1s depois da meia-noite conta como hoje e 1s antes não", async () => {
    const agora = new Date(2026, 5, 15, 15, 30, 0);
    const meiaNoite = new Date(2026, 5, 15, 0, 0, 0);
    const w = montarWiki("relogio", "2026-06-15");
    rmSync(join(w, "log", "log-2026-06-15.md"));
    gravar(w, "log/log-2020-01-01.md", "## [2020-01-01] nota | Antiga\n");
    definirMtime(join(w, "alfa", "sources", "fonte.md"), new Date(meiaNoite.getTime() - 1000));
    definirMtime(join(w, "alfa", "concepts", "conceito.md"), new Date(meiaNoite.getTime() + 1000));
    const r = await capturar(() => fecharWiki(w, { agora }));
    expect(r.valor.passo).toBe("gate-do-log");
    expect(r.saida).toContain("FAIL: paginas curadas alteradas hoje sem entrada em log/log-2026-06-15.md:");
    expect(r.saida).toContain(`  - ${join("alfa", "concepts", "conceito.md")}`);
    expect(r.saida).not.toContain("fonte.md");
  });

  test("Dado exatamente a meia-noite local, Quando comparo, Então não conta como hoje (estritamente depois, como o find -newermt)", async () => {
    const agora = new Date(2026, 5, 15, 15, 30, 0);
    const w = montarWiki("exata", "2026-06-15");
    rmSync(join(w, "log", "log-2026-06-15.md"));
    const meiaNoite = new Date(2026, 5, 15, 0, 0, 0);
    definirMtime(join(w, "alfa", "sources", "fonte.md"), meiaNoite);
    definirMtime(join(w, "alfa", "concepts", "conceito.md"), meiaNoite);
    const r = await capturar(() => fecharWiki(w, { agora }));
    expect(r.valor.ok).toBe(true);
    expect(r.saida).toContain("nada a cobrar");
  });

  test("Dado páginas curadas alteradas hoje, Quando o gate lista, Então a ordem é alfabética", async () => {
    const w = semLogDoDia("ordem");
    gravar(w, "alfa/concepts/a-primeiro.md", '---\ntitle: "A"\nslug: a-primeiro\ntype: concept\narea: alfa\ntags: []\n---\n\nCorpo.\n');
    gravar(w, "index.md", "# Indice\n\n- [[conceito]]\n- [[fonte]]\n- [[a-primeiro]]\n");
    const r = await capturar(() => fecharWiki(w));
    const itens = r.linhas.filter((l) => l.startsWith("  - "));
    expect(itens).toEqual([...itens].sort());
    expect(itens.length).toBe(3);
  });

  test.skipIf(semLink)(
    "Dado uma página curada que é symlink para arquivo alterado hoje (pulado no Windows: criar symlink exige privilégio), Quando fecho, Então o link é seguido e conta",
    async () => {
      const w = semLogDoDia("link");
      const ontem = new Date(AGORA.getTime() - 3 * 24 * 3600 * 1000);
      definirMtime(join(w, "alfa", "concepts", "conceito.md"), ontem);
      definirMtime(join(w, "alfa", "sources", "fonte.md"), ontem);
      gravar(tmp, "fora/alvo.md", "x\n");
      symlinkSync(join(tmp, "fora", "alvo.md"), join(w, "alfa", "concepts", "via-link.md"));
      const r = await capturar(() => fecharWiki(w));
      expect(r.saida).toContain(`  - ${join("alfa", "concepts", "via-link.md")}`);
    },
  );

  test.skipIf(semLink)(
    "Dado uma página que é link quebrado (pulado no Windows), Quando fecho, Então avisa em stderr nomeando o caminho e segue",
    async () => {
      const w = montarWiki("quebrado");
      symlinkSync("nao-existe.md", join(w, "alfa", "quebrada.md"));
      const r = await capturar(() => fecharWiki(w));
      expect(r.erro).toContain(`AVISO: symlink quebrado: ${join(w, "alfa", "quebrada.md")}`);
      expect(r.valor.passo).toBe("gate-do-log");
    },
  );

  test.skipIf(semLink)(
    "Dado um diretório que é symlink (pulado no Windows), Quando fecho, Então não é descido e avisa",
    async () => {
      const w = montarWiki("dirlink");
      mkdirSync(join(tmp, "fora"));
      gravar(tmp, "fora/de-fora.md", "x\n");
      symlinkSync(join(tmp, "fora"), join(w, "alfa", "apelido"));
      const r = await capturar(() => fecharWiki(w));
      expect(r.erro).toContain(`AVISO: symlink de diretório não seguido: ${join(w, "alfa", "apelido")}`);
      expect(r.saida).not.toContain("de-fora.md");
    },
  );

  test.skipIf(semPermissao || semLink)(
    "Dado um symlink cujo alvo está numa pasta ilegível (pulado no Windows e como root), Quando o gate varre, Então falha em voz alta em vez de fingir que não há nada",
    async () => {
      const w = montarWiki("ilegivel");
      gravar(tmp, "fechada/alvo.md", "x\n");
      symlinkSync(join(tmp, "fechada", "alvo.md"), join(w, "alfa", "via-pasta-fechada.md"));
      chmodSync(join(tmp, "fechada"), 0o000);
      try {
        const r = await capturar(() => fecharWiki(w));
        expect(r.valor.ok).toBe(false);
        expect(r.erro).toContain("FAIL:");
        expect(r.saida).toMatch(/FECHAMENTO: FAIL no passo (gate-do-log|validar-wiki)/);
      } finally {
        chmodSync(join(tmp, "fechada"), 0o755);
      }
    },
  );
});

describe("fechar: escape explícito do gate", () => {
  test("Dado ANVILORE_PULAR_GATE_LOG=1 e nenhuma entrada do dia, Quando fecho, Então o gate é pulado, avisando", async () => {
    const w = montarWiki("escape");
    rmSync(join(w, "log", `log-${HOJE}.md`));
    process.env.ANVILORE_PULAR_GATE_LOG = "1";
    const r = await capturar(() => fecharWiki(w));
    expect(r.valor).toEqual({ ok: true, passo: "gate-do-log" });
    expect(r.saida).toContain("gate pulado por ANVILORE_PULAR_GATE_LOG=1");
    expect(r.saida).toContain("FECHAMENTO: OK");
  });

  test("Dado ANVILORE_PULAR_GATE_LOG com outro valor, Quando fecho, Então o gate roda", async () => {
    const w = montarWiki("escape");
    rmSync(join(w, "log", `log-${HOJE}.md`));
    process.env.ANVILORE_PULAR_GATE_LOG = "0";
    expect((await capturar(() => fecharWiki(w))).valor.passo).toBe("gate-do-log");
  });

  test("Dado o escape do gate e a validação quebrada, Quando fecho, Então o escape não pula a validação", async () => {
    const w = montarWiki("escape");
    gravar(w, "alfa/concepts/torta.md", '---\ntitle: "Torta"\nslug: torta\ntype: inventado\ntags: []\n---\n');
    process.env.ANVILORE_PULAR_GATE_LOG = "1";
    expect((await capturar(() => fecharWiki(w))).valor).toEqual({ ok: false, passo: "validar-wiki" });
  });
});

describe("fechar: a wiki versionada do repositório", () => {
  test("Dado uma cópia da wiki do repositório, Quando fecho com o gate pulado, Então fecha e deixa os arquivos como estavam", async () => {
    const copia = join(tmp, "wiki");
    cpSync(join(import.meta.dir, "..", "wiki"), copia, { recursive: true });
    const antes = arvore(copia);
    process.env.ANVILORE_PULAR_GATE_LOG = "1";
    const r = await capturar(() => fecharWiki(copia));
    expect(r.valor.ok).toBe(true);
    expect(arvore(copia)).toEqual(antes);
  });

  function arvore(raiz: string): Record<string, string> {
    const mapa: Record<string, string> = {};
    const visitar = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const c = join(dir, e.name);
        if (e.isDirectory()) visitar(c);
        else mapa[relative(raiz, c)] = hashDe(c);
      }
    };
    visitar(raiz);
    return mapa;
  }
});

describe("subcomando fechar", () => {
  test("Dado a tabela de subcomandos, Quando listo, Então fechar está registrado", () => {
    expect(Object.keys(subcomandos)).toContain("fechar");
  });

  test("Dado fechar pelo executar, Quando rodo numa wiki íntegra, Então devolve 0", async () => {
    const w = montarWiki("integra");
    expect((await capturar(() => executar(["fechar", w]))).valor).toBe(0);
  });

  test("Dado --help, Quando rodo fechar, Então mostra o uso e devolve 0 sem tratar como caminho", async () => {
    const r = await capturar(() => comandoFechar(["--help"]));
    expect(r.valor).toBe(0);
    expect(r.erro).toContain("Uso: anvilore fechar [WIKI]");
    expect(r.saida).toBe("");
  });

  test("Dado -h, Quando rodo fechar, Então também mostra o uso e devolve 0", async () => {
    expect((await capturar(() => comandoFechar(["-h"]))).valor).toBe(0);
  });
});

describe("fechar: atribuição", () => {
  test("Dado o módulo derivado do wiki-wonka, Quando leio o fim do arquivo, Então o rodapé de atribuição MIT está nas últimas linhas", () => {
    const fim = readFileSync(join(import.meta.dir, "..", "src", "comandos", "fechar.ts"), "utf8")
      .trimEnd()
      .split("\n")
      .slice(-6)
      .join("\n");
    for (const elemento of ["https://github.com/cooperacode/wiki-wonka", "Coopera Code", "licença MIT", "LICENSE"]) {
      expect(fim).toContain(elemento);
    }
  });
});
