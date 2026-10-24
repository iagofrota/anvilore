import { readdirSync, statSync, type Dirent } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

// Rejunta parágrafos quebrados à mão (~95-105 colunas) de volta a uma linha só por parágrafo,
// item de lista ou blockquote.
//
// Causa do problema: markdown com quebra de linha manual (`\n` simples, sem os dois espaços do
// hard-break do CommonMark) renderiza errado em editores configurados para quebra de linha
// estrita, que tratam QUALQUER `\n` dentro de um parágrafo como quebra visual. O conteúdo nunca
// esteve errado: é Markdown que só um dos dois renderizadores lê "certo".
//
// Preserva intacto: frontmatter YAML, code fences (``` / ~~~), linhas de tabela, headings,
// horizontal rules e linhas em branco. Junta apenas: (a) parágrafos de prosa simples, (b) o texto
// de um item de lista através de linhas de continuação sem marcador, (c) o texto de um
// blockquote/callout através de linhas de continuação, o que inclui os callouts `[!gap]` e
// `[!contradiction]` do `SCHEMA.md`.
//
// A classificação das linhas reproduz o script Python que este módulo substitui, inclusive o que
// ele entende por espaço (`str.strip`, `\s`), dígito e quebra de linha (`str.splitlines`).

export class ErroDeRejuntamento extends Error {}
export class AlvoNaoEncontrado extends ErroDeRejuntamento {}

export type OpcoesDeRejuntamento = { simular?: boolean; diff?: boolean };
export type ResultadoDoRejuntamento = { mudariam: string[]; total: number };

// Espaço no sentido do Python 3 (`str.isspace`): inclui \x1c-\x1f e \x85 e NÃO inclui o BOM, ao
// contrário do `\s` do JavaScript.
const ESPACO = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const PALAVRA = "\\p{L}\\p{N}_";
const regex = (fonte: string) => new RegExp(fonte.replaceAll("\\s", `[${ESPACO}]`).replaceAll("\\S", `[^${ESPACO}]`), "su");

const FENCE = regex("^\\s*(```|~~~)");
const ITEM_DE_LISTA = regex("^(\\s*(?:[-*+]|\\p{Nd}+\\.)\\s+)");
const BLOCKQUOTE = regex("^(\\s*>+\\s?)");
const HEADING = regex("^\\s{0,3}#{1,6}(\\s|$)");
const REGUA = regex("^\\s{0,3}(-{3,}|\\*{3,}|_{3,})\\s*$");
const LINHA_DE_TABELA = regex("^\\s*\\|.*\\|\\s*$");
const SEPARADOR_DE_TABELA = regex("^\\s*\\|?\\s*:?-{3,}:?\\s*(\\|\\s*:?-{3,}:?\\s*)+\\|?\\s*$");
const EM_BRANCO = regex("^\\s*$");
const LINHA_DE_ROTULO = regex(`^[A-ZÀ-Ý][${PALAVRA}À-ÿ ]{1,45}:\\s\\S`);
const FIM_DE_CONTINUACAO = regex("[\\-–—,:;]\\s*$");
const BORDAS = new RegExp(`^[${ESPACO}]+|[${ESPACO}]+$`, "gu");
// Terminadores de linha que o `str.splitlines` reconhece (CR e CRLF já viraram LF na leitura).
const FIM_DE_LINHA = /[^\n\v\f\x1c-\x1e\x85\u2028\u2029]*[\n\v\f\x1c-\x1e\x85\u2028\u2029]|[^\n\v\f\x1c-\x1e\x85\u2028\u2029]+/gu;

const aparar = (texto: string) => texto.replace(BORDAS, "");

function parecerCorteDeQuebra(linha: string): boolean {
  if (linha.split("(").length > linha.split(")").length) return true;
  return FIM_DE_CONTINUACAO.test(linha);
}

type Tipo = "para" | "lista" | "citacao";

function rejuntar(linhas: string[]): string[] {
  const saida: string[] = [];
  let buf: string[] = [];
  let tipo: Tipo | null = null;

  const descarregar = () => {
    if (buf.length > 0) {
      const primeira = buf[0]!;
      if (tipo === "para") {
        saida.push(buf.map(aparar).join(" "));
      } else if (tipo === "lista") {
        const prefixo = ITEM_DE_LISTA.exec(primeira)![1]!;
        const resto = aparar(primeira.slice(prefixo.length));
        const cont = buf.slice(1).map(aparar).join(" ");
        saida.push(cont === "" ? prefixo + resto : prefixo + aparar(`${resto} ${cont}`));
      } else if (tipo === "citacao") {
        const semPrefixo = (linha: string) => {
          const casou = BLOCKQUOTE.exec(linha);
          return casou === null ? aparar(linha) : aparar(linha.slice(casou[0].length));
        };
        const prefixo = BLOCKQUOTE.exec(primeira)![1]!;
        const resto = semPrefixo(primeira);
        const cont = buf.slice(1).map(semPrefixo).join(" ");
        saida.push(cont === "" ? prefixo + resto : prefixo + aparar(`${resto} ${cont}`));
      }
    }
    buf = [];
    tipo = null;
  };

  let i = 0;
  let emFrontmatter = false;
  let emCodigo = false;
  let emTabela = false;

  if (linhas.length > 0 && tirarQuebra(linhas[0]!) === "---") {
    emFrontmatter = true;
    saida.push("---");
    i = 1;
  }

  for (; i < linhas.length; i++) {
    const linha = tirarQuebra(linhas[i]!);

    if (emFrontmatter) {
      saida.push(linha);
      if (linha === "---") emFrontmatter = false;
      continue;
    }

    if (FENCE.test(linha)) {
      descarregar();
      saida.push(linha);
      emCodigo = !emCodigo;
      continue;
    }

    if (emCodigo) {
      saida.push(linha);
      continue;
    }

    if (EM_BRANCO.test(linha)) {
      descarregar();
      saida.push(linha);
      emTabela = false;
      continue;
    }

    if (LINHA_DE_TABELA.test(linha) || SEPARADOR_DE_TABELA.test(linha) || emTabela) {
      descarregar();
      saida.push(linha);
      emTabela = true;
      continue;
    }

    if (HEADING.test(linha) || REGUA.test(linha)) {
      descarregar();
      saida.push(linha);
      continue;
    }

    if (ITEM_DE_LISTA.test(linha)) {
      descarregar();
      tipo = "lista";
      buf = [linha];
      continue;
    }

    if (BLOCKQUOTE.test(linha)) {
      if (tipo === "citacao") {
        buf.push(linha);
      } else {
        descarregar();
        tipo = "citacao";
        buf = [linha];
      }
      continue;
    }

    // "Rótulo: valor" empilhado sem linha em branco (ex.: o bloco de resumo de uma entrada de log)
    // é um campo próprio, não continuação de parágrafo: nunca funde com a linha anterior. Só aceita
    // continuação se a própria linha parecer cortada no meio (parêntese aberto sem fechar, ou
    // terminando em vírgula/hífen/travessão/dois-pontos).
    if ((tipo === null || tipo === "para") && LINHA_DE_ROTULO.test(linha)) {
      descarregar();
      if (parecerCorteDeQuebra(linha)) {
        tipo = "para";
        buf = [linha];
      } else {
        saida.push(linha);
      }
      continue;
    }

    // prosa simples: continua o bloco corrente ou abre um novo parágrafo
    if (tipo === null) {
      tipo = "para";
      buf = [linha];
    } else {
      buf.push(linha);
    }
  }

  descarregar();
  return saida;
}

// `rstrip("\n")` do original: só o LF final; um FF, NEL ou LS que terminou a linha fica nela.
function tirarQuebra(linha: string): string {
  return linha.endsWith("\n") ? linha.slice(0, -1) : linha;
}

function dividirEmLinhas(texto: string): string[] {
  return texto.match(FIM_DE_LINHA) ?? [];
}

// Newline universal na leitura (CRLF e CR viram LF); o BOM fica de fora da classificação, para não
// esconder o frontmatter nem um heading na primeira linha, e volta na gravação.
export function rejuntarTexto(original: string): string {
  const bom = original.startsWith("\ufeff") ? "\ufeff" : "";
  const texto = original.slice(bom.length).replace(/\r\n?/g, "\n");
  const novas = rejuntar(dividirEmLinhas(texto));
  return bom + novas.join("\n") + (texto.endsWith("\n") ? "\n" : "");
}

type Codigo = "equal" | "delete" | "insert" | "replace";
type Opcode = [Codigo, number, number, number, number];

// Myers (O(ND)) sobre o miolo que sobra depois de aparar prefixo e sufixo comuns.
function opcodes(a: string[], b: string[]): Opcode[] {
  let prefixo = 0;
  while (prefixo < a.length && prefixo < b.length && a[prefixo] === b[prefixo]) prefixo++;
  let sufixo = 0;
  while (sufixo < a.length - prefixo && sufixo < b.length - prefixo && a.at(-1 - sufixo) === b.at(-1 - sufixo)) sufixo++;
  const ma = a.slice(prefixo, a.length - sufixo);
  const mb = b.slice(prefixo, b.length - sufixo);
  const n = ma.length;
  const m = mb.length;

  // passos[k]: "=" mantém, "-" apaga de a, "+" insere de b, em ordem.
  const passos: string[] = [];
  if (n === 0 || m === 0) {
    passos.push(...Array<string>(n).fill("-"), ...Array<string>(m).fill("+"));
  } else {
    const max = n + m;
    const deslocamento = max + 1;
    const v = new Int32Array(2 * max + 3);
    // Antes de cada rodada d guarda só a janela k in [-d-1, d+1] de V: O(D^2) em vez de O(D*(N+M)).
    const trilha: Int32Array[] = [];
    buscar: for (let d = 0; d <= max; d++) {
      trilha.push(v.slice(deslocamento - d - 1, deslocamento + d + 2));
      for (let k = -d; k <= d; k += 2) {
        let x =
          k === -d || (k !== d && v[deslocamento + k - 1]! < v[deslocamento + k + 1]!)
            ? v[deslocamento + k + 1]!
            : v[deslocamento + k - 1]! + 1;
        let y = x - k;
        while (x < n && y < m && ma[x] === mb[y]) {
          x++;
          y++;
        }
        v[deslocamento + k] = x;
        if (x >= n && y >= m) break buscar;
      }
    }
    let x = n;
    let y = m;
    for (let d = trilha.length - 1; d >= 0; d--) {
      const janela = trilha[d]!;
      const k = x - y;
      const veioDeCima = k === -d || (k !== d && janela[k - 1 + d + 1]! < janela[k + 1 + d + 1]!);
      const kAnterior = veioDeCima ? k + 1 : k - 1;
      const xAnterior = janela[kAnterior + d + 1]!;
      const yAnterior = xAnterior - kAnterior;
      while (x > xAnterior && y > yAnterior) {
        passos.push("=");
        x--;
        y--;
      }
      if (d > 0) passos.push(veioDeCima ? "+" : "-");
      x = xAnterior;
      y = yAnterior;
    }
    passos.reverse();
  }

  const saida: Opcode[] = [];
  if (prefixo > 0) saida.push(["equal", 0, prefixo, 0, prefixo]);
  let i = prefixo;
  let j = prefixo;
  let p = 0;
  while (p < passos.length) {
    if (passos[p] === "=") {
      let q = p;
      while (passos[q] === "=") q++;
      saida.push(["equal", i, i + (q - p), j, j + (q - p)]);
      i += q - p;
      j += q - p;
      p = q;
    } else {
      let apagadas = 0;
      let inseridas = 0;
      while (p < passos.length && passos[p] !== "=") {
        if (passos[p] === "-") apagadas++;
        else inseridas++;
        p++;
      }
      const codigo: Codigo = apagadas > 0 && inseridas > 0 ? "replace" : apagadas > 0 ? "delete" : "insert";
      saida.push([codigo, i, i + apagadas, j, j + inseridas]);
      i += apagadas;
      j += inseridas;
    }
  }
  if (sufixo > 0) saida.push(["equal", a.length - sufixo, a.length, b.length - sufixo, b.length]);
  return saida;
}

// Agrupa os opcodes em hunks com `contexto` linhas ao redor, como `difflib.get_grouped_opcodes`.
function agrupar(codigos: Opcode[], contexto: number): Opcode[][] {
  const lista: Opcode[] = codigos.length > 0 ? [...codigos] : [["equal", 0, 1, 0, 1]];
  const primeiro = lista[0]!;
  if (primeiro[0] === "equal") lista[0] = ["equal", Math.max(primeiro[1], primeiro[2] - contexto), primeiro[2], Math.max(primeiro[3], primeiro[4] - contexto), primeiro[4]];
  const ultimo = lista.at(-1)!;
  if (ultimo[0] === "equal") lista[lista.length - 1] = ["equal", ultimo[1], Math.min(ultimo[2], ultimo[1] + contexto), ultimo[3], Math.min(ultimo[4], ultimo[3] + contexto)];

  const grupos: Opcode[][] = [];
  let grupo: Opcode[] = [];
  for (let [codigo, i1, i2, j1, j2] of lista) {
    if (codigo === "equal" && i2 - i1 > 2 * contexto) {
      grupo.push([codigo, i1, Math.min(i2, i1 + contexto), j1, Math.min(j2, j1 + contexto)]);
      grupos.push(grupo);
      grupo = [];
      i1 = Math.max(i1, i2 - contexto);
      j1 = Math.max(j1, j2 - contexto);
    }
    grupo.push([codigo, i1, i2, j1, j2]);
  }
  if (grupo.length > 0 && !(grupo.length === 1 && grupo[0]![0] === "equal")) grupos.push(grupo);
  return grupos;
}

function faixa(inicio: number, fim: number): string {
  const comprimento = fim - inicio;
  if (comprimento === 1) return String(inicio + 1);
  return `${comprimento === 0 ? inicio : inicio + 1},${comprimento}`;
}

// Diff unificado (3 linhas de contexto). Uma linha sem LF final ganha a marca do `diff` do GNU, que
// o `difflib` deixava de fora, colando a linha seguinte nela.
function diffUnificado(de: string, para: string, antes: string, depois: string): string[] {
  const a = dividirEmLinhas(antes);
  const b = dividirEmLinhas(depois);
  const saida = [`--- ${de}`, `+++ ${para}`];
  const linha = (marca: string, texto: string) => {
    if (texto.endsWith("\n")) saida.push(marca + texto.slice(0, -1));
    else saida.push(marca + texto, "\\ No newline at end of file");
  };
  for (const grupo of agrupar(opcodes(a, b), 3)) {
    saida.push(`@@ -${faixa(grupo[0]![1], grupo.at(-1)![2])} +${faixa(grupo[0]![3], grupo.at(-1)![4])} @@`);
    for (const [codigo, i1, i2, j1, j2] of grupo) {
      if (codigo === "equal") {
        for (const texto of a.slice(i1, i2)) linha(" ", texto);
        continue;
      }
      if (codigo === "replace" || codigo === "delete") for (const texto of a.slice(i1, i2)) linha("-", texto);
      if (codigo === "replace" || codigo === "insert") for (const texto of b.slice(j1, j2)) linha("+", texto);
    }
  }
  return saida;
}

function codigoDe(erro: unknown): string {
  return (erro as NodeJS.ErrnoException).code ?? (erro as Error).message;
}

// Só os `.md` que são arquivos. Symlink é seguido com `stat` (um link para arquivo entra; para
// pasta não se desce, como o `rglob` do original); link quebrado avisa em vez de sumir.
function listarMarkdown(pasta: string, relativo: string[] = []): string[][] {
  let entradas: Dirent[];
  try {
    entradas = readdirSync(join(pasta, ...relativo), { withFileTypes: true });
  } catch (erro) {
    throw new ErroDeRejuntamento(`não foi possível listar ${join(pasta, ...relativo)}: ${codigoDe(erro)}`);
  }
  const achados: string[][] = [];
  for (const entrada of entradas) {
    const caminho = [...relativo, entrada.name];
    if (entrada.isDirectory()) {
      achados.push(...listarMarkdown(pasta, caminho));
    } else if (entrada.name.toLowerCase().endsWith(".md")) {
      if (entrada.isFile()) {
        achados.push(caminho);
      } else if (entrada.isSymbolicLink()) {
        try {
          if (statSync(join(pasta, ...caminho)).isFile()) achados.push(caminho);
        } catch (erro) {
          const codigo = codigoDe(erro);
          if (codigo !== "ENOENT" && codigo !== "ENOTDIR" && codigo !== "ELOOP") {
            throw new ErroDeRejuntamento(`não foi possível acessar ${join(pasta, ...caminho)}: ${codigo}`);
          }
          console.error(`AVISO: link quebrado ignorado: ${join(pasta, ...caminho)}`);
        }
      }
    }
  }
  return achados;
}

// Ordem de caminho por componente (a/b antes de a.md), a do `sorted(Path.rglob)` do original.
function compararCaminhos(a: string[], b: string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]! ? -1 : 1;
  }
  return a.length - b.length;
}

async function lerUtf8(caminho: string): Promise<string> {
  let bytes: Buffer;
  try {
    bytes = await readFile(caminho);
  } catch (erro) {
    throw new ErroDeRejuntamento(`não foi possível ler ${caminho}: ${codigoDe(erro)}`);
  }
  try {
    // `ignoreBOM`: o BOM fica no texto para `rejuntarTexto` decidir o que fazer com ele.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new ErroDeRejuntamento(`${caminho} não é UTF-8 válido`);
  }
}

// Lê tudo antes de escrever qualquer coisa: arquivo ilegível ou não UTF-8 reprova a rodada inteira
// sem deixar metade da pasta reescrita. Com `diff`, imprime o diff de cada arquivo que mudaria.
export async function rejuntarLinhas(alvo: string, opcoes: OpcoesDeRejuntamento = {}): Promise<ResultadoDoRejuntamento> {
  let stat;
  try {
    stat = statSync(alvo);
  } catch (erro) {
    const codigo = codigoDe(erro);
    if (codigo === "ENOENT" || codigo === "ENOTDIR") throw new AlvoNaoEncontrado(`alvo não encontrado: ${alvo}`);
    throw new ErroDeRejuntamento(`não foi possível acessar ${alvo}: ${codigo}`);
  }
  const arquivos = stat.isDirectory()
    ? listarMarkdown(alvo)
        .sort(compararCaminhos)
        .map((relativo) => join(alvo, ...relativo))
    : [alvo];

  const mudados: { arquivo: string; original: string; novo: string }[] = [];
  for (const arquivo of arquivos) {
    const original = await lerUtf8(arquivo);
    const novo = rejuntarTexto(original);
    if (novo !== original) mudados.push({ arquivo, original, novo });
  }

  for (const { arquivo, original, novo } of mudados) {
    if (opcoes.simular) {
      if (opcoes.diff) for (const linha of diffUnificado(arquivo, `${arquivo} (rejuntado)`, original, novo)) console.log(linha);
      continue;
    }
    try {
      await writeFile(arquivo, novo, "utf8");
    } catch (erro) {
      throw new ErroDeRejuntamento(`não foi possível gravar ${arquivo}: ${codigoDe(erro)}`);
    }
  }
  return { mudariam: mudados.map(({ arquivo }) => arquivo), total: arquivos.length };
}

const USO = "Uso: anvilore rejuntar-linhas <arquivo-ou-diretório> [--simular] [--diff]";

export async function comandoRejuntarLinhas(args: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        simular: { type: "boolean" },
        "dry-run": { type: "boolean" },
        diff: { type: "boolean" },
        help: { type: "boolean" },
      },
      allowPositionals: true,
    });
  } catch (erro) {
    console.error(`${(erro as Error).message}\n${USO}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help || positionals.length !== 1) {
    console.error(USO);
    return 2;
  }

  const alvo = positionals[0]!;
  const simular = values.simular === true || values["dry-run"] === true;
  try {
    const { mudariam, total } = await rejuntarLinhas(alvo, { simular, diff: values.diff === true });
    console.error(`\n${mudariam.length}/${total} arquivos ${simular ? "mudariam" : "mudaram"}.`);
    if (mudariam.length > 0 && !values.diff) for (const arquivo of mudariam) console.error(`  ${arquivo}`);
    return 0;
  } catch (erro) {
    if (!(erro instanceof ErroDeRejuntamento)) throw erro;
    if (erro instanceof AlvoNaoEncontrado) {
      console.error(`erro: ${erro.message}`);
      return 2;
    }
    console.error(`ERRO: ${erro.message}`);
    return 1;
  }
}

// Este módulo é obra derivada de `wiki-wonka`
// (https://github.com/cooperacode/wiki-wonka) (Coopera Code, licença MIT),
// traduzido para português do Brasil e adaptado. Aviso de copyright original
// em `LICENSE`.
