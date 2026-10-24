import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { classificarRecurso, validarRecurso } from "../lib/okf";

// O baseline NÃO é outra versão do código: é scripts/resource-baseline.tsv, uma tabela de
// vereditos escrita à mão a partir da regra do SCHEMA.md. A comparação é código x dado, por isso
// ela não se anula depois do merge. Não existe --update nem regenerador, de propósito: afrouxar
// uma checagem exige editar a tabela à mão, linha a linha, com o motivo escrito ao lado.

type Veredito = "pass" | "fail";
type Validar = (valor: string, raiz: string) => boolean;
type Entrada = { esperado: Veredito; valor: string; origem: string; linha: number };
type Fixture = { tipo: "file" | "dir"; caminho: string };

export type ResultadoBaseline = { ok: boolean; divergencias: string[]; relato: string[] };
export type OpcoesBaseline = { validar?: Validar; mutar?: (validar: Validar) => Validar };

// Os quatro valores que regrediram de fato quando o espaço em branco decidia antes da forma de
// caminho. Moram aqui, e não na tabela, para que apagar uma linha exija editar também este arquivo.
const CANARIOS = [
  "raw/reunioes/notas de reuniao.md",
  "wiki/_meta/arquivo com espaco.md",
  "raw/2026 Q3/notas.md",
  "raw/notas do dia",
];
const MINIMO_DE_VALORES = 26;

class BaselineInvalido extends Error {}

function carregar(texto: string, tsv: string): { fixtures: Fixture[]; entradas: Entrada[] } {
  const fixtures: Fixture[] = [];
  const entradas: Entrada[] = [];
  const vistos = new Map<string, number>();
  texto.split(/\r?\n/).forEach((bruta, i) => {
    const linha = i + 1;
    const invalido = (motivo: string) => new BaselineInvalido(`${tsv}:${linha}: ${motivo}`);
    if (bruta.trim() === "" || bruta.trimStart().startsWith("#")) return;
    const campos = bruta.split("\t");
    if (campos[0] === "@fixture") {
      const [, tipo, caminho] = campos;
      if (campos.length !== 3 || (tipo !== "file" && tipo !== "dir")) throw invalido('@fixture espera "@fixture<TAB>file|dir<TAB>caminho"');
      if (caminho!.startsWith("/") || caminho!.split("/").includes("..")) throw invalido(`fixture tem de ser relativa e contida na raiz: ${caminho}`);
      fixtures.push({ tipo, caminho: caminho! });
      return;
    }
    if (campos.length !== 3) throw invalido(`esperadas 3 colunas separadas por TAB, vieram ${campos.length}`);
    const [esperado, valor, origem] = campos as [string, string, string];
    if (esperado !== "pass" && esperado !== "fail") throw invalido(`coluna 1 tem de ser "pass" ou "fail", veio ${esperado}`);
    if (valor === "") throw invalido("coluna 2 (valor) vazia");
    if (origem.trim() === "") throw invalido("coluna 3 (origem) vazia: todo valor carrega o motivo de estar aqui");
    if (vistos.has(valor)) throw invalido(`valor duplicado (já na linha ${vistos.get(valor)}): ${valor}`);
    vistos.set(valor, linha);
    entradas.push({ esperado, valor, origem: origem.trim(), linha });
  });
  return { fixtures, entradas };
}

function estrutura(entradas: Entrada[], tsv: string): string[] {
  const problemas: string[] = [];
  if (entradas.length < MINIMO_DE_VALORES) {
    problemas.push(`ESTRUTURA: a tabela tem ${entradas.length} valores, abaixo do mínimo ${MINIMO_DE_VALORES}. Encolher a tabela é regressão de cobertura.`);
  }
  for (const canario of CANARIOS) {
    const entrada = entradas.find((e) => e.valor === canario);
    if (entrada === undefined) {
      problemas.push(`ESTRUTURA: canário ausente da tabela: ${JSON.stringify(canario)} — é um dos quatro valores que regrediram de fato na rodada antiga e não pode sair de ${basename(tsv)}.`);
    } else if (entrada.esperado !== "fail") {
      problemas.push(`ESTRUTURA: canário ${JSON.stringify(canario)} está marcado "${entrada.esperado}" na linha ${entrada.linha}; o baseline o reprova.`);
    }
  }
  return problemas;
}

function montarFixtures(raiz: string, fixtures: Fixture[]): void {
  for (const { tipo, caminho } of fixtures) {
    const alvo = join(raiz, caminho);
    if (tipo === "dir") mkdirSync(alvo, { recursive: true });
    else {
      mkdirSync(dirname(alvo), { recursive: true });
      writeFileSync(alvo, "fixture\n");
    }
  }
}

function veredito(validar: Validar, valor: string, raiz: string): Veredito | `erro:${string}` {
  try {
    return validar(valor, raiz) ? "pass" : "fail";
  } catch (erro) {
    return `erro:${erro instanceof Error ? erro.name : "Error"}`;
  }
}

// Divergências do detector contra a tabela: afrouxado (esperava fail, deu pass), apertado ou erro.
function comparar(entradas: Entrada[], validar: Validar, raiz: string) {
  const afrouxados: { entrada: Entrada; obtido: string }[] = [];
  const apertados: { entrada: Entrada; obtido: string }[] = [];
  const erros: { entrada: Entrada; obtido: string }[] = [];
  for (const entrada of entradas) {
    const obtido = veredito(validar, entrada.valor, raiz);
    if (obtido === entrada.esperado) continue;
    (obtido.startsWith("erro:") ? erros : entrada.esperado === "fail" ? afrouxados : apertados).push({ entrada, obtido });
  }
  return { afrouxados, apertados, erros };
}

// Reintroduz, em memória, o defeito da rodada antiga: o espaço em branco decidindo antes da forma de caminho.
const comEspacoDecidindo = (validar: Validar): Validar => (valor, raiz) =>
  classificarRecurso(valor) === "url" || /\s/.test(valor) ? true : validar(valor, raiz);

export async function conferirBaseline(tsv: string, opcoes: OpcoesBaseline = {}): Promise<ResultadoBaseline> {
  const validar = opcoes.validar ?? validarRecurso;
  const mutar = opcoes.mutar ?? comEspacoDecidindo;

  let tabela: { fixtures: Fixture[]; entradas: Entrada[] };
  try {
    let texto: string;
    try {
      texto = await readFile(tsv, "utf8");
    } catch (erro) {
      throw new BaselineInvalido(`não foi possível ler ${tsv}: ${(erro as Error).message}`);
    }
    tabela = carregar(texto, tsv);
    if (tabela.entradas.length === 0) throw new BaselineInvalido(`${tsv}: a tabela não tem nenhum valor`);
  } catch (erro) {
    if (!(erro instanceof BaselineInvalido)) throw erro;
    return { ok: false, divergencias: [`FAIL: ${erro.message}`], relato: [] };
  }
  const { fixtures, entradas } = tabela;

  const divergencias: string[] = [];
  const relato = [`BASELINE:  ${tsv} (${entradas.length} valores, ${fixtures.length} fixtures)`, "VALIDADOR: src/lib/okf.ts", ""];
  const registrar = (linha: string, recuo = false) => {
    divergencias.push(linha);
    relato.push(recuo ? `  ${linha}` : linha);
  };

  for (const problema of estrutura(entradas, tsv)) registrar(problema);

  // Dois níveis: a raiz do "repositório" é filha do temporário, para que ../.. tenha para onde
  // escapar sem depender da profundidade de TMPDIR.
  const temporario = mkdtempSync(join(tmpdir(), "anvilore-baseline-"));
  try {
    const raiz = join(temporario, "repo");
    mkdirSync(join(raiz, "wiki"), { recursive: true });
    montarFixtures(raiz, fixtures);

    relato.push("Fase 1 — vereditos do validador contra o baseline versionado");
    const { afrouxados, apertados, erros } = comparar(entradas, validar, raiz);
    const detalhe = ({ entrada, obtido }: { entrada: Entrada; obtido: string }) =>
      `${JSON.stringify(entrada.valor)} — baseline: ${entrada.esperado} (${tsv}:${entrada.linha}: ${entrada.origem} | obtido: ${obtido})`;
    for (const d of afrouxados) registrar(`AFROUXADO: ${detalhe(d)}`, true);
    for (const d of apertados) registrar(`APERTADO: ${detalhe(d)}`, true);
    for (const d of erros) registrar(`ERRO: ${detalhe(d)}`, true);
    if (afrouxados.length + apertados.length + erros.length > 0) {
      relato.push(`FASE1: FAIL — ${afrouxados.length} afrouxado(s), ${apertados.length} apertado(s), ${erros.length} com erro`);
    } else {
      relato.push(`FASE1: PASS — ${entradas.length}/${entradas.length} vereditos batem com o baseline`);
    }
    relato.push("");

    relato.push("Fase 2 — canário de mutação (regra de espaço em branco da rodada antiga)");
    const detectados = new Set(comparar(entradas, mutar(validar), raiz).afrouxados.map(({ entrada }) => entrada.valor));
    const naoDetectados = CANARIOS.filter((c) => !detectados.has(c));
    for (const canario of naoDetectados) registrar(`CANARIO NAO DETECTADO: ${JSON.stringify(canario)}`, true);
    if (naoDetectados.length > 0) {
      relato.push(`FASE2: FAIL — o detector não acusou ${naoDetectados.length} dos ${CANARIOS.length} canários; esta conferência não estaria pegando a regressão que já aconteceu`);
    } else {
      relato.push(`FASE2: PASS — o detector acusa ${detectados.size} valor(es) afrouxado(s) sob a mutação, incluindo os ${CANARIOS.length} canários`);
    }
  } finally {
    rmSync(temporario, { recursive: true, force: true });
  }

  return { ok: divergencias.length === 0, divergencias, relato };
}

const USO = "Uso: anvilore baseline [TSV]";
const TABELA_PADRAO = join(import.meta.dir, "..", "..", "scripts", "resource-baseline.tsv");

export async function comandoBaseline(args: string[]): Promise<number> {
  let tsv: string;
  try {
    const { positionals, values } = parseArgs({ args, allowPositionals: true, options: { help: { type: "boolean", short: "h" } } });
    if (values.help || positionals.length > 1) {
      console.error(USO);
      return 2;
    }
    tsv = positionals[0] ?? TABELA_PADRAO;
  } catch (erro) {
    console.error((erro as Error).message);
    return 2;
  }

  const { ok, divergencias, relato } = await conferirBaseline(tsv);
  if (relato.length === 0) for (const linha of divergencias) console.error(linha);
  else console.log(relato.join("\n"));
  return ok ? 0 : 1;
}
