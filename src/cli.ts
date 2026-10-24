#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { comandoChecarDocs } from "./comandos/checar-docs";
import { comandoChecarRelease } from "./comandos/checar-release";
import { comandoFatiarLog } from "./comandos/fatiar-log";
import { comandoSincronizarIndice } from "./comandos/sincronizar-indice";

export type Subcomando = (args: string[]) => Promise<number>;
export type TabelaDeSubcomandos = Record<string, Subcomando>;

// Cada tarefa acrescenta a sua entrada aqui (nome -> função).
export const subcomandos: TabelaDeSubcomandos = {
  "checar-docs": comandoChecarDocs,
  "checar-release": comandoChecarRelease,
  "fatiar-log": comandoFatiarLog,
  "sincronizar-indice": comandoSincronizarIndice,
};

function listar(tabela: TabelaDeSubcomandos): string {
  const nomes = [...Object.keys(tabela), "--help"];
  return ["Uso: anvilore <subcomando> [argumentos]", "", "Subcomandos:", ...nomes.map((n) => `  ${n}`)].join("\n");
}

export async function executar(argv: string[], tabela: TabelaDeSubcomandos = subcomandos): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv.slice(0, 1),
    options: { help: { type: "boolean", short: "h" } },
    allowPositionals: true,
    strict: false,
  });

  if (values.help) {
    console.log(listar(tabela));
    return 0;
  }

  const nome = positionals[0];
  const subcomando = nome !== undefined && Object.hasOwn(tabela, nome) ? tabela[nome] : undefined;
  if (subcomando === undefined) {
    if (nome !== undefined) console.error(`Subcomando desconhecido: ${nome}`);
    console.error(listar(tabela));
    return 2;
  }
  return subcomando(argv.slice(1));
}

if (import.meta.main) {
  process.exit(await executar(process.argv.slice(2)));
}
