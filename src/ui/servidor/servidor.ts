import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { aprovarPelaInterface } from "../../comandos/aprovar";
import { isoComOffset } from "../../lib/hora";
import type { PonteDeAgente } from "../../lib/ponte-agente";
import { PonteClaudeCode } from "../../lib/ponte-claude-code";
import { indexarCopias, listarFilaRascunhos } from "../../lib/ui-fila";
import { areasDaWiki } from "../../lib/ui-fonte";
import { validarWiki } from "../../comandos/validar";
import { resumoDoInicio, saudeDaWiki } from "../../lib/ui-inicio";
import { ErroDeIngestao, IngestaoNaInterface } from "../../lib/ui-ingestao";
import { listarBiblioteca } from "../../lib/ui-biblioteca";
import { ErroDeCaminhoInvalido, obterNota } from "../../lib/ui-nota";
import { caminhoWiki } from "../../lib/wiki-repo";
import { atualizar } from "../../lib/atualizacao";
import { diagnosticar } from "../../comandos/doctor";
import {
  concluirOnboarding,
  estadoOnboarding,
  inicializarAreasOnboarding,
  inspecionarPasta,
  validarDestinoAnvilore,
  validarPastaVault,
} from "../../lib/ui-onboarding";
import { ambienteComCaminhosAbsolutos } from "../../lib/caminhos";
import { gravarEstadoUi, obterEstadoUi } from "../../lib/ui-estado";

type Servidor = ReturnType<typeof Bun.serve>;
type OpcoesServidor = {
  portaInicial?: number;
  token?: string;
  abrirNavegador?: boolean;
  abrir?: (url: string) => void;
  ponte?: PonteDeAgente;
  fechar?: (raiz: string, wiki: string) => Promise<{ codigo: number; saida: string }>;
  ambiente?: Record<string, string | undefined>;
  soRevisao?: boolean;
  validar?: (raiz: string, wiki: string) => Promise<{ codigo: number; saida: string }>;
  autoEncerrar?: boolean;
  inatividadeMs?: number;
  intervaloChecagemMs?: number;
  aoEncerrar?: () => Promise<void>;
};

// Teto de uma fonte enviada pela tela. Acima da janela grande (~1,15 MB) a ingestão já pede para dividir;
// o teto só evita segurar na memória um envio por engano.
const LIMITE_DO_ENVIO = 32 * 1024 * 1024;
// Conversas que ainda esperam algo da pessoa ou do agente: a Início oferece continuar.
const CONVERSA_PENDENTE = ["rodando", "esperando", "pronta"];
const ROTA_DA_CONVERSA = /^\/api\/conversas\/([a-z0-9-]+)(?:\/(ler|seguir|cancelar))?$/;

function localHost(request: Request): boolean {
  const host = request.headers.get("host");
  if (!host) return false;
  try { return ["127.0.0.1", "localhost"].includes(new URL(`http://${host}`).hostname.toLowerCase()); }
  catch { return false; }
}

function json(dados: unknown, status = 200): Response {
  return respostaSegura(JSON.stringify(dados), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

async function estadoAtualizador(raiz: string) {
  try {
    const estado = JSON.parse(await readFile(join(raiz, ".anvilore/atualizacao.json"), "utf8")) as Record<string, unknown>;
    const atualizadoEm = typeof estado.atualizadoEm === "string" ? estado.atualizadoEm : undefined;
    let mudancas: string[] = [];
    if (atualizadoEm && Date.now() - Date.parse(atualizadoEm) < 60 * 60 * 1000 && typeof estado.versaoInstalada === "string") {
      const changelog = await readFile(join(raiz, "CHANGELOG.md"), "utf8").catch(() => "");
      const escape = estado.versaoInstalada.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const inicio = changelog.search(new RegExp(`^## \\[v?${escape}\\](?:\\s|$)`, "m"));
      if (inicio >= 0) {
        const secao = changelog.slice(inicio).split(/\n(?=## )/, 1)[0] ?? "";
        mudancas = secao.split("\n").slice(1).filter(linha => /^- /.test(linha)).slice(0, 3).map(linha => linha.slice(2).replace(/`/g, ""));
      }
    }
    return {
      estado: typeof estado.estado === "string" ? estado.estado : "ocioso",
      versaoInstalada: typeof estado.versaoInstalada === "string" ? estado.versaoInstalada : undefined,
      atualizadoEm,
      disponivel: typeof estado.disponivel === "string" ? estado.disponivel : undefined,
      etapa: typeof estado.etapa === "string" ? estado.etapa : undefined,
      erro: [estado.alerta, estado.erro].filter(texto => typeof texto === "string").join(" ") || undefined,
      podeVoltar: ["ocioso", "baixada", "recusada"].includes(String(estado.estado)) && typeof (estado.ultima as { id?: unknown } | undefined)?.id === "string",
      mudancas,
    };
  } catch { return null; }
}

function respostaSegura(body?: BodyInit | null, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  return new Response(body, { ...init, headers });
}

function tokenValido(url: URL, token: string): boolean {
  const fornecido = url.searchParams.get("token") ?? "";
  const esperado = Buffer.from(token);
  const recebido = Buffer.from(fornecido);
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}

function erroDaIngestao(erro: unknown): Response {
  if (erro instanceof ErroDeIngestao) return json({ mensagens: [erro.message] }, erro.status);
  throw erro;
}

function erroDaRevisao(mensagem: string, erro: unknown): Response {
  const detalhe = (erro instanceof Error ? erro.message : String(erro)).replace(/\s+/g, " ").trim().slice(0, 300) || "erro desconhecido";
  console.error(`[Anvilore UI] ${mensagem} ${detalhe}`, erro);
  return json({ mensagens: [`${mensagem} ${detalhe}`] }, 500);
}

async function receberFonte(request: Request, ingestao: IngestaoNaInterface, agora: Date): Promise<Response> {
  if (Number(request.headers.get("content-length") ?? 0) > LIMITE_DO_ENVIO + 64 * 1024) return json({ mensagens: ["A fonte passa de 32 MB."] }, 413);
  let dados: FormData;
  try { dados = await request.formData(); } catch { return json({ mensagens: ["Envio inválido."] }, 400); }
  const area = dados.get("area");
  const arquivo = dados.get("arquivo");
  const texto = dados.get("texto");
  let fonte: { nome: string; conteudo: Uint8Array };
  if (arquivo instanceof Blob) {
    if (arquivo.size > LIMITE_DO_ENVIO) return json({ mensagens: ["A fonte passa de 32 MB."] }, 413);
    fonte = { nome: arquivo instanceof File ? arquivo.name : "fonte", conteudo: new Uint8Array(await arquivo.arrayBuffer()) };
  } else if (typeof texto === "string" && texto.trim()) {
    const nome = dados.get("nome");
    const carimbo = isoComOffset(agora).slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
    const base = typeof nome === "string" && nome.trim() ? nome.trim() : `texto-colado-${carimbo}`;
    // Textarea/FormData pode transportar quebras LF como CRLF; arquivos enviados mantêm os bytes originais.
    fonte = { nome: /\.[a-z0-9]+$/i.test(base) ? base : `${base}.md`, conteudo: new TextEncoder().encode(texto.replace(/\r\n/g, "\n")) };
  } else return json({ mensagens: ["Solte um arquivo ou cole um texto."] }, 400);
  try { return json(await ingestao.criar({ area: typeof area === "string" ? area : "", ...fonte }), 201); }
  catch (erro) { return erroDaIngestao(erro); }
}

async function rotaDaConversa(request: Request, id: string, acao: string | undefined, ingestao: IngestaoNaInterface): Promise<Response> {
  try {
    if (!acao && request.method === "GET") {
      const conversa = await ingestao.obter(id);
      return conversa ? json(conversa) : json({ mensagens: ["Ingestão não encontrada."] }, 404);
    }
    if (request.method !== "POST") return json({ mensagens: ["Não encontrado."] }, 404);
    if (acao === "ler") {
      let corpo: { area?: unknown } | undefined;
      try {
        if (request.headers.get("content-type")?.includes("application/json")) {
          corpo = await request.json() as { area?: unknown };
        }
      } catch { /* corpo opcional */ }
      const area = typeof corpo?.area === "string" ? corpo.area : undefined;
      return json(await ingestao.ler(id, area));
    }
    if (acao === "cancelar") return json(await ingestao.cancelar(id));
    let escolha: unknown;
    try { escolha = await request.json(); } catch { return json({ mensagens: ["Pedido inválido."] }, 400); }
    return json(await ingestao.seguir(id, escolha));
  } catch (erro) { return erroDaIngestao(erro); }
}

async function validar(raiz: string, wiki: string): Promise<{ codigo: number; saida: string }> {
  const cli = resolve(import.meta.dir, "../../cli.ts");
  const processo = Bun.spawn([process.execPath, cli, "validar", wiki], {
    cwd: raiz,
    env: ambienteComCaminhosAbsolutos({ ...process.env, ANVILORE_WIKI: wiki }),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, codigo] = await Promise.all([new Response(processo.stdout).text(), new Response(processo.stderr).text(), processo.exited]);
  return { codigo, saida: `${stdout}${stderr}`.trim() };
}

function abrirNavegador(url: string): void {
  const comando = process.platform === "win32" ? ["cmd", "/c", "start", "", url]
    : process.platform === "darwin" ? ["open", url]
      : ["xdg-open", url];
  try { Bun.spawn(comando, { stdin: "ignore", stdout: "ignore", stderr: "ignore" }); } catch { /* UI permanece acessível pela URL mostrada */ }
}

async function criarIngestao(raiz: string, opcoes: OpcoesServidor): Promise<IngestaoNaInterface> {
  const ingestao = new IngestaoNaInterface(raiz, { ponte: opcoes.ponte ?? new PonteClaudeCode(), ...(opcoes.fechar ? { fechar: opcoes.fechar } : {}) });
  await ingestao.recuperarInterrompidas();
  return ingestao;
}

export function podeEncerrarPorInatividade(dados: {
  requisicoesEmVoo: number;
  ultimoBatimento: number;
  inatividadeMs: number;
  ocupada?: boolean;
  paginasEmAjuste?: number;
  conversasRodando?: boolean;
  agora?: number;
}): boolean {
  if (dados.requisicoesEmVoo > 0) return false;
  const agora = dados.agora ?? Date.now();
  if (agora - dados.ultimoBatimento < dados.inatividadeMs) return false;
  if (dados.ocupada) return false;
  if ((dados.paginasEmAjuste ?? 0) > 0) return false;
  if (dados.conversasRodando) return false;
  return true;
}

export async function iniciarServidorUi(raizInicial: string, opcoes: OpcoesServidor = {}) {
  const ambiente = opcoes.ambiente ?? process.env;
  let raiz = resolve(raizInicial);
  let wiki = caminhoWiki(raiz, ambiente);
  const token = opcoes.token ?? randomBytes(32).toString("base64url");
  const portaInicial = opcoes.portaInicial ?? 4173;
  const soRevisao = opcoes.soRevisao === true;
  let ingestao: IngestaoNaInterface | undefined = soRevisao ? undefined : await criarIngestao(raiz, opcoes);
  let servidor: Servidor | undefined;
  let ultimoErro: unknown;

  const autoEncerrar = opcoes.autoEncerrar ?? (ambiente.ANVILORE_AUTO_ENCERRAR === "1");
  const inatividadeMs = opcoes.inatividadeMs ?? 120_000;
  const intervaloChecagemMs = opcoes.intervaloChecagemMs ?? Math.min(5_000, Math.max(10, Math.floor(inatividadeMs / 2)));
  let ultimoBatimento = Date.now();
  let requisicoesEmVoo = 0;
  let timerInatividade: ReturnType<typeof setInterval> | undefined;

  const encerrarServidor = async () => {
    if (timerInatividade) clearInterval(timerInatividade);
    if (timeoutInatividade) clearTimeout(timeoutInatividade);
    servidor?.stop(true);
    await ingestao?.encerrar();
    if (opcoes.aoEncerrar) {
      await opcoes.aoEncerrar();
    }
    process.emit("SIGTERM");
  };

  if (autoEncerrar) {
    timerInatividade = setInterval(async () => {
      if (!podeEncerrarPorInatividade({
        requisicoesEmVoo,
        ultimoBatimento,
        inatividadeMs,
        ocupada: ingestao?.ocupada,
        paginasEmAjuste: ingestao?.paginasEmAjuste().size,
      })) {
        return;
      }

      let conversasRodando = false;
      if (ingestao) {
        try {
          const conversas = await ingestao.listar();
          conversasRodando = conversas.some(c => c.situacao === "rodando");
        } catch { return; }
      }

      // P3-C: Re-checagem atômica após o await ingestao.listar() antes do stop definitivo
      if (!podeEncerrarPorInatividade({
        requisicoesEmVoo,
        ultimoBatimento,
        inatividadeMs,
        ocupada: ingestao?.ocupada,
        paginasEmAjuste: ingestao?.paginasEmAjuste().size,
        conversasRodando,
      })) {
        return;
      }

      clearInterval(timerInatividade!);
      timerInatividade = undefined;
      await encerrarServidor();
    }, intervaloChecagemMs);
    timerInatividade.unref?.();
  }

  let timeoutInatividade: ReturnType<typeof setTimeout> | undefined;
  const resetarInatividade = () => {
    if (!soRevisao) return;
    if (timeoutInatividade) clearTimeout(timeoutInatividade);
    timeoutInatividade = setTimeout(() => {
      servidor?.stop(true);
    }, 30 * 60 * 1000);
    timeoutInatividade.unref?.();
  };
  resetarInatividade();

  for (let porta = portaInicial; porta <= 65535; porta++) {
    try {
      servidor = Bun.serve({
        hostname: "127.0.0.1",
        port: porta,
        maxRequestBodySize: LIMITE_DO_ENVIO * 2,
        fetch: async (request) => {
          resetarInatividade();
          if (!localHost(request)) return respostaSegura("Acesso recusado", { status: 403 });
          const url = new URL(request.url);
          if (url.pathname === "/favicon.ico" && request.method === "GET") return respostaSegura(null, { status: 204 });
          if (!tokenValido(url, token)) return respostaSegura("Acesso recusado", { status: 403 });
          ultimoBatimento = Date.now();
          if (url.pathname === "/api/batimento" && (request.method === "POST" || request.method === "GET")) {
            return json({ ok: true });
          }

          const ehApi = url.pathname.startsWith("/api/");
          if (ehApi) requisicoesEmVoo++;
          try {
            if (soRevisao) {
            if (
              url.pathname === "/api/ingestao" ||
              url.pathname === "/api/fontes" ||
              url.pathname === "/api/conversas/de-raw" ||
              url.pathname === "/api/atualizador" ||
              url.pathname.startsWith("/api/onboarding") ||
              ROTA_DA_CONVERSA.test(url.pathname)
            ) {
              return respostaSegura("Não encontrado", { status: 404 });
            }
          }
          const origem = request.headers.get("origin");
          if (request.method === "POST" && (!origem || origem !== url.origin)) return json({ erro: "Origem recusada." }, 403);
          if (url.pathname === "/api/rascunhos" && request.method === "GET") {
            try {
              const fila = await listarFilaRascunhos(raiz);
              const copias = await indexarCopias(raiz);
              return json(await Promise.all(fila.map(async item => {
                const copia = copias.get(item.caminho);
                let anterior: string | undefined;
                if (copia) { try { anterior = await readFile(copia, "utf8"); } catch { /* cópia removida durante a leitura */ } }
                const emAjuste = ingestao?.ajusteAtivoPara(item.caminho) ?? false;
                const aprovavel = item.aprovavel && !emAjuste;
                const motivoNaoAprovavel = emAjuste
                  ? "Esta página está em ajuste; aprove depois que o ajuste terminar."
                  : item.motivoNaoAprovavel;
                return {
                  ...item,
                  anterior,
                  aprovavel,
                  ...(motivoNaoAprovavel ? { motivoNaoAprovavel } : {}),
                  // Só-revisão não sobe a ponte com o agente: a tela desabilita o botão e mostra o motivo.
                  ...(ingestao ? {} : { ajustavel: false, motivoNaoAjustavel: "Pedir ajuste só funciona com a interface completa aberta." }),
                };
              })));
            } catch (erro) {
              return erroDaRevisao("Não consegui ler os rascunhos:", erro);
            }
          }
          if (url.pathname === "/api/aprovar" && request.method === "POST") {
            try {
              let corpo: { caminho?: unknown; versao?: unknown };
              try { corpo = await request.json() as { caminho?: unknown }; } catch { return json({ codigo: 2, mensagens: ["Pedido inválido."] }, 400); }
              if (typeof corpo.caminho !== "string") return json({ codigo: 2, mensagens: ["Página inválida."] }, 400);
              if (typeof corpo.versao !== "string" || !/^[a-f0-9]{64}$/.test(corpo.versao)) return json({ codigo: 2, mensagens: ["Versão inválida."] }, 400);
              if (ingestao?.ajusteAtivoPara(corpo.caminho)) {
                return json({ codigo: 3, mensagens: ["Esta página está em ajuste; aprove depois que o ajuste terminar."] }, 409);
              }
              const fila = await listarFilaRascunhos(raiz);
              const item = fila.find(rascunho => rascunho.caminho === corpo.caminho && rascunho.aprovavel);
              if (!item) return json({ codigo: 1, mensagens: ["Aprovação recusada: página ausente da fila ou inválida."] }, 409);
              const resultado = await aprovarPelaInterface(raiz, join(wiki, item.caminho), corpo.versao, ambiente);
              return json(resultado, resultado.codigo === 0 ? 200 : 409);
            } catch (erro) {
              return erroDaRevisao("Não consegui aprovar:", erro);
            }
          }
          if (url.pathname === "/api/ajuste" && request.method === "POST") {
            // Só-revisão não sobe a ponte com o agente: sem ingestão não há como pedir ajuste.
            if (!ingestao) return respostaSegura("Não encontrado", { status: 404 });
            let corpo: { caminho?: unknown; versao?: unknown; pedido?: unknown };
            try { corpo = await request.json() as { caminho?: unknown; versao?: unknown; pedido?: unknown }; } catch { return json({ mensagens: ["Pedido inválido."] }, 400); }
            if (typeof corpo.caminho !== "string") return json({ mensagens: ["Página inválida."] }, 400);
            if (typeof corpo.versao !== "string" || !/^[a-f0-9]{64}$/.test(corpo.versao)) return json({ mensagens: ["Versão inválida."] }, 400);
            if (typeof corpo.pedido !== "string" || !corpo.pedido.trim()) return json({ mensagens: ["O pedido de ajuste não pode ser vazio."] }, 400);
            try {
              const conversa = await ingestao.ajustar({ caminho: corpo.caminho, versao: corpo.versao, pedido: corpo.pedido });
              return json(conversa, 201);
            } catch (erro) {
              if (erro instanceof ErroDeIngestao) return erroDaIngestao(erro);
              return erroDaRevisao("Não consegui pedir o ajuste:", erro);
            }
          }
          if (url.pathname === "/api/validar" && request.method === "POST") {
            try { return json(await (opcoes.validar ?? validar)(raiz, wiki)); }
            catch (erro) { return erroDaRevisao("Não consegui rodar a validação:", erro); }
          }
          if (url.pathname === "/api/inicio" && request.method === "GET") {
            try {
              const conversas = ingestao ? (await ingestao.listar()).filter(c => CONVERSA_PENDENTE.includes(c.situacao)) : [];
              const abertas = new Map(conversas.map(c => [c.fonte, c.id]));
              // `validarWiki` lê a wiki inteira de forma síncrona: o Início a paga uma vez só e a saúde vai no mesmo JSON.
              // Sem cache no servidor: cada carga vê a wiki como ela está, e "Validar agora" (/api/saude) valida na hora.
              const validada = await validarWiki(wiki);
              return json({ agente: ingestao?.nomeDoAgente, areas: await areasDaWiki(wiki), conversas, ...await resumoDoInicio(raiz, abertas, process.env, validada), saude: await saudeDaWiki(wiki, validada) });
            } catch (erro) { return erroDaIngestao(erro); }
          }
          if (url.pathname === "/api/saude" && request.method === "GET") return json(await saudeDaWiki(wiki));
          if (url.pathname === "/api/biblioteca" && request.method === "GET") {
            return json(await listarBiblioteca(raiz));
          }
          if (url.pathname === "/api/nota" && request.method === "GET") {
            const caminho = url.searchParams.get("caminho");
            if (!caminho) return json({ mensagens: ["Parâmetro 'caminho' obrigatório."] }, 400);
            try {
              const nota = await obterNota(raiz, caminho);
              if (!nota) return json({ mensagens: ["Página não encontrada."] }, 404);
              const emAjuste = ingestao?.ajusteAtivoPara(caminho) ?? false;
              return json({
                ...nota,
                aprovavel: nota.aprovavel && !emAjuste,
                ...(emAjuste ? { motivoNaoAprovavel: "Esta página está em ajuste; aprove depois que o ajuste terminar." } : {}),
              });
            } catch (erro) {
              if (erro instanceof ErroDeCaminhoInvalido) return json({ mensagens: [erro.message] }, erro.status);
              throw erro;
            }
          }
          if (url.pathname === "/api/ingestao" && request.method === "GET") {
            try {
              return json({ agente: ingestao?.nomeDoAgente, areas: await areasDaWiki(wiki), conversas: (await ingestao?.listar()) ?? [], atualizador: await estadoAtualizador(raiz) });
            } catch (erro) { return erroDaIngestao(erro); }
          }
          if (url.pathname === "/api/onboarding" && request.method === "GET") {
            const estado = await estadoOnboarding(raiz, ambiente);
            return json(estado);
          }
          if (url.pathname === "/api/onboarding/pasta" && request.method === "POST") {
            if (!ingestao) return respostaSegura("Não encontrado", { status: 404 });
            let corpo: { pasta?: unknown };
            try { corpo = await request.json() as { pasta?: unknown }; } catch { return json({ erro: "Pedido inválido." }, 400); }
            if (typeof corpo.pasta !== "string") return json({ erro: "Caminho da pasta obrigatório." }, 400);
            try {
              const pastaValida = validarPastaVault(corpo.pasta, ambiente);
              const novaRaiz = resolve(pastaValida);
              if (novaRaiz !== raiz) {
                const conversas = await ingestao.listar();
                const emAndamento = conversas.some(c => c.situacao === "rodando");
                if (ingestao.ocupada || emAndamento) {
                  return json({ erro: "Não é possível alterar a pasta enquanto houver uma ingestão em andamento." }, 409);
                }
                await ingestao.encerrar();
                raiz = novaRaiz;
                wiki = caminhoWiki(raiz, ambiente);
                ingestao = await criarIngestao(raiz, opcoes);
                try {
                  const estadoAtual = await obterEstadoUi(ambiente);
                  if (estadoAtual && estadoAtual.pid === process.pid && estadoAtual.token === token) {
                    await gravarEstadoUi({
                      pid: process.pid,
                      porta: estadoAtual.porta,
                      token,
                      pasta: raiz,
                      inicio: estadoAtual.inicio,
                      soRevisao: estadoAtual.soRevisao ?? soRevisao,
                    }, ambiente);
                  }
                } catch {
                  // Se falhar ao gravar o estado, não impede a troca de pasta
                }
              }
              const inspecao = await inspecionarPasta(raiz, ambiente);
              const caminhoOnboarding = join(raiz, ".anvilore", "onboarding.json");
              validarDestinoAnvilore(raiz, caminhoOnboarding);
              if (!inspecao.wikiPronta && !existsSync(caminhoOnboarding)) {
                await mkdir(join(raiz, ".anvilore"), { recursive: true });
                validarDestinoAnvilore(raiz, caminhoOnboarding);
                await writeFile(caminhoOnboarding, JSON.stringify({ concluido: false }, null, 2), "utf8");
              }
              const estado = await estadoOnboarding(raiz, ambiente);
              return json({
                ok: true,
                pasta: raiz,
                inspecao,
                precisaOnboarding: estado.precisaOnboarding,
                concluido: estado.concluido,
                etapa: estado.etapa,
              });
            } catch (erro) {
              return json({ erro: (erro as Error).message }, 400);
            }
          }
          if (url.pathname === "/api/onboarding/testar-agente" && request.method === "POST") {
            try {
              const ponte = opcoes.ponte ?? new PonteClaudeCode();
              const disp = await ponte.disponibilidade();
              if (disp.ok) {
                if (!existsSync(join(raiz, "AGENTS.md"))) {
                  return json({ ok: false, mensagem: "O Claude Code está conectado, mas AGENTS.md não foi encontrado no vault." });
                }
                return json({ ok: true, mensagem: "O Claude Code está disponível e conectado à sua conta." });
              }
              return json({ ok: false, mensagem: disp.motivo });
            } catch (erro) {
              return json({ ok: false, mensagem: (erro as Error).message });
            }
          }
          if (url.pathname === "/api/onboarding/ingerir-exemplo" && request.method === "POST") {
            if (!ingestao) return respostaSegura("Não encontrado", { status: 404 });
            let corpo: { area?: unknown } = {};
            try {
              if (request.headers.get("content-type")?.includes("application/json")) {
                corpo = await request.json() as { area?: unknown };
              }
            } catch { /* corpo opcional */ }
            const caminhoExemplo = join(raiz, "raw/exemplo/llm-wiki.md");
            if (!existsSync(caminhoExemplo)) {
              return json({ erro: "Arquivo de exemplo não encontrado." }, 404);
            }
            try {
              const areasExistentes = await areasDaWiki(wiki);
              let area = typeof corpo.area === "string" ? corpo.area.trim() : "";
              if (areasExistentes.length > 0) {
                if (!area || !areasExistentes.includes(area)) {
                  area = areasExistentes[0]!;
                }
              } else {
                area = "";
              }
              // Mesma operação do botão Ingerir do Início: a conversa cita o original em raw/ e nada novo é gravado lá.
              const conversa = await ingestao.criarDeRaw("exemplo/llm-wiki.md", area);
              try {
                await ingestao.ler(conversa.id);
              } catch (erro) {
                return json({ erro: (erro as Error).message }, 400);
              }
              await concluirOnboarding(raiz);
              return json({ ok: true, id: conversa.id }, 201);
            } catch (erro) {
              return erroDaIngestao(erro);
            }
          }
          if (url.pathname === "/api/onboarding/areas" && request.method === "POST") {
            let corpo: { areas?: unknown; removerExemplo?: unknown };
            try { corpo = await request.json() as { areas?: unknown; removerExemplo?: unknown }; } catch { return json({ erro: "Pedido inválido." }, 400); }
            if (!Array.isArray(corpo.areas) || corpo.areas.length === 0 || !corpo.areas.every(a => typeof a === "string")) {
              return json({ erro: "Lista de áreas inválida." }, 400);
            }
            try {
              const caminhoOnboardingJson = join(raiz, ".anvilore", "onboarding.json");
              validarDestinoAnvilore(raiz, caminhoOnboardingJson);
              const resultado = await inicializarAreasOnboarding(raiz, corpo.areas as string[], { removerExemplo: Boolean(corpo.removerExemplo) }, ambiente);
              if (existsSync(caminhoOnboardingJson)) {
                const conteudo = JSON.parse(await readFile(caminhoOnboardingJson, "utf8")) as Record<string, unknown>;
                if (conteudo.concluido !== true) {
                  conteudo.etapa = 4;
                  validarDestinoAnvilore(raiz, caminhoOnboardingJson);
                  await writeFile(caminhoOnboardingJson, JSON.stringify(conteudo, null, 2), "utf8");
                }
              }
              return json({ ok: true, ...resultado });
            } catch (erro) {
              return json({ erro: (erro as Error).message }, 400);
            }
          }
          if (url.pathname === "/api/onboarding/concluir" && request.method === "POST") {
            try {
              await concluirOnboarding(raiz);
              return json({ ok: true });
            } catch (erro) {
              return json({ erro: (erro as Error).message }, 500);
            }
          }
          if (url.pathname === "/api/atualizador" && request.method === "POST") {
            let corpo: { acao?: unknown };
            try { corpo = await request.json() as { acao?: unknown }; } catch { return json({ mensagens: ["Pedido inválido."] }, 400); }
            if (!["verificar", "aplicar", "voltar", "automatico"].includes(String(corpo.acao))) return json({ mensagens: ["Ação do atualizador inválida."] }, 400);
            try {
              const mensagem = await atualizar(corpo.acao as "verificar" | "aplicar" | "voltar" | "automatico", { raiz });
              return json({ mensagem, atualizador: await estadoAtualizador(raiz) });
            } catch (erro) { return json({ mensagens: [(erro as Error).message], atualizador: await estadoAtualizador(raiz) }, 409); }
          }
          if (url.pathname === "/api/fontes" && request.method === "POST") {
            if (!ingestao) return respostaSegura("Não encontrado", { status: 404 });
            return await receberFonte(request, ingestao, new Date());
          }
          if (url.pathname === "/api/conversas/de-raw" && request.method === "POST") {
            if (!ingestao) return respostaSegura("Não encontrado", { status: 404 });
            let corpo: { caminho?: unknown; area?: unknown };
            try { corpo = await request.json() as { caminho?: unknown; area?: unknown }; } catch { return json({ mensagens: ["Pedido inválido."] }, 400); }
            if (typeof corpo.caminho !== "string" || !corpo.caminho.trim()) return json({ mensagens: ["Caminho inválido."] }, 400);
            const area = typeof corpo.area === "string" ? corpo.area : undefined;
            try { return json(await ingestao.criarDeRaw(corpo.caminho, area), 201); }
            catch (erro) { return erroDaIngestao(erro); }
          }
          const daConversa = ROTA_DA_CONVERSA.exec(url.pathname);
          if (daConversa) {
            if (!ingestao) return respostaSegura("Não encontrado", { status: 404 });
            return await rotaDaConversa(request, daConversa[1]!, daConversa[2], ingestao);
          }
          if (request.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/assets/"))) {
            const raizPublica = resolve(import.meta.dir, "../public");
            const caminho = url.pathname === "/" ? join(raizPublica, "index.html") : resolve(raizPublica, `.${url.pathname}`);
            const caminhoRelativo = relative(raizPublica, caminho);
            if (caminhoRelativo === ".." || caminhoRelativo.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(caminhoRelativo)) return respostaSegura("Não encontrado", { status: 404 });
            try {
              const arquivo = await readFile(caminho);
              const tipo = caminho.endsWith(".html") ? "text/html; charset=utf-8" : caminho.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8";
              const conteudo = tipo.startsWith("text/html") ? arquivo.toString().replaceAll("__ANVILORE_TOKEN__", token) : arquivo;
              return respostaSegura(conteudo, { headers: { "content-type": tipo, "cache-control": "no-store", "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'" } });
            } catch (erro) {
              const codigo = (erro as NodeJS.ErrnoException).code;
              if (codigo === "ENOENT" || codigo === "EISDIR") return respostaSegura("Não encontrado", { status: 404 });
              return respostaSegura("Interface indisponível.", { status: 503 });
            }
          }
          return respostaSegura("Não encontrado", { status: 404 });
        } finally {
          if (ehApi) requisicoesEmVoo--;
        }
      },
      });
      break;
    } catch (erro) {
      const code = (erro as NodeJS.ErrnoException).code;
      if (code !== "EADDRINUSE") throw erro;
      ultimoErro = erro;
    }
  }
  if (!servidor) throw new Error(`Não há porta livre para a interface: ${(ultimoErro as Error | undefined)?.message ?? "sem portas disponíveis"}`);

  const url = `http://127.0.0.1:${servidor.port}/?token=${encodeURIComponent(token)}${soRevisao ? "#revisao" : ""}`;
  if (opcoes.abrirNavegador !== false) (opcoes.abrir ?? abrirNavegador)(url);
  return {
    servidor,
    porta: servidor.port,
    token,
    url,
    encerrar: async () => {
      if (timerInatividade) clearInterval(timerInatividade);
      if (timeoutInatividade) clearTimeout(timeoutInatividade);
      await ingestao?.encerrar();
    },
  };
}
