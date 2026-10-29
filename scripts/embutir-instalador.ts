import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

// PLANO §2 passo 4 e §4 "Integridade e assinatura": o instalar.sh precisa do manifesto de dependências e da chave
// pública ANTES de clonar o kit, então o build da release os embute no script. Este é o mecanismo; a U5 só o chama.
// O modelo (instalador/instalar.sh) traz duas regiões vazias, entre marcas `# >>> ANVILORE:<NOME>` e
// `# <<< ANVILORE:<NOME>`; sem chave embutida válida o script recusa instalar (nada aqui é placeholder de confiança).

const raiz = resolve(import.meta.dir, "..");
const REGIOES = {
  MANIFESTO: { funcao: "manifesto_embutido", fim: "ANVILORE_FIM_MANIFESTO" },
  ASSINANTES: { funcao: "assinantes_embutidas", fim: "ANVILORE_FIM_ASSINANTES" },
} as const;
type Nome = keyof typeof REGIOES;

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

function conteudoDaRegiao(nome: Nome, texto: string): string | undefined {
  if (texto === "") return undefined;
  if (!texto.endsWith("\n")) return "o conteúdo precisa terminar com quebra de linha";
  if (texto.split("\n").some(l => l === REGIOES[nome].fim)) return "o conteúdo contém a linha que fecha o heredoc";
  return undefined;
}

function regiao(nome: Nome, texto: string): string {
  const { funcao, fim } = REGIOES[nome];
  const corpo = texto === "" ? "  :\n" : `  cat <<'${fim}'\n${texto}${fim}\n`;
  return `# >>> ANVILORE:${nome} (preenchido na release por scripts/embutir-instalador.ts; não edite)\n${funcao}() {\n${corpo}}\n# <<< ANVILORE:${nome}\n`;
}
const padrao = (nome: Nome) => new RegExp(`# >>> ANVILORE:${nome}[^\\n]*\\n[\\s\\S]*?# <<< ANVILORE:${nome}\\n`);

export function embutirInstalador(modelo: string, manifesto: string, assinantes: string): string {
  const defeito = validarManifesto(manifesto) ?? validarAssinantes(assinantes);
  if (defeito) throw new Error(defeito);
  let saida = modelo;
  for (const [nome, texto] of [["MANIFESTO", manifesto], ["ASSINANTES", assinantes]] as const) {
    const ruim = conteudoDaRegiao(nome, texto);
    if (ruim) throw new Error(`${nome.toLowerCase()}: ${ruim}.`);
    if (!padrao(nome).test(saida)) throw new Error(`o modelo não tem a marca "# >>> ANVILORE:${nome}" e a de fechamento.`);
    saida = saida.replace(padrao(nome), () => regiao(nome, texto));
  }
  return saida;
}

export function lerEmbutidos(script: string): { manifesto: string; assinantes: string } {
  const ler = (nome: Nome) => {
    const { fim } = REGIOES[nome];
    const m = new RegExp(`cat <<'${fim}'\\n([\\s\\S]*?)${fim}\\n`).exec(script);
    return m ? m[1]! : "";
  };
  return { manifesto: ler("MANIFESTO"), assinantes: ler("ASSINANTES") };
}

export function conferirEmbutidos(script: string, manifesto: string, assinantes: string): string[] {
  const dentro = lerEmbutidos(script);
  const problemas: string[] = [];
  if (dentro.manifesto !== manifesto) problemas.push("manifesto embutido difere de instalador/dependencias.json.");
  if (dentro.assinantes !== assinantes) problemas.push("chave embutida difere de seguranca/assinantes.");
  return problemas;
}

const USO = `Uso: bun scripts/embutir-instalador.ts [--modelo instalador/instalar.sh] [--manifesto instalador/dependencias.json]
                                       [--assinantes seguranca/assinantes] [--saida <arquivo>]
     bun scripts/embutir-instalador.ts --conferir <instalar.sh embutido> [--manifesto ...] [--assinantes ...]
Gera o instalar.sh da release (manifesto e chave pública embutidos) ou confere que um instalar.sh embutido
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
      const problemas = conferirEmbutidos(await lerTexto(resolve(v.conferir), "instalar.sh"), manifesto, assinantes);
      if (problemas.length) { for (const p of problemas) console.error(p); return 1; }
      console.log("instalar.sh: manifesto e chave embutidos conferem com os arquivos.");
      return 0;
    }
    const pronto = embutirInstalador(await lerTexto(caminho(v.modelo, "instalador/instalar.sh"), "modelo"), manifesto, assinantes);
    const saida = caminho(v.saida, "dist/instalar.sh");
    await mkdir(dirname(saida), { recursive: true });
    await writeFile(saida, pronto, { mode: 0o755 });
    console.log(`instalar.sh gravado em ${saida}`);
    return 0;
  } catch (e) { console.error((e as Error).message); return 1; }
}

if (import.meta.main) process.exit(await comandoEmbutir(process.argv.slice(2)));
