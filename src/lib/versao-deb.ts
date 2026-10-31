import { parsearSemVer } from "./atualizacao";

// O nFPM grava no control do DEB a pré-release separada por til (0.3.1-rc.1 → 0.3.1~rc.1), para o dpkg ordená-la
// antes da versão final; o metadado de build (+...) fica igual. Só o hífen que separa a pré-release muda.
export function versaoDeb(versao: string): string {
  if (!parsearSemVer(versao)) throw new Error(`Versão SemVer inválida: ${JSON.stringify(versao)}.`);
  const mais = versao.indexOf("+");
  const nucleo = mais === -1 ? versao : versao.slice(0, mais), build = mais === -1 ? "" : versao.slice(mais);
  return nucleo.replace("-", "~") + build;
}
