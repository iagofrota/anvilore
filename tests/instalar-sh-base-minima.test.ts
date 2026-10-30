import { afterAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, cp, lstat, mkdir, readFile, readdir, readlink, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Cenario } from "./apoio/instalar-sh";

// Decisão 1 do parecer de release (specs/release/PARECER-SOL-DECISOES-RELEASE.md §1): a reinstalação NÃO executa nada da
// pasta antes de ler a versão dela, SEM executar, e compará-la com a base mínima embutida no instalador. Menor, ausente,
// ilegível, inválida ou pré-release: recusa com mensagem simples, saída 1, sem mexer em HEAD nem em arquivo algum.
//
// Cada caso parte de uma cópia de uma instalação de verdade (feita uma vez) e a "armadilha" deixa em cada lugar onde a pasta
// poderia fazer o instalador executar algo dela (cli.ts, bunfig.toml com preload, hooks do git, core.fsmonitor) um programa que
// grava um marcador fora da pasta: marcador ausente = nada da pasta foi executado.

const linux = process.platform === "linux";
const apoio = linux ? await import("./apoio/instalar-sh") : undefined;
const cenarios: Cenario[] = [];
afterAll(async () => { await Promise.all(cenarios.splice(0).map(c => c.limpar())); });
async function novo(opcoes: Parameters<NonNullable<typeof apoio>["criarCenario"]>[0]) { const c = await apoio!.criarCenario(opcoes); cenarios.push(c); return c; }

const modelo = linux ? await novo({ agentes: ["claude"] }) : undefined;
if (modelo) {
  const primeira = modelo.rodar();
  if (primeira.codigo !== 0) throw new Error(`a instalação de partida falhou: ${primeira.tudo}`);
}

const CAUDA = ["numa pasta nova", "de forma conferida", "cópia de segurança"];
const ANTIGA = "anterior à primeira versão assinada";
const NAO_RECONHECE = "Não reconheço a versão do Anvilore";

type Pacote = string | null | "DIRETORIO" | "BINARIO";
async function instantaneo(raiz: string): Promise<string[]> {
  const linhas: string[] = [];
  const andar = async (dir: string, rel: string): Promise<void> => {
    for (const e of (await readdir(dir)).sort()) {
      const caminho = join(dir, e), nome = `${rel}/${e}`;
      const s = await lstat(caminho);
      if (s.isSymbolicLink()) linhas.push(`${nome} -> ${await readlink(caminho)}`);
      else if (s.isDirectory()) { linhas.push(`${nome}/`); await andar(caminho, nome); }
      else linhas.push(`${nome} ${createHash("sha256").update(await readFile(caminho)).digest("hex")}`);
    }
  };
  await andar(raiz, "");
  return linhas;
}

async function prepararCaso(nome: string, pacote: Pacote, o: { semEstado?: boolean } = {}) {
  const c = modelo!;
  const pasta = join(c.pai, `caso-${nome.replace(/\W+/g, "-")}`);
  await rm(pasta, { recursive: true, force: true });
  await cp(c.pasta, pasta, { recursive: true, verbatimSymlinks: true });
  const marcador = join(c.pai, `marcador-${nome.replace(/\W+/g, "-")}`);
  const grava = `#!/bin/sh\necho "$0 $*" >> "${marcador}"\nexit 0\n`;
  // Tudo o que a pasta poderia fazer o instalador executar.
  const cli = await readFile(join(pasta, "src/cli.ts"), "utf8");
  await writeFile(join(pasta, "src/cli.ts"), `import { appendFileSync as _a } from "node:fs";\n_a(${JSON.stringify(marcador)}, "cli " + process.argv.slice(2).join(" ") + "\\n");\n${cli}`);
  await writeFile(join(pasta, "marca.ts"), `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(marcador)}, "preload\\n");\n`);
  await writeFile(join(pasta, "bunfig.toml"), 'preload = ["./marca.ts"]\n');
  for (const gancho of ["post-checkout", "post-merge", "post-rewrite", "pre-commit", "reference-transaction", "post-commit"]) {
    await writeFile(join(pasta, ".git/hooks", gancho), grava); await chmod(join(pasta, ".git/hooks", gancho), 0o755);
  }
  await writeFile(join(c.pai, `fsmonitor-${nome.replace(/\W+/g, "-")}`), grava); await chmod(join(c.pai, `fsmonitor-${nome.replace(/\W+/g, "-")}`), 0o755);
  c.kit.git(["-C", pasta, "config", "core.fsmonitor", join(c.pai, `fsmonitor-${nome.replace(/\W+/g, "-")}`)]);
  if (o.semEstado) await rm(join(pasta, ".anvilore"), { recursive: true, force: true });
  const pkg = join(pasta, "package.json");
  await rm(pkg, { recursive: true, force: true });
  if (pacote === "DIRETORIO") await mkdir(pkg);
  else if (pacote === "BINARIO") await writeFile(pkg, Uint8Array.from([0xff, 0xfe, 0x00, 0x80, 0x7b]));
  else if (pacote !== null) await writeFile(pkg, pacote);
  return { pasta, marcador, cabeca: c.kit.git(["-C", pasta, "rev-parse", "HEAD"]).saida.trim() };
}
const existe = (caminho: string) => lstat(caminho).then(() => true, () => false);
const comVersao = (v: unknown) => JSON.stringify({ name: "anvilore", version: v, private: true });

async function recusa(c: Cenario, pacote: Pacote, o: { semEstado?: boolean; base?: Cenario } = {}) {
  const caso = await prepararCaso(String(Math.random()).slice(2, 8), pacote, o);
  const antes = await instantaneo(caso.pasta);
  const r = (o.base ?? c).rodar({ ANVILORE_PASTA: caso.pasta, STUB_ATUALIZAR_CODIGO: "0", ANV_MARCADOR: caso.marcador });
  return { r, caso, antes, depois: await instantaneo(caso.pasta) };
}

function conferirRecusa(x: Awaited<ReturnType<typeof recusa>>, frase: string) {
  expect(x.r.codigo, x.r.tudo).toBe(1);
  expect(x.r.tudo).toContain(frase);
  expect(x.r.tudo).toContain("nada foi mudado");
  for (const trecho of CAUDA) expect(x.r.tudo).toContain(trecho);
  expect(x.r.tudo).not.toContain("Pronto");
  expect(x.r.tudo).not.toMatch(/bun src\/cli\.ts|--assinantes|atualizacao\.json/);
  // Nada da pasta foi executado: nem o cli, nem o preload do bunfig, nem hook do git, nem o fsmonitor.
  expect(existsSync(x.caso.marcador), "marcador gravado: algo da pasta foi executado").toBe(false);
  // Nem HEAD nem arquivo algum mudou (incluindo a pasta .git e o registro da instalação).
  expect(x.depois).toEqual(x.antes);
}

const VERSAO_MENOR: [string, Pacote, { semEstado?: boolean }][] = [
  ["Dado uma pasta do tipo v0.2.0 (sem estado da atualização nem registro do instalador)", comVersao("0.2.0"), { semEstado: true }],
  ["Dado uma pasta do tipo v0.2.0 que já tinha passado por um instalador (com estado)", comVersao("0.2.0"), {}],
  ["Dado uma versão logo abaixo da base (0.2.9)", comVersao("0.2.9"), {}],
  ["Dado uma versão muito antiga (0.0.1)", comVersao("0.0.1"), {}],
];
for (const [nome, pacote, o] of VERSAO_MENOR) {
  test.skipIf(!linux)(`${nome}, Quando rodo o instalador, Então recusa antes de executar qualquer coisa dela e não muda nada`, async () => {
    const x = await recusa(modelo!, pacote, o);
    conferirRecusa(x, ANTIGA);
    expect(x.r.tudo).toContain("0.3.0");
  });
}

const NAO_RECONHECIDAS: [string, Pacote][] = [
  ["package.json ausente", null],
  ["package.json que é uma pasta (ilegível)", "DIRETORIO"],
  ["package.json com bytes que não são texto", "BINARIO"],
  ["package.json vazio", ""],
  ["package.json que não é JSON", "{ isto nao e json"],
  ["package.json que é uma lista", "[]"],
  ["package.json que é null", "null"],
  ["package.json sem version", JSON.stringify({ name: "anvilore" })],
  ["version só dentro de dependencies (não na raiz)", JSON.stringify({ name: "anvilore", dependencies: { version: "9.9.9" } })],
  ["version que é número", comVersao(3)],
  ["version que é lista", comVersao(["0.3.0"])],
  ["version vazia", comVersao("")],
  ["version que não é versão", comVersao("ultima")],
  ["version com v na frente", comVersao("v0.3.0")],
  ["version só major.minor", comVersao("0.3")],
  ["version com quatro números", comVersao("0.3.0.1")],
  ["version com zero à esquerda", comVersao("0.03.0")],
  ["version com espaço no fim", comVersao("0.3.0 ")],
  ["version com duas linhas (a segunda seria maior)", comVersao("0.3.0\n9.9.9")],
  ["pré-release abaixo da base", comVersao("0.2.0-rc.1")],
  ["pré-release da própria base", comVersao("0.3.0-rc.1")],
  ["pré-release acima da base", comVersao("0.3.1-beta")],
  ["pré-release numérica", comVersao("1.0.0-0")],
  ["metadado de build", comVersao("0.3.0+abc")],
  ["número gigante (estouraria a conta)", comVersao("99999999999999999999.0.0")],
];
for (const [nome, pacote] of NAO_RECONHECIDAS) {
  test.skipIf(!linux)(`Dado ${nome}, Quando rodo o instalador, Então recusa sem executar nada da pasta e sem mudar nada`, async () => {
    const x = await recusa(modelo!, pacote);
    conferirRecusa(x, NAO_RECONHECE);
  });
}

async function segue(versao: string, c: Cenario = modelo!) {
  const caso = await prepararCaso(`ok-${versao}`, comVersao(versao));
  const entregasAntes = (await readFile(join(caso.pasta, ".anvilore/atualizar-entrega.log"), "utf8").catch(() => "")).split("\n").filter(Boolean).length;
  const r = c.rodar({ ANVILORE_PASTA: caso.pasta, STUB_ATUALIZAR_CODIGO: "0", ANV_MARCADOR: caso.marcador });
  const entregas = (await readFile(join(caso.pasta, ".anvilore/atualizar-entrega.log"), "utf8").catch(() => "")).split("\n").filter(Boolean);
  return { r, caso, novas: entregas.slice(entregasAntes) };
}

for (const versao of ["0.3.0", "0.3.1", "0.4.0", "0.10.0", "1.0.0", "12.0.0"]) {
  test.skipIf(!linux)(`Dado a versão ${versao} (igual ou maior que a base 0.3.0), Quando rodo o instalador, Então segue o fluxo atual e entrega as chaves pela opção`, async () => {
    const x = await segue(versao);
    expect(x.r.codigo, x.r.tudo).toBe(0);
    expect(x.r.saida).toContain("Já existe uma instalação");
    expect(x.r.saida).not.toContain("anterior à primeira versão assinada");
    expect(x.novas).toHaveLength(1);
    expect(JSON.parse(x.novas[0]!)).toMatchObject({ variavel: null });
    expect(JSON.parse(x.novas[0]!).arquivo).toMatch(/assinantes-reinstalacao$/);
  });
}

test.skipIf(!linux)("Dado a base 0.9.0, Quando a pasta está em 0.10.0 ou 0.9.0, Então segue (a comparação é numérica, não de texto); em 0.8.9 recusa", async () => {
  const c = await novo({ agentes: ["claude"], baseMinima: "0.9.0" });
  expect(c.rodar().codigo).toBe(0);
  // Cópias da instalação de partida deste cenário, uma por versão.
  for (const [versao, deveSeguir] of [["0.10.0", true], ["0.9.0", true], ["0.9.1", true], ["0.8.9", false], ["0.2.0", false]] as const) {
    const pasta = join(c.pai, `base9-${versao}`);
    await cp(c.pasta, pasta, { recursive: true, verbatimSymlinks: true });
    await writeFile(join(pasta, "package.json"), comVersao(versao));
    const r = c.rodar({ ANVILORE_PASTA: pasta, STUB_ATUALIZAR_CODIGO: "0" });
    if (deveSeguir) expect(r.codigo, `${versao}: ${r.tudo}`).toBe(0);
    else { expect(r.codigo, `${versao}: ${r.tudo}`).toBe(1); expect(r.tudo).toContain("0.9.0"); }
  }
});

test.skipIf(!linux)("Dado uma pasta na versão da base, Quando o atualizador dela devolve 2 (uso), Então a defesa em profundidade para com a mensagem nova (sem o conselho circular) e nada muda", async () => {
  const caso = await prepararCaso("codigo-2", comVersao("0.3.0"));
  const antes = await instantaneo(caso.pasta);
  const r = modelo!.rodar({ ANVILORE_PASTA: caso.pasta, STUB_ATUALIZAR_CODIGO: "2", ANV_MARCADOR: caso.marcador });
  expect(r.codigo, r.tudo).toBe(1);
  expect(r.tudo).toContain(ANTIGA);
  expect(r.tudo).toContain("não sabe receber as chaves do instalador");
  expect(r.tudo).toContain("nada foi mudado");
  for (const trecho of CAUDA) expect(r.tudo).toContain(trecho);
  expect(r.tudo).not.toContain("pelo comando de atualização dela");
  expect(r.tudo).not.toContain("Uso:");
  expect(r.tudo).not.toContain("Pronto");
  // Só os registros (instalacao.log, chamadas.log, entregas) cresceram; nenhum outro arquivo mudou.
  const depois = await instantaneo(caso.pasta);
  const mudou = depois.filter(l => !antes.includes(l)).filter(l => !/^\/\.anvilore\/(chamadas\.log|atualizar-entrega\.log|instalacao\.log) /.test(l));
  expect(mudou).toEqual([]);
  expect(modelo!.kit.git(["-C", caso.pasta, "rev-parse", "HEAD"]).saida.trim()).toBe(caso.cabeca);
});

test.skipIf(!linux)("Dado uma pasta que não é instalação (sem o kit), Quando rodo o instalador, Então continua recusando como pasta de outra coisa, sem a mensagem da base mínima", async () => {
  const c = modelo!;
  const pasta = join(c.pai, "outra-coisa");
  await mkdir(pasta);
  await writeFile(join(pasta, "arquivo.txt"), "meu\n");
  await writeFile(join(pasta, "package.json"), comVersao("0.2.0"));
  const r = c.rodar({ ANVILORE_PASTA: pasta });
  expect(r.codigo).toBe(1);
  expect(r.tudo).toContain("não é uma instalação do Anvilore");
  expect(r.tudo).not.toContain(ANTIGA);
  expect(await readFile(join(pasta, "arquivo.txt"), "utf8")).toBe("meu\n");
  expect(await existe(join(pasta, ".anvilore"))).toBe(false);
});

test.skipIf(!linux)("Dado um instalador sem a base mínima embutida (ou com valor inválido), Quando rodo, Então recusa antes de qualquer passo e explica, como faz sem a chave", async () => {
  const c = modelo!;
  const original = await readFile(c.script, "utf8");
  for (const [nome, corpo] of [["vazia", "  :\n"], ["inválida", "  cat <<'ANVILORE_FIM_BASE_MINIMA'\nnova\nANVILORE_FIM_BASE_MINIMA\n"]] as const) {
    const script = join(c.pai, `sem-base-${nome}.sh`);
    await writeFile(script, original.replace(/(# >>> ANVILORE:BASE_MINIMA[^\n]*\nbase_minima_embutida\(\) \{\n)[\s\S]*?(\}\n# <<< ANVILORE:BASE_MINIMA)/, (_m, a, b) => `${a}${corpo}${b}`));
    const r = c.rodar({}, [], script);
    expect(r.codigo, `${nome}: ${r.tudo}`).toBe(1);
    expect(r.tudo).toContain("base mínima");
    expect(r.tudo).toContain("instalar.sh da release");
    expect(r.saida).not.toContain("Já existe");
  }
});

test.skipIf(!linux)("Dado o mesmo critério nos dois sistemas, Quando leio instalar.sh e instalar.ps1, Então a pasta instalada é reconhecida pela estrutura do kit (.git, AGENTS.md, src/cli.ts, skills), sem exigir o estado da atualização", async () => {
  const sh = await readFile(join(modelo!.pai, "instalar.sh"), "utf8");
  const trecho = /eh_instalacao\(\) \{[\s\S]*?\n\}/.exec(sh)?.[0] ?? "";
  expect(trecho).toContain(".git");
  expect(trecho).toContain("AGENTS.md");
  expect(trecho).toContain("src/cli.ts");
  expect(trecho).toContain("skills");
  expect(trecho).not.toContain("atualizacao.json");
  const ps1 = await readFile(join(import.meta.dir, "../instalador/instalar.ps1"), "utf8");
  const fn = /function AnvEhInstalacao \{[\s\S]*?\n\}/.exec(ps1)?.[0] ?? "";
  expect(fn).toContain(".git");
  expect(fn).toContain("AGENTS.md");
  expect(fn).toContain("src\\cli.ts");
  expect(fn).toContain("skills");
  expect(fn).not.toContain("atualizacao.json");
  expect(fn).not.toContain("package.json");
});
