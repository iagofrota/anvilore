import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Perfil da empresa, lido de `anvilore.toml` na raiz do projeto. Sem o arquivo, vale o SCHEMA.md.
export type Perfil = { areas?: string[]; tipos?: string[]; camposObrigatorios?: string[] };

export class PerfilInvalido extends Error {
  override name = "PerfilInvalido";
}

export const NOME_DO_PERFIL = "anvilore.toml";

// Única política de comparação de área com o perfil (init e validar): exata, sem caixa nem normalização Unicode. Se o init aceitasse
// "pessoal" com `areas = ["Pessoal"]`, o validar reprovaria a primeira página dessa área.
export function areaPermitida(areas: readonly string[] | undefined, area: string): boolean {
  return areas === undefined || areas.includes(area);
}

const CHAVES: Record<string, keyof Perfil> = {
  areas: "areas",
  tipos: "tipos",
  campos_obrigatorios: "camposObrigatorios",
};

function listaDeTextos(chave: string, valor: unknown): string[] {
  if (!Array.isArray(valor) || valor.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new PerfilInvalido(`${NOME_DO_PERFIL}: "${chave}" deve ser uma lista de textos não vazios`);
  }
  return valor as string[];
}

// Arquivo ausente devolve {}. Arquivo presente e ilegível, com sintaxe inválida, com chave
// desconhecida ou com tipo errado falha: uma regra da empresa nunca é ignorada em silêncio.
export async function carregarPerfil(raiz: string): Promise<Perfil> {
  const caminho = join(raiz, NOME_DO_PERFIL);
  let texto: string;
  try {
    texto = await readFile(caminho, "utf8");
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new PerfilInvalido(`${NOME_DO_PERFIL}: não foi possível ler (${(erro as Error).message})`, { cause: erro });
  }

  let dados: Record<string, unknown>;
  try {
    dados = Bun.TOML.parse(texto.startsWith("﻿") ? texto.slice(1) : texto) as Record<string, unknown>;
  } catch (erro) {
    throw new PerfilInvalido(`${NOME_DO_PERFIL} inválido: ${(erro as Error).message}`, { cause: erro });
  }

  const perfil: Perfil = {};
  for (const [chave, valor] of Object.entries(dados)) {
    const destino = CHAVES[chave];
    if (destino === undefined) {
      throw new PerfilInvalido(`${NOME_DO_PERFIL}: chave desconhecida "${chave}" (use ${Object.keys(CHAVES).join(", ")})`);
    }
    perfil[destino] = listaDeTextos(chave, valor);
  }
  return perfil;
}
