import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

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

// Caminho real de `alvo`, exista ele ou não: a fronteira de raw/ vale pelo disco, não pelo texto. Resolve componente a
// componente, na ordem do sistema de arquivos: no POSIX o link é seguido antes de aplicar o `..` seguinte (`link/../x` sobe a
// partir do alvo real do link); no Windows o `..` é lexical, como o próprio Windows faz. Para o que ainda não existe, vale o
// caminho real do diretório pai existente mais próximo; um link pendente é seguido até o arquivo que a escrita criaria.
// Links em ciclo (ou mais de 40 saltos) lançam erro: quem decide falha fechado. Relativo parte de `base`.
export function caminhoReal(alvo: string, base: string = process.cwd()): string {
  return resolverReal(alvo, base, { saltos: 0 });
}

// Só "não existe" continua pelo texto. Qualquer outro erro (nome longo demais, inválido, sem permissão) sobe: quem decide
// falha fechado.
const INEXISTENTE = new Set(["ENOENT", "ENOTDIR"]);

function inexistente(erro: unknown): boolean {
  return INEXISTENTE.has((erro as NodeJS.ErrnoException).code ?? "");
}

function resolverReal(alvo: string, base: string, conta: { saltos: number }): string {
  const windows = process.platform === "win32";
  // No Windows, resolve() aplica o `..` pelo texto, que é o que o sistema faz; no POSIX o texto fica intacto até o disco.
  const texto = windows ? resolve(base, alvo) : alvo;
  let atual: string;
  let resto: string;
  if (isAbsolute(texto)) {
    atual = parse(texto).root;
    resto = texto.slice(atual.length);
  } else {
    atual = resolverReal(base, "/", conta);
    resto = texto;
  }
  for (const segmento of resto.split(windows ? /[\\/]+/ : "/")) {
    if (segmento === "" || segmento === ".") continue;
    // `atual` já é real: subir a partir dele é subir no disco.
    if (segmento === "..") { atual = dirname(atual); continue; }
    const proximo = join(atual, segmento);
    try {
      atual = realpathSync.native(proximo);
      continue;
    } catch (erro) {
      if (!inexistente(erro)) throw erro;
    }
    let link = false;
    try { link = lstatSync(proximo).isSymbolicLink(); } catch (erro) { if (!inexistente(erro)) throw erro; }
    if (link) {
      if (++conta.saltos > 40) throw new Error(`links demais ao resolver ${alvo}`);
      atual = resolverReal(readlinkSync(proximo), atual, conta);
    } else {
      atual = proximo;
    }
  }
  return atual;
}

// Variáveis ANVILORE_* que carregam um caminho: o pai as valida relativas ao cwd DELE, mas um filho com cwd diferente as leria relativas ao
// dele (ANVILORE_WIKI=wiki, ANVILORE_DESTINO=. abririam outra pasta). Por nome: as conhecidas e as terminadas em DIR/PATH/PASTA/DESTINO/ORIGEM/WIKI.
const VARIAVEIS_DE_CAMINHO = /^ANVILORE_(?:ASSINANTES|RG_RESULTADO|(?:.*_)?(?:DIR|PATH|PASTA|DESTINO|ORIGEM|WIKI)(?:_.*)?)$/;

// Copia do ambiente com os caminhos do Anvilore ABSOLUTOS, resolvidos a partir do cwd do PAI. Todo processo filho lançado com cwd diferente
// do pai tem de receber o ambiente por aqui; valores já absolutos ficam iguais.
export function ambienteComCaminhosAbsolutos<T extends Record<string, string | undefined>>(env: T, cwdDoPai: string = process.cwd()): T {
  const saida: Record<string, string | undefined> = { ...env };
  for (const [nome, valor] of Object.entries(env)) {
    if (!VARIAVEIS_DE_CAMINHO.test(nome) || valor === undefined || valor.trim() === "") continue;
    saida[nome] = isAbsolute(valor) ? valor : resolve(cwdDoPai, valor);
  }
  return saida as T;
}

// `filho` é `pai` ou mora dentro dele (comparação por segmento: raw-velho não está em raw).
export function dentroDe(filho: string, pai: string): boolean {
  const rel = relative(pai, filho);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
