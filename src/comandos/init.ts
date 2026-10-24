import { existsSync } from "node:fs";
import { lstat, mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import { parseArgs } from "node:util";
import { chaveDeNome } from "../lib/caminhos";
import { diretorioDeTipo, nomeReservado } from "../lib/reservados";

export const AREAS_PADRAO = ["pessoal", "profissional", "projetos-paralelos", "saude"] as const;
const TIPOS = ["sources", "entities", "concepts"] as const;

export interface ResultadoInit {
  criadas: string[];
  jaExistiam: string[];
  avisos: string[];
}

type OpcoesInit = { raiz: string; areas: string[] };

export interface AmbienteInit {
  raiz?: string;
  interativo?: boolean;
  entrada?: Readable;
  saida?: Writable;
}

const USO = `Uso: anvilore init [--areas a,b,c]

Cria wiki/<área>/{sources,entities,concepts} para cada área escolhida.
Sem --areas, pergunta no terminal: aceitar as áreas padrão (${AREAS_PADRAO.join(", ")}), tirar
algumas e adicionar outras. Sem terminal e sem --areas, reprova.
Repetir o comando é seguro: o que já existe não é alterado.`;

function motivo(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

function ausente(erro: unknown): boolean {
  return (erro as NodeJS.ErrnoException).code === "ENOENT";
}

function validarNome(nome: string): void {
  if (nome.trim() === "") throw new Error("nome de área vazio");
  // Nada de separador, unidade (`C:`) ou `..`; ponto e espaço no fim o Windows descarta.
  if (/[\\/:]/.test(nome) || nome.includes("..") || nome === "." || /[. ]$/.test(nome)) {
    throw new Error(`nome de área inválido: '${nome}' (sem '/', '\\', ':', '..', nem ponto ou espaço no fim)`);
  }
  if (nomeReservado(chaveDeNome(nome))) throw new Error(`nome de área reservado: '${nome}'`);
  if (diretorioDeTipo(chaveDeNome(nome))) throw new Error(`'${nome}' é nome de diretório de tipo, não de área`);
}

function unicas(areas: string[]): string[] {
  const porChave = new Map<string, string>();
  for (const nome of areas) {
    const anterior = porChave.get(chaveDeNome(nome));
    if (anterior !== undefined && anterior !== nome) {
      throw new Error(`conflito entre '${anterior}' e '${nome}': só diferem na caixa ou na normalização Unicode`);
    }
    porChave.set(chaveDeNome(nome), nome);
  }
  return [...porChave.values()];
}

async function conferirConflitosNoDisco(wiki: string, areas: string[]): Promise<void> {
  let existentes: string[];
  try {
    existentes = await readdir(wiki);
  } catch (erro) {
    if (ausente(erro)) return;
    throw erro;
  }
  for (const area of areas) {
    const igual = existentes.find((nome) => nome !== area && chaveDeNome(nome) === chaveDeNome(area));
    if (igual !== undefined) throw new Error(`conflito: wiki/${igual} já existe e só difere de '${area}' na caixa ou na normalização Unicode`);
  }
}

// Segue o link com `stat`: área que é link para uma pasta vale como a pasta; link quebrado vira aviso.
async function estadoDaArea(caminho: string): Promise<"ausente" | "diretorio" | "quebrado"> {
  let info;
  try {
    info = await lstat(caminho);
  } catch (erro) {
    if (ausente(erro)) return "ausente";
    throw erro;
  }
  if (info.isSymbolicLink()) {
    try {
      info = await stat(caminho);
    } catch (erro) {
      if (ausente(erro)) return "quebrado";
      throw erro;
    }
  }
  if (!info.isDirectory()) throw new Error(`wiki/${caminho.split(/[\\/]/).pop()} existe e não é um diretório`);
  return "diretorio";
}

async function criarTipo(area: string, caminho: string): Promise<boolean> {
  try {
    if ((await stat(caminho)).isDirectory()) return false;
    throw new Error(`wiki/${area}/${caminho.split(/[\\/]/).pop()} existe e não é um diretório`);
  } catch (erro) {
    if (!ausente(erro)) throw erro;
  }
  await mkdir(caminho, { recursive: true });
  return true;
}

export async function inicializar({ raiz, areas }: OpcoesInit): Promise<ResultadoInit> {
  if (areas.length === 0) throw new Error("nenhuma área escolhida");
  for (const nome of areas) validarNome(nome);
  const nomes = unicas(areas);
  const wiki = join(raiz, "wiki");
  await conferirConflitosNoDisco(wiki, nomes);

  const resultado: ResultadoInit = { criadas: [], jaExistiam: [], avisos: [] };
  for (const area of nomes) {
    const caminho = join(wiki, area);
    if ((await estadoDaArea(caminho)) === "quebrado") {
      resultado.avisos.push(`área '${area}': wiki/${area} é um link simbólico quebrado; não foi criada`);
      continue;
    }
    let criou = false;
    for (const tipo of TIPOS) criou = (await criarTipo(area, join(caminho, tipo))) || criou;
    (criou ? resultado.criadas : resultado.jaExistiam).push(area);
  }
  return resultado;
}

function separar(resposta: string): string[] {
  return resposta.split(",").map((parte) => parte.trim()).filter((parte) => parte !== "");
}

function manter(resposta: string): string[] {
  const texto = resposta.trim();
  if (texto === "") return [...AREAS_PADRAO];
  if (chaveDeNome(texto) === "nenhuma") return [];
  return separar(texto).map((item) => {
    if (/^\d+$/.test(item)) {
      const numero = Number(item);
      if (numero < 1 || numero > AREAS_PADRAO.length) throw new Error(`número ${item} fora da lista (1 a ${AREAS_PADRAO.length})`);
      return AREAS_PADRAO[numero - 1]!;
    }
    const padrao = AREAS_PADRAO.find((area) => chaveDeNome(area) === chaveDeNome(item));
    if (padrao === undefined) throw new Error(`'${item}' não é uma área padrão; adicione-a na segunda pergunta`);
    return padrao;
  });
}

async function perguntarAreas(entrada: Readable, saida: Writable): Promise<string[]> {
  const rl = createInterface({ input: entrada, output: saida });
  // Lê por iterador: as linhas que chegam antes da pergunta ficam na fila em vez de se perderem.
  const linhas = rl[Symbol.asyncIterator]();
  const perguntar = async (texto: string): Promise<string> => {
    saida.write(texto);
    const { value, done } = await linhas.next();
    if (done) throw new Error("entrada encerrada antes da resposta");
    return value;
  };
  try {
    saida.write(["Áreas padrão:", ...AREAS_PADRAO.map((area, i) => `  ${i + 1}. ${area}`), ""].join("\n") + "\n");
    const mantidas = manter(await perguntar("Quais manter? Enter aceita todas; números ou nomes separados por vírgula; 'nenhuma' tira todas: "));
    const novas = separar(await perguntar("Quais outras adicionar? Nomes separados por vírgula; Enter para nenhuma: "));
    return [...mantidas, ...novas];
  } finally {
    rl.close();
  }
}

function contar(n: number): string {
  return `${n} ${n === 1 ? "área criada" : "áreas criadas"}`;
}

function proximoPasso(raiz: string): string {
  if (existsSync(join(raiz, "raw", "exemplo", "llm-wiki.md"))) {
    return "Próximo passo: peça ao seu agente para seguir skills/ingest/SKILL.md e ingerir raw/exemplo/llm-wiki.md.";
  }
  return "Próximo passo: coloque um documento em raw/ e peça ao seu agente para seguir skills/ingest/SKILL.md e ingeri-lo.";
}

export async function comandoInit(args: string[], ambiente: AmbienteInit = {}): Promise<number> {
  let areasPedidas: string | undefined;
  try {
    const { values, positionals } = parseArgs({
      args,
      options: { areas: { type: "string" }, help: { type: "boolean", short: "h" } },
      allowPositionals: true,
      strict: true,
    });
    if (values.help || positionals.length > 0) {
      console.error(USO);
      return 2;
    }
    areasPedidas = values.areas;
  } catch (erro) {
    console.error(motivo(erro));
    console.error(USO);
    return 2;
  }

  const raiz = ambiente.raiz ?? process.cwd();
  const interativo = ambiente.interativo ?? Boolean(process.stdin.isTTY);
  if (areasPedidas === undefined && !interativo) {
    console.error("Sem terminal para perguntar as áreas: informe --areas a,b,c.");
    console.error(USO);
    return 2;
  }

  try {
    const areas = areasPedidas !== undefined
      ? areasPedidas.split(",").map((nome) => nome.trim())
      : await perguntarAreas(ambiente.entrada ?? process.stdin, ambiente.saida ?? process.stdout);
    const { criadas, jaExistiam, avisos } = await inicializar({ raiz, areas });
    for (const aviso of avisos) console.log(`AVISO: ${aviso}`);
    if (jaExistiam.length > 0) console.log(`Já existiam: ${jaExistiam.join(", ")}.`);
    console.log(criadas.length > 0
      ? `Pronto: ${contar(criadas.length)} em wiki/ (${criadas.join(", ")}).`
      : "Pronto: nada novo a criar; as áreas pedidas já existiam.");
    console.log(proximoPasso(raiz));
    return 0;
  } catch (erro) {
    console.error(motivo(erro));
    return 1;
  }
}
