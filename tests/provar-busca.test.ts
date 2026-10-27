import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { comandosDaSkill, prepararWiki, provarBusca, abrirCitacao, imprimirProva } from "../scripts/provar-busca";
import { pacoteDoRg, conferirHash } from "../scripts/pacote-rg-prova";
import { capturarConsole } from "./apoio/console";

test("Dado o rg ausente dos runners Quando preparo o ensaio Então fixa artefatos oficiais e rejeita download adulterado ou sistema não suportado", () => {
  for (const [sistema, arch] of [["linux", "x64"], ["win32", "x64"], ["darwin", "arm64"], ["darwin", "x64"]]) {
    const pacote = pacoteDoRg(sistema!, arch!);
    expect(pacote.url).toStartWith("https://github.com/BurntSushi/ripgrep/releases/download/15.1.0/ripgrep-15.1.0-");
    expect(pacote.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(() => conferirHash(Buffer.from("download adulterado"), pacote.sha256)).toThrow("SHA-256");
  }
  expect(() => pacoteDoRg("desconhecido", "x64")).toThrow("não suportado");
  expect(() => conferirHash(Buffer.from("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")).not.toThrow();
});

test("Dado a skill query Quando preparo a prova Então preserva literalmente aspas e regex dos dois comandos", () => {
  const comandos = comandosDaSkill();
  expect(comandos.termo).toBe('rg --no-ignore -in "<termo-chave>" wiki/');
  expect(comandos.lacunas).toBe('rg --no-ignore -n "\\[\\x21(gap|contradiction)\\]" wiki/');
  expect(() => comandosDaSkill("sem os comandos")).toThrow();
});

test("Dado a forma hexadecimal Quando extraio a skill Então o comando é executável sem perder barras ou aspas", () => {
  const texto = 'rg --no-ignore -in "<termo-chave>" wiki/\nrg --no-ignore -n "\\[\\x21(gap|contradiction)\\]" wiki/';
  const comandos = comandosDaSkill(texto);
  expect(provarBusca(["bash"], comandos).shells[0]?.casos.find(c => c.cenario === "lacunas (literal da skill)")?.obtido.ocorrencias).toHaveLength(4);
});

test("Dado callouts que não encontram nada Quando a guarda executa Então reprova e distingue o erro obrigatório dos limites informativos", () => {
  const resultado = provarBusca(["bash"], { ...comandosDaSkill(), lacunas: 'rg --no-ignore -n "callout-inexistente" wiki/' });
  expect(resultado.codigo).toBe(1);
  expect(resultado.shells[0]?.casos.find(c => c.cenario === "lacunas (literal da skill)")?.obrigatorio).toBe(true);
  expect(resultado.shells[0]?.casos.find(c => c.cenario === "governança (consulta NFC)")?.obrigatorio).toBe(false);
});

test("Dado termos sem a flag obrigatória Quando a guarda executa Então reprova a busca vazia", () => {
  expect(provarBusca(["bash"], { ...comandosDaSkill(), termo: 'rg -in "<termo-chave>" wiki/' }).codigo).toBe(1);
});

test("Dado a wiki temporária Quando leio as páginas Então usa o gitignore real e preserva NFC e NFD em nome e conteúdo", () => {
  const wiki = prepararWiki();
  try {
    expect(readFileSync(join(wiki.cwd, "wiki/.gitignore"), "utf8")).toBe(readFileSync(join(import.meta.dir, "../wiki/.gitignore"), "utf8"));
    expect(existsSync(join(wiki.cwd, ".git"))).toBe(true);
    expect(wiki.paginas).toHaveLength(2);
    for (const [i, pagina] of wiki.paginas.entries()) {
      const forma = i === 0 ? "NFC" : "NFD";
      expect(pagina).toBe(pagina.normalize(forma));
      expect(readFileSync(join(wiki.cwd, pagina), "utf8")).toContain("governança e tributação".normalize(forma));
      expect(abrirCitacao(wiki.cwd, pagina.replaceAll("/", "\\"), 2)).toBe("busca-diagnostico");
    }
  } finally { rmSync(wiki.tmp, { recursive: true, force: true }); }
});

test("Dado os comandos literais Quando executo no bash real Então mede ignorados, lacunas, Unicode e abre cada citação", () => {
  const resultado = provarBusca(["bash"]);
  expect(resultado.codigo).toBe(0);
  expect(resultado.shells).toHaveLength(1);
  const shell = resultado.shells[0]!;
  expect(shell.rg?.versao).toContain("ripgrep");
  expect(shell.rg?.origem).not.toBe("");
  const ascii = shell.casos.find(c => c.cenario === "termo ASCII com --no-ignore")!;
  expect(ascii.obtido.codigo).toBe(0);
  expect(ascii.obtido.ocorrencias).toHaveLength(2);
  expect(ascii.confere).toBe(true);
  expect(ascii.obtido.ocorrencias.every(o => o.aberturaDireta && o.aberturaBarras && o.conteudo === "busca-diagnostico")).toBe(true);
  const ignorado = shell.casos.find(c => c.cenario === "termo ASCII sem --no-ignore")!;
  expect(ignorado.obtido.codigo).toBe(1);
  expect(ignorado.obtido.stdout).toBe("");
  expect(ignorado.confere).toBe(true);
  const lacunas = shell.casos.find(c => c.cenario === "lacunas (literal da skill)")!;
  expect(lacunas.confere).toBe(true);
  expect(lacunas.obtido.ocorrencias).toHaveLength(4);
  const nfc = shell.casos.find(c => c.cenario === "governança (consulta NFC)")!;
  const nfd = shell.casos.find(c => c.cenario === "governança (consulta NFD)")!;
  // A prova precisa mostrar a limitação, sem normalizar o comando ou esconder o vazio.
  expect(nfc.obtido.ocorrencias).toHaveLength(1);
  expect(nfd.obtido.ocorrencias).toHaveLength(1);
  expect(nfc.confere).toBe(false);
  expect(nfd.confere).toBe(false);
  expect(nfc.obtido.ocorrencias[0]!.arquivo).not.toBe(nfd.obtido.ocorrencias[0]!.arquivo);
  expect(shell.casos.every(c => c.obtido.utf8)).toBe(true);
  for (const radical of ["govern", "tribut"]) {
    expect(shell.casos.find(c => c.cenario === `radical ${radical}`)?.obtido.ocorrencias).toHaveLength(2);
  }
  expect(existsSync(resultado.temporario)).toBe(false);
});

test("Dado um shell ausente Quando peço o diagnóstico Então falha a infraestrutura explicitamente", () => {
  const resultado = provarBusca(["shell-inexistente-anvilore"]);
  expect(resultado.codigo).toBe(1);
  expect(resultado.shells[0]?.erro).toContain("shell indisponível");
});

test("Dado bash com expansão de histórico Quando comparo candidatas Então x21 encontra quatro callouts com expansão comprovadamente ligada", () => {
  const shell = provarBusca(["bash"]).shells[0]!;
  const a = shell.casos.find(c => c.cenario === "callouts candidata a (bash set -H)");
  const b = shell.casos.find(c => c.cenario === "callouts candidata b (bash set -H)");
  expect(b?.obtido.codigo).toBe(0);
  expect(b?.obtido.ocorrencias).toHaveLength(4);
  expect(b?.obtido.stdout).toContain("HISTEXPAND=on");
  expect(a).toBeDefined();
  expect(b?.obtido.stdout).toContain("HISTORY_CONTROL=1");
  for (const candidata of ["a", "b"]) {
    const caso = shell.casos.find(c => c.cenario === `callouts candidata ${candidata}`)!;
    expect(caso.obtido.codigo).toBe(0);
    expect(caso.obtido.ocorrencias).toHaveLength(4);
  }
});

test("Dado o CI Quando mede a busca Então roda sempre nos três sistemas", () => {
  const fluxo = Bun.YAML.parse(readFileSync(join(import.meta.dir, "../.github/workflows/ci.yml"), "utf8")) as any;
  expect(fluxo.jobs.testes.strategy.matrix.os).toEqual(["ubuntu-latest", "windows-latest", "macos-latest"]);
  const etapa = fluxo.jobs.testes.steps.find((e: any) => e.run === "bun scripts/provar-busca.ts");
  expect(etapa?.if).toBe("always()");
  const preparar = fluxo.jobs.testes.steps.findIndex((e: any) => e.run === "bun scripts/rg-temporario-prova.ts");
  const checar = fluxo.jobs.testes.steps.findIndex((e: any) => e.run === "bun run checar");
  expect(preparar).toBeGreaterThan(-1);
  expect(preparar).toBeLessThan(checar);
  expect(fluxo.jobs.testes.steps.find((e: any) => e.run === "bun scripts/rg-temporario-prova.ts --limpar")?.if).toBe("always()");
});

test("Dado uma falha real Quando publico o quadro Então o log distingue FALHA de INFO sem escrever no resumo do runner", () => {
  const resultado = provarBusca(["bash"], { ...comandosDaSkill(), lacunas: 'rg --no-ignore -n "callout-inexistente" wiki/' });
  const consoleCapturado = capturarConsole();
  const tmp = mkdtempSync(join(tmpdir(), "resumo-busca-"));
  const resumoAnterior = process.env.GITHUB_STEP_SUMMARY;
  try {
    process.env.GITHUB_STEP_SUMMARY = join(tmp, "resumo.md");
    imprimirProva(resultado);
    const linhas = consoleCapturado.saida;
    const json = linhas.find(l => l.startsWith("BUSCA_CASO ") && l.includes("termo ASCII com --no-ignore"))!;
    const caso = JSON.parse(json.slice("BUSCA_CASO ".length));
    expect(caso.obtido.codigo).toBe(0);
    expect(caso.obtido.ocorrencias).toHaveLength(2);
    expect(caso.comando).toBe('rg --no-ignore -in "busca-diagnostico" wiki/');
    expect(linhas.join("\n")).toContain("INFO");
    expect(linhas.join("\n")).toContain("FALHA");
    expect(readFileSync(join(tmp, "resumo.md"), "utf8")).toContain("| 0 / 2 | 0 / 2 | ok |");
  } finally {
    if (resumoAnterior === undefined) delete process.env.GITHUB_STEP_SUMMARY; else process.env.GITHUB_STEP_SUMMARY = resumoAnterior;
    consoleCapturado.restaurar();
    rmSync(tmp, { recursive: true, force: true });
  }
});
