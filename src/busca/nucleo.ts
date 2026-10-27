import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import { montarConsulta } from "./consulta";
import { abrirIndice, sincronizar, type RelatorioIndexacao } from "./indice";
import { linhasDe } from "../lib/frontmatter";
import { estaEmRaw } from "../lib/caminhos";
import { paginasMarkdown } from "../lib/paginas";
import { ErroDeEncoding, lerUtf8Estrito } from "../lib/utf8";
import { abrirMetricas, type Chamada, type RelatorioMetricas, type RegistroDeMetricas } from "./metricas";
import type { Aviso, CodigoErro, Endereco, ErroDeBusca, NucleoDeBusca, OpcoesBusca, RespostaBusca, ResumoDaWiki, Resultado, ResultadoOuErro, Trecho } from "./tipos";

type ContextoMetricas = { cliente?: { nome: string; versao: string }; conexao?: string; posicaoLida?: number | null; buscaId?: string };
type Config = { raiz: string; wiki: string; arquivoDb: string; agora?: () => Date; metricas?: RegistroDeMetricas; contextoMetricas?: () => ContextoMetricas };
type LinhaResultado = {
  id: number; caminho: string; slug: string; pagina_titulo: string; secao: string; linha_inicio: number; linha_fim: number; corpo: string;
  avisos: string; estado: string; vencida: number; stale_after: string | null; tipo: string | null; area: string | null; bm25: number; trecho: string | null;
};

function erro(codigo: CodigoErro, mensagem: string): { erro: ErroDeBusca } { return { erro: { codigo, mensagem } }; }
function falhaDeIndice(causa: unknown): { codigo: CodigoErro; mensagem: string } {
  if (causa instanceof ErroDeEncoding) return { codigo: "utf8_invalido", mensagem: "Uma página não contém UTF-8 válido." };
  const codigoOriginal = typeof causa === "object" && causa !== null && "code" in causa ? String((causa as { code: unknown }).code) : "";
  if (["EACCES", "EPERM", "EBUSY", "EEXIST", "ENOTDIR", "EROFS", "EMFILE", "SQLITE_BUSY", "SQLITE_LOCKED", "SQLITE_CANTOPEN", "SQLITE_PERM", "SQLITE_READONLY"].some((codigo) => codigoOriginal.includes(codigo))) return { codigo: "indice_indisponivel", mensagem: "O índice está ocupado ou sem permissão de acesso." };
  return { codigo: "indice_corrompido", mensagem: "Não foi possível consultar o índice local." };
}
function erroDeIndice(erroOriginal: unknown): boolean {
  const texto = erroOriginal instanceof Error ? erroOriginal.message.toLowerCase() : String(erroOriginal).toLowerCase();
  return texto.includes("not a database") || texto.includes("malformed") || texto.includes("sqlite_corrupt") || texto.includes("database disk image");
}
function apagarDb(arquivo: string): boolean {
  try {
    for (const sufixo of ["", "-wal", "-shm"]) rmSync(`${arquivo}${sufixo}`, { force: true });
    return true;
  } catch (causa) {
    const codigo = typeof causa === "object" && causa !== null && "code" in causa ? String((causa as { code: unknown }).code) : "";
    if (codigo === "EBUSY" || codigo === "EPERM" || codigo === "EACCES") return false;
    throw causa;
  }
}
async function comIndice<T>(arquivoDb: string, executar: (db: Database) => Promise<T> | T): Promise<T> {
  let tentativa = 0;
  while (true) {
    let db: Database | undefined;
    try {
      mkdirSync(resolve(arquivoDb, ".."), { recursive: true });
      db = abrirIndice(arquivoDb);
      const resultado = await executar(db);
      db.close();
      return resultado;
    } catch (causa) {
      try { db?.close(); } catch { /* o banco pode ter falhado durante open */ }
      if (tentativa === 0 && erroDeIndice(causa) && apagarDb(arquivoDb)) { tentativa++; continue; }
      throw causa;
    }
  }
}

function estado(valor: string): "manual" | "verificada" | "rascunho" {
  return valor === "manual" || valor === "verificada" ? valor : "rascunho";
}
function lerAvisos(valor: string): Aviso[] {
  return valor.split(",").filter((item): item is Aviso => item === "lacuna" || item === "contradicao");
}
function trechoComJanela(texto: string, limite = 200): string {
  const caracteres = Array.from(texto);
  const inicioMarca = caracteres.indexOf("\x1e");
  if (inicioMarca < 0) return caracteres.length > limite ? `${caracteres.slice(0, limite).join("")}…` : texto;
  const fimMarca = caracteres.indexOf("\x1f", inicioMarca + 1);
  let inicio = Math.max(0, inicioMarca - Math.floor(limite * 0.4));
  let fim = Math.min(caracteres.length, Math.max(inicio + limite, (fimMarca < 0 ? inicioMarca : fimMarca) + 1));
  if (fim - inicio > limite) inicio = fim - limite;
  return `${inicio > 0 ? "…" : ""}${caracteres.slice(inicio, fim).join("")}${fim < caracteres.length ? "…" : ""}`;
}
function caberNoOrcamento(resultado: Resultado, limite = 450): Resultado | null {
  while (Buffer.byteLength(JSON.stringify(resultado), "utf8") > limite && Array.from(resultado.trecho).length > 8) {
    const tamanho = Array.from(resultado.trecho).length;
    resultado.trecho = trechoComJanela(resultado.trecho, tamanho - 8);
  }
  const campos: Array<"titulo" | "secao" | "pagina" | "area"> = ["titulo", "secao", "pagina", "area"];
  while (Buffer.byteLength(JSON.stringify(resultado), "utf8") > limite) {
    const campo = campos.filter((nome) => resultado[nome] !== undefined).sort((a, b) => Array.from(resultado[b] ?? "").length - Array.from(resultado[a] ?? "").length)[0];
    if (!campo || Array.from(resultado[campo] ?? "").length < 9) return null;
    resultado[campo] = `${Array.from(resultado[campo]!).slice(0, -9).join("")}…`;
  }
  return resultado;
}
function autoridade(linha: LinhaResultado): number {
  let fator = linha.estado === "rascunho" ? 0.9 : 1.1;
  if (linha.vencida) fator *= 0.9;
  return Math.max(0.8, Math.min(1.2, fator));
}

function correspondeColuna(db: Database, rowid: number, coluna: "titulo" | "corpo" | "caminho", match: string): boolean {
  return db.query(`SELECT 1 FROM secoes_fts WHERE rowid = ? AND ${coluna} MATCH ? LIMIT 1`).get(rowid, match) !== null;
}

function raizWikiExiste(wiki: string): boolean {
  try { return statSync(wiki).isDirectory(); } catch { return false; }
}

function caminhoNormalizado(caminho: string): string {
  return caminho.replaceAll("\\", "/").normalize("NFC");
}

async function resolverArquivo(wiki: string, caminho: string): Promise<{ arquivo: string; relativo: string } | { erro: { erro: ErroDeBusca } }> {
  if (isAbsolute(caminho) || win32.isAbsolute(caminho) || /^[a-zA-Z]:/.test(caminho) || estaEmRaw(caminho)) {
    return { erro: erro("fora_da_wiki", "O caminho solicitado fica fora da wiki.") };
  }
  const pedido = caminhoNormalizado(caminho).replace(/^\.\//, "");
  if (pedido.split("/").includes("..") || pedido === "") {
    return { erro: erro("fora_da_wiki", "O caminho solicitado fica fora da wiki.") };
  }
  let encontrados: string[];
  try { encontrados = await paginasMarkdown(wiki); }
  catch { return { erro: erro("wiki_ausente", "A wiki não foi encontrada.") }; }
  const alvo = encontrados.find((arquivo) => caminhoNormalizado(relative(wiki, arquivo).split(sep).join("/")) === pedido);
  if (!alvo) return { erro: erro("arquivo_inexistente", "A página solicitada não existe na wiki.") };
  try {
    const realWiki = realpathSync(wiki);
    const realAlvo = realpathSync(alvo);
    const dentro = relative(realWiki, realAlvo);
    if (isAbsolute(dentro) || dentro === ".." || dentro.startsWith(`..${sep}`) || estaEmRaw(dentro)) {
      return { erro: erro("fora_da_wiki", "O caminho solicitado fica fora da wiki.") };
    }
    return { arquivo: realAlvo, relativo: caminhoNormalizado(relative(realWiki, realAlvo).split(sep).join("/")) };
  } catch {
    return { erro: erro("arquivo_inexistente", "A página solicitada não existe na wiki.") };
  }
}

function resumoVazio(): ResumoDaWiki {
  return { paginas: 0, secoes: 0, porEstado: { manual: 0, verificada: 0, rascunho: 0 }, areas: [], titulos: [] };
}

export function criarNucleo(cfg: Config): NucleoDeBusca {
  const raiz = resolve(cfg.raiz);
  const wiki = resolve(cfg.wiki);
  const arquivoDb = resolve(cfg.arquivoDb);
  const agora = cfg.agora ?? (() => new Date());
  const conexao = randomUUID();

  function registrar(chamada: Chamada): void {
    try {
      const contexto = cfg.contextoMetricas?.();
      cfg.metricas?.registrar({
        ...chamada,
        conexao: contexto?.conexao ?? chamada.conexao,
        ...(contexto?.cliente ? { cliente: contexto.cliente } : {}),
        ...((chamada.tool === "buscar" || chamada.tool === "ler") && contexto?.buscaId ? { buscaId: contexto.buscaId } : {}),
        ...(chamada.tool === "ler" ? { posicaoLida: contexto?.posicaoLida ?? null } : {}),
      }, agora());
    } catch { /* telemetria local nunca interrompe a consulta */ }
  }
  function resumoDaChamada(resultados: Resultado[] = []): Chamada["porEstado"] {
    const porEstado: Chamada["porEstado"] = { manual: 0, verificada: 0, rascunho: 0 };
    for (const resultado of resultados) porEstado[resultado.estado]++;
    return porEstado;
  }
  async function indexar(opcoes: { completo?: boolean } = {}): Promise<RelatorioIndexacao> {
    const inicio = Date.now();
    const relatorio = await comIndice(arquivoDb, (db) => sincronizar(db, wiki, raiz, { ...opcoes, agora: agora() }));
    registrar({ tool: "indexar", ms: Date.now() - inicio, bytes: Buffer.byteLength(JSON.stringify(relatorio)), resultados: 0, vazia: relatorio.paginas === 0, palavras: 0, explicita: false, filtros: [], porEstado: { manual: 0, verificada: 0, rascunho: 0 }, comAviso: 0, reindexadas: relatorio.reindexadas, msReindexacao: relatorio.ms, conexao });
    return relatorio;
  }

  async function buscar(consulta: string, opcoes: OpcoesBusca = {}): Promise<ResultadoOuErro<RespostaBusca>> {
    const inicio = Date.now();
    if (!raizWikiExiste(wiki)) {
      const resposta = erro("wiki_ausente", "A wiki não foi encontrada.");
      registrar({ tool: "buscar", ms: Date.now() - inicio, bytes: Buffer.byteLength(JSON.stringify(resposta)), resultados: 0, vazia: true, palavras: consulta.trim().split(/\s+/u).filter(Boolean).length, explicita: false, filtros: [], porEstado: { manual: 0, verificada: 0, rascunho: 0 }, comAviso: 0, reindexadas: 0, msReindexacao: 0, erro: "wiki_ausente", conexao });
      return resposta;
    }
    try {
      return await comIndice(arquivoDb, async (db) => {
        const indexacao = await sincronizar(db, wiki, raiz, { agora: agora() });
        const montar = montarConsulta(consulta, (match) => {
          try { db.query("SELECT rowid FROM secoes_fts WHERE secoes_fts MATCH ? LIMIT 1").all(match); return true; }
          catch { return false; }
        });
        const limite = Math.max(1, Math.min(20, Math.trunc(opcoes.limite ?? 5)));
        if (montar.match === null) {
          const resposta: RespostaBusca = { consulta: consulta.normalize("NFC"), resultados: [], vazia: true, indice: { paginas: indexacao.paginas, secoes: indexacao.secoes, reindexadas: indexacao.reindexadas } };
          registrar({ tool: "buscar", ms: Date.now() - inicio, bytes: Buffer.byteLength(JSON.stringify(resposta)), resultados: 0, vazia: true, palavras: montar.palavras, explicita: montar.explicita, filtros: [], porEstado: { manual: 0, verificada: 0, rascunho: 0 }, comAviso: 0, reindexadas: indexacao.reindexadas, msReindexacao: indexacao.ms, conexao });
          return resposta;
        }
        const condicoes = [opcoes.incluir?.includes("log") ? "p.categoria IN ('conteudo', 'log')" : "p.categoria = 'conteudo'"];
        const parametros: string[] = [montar.match];
        if (opcoes.tipo?.length) { condicoes.push(`p.tipo IN (${opcoes.tipo.map(() => "?").join(",")})`); parametros.push(...opcoes.tipo); }
        if (opcoes.area?.length) { condicoes.push(`p.area IN (${opcoes.area.map(() => "?").join(",")})`); parametros.push(...opcoes.area.map((area) => area.normalize("NFC"))); }
        const linhas = db.query(`SELECT s.id, s.caminho, p.slug, p.titulo AS pagina_titulo, s.secao, s.linha_inicio, s.linha_fim, s.corpo, s.avisos, p.estado, p.vencida, p.stale_after, p.tipo, p.area, bm25(secoes_fts, 5.0, 1.0, 3.0) AS bm25, snippet(secoes_fts, 1, char(30), char(31), '…', 50) AS trecho
          FROM secoes_fts JOIN secoes s ON s.id = secoes_fts.rowid JOIN paginas p ON p.caminho = s.caminho
          WHERE secoes_fts MATCH ? AND ${condicoes.join(" AND ")} ORDER BY bm25 ASC, s.caminho COLLATE BINARY, s.linha_inicio`).all(...parametros) as LinhaResultado[];
        const agoraMs = agora().getTime();
        for (const linha of linhas) linha.vencida = linha.stale_after !== null && Number.isFinite(Date.parse(linha.stale_after)) && agoraMs >= Date.parse(linha.stale_after) ? 1 : 0;
        const selecionadas = linhas.sort((a, b) => (-b.bm25 * autoridade(b)) - (-a.bm25 * autoridade(a)) || (a.caminho < b.caminho ? -1 : a.caminho > b.caminho ? 1 : 0) || a.linha_inicio - b.linha_inicio).slice(0, limite);
        const resultados = selecionadas.map((linha) => {
          const fator = autoridade(linha);
          const corpoCasa = (linha.trecho ?? "").includes("\x1e");
          const resultado: Resultado = {
            caminho: linha.caminho.normalize("NFC").replaceAll("\\", "/"), linhaInicio: linha.linha_inicio, linhaFim: linha.linha_fim,
            pagina: linha.slug.normalize("NFC"), titulo: linha.pagina_titulo.normalize("NFC"), secao: linha.secao.normalize("NFC"),
            trecho: trechoComJanela(corpoCasa ? linha.trecho! : linha.corpo), estado: estado(linha.estado), vencida: Boolean(linha.vencida),
            avisos: lerAvisos(linha.avisos), score: -linha.bm25 * fator,
          };
          if (linha.tipo === "source" || linha.tipo === "concept" || linha.tipo === "entity") resultado.tipo = linha.tipo;
          if (linha.area) resultado.area = linha.area.normalize("NFC");
          if (opcoes.explicar) resultado.explicacao = {
            bm25: linha.bm25, autoridade: fator,
            colunas: (["titulo", "corpo", "caminho"] as const).filter((coluna) => correspondeColuna(db, linha.id, coluna, montar.match!)),
            termos: montar.termos,
          };
          return caberNoOrcamento(resultado);
        }).filter((resultado): resultado is Resultado => resultado !== null);
        const resposta: RespostaBusca = { consulta: consulta.normalize("NFC"), resultados, vazia: resultados.length === 0, indice: { paginas: indexacao.paginas, secoes: indexacao.secoes, reindexadas: indexacao.reindexadas } };
        const filtros = [opcoes.tipo?.length ? "tipo" : "", opcoes.area?.length ? "area" : "", opcoes.incluir?.length ? "incluir" : ""].filter(Boolean);
        registrar({ tool: "buscar", ms: Date.now() - inicio, bytes: Buffer.byteLength(JSON.stringify(resposta)), resultados: resposta.resultados.length, vazia: resposta.vazia, palavras: montar.palavras, explicita: montar.explicita, filtros, porEstado: resumoDaChamada(resposta.resultados), comAviso: resposta.resultados.filter((r) => r.avisos.length > 0).length, vencidas: resposta.resultados.filter((r) => r.vencida).length, lacunas: resposta.resultados.filter((r) => r.avisos.includes("lacuna")).length, contradicoes: resposta.resultados.filter((r) => r.avisos.includes("contradicao")).length, reindexadas: indexacao.reindexadas, msReindexacao: indexacao.ms, conexao });
        return resposta;
      });
    } catch (causa) {
      const falha = falhaDeIndice(causa); const resposta = erro(falha.codigo, falha.mensagem);
      registrar({ tool: "buscar", ms: Date.now() - inicio, bytes: Buffer.byteLength(JSON.stringify(resposta)), resultados: 0, vazia: true, palavras: consulta.trim().split(/\s+/u).filter(Boolean).length, explicita: false, filtros: [], porEstado: { manual: 0, verificada: 0, rascunho: 0 }, comAviso: 0, reindexadas: 0, msReindexacao: 0, erro: falha.codigo, conexao });
      return resposta;
    }
  }

  async function ler(endereco: Partial<Endereco> & { caminho: string }): Promise<ResultadoOuErro<Trecho>> {
    const inicio = Date.now();
    if (!raizWikiExiste(wiki)) {
      const resposta = erro("wiki_ausente", "A wiki não foi encontrada.");
      registrar({ tool: "ler", ms: Date.now() - inicio, bytes: Buffer.byteLength(JSON.stringify(resposta)), resultados: 0, vazia: false, palavras: 0, explicita: false, filtros: [], porEstado: { manual: 0, verificada: 0, rascunho: 0 }, comAviso: 0, reindexadas: 0, msReindexacao: 0, erro: "wiki_ausente", conexao, posicaoLida: null });
      return resposta;
    }
    const resolvido = await resolverArquivo(wiki, endereco.caminho);
    if ("erro" in resolvido) {
      const resposta = resolvido.erro;
      registrar({ tool: "ler", ms: Date.now() - inicio, bytes: Buffer.byteLength(JSON.stringify(resposta)), resultados: 0, vazia: false, palavras: 0, explicita: false, filtros: [], porEstado: { manual: 0, verificada: 0, rascunho: 0 }, comAviso: 0, reindexadas: 0, msReindexacao: 0, erro: resposta.erro.codigo, conexao, posicaoLida: null });
      return resposta;
    }
    try {
      return await comIndice(arquivoDb, async (db) => {
        await sincronizar(db, wiki, raiz, { agora: agora() });
        const wikiReal = realpathSync(wiki); const arquivoReal = realpathSync(resolvido.arquivo); const dentro = relative(wikiReal, arquivoReal);
        if (isAbsolute(dentro) || dentro === ".." || dentro.startsWith(`..${sep}`) || estaEmRaw(dentro)) return erro("fora_da_wiki", "O caminho solicitado fica fora da wiki.");
        const conteudo = await lerUtf8Estrito(arquivoReal);
        const linhas = linhasDe(conteudo);
        if (linhas.at(-1) === "") linhas.pop();
        const inicioLinha = endereco.linhaInicio ?? 1;
        if (inicioLinha < 1 || inicioLinha > linhas.length) return erro("linha_fora_do_arquivo", "A linha inicial fica fora da página.");
        let fimLinha = endereco.linhaFim;
        if (fimLinha === undefined) {
          const secao = endereco.linhaInicio === undefined ? null : db.query("SELECT linha_fim FROM secoes WHERE caminho = ? AND linha_inicio = ? LIMIT 1").get(resolvido.relativo, inicioLinha) as { linha_fim: number } | null;
          fimLinha = secao?.linha_fim ?? linhas.length;
        }
        if (fimLinha < inicioLinha || fimLinha > linhas.length) return erro("linha_fora_do_arquivo", "A linha final fica fora da página.");
        const totalLinhas = fimLinha - inicioLinha + 1;
        const faixa = linhas.slice(inicioLinha - 1, fimLinha);
        let conteudoSaida = "";
        let linhasSaida = 0;
        let truncado = false;
        for (const linha of faixa.slice(0, 120)) {
          const candidato = linhasSaida === 0 ? linha : `${conteudoSaida}\n${linha}`;
          if (Buffer.byteLength(candidato, "utf8") > 8 * 1024) {
            let aceitos = "";
            for (const caractere of Array.from(linha)) {
              const proximo = linhasSaida === 0 ? aceitos + caractere : `${conteudoSaida}\n${aceitos}${caractere}`;
              if (Buffer.byteLength(proximo, "utf8") > 8 * 1024) break;
              aceitos += caractere;
            }
            if (aceitos) { conteudoSaida = linhasSaida === 0 ? aceitos : `${conteudoSaida}\n${aceitos}`; linhasSaida++; }
            truncado = true;
            break;
          }
          conteudoSaida = candidato; linhasSaida++;
        }
        if (faixa.length > linhasSaida) truncado = true;
        const pagina = db.query("SELECT estado FROM paginas WHERE caminho = ?").get(resolvido.relativo) as { estado: string } | null;
        const secoes = db.query("SELECT avisos FROM secoes WHERE caminho = ? AND linha_inicio <= ? AND linha_fim >= ?").all(resolvido.relativo, fimLinha, inicioLinha) as { avisos: string }[];
        const avisos = [...new Set(secoes.flatMap((secao) => lerAvisos(secao.avisos)))];
        const resultado: Trecho = {
          caminho: resolvido.relativo, linhaInicio: inicioLinha, linhaFim: inicioLinha + Math.max(0, linhasSaida - 1),
          conteudo: conteudoSaida, totalLinhas, truncado, estado: estado(pagina?.estado ?? "rascunho"), avisos,
        };
        registrar({ tool: "ler", ms: Date.now() - inicio, bytes: Buffer.byteLength(JSON.stringify(resultado)), resultados: 0, vazia: false, palavras: 0, explicita: false, filtros: [], porEstado: { manual: Number(resultado.estado === "manual"), verificada: Number(resultado.estado === "verificada"), rascunho: Number(resultado.estado === "rascunho") }, comAviso: Number(resultado.avisos.length > 0), reindexadas: 0, msReindexacao: 0, conexao, posicaoLida: null });
        return resultado;
      });
    } catch (causa) {
      const falha = falhaDeIndice(causa); const resposta = erro(falha.codigo, falha.mensagem);
      registrar({ tool: "ler", ms: Date.now() - inicio, bytes: Buffer.byteLength(JSON.stringify(resposta)), resultados: 0, vazia: false, palavras: 0, explicita: false, filtros: [], porEstado: { manual: 0, verificada: 0, rascunho: 0 }, comAviso: 0, reindexadas: 0, msReindexacao: 0, erro: falha.codigo, conexao, posicaoLida: null });
      return resposta;
    }
  }

  async function resumoDaWiki(): Promise<ResumoDaWiki> {
    if (!raizWikiExiste(wiki)) return resumoVazio();
    try {
      return await comIndice(arquivoDb, async (db) => {
        await sincronizar(db, wiki, raiz, { agora: agora() });
        const contagem = db.query("SELECT count(*) AS paginas FROM paginas").get() as { paginas: number };
        const secoes = db.query("SELECT count(*) AS secoes FROM secoes").get() as { secoes: number };
        const porEstado = { manual: 0, verificada: 0, rascunho: 0 };
        for (const linha of db.query("SELECT estado, count(*) AS paginas FROM paginas GROUP BY estado").all() as { estado: string; paginas: number }[]) porEstado[estado(linha.estado)] = linha.paginas;
        const areas = db.query("SELECT area, count(*) AS paginas FROM paginas WHERE area IS NOT NULL GROUP BY area ORDER BY area").all() as { area: string; paginas: number }[];
        const titulos = (db.query("SELECT titulo FROM paginas ORDER BY titulo LIMIT 12").all() as { titulo: string }[]).map((linha) => linha.titulo.normalize("NFC"));
        return { paginas: contagem.paginas, secoes: secoes.secoes, porEstado, areas, titulos };
      });
    } catch { return resumoVazio(); }
  }

  async function metricas(): Promise<RelatorioMetricas> {
    const registro = cfg.metricas;
    const relatorio = registro?.resumo() ?? abrirMetricas(arquivoDb.replace(/indice\.db$/, "metricas.db"), false).resumo();
    let versaoAnvilore = "";
    try { versaoAnvilore = (JSON.parse(await Bun.file(join(raiz, "package.json")).text()) as { version?: string }).version ?? ""; } catch { /* clone temporário sem package.json */ }
    const resumo = await resumoDaWiki();
    return { ...relatorio, contexto: { wiki: {
      paginas: resumo.paginas, secoes: resumo.secoes, porEstado: resumo.porEstado,
      percentualPorEstado: {
        manual: resumo.paginas ? Math.round(resumo.porEstado.manual / resumo.paginas * 1000) / 10 : 0,
        verificada: resumo.paginas ? Math.round(resumo.porEstado.verificada / resumo.paginas * 1000) / 10 : 0,
        rascunho: resumo.paginas ? Math.round(resumo.porEstado.rascunho / resumo.paginas * 1000) / 10 : 0,
      },
    }, versaoAnvilore, plataforma: process.platform, bun: Bun.version } };
  }

  return { buscar, ler, indexar, resumoDaWiki, metricas };
}
