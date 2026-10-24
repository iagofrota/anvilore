import { lstatSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { diretorioDeTipo, nomeReservado } from "../lib/reservados";

type Campo = { singular: string; plural: string; expressao: RegExp; contar: (area: string) => number };

function arquivosMarkdown(pasta: string): string[] {
  try {
    if (!lstatSync(pasta).isDirectory()) return [];
  } catch (erro) {
    if (erro instanceof Error && "code" in erro && erro.code === "ENOENT") return [];
    throw erro;
  }
  const arquivos: string[] = [];
  function visitar(dir: string): void {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const caminho = join(dir, entrada.name);
      if (entrada.isDirectory()) visitar(caminho);
      else if (entrada.isFile() && entrada.name.endsWith(".md")) arquivos.push(caminho);
    }
  }
  visitar(pasta);
  return arquivos;
}

function contar(pasta: string): number {
  return arquivosMarkdown(pasta).length;
}

const campos: Campo[] = [
  { singular: "página", plural: "páginas", expressao: /[0-9]+ (páginas|página)/, contar: (area) => arquivosMarkdown(area).filter((arquivo) => !/(?:^|[\\/])(?:index|overview)\.md$/.test(arquivo)).length },
  { singular: "fonte", plural: "fontes", expressao: /[0-9]+ (fontes|fonte)/, contar: (area) => contar(join(area, "sources")) },
  { singular: "entidade", plural: "entidades", expressao: /[0-9]+ (entidades|entidade)/, contar: (area) => contar(join(area, "entities")) },
  { singular: "conceito", plural: "conceitos", expressao: /[0-9]+ (conceitos|conceito)/, contar: (area) => contar(join(area, "concepts")) },
];

const dataNoHeader = /Última atualização: [0-9]{4}-[0-9]{2}-[0-9]{2}/;

function dataLocal(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
}

function terceiraLinha(texto: string): { linha: string; inicio: number; fim: number } | null {
  const primeira = texto.indexOf("\n");
  if (primeira === -1) return null;
  const segunda = texto.indexOf("\n", primeira + 1);
  if (segunda === -1) return null;
  const inicio = segunda + 1;
  const quebra = texto.indexOf("\n", inicio);
  const fim = quebra === -1 ? texto.length : quebra > inicio && texto[quebra - 1] === "\r" ? quebra - 1 : quebra;
  return { linha: texto.slice(inicio, fim), inicio, fim };
}

export async function sincronizarIndice(wiki: string, opcoes: { checar?: boolean } = {}): Promise<{ defasadas: string[]; reescritas: string[] }> {
  const defasadas: string[] = [];
  const reescritas: string[] = [];
  const entradas = readdirSync(wiki, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const entrada of entradas) {
    if (entrada.name.startsWith(".") || nomeReservado(entrada.name) || diretorioDeTipo(entrada.name)) continue;
    const area = join(wiki, entrada.name);
    try {
      if (!statSync(area).isDirectory()) continue;
    } catch (erro) {
      if (!entrada.isSymbolicLink()) throw erro;
      console.error(`AVISO: link de área indisponível: ${entrada.name}`);
      continue;
    }
    const indice = join(area, "index.md");
    try {
      if (!statSync(indice).isFile()) continue;
    } catch {
      continue;
    }
    const texto = readFileSync(indice, "utf8");
    const trecho = terceiraLinha(texto);
    if (trecho === null) continue;
    const { linha: header, inicio, fim } = trecho;
    const pareceHeader = dataNoHeader.test(header) || campos.some(({ expressao }) => expressao.test(header));
    if (!pareceHeader) continue;

    let novo = header;
    let incompleto = false;
    for (const { singular, plural, expressao, contar: contarCampo } of campos) {
      if (!expressao.test(novo)) {
        console.log(`FAIL: header (${entrada.name}) nao tem o campo '${plural}': ${header}`);
        defasadas.push(entrada.name);
        incompleto = true;
        break;
      }
      const valor = contarCampo(area);
      novo = novo.replace(expressao, `${valor} ${valor === 1 ? singular : plural}`);
    }
    if (incompleto) continue;
    if (!dataNoHeader.test(novo)) {
      console.log(`FAIL: header (${entrada.name}) nao tem 'Última atualização: AAAA-MM-DD': ${header}`);
      defasadas.push(entrada.name);
      continue;
    }
    novo = novo.replace(dataNoHeader, `Última atualização: ${dataLocal()}`);
    if (novo === header) continue;
    if (opcoes.checar) {
      console.log(`FAIL: header (${entrada.name}) defasado: ${header}`);
      defasadas.push(entrada.name);
    } else {
      try {
        writeFileSync(indice, texto.slice(0, inicio) + novo + texto.slice(fim));
      } catch (erro) {
        // O `path` do erro varia por sistema (no Windows pode ser a pasta): a mensagem nomeia o alvo.
        throw new Error(`${indice}: ${(erro as Error).message}`);
      }
      console.log(`SYNC (${entrada.name}): ${novo}`);
      reescritas.push(entrada.name);
    }
  }
  if (defasadas.length === 0) console.log(`INDICE: OK (${reescritas.length} header(s) reescrito(s))`);
  return { defasadas, reescritas };
}

export async function comandoSincronizarIndice(args: string[]): Promise<number> {
  let wiki = "wiki";
  let checar = false;
  for (const arg of args) {
    if (arg === "--checar" || arg === "--check") checar = true;
    else if (arg.startsWith("-")) {
      console.log(`FAIL: flag desconhecida: ${arg}`);
      return 1;
    } else wiki = arg;
  }
  try {
    if (!statSync(wiki).isDirectory()) throw new Error("não é diretório");
  } catch {
    console.log(`FAIL: raiz da wiki nao encontrada: ${wiki}`);
    return 1;
  }
  try {
    const { defasadas } = await sincronizarIndice(wiki, { checar });
    return defasadas.length === 0 ? 0 : 1;
  } catch (erro) {
    console.log(`FAIL: ${erro instanceof Error ? erro.message : String(erro)}`);
    return 1;
  }
}

// Obra derivada de wiki-wonka (https://github.com/cooperacode/wiki-wonka),
// Coopera Code, licença MIT. Aviso de copyright original em LICENSE.
