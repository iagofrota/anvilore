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
  expect(nomes).toEqual(["claude.command", "codex.command", "codex.command_windows", "copilot.bash", "copilot.powershell", "gemini.command"]);
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

test("Dado as formas instaladas Quando as executo no shell real deste sistema Então bloqueia raw, libera wiki e não libera sem bun (bash)", async () => {
  const consoleCapturado = capturarConsole();
  try {
    const codigo = await provar(["bash"]);
    const saida = consoleCapturado.saida.join("\n");
    if (codigo !== 0) throw new Error(`a prova da forma instalada reprovou no bash:\n${saida}`);
    expect(saida).toContain("bash");
    expect(saida).toMatch(/claude\.command.*escrita em raw.*saída 2/);
    expect(saida).toMatch(/gemini\.command em bash: escrita em raw.*saída 2/);
    expect(saida).toMatch(/INFO: gemini\.command em bash: sem bun/);
    expect(saida).toMatch(/copilot\.bash.*sem bun.*saída 2/);
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

test("Dado as formas do Codex e do Gemini Quando extraio Então propagam o código sem ||, exigidas em todos os shells e sem bun é informativo", async () => {
  const { tmp, clone } = await prepararClone();
  const formas = await extrairFormas(clone).finally(() => rmSync(tmp, { recursive: true, force: true }));
  for (const agente of ["codex", "gemini"]) {
    const f = formas.find(x => x.agente === agente && x.campo === "command")!;
    expect(f.comando).not.toMatch(/\|\||&&/); expect(f.comando).toContain("; exit $LASTEXITCODE");
    expect(f.shells).toContain("bash"); expect(f.shells).toContain("pwsh");
    expect(f.informativos ?? []).toEqual([]); expect(f.semBunInformativo).toBe(true);
  }
  const ps = formas.find(x => x.agente === "copilot" && x.campo === "powershell")!;
  expect(ps.shells).toContain("pwsh"); expect(ps.semBunInformativo).toBeUndefined();
});

test("Dado uma falha da prova Quando ela é impressa Então traz shell, comando, saída, stdout e stderr", async () => {
  const consoleCapturado = capturarConsole();
  try {
    const f: Forma = { agente: "falso", campo: "command", comando: "echo para-o-stdout; echo para-o-stderr >&2; exit 0", shells: ["bash"] };
    expect(await rodarCenarios([f])).toBe(1);
    const saida = consoleCapturado.saida.join("\n");
    expect(saida).toMatch(/FALHA: falso\.command em bash: escrita em raw/);
    expect(saida).toContain("shell: ");
    expect(saida).toContain("comando: echo para-o-stdout");
    expect(saida).toContain("stdout: para-o-stdout");
    expect(saida).toContain("stderr: para-o-stderr");
    expect(saida).toContain("saída: 0");
  } finally { consoleCapturado.restaurar(); }
});

test("Dado o shell pedido ausente Quando a prova explica Então lista onde procurou", async () => {
  const consoleCapturado = capturarConsole();
  try {
    await rodarCenarios([{ agente: "falso", campo: "command", comando: "exit 2", shells: ["pwsh-que-nao-existe"] }]);
    expect(consoleCapturado.saida.join("\n")).toContain("PATH:");
  } finally { consoleCapturado.restaurar(); }
});

// Anotações do GitHub Actions: o líder lê só as anotações da API pública, então cada falha ou INFO precisa de uma linha curta.
test("Dado o GitHub Actions Quando um caso falha ou vira INFO Então emite ::error e ::warning numa linha só, escapados", async () => {
  const consoleCapturado = capturarConsole();
  const antes = process.env.GITHUB_ACTIONS;
  process.env.GITHUB_ACTIONS = "true";
  try {
    const falha: Forma = { agente: "falso", campo: "command", comando: "echo 100%; echo 'linha1\nlinha2' >&2; exit 0", shells: ["bash"] };
    const info: Forma = { agente: "info", campo: "command", comando: "exit 0", shells: [], informativos: ["bash"] };
    expect(await rodarCenarios([falha, info])).toBe(1);
    const linhas = consoleCapturado.saida.join("\n").split("\n");
    const erros = linhas.filter(l => l.startsWith("::error "));
    const avisos = linhas.filter(l => l.startsWith("::warning "));
    expect(erros.length).toBeGreaterThan(0); expect(avisos.length).toBeGreaterThan(0);
    expect(erros[0]).toMatch(/^::error title=falso\.command\/bash::escrita em raw: esperado 2 obtido 0; stdout=.*; stderr=/);
    expect(erros[0]).toContain("100%25"); expect(erros[0]).toContain("stderr=linha1 linha2");
    expect(avisos[0]).toMatch(/^::warning title=info\.command\/bash::/);
    expect(erros.every(l => !l.includes("\n"))).toBe(true);
  } finally {
    if (antes === undefined) delete process.env.GITHUB_ACTIONS; else process.env.GITHUB_ACTIONS = antes;
    consoleCapturado.restaurar();
  }
});

test("Dado fora do GitHub Actions Quando um caso falha Então não emite comandos de anotação", async () => {
  const consoleCapturado = capturarConsole();
  const antes = process.env.GITHUB_ACTIONS;
  delete process.env.GITHUB_ACTIONS;
  try {
    await rodarCenarios([{ agente: "falso", campo: "command", comando: "exit 0", shells: ["bash"] }]);
    expect(consoleCapturado.saida.join("\n")).not.toContain("::error");
  } finally {
    if (antes !== undefined) process.env.GITHUB_ACTIONS = antes;
    consoleCapturado.restaurar();
  }
});

test("Dado a forma do Codex para Windows Quando extraio Então é exigida em PowerShell, inclusive sem bun, com o código exato 2", async () => {
  const { tmp, clone } = await prepararClone();
  const formas = await extrairFormas(clone).finally(() => rmSync(tmp, { recursive: true, force: true }));
  const f = formas.find(x => x.agente === "codex" && x.campo === "command_windows")!;
  expect(f.comando).toContain("$LASTEXITCODE -ne 0"); expect(f.shells).toContain("pwsh"); expect(f.semBunInformativo).toBeUndefined();
});

test("Dado uma forma que sem bun sai 1 Quando a prova roda Então reprova porque só o 2 bloqueia", async () => {
  const consoleCapturado = capturarConsole();
  try {
    const f: Forma = { agente: "falso", campo: "command", comando: "if [ -n \"$ANVILORE_X\" ]; then exit 2; fi; if command -v bun >/dev/null; then bun ./src/cli.ts hook proteger-raw; else exit 1; fi", shells: ["bash"] };
    expect(await rodarCenarios([f], raiz)).toBe(1);
    expect(consoleCapturado.saida.join("\n")).toMatch(/FALHA: falso\.command em bash: sem bun no PATH → saída 1 \(esperado 2\)/);
  } finally { consoleCapturado.restaurar(); }
});
