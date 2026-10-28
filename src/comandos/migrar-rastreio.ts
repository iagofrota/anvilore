import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { migrarRastreio, puxar, type Dependencias } from "../lib/migracao";

const USO = `Uso: anvilore migrar-rastreio [--puxar] [pasta]
Tira do rastreio do kit o que é seu (SCHEMA.md, wiki/index.md, wiki/log.md, o esqueleto e o exemplo de wiki/ e raw/),
sem apagar nada: copia cada arquivo com SHA-256 para .anvilore/migracao/<id>/, cria o repositório próprio da wiki
se faltar, faz \`git rm --cached\` e confere. Repetir é seguro; uma migração que parou no meio é retomada.
--puxar  depois de migrar, atualiza este clone com \`git pull --ff-only\`, tirando seus arquivos do caminho e
         devolvendo-os conferidos (um \`git pull\` direto recusa enquanto eles estão no disco).
Pasta padrão: ANVILORE_DESTINO ou o diretório atual.`;

export async function comandoMigrarRastreio(args: string[], deps: Dependencias = {}): Promise<number> {
  let valores: { puxar?: boolean; help?: boolean };
  let posicionais: string[];
  try {
    const { values, positionals } = parseArgs({
      args, options: { puxar: { type: "boolean" }, help: { type: "boolean", short: "h" } }, allowPositionals: true, strict: true,
    });
    valores = values; posicionais = positionals;
  } catch (erro) {
    console.error((erro as Error).message);
    console.error(USO);
    return 2;
  }
  if (valores.help) {
    console.log(USO);
    return 0;
  }
  if (posicionais.length > 1) {
    console.error(USO);
    return 2;
  }
  const raiz = resolve(posicionais[0] ?? process.env.ANVILORE_DESTINO ?? process.cwd());
  try {
    const resultado = valores.puxar ? await puxar(raiz, deps) : await migrarRastreio(raiz, deps);
    for (const mensagem of resultado.mensagens) (resultado.codigo === 0 ? console.log : console.error)(mensagem);
    return resultado.codigo;
  } catch (erro) {
    console.error(`migrar-rastreio: ${(erro as Error).message}. Nada seu foi apagado.`);
    return 1;
  }
}
