import { type Dirent, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { FrontmatterInvalido, lerFrontmatter, linhasDe, slugDe } from "../lib/frontmatter";
import { linhasVisiveis, mascararCodigoEmLinha } from "../lib/markdown";
import { validarProveniencia } from "../lib/okf";
import { PerfilInvalido, areaPermitida, carregarPerfil, type Perfil } from "../lib/perfil";
import { chaveDeNome } from "../lib/caminhos";
import { diretorioDeTipo, nomeReservado } from "../lib/reservados";

export type ResultadoValidacao = {
  ok: boolean;
  erros: string[];
  avisos: string[];
  paginas: number;
  gaps: number;
  contradicoes: number;
  vencidas: number;
  geradasAposVerificacao: number;
};

const TIPOS_VALIDOS = ["source", "concept", "entity"];
const WIKILINK = /\[\[([^\]\n]+)\]\]/g;
const NOME_DO_INDICE = "index.md";
const USO = "Uso: anvilore validar [diretorio]";

// Caminhos relativos à wiki, com `/`, em ordem alfabética: a saída não depende do sistema.
// Pasta ilegível vira erro que a nomeia, em vez de derrubar o comando.
function listarMarkdown(dir: string, erros: string[], prefixo = ""): string[] {
  const achados: string[] = [];
  let entradas: Dirent[];
  try {
    entradas = readdirSync(join(dir, prefixo), { withFileTypes: true });
  } catch (erro) {
    erros.push(`nao foi possivel ler o diretorio: ${prefixo === "" ? dir : prefixo} (${(erro as Error).message})`);
    return achados;
  }
  for (const entrada of entradas) {
    const rel = prefixo === "" ? entrada.name : `${prefixo}/${entrada.name}`;
    if (entrada.isDirectory()) achados.push(...listarMarkdown(dir, erros, rel));
    else if (entrada.isFile() && entrada.name.endsWith(".md")) achados.push(rel);
  }
  return achados.sort();
}

function ehDiretorio(caminho: string): boolean {
  try {
    return statSync(caminho).isDirectory();
  } catch {
    return false;
  }
}

// Infra da wiki (_meta/, log/) não é página: o validador não cobra frontmatter dela.
function emDiretorioReservado(partes: string[]): boolean {
  return partes.length > 1 && nomeReservado(partes[0]!);
}

// Área = topo do caminho. Vazia na wiki plana: página solta na raiz ou sob sources/, concepts/, entities/.
function areaDoDiretorio(partes: string[]): string {
  if (partes.length < 2) return "";
  const topo = partes[0]!;
  return nomeReservado(topo) || diretorioDeTipo(topo) ? "" : topo;
}

// `[[alvo]]`, `[[alvo|rótulo]]` e `[[alvo#seção]]` apontam para `alvo`. Bloco de código,
// comentário HTML e código em linha não são links.
function alvosDe(texto: string): string[] {
  const alvos: string[] = [];
  const visivel = mascararCodigoEmLinha(linhasVisiveis(linhasDe(texto)).join("\n"));
  for (const achado of visivel.matchAll(WIKILINK)) {
    const alvo = achado[1]!.split("|")[0]!.split("#")[0]!.trim();
    if (alvo !== "") alvos.push(alvo);
  }
  return alvos;
}

function textoDoCampo(valor: unknown): string {
  return valor === null || valor === undefined ? "" : String(valor);
}

function campoVazio(valor: unknown): boolean {
  return valor === null || valor === undefined || (typeof valor === "string" && valor.trim() === "") || (Array.isArray(valor) && valor.length === 0);
}

function contarLinhas(linhas: string[], marcador: string): number {
  return linhas.filter((linha) => linha.includes(marcador)).length;
}

function conflitosDeCaixa(arquivos: string[]): string[] {
  const grupos = new Map<string, string[]>();
  for (const rel of arquivos) {
    const chave = `${dirname(rel)}/${chaveDeNome(basename(rel))}`;
    grupos.set(chave, [...(grupos.get(chave) ?? []), rel]);
  }
  return [...grupos.values()].filter((g) => g.length > 1).map((g) => `conflito de caixa entre arquivos da mesma pasta: ${g.join(" e ")}`);
}

export async function validarWiki(dir: string, perfil?: Perfil): Promise<ResultadoValidacao> {
  const resultado: ResultadoValidacao = { ok: false, erros: [], avisos: [], paginas: 0, gaps: 0, contradicoes: 0, vencidas: 0, geradasAposVerificacao: 0 };
  const { erros } = resultado;

  // Uma wiki que não existe não é uma wiki limpa: nunca vira PASS.
  if (!ehDiretorio(dir)) {
    erros.push(`diretorio nao encontrado: ${dir}`);
    return resultado;
  }
  const arquivos = listarMarkdown(dir, erros);
  resultado.paginas = arquivos.length;
  // Conta index.md e log.md de propósito: uma wiki recém-criada só tem esses dois e é válida.
  // Zero arquivo, porém, significa diretório errado ou wiki sumida.
  if (arquivos.length === 0) {
    erros.push(`nenhuma pagina .md encontrada em: ${dir}`);
    return resultado;
  }

  const raizDoProjeto = dirname(resolve(dir));
  let regras: Perfil = {};
  try {
    regras = perfil ?? (await carregarPerfil(raizDoProjeto));
  } catch (erro) {
    if (!(erro instanceof PerfilInvalido)) throw erro;
    erros.push(erro.message);
  }

  erros.push(...conflitosDeCaixa(arquivos));

  // Página ilegível reprova nomeando o arquivo: nunca some da conta nem derruba o comando.
  const textos = new Map<string, string>();
  for (const rel of arquivos) {
    try {
      textos.set(rel, readFileSync(join(dir, rel), "utf8"));
    } catch (erro) {
      erros.push(`nao foi possivel ler: ${rel} (${(erro as Error).message})`);
    }
  }
  const conteudo: string[] = [];
  const indices: string[] = [];
  for (const rel of textos.keys()) {
    const partes = rel.split("/");
    const nome = partes[partes.length - 1]!;
    if (emDiretorioReservado(partes)) continue;
    if (nome === NOME_DO_INDICE) indices.push(rel);
    else if (nome !== "log.md") conteudo.push(rel);
  }

  // O validar-okf.py antigo varria todo .md: index.md, log.md e os reservados não são cobrados de
  // type/slug/área/índice, mas o YAML e a proveniência deles são. Sem YAML que não lê, sem pular.
  const naoConteudo = new Set([...textos.keys()].filter((rel) => !conteudo.includes(rel)));
  for (const rel of naoConteudo) {
    let frontmatter: Record<string, unknown> | null;
    try {
      frontmatter = lerFrontmatter(textos.get(rel)!);
    } catch (erro) {
      if (!(erro instanceof FrontmatterInvalido)) throw erro;
      // Só YAML que não lê reprova aqui. Sem fechamento ou fora de mapa é markdown comum (uma régua
      // `---` no log), como o original tratava.
      if (erro.cause !== undefined) erros.push(`frontmatter YAML invalido, nao foi possivel ler: ${rel} (${erro.message})`);
      continue;
    }
    if (frontmatter === null) continue;
    const proveniencia = validarProveniencia(frontmatter, rel, raizDoProjeto, new Date(), false);
    erros.push(...proveniencia.erros);
    if (proveniencia.vencida) resultado.vencidas++;
    if (proveniencia.geradaAposVerificacao) resultado.geradasAposVerificacao++;
  }

  for (const rel of conteudo) {
    const texto = textos.get(rel)!;
    const linhas = linhasDe(texto);
    resultado.gaps += contarLinhas(linhas, "[!gap]");
    resultado.contradicoes += contarLinhas(linhas, "[!contradiction]");

    let frontmatter: Record<string, unknown> | null;
    try {
      frontmatter = lerFrontmatter(texto);
    } catch (erro) {
      if (!(erro instanceof FrontmatterInvalido)) throw erro;
      // Frontmatter delimitado que não lê não é página sem perfil: nunca passa calado.
      erros.push(`frontmatter YAML invalido, nao foi possivel ler: ${rel} (${erro.message})`);
      continue;
    }
    if (frontmatter === null) {
      erros.push(`sem frontmatter: ${rel}`);
      continue;
    }

    const tipo = textoDoCampo(frontmatter.type);
    if (!TIPOS_VALIDOS.includes(tipo)) erros.push(`type invalido ('${tipo}'): ${rel}`);
    else if (regras.tipos !== undefined && !regras.tipos.includes(tipo)) erros.push(`type '${tipo}' nao permitido pelo anvilore.toml: ${rel}`);

    // O nome de arquivo no macOS vem decomposto: compara-se normalizado.
    const slug = textoDoCampo(frontmatter.slug);
    if (slug.normalize("NFC") !== slugDe(rel).normalize("NFC")) erros.push(`slug '${slug}' nao bate com o nome do arquivo: ${rel}`);

    // Área é opcional (wiki plana continua válida), mas, se declarada numa página guardada
    // numa área, os dois precisam bater.
    const areaDoDir = areaDoDiretorio(rel.split("/"));
    const areaDoCampo = textoDoCampo(frontmatter.area);
    if (areaDoDir !== "" && areaDoCampo !== "" && areaDoDir !== areaDoCampo) {
      erros.push(`area '${areaDoCampo}' do frontmatter diverge do diretorio '${areaDoDir}': ${rel}`);
    }
    if (regras.areas !== undefined) {
      for (const area of new Set([areaDoDir, areaDoCampo])) {
        if (area !== "" && !areaPermitida(regras.areas, area)) erros.push(`area '${area}' nao permitida pelo anvilore.toml: ${rel}`);
      }
    }

    for (const campo of regras.camposObrigatorios ?? []) {
      if (campoVazio(frontmatter[campo])) erros.push(`campo obrigatorio '${campo}' ausente (anvilore.toml): ${rel}`);
    }

    const proveniencia = validarProveniencia(frontmatter, rel, raizDoProjeto);
    erros.push(...proveniencia.erros);
    if (proveniencia.vencida) resultado.vencidas++;
    if (proveniencia.geradaAposVerificacao) resultado.geradasAposVerificacao++;
  }

  // Wikilinks: o alvo tem de ser o slug de uma página de conteúdo da wiki.
  const slugsExistentes = new Set(conteudo.map((rel) => chaveDeNome(slugDe(rel))));
  for (const rel of [...conteudo, ...indices]) {
    for (const alvo of new Set(alvosDe(textos.get(rel)!))) {
      if (!slugsExistentes.has(chaveDeNome(alvo))) erros.push(`wikilink quebrado [[${alvo}]] em ${rel}: nenhuma pagina com esse slug`);
    }
  }

  // Índice: a página de uma área aparece no index.md da área, se ele existir, ou no index.md da
  // raiz; a da wiki plana, no da raiz. Sem nenhum index.md aplicável a conferência não é feita,
  // e isso é avisado, não calado.
  const listadosPor = new Map<string, Set<string>>();
  for (const rel of indices) listadosPor.set(rel, new Set(alvosDe(textos.get(rel)!).map(chaveDeNome)));
  let semIndice = false;
  for (const rel of conteudo) {
    const area = areaDoDiretorio(rel.split("/"));
    const listados = listadosPor.get(`${area}/${NOME_DO_INDICE}`) ?? listadosPor.get(NOME_DO_INDICE);
    if (listados === undefined) semIndice = true;
    else if (!listados.has(chaveDeNome(slugDe(rel)))) erros.push(`página fora do índice: ${rel}`);
  }
  if (semIndice) resultado.avisos.push("sem index.md: conferência do índice não feita");

  resultado.ok = erros.length === 0;
  return resultado;
}

export async function comandoValidar(args: string[], base: string = process.cwd()): Promise<number> {
  if (args.length > 1 || args.some((arg) => arg.startsWith("-"))) {
    console.error(USO);
    return 2;
  }
  const dir = args[0] ?? "wiki";
  const r = await validarWiki(resolve(base, dir));
  // O caminho que a pessoa digitou, não o absoluto, é o que ela reconhece na mensagem.
  for (const erro of r.erros) console.log(`ERRO: ${erro.replace(resolve(base, dir), dir)}`);
  for (const aviso of r.avisos) console.log(`AVISO: ${aviso}`);
  if (r.paginas === 0) {
    console.log("VALIDACAO: FAIL");
    return 1;
  }
  console.log(`Divida: ${r.gaps} gaps, ${r.contradicoes} contradicoes`);
  console.log("Registrar uma contradicao nao e criar uma contradicao — e torna-la visivel.");
  console.log(`METRIC: okf_stale=${r.vencidas}`);
  console.log(`METRIC: okf_modified_after_verified=${r.geradasAposVerificacao}`);
  if (!r.ok) {
    console.log(`VALIDACAO: FAIL (${r.erros.length} violacoes de invariante)`);
    return 1;
  }
  console.log("VALIDACAO: PASS");
  return 0;
}
