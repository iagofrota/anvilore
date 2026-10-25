import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

export class ConflitoEscalar extends Error {
  constructor(public caminho: string, public atual: unknown, public novo: unknown) {
    super(`RECUSADO — '${caminho}' já define ${JSON.stringify(atual)}, e a instalação quer ${JSON.stringify(novo)}. Nada foi escrito: resolva à mão e rode de novo.`);
    this.name = "ConflitoEscalar";
  }
}

function dicionario(valor: unknown): valor is Record<string, unknown> {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor);
}

function fundir(alvo: unknown, fragmento: unknown, caminho: string): unknown {
  if (dicionario(alvo) && dicionario(fragmento)) {
    const pares = new Map(Object.entries(alvo));
    for (const [chave, valor] of Object.entries(fragmento)) {
      pares.set(chave, pares.has(chave) ? fundir(pares.get(chave), valor, caminho ? `${caminho}.${chave}` : chave) : valor);
    }
    return Object.fromEntries(pares);
  }
  if (Array.isArray(alvo) && Array.isArray(fragmento)) {
    const resultado = [...alvo];
    for (const item of fragmento) if (!resultado.some(atual => isDeepStrictEqual(atual, item))) resultado.push(item);
    return resultado;
  }
  if (isDeepStrictEqual(alvo, fragmento)) return alvo;
  throw new ConflitoEscalar(caminho || "(raiz)", alvo, fragmento);
}

export function fundirJson(alvo: unknown, fragmento: unknown): { resultado: unknown; veredito: "INALTERADO" | "MUDOU" } {
  const resultado = fundir(alvo, fragmento, "");
  return { resultado, veredito: isDeepStrictEqual(alvo, resultado) ? "INALTERADO" : "MUDOU" };
}

export async function comandoFundirJson(args: string[]): Promise<number> {
  const posicionais = args.filter(arg => arg !== "--simular");
  if (posicionais.length !== 2 || posicionais.some(arg => arg.startsWith("-"))) {
    console.error("uso: fundir-json [--simular] <alvo.json> <fragmento.json>");
    return 2;
  }
  const [alvo, fragmento] = posicionais as [string, string];
  try {
    let texto: string | undefined;
    try { texto = await readFile(alvo, "utf8"); }
    catch (erro) { if ((erro as NodeJS.ErrnoException).code !== "ENOENT") throw erro; }
    const fundido = fundirJson(texto === undefined ? {} : JSON.parse(texto), JSON.parse(await readFile(fragmento, "utf8")));
    const novo = JSON.stringify(fundido.resultado, null, 2) + "\n";
    const veredito = texto === novo ? "INALTERADO" : "MUDOU";
    if (veredito === "MUDOU" && !args.includes("--simular")) await writeFile(alvo, novo);
    console.log(veredito);
    return 0;
  } catch (erro) {
    console.error(`fundir-json: ${erro instanceof Error ? erro.message : String(erro)}`);
    return erro instanceof ConflitoEscalar ? 3 : 2;
  }
}

if (import.meta.main) process.exit(await comandoFundirJson(process.argv.slice(2)));
