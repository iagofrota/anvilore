import { lstat } from "node:fs/promises";
import { instantaneo, mesmaArvore } from "./vault";

// Foto de uma pasta do checkout: lista de [caminho, hash] ou `null` quando a pasta não existe (checkout limpo sem raw/ e wiki/).
export type Foto = [string, string][] | null;

export async function fotografar(pasta: string): Promise<Foto> {
  try { await lstat(pasta); }
  catch (erro) {
    // Só a ausência da própria pasta vale como estado; qualquer outro erro (permissão, I/O, ENOENT aninhado) propaga.
    if ((erro as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw erro;
  }
  return [...await instantaneo(pasta)];
}

export function conferirFoto(nome: string, antes: Foto, depois: Foto): string | null {
  if (antes === null && depois === null) return null;
  if (antes === null) return `${nome}/ não existia e foi criada durante a suíte`;
  if (depois === null) return `${nome}/ existia e foi removida durante a suíte`;
  return mesmaArvore(new Map(antes), new Map(depois)) ? null : `${nome}/ mudou: os hashes diferem`;
}
