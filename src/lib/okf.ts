import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export type TipoDeRecurso = "url" | "caminho" | "descritor";

export type Proveniencia = {
  erros: string[];
  vencida: boolean;
  geradaAposVerificacao: boolean;
  aprovadaPorHumano: boolean | null;
};

type Mapa = Record<string, unknown>;

const ATOR = /^(human:[a-z0-9_-]+|process:[a-z0-9_-]+|[a-z0-9_-]+\/[a-z0-9._-]+)$/i;
const ATOR_HUMANO = /^human:[a-z0-9_-]+$/i;
// As formas que o PyYAML do validador antigo convertia em datetime com offset: separador T, t ou
// espaço, mês/dia/hora com um ou dois dígitos, fração de segundo e fuso `Z`, `±H`, `±HH` ou
// `±HH:MM` (com espaços antes). `+0300`, sem fuso, ou só data continuavam fora.
const TIMESTAMP_COM_OFFSET = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[Tt]|\s+)(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d*))?\s*(?:(Z)|([+-])(\d{1,2})(?::(\d{2}))?)$/;
const DATA_LEGADA = /^\d{4}-\d{2}-\d{2}$/;
// Esquema de URI. `C:\notas.md` casa de propósito: a letra de unidade vira url, como no baseline.
const ESQUEMA_DE_URI = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const EXTENSAO_DE_ARQUIVO = /\.[A-Za-z][A-Za-z0-9]{0,7}$/;

function ehMapa(valor: unknown): valor is Mapa {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

// Regra do SCHEMA.md (Perfil de proveniência): o esquema de URI vence; depois a forma de
// caminho (barra ou extensão); o resto é descritor. O espaço em branco não entra na decisão.
export function classificarRecurso(valor: string): TipoDeRecurso {
  if (ESQUEMA_DE_URI.test(valor)) return "url";
  if (valor.includes("/") || EXTENSAO_DE_ARQUIVO.test(valor)) return "caminho";
  return "descritor";
}

// Caminhos do vault são relativos à raiz do repositório (o pai de wiki/), onde raw/ e wiki/
// vivem lado a lado. Devolve o motivo da reprovação ou null.
export function problemaDoRecurso(valor: string, raiz: string): string | null {
  if (classificarRecurso(valor) !== "caminho") return null;
  const raizAbsoluta = resolve(raiz);
  const candidato = resolve(raizAbsoluta, valor);
  const caminhoRelativo = relative(raizAbsoluta, candidato);
  if (isAbsolute(caminhoRelativo) || caminhoRelativo === ".." || caminhoRelativo.startsWith("../") || caminhoRelativo.startsWith("..\\")) {
    return "fora da raiz do repositorio";
  }
  return existsSync(candidato) ? null : "inexistente";
}

export function validarRecurso(valor: string, raiz: string): boolean {
  return problemaDoRecurso(valor, raiz) === null;
}

function diasDoMes(ano: number, mes: number): number {
  if (mes === 2) return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(mes) ? 30 : 31;
}

type DataPrecisa = { segundos: number; fracao: string };
type Instante = { erro: string } | { data: DataPrecisa };

function compararInstantes(a: DataPrecisa, b: DataPrecisa): number {
  if (a.segundos !== b.segundos) return a.segundos - b.segundos;
  // Compare todos os dígitos aceitos, inclusive além dos milissegundos e nanossegundos.
  const tamanho = Math.max(a.fracao.length, b.fracao.length);
  const esquerda = a.fracao.padEnd(tamanho, "0");
  const direita = b.fracao.padEnd(tamanho, "0");
  return esquerda === direita ? 0 : esquerda < direita ? -1 : 1;
}

// ISO 8601 com offset explícito. Formato certo e calendário impossível também reprova:
// um campo presente e malformado nunca vira "sem data" em silêncio.
function lerTimestamp(valor: unknown, campo: string, arquivo: string): Instante {
  const texto = String(valor);
  const partes = TIMESTAMP_COM_OFFSET.exec(texto);
  if (partes === null) return { erro: `${campo} sem offset explicito: ${arquivo} (valor: ${texto})` };
  const [ano, mes, dia, hora, minuto, segundo, offsetHoras, offsetMinutos] = [1, 2, 3, 4, 5, 6, 10, 11].map((i) => Number(partes[i] ?? 0));
  const sinal = partes[9] === "-" ? -1 : 1;
  const valido =
    mes! >= 1 && mes! <= 12 && dia! >= 1 && dia! <= diasDoMes(ano!, mes!) &&
    hora! <= 23 && minuto! <= 59 && segundo! <= 59 && offsetHoras! <= 23 && offsetMinutos! <= 59;
  if (!valido) return { erro: `${campo} com data invalida: ${arquivo} (valor: ${texto})` };
  const utc = Date.UTC(ano!, mes! - 1, dia!, hora!, minuto!, segundo!);
  return { data: { segundos: utc / 1000 - sinal * (offsetHoras! * 60 + offsetMinutos!) * 60, fracao: partes[7] ?? "" } };
}

export function timestampValido(valor: unknown): boolean {
  return !("erro" in lerTimestamp(valor, "timestamp", "pagina"));
}

function lerAtor(valor: unknown, campo: string, arquivo: string): string | null {
  return typeof valor === "string" && ATOR.test(valor) ? null : `${campo} fora da convencao de atores: ${arquivo} (valor: ${String(valor)})`;
}

function validarFontes(fontes: unknown, arquivo: string, raiz: string): string[] {
  if (!Array.isArray(fontes)) return [`sources deve ser lista: ${arquivo}`];
  const erros: string[] = [];
  fontes.forEach((fonte: unknown, i) => {
    if (!ehMapa(fonte)) {
      erros.push(`sources[${i}] deve ser mapping: ${arquivo}`);
      return;
    }
    if (!("resource" in fonte)) {
      erros.push(`sources[${i}] sem resource: ${arquivo}`);
    } else if (typeof fonte.resource !== "string" && typeof fonte.resource !== "number") {
      erros.push(`sources[${i}].resource deve ser texto: ${arquivo}`);
    } else {
      const valor = String(fonte.resource);
      const problema = problemaDoRecurso(valor, raiz);
      if (problema !== null) erros.push(`sources[].resource ${problema}: ${arquivo} (caminho: ${valor})`);
    }
    if ("author" in fonte) {
      const erro = lerAtor(fonte.author, `sources[${i}].author`, arquivo);
      if (erro !== null) erros.push(erro);
    }
    if ("last_modified" in fonte) {
      const lido = lerTimestamp(fonte.last_modified, `sources[${i}].last_modified`, arquivo);
      if ("erro" in lido) erros.push(lido.erro);
    }
  });
  return erros;
}

type Verificacoes = { erros: string[]; humanas: (DataPrecisa | null)[]; ultima: DataPrecisa | null };

function lerVerificacoes(verified: unknown, arquivo: string): Verificacoes {
  const resultado: Verificacoes = { erros: [], humanas: [], ultima: null };
  const lista = ehMapa(verified) ? [verified] : verified;
  if (!Array.isArray(lista)) {
    resultado.erros.push(`verified deve ser mapping ou lista: ${arquivo}`);
    return resultado;
  }
  lista.forEach((entrada: unknown, i) => {
    if (!ehMapa(entrada)) {
      resultado.erros.push(`verified[${i}] deve ser mapping: ${arquivo}`);
      return;
    }
    let quando: DataPrecisa | null = null;
    if ("at" in entrada) {
      const lido = lerTimestamp(entrada.at, `verified[${i}].at`, arquivo);
      if ("erro" in lido) resultado.erros.push(lido.erro);
      else {
        quando = lido.data;
        if (resultado.ultima === null || compararInstantes(quando, resultado.ultima) > 0) resultado.ultima = quando;
      }
    }
    if (!("by" in entrada)) {
      resultado.erros.push(`verified[${i}] sem by: ${arquivo}`);
      return;
    }
    const erro = lerAtor(entrada.by, `verified[${i}].by`, arquivo);
    if (erro !== null) resultado.erros.push(erro);
    else if (ATOR_HUMANO.test(String(entrada.by))) resultado.humanas.push(quando);
  });
  return resultado;
}

// Valida os campos de proveniência do frontmatter. Só reprova campo presente e malformado;
// vencimento e "gerada depois da última verificação" são métricas. Única exceção que reprova
// por falta de campo: página com `generated` em mapping exige uma verificação humana nunca
// anterior à geração (R28). Quem escreve `verified: human:...` não é provado por programa nenhum.
export function validarProveniencia(frontmatter: Mapa, arquivo: string, raiz: string, agora: Date = new Date(), portaoHumano = true): Proveniencia {
  const erros: string[] = [];
  let vencida = false;

  if (frontmatter.sources != null) erros.push(...validarFontes(frontmatter.sources, arquivo, raiz));

  const generated = frontmatter.generated;
  let geradoEm: DataPrecisa | null = null;
  const geradaEmMapa = ehMapa(generated);
  // Só a data legada AAAA-MM-DD é isenta; qualquer outro `generated` que não seja o mapping
  // {by, at} reprova, para o portão humano não ser contornável por um campo malformado.
  if (portaoHumano && generated != null && !geradaEmMapa && !(typeof generated === "string" && DATA_LEGADA.test(generated))) {
    erros.push(`generated deve ser mapping (by, at) ou a data AAAA-MM-DD: ${arquivo}`);
  }
  if (geradaEmMapa) {
    if (!("by" in generated)) erros.push(`generated sem by: ${arquivo}`);
    else {
      const erro = lerAtor(generated.by, "generated.by", arquivo);
      if (erro !== null) erros.push(erro);
    }
    if ("at" in generated) {
      const lido = lerTimestamp(generated.at, "generated.at", arquivo);
      if ("erro" in lido) erros.push(lido.erro);
      else geradoEm = lido.data;
    }
  }
  // generated escalar (data AAAA-MM-DD do formato legado) não é proveniência: fica de fora.

  const verificacoes: Verificacoes = frontmatter.verified != null
    ? lerVerificacoes(frontmatter.verified, arquivo)
    : { erros: [], humanas: [], ultima: null };
  erros.push(...verificacoes.erros);

  if (frontmatter.stale_after != null) {
    const lido = lerTimestamp(frontmatter.stale_after, "stale_after", arquivo);
    if ("erro" in lido) erros.push(lido.erro);
    else vencida = compararInstantes({ segundos: Math.floor(agora.getTime() / 1000), fracao: String(agora.getUTCMilliseconds()).padStart(3, "0") }, lido.data) >= 0;
  }

  const aprovadaPorHumano = geradaEmMapa
    ? verificacoes.humanas.some((quando) => geradoEm === null || (quando !== null && compararInstantes(quando, geradoEm) >= 0))
    : null;
  if (portaoHumano && aprovadaPorHumano === false) erros.push(`página gerada sem aprovação humana: ${arquivo}`);

  const geradaAposVerificacao = geradoEm !== null && verificacoes.ultima !== null && compararInstantes(geradoEm, verificacoes.ultima) > 0;
  return { erros, vencida, geradaAposVerificacao, aprovadaPorHumano };
}

export function estadoAprovacaoHumana(frontmatter: Mapa): "ausente" | "antiga" | "vigente" | "invalida" {
  const gerada = frontmatter.generated;
  if (!ehMapa(gerada) || !("at" in gerada)) return "invalida";
  const generated = lerTimestamp(gerada.at, "generated.at", "pagina");
  if ("erro" in generated) return "invalida";
  const verificacoes = frontmatter.verified == null
    ? { erros: [], humanas: [], ultima: null }
    : lerVerificacoes(frontmatter.verified, "pagina");
  if (verificacoes.erros.length) return "invalida";
  if (verificacoes.humanas.some(data => data !== null && compararInstantes(data, generated.data) >= 0)) return "vigente";
  return verificacoes.humanas.length ? "antiga" : "ausente";
}
