import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { comandoBaseline, conferirBaseline } from "../src/comandos/baseline";
import { classificarRecurso, validarRecurso } from "../src/lib/okf";
import { executar, subcomandos } from "../src/cli";

const TABELA = join(import.meta.dir, "..", "scripts", "resource-baseline.tsv");
const VERSIONADA = readFileSync(TABELA, "utf8");
const CANARIOS = [
  "raw/reunioes/notas de reuniao.md",
  "wiki/_meta/arquivo com espaco.md",
  "raw/2026 Q3/notas.md",
  "raw/notas do dia",
];

let pasta: string;
let tsv: string;

// Grava uma variação da tabela versionada e devolve o caminho.
function variacao(transformar: (texto: string) => string): string {
  writeFileSync(tsv, transformar(VERSIONADA));
  return tsv;
}

function semLinha(texto: string, valor: string): string {
  return texto.split("\n").filter((l) => !l.split("\t")[1]?.startsWith(valor)).join("\n");
}

function trocarVeredito(texto: string, valor: string, de: string, para: string): string {
  return texto.replace(`${de}\t${valor}\t`, `${para}\t${valor}\t`);
}

async function capturar(acao: () => Promise<number>) {
  const saida: string[] = [];
  const erro: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...args) => { saida.push(args.join(" ")); });
  const err = spyOn(console, "error").mockImplementation((...args) => { erro.push(args.join(" ")); });
  try {
    return { codigo: await acao(), saida, erro };
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
}

beforeEach(() => {
  pasta = mkdtempSync(join(tmpdir(), "anvilore-baseline-cmd-"));
  tsv = join(pasta, "baseline.tsv");
});
afterEach(() => rmSync(pasta, { recursive: true, force: true }));

describe("fase 1: regressão contra a tabela", () => {
  test("Dado um valor fail que passou a passar, Quando confiro, Então acusa AFROUXADO com a linha da tabela", async () => {
    const r = await conferirBaseline(variacao((t) => trocarVeredito(t, "raw/existe-okf.md", "pass", "fail")));
    expect(r.ok).toBe(false);
    expect(r.divergencias).toHaveLength(1);
    expect(r.divergencias[0]).toMatch(new RegExp(`^AFROUXADO: "raw/existe-okf.md" — baseline: fail \\(${tsv.replace(/[\\.]/g, "\\$&")}:\\d+: .*obtido: pass\\)$`));
  });

  test("Dado um valor pass que passou a falhar, Quando confiro, Então acusa APERTADO", async () => {
    const r = await conferirBaseline(variacao((t) => trocarVeredito(t, "raw/x.md", "fail", "pass")));
    expect(r.ok).toBe(false);
    expect(r.divergencias).toHaveLength(1);
    expect(r.divergencias[0]).toMatch(/^APERTADO: "raw\/x.md" — baseline: pass \(.*:\d+: .*obtido: fail\)$/);
    expect(r.relato.join("\n")).toMatch(/FASE1: FAIL — 0 afrouxado\(s\), 1 apertado\(s\), 0 com erro/);
  });

  test("Dado um validador que lança exceção, Quando confiro, Então a exceção é veredito ERRO e não derruba a conferência", async () => {
    const r = await conferirBaseline(TABELA, { validar: () => { throw new TypeError("quebrou"); } });
    expect(r.ok).toBe(false);
    expect(r.divergencias.some((d) => d.startsWith('ERRO: "raw/x.md"') && d.includes("obtido: erro:TypeError"))).toBe(true);
    expect(r.relato.join("\n")).toMatch(/FASE1: FAIL — 0 afrouxado\(s\), 0 apertado\(s\), \d+ com erro/);
  });

  test("Dado o defeito do espaço em branco decidindo antes da forma de caminho, Quando confiro, Então reprova nomeando os canários afrouxados", async () => {
    const comEspaco = (valor: string, raiz: string) => (classificarRecurso(valor) === "url" || /\s/.test(valor) ? true : validarRecurso(valor, raiz));
    const r = await conferirBaseline(TABELA, { validar: comEspaco });
    expect(r.ok).toBe(false);
    for (const canario of CANARIOS) expect(r.divergencias.some((d) => d.startsWith(`AFROUXADO: "${canario}"`))).toBe(true);
  });

  test("Dado um detector invertido, Quando confiro, Então toda linha diverge (a conferência tem dentes)", async () => {
    const r = await conferirBaseline(TABELA, { validar: (valor, raiz) => !validarRecurso(valor, raiz) });
    const linhas = VERSIONADA.split("\n").filter((l) => /^(pass|fail)\t/.test(l)).length;
    expect(r.ok).toBe(false);
    expect(r.divergencias.filter((d) => /^(AFROUXADO|APERTADO):/.test(d))).toHaveLength(linhas);
  });
});

describe("fase 2: canário de mutação", () => {
  test("Dado um mutante que não muda nada, Quando confiro, Então os quatro canários ficam sem detecção e reprova", async () => {
    const r = await conferirBaseline(TABELA, { mutar: (validar) => validar });
    expect(r.ok).toBe(false);
    expect(r.divergencias.filter((d) => d.startsWith("CANARIO NAO DETECTADO:"))).toEqual(CANARIOS.map((c) => `CANARIO NAO DETECTADO: "${c}"`));
    expect(r.relato.join("\n")).toContain("FASE2: FAIL — o detector não acusou 4 dos 4 canários; esta conferência não estaria pegando a regressão que já aconteceu");
  });

  test("Dado um mutante que afrouxa só um canário, Quando confiro, Então só os outros três ficam sem detecção", async () => {
    const r = await conferirBaseline(TABELA, { mutar: (validar) => (valor, raiz) => (valor === CANARIOS[0] ? true : validar(valor, raiz)) });
    expect(r.divergencias.filter((d) => d.startsWith("CANARIO NAO DETECTADO:"))).toHaveLength(3);
  });
});

describe("estrutura da tabela", () => {
  test("Dado um canário apagado da tabela, Quando confiro, Então a ESTRUTURA reprova e a fase 2 também", async () => {
    const r = await conferirBaseline(variacao((t) => semLinha(t, "raw/notas do dia")));
    expect(r.ok).toBe(false);
    expect(r.divergencias).toContain('ESTRUTURA: canário ausente da tabela: "raw/notas do dia" — é um dos quatro valores que regrediram de fato na rodada antiga e não pode sair de baseline.tsv.');
    expect(r.divergencias).toContain('CANARIO NAO DETECTADO: "raw/notas do dia"');
  });

  test("Dado um canário marcado pass, Quando confiro, Então a ESTRUTURA aponta a linha e o baseline que o reprova", async () => {
    const r = await conferirBaseline(variacao((t) => trocarVeredito(t, "raw/notas do dia", "fail", "pass")));
    expect(r.ok).toBe(false);
    expect(r.divergencias.some((d) => /^ESTRUTURA: canário "raw\/notas do dia" está marcado "pass" na linha \d+; o baseline o reprova\.$/.test(d))).toBe(true);
  });

  test("Dado a tabela encolhida abaixo do mínimo, Quando confiro, Então a ESTRUTURA reprova", async () => {
    const encolhida = [
      "@fixture\tfile\traw/existe-okf.md",
      ...CANARIOS.map((c) => `fail\t${c}\tcanário`),
    ].join("\n") + "\n";
    writeFileSync(tsv, encolhida);
    const r = await conferirBaseline(tsv);
    expect(r.ok).toBe(false);
    expect(r.divergencias[0]).toBe("ESTRUTURA: a tabela tem 4 valores, abaixo do mínimo 26. Encolher a tabela é regressão de cobertura.");
  });
});

describe("tabela ilegível ou fora do formato", () => {
  test("Dado um TSV ausente, Quando confiro, Então reprova nomeando o arquivo", async () => {
    const ausente = join(pasta, "nao-existe.tsv");
    const r = await conferirBaseline(ausente);
    expect(r.ok).toBe(false);
    expect(r.divergencias).toHaveLength(1);
    expect(r.divergencias[0]).toContain(`FAIL: não foi possível ler ${ausente}`);
  });

  test("Dado um TSV vazio, Quando confiro, Então reprova nomeando o arquivo", async () => {
    writeFileSync(tsv, "");
    const r = await conferirBaseline(tsv);
    expect(r).toMatchObject({ ok: false, divergencias: [`FAIL: ${tsv}: a tabela não tem nenhum valor`] });
  });

  test("Dado um TSV só com comentários e fixtures, Quando confiro, Então reprova como vazio", async () => {
    writeFileSync(tsv, "# nada\n@fixture\tdir\td\n");
    expect((await conferirBaseline(tsv)).divergencias).toEqual([`FAIL: ${tsv}: a tabela não tem nenhum valor`]);
  });

  test("Dado uma linha com coluna faltando, Quando confiro, Então a mensagem traz arquivo e linha", async () => {
    const r = await conferirBaseline(variacao((t) => `${t}fail\traw/sem-origem.md\n`));
    const linha = VERSIONADA.split("\n").length;
    expect(r).toMatchObject({ ok: false, divergencias: [`FAIL: ${tsv}:${linha}: esperadas 3 colunas separadas por TAB, vieram 2`] });
  });

  test.each([
    ["fail\traw/x.md\t \n", "coluna 3 (origem) vazia: todo valor carrega o motivo de estar aqui"],
    ["talvez\traw/x.md\tmotivo\n", 'coluna 1 tem de ser "pass" ou "fail", veio talvez'],
    ["fail\t\tmotivo\n", "coluna 2 (valor) vazia"],
    ["fail\ta.md\tm\nfail\ta.md\tm\n", "valor duplicado (já na linha 1): a.md"],
    ["@fixture\tfile\t../fora\n", "fixture tem de ser relativa e contida na raiz: ../fora"],
    ["@fixture\tfile\t/abs\n", "fixture tem de ser relativa e contida na raiz: /abs"],
    ["@fixture\tpipe\tx\n", '@fixture espera "@fixture<TAB>file|dir<TAB>caminho"'],
  ])("Dado a linha %j, Quando confiro, Então reprova com %j", async (conteudo, mensagem) => {
    writeFileSync(tsv, conteudo);
    const r = await conferirBaseline(tsv);
    expect(r.ok).toBe(false);
    expect(r.divergencias[0]).toMatch(/^FAIL: .*:\d+: /);
    expect(r.divergencias[0]).toContain(mensagem);
  });

  test("Dado comentários, linhas em branco e CRLF, Quando confiro, Então são ignorados e a tabela é lida", async () => {
    const r = await conferirBaseline(variacao((t) => `# nota\r\n\r\n${t.replaceAll("\n", "\r\n")}`));
    expect(r).toMatchObject({ ok: true, divergencias: [] });
  });
});

describe("subcomando baseline", () => {
  test("Dado nenhum argumento, Quando executo, Então confere a tabela versionada e sai 0", async () => {
    const r = await capturar(() => comandoBaseline([]));
    expect(r.codigo).toBe(0);
    expect(r.erro).toEqual([]);
    expect(r.saida.join("\n")).toContain("FASE1: PASS");
    expect(r.saida.join("\n")).toContain("FASE2: PASS");
  });

  test("Dado uma tabela com divergência, Quando executo pelo CLI, Então imprime o AFROUXADO com a linha e sai 1", async () => {
    const caminho = variacao((t) => trocarVeredito(t, "raw/existe-okf.md", "pass", "fail"));
    const r = await capturar(() => executar(["baseline", caminho]));
    expect(r.codigo).toBe(1);
    expect(r.saida.join("\n")).toMatch(/AFROUXADO: "raw\/existe-okf.md" — baseline: fail \(.*:\d+:/);
    expect(r.saida.join("\n")).toContain("FASE1: FAIL");
  });

  test("Dado um TSV ausente, Quando executo, Então a mensagem vai para stderr e sai 1", async () => {
    const ausente = join(pasta, "nao-existe.tsv");
    const r = await capturar(() => comandoBaseline([ausente]));
    expect(r.codigo).toBe(1);
    expect(r.saida).toEqual([]);
    expect(r.erro.join("\n")).toContain(`não foi possível ler ${ausente}`);
  });

  test("Dado --help, Quando executo, Então mostra o uso em stderr e sai 2", async () => {
    expect(await capturar(() => comandoBaseline(["--help"]))).toEqual({ codigo: 2, saida: [], erro: ["Uso: anvilore baseline [TSV]"] });
  });

  test("Dado dois caminhos ou opção desconhecida, Quando executo, Então reprova com o uso e sai 2", async () => {
    expect(await capturar(() => comandoBaseline([tsv, tsv]))).toEqual({ codigo: 2, saida: [], erro: ["Uso: anvilore baseline [TSV]"] });
    const r = await capturar(() => comandoBaseline(["--x"]));
    expect(r.codigo).toBe(2);
    expect(r.erro.join("\n")).toContain("--x");
  });

  test("Dado o CLI, Quando listo os subcomandos, Então baseline está registrado", () => {
    expect(Object.keys(subcomandos)).toContain("baseline");
  });
});
