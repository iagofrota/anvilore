import { createHash } from "node:crypto";

// Estado das chaves fora do GitHub (PARECER-SOL-DECISOES-RELEASE.md §2). O dono publica num site seu um arquivo pequeno
// com as chaves de assinatura que ainda valem e a versão mínima; o atualizador consulta antes de aceitar uma versão e só
// vale a INTERSEÇÃO com as chaves em que a pasta já confiava (o site nunca acrescenta uma chave). Revogar é retirar a
// fingerprint da lista.
//
// A URL é constante de build: nada aqui lê o ambiente (uma variável herdada trocaria a âncora de confiança sem querer).
// Sem cache local e sem fallback offline: se a consulta falha, a atualização para e a versão instalada fica.
export const URL_CONFIANCA = "https://anvilore.iagofrota.com.br/confianca.json";
export const TEMPO_LIMITE_MS = 15_000;
export const TAMANHO_MAXIMO = 64 * 1024;

export type Confianca = { formato: 1; chaves: string[]; versaoMinima: string };
// Mesma forma do `fetch`; o atualizador injeta outra nos testes (nunca a rede real).
export type BuscarConfianca = (url: string, init: RequestInit) => Promise<Response>;

const FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}$/;
// Até 9 dígitos por número, o mesmo limite do instalar.sh e do instalar.ps1: o que um recusa, os três recusam.
const VERSAO_MINIMA = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
const CAMPOS = ["chaves", "formato", "versaoMinima"];

export const mensagemDeFalhaDaConsulta = `não consegui conferir a lista atual de chaves em ${URL_CONFIANCA}; nada mudou; tente de novo mais tarde`;

// `JSON.parse` fica com a última de duas propriedades de mesmo nome e `Object.keys` já não mostra a repetição; uma lista
// ambígua tem de falhar fechada (o instalar.sh também recusa). Varre o texto, já válido como JSON, guardando os nomes de
// cada objeto; o nome é decodificado, então "versaoMinima" conta como repetição de "versaoMinima".
function temNomeRepetido(texto: string): boolean {
  const nomes: (Set<string> | null)[] = [];
  const cadeia = /"(?:[^"\\]|\\.)*"/y;
  let esperaNome = false;
  for (let i = 0; i < texto.length; ) {
    const c = texto[i]!;
    if (c === '"') {
      cadeia.lastIndex = i;
      const m = cadeia.exec(texto)!;
      i += m[0].length;
      const topo = nomes[nomes.length - 1];
      if (esperaNome && topo) {
        const nome = JSON.parse(m[0]) as string;
        if (topo.has(nome)) return true;
        topo.add(nome);
        esperaNome = false;
      }
      continue;
    }
    if (c === "{") { nomes.push(new Set()); esperaNome = true; }
    else if (c === "[") { nomes.push(null); esperaNome = false; }
    else if (c === "}" || c === "]") { nomes.pop(); esperaNome = false; }
    else if (c === ",") esperaNome = nomes[nomes.length - 1] instanceof Set;
    i++;
  }
  return false;
}

// Validação estrita: campo extra, nome repetido, tipo errado ou formato desconhecido recusam.
export function validarConfianca(texto: string): Confianca {
  let valor: unknown;
  try { valor = JSON.parse(texto); } catch { throw new Error("não é JSON válido"); }
  if (temNomeRepetido(texto)) throw new Error("nome de campo repetido");
  if (texto.includes("\\")) throw new Error("escape não permitido");
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) throw new Error("não é um objeto");
  const o = valor as Record<string, unknown>;
  if (Object.keys(o).sort().join() !== CAMPOS.join()) throw new Error("campos diferentes de formato, chaves e versaoMinima");
  if (o.formato !== 1) throw new Error(`formato ${JSON.stringify(o.formato)} desconhecido`);
  if (!Array.isArray(o.chaves) || o.chaves.length === 0) throw new Error("chaves vazia");
  if (!o.chaves.every(c => typeof c === "string" && FINGERPRINT.test(c))) throw new Error("fingerprint fora do formato SHA256:<base64>");
  if (new Set(o.chaves).size !== o.chaves.length) throw new Error("chaves repetidas");
  if (typeof o.versaoMinima !== "string" || !VERSAO_MINIMA.test(o.versaoMinima)) throw new Error("versaoMinima não é SemVer sem pré-release");
  return { formato: 1, chaves: o.chaves as string[], versaoMinima: o.versaoMinima };
}

async function lerCorpo(resposta: Response): Promise<string> {
  const declarado = Number(resposta.headers.get("content-length") ?? 0);
  if (declarado > TAMANHO_MAXIMO) throw new Error("resposta maior que o limite");
  const partes: Uint8Array[] = [];
  let total = 0;
  const leitor = resposta.body?.getReader();
  for (;;) {
    const passo = await leitor?.read();
    if (!passo || passo.done) break;
    total += passo.value.byteLength;
    if (total > TAMANHO_MAXIMO) { await leitor!.cancel(); throw new Error("resposta maior que o limite"); }
    partes.push(passo.value);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(partes));
}

async function buscarEValidar(buscar: BuscarConfianca, sinal: AbortSignal): Promise<Confianca> {
  const resposta = await buscar(URL_CONFIANCA, {
    method: "GET",
    // Redirecionamento é recusa, não é seguido. Sem cache: a resposta tem de vir do site agora.
    redirect: "manual",
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    signal: sinal,
  });
  if (resposta.status !== 200 || resposta.redirected) throw new Error(`HTTP ${resposta.status}`);
  return validarConfianca(await lerCorpo(resposta));
}

export async function consultarConfianca(buscar: BuscarConfianca = (url, init) => fetch(url, init), opcoes: { tempoLimiteMs?: number } = {}): Promise<Confianca> {
  const controle = new AbortController();
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<never>((_, recusar) => {
    relogio = setTimeout(() => { controle.abort(); recusar(new Error("tempo limite")); }, opcoes.tempoLimiteMs ?? TEMPO_LIMITE_MS);
  });
  try { return await Promise.race([buscarEValidar(buscar, controle.signal), limite]); }
  catch (e) { throw new Error(mensagemDeFalhaDaConsulta, { cause: e }); }
  finally { clearTimeout(relogio); }
}

const TIPOS_DE_CHAVE = /^(?:ssh-(?:ed25519|rsa)|ecdsa-sha2-nistp\d+|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

// Fingerprint no formato do `ssh-keygen -lf` (SHA256 do blob da chave, base64 sem preenchimento) de uma linha OpenSSH
// allowed_signers: principal [opções] tipo chave-base64 [comentário]. Calculada aqui para não depender de um binário.
export function fingerprintsDaLinha(linha: string): string | undefined {
  const t = linha.trim();
  if (t === "" || t.startsWith("#")) return undefined;
  // Aspas protegem espaços dentro das opções.
  const palavras = t.match(/(?:[^\s"]|"[^"]*")+/g) ?? [];
  for (let i = 1; i + 1 < palavras.length; i++) {
    if (!TIPOS_DE_CHAVE.test(palavras[i]!)) continue;
    const base64 = palavras[i + 1]!;
    if (!BASE64.test(base64)) return undefined;
    const blob = Buffer.from(base64, "base64");
    // O blob começa com o nome do tipo (tamanho de 4 bytes + texto): confere com o tipo declarado.
    if (blob.length < 4 || blob.readUInt32BE(0) !== palavras[i]!.length || blob.subarray(4, 4 + palavras[i]!.length).toString("latin1") !== palavras[i]) return undefined;
    return `SHA256:${createHash("sha256").update(blob).digest("base64").replace(/=+$/, "")}`;
  }
  return undefined;
}

// Só as linhas das âncoras cuja fingerprint está na lista. O resultado vira o allowed_signers temporário do verify-tag.
export function filtrarAssinantes(texto: string, chaves: readonly string[]): string {
  const permitidas = new Set(chaves);
  return texto.split("\n").map(l => l.replace(/\r$/, "")).filter(linha => {
    const fp = fingerprintsDaLinha(linha);
    return fp !== undefined && permitidas.has(fp);
  }).map(l => `${l}\n`).join("");
}
