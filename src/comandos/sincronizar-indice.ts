import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { diretorioDeTipo, nomeReservado } from "../lib/reservados";

type Campo = { singular: string; plural: string; contar: (area: string) => number };

function arquivosMarkdown(pasta: string): string[] {
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
  try {
    if (!statSync(pasta).isDirectory()) return 0;
  } catch {
    return 0;
  }
  return arquivosMarkdown(pasta).length;
}

const campos: Campo[] = [
  { singular: "página", plural: "páginas", contar: (area) => arquivosMarkdown(area).filter((arquivo) => !/(?:^|[\\/])(?:index|overview)\.md$/.test(arquivo)).length },
  { singular: "fonte", plural: "fontes", contar: (area) => contar(join(area, "sources")) },
  { singular: "entidade", plural: "entidades", contar: (area) => contar(join(area, "entities")) },
  { singular: "conceito", plural: "conceitos", contar: (area) => contar(join(area, "concepts")) },
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
  for (const entrada of readdirSync(wiki, { withFileTypes: true })) {
    if (nomeReservado(entrada.name) || diretorioDeTipo(entrada.name)) continue;
    const area = join(wiki, entrada.name);
    if (!entrada.isDirectory()) continue;
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
    const pareceHeader = dataNoHeader.test(header) || campos.some(({ singular, plural }) =>
      new RegExp(`[0-9]+ (${plural}|${singular})`).test(header));
    if (!pareceHeader) continue;

    let novo = header;
    let incompleto = false;
    for (const { singular, plural, contar: contarCampo } of campos) {
      const expressao = new RegExp(`[0-9]+ (${plural}|${singular})`);
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
      writeFileSync(indice, texto.slice(0, inicio) + novo + texto.slice(fim));
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
