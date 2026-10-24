import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { parseArgs } from "node:util";
import { DIR_META, diretorioDeTipo, nomeReservado } from "../lib/reservados";

type Tipo = "gap" | "contradiction";
type Opcoes = { stdout?: boolean; tipos?: Tipo[]; consultar?: boolean; area?: string; buscar?: string; limite?: number };
type Achado = { rel: string; slug: string; linha: number; tipo: Tipo; texto: string; area: string };

const CALLOUT = /^>\s*\[!([a-z]+)\]\s?(.*)$/;
const CITACAO = /^>\s?(.*)$/;
const GERADOR = "src/comandos/listar-lacunas.ts";

function tipoValido(valor: string): valor is Tipo {
  return valor === "gap" || valor === "contradiction";
}

// R58/R61: symlink de arquivo é seguido com stat e, quebrado, avisa. Symlink de
// diretório não é descido (o rglob do Python 3.12 não descia), mas avisa.
const LINK_QUEBRADO = new Set(["ENOENT", "ELOOP", "ENOTDIR"]);

async function paginasMarkdown(pasta: string): Promise<string[]> {
  const paginas: string[] = [];
  for (const entrada of await readdir(pasta, { withFileTypes: true })) {
    if (entrada.name === DIR_META) continue;
    const caminho = join(pasta, entrada.name);
    let alvo: { isDirectory(): boolean; isFile(): boolean } = entrada;
    if (entrada.isSymbolicLink()) {
      try {
        alvo = await stat(caminho);
      } catch (erro) {
        if (!LINK_QUEBRADO.has((erro as NodeJS.ErrnoException).code ?? "")) throw erro;
        console.error(`AVISO: symlink quebrado: ${caminho}`);
        continue;
      }
      if (alvo.isDirectory()) {
        console.error(`AVISO: symlink de diretório não seguido: ${caminho}`);
        continue;
      }
    }
    if (alvo.isDirectory()) paginas.push(...await paginasMarkdown(caminho));
    else if (alvo.isFile() && entrada.name.endsWith(".md")) paginas.push(caminho);
  }
  return paginas.sort();
}

function extrair(texto: string, tipos: ReadonlySet<Tipo>): { linha: number; tipo: Tipo; texto: string }[] {
  const linhas = texto.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/);
  const achados: { linha: number; tipo: Tipo; texto: string }[] = [];
  for (let i = 0; i < linhas.length;) {
    const abertura = CALLOUT.exec(linhas[i]!);
    if (!abertura) { i++; continue; }
    const linha = i + 1;
    const tipo = abertura[1]!;
    const corpo = [abertura[2]!.trim()];
    i++;
    while (i < linhas.length && !CALLOUT.test(linhas[i]!)) {
      const continuacao = CITACAO.exec(linhas[i]!);
      if (!continuacao) break;
      corpo.push(continuacao[1]!.trim());
      i++;
    }
    if (tipoValido(tipo) && tipos.has(tipo)) {
      achados.push({ linha, tipo, texto: corpo.filter(Boolean).join(" ").replace(/\s+/g, " ").trim() });
    }
  }
  return achados;
}

function dobrar(texto: string): string {
  return texto.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");
}

function dataLocal(): string {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}`;
}

function ordenar(a: Achado, b: Achado): number {
  return a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : a.linha - b.linha;
}

async function coletar(wiki: string, tipos: Tipo[]): Promise<Achado[]> {
  const achados: Achado[] = [];
  for (const pagina of await paginasMarkdown(wiki)) {
    const rel = relative(wiki, pagina).split(sep).join("/");
    const partes = rel.split("/");
    const topo = partes[0]!;
    const area = partes.length < 2 || nomeReservado(topo) || diretorioDeTipo(topo) ? "(raiz)" : topo;
    for (const item of extrair(await readFile(pagina, "utf8"), new Set(tipos))) {
      achados.push({ ...item, rel, slug: basename(pagina, ".md"), area });
    }
  }
  return achados;
}

function render(achados: Achado[], hoje: string): string {
  const paginas = new Set(achados.map((a) => a.rel)).size;
  const saida = [
    "---",
    'title: "Lacunas abertas"',
    "slug: lacunas",
    `generated_by: ${GERADOR}`,
    `generated_at: ${hoje}`,
    "---",
    "",
    "# Lacunas abertas",
    "",
    `_${achados.length} callout(s) aberto(s) em ${paginas} página(s). Gerado por \`${GERADOR}\` — não edite à mão._`,
    "",
    "Cada item é uma dívida de conhecimento que quem cura declarou e ainda não fechou. Fechar um item = atualizar a página e remover o callout de lá.",
    "",
  ];

  for (const area of [...new Set(achados.map((a) => a.area))].sort()) {
    const itens = achados.filter((a) => a.area === area);
    saida.push(`## ${area} (${itens.length})`, "");
    for (const slug of [...new Set(itens.map((a) => a.slug))].sort()) {
      saida.push(`### [[${slug}]]`, "");
      for (const item of itens.filter((a) => a.slug === slug).sort(ordenar)) {
        saida.push(`- \`${item.rel}:${item.linha}\` \`${item.tipo}\` — ${item.texto}`);
      }
      saida.push("");
    }
  }
  return saida.join("\n").trimEnd() + "\n";
}

export async function listarLacunas(wiki: string, opcoes: Opcoes = {}): Promise<string[]> {
  if (!(await stat(wiki).catch(() => null))?.isDirectory()) throw new Error(`erro: wiki não encontrada: ${wiki}`);
  const achados = await coletar(wiki, opcoes.tipos ?? ["gap", "contradiction"]);
  if (opcoes.consultar || opcoes.area || opcoes.buscar || opcoes.limite) {
    const agulha = opcoes.buscar ? dobrar(opcoes.buscar) : undefined;
    const linhas = achados
      .filter((a) => (!opcoes.area || a.area === opcoes.area) && (!agulha || dobrar(a.texto).includes(agulha)))
      .sort((a, b) => a.area < b.area ? -1 : a.area > b.area ? 1 : ordenar(a, b))
      .map((a) => `${a.rel}:${a.linha} [${a.tipo}] ${a.texto}`);
    return opcoes.limite ? linhas.slice(0, opcoes.limite) : linhas;
  }

  const relatorio = render(achados, dataLocal());
  if (opcoes.stdout) return [relatorio];
  const destino = join(wiki, DIR_META, "lacunas.md");
  await mkdir(join(wiki, DIR_META), { recursive: true });
  await writeFile(destino, relatorio, "utf8");
  return [`${destino}: ${achados.length} callout(s) em ${new Set(achados.map((a) => a.rel)).size} página(s)`];
}

const USO = "Uso: anvilore listar-lacunas [wiki] [--stdout] [--tipos gap,contradiction] [--consultar] [--area AREA] [--buscar TEXTO] [--limite N]";

export async function comandoListarLacunas(args: string[]): Promise<number> {
  let wiki: string;
  let opcoes: Opcoes;
  try {
    const argumentos = args.flatMap((arg, indice) => {
      if ((arg === "--limite" || arg === "--limit") && /^-\d+$/.test(args[indice + 1] ?? "")) {
        return [`${arg}=${args[indice + 1]}`];
      }
      if (indice > 0 && (args[indice - 1] === "--limite" || args[indice - 1] === "--limit") && /^-\d+$/.test(arg)) {
        return [];
      }
      return [arg];
    });
    const parsed = parseArgs({ args: argumentos, allowPositionals: true, options: {
      stdout: { type: "boolean" }, consultar: { type: "boolean" },
      tipos: { type: "string" }, types: { type: "string" },
      area: { type: "string" }, buscar: { type: "string" }, find: { type: "string" },
      limite: { type: "string" }, limit: { type: "string" }, help: { type: "boolean", short: "h" },
    } });
    if (parsed.values.help) { console.log(USO); return 0; }
    if (parsed.positionals.length > 1) throw new Error(USO);
    wiki = parsed.positionals[0] ?? "wiki";
    const valorLimite = parsed.values.limite ?? parsed.values.limit;
    if (valorLimite !== undefined && !/^[+-]?\d+$/.test(valorLimite)) throw new Error("argumento inválido para --limite");
    const tipos = (parsed.values.tipos ?? parsed.values.types)?.split(",").map((tipo) => tipo.trim()).filter(Boolean);
    const invalido = tipos?.find((tipo) => !tipoValido(tipo));
    if (invalido !== undefined) throw new Error(`tipo de callout inválido: ${invalido}`);
    opcoes = {
      stdout: parsed.values.stdout,
      consultar: parsed.values.consultar,
      tipos: tipos?.filter(tipoValido),
      area: parsed.values.area,
      buscar: parsed.values.buscar ?? parsed.values.find,
      limite: valorLimite === undefined ? undefined : Number(valorLimite),
    };
  } catch (erro) {
    console.error(erro instanceof Error ? erro.message : String(erro));
    return 2;
  }

  try {
    const linhas = await listarLacunas(wiki, opcoes);
    if (linhas.length === 0) console.error("nenhum callout casou com a consulta");
    else if (opcoes.stdout && !opcoes.consultar && !opcoes.area && !opcoes.buscar && !opcoes.limite) {
      console.log(linhas[0]!.trimEnd());
    } else console.log(linhas.join("\n"));
    return 0;
  } catch (erro) {
    console.error(erro instanceof Error ? erro.message : String(erro));
    return 2;
  }
}

// Obra derivada de wiki-wonka (https://github.com/cooperacode/wiki-wonka),
// Coopera Code, licença MIT. Aviso de copyright original em LICENSE.
