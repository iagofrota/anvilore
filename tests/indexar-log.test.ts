import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexarLog, comandoIndexarLog } from "../src/comandos/indexar-log";
import { executar } from "../src/cli";

let temporario: string;
let wiki: string;

beforeEach(() => {
  temporario = mkdtempSync(join(tmpdir(), "anvilore-indexar-log-"));
  wiki = join(temporario, "wiki");
  mkdirSync(join(wiki, "log"), { recursive: true });
});

afterEach(() => rmSync(temporario, { recursive: true, force: true }));

function dia(data: string, conteudo: string): void {
  writeFileSync(join(wiki, "log", `log-${data}.md`), conteudo);
}

function montarDias(): void {
  dia("2026-09-01", "## [2026-09-01] ingest | Primeira fonte\n## [2026-09-01] nota | Observacao solta\n");
  dia("2026-09-02", "## [2026-09-02] ingest | Segunda fonte\n```markdown\n## [2026-09-02] ingest | Nao conta\n```\n");
  dia("2026-10-05", "## [2026-10-05] revisao | Passada de revisao\n");
}

function log(): string {
  return readFileSync(join(wiki, "log.md"), "utf8");
}

async function capturar(acao: () => Promise<number>): Promise<{ codigo: number; saida: string[]; erro: string[] }> {
  const saida: string[] = [];
  const erro: string[] = [];
  const stdout = spyOn(console, "log").mockImplementation((...args) => saida.push(args.join(" ")));
  const stderr = spyOn(console, "error").mockImplementation((...args) => erro.push(args.join(" ")));
  try {
    return { codigo: await acao(), saida, erro };
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
}

test("Dado três arquivos de dia, Quando indexo, Então wiki/log.md é gerado", async () => {
  montarDias();
  const resultado = await indexarLog(wiki);
  expect(resultado.escreveu).toBe(true);
  expect(existsSync(join(wiki, "log.md"))).toBe(true);
});

test("Dado três arquivos de dia, Quando indexo duas vezes, Então a saída é byte-identica", async () => {
  montarDias();
  await indexarLog(wiki);
  const primeiro = readFileSync(join(wiki, "log.md"));
  await indexarLog(wiki);
  expect(readFileSync(join(wiki, "log.md"))).toEqual(primeiro);
});

test("Dado quatro entradas em três dias, Quando indexo, Então o cabeçalho conta 4 entradas em 3 dias", async () => {
  montarDias();
  await indexarLog(wiki);
  expect(log()).toContain("4 entradas em 3 dias");
});

test.each(["2026-09-01", "2026-09-02", "2026-10-05"])(
  "Dado o arquivo de %s, Quando indexo, Então o índice lista o dia",
  async (data) => {
    montarDias();
    await indexarLog(wiki);
    expect(log()).toContain(`[[log-${data}]]`);
  },
);

test("Dado um titulo dentro de code fence, Quando indexo, Então não conto a entrada", async () => {
  montarDias();
  await indexarLog(wiki);
  expect(log()).toContain("[[log-2026-09-02]] — 1 ");
});

test("Dado dias em dois meses, Quando indexo, Então crio duas seções de mês", async () => {
  montarDias();
  await indexarLog(wiki);
  expect(log().match(/^## 2026-/gm)).toHaveLength(2);
});

test("Dado dias em setembro e outubro, Quando indexo, Então o mês mais recente vem primeiro", async () => {
  montarDias();
  await indexarLog(wiki);
  expect(log().match(/^## 2026-.*$/gm)?.[0]).toBe("## 2026-10 — 1 entradas");
});

test("Dado log.md existente, Quando uso --stdout, Então não escrevo wiki/log.md", async () => {
  montarDias();
  writeFileSync(join(wiki, "log.md"), "# Log original\n");
  const r = await indexarLog(wiki, { stdout: true });
  expect(r.escreveu).toBe(false);
  expect(r.saida).toContain("4 entradas em 3 dias");
  expect(log()).toBe("# Log original\n");
});

test("Dado log vazio, Quando indexo, Então saio 0 e aviso LOG: nada a indexar", async () => {
  const r = await capturar(() => comandoIndexarLog([wiki]));
  expect(r.codigo).toBe(0);
  expect(r.saida.join("\n")).toContain("LOG: nada a indexar");
  expect(r.erro).toEqual([]);
});

test("Dado log.md do clone e log vazio, Quando indexo, Então preservo os bytes", async () => {
  writeFileSync(join(wiki, "log.md"), "# Log\n\nRegistro do que foi ingerido.\n");
  const antes = readFileSync(join(wiki, "log.md"));
  const r = await indexarLog(wiki);
  expect(r.escreveu).toBe(false);
  expect(readFileSync(join(wiki, "log.md"))).toEqual(antes);
});

test("Dado log antes vazio e novo arquivo de dia, Quando indexo, Então o hash muda", async () => {
  writeFileSync(join(wiki, "log.md"), "# Log\n");
  const antes = readFileSync(join(wiki, "log.md"));
  dia("2026-11-01", "## [2026-11-01] nota | Primeira entrada de verdade\n");
  await indexarLog(wiki);
  expect(readFileSync(join(wiki, "log.md")).equals(antes)).toBe(false);
});

test("Dado dois tipos com mesma contagem, Quando indexo, Então ordeno alfabeticamente", async () => {
  dia("2026-09-01", "## [2026-09-01] zeta | x\n## [2026-09-01] alfa | y\n");
  await indexarLog(wiki);
  expect(log()).toContain("2 · alfa ×1, zeta ×1");
});

test("Dado flag desconhecida, Quando executo o subcomando, Então saio 1 e explico o erro", async () => {
  const r = await capturar(() => comandoIndexarLog([wiki, "--invalida"]));
  expect(r.codigo).toBe(1);
  expect(r.erro).toEqual(["FAIL: flag desconhecida: --invalida"]);
});

test("Dado indexar-log registrado no CLI, Quando executo, Então devolvo 0 e imprimo o resumo", async () => {
  montarDias();
  const r = await capturar(() => executar(["indexar-log", wiki]));
  expect(r.codigo).toBe(0);
  expect(r.saida.join("\n")).toContain("LOG: 4 entradas em 3 dias");
});
