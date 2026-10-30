import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

// PLANO §2 passo 4 e §4 "Integridade e assinatura": o instalar.sh precisa do manifesto de dependências e da chave
// pública ANTES de clonar o kit, então o build da release os embute no script. Este é o mecanismo; a U5 só o chama.
// O modelo (instalador/instalar.sh) traz duas regiões vazias, entre marcas `# >>> ANVILORE:<NOME>` e
// `# <<< ANVILORE:<NOME>`; sem chave embutida válida o script recusa instalar (nada aqui é placeholder de confiança).
// O instalar.ps1 (U4) usa as mesmas marcas, com a região escrita como here-string do PowerShell (`@'`...`'@`); o dialeto
// vem da extensão do arquivo e, nas funções, do último argumento (padrão: sh).

const raiz = resolve(import.meta.dir, "..");
const REGIOES = {
  MANIFESTO: { funcao: "manifesto_embutido", fim: "ANVILORE_FIM_MANIFESTO" },
  ASSINANTES: { funcao: "assinantes_embutidas", fim: "ANVILORE_FIM_ASSINANTES" },
} as const;
type Nome = keyof typeof REGIOES;
export type Dialeto = "sh" | "ps1";
const VARIAVEL_PS1: Record<Nome, string> = { MANIFESTO: "$script:AnvManifestoEmbutido", ASSINANTES: "$script:AnvAssinantesEmbutido" };
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

export function embutirInstalador(modelo: string, manifesto: string, assinantes: string, dialeto: Dialeto = "sh"): string {
  const defeito = validarManifesto(manifesto) ?? validarAssinantes(assinantes);
  if (defeito) throw new Error(defeito);
  let saida = modelo;
  for (const [nome, texto] of [["MANIFESTO", manifesto], ["ASSINANTES", assinantes]] as const) {
    const ruim = conteudoDaRegiao(nome, texto, dialeto);
    if (ruim) throw new Error(`${nome.toLowerCase()}: ${ruim}.`);
    if (!padrao(nome).test(saida)) throw new Error(`o modelo não tem a marca "# >>> ANVILORE:${nome}" e a de fechamento.`);
    saida = saida.replace(padrao(nome), () => regiao(nome, texto, dialeto));
  }
  return saida;
}

export function lerEmbutidos(script: string, dialeto: Dialeto = "sh"): { manifesto: string; assinantes: string } {
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
  return { manifesto: ler("MANIFESTO"), assinantes: ler("ASSINANTES") };
}

export function conferirEmbutidos(script: string, manifesto: string, assinantes: string, dialeto: Dialeto = "sh"): string[] {
  const dentro = lerEmbutidos(script, dialeto);
  const problemas: string[] = [];
  if (dentro.manifesto !== manifesto) problemas.push("manifesto embutido difere de instalador/dependencias.json.");
  if (dentro.assinantes !== assinantes) problemas.push("chave embutida difere de seguranca/assinantes.");
  return problemas;
}

const USO = `Uso: bun scripts/embutir-instalador.ts [--modelo instalador/instalar.sh] [--manifesto instalador/dependencias.json]
                                       [--assinantes seguranca/assinantes] [--saida <arquivo>]
     bun scripts/embutir-instalador.ts --conferir <instalar.sh ou instalar.ps1 embutido> [--manifesto ...] [--assinantes ...]
Gera o instalar.sh (ou, com --modelo instalador/instalar.ps1, o instalar.ps1) da release (manifesto e chave pública embutidos) ou confere que um instalar.sh embutido
é igual aos arquivos do repositório.`;

export async function comandoEmbutir(args: string[]): Promise<number> {
  let v: ReturnType<typeof parseArgs>["values"];
  try {
    v = parseArgs({ args, options: { modelo: { type: "string" }, manifesto: { type: "string" }, assinantes: { type: "string" }, saida: { type: "string" }, conferir: { type: "string" }, help: { type: "boolean" } }, strict: true, allowPositionals: false }).values;
  } catch (e) { console.error(`${(e as Error).message}\n${USO}`); return 2; }
  if (v.help) { console.log(USO); return 0; }
  const caminho = (valor: unknown, padrao: string) => resolve(raiz, typeof valor === "string" ? valor : padrao);
  try {
    const lerTexto = async (arquivo: string, rotulo: string) => {
      try { return await readFile(arquivo, "utf8"); }
      catch (e) { throw new Error(`${rotulo}: não consegui ler ${arquivo} (${(e as NodeJS.ErrnoException).code ?? "erro"}).`); }
    };
    const manifesto = await lerTexto(caminho(v.manifesto, "instalador/dependencias.json"), "manifesto");
    const assinantes = await lerTexto(caminho(v.assinantes, "seguranca/assinantes"), "assinantes");
    if (typeof v.conferir === "string") {
      const dialeto = dialetoDe(v.conferir), rotulo = dialeto === "ps1" ? "instalar.ps1" : "instalar.sh";
      const problemas = conferirEmbutidos(await lerTexto(resolve(v.conferir), rotulo), manifesto, assinantes, dialeto);
      if (problemas.length) { for (const p of problemas) console.error(p); return 1; }
      console.log(`${rotulo}: manifesto e chave embutidos conferem com os arquivos.`);
      return 0;
    }
    const arquivoModelo = caminho(v.modelo, "instalador/instalar.sh");
    const dialeto = dialetoDe(arquivoModelo);
    const pronto = embutirInstalador(await lerTexto(arquivoModelo, "modelo"), manifesto, assinantes, dialeto);
    const saida = caminho(v.saida, dialeto === "ps1" ? "dist/instalar.ps1" : "dist/instalar.sh");
    await mkdir(dirname(saida), { recursive: true });
    await writeFile(saida, pronto, { mode: 0o755 });
    console.log(`${dialeto === "ps1" ? "instalar.ps1" : "instalar.sh"} gravado em ${saida}`);
    return 0;
  } catch (e) { console.error((e as Error).message); return 1; }
}

if (import.meta.main) process.exit(await comandoEmbutir(process.argv.slice(2)));
