import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { caminhoReal, dentroDe, estaEmRaw } from "../lib/caminhos";
import { conferirLeitura, extrairJson, validarRelatorioLeitor, type RelatorioLeitor } from "../lib/relatorio-leitor";
import { decodificarUtf8 } from "../lib/utf8";
import { caminhoWiki } from "../lib/wiki-repo";

export type ResultadoConferencia = { codigo: number; mensagens: string[] };

const USO = "Uso: anvilore conferir-leitura <arquivo>\n  Confere o relatório do leitor (JSON puro ou resposta com bloco ```json) contra o esquema, a fonte e a wiki.";

function falha(mensagens: string[]): ResultadoConferencia {
  return { codigo: 1, mensagens: mensagens.map(m => `FAIL: ${m}`) };
}

// Formatos que o leitor lê (PDF, imagem) e que o kit, sem dependência de produção, não converte em texto.
const BINARIOS: Record<string, string> = {
  ".pdf": "pdf",
  ".png": "imagem", ".jpg": "imagem", ".jpeg": "imagem", ".gif": "imagem", ".webp": "imagem",
  ".bmp": "imagem", ".tif": "imagem", ".tiff": "imagem", ".heic": "imagem", ".heif": "imagem",
};

const MARCAS_ISO_BMFF = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1", "avif", "avis"]);

// BOM UTF-8 e espaços (espaço, tab, CR, LF) antes da assinatura de imagem não a escondem.
function semPreambulo(bytes: Uint8Array): Uint8Array {
  let inicio = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  while ([0x20, 0x09, 0x0d, 0x0a].includes(bytes[inicio] ?? -1)) inicio++;
  return bytes.subarray(inicio);
}

// A assinatura dos primeiros bytes: a extensão de texto não esconde PDF ou imagem. PDF segue a regra dos leitores de PDF:
// `%PDF-` em qualquer ponto do primeiro KB. Imagem exige o cabeçalho inteiro, depois de BOM e espaços, para texto que só
// começa parecido ("BMW", "RIFF") continuar texto.
function assinatura(original: Uint8Array): "pdf" | "imagem" | undefined {
  if (Buffer.from(original.subarray(0, 1024)).toString("latin1").includes("%PDF-")) return "pdf";
  const bytes = semPreambulo(original);
  const ascii = (inicio: number, fim: number) => Buffer.from(bytes.subarray(inicio, fim)).toString("latin1");
  const prefixo = (...esperado: number[]) => esperado.every((byte, i) => bytes[i] === byte);
  if (prefixo(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "imagem";
  if (prefixo(0xff, 0xd8, 0xff)) return "imagem";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "imagem";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "imagem";
  // BMP: "BM" e os quatro bytes reservados (6 a 9) zerados.
  if (ascii(0, 2) === "BM" && bytes.length >= 10 && [6, 7, 8, 9].every(i => bytes[i] === 0)) return "imagem";
  if (prefixo(0x49, 0x49, 0x2a, 0x00) || prefixo(0x4d, 0x4d, 0x00, 0x2a)) return "imagem";
  if (ascii(4, 8) === "ftyp" && MARCAS_ISO_BMFF.has(ascii(8, 12))) return "imagem";
  return undefined;
}

// Texto UTF-8 da fonte, ou o motivo de ela não ter texto conferível. Falha de leitura sobe: quem chama falha fechado.
function textoDaFonte(caminho: string, bytes: Uint8Array): { texto: string } | { binaria: string } {
  const formato = BINARIOS[extname(caminho).toLowerCase()];
  if (formato) return { binaria: formato };
  const pela = assinatura(bytes);
  if (pela) return { binaria: `${pela} com extensão de texto` };
  if (bytes.includes(0)) return { binaria: "binário" };
  // decodificarUtf8 só lança ErroDeEncoding: bytes que não formam UTF-8.
  try { return { texto: decodificarUtf8(bytes, caminho) }; } catch { return { binaria: "não é UTF-8" }; }
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

// O portão entre o leitor e a parada humana. Quem roda é a ferramenta (a sessão do agente
// ou a interface), nunca a pessoa: o relatório de um subagente não é prova.
export async function conferirArquivoDeLeitura(
  raiz: string,
  arquivo: string,
  ambiente: Record<string, string | undefined> = process.env,
): Promise<ResultadoConferencia> {
  let valor: unknown;
  try {
    const texto = await readFile(resolve(raiz, arquivo), "utf8");
    valor = extrairJson(texto);
  } catch (erro) {
    const mensagem = (erro as NodeJS.ErrnoException).code ? `não foi possível ler ${arquivo}: ${(erro as Error).message}` : (erro as Error).message;
    return falha([mensagem]);
  }
  const doEsquema = validarRelatorioLeitor(valor);
  if (!doEsquema.ok) return falha(doEsquema.erros);

  const relatorio = valor as RelatorioLeitor;
  // B1: o esquema confere o texto dos caminhos; aqui vale o disco. Um link em raw/ não traz fonte de fora, e um link na wiki
  // não leva a página para fora dela nem para dentro de raw/.
  let textoFonte: string | undefined;
  let aviso: string | undefined;
  let paginasReais: string[];
  try {
    const rawReal = caminhoReal(join(raiz, "raw"));
    const fonteReal = caminhoReal(relatorio.fonte, raiz);
    if (!dentroDe(fonteReal, rawReal)) return falha([`a fonte sai de raw/ pelo caminho real: ${relatorio.fonte}`]);
    const wiki = caminhoWiki(raiz, ambiente);
    const wikiReal = caminhoReal(wiki);
    paginasReais = relatorio.paginas.map(pagina => caminhoReal(pagina.caminho, wiki));
    const fora = paginasReais.flatMap((real, i) => dentroDe(real, wikiReal) && !dentroDe(real, rawReal) && !estaEmRaw(relative(wikiReal, real))
      ? []
      : [`$.paginas[${i}].caminho: pelo caminho real a página sai da wiki ou cai em raw/ (${relatorio.paginas[i]!.caminho})`]);
    if (fora.length) return falha(fora);
    const fonte = textoDaFonte(fonteReal, await readFile(fonteReal));
    if ("texto" in fonte) textoFonte = fonte.texto;
    else aviso = `AVISO: citações não conferidas automaticamente (fonte binária: ${fonte.binaria}); confira os trechos na fonte antes de aprovar.`;
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === "ENOENT") return falha([`fonte não encontrada: ${relatorio.fonte}`]);
    return falha([(erro as Error).message]);
  }
  const reais = new Map(relatorio.paginas.map((pagina, i) => [pagina.caminho, paginasReais[i]!]));
  const resultado = conferirLeitura(relatorio, { textoFonte, existe: caminho => existsSync(reais.get(caminho)!) });
  if (!resultado.ok) return falha(resultado.erros);

  const criar = relatorio.paginas.filter(p => p.acao === "criar").length;
  return {
    codigo: 0,
    mensagens: [
      ...(aviso ? [aviso] : []),
      `OK: leitura conferida — ${plural(relatorio.takeaways.length, "takeaway", "takeaways")}, ` +
      `${plural(relatorio.paginas.length, "página", "páginas")} (${criar} a criar, ${relatorio.paginas.length - criar} a atualizar), ` +
      `${plural(relatorio.lacunas.length, "lacuna", "lacunas")}, ${plural(relatorio.contradicoes.length, "contradição", "contradições")}.`,
    ],
  };
}

export async function comandoConferirLeitura(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USO);
    return 0;
  }
  if (args.length !== 1) {
    console.log(USO);
    return 2;
  }
  const raiz = process.env.ANVILORE_DESTINO ?? process.cwd();
  const resultado = await conferirArquivoDeLeitura(raiz, args[0]!, process.env);
  for (const mensagem of resultado.mensagens) console.log(mensagem);
  return resultado.codigo;
}
