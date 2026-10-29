import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { copiarModelos } from "../../src/lib/modelos";

// O kit não rastreia mais `wiki/`, `raw/` nem `SCHEMA.md`: os testes montam o esqueleto de uma instalação nova a
// partir de `modelos/`, como `anvilore instalar` faz, numa pasta nova dentro de `pai` (que o teste já apaga no fim).
export async function esqueletoEm(pai: string): Promise<{ raiz: string; wiki: string }> {
  const raiz = mkdtempSync(join(pai, "esqueleto-"));
  await copiarModelos(raiz, { exemplo: true });
  return { raiz, wiki: join(raiz, "wiki") };
}
