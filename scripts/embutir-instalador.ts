import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { URL_CONFIANCA } from "../src/lib/confianca";

// PLANO §2 passo 4 e §4 "Integridade e assinatura": o instalar.sh precisa do manifesto de dependências e da chave
// pública ANTES de clonar o kit, então o build da release os embute no script. Este é o mecanismo; a U5 só o chama.
// O modelo (instalador/instalar.sh) traz duas regiões vazias, entre marcas `# >>> ANVILORE:<NOME>` e
// `# <<< ANVILORE:<NOME>`; sem chave embutida válida o script recusa instalar (nada aqui é placeholder de confiança).
// O instalar.ps1 (U4) usa as mesmas marcas, com a região escrita como here-string do PowerShell (`@'`...`'@`); o dialeto
// vem da extensão do arquivo e, nas funções, do último argumento (padrão: sh).
// Uma terceira região, BASE_MINIMA, traz a menor versão do Anvilore que o instalador aceita reinstalar (instalador/base-minima,
// uma linha X.Y.Z). Escolhi um arquivo próprio e não um campo do dependencias.json porque o instalar.sh lê o manifesto com awk
// linha a linha: um campo novo ali arriscaria o formato; um arquivo de uma linha é lido e conferido sem interpretar nada.

const raiz = resolve(import.meta.dir, "..");
const REGIOES = {
  MANIFESTO: { funcao: "manifesto_embutido", fim: "ANVILORE_FIM_MANIFESTO" },
  ASSINANTES: { funcao: "assinantes_embutidas", fim: "ANVILORE_FIM_ASSINANTES" },
  // URL fixa da lista de chaves do site (src/lib/confianca.ts). Constante de build: nunca vem do ambiente.
  URL_CONFIANCA: { funcao: "url_confianca_embutida", fim: "ANVILORE_FIM_URL_CONFIANCA" },
  BASE_MINIMA: { funcao: "base_minima_embutida", fim: "ANVILORE_FIM_BASE_MINIMA" },
} as const;
type Nome = keyof typeof REGIOES;
export type Dialeto = "sh" | "ps1";
const VARIAVEL_PS1: Record<Nome, string> = { MANIFESTO: "$script:AnvManifestoEmbutido", ASSINANTES: "$script:AnvAssinantesEmbutido", URL_CONFIANCA: "$script:AnvUrlConfiancaEmbutida", BASE_MINIMA: "$script:AnvBaseMinimaEmbutida" };
export const dialetoDe = (arquivo: string): Dialeto => /\.ps1$/i.test(arquivo) ? "ps1" : "sh";

// Formato OpenSSH allowed_signers com chave que assina tags do Git (o mesmo que o atualizador exige).
const CHAVE = /^(?:ssh-(?:ed25519|rsa)|ecdsa-sha2-nistp\d+|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)\s+[A-Za-z0-9+/=]+(?:\s.*)?$/;

export function validarAssinantes(texto: string): string | undefined {
  const linhas = texto.split("\n");
  let entradas = 0;
  for (const [i, bruta] of linhas.entries()) {
    const linha = bruta.trim();
    if (linha === "" || linha.startsWith("#")) continue;
    entradas++;
    const m = /^(\S+)\s+(?:(\S*namespaces="[^"]*"\S*)\s+)?(.+)$/.exec(linha);
    if (!m || !CHAVE.test(m[3]!)) return `assinantes: linha ${i + 1} não é uma entrada OpenSSH allowed_signers (principal [opções] tipo chave-base64).`;
    if (!/namespaces="(?:[^"]*,)?git(?:,[^"]*)?"/.test(m[2] ?? "")) return `assinantes: linha ${i + 1} sem namespaces="git"; a chave precisa valer para assinar tags do Git.`;
  }
  return entradas === 0 ? "assinantes vazio: não há chave pública para embutir (seguranca/assinantes). Um instalador sem chave não pode ser publicado." : undefined;
}

export type OpcoesUrl = { urlConfianca?: string; urlDeTeste?: boolean };

// https sempre; http só em loopback (127.0.0.1) e só com a flag explícita de teste. Forma restrita: a URL entra num
// heredoc/here-string e é usada como argumento de curl/Invoke-WebRequest, então sem aspas, espaço, usuário, consulta
// nem fragmento.
export function validarUrlConfianca(url: string, urlDeTeste = false): string | undefined {
  const forma = "a URL de confiança precisa ser https:// (sem espaço, aspas, usuário, consulta nem fragmento)";
  if (!/^https?:\/\/[A-Za-z0-9._~:/-]+$/.test(url)) return `${forma}.`;
  let u: URL;
  try { u = new URL(url); } catch { return `${forma}.`; }
  if (u.username || u.password || u.search || u.hash || !u.hostname) return `${forma}.`;
  if (u.protocol === "https:") return undefined;
  if (u.hostname !== "127.0.0.1") return "a URL de confiança precisa ser https://; http só vale em loopback (127.0.0.1) para teste.";
  return urlDeTeste ? undefined : "a URL de confiança precisa ser https://; http://127.0.0.1 só com a flag explícita de teste (--aceitar-url-de-teste).";
}

// SemVer só com os três números (sem v, pré-release nem metadado de build), sem zero à esquerda e até 9 dígitos por número: o
// mesmo critério dos instaladores ao ler a versão da pasta, para que a base e a versão comparada tenham a mesma forma.
export const SEMVER_SIMPLES = /^(?:0|[1-9][0-9]{0,8})\.(?:0|[1-9][0-9]{0,8})\.(?:0|[1-9][0-9]{0,8})$/;

export function validarBaseMinima(texto: string): string | undefined {
  if (texto.endsWith("\n") && SEMVER_SIMPLES.test(texto.slice(0, -1))) return undefined;
  return "base mínima: precisa ser uma versão X.Y.Z (sem v, sem pré-release, sem zero à esquerda) numa única linha terminada por quebra de linha (instalador/base-minima).";
}

function validarManifesto(texto: string): string | undefined {
  let m: { formato?: unknown; dependencias?: unknown };
  try { m = JSON.parse(texto); } catch { return "manifesto: não é JSON válido."; }
  if (m.formato !== 1) return `manifesto: formato ${String(m.formato)} desconhecido (esperado 1).`;
  if (typeof m.dependencias !== "object" || m.dependencias === null) return "manifesto: sem dependencias.";
  return undefined;
}

function conteudoDaRegiao(nome: Nome, texto: string, dialeto: Dialeto): string | undefined {
  if (texto === "") return undefined;
  if (!texto.endsWith("\n")) return "o conteúdo precisa terminar com quebra de linha";
  if (dialeto === "ps1") {
    if (texto.includes("\r")) return "o conteúdo não pode ter retorno de carro (use quebra de linha LF)";
    if (texto.split("\n").some(l => l === "'@")) return "o conteúdo contém a linha que fecha o here-string";
    return undefined;
  }
  if (texto.split("\n").some(l => l === REGIOES[nome].fim)) return "o conteúdo contém a linha que fecha o heredoc";
  return undefined;
}

function regiao(nome: Nome, texto: string, dialeto: Dialeto): string {
  const abre = `# >>> ANVILORE:${nome} (preenchido na release por scripts/embutir-instalador.ts; não edite)\n`;
  const fecha = `# <<< ANVILORE:${nome}\n`;
  if (dialeto === "ps1") return `${abre}${VARIAVEL_PS1[nome]} = @'\n${texto}'@\n${fecha}`;
  const { funcao, fim } = REGIOES[nome];
  const corpo = texto === "" ? "  :\n" : `  cat <<'${fim}'\n${texto}${fim}\n`;
  return `${abre}${funcao}() {\n${corpo}}\n${fecha}`;
}
const padrao = (nome: Nome) => new RegExp(`# >>> ANVILORE:${nome}[^\\n]*\\n[\\s\\S]*?# <<< ANVILORE:${nome}\\n`);

export function embutirInstalador(modelo: string, manifesto: string, assinantes: string, baseMinima: string, dialeto: Dialeto = "sh", opcoes: OpcoesUrl = {}): string {
  // A região URL_CONFIANCA é obrigatória: sem a consulta ao estado das chaves um instalador nunca a ganha depois.
  const urlConfianca = opcoes.urlConfianca ?? URL_CONFIANCA;
  const defeito = validarManifesto(manifesto) ?? validarAssinantes(assinantes) ?? validarBaseMinima(baseMinima) ?? validarUrlConfianca(urlConfianca, opcoes.urlDeTeste);
  if (defeito) throw new Error(defeito);
  let saida = modelo;
  for (const [nome, texto] of [["MANIFESTO", manifesto], ["ASSINANTES", assinantes], ["BASE_MINIMA", baseMinima], ["URL_CONFIANCA", `${urlConfianca}\n`]] as const) {
    const ruim = conteudoDaRegiao(nome, texto, dialeto);
    if (ruim) throw new Error(`${nome.toLowerCase()}: ${ruim}.`);
    if (!padrao(nome).test(saida)) throw new Error(`o modelo não tem a marca "# >>> ANVILORE:${nome}" e a de fechamento.`);
    saida = saida.replace(padrao(nome), () => regiao(nome, texto, dialeto));
  }
  return saida;
}

export function lerEmbutidos(script: string, dialeto: Dialeto = "sh"): { manifesto: string; assinantes: string; baseMinima: string; urlConfianca: string } {
  const ler = (nome: Nome) => {
    if (dialeto === "ps1") {
      // O texto embutido termina com "\n" e o here-string fecha na linha seguinte: o valor lido inclui esse "\n".
      const m = new RegExp(`# >>> ANVILORE:${nome}[^\\n]*\\n[^\\n]*= @'\\n([\\s\\S]*?)'@\\n# <<< ANVILORE:${nome}\\n`).exec(script);
      return m ? m[1]! : "";
    }
    const { fim } = REGIOES[nome];
    const m = new RegExp(`cat <<'${fim}'\\n([\\s\\S]*?)${fim}\\n`).exec(script);
    return m ? m[1]! : "";
  };
  return { manifesto: ler("MANIFESTO"), assinantes: ler("ASSINANTES"), baseMinima: ler("BASE_MINIMA"), urlConfianca: ler("URL_CONFIANCA") };
}

export function conferirEmbutidos(script: string, manifesto: string, assinantes: string, baseMinima: string, dialeto: Dialeto = "sh", opcoes: OpcoesUrl = {}): string[] {
  const dentro = lerEmbutidos(script, dialeto);
  const problemas: string[] = [];
  if (dentro.manifesto !== manifesto) problemas.push("manifesto embutido difere de instalador/dependencias.json.");
  if (dentro.assinantes !== assinantes) problemas.push("chave embutida difere de seguranca/assinantes.");
  if (dentro.baseMinima !== baseMinima) problemas.push("base mínima embutida difere de instalador/base-minima.");
  const esperada = opcoes.urlConfianca ?? URL_CONFIANCA;
  const ruim = validarUrlConfianca(esperada, opcoes.urlDeTeste);
  if (ruim) problemas.push(ruim);
  if (dentro.urlConfianca !== `${esperada}\n`) problemas.push(`URL de confiança embutida difere de ${esperada}.`);
  if (dentro.urlConfianca) {
    const embutida = validarUrlConfianca(dentro.urlConfianca.replace(/\n$/, ""), opcoes.urlDeTeste);
    if (embutida && !problemas.includes(embutida)) problemas.push(embutida);
  }
  return problemas;
}

const USO = `Uso: bun scripts/embutir-instalador.ts [--modelo instalador/instalar.sh] [--manifesto instalador/dependencias.json]
                                       [--assinantes seguranca/assinantes] [--base-minima instalador/base-minima] [--saida <arquivo>]
     bun scripts/embutir-instalador.ts --conferir <instalar.sh ou instalar.ps1 embutido> [--manifesto ...] [--assinantes ...] [--base-minima ...]
Gera o instalar.sh (ou, com --modelo instalador/instalar.ps1, o instalar.ps1) da release (manifesto, chave pública, base mínima e URL da lista de chaves embutidos) ou confere que um
instalar.sh/instalar.ps1 embutido é igual aos arquivos do repositório. Sem uma base mínima X.Y.Z válida, não gera.
A URL da lista de chaves do site é a constante de src/lib/confianca.ts (sempre https); o modelo sem a região URL_CONFIANCA é recusado.
Só para teste: --url-confianca http://127.0.0.1:<porta>/... com --aceitar-url-de-teste (loopback; qualquer outro http é recusado).`;

export async function comandoEmbutir(args: string[]): Promise<number> {
  let v: ReturnType<typeof parseArgs>["values"];
  try {
    v = parseArgs({ args, options: { modelo: { type: "string" }, manifesto: { type: "string" }, assinantes: { type: "string" }, "base-minima": { type: "string" }, saida: { type: "string" }, conferir: { type: "string" }, "url-confianca": { type: "string" }, "aceitar-url-de-teste": { type: "boolean" }, help: { type: "boolean" } }, strict: true, allowPositionals: false }).values;
  } catch (e) { console.error(`${(e as Error).message}\n${USO}`); return 2; }
  if (v.help) { console.log(USO); return 0; }
  const caminho = (valor: unknown, padrao: string) => resolve(raiz, typeof valor === "string" ? valor : padrao);
  try {
    const lerTexto = async (arquivo: string, rotulo: string) => {
      try { return await readFile(arquivo, "utf8"); }
      catch (e) { throw new Error(`${rotulo}: não consegui ler ${arquivo} (${(e as NodeJS.ErrnoException).code ?? "erro"}).`); }
    };
    const url: OpcoesUrl = { urlConfianca: typeof v["url-confianca"] === "string" ? v["url-confianca"] : URL_CONFIANCA, urlDeTeste: v["aceitar-url-de-teste"] === true };
    const manifesto = await lerTexto(caminho(v.manifesto, "instalador/dependencias.json"), "manifesto");
    const assinantes = await lerTexto(caminho(v.assinantes, "seguranca/assinantes"), "assinantes");
    const baseMinima = await lerTexto(caminho(v["base-minima"], "instalador/base-minima"), "base mínima");
    if (typeof v.conferir === "string") {
      const dialeto = dialetoDe(v.conferir), rotulo = dialeto === "ps1" ? "instalar.ps1" : "instalar.sh";
      const problemas = conferirEmbutidos(await lerTexto(resolve(v.conferir), rotulo), manifesto, assinantes, baseMinima, dialeto, url);
      if (problemas.length) { for (const p of problemas) console.error(p); return 1; }
      console.log(`${rotulo}: manifesto, chave e base mínima embutidos conferem com os arquivos.`);
      return 0;
    }
    const arquivoModelo = caminho(v.modelo, "instalador/instalar.sh");
    const dialeto = dialetoDe(arquivoModelo);
    const pronto = embutirInstalador(await lerTexto(arquivoModelo, "modelo"), manifesto, assinantes, baseMinima, dialeto, url);
    const saida = caminho(v.saida, dialeto === "ps1" ? "dist/instalar.ps1" : "dist/instalar.sh");
    await mkdir(dirname(saida), { recursive: true });
    await writeFile(saida, pronto, { mode: 0o755 });
    console.log(`${dialeto === "ps1" ? "instalar.ps1" : "instalar.sh"} gravado em ${saida}`);
    return 0;
  } catch (e) { console.error((e as Error).message); return 1; }
}

if (import.meta.main) process.exit(await comandoEmbutir(process.argv.slice(2)));
