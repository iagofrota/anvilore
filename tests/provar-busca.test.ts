import { expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { comandosDaSkill, prepararWiki, provarBusca, abrirCitacao } from "../scripts/provar-busca";

test("Dado a skill query Quando preparo a prova Então preserva literalmente aspas e regex dos dois comandos", () => {
  const comandos = comandosDaSkill();
  expect(comandos.termo).toBe('rg --no-ignore -in "<termo-chave>" wiki/');
  expect(comandos.lacunas).toBe("rg --no-ignore -n '\\[!gap\\]|\\[!contradiction\\]' wiki/");
  expect(() => comandosDaSkill("sem os comandos")).toThrow();
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
  expect(existsSync(resultado.temporario)).toBe(false);
});

test("Dado um shell ausente Quando peço o diagnóstico Então falha a infraestrutura explicitamente", () => {
  const resultado = provarBusca(["shell-inexistente-anvilore"]);
  expect(resultado.codigo).toBe(1);
  expect(resultado.shells[0]?.erro).toContain("shell indisponível");
});

test("Dado o CI Quando mede a busca Então roda sempre nos três sistemas", () => {
  const fluxo = Bun.YAML.parse(readFileSync(join(import.meta.dir, "../.github/workflows/ci.yml"), "utf8")) as any;
  expect(fluxo.jobs.testes.strategy.matrix.os).toEqual(["ubuntu-latest", "windows-latest", "macos-latest"]);
  const etapa = fluxo.jobs.testes.steps.find((e: any) => e.run === "bun scripts/provar-busca.ts");
  expect(etapa?.if).toBe("always()");
});
