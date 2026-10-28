import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Rascunho } from "../../src/lib/ui-fila";
import { api } from "./api";
import { Chat, type EstadoDaIngestao } from "./chat";
import { diffLinhas, ErroApi, indiceVizinho } from "./revisao";
import "./styles.css";

type Item = Rascunho & { anterior?: string };
type ResultadoValidacao = { codigo: number; saida: string };
type Filtro = "Todas" | "Novas" | "Atualizadas";
type Tema = "claro" | "escuro";
type Rota = { tela: "chat" | "revisao"; id?: string };

function dataCurta(valor?: string): string {
  if (!valor) return "—";
  const data = new Date(valor);
  return Number.isNaN(data.valueOf()) ? valor : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(data);
}

function lerRota(): Rota {
  const [, tela, id] = window.location.hash.split("/");
  if (tela === "revisao") return { tela: "revisao" };
  return { tela: "chat", ...(id && /^[a-z0-9-]+$/.test(id) ? { id } : {}) };
}

function Aplicacao() {
  const [rota, setRota] = useState<Rota>(lerRota);
  const [tema, setTema] = useState<Tema>(() => localStorage.getItem("anvilore-tema") === "escuro" ? "escuro" : "claro");
  const [estado, setEstado] = useState<EstadoDaIngestao | null>(null);
  const [operandoAtualizador, setOperandoAtualizador] = useState(false);
  const [mensagemAtualizador, setMensagemAtualizador] = useState("");

  useEffect(() => {
    const mudou = () => setRota(lerRota());
    window.addEventListener("hashchange", mudou);
    return () => window.removeEventListener("hashchange", mudou);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = tema;
    localStorage.setItem("anvilore-tema", tema);
  }, [tema]);

  const recarregarEstado = useCallback(async () => {
    try { setEstado(await api<EstadoDaIngestao>("/api/ingestao")); } catch { /* a barra lateral fica sem a lista */ }
  }, []);
  useEffect(() => { void recarregarEstado(); }, [recarregarEstado]);

  const acionarAtualizador = async (acao: "verificar" | "aplicar" | "voltar" | "automatico") => {
    setOperandoAtualizador(true);
    try {
      const resultado = await api<{ mensagem: string }>("/api/atualizador", "POST", { acao });
      setMensagemAtualizador(resultado.mensagem);
      await recarregarEstado();
    } catch (motivo) {
      setMensagemAtualizador(motivo instanceof Error ? motivo.message : "Não foi possível executar o atualizador.");
      await recarregarEstado();
    } finally { setOperandoAtualizador(false); }
  };

  // Voltar à interface sem uma conversa na URL reabre a que ficou no meio do caminho.
  const abertaUmaVez = React.useRef(false);
  useEffect(() => {
    if (abertaUmaVez.current || !estado || rota.tela !== "chat" || rota.id) return;
    abertaUmaVez.current = true;
    const pendente = estado.conversas.find(c => ["rodando", "esperando", "pronta"].includes(c.situacao));
    if (pendente) window.location.hash = `#/chat/${pendente.id}`;
  }, [estado, rota]);

  const abrir = useCallback((id?: string) => { window.location.hash = id ? `#/chat/${id}` : "#/chat"; }, []);
  const alternarTema = useCallback(() => setTema(atual => atual === "claro" ? "escuro" : "claro"), []);

  return <div className="layout">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">a</span><span>anvilore</span></div>
      <nav className="nav" aria-label="Telas">
        <a href="#/chat" className={rota.tela === "chat" && !rota.id ? "active" : ""} onClick={() => abertaUmaVez.current = true}>＋ Nova ingestão</a>
        <a href="#/revisao" className={rota.tela === "revisao" ? "active" : ""}>Revisão</a>
      </nav>
      {estado && estado.conversas.length > 0 && <>
        <div className="vault-label">CONVERSAS</div>
        <nav className="conversations" aria-label="Conversas">
          {estado.conversas.map(c => <a key={c.id} href={`#/chat/${c.id}`} className={rota.id === c.id ? "active" : ""} title={c.fonte}>
            <span className={`conversation-dot ${c.situacao}`} aria-hidden="true" />Ingerir: {c.nome}
          </a>)}
        </nav>
      </>}
      <div className="sidebar-bottom"><span className="status-dot" /> <span>{estado?.agente ?? "Agente"}</span> <span className="sidebar-spacer" /> <span className="mono">raw/ protegido</span></div>
    </aside>
    <div className="main-column">
    {estado?.atualizador && <section className={`update-panel ${["reversao-incompleta", "migracao-incompleta", "aplicando", "revertendo"].includes(estado.atualizador.estado) ? "problem" : ""}`} role={["reversao-incompleta", "migracao-incompleta", "aplicando", "revertendo"].includes(estado.atualizador.estado) ? "alert" : "status"}>
      <div className="update-copy">
        {estado.atualizador.atualizadoEm && Date.now() - Date.parse(estado.atualizador.atualizadoEm) < 60 * 60 * 1000
          ? <strong>Atualizado para {estado.atualizador.versaoInstalada} — o que mudou</strong>
          : <strong>Atualizador · {estado.atualizador.estado}</strong>}
        {estado.atualizador.mudancas.map(item => <span key={item}>{item}</span>)}
        {estado.atualizador.atualizadoEm && Date.now() - Date.parse(estado.atualizador.atualizadoEm) < 60 * 60 * 1000 && estado.atualizador.mudancas.length === 0 && <span>Veja o resumo desta versão em CHANGELOG.md.</span>}
        {estado.atualizador.disponivel && <span>Versão {estado.atualizador.disponivel} conferida e pronta.</span>}
        {estado.atualizador.erro && <span>{estado.atualizador.erro}</span>}
        {estado.atualizador.etapa && <span>Etapa para recuperar: {estado.atualizador.etapa}</span>}
        {mensagemAtualizador && <span>{mensagemAtualizador}</span>}
      </div>
      <div className="update-actions">
        {estado.atualizador.estado === "baixada"
          ? <button disabled={operandoAtualizador} onClick={() => void acionarAtualizador("aplicar")}>Atualizar agora</button>
          : ["aplicando", "revertendo", "reversao-incompleta", "migracao-incompleta"].includes(estado.atualizador.estado)
            ? <button disabled={operandoAtualizador} onClick={() => void acionarAtualizador("automatico")}>Tentar de novo</button>
            : <button disabled={operandoAtualizador} onClick={() => void acionarAtualizador("verificar")}>Verificar agora</button>}
        {estado.atualizador.podeVoltar && <button className="secondary-button" disabled={operandoAtualizador} onClick={() => void acionarAtualizador("voltar")}>Voltar para a versão anterior</button>}
      </div>
    </section>}
    {rota.tela === "revisao" ? <Revisao tema={tema} alternarTema={alternarTema} /> : <Chat id={rota.id} estado={estado} recarregarEstado={recarregarEstado} abrir={abrir} tema={tema} alternarTema={alternarTema} />}
    </div>
  </div>;
}

function Revisao({ tema, alternarTema }: { tema: Tema; alternarTema: () => void }) {
  const [itens, setItens] = useState<Item[] | null>(null);
  const [selecionado, setSelecionado] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("Todas");
  const [aba, setAba] = useState<"visual" | "markdown">("visual");
  const [erro, setErro] = useState("");
  const [validacao, setValidacao] = useState<ResultadoValidacao | null>(null);
  const [validando, setValidando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async (selecionarPrimeiro = false) => {
    try {
      const fila = await api<Item[]>("/api/rascunhos");
      setItens(fila);
      setSelecionado(atual => selecionarPrimeiro || !fila.some(item => item.caminho === atual) ? fila[0]?.caminho ?? "" : atual);
      setErro("");
    } catch (motivo) { setErro(motivo instanceof Error ? motivo.message : "Não foi possível ler a fila."); }
  }, []);

  useEffect(() => { void carregar(true); }, [carregar]);

  const executarValidacao = useCallback(async () => {
    setValidando(true);
    try { setValidacao(await api<ResultadoValidacao>("/api/validar", "POST")); }
    catch (motivo) { setValidacao({ codigo: 1, saida: motivo instanceof Error ? motivo.message : "Falha ao validar a wiki." }); }
    finally { setValidando(false); }
  }, []);

  useEffect(() => {
    if (itens !== null && itens.length === 0 && validacao === null && !validando) void executarValidacao();
  }, [itens, validacao, validando, executarValidacao]);

  const filtrados = useMemo(() => (itens ?? []).filter(item => filtro === "Todas" || (filtro === "Novas" ? item.status === "nova" : item.status === "atualizada")), [itens, filtro]);
  const item = filtrados.find(candidato => candidato.caminho === selecionado) ?? filtrados[0];

  const aprovar = useCallback(async () => {
    if (!item?.aprovavel || salvando) return;
    setSalvando(true);
    try {
      const resultado = await api<{ codigo: number; mensagens: string[] }>("/api/aprovar", "POST", { caminho: item.caminho, versao: item.versao });
      if (resultado.codigo !== 0) throw new Error(resultado.mensagens.join(" "));
      await carregar();
    } catch (motivo) {
      const mensagem = motivo instanceof Error ? motivo.message : "Não foi possível aprovar.";
      if (motivo instanceof ErroApi && motivo.codigo === 3) { await carregar(); setErro(mensagem); }
      else setErro(mensagem);
    }
    finally { setSalvando(false); }
  }, [item, salvando, carregar]);

  useEffect(() => {
    const teclado = (evento: KeyboardEvent) => {
      if (evento.altKey || evento.ctrlKey || evento.metaKey || evento.target instanceof HTMLInputElement || evento.target instanceof HTMLTextAreaElement) return;
      const atual = filtrados.findIndex(candidato => candidato.caminho === selecionado);
      if (evento.key.toLowerCase() === "j") { evento.preventDefault(); const proximo = indiceVizinho(atual, 1, filtrados.length); if (proximo >= 0) setSelecionado(filtrados[proximo]!.caminho); }
      if (evento.key.toLowerCase() === "k") { evento.preventDefault(); const anterior = indiceVizinho(atual, -1, filtrados.length); if (anterior >= 0) setSelecionado(filtrados[anterior]!.caminho); }
      if (evento.key.toLowerCase() === "a" && item?.aprovavel) { evento.preventDefault(); void aprovar(); }
    };
    window.addEventListener("keydown", teclado);
    return () => window.removeEventListener("keydown", teclado);
  }, [filtrados, selecionado, item, aprovar]);

  const linhas = item?.anterior !== undefined ? diffLinhas(item.anterior, item.conteudo) : [];
  const pendentes = itens?.length ?? 0;

  return <main className="main">
      <header className="topbar">
        <div><h1>Revisão</h1><span className="subhead">{pendentes ? `${pendentes} aguardando você` : itens === null ? "Lendo a wiki…" : "nada pendente"}</span></div>
        <div className="top-actions">
          <div className="segmented" role="group" aria-label="Filtrar rascunhos">
            {(["Todas", "Novas", "Atualizadas"] as Filtro[]).map(opcao => <button key={opcao} className={filtro === opcao ? "selected" : ""} aria-pressed={filtro === opcao} onClick={() => setFiltro(opcao)}>{opcao}</button>)}
          </div>
          <button className="icon-button" title="Alternar tema" aria-label="Alternar tema claro ou escuro" onClick={alternarTema}>{tema === "claro" ? "◐" : "☼"}</button>
        </div>
      </header>

      {erro && <div className="alert" role="alert">{erro}</div>}
      {itens === null ? <div className="loading">Lendo os rascunhos…</div> : itens.length === 0 ? <section className="done-state">
        <div className="done-icon">✓</div><h2>Tudo revisado</h2><p>{validando ? "Validando a wiki…" : validacao?.codigo === 0 ? "A validação passou." : validacao ? "A validação encontrou problemas." : "A validação vai começar."}</p>
        {validacao && <><span className={`result-badge ${validacao.codigo === 0 ? "pass" : "fail"}`}>CÓDIGO {validacao.codigo} · {validacao.codigo === 0 ? "PASS" : "FAIL"}</span><pre className="validation-output">{validacao.saida}</pre></>}
        <button className="secondary-button" onClick={() => void executarValidacao()} disabled={validando}>{validando ? "Validando…" : "Validar de novo"}</button>
      </section> : <div className="workspace">
        <section className="queue" aria-label="Rascunhos">
          <div className="queue-title"><span>▤</span> Fila de revisão <span className="count">{filtrados.length}</span></div>
          <div className="queue-items" role="listbox" aria-label="Páginas pendentes">
            {filtrados.map(candidato => <button key={candidato.caminho} className={`queue-item ${selecionado === candidato.caminho ? "active" : ""}`} role="option" aria-selected={selecionado === candidato.caminho} onClick={() => { setSelecionado(candidato.caminho); setAba("visual"); }}>
              <span className={`queue-status ${candidato.status}`} aria-hidden="true">{candidato.status === "erro" ? "!" : candidato.status === "atualizada" ? "↻" : "·"}</span>
              <span className="queue-copy"><strong>{candidato.titulo}</strong><span>{candidato.tipo || "Página"} · {candidato.status === "nova" ? "nova" : candidato.status === "atualizada" ? "atualizada" : "erro"}</span></span>
            </button>)}
            {filtrados.length === 0 && <div className="empty-filter">Nenhuma página neste filtro.</div>}
          </div>
          <div className="keyboard-hint"><span><kbd>J</kbd> próxima</span><span><kbd>K</kbd> anterior</span></div>
        </section>

        {item && <section className="preview" aria-label="Pré-visualização do rascunho">
          <div className="preview-scroll">
            <div className="page-content">
              <div className="page-kicker"><code>{item.caminho}</code><span className={`kind-pill ${item.status}`}>{item.status === "nova" ? "rascunho · nova" : item.status === "atualizada" ? "rascunho · atualizada" : "erro de validação"}</span></div>
              <h2>{item.titulo}</h2>
              <dl className="metadata">
                <dt>Gerada por</dt><dd><code>{item.geradoPor ?? "—"}</code> · {dataCurta(item.geradoEm)}</dd>
                <dt>Fonte</dt><dd><code>{item.fonte ?? "não informada"}</code></dd>
                {item.aprovacaoAnterior && <><dt>Aprovação</dt><dd className="expired">Aprovação anterior: {item.aprovacaoAnterior}</dd></>}
              </dl>
              {item.erros?.map(mensagem => <div className="alert validation-error" key={mensagem}>{mensagem}</div>)}
              {item.avisos?.map(mensagem => <div className="review-warning" role="note" key={mensagem}>{mensagem}</div>)}
              <div className="tabs" role="tablist" aria-label="Visualização da página">
                <button role="tab" aria-selected={aba === "visual"} onClick={() => setAba("visual")}>{item.anterior !== undefined ? "Mudanças" : "Página nova"}</button>
                <button role="tab" aria-selected={aba === "markdown"} onClick={() => setAba("markdown")}>Markdown</button>
              </div>
              {aba === "markdown" ? <pre className="markdown-view">{item.conteudo}</pre> : item.anterior !== undefined ? <div className="diff-view">{linhas.map((linha, indice) => <div className={`diff-line ${linha.tipo}`} key={`${indice}-${linha.tipo}`}><span>{linha.tipo === "adicionada" ? "+" : linha.tipo === "removida" ? "−" : " "}</span><pre>{linha.texto || " "}</pre></div>)}</div> : <article className="new-page"><MarkdownSeguro texto={item.conteudo} /></article>}
            </div>
          </div>
          <footer className="review-actions">
            <button className="approve-button" disabled={!item.aprovavel || salvando} onClick={() => void aprovar()}><span>✓</span>{salvando ? "Aprovando…" : "Aprovar"}<kbd>A</kbd></button>
            <span className="approval-note">A aprovação registra <code>verified: human:…</code></span>
          </footer>
        </section>}
      </div>}
  </main>;
}

function MarkdownSeguro({ texto }: { texto: string }) {
  const corpo = texto.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
  return <div className="markdown-body">{corpo.split(/\n\s*\n/).map((bloco, indice) => {
    const linha = bloco.trim();
    const titulo = /^(#{1,6})\s+(.+)$/.exec(linha);
    if (titulo) return React.createElement(`h${titulo[1]!.length}`, { key: indice }, titulo[2]);
    if (/^>\s?/.test(linha)) return <blockquote key={indice}>{linha.replace(/^>\s?/gm, "")}</blockquote>;
    if (/^[-*]\s/.test(linha)) return <ul key={indice}>{linha.split("\n").map((item, n) => <li key={n}>{item.replace(/^[-*]\s/, "")}</li>)}</ul>;
    return <p key={indice}>{linha}</p>;
  })}</div>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><Aplicacao /></React.StrictMode>);
