import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { capturarConsole } from "./apoio/console";
import { estatisticas, medirLatencia, rodarMedicao } from "../scripts/medir-latencia-hook";

const raiz = resolve(import.meta.dir, "..");

test("Dado vinte amostras Quando calculo Então mediana, p95, mínimo e máximo seguem o posto mais próximo", () => {
  const amostras = Array.from({ length: 20 }, (_, i) => 20 - i);
  expect(estatisticas(amostras)).toEqual({ execucoes: 20, medianaMs: 10.5, p95Ms: 19, minimoMs: 1, maximoMs: 20 });
  expect(estatisticas([7])).toEqual({ execucoes: 1, medianaMs: 7, p95Ms: 7, minimoMs: 7, maximoMs: 7 });
});

test("Dado o hook real Quando meço três execuções Então imprime mediana e p95 e sai 0", async () => {
  const console_ = capturarConsole();
  try {
    expect(await medirLatencia(3)).toBe(0);
    const saida = console_.saida.join("\n");
    expect(saida).toContain(`(${process.platform})`);
    expect(saida).toMatch(/3 execuções/); expect(saida).toMatch(/mediana \d+(\.\d+)? ms/); expect(saida).toMatch(/p95 \d+(\.\d+)? ms/);
    expect(saida).toContain("terminal");
  } finally { console_.restaurar(); }
});

test("Dado comando do hook que falha Quando meço Então reprova e diz qual execução falhou", async () => {
  const console_ = capturarConsole();
  try {
    expect(await medirLatencia(2, join(raiz, "src/inexistente.ts"))).toBe(1);
    expect(console_.erros.join("\n")).toContain("FALHA");
  } finally { console_.restaurar(); }
});

test("Dado argumento inválido ou ausente Quando executo a medição Então usa 20 ou reprova com 2", async () => {
  const console_ = capturarConsole();
  try {
    expect(await rodarMedicao(["abc"])).toBe(2);
    expect(await rodarMedicao(["0"])).toBe(2);
    expect(console_.erros.join("\n")).toContain("Uso:");
  } finally { console_.restaurar(); }
});

test("Dado o script Quando executo como processo Então imprime os números", () => {
  const p = Bun.spawnSync([process.execPath, join(raiz, "scripts/medir-latencia-hook.ts"), "2"], { stdout: "pipe", stderr: "pipe" });
  expect(p.exitCode).toBe(0);
  expect(p.stdout.toString()).toContain("p95");
});

test("Dado falha anterior no CI Quando chega à latência Então a etapa roda sempre e imprime os números", () => {
  const fluxo = Bun.YAML.parse(readFileSync(join(raiz, ".github/workflows/ci.yml"), "utf8")) as any;
  const etapas = fluxo.jobs.testes.steps as Array<{ name?: string; run?: string; if?: string }>;
  const medicao = etapas.find(etapa => etapa.name?.startsWith("Medir latência do hook"));
  expect(medicao?.if).toBe("always()");
  expect(medicao?.run).toBe("bun scripts/medir-latencia-hook.ts");
});
