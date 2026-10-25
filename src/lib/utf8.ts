import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

// Comando que reescreve ou copia texto de um arquivo não pode trocar bytes inválidos por U+FFFD em silêncio: o script em bash preservava os
// bytes (Latin-1 `café` = E9), e `readFile(..., "utf8")` gravaria EF BF BD e relataria sucesso. Aqui a leitura é estrita e a mensagem nomeia o arquivo.
export class ErroDeEncoding extends Error {
  override name = "ErroDeEncoding";
  constructor(public arquivo: string) {
    super(`${arquivo} não é UTF-8 válido; nada foi reescrito (converta o arquivo para UTF-8 e rode de novo)`);
  }
}

export function decodificarUtf8(bytes: Uint8Array, arquivo: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new ErroDeEncoding(arquivo);
  }
}

export async function lerUtf8Estrito(arquivo: string): Promise<string> {
  return decodificarUtf8(await readFile(arquivo), arquivo);
}

export function lerUtf8EstritoSync(arquivo: string): string {
  return decodificarUtf8(readFileSync(arquivo), arquivo);
}
