import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { diretorioDeTipo, nomeReservado } from "./reservados";
import { caminhoWiki } from "./wiki-repo";

// A interface grava em raw/ porque soltar ou colar uma fonte é ação da pessoa (decisão 5 do plano).
// O agente continua sem poder escrever lá: o hook proteger-raw não muda. Nome repetido ganha sufixo;
// nada em raw/ é sobrescrito.

export class ErroDeFonte extends Error {}

const LIMITE_DO_NOME = 120;
// O Windows não aceita estes nomes de arquivo, com ou sem extensão (`nul.txt`).
const RESERVADOS_DO_WINDOWS = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/i;

// O `exemplo/` é o esqueleto de demonstração do kit, não uma área da pessoa.
export async function areasDaWiki(wiki: string): Promise<string[]> {
  let entradas;
  try { entradas = await readdir(wiki, { withFileTypes: true }); }
  catch (erro) { if ((erro as NodeJS.ErrnoException).code === "ENOENT") return []; throw erro; }
  const areas: string[] = [];
  for (const entrada of entradas) {
    const nome = entrada.name;
    if (nome.startsWith(".") || nomeReservado(nome) || diretorioDeTipo(nome) || nome === "exemplo") continue;
    const diretorio = entrada.isDirectory() || (entrada.isSymbolicLink() && await stat(join(wiki, nome)).then(info => info.isDirectory(), () => false));
    if (diretorio) areas.push(nome);
  }
  return areas.sort();
}

// Um nome de arquivo simples, aceito nos três sistemas: sem pasta, sem caractere proibido no Windows,
// sem ponto no início (oculto) nem ponto ou espaço no fim (o Windows descarta).
export function nomeSeguro(nome: string): string {
  const ultimo = nome.split(/[\\/]/).pop()!.normalize("NFC");
  let limpo = ultimo.replace(/[<>:"|?*\u0000-\u001f]/g, "-").trim().replace(/^\.+/, "").replace(/[. ]+$/, "");
  if (!limpo) return "fonte";
  if (RESERVADOS_DO_WINDOWS.test(limpo.split(".")[0]!)) limpo = `_${limpo}`;
  if (limpo.length > LIMITE_DO_NOME) {
    const extensao = extname(limpo);
    limpo = limpo.slice(0, LIMITE_DO_NOME - extensao.length) + extensao;
  }
  return limpo;
}

function comSufixo(nome: string, n: number): string {
  if (n === 1) return nome;
  const extensao = extname(nome);
  return `${nome.slice(0, nome.length - extensao.length)}-${n}${extensao}`;
}

export async function salvarFonte(
  raiz: string,
  fonte: { area: string; nome: string; conteudo: Uint8Array },
  ambiente: Record<string, string | undefined> = process.env,
): Promise<{ fonte: string; bytes: number }> {
  if (fonte.conteudo.byteLength === 0) throw new ErroDeFonte("A fonte está vazia.");
  const areas = await areasDaWiki(caminhoWiki(raiz, ambiente));
  if (areas.length && !areas.includes(fonte.area)) throw new ErroDeFonte(`Escolha uma área da wiki: ${areas.join(", ")}.`);
  if (!areas.length && fonte.area !== "") throw new ErroDeFonte("A wiki não tem áreas: envie a fonte sem área.");
  const pasta = fonte.area ? join(raiz, "raw", fonte.area) : join(raiz, "raw");
  await mkdir(pasta, { recursive: true });
  const nome = nomeSeguro(fonte.nome);
  for (let n = 1; ; n++) {
    const candidato = comSufixo(nome, n);
    try {
      // `wx` cria só se não existir: duas gravações com o mesmo nome nunca se sobrescrevem.
      await writeFile(join(pasta, candidato), fonte.conteudo, { flag: "wx" });
      return { fonte: ["raw", ...(fonte.area ? [fonte.area] : []), candidato].join("/"), bytes: fonte.conteudo.byteLength };
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code !== "EEXIST") throw erro;
    }
  }
}
