import { expect, test } from "bun:test";
import { delimiter, join } from "node:path";
import { readFileSync, rmSync } from "node:fs";
import { capturarConsole } from "./apoio/console";
import { ambienteSemBun, extrairFormas, prepararClone, provar, rodarCenarios, type Forma } from "../scripts/provar-forma-instalada";

const raiz = join(import.meta.dir, "..");

test("Dado o instalador num destino temporário Quando extraio as formas Então há uma por agente com a string exata gravada", async () => {
  const { tmp, clone } = await prepararClone();
  const formas = await extrairFormas(clone).finally(() => rmSync(tmp, { recursive: true, force: true }));
  const nomes = formas.map(f => `${f.agente}.${f.campo}`).sort();
  expect(nomes).toEqual(["claude.command", "codex.command", "copilot.bash", "copilot.powershell", "gemini.command"]);
  const gravada = JSON.parse(readFileSync(join(raiz, "hooks/hooks.json"), "utf8")).hooks.PreToolUse[0].hooks[0].command;
  expect(formas.find(f => f.agente === "claude")?.comando).toBe(gravada);
  expect(formas.every(f => f.comando.includes("hook proteger-raw"))).toBe(true);
});

test("Dado um ambiente com bun no PATH Quando tiro o bun Então nenhuma entrada restante o contém e o resto do ambiente fica", () => {
  const dirBun = join(raiz, "x"), outro = join(raiz, "y");
  const env = ambienteSemBun({ Path: [dirBun, outro].join(delimiter), HOME: "/h" }, dirBun);
  const chaves = Object.keys(env).filter(k => k.toUpperCase() === "PATH");
  expect(chaves).toEqual(["PATH"]);
  expect(env.PATH).toBe(outro); expect(env.HOME).toBe("/h");
});

test("Dado as formas instaladas Quando as executo no shell real deste sistema Então bloqueia raw, libera wiki e não libera sem bun", async () => {
  const consoleCapturado = capturarConsole();
  try {
    expect(await provar()).toBe(0);
    const saida = consoleCapturado.saida.join("\n");
    expect(saida).toContain("bash");
    expect(saida).toMatch(/claude\.command.*escrita em raw.*saída 2/);
    expect(saida).toMatch(/gemini\.command.*sem bun.*saída 2/);
    expect(saida).not.toContain("FALHA");
  } finally { consoleCapturado.restaurar(); }
});

test("Dado uma forma que não fecha Quando a executo Então a prova reprova e nomeia o cenário", async () => {
  const consoleCapturado = capturarConsole();
  try {
    const frouxa: Forma = { agente: "falso", campo: "command", comando: "exit 0", shells: ["bash"] };
    expect(await rodarCenarios([frouxa])).toBe(1);
    expect(consoleCapturado.saida.concat(consoleCapturado.erros).join("\n")).toMatch(/FALHA.*falso\.command.*escrita em raw/);
  } finally { consoleCapturado.restaurar(); }
});

test("Dado shell pedido que não existe no sistema Quando a prova roda Então avisa em voz alta em vez de pular em silêncio", async () => {
  const consoleCapturado = capturarConsole();
  const antes = process.env.ANVILORE_EXIGIR_SHELLS;
  try {
    const f: Forma = { agente: "falso", campo: "command", comando: "exit 2", shells: ["pwsh-que-nao-existe"] };
    expect(await rodarCenarios([f])).toBe(0);
    expect(consoleCapturado.saida.join("\n")).toContain("INFO: falso.command em pwsh-que-nao-existe: shell indisponível");
    process.env.ANVILORE_EXIGIR_SHELLS = "1";
    expect(await rodarCenarios([f])).toBe(1);
    expect(consoleCapturado.saida.join("\n")).toContain("FALHA: falso.command em pwsh-que-nao-existe: shell indisponível");
  } finally {
    if (antes === undefined) delete process.env.ANVILORE_EXIGIR_SHELLS; else process.env.ANVILORE_EXIGIR_SHELLS = antes;
    consoleCapturado.restaurar();
  }
});

test("Dado o CI Quando chega à prova da forma instalada Então a etapa roda sempre e chama o script", () => {
  const fluxo = Bun.YAML.parse(readFileSync(join(raiz, ".github/workflows/ci.yml"), "utf8")) as any;
  const etapas = fluxo.jobs.testes.steps as Array<{ name?: string; run?: string; if?: string }>;
  const prova = etapas.find(etapa => etapa.name?.startsWith("Provar a forma instalada do hook"));
  expect(prova?.if).toBe("always()");
  expect(prova?.run).toBe("bun scripts/provar-forma-instalada.ts");
});
