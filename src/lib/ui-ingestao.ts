import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { conferirArquivoDeLeitura } from "../comandos/conferir-leitura";
import { isoComOffset } from "./hora";
import { rotaDaIngestao, type Papel } from "./papeis-ingestao";
import type { EventoDoAgente, ExecucaoDeFase, FimDaFase, PedidoDeFase, PonteDeAgente, Recusa } from "./ponte-agente";
import { extrairJson, type RelatorioLeitor } from "./relatorio-leitor";
import { ErroDeFonte, salvarFonte } from "./ui-fonte";
import { caminhoWiki } from "./wiki-repo";

// A ingestão pela interface, sem HTTP: o servidor orquestra o que a skill faz numa conversa.
// Fonte em raw/ (ação da pessoa) → leitor → parada única (takeaways e páginas) → escritor →
// `fechar` rodado aqui, com a saída real → Revisão. Cada fase é uma execução da ponte; o estado
// fica em disco, em .anvilore/ui/conversas/, e sobrevive a recarregar a página ou fechar a interface.

export type PassoDaIngestao = "fonte" | "leitura" | "parada" | "escrita" | "fechamento" | "revisao";
export type SituacaoDaIngestao = "pronta" | "rodando" | "esperando" | "concluida" | "erro" | "cancelada" | "interrompida";
export type EstadoDaAtividade = "andamento" | "ok" | "recusado" | "interrompido";
export type Atividade = { id: string; papel: Papel; verbo: string; alvo: string; estado: EstadoDaAtividade; motivo?: string };
export type Escolha = { takeaways: number[]; paginas: number[]; comentario: string };
export type Fechamento = { codigo: number; saida: string; rascunhos: number; soRascunhos: boolean };

export type Conversa = {
  versao: 1;
  id: string;
  criadaEm: string;
  atualizadaEm: string;
  area: string;
  fonte: string;
  nome: string;
  bytes: number;
  passo: PassoDaIngestao;
  situacao: SituacaoDaIngestao;
  rota?: "padrao" | "grande";
  erro?: string;
  mensagens?: string[];
  sessao?: string;
  autor?: string;
  agora?: string;
  atividade: Atividade[];
  relatorio?: RelatorioLeitor;
  avisos: string[];
  escolha?: Escolha;
  geracao?: { by: string; at: string };
  recusas: Recusa[];
  fechamento?: Fechamento;
};

export type ResumoDeConversa = Pick<Conversa, "id" | "nome" | "fonte" | "passo" | "situacao" | "criadaEm">;

export class ErroDeIngestao extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const ID_VALIDO = /^[a-z0-9-]+$/;
const LIMITE_DO_COMENTARIO = 4000;
const LIMITE_DO_MOTIVO = 300;
const EM_ANDAMENTO = "Já há uma ingestão em andamento. Espere ou cancele.";
const RASCUNHO_SEM_APROVACAO = /^ERRO: página gerada sem aprovação humana:/;

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

export function mensagemDoLeitor(conversa: Pick<Conversa, "fonte" | "area">, wiki: string): string {
  return [
    `Fonte: ${conversa.fonte}`,
    `Wiki: ${wiki}`,
    conversa.area ? `Área escolhida pela pessoa: ${conversa.area}` : "A wiki não tem áreas: use o layout plano.",
    "O esquema do relatório (skills/ingest/relatorio-leitor.schema.json) é imposto pela ferramenta: devolva só o objeto JSON.",
    "Leia a fonte inteira, de uma vez. Você é só leitura: não escreva nada.",
  ].join("\n");
}

// O escritor recebe só o que a pessoa marcou. O que ela cortou entra como contagem, sem o texto,
// para ele não reescrever o que saiu.
export function mensagemDoEscritor(conversa: Pick<Conversa, "fonte" | "relatorio" | "escolha" | "geracao">, wiki: string): string {
  const relatorio = conversa.relatorio!;
  const escolha = conversa.escolha!;
  const aprovado = {
    ...relatorio,
    takeaways: escolha.takeaways.map(i => relatorio.takeaways[i]!),
    paginas: escolha.paginas.map(i => relatorio.paginas[i]!),
  };
  const lista = (acao: "criar" | "atualizar") => aprovado.paginas.filter(p => p.acao === acao).map(p => p.caminho).join(", ") || "nenhuma";
  const cortados = relatorio.takeaways.length - escolha.takeaways.length;
  const paginasCortadas = relatorio.paginas.length - escolha.paginas.length;
  return [
    "Você é o escritor da ingestão. A parada com a pessoa já foi feita: escreva exatamente o que ela aprovou.",
    "",
    `Fonte: ${conversa.fonte}`,
    `Wiki: ${wiki}`,
    `by: ${conversa.geracao!.by}`,
    `at: ${conversa.geracao!.at}`,
    "",
    "Leia a fonte inteira, de uma vez, e cada página a atualizar por inteiro antes de mexer nela.",
    `Páginas a criar: ${lista("criar")}.`,
    `Páginas a atualizar: ${lista("atualizar")}.`,
    ...(cortados ? [`A pessoa deixou de fora ${plural(cortados, "takeaway", "takeaways")}: não os escreva.`] : []),
    ...(paginasCortadas ? [`A pessoa deixou de fora ${plural(paginasCortadas, "página", "páginas")} do plano: não as escreva.`] : []),
    escolha.comentario ? `Comentário da pessoa: ${escolha.comentario}` : "A pessoa não deixou comentário.",
    "",
    "Relatório aprovado:",
    "```json",
    JSON.stringify(aprovado, null, 2),
    "```",
  ].join("\n");
}

// "N rascunhos esperam você" só quando o único erro do fechamento é a falta de aprovação humana,
// que é o estado esperado logo depois da escrita. Qualquer outro erro aparece como erro.
export function lerFechamento(codigo: number, saidaBruta: string): Fechamento {
  const saida = saidaBruta.trim();
  const erros = saida.split(/\r?\n/).filter(linha => linha.startsWith("ERRO:"));
  const rascunhos = erros.filter(linha => RASCUNHO_SEM_APROVACAO.test(linha)).length;
  const soRascunhos = codigo !== 0 && rascunhos > 0 && rascunhos === erros.length && saida.includes("FECHAMENTO: FAIL no passo validar-wiki");
  return { codigo, saida, rascunhos, soRascunhos };
}

export async function rodarFechamento(raiz: string, wiki: string, ambiente: Record<string, string | undefined> = process.env): Promise<{ codigo: number; saida: string }> {
  const cli = resolve(import.meta.dir, "../cli.ts");
  const processo = Bun.spawn([process.execPath, cli, "fechar", wiki], { cwd: raiz, env: { ...ambiente, ANVILORE_WIKI: wiki }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, codigo] = await Promise.all([new Response(processo.stdout).text(), new Response(processo.stderr).text(), processo.exited]);
  return { codigo, saida: `${stdout}${stderr}` };
}

function validarEscolha(escolha: unknown, relatorio: RelatorioLeitor): Escolha {
  const recusa = (motivo: string) => new ErroDeIngestao(motivo, 400);
  if (typeof escolha !== "object" || escolha === null) throw recusa("Escolha inválida.");
  const { takeaways, paginas, comentario } = escolha as Record<string, unknown>;
  const indices = (valor: unknown, total: number, nome: string): number[] => {
    if (!Array.isArray(valor) || valor.some(i => !Number.isInteger(i) || i < 0 || i >= total)) throw recusa(`Lista de ${nome} inválida.`);
    if (new Set(valor).size !== valor.length) throw recusa(`Lista de ${nome} repetida.`);
    return [...valor as number[]].sort((a, b) => a - b);
  };
  const marcados = indices(takeaways, relatorio.takeaways.length, "takeaways");
  if (!marcados.length) throw recusa("Marque ao menos um takeaway.");
  const escolhidas = indices(paginas, relatorio.paginas.length, "páginas");
  const daFonte = relatorio.paginas.findIndex(p => p.tipo === "source");
  if (!escolhidas.includes(daFonte)) throw recusa("A página da fonte não pode sair do plano.");
  const texto = typeof comentario === "string" ? comentario.trim() : "";
  if (texto.length > LIMITE_DO_COMENTARIO) throw recusa(`O comentário passa de ${LIMITE_DO_COMENTARIO} caracteres.`);
  return { takeaways: marcados, paginas: escolhidas, comentario: texto };
}

function porBarra(caminho: string): string {
  return caminho.split(sep).join("/");
}

function dentro(filho: string, pai: string): string | undefined {
  const rel = relative(pai, filho);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
  return porBarra(rel);
}

type Fase = {
  papel: Papel;
  // Arquivos da wiki antes da escrita: decide entre Criou e Atualizou.
  existentes: Set<string>;
  verbos: Map<string, string>;
};

export type OpcoesDaIngestao = {
  ponte: PonteDeAgente;
  agora?: () => Date;
  fechar?: (raiz: string, wiki: string) => Promise<{ codigo: number; saida: string }>;
  ambiente?: Record<string, string | undefined>;
};

export class IngestaoNaInterface {
  private readonly conversas = new Map<string, Conversa>();
  private readonly gravacoes = new Map<string, Promise<void>>();
  private readonly fases = new Map<string, Promise<void>>();
  private ativa: { id: string; execucao: ExecucaoDeFase } | undefined;
  private reservada = false;
  private encerrando = false;
  private preparacao: Promise<void> | undefined;
  private liberarPreparacao: (() => void) | undefined;
  private readonly ponte: PonteDeAgente;
  private readonly agora: () => Date;
  private readonly fechar: (raiz: string, wiki: string) => Promise<{ codigo: number; saida: string }>;
  private readonly ambiente: Record<string, string | undefined>;
  private readonly pasta: string;

  constructor(private readonly raiz: string, opcoes: OpcoesDaIngestao) {
    this.ponte = opcoes.ponte;
    this.agora = opcoes.agora ?? (() => new Date());
    this.ambiente = opcoes.ambiente ?? process.env;
    this.fechar = opcoes.fechar ?? ((r, w) => rodarFechamento(r, w, this.ambiente));
    this.pasta = join(raiz, ".anvilore/ui/conversas");
  }

  get nomeDoAgente(): string { return this.ponte.nome; }

  private wiki(): string { return caminhoWiki(this.raiz, this.ambiente); }

  async criar(fonte: { area: string; nome: string; conteudo: Uint8Array }): Promise<Conversa> {
    let salvo;
    try { salvo = await salvarFonte(this.raiz, fonte, this.ambiente); }
    catch (erro) { if (erro instanceof ErroDeFonte) throw new ErroDeIngestao(erro.message, 400); throw erro; }
    const agora = this.agora();
    const carimbo = isoComOffset(agora).slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
    const conversa: Conversa = {
      versao: 1, id: `${carimbo}-${randomBytes(3).toString("hex")}`, criadaEm: agora.toISOString(), atualizadaEm: agora.toISOString(),
      area: fonte.area, fonte: salvo.fonte, nome: basename(salvo.fonte), bytes: salvo.bytes,
      passo: "fonte", situacao: "pronta", atividade: [], avisos: [], recusas: [],
    };
    this.conversas.set(conversa.id, conversa);
    await this.salvar(conversa);
    return structuredClone(conversa);
  }

  async listar(): Promise<ResumoDeConversa[]> {
    let nomes: string[];
    try { nomes = await readdir(this.pasta); } catch { return []; }
    const resumos: ResumoDeConversa[] = [];
    for (const nome of nomes) {
      if (!nome.endsWith(".json")) continue;
      const conversa = await this.carregar(nome.slice(0, -5));
      if (conversa) resumos.push({ id: conversa.id, nome: conversa.nome, fonte: conversa.fonte, passo: conversa.passo, situacao: conversa.situacao, criadaEm: conversa.criadaEm });
    }
    return resumos.sort((a, b) => b.criadaEm.localeCompare(a.criadaEm) || b.id.localeCompare(a.id));
  }

  async obter(id: string): Promise<Conversa | undefined> {
    const conversa = await this.carregar(id);
    return conversa && structuredClone(conversa);
  }

  async esperar(id: string): Promise<void> {
    await this.fases.get(id);
  }

  async ler(id: string): Promise<Conversa> {
    this.reservar();
    try {
      const conversa = await this.exigir(id);
      if (this.encerrando) throw new ErroDeIngestao("A interface está encerrando.", 409);
      const podeLer = conversa.passo === "fonte" || (conversa.passo === "leitura" && conversa.situacao !== "rodando");
      if (!podeLer) throw new ErroDeIngestao("Esta ingestão já passou da leitura.", 409);
      let bytes: number;
      try { bytes = (await stat(join(this.raiz, conversa.fonte))).size; }
      catch { throw new ErroDeIngestao(`A fonte ${conversa.fonte} não está mais em raw/.`, 409); }
      const rota = rotaDaIngestao(bytes);
      if (rota === "dividir") throw new ErroDeIngestao(`A fonte tem ${bytes} bytes e não cabe nem na janela grande. Divida o arquivo em partes menores.`, 422);
      await this.exigirAgente();
      if (this.encerrando) throw new ErroDeIngestao("A interface está encerrando.", 409);
      for (const campo of ["erro", "mensagens", "relatorio", "sessao"] as const) delete conversa[campo];
      Object.assign(conversa, { passo: "leitura", situacao: "rodando", rota, atividade: [], avisos: [], recusas: [], agora: "Lendo a fonte" });
      await this.salvar(conversa);
      if (this.encerrando) {
        Object.assign(conversa, { situacao: "cancelada", erro: "A interface foi encerrada antes do início desta etapa." });
        delete conversa.agora;
        await this.salvar(conversa);
        throw new ErroDeIngestao("A interface está encerrando.", 409);
      }
      const wiki = this.wiki();
      this.iniciar(conversa, { papel: "leitor", mensagem: mensagemDoLeitor(conversa, wiki), raiz: this.raiz, wiki, rota }, new Set(), fim => this.terminarLeitura(conversa, fim));
      return structuredClone(conversa);
    } finally { this.liberarReserva(); }
  }

  async seguir(id: string, escolhaBruta: unknown): Promise<Conversa> {
    this.reservar();
    try {
      const conversa = await this.exigir(id);
      if (this.encerrando) throw new ErroDeIngestao("A interface está encerrando.", 409);
      if (conversa.passo !== "parada" || conversa.situacao !== "esperando" || !conversa.relatorio) throw new ErroDeIngestao("A ingestão não está esperando a sua decisão.", 409);
      const escolha = validarEscolha(escolhaBruta, conversa.relatorio);
      await this.exigirAgente();
      if (this.encerrando) throw new ErroDeIngestao("A interface está encerrando.", 409);
      const wiki = this.wiki();
      // A linha de base da aba Mudanças: a cópia de cada página a atualizar, fora do git, antes da escrita.
      for (const i of escolha.paginas) {
        const pagina = conversa.relatorio.paginas[i]!;
        if (pagina.acao !== "atualizar") continue;
        let texto: string;
        try { texto = await readFile(join(wiki, pagina.caminho), "utf8"); } catch { continue; }
        const copia = join(this.raiz, ".anvilore/ui/copias", conversa.id, pagina.caminho);
        await mkdir(dirname(copia), { recursive: true });
        await writeFile(copia, texto);
      }
      const existentes = new Set<string>();
      if (existsSync(wiki)) for await (const arquivo of new Bun.Glob("**/*").scan({ cwd: wiki, onlyFiles: true })) existentes.add(porBarra(arquivo));
      Object.assign(conversa, {
        escolha,
        geracao: { by: conversa.autor ?? "claude-code/desconhecida", at: isoComOffset(this.agora()) },
        passo: "escrita", situacao: "rodando", agora: "Começando a escrita",
      });
      await this.salvar(conversa);
      if (this.encerrando) {
        Object.assign(conversa, { situacao: "cancelada", erro: "A interface foi encerrada antes do início desta etapa." });
        delete conversa.agora;
        await this.salvar(conversa);
        throw new ErroDeIngestao("A interface está encerrando.", 409);
      }
      const pedido: PedidoDeFase = { papel: "escritor", mensagem: mensagemDoEscritor(conversa, wiki), raiz: this.raiz, wiki, ...(conversa.sessao ? { sessao: conversa.sessao } : {}), rota: conversa.rota ?? "padrao" };
      this.iniciar(conversa, pedido, existentes, fim => this.terminarEscrita(conversa, fim));
      return structuredClone(conversa);
    } finally { this.liberarReserva(); }
  }

  async encerrar(): Promise<void> {
    this.encerrando = true;
    await this.preparacao;
    const ativa = this.ativa;
    if (!ativa) return;
    ativa.execucao.cancelar();
    await this.fases.get(ativa.id);
  }

  private reservar(): void {
    if (this.encerrando) throw new ErroDeIngestao("A interface está encerrando.", 409);
    if (this.ativa || this.reservada) throw new ErroDeIngestao(EM_ANDAMENTO, 409);
    this.reservada = true;
    this.preparacao = new Promise<void>(resolver => { this.liberarPreparacao = resolver; });
  }

  private liberarReserva(): void {
    this.reservada = false;
    this.liberarPreparacao?.();
    this.liberarPreparacao = undefined;
    this.preparacao = undefined;
  }

  async cancelar(id: string): Promise<Conversa> {
    const conversa = await this.exigir(id);
    if (this.ativa?.id !== id) throw new ErroDeIngestao("Nada está rodando nesta ingestão.", 409);
    this.ativa.execucao.cancelar();
    return structuredClone(conversa);
  }

  private async exigir(id: string): Promise<Conversa> {
    const conversa = await this.carregar(id);
    if (!conversa) throw new ErroDeIngestao("Ingestão não encontrada.", 404);
    return conversa;
  }

  private async exigirAgente(): Promise<void> {
    const disponivel = await this.ponte.disponibilidade();
    if (!disponivel.ok) throw new ErroDeIngestao(disponivel.motivo, 503);
  }

  private async carregar(id: string): Promise<Conversa | undefined> {
    if (!ID_VALIDO.test(id)) return undefined;
    const emMemoria = this.conversas.get(id);
    if (emMemoria) return emMemoria;
    let conversa: Conversa;
    try { conversa = JSON.parse(await readFile(join(this.pasta, `${id}.json`), "utf8")) as Conversa; }
    catch { return undefined; }
    if (conversa?.id !== id) return undefined;
    // Rodando no disco e sem processo nesta interface: a fase morreu com a interface anterior.
    if (conversa.situacao === "rodando") {
      Object.assign(conversa, { situacao: "interrompida", erro: "A interface foi fechada durante esta etapa." });
      delete conversa.agora;
    }
    this.conversas.set(id, conversa);
    return conversa;
  }

  private salvar(conversa: Conversa): Promise<void> {
    conversa.atualizadaEm = this.agora().toISOString();
    const arquivo = join(this.pasta, `${conversa.id}.json`);
    const anterior = this.gravacoes.get(conversa.id) ?? Promise.resolve();
    const proxima = anterior.then(async () => {
      await mkdir(this.pasta, { recursive: true });
      const temporario = `${arquivo}.${randomBytes(4).toString("hex")}.tmp`;
      await writeFile(temporario, JSON.stringify(conversa, null, 2));
      await rename(temporario, arquivo);
    });
    this.gravacoes.set(conversa.id, proxima.catch(() => {}));
    return proxima;
  }

  private iniciar(conversa: Conversa, pedido: PedidoDeFase, existentes: Set<string>, terminar: (fim: FimDaFase) => Promise<void>): void {
    const fase: Fase = { papel: pedido.papel, existentes, verbos: new Map() };
    const execucao = this.ponte.executar(pedido, evento => {
      this.registrar(conversa, fase, evento);
      void this.salvar(conversa).catch(() => {});
    });
    this.ativa = { id: conversa.id, execucao };
    const concluir = execucao.fim
      .then(async fim => {
        this.encerrarAtividade(conversa, fase, fim);
        delete conversa.agora;
        await terminar(fim);
      })
      .catch((erro: unknown) => {
        Object.assign(conversa, { situacao: "erro", erro: `Falha inesperada: ${(erro as Error).message}` });
      })
      .finally(async () => {
        this.ativa = undefined;
        delete conversa.agora;
        await this.salvar(conversa).catch(() => {});
      });
    this.fases.set(conversa.id, concluir);
  }

  private rotulo(caminho: string): string {
    const absoluto = resolve(this.raiz, caminho);
    const naWiki = dentro(absoluto, this.wiki());
    if (naWiki !== undefined) return `wiki/${naWiki}`;
    return dentro(absoluto, this.raiz) ?? caminho;
  }

  private verboDaEscrita(caminho: string, fase: Fase): string {
    const rel = dentro(resolve(this.raiz, caminho), this.wiki());
    if (rel === undefined) return "Escreveu";
    if (rel.startsWith("log/")) return "Registrou";
    return fase.existentes.has(rel) ? "Atualizou" : "Criou";
  }

  private registrar(conversa: Conversa, fase: Fase, evento: EventoDoAgente): void {
    const { papel } = fase;
    if (evento.tipo === "inicio") {
      if (evento.sessao) conversa.sessao = evento.sessao;
      if (papel === "leitor") conversa.autor = evento.autor;
      return;
    }
    if (evento.tipo === "ferramenta") {
      let alvo = evento.caminho ? this.rotulo(evento.caminho) : evento.padrao ?? "";
      if (papel === "escritor" && (evento.nome === "Edit" || evento.nome === "Write")) {
        conversa.agora = `Escrevendo ${alvo}`;
        fase.verbos.set(evento.id, this.verboDaEscrita(evento.caminho ?? "", fase));
        const anterior = conversa.atividade.find(a => a.papel === papel && a.alvo === alvo && a.estado !== "recusado");
        if (anterior) Object.assign(anterior, { id: evento.id, verbo: "Escrevendo", estado: "andamento" });
        else conversa.atividade.push({ id: evento.id, papel, verbo: "Escrevendo", alvo, estado: "andamento" });
        return;
      }
      const leitura = ({ Read: ["Leu", "Lendo"], Grep: ["Buscou", "Buscando"], Glob: ["Listou", "Listando"] } as Record<string, [string, string]>)[evento.nome];
      if (!leitura) return;
      // Na busca, o que interessa à pessoa é o termo, não a pasta.
      if (evento.nome !== "Read" && evento.padrao) alvo = evento.padrao;
      conversa.agora = `${leitura[1]} ${alvo}`;
      if (papel === "leitor") {
        fase.verbos.set(evento.id, leitura[0]);
        conversa.atividade.push({ id: evento.id, papel, verbo: leitura[0], alvo, estado: "andamento" });
      }
      return;
    }
    if (evento.tipo === "resultado-ferramenta") {
      const item = conversa.atividade.find(a => a.papel === papel && a.id === evento.id);
      if (!item) return;
      if (evento.erro) {
        Object.assign(item, { verbo: "Recusado", estado: "recusado", motivo: evento.texto.trim().slice(0, LIMITE_DO_MOTIVO) });
        if (papel === "escritor") conversa.recusas.push({ ferramenta: "Edit/Write", id: evento.id, caminho: item.alvo, motivo: item.motivo });
      } else Object.assign(item, { verbo: fase.verbos.get(evento.id) ?? item.verbo, estado: "ok" });
    }
  }

  private encerrarAtividade(conversa: Conversa, fase: Fase, fim: FimDaFase): void {
    for (const item of conversa.atividade) {
      if (item.papel !== fase.papel || item.estado !== "andamento") continue;
      if (fim.situacao === "concluida") Object.assign(item, { verbo: fase.verbos.get(item.id) ?? item.verbo, estado: "ok" });
      else item.estado = "interrompido";
    }
    for (const recusa of fim.recusas) {
      if (recusa.id && conversa.recusas.some(r => r.id === recusa.id)) continue;
      const alvo = recusa.caminho ? this.rotulo(recusa.caminho) : recusa.ferramenta;
      const motivo = "Negado pelas permissões da ingestão.";
      conversa.recusas.push({ ...recusa, motivo });
      const item = recusa.id ? conversa.atividade.find(a => a.papel === fase.papel && a.id === recusa.id) : undefined;
      if (item) Object.assign(item, { verbo: "Recusado", estado: "recusado", motivo });
      else conversa.atividade.push({ id: recusa.id ?? `recusa-${conversa.recusas.length}`, papel: fase.papel, verbo: "Recusado", alvo, estado: "recusado", motivo });
    }
  }

  private async terminarLeitura(conversa: Conversa, fim: FimDaFase): Promise<void> {
    if (fim.situacao === "cancelada") { conversa.situacao = "cancelada"; return; }
    if (fim.situacao === "falhou") { Object.assign(conversa, { situacao: "erro", erro: fim.erro }); return; }
    if (fim.sessao) conversa.sessao = fim.sessao;
    // O portão do conferir-leitura, o mesmo da skill: esquema, citações na fonte, páginas a criar e
    // a atualizar conferidas no disco. O relatório do agente não é prova.
    const pasta = join(this.pasta, conversa.id);
    await mkdir(pasta, { recursive: true });
    const arquivo = join(pasta, "leitura.json");
    const conteudo = fim.saidaEstruturada !== undefined ? JSON.stringify(fim.saidaEstruturada, null, 2) : fim.texto;
    await writeFile(arquivo, conteudo);
    const conferencia = await conferirArquivoDeLeitura(this.raiz, arquivo, this.ambiente);
    const falhaDaLeitura = (mensagens: string[]) => Object.assign(conversa, { situacao: "erro", erro: "O relatório do leitor não passou na conferência. Nada foi escrito.", mensagens });
    if (conferencia.codigo !== 0) { falhaDaLeitura(conferencia.mensagens); return; }
    const relatorio = extrairJson(conteudo) as RelatorioLeitor;
    if (relatorio.fonte !== conversa.fonte) {
      falhaDaLeitura([`O relatório fala de ${relatorio.fonte}, mas a fonte desta ingestão é ${conversa.fonte}.`]);
      return;
    }
    Object.assign(conversa, { relatorio, avisos: conferencia.mensagens.filter(m => m.startsWith("AVISO")), passo: "parada", situacao: "esperando" });
  }

  private async terminarEscrita(conversa: Conversa, fim: FimDaFase): Promise<void> {
    if (fim.situacao === "cancelada") { conversa.situacao = "cancelada"; return; }
    if (fim.situacao === "falhou") { Object.assign(conversa, { situacao: "erro", erro: fim.erro }); return; }
    // O servidor roda o fechamento e mostra a saída real: o "rodou" do agente não vale.
    Object.assign(conversa, { passo: "fechamento", agora: "Rodando anvilore fechar" });
    await this.salvar(conversa);
    const { codigo, saida } = await this.fechar(this.raiz, this.wiki());
    const fechamento = lerFechamento(codigo, saida);
    const ok = codigo === 0 || fechamento.soRascunhos;
    Object.assign(conversa, { fechamento, passo: "revisao", situacao: ok ? "concluida" : "erro", ...(ok ? {} : { erro: "O fechamento encontrou problemas na wiki." }) });
  }
}
