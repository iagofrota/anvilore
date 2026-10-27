import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export function normalizarFimDeLinha(texto: string): string {
  return texto.replaceAll("\r\n", "\n");
}

// Minúsculas e NFC: o macOS grava nomes decompostos e os discos do macOS e do
// Windows não diferenciam caixa, então slug e nome de arquivo se comparam por aqui.
export function chaveDeNome(nome: string): string {
  return nome.toLowerCase().normalize("NFC");
}

// O hook falha fechado, então o componente é normalizado como o disco faria:
// separa por / \ e : (unidade `C:raw`, fluxo `raw:x`), tira pontos e espaços do
// fim (o Win32 abre `raw.` e `raw ` como `raw`) e ignora a caixa (macOS e Windows).
export function estaEmRaw(alvo: string): boolean {
  return alvo
    .split(/[\\/:]/)
    .some((componente) => componente.replace(/[. ]+$/, "").toLowerCase() === "raw");
}

// Caminho real de `alvo`, exista ele ou não: a fronteira de raw/ vale pelo disco, não pelo texto. Para o que ainda não existe,
// vale o caminho real do diretório pai existente mais próximo; um link pendente é seguido até o arquivo que a escrita criaria.
// Links em ciclo (ou mais de 40 saltos) lançam erro: quem decide falha fechado.
export function caminhoReal(alvo: string, saltos = 0): string {
  if (saltos > 40) throw new Error(`links demais ao resolver ${alvo}`);
  const absoluto = resolve(alvo);
  try {
    return realpathSync.native(absoluto);
  } catch (erro) {
    const codigo = (erro as NodeJS.ErrnoException).code;
    if (codigo !== "ENOENT" && codigo !== "ENOTDIR") throw erro;
  }
  let info: ReturnType<typeof lstatSync> | undefined;
  try { info = lstatSync(absoluto); } catch { /* não existe: sobe para o pai */ }
  if (info?.isSymbolicLink()) {
    const destino = readlinkSync(absoluto);
    return caminhoReal(isAbsolute(destino) ? destino : join(dirname(absoluto), destino), saltos + 1);
  }
  const pai = dirname(absoluto);
  if (pai === absoluto) return absoluto;
  return join(caminhoReal(pai, saltos), basename(absoluto));
}

// `filho` é `pai` ou mora dentro dele (comparação por segmento: raw-velho não está em raw).
export function dentroDe(filho: string, pai: string): boolean {
  const rel = relative(pai, filho);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
