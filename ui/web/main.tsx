import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Rascunho } from "../../src/lib/ui-fila";
import { diffLinhas, indiceVizinho } from "./revisao";
import "./styles.css";

type Item = Rascunho & { anterior?: string };
type ResultadoValidacao = { codigo: number; saida: string };
type Filtro = "Todas" | "Novas" | "Atualizadas";

const token = document.querySelector<HTMLMetaElement>('meta[name="anvilore-token"]')?.content ?? "";
const parametroToken = `token=${encodeURIComponent(token)}`;

async function api<T>(rota: string, metodo = "GET", corpo?: unknown): Promise<T> {
  const resposta = await fetch(`${rota}?${parametroToken}`, {
    method: metodo,
    ...(corpo === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) }),
  });
  if (!resposta.ok) throw new Error((await resposta.text()) || "Falha ao falar com o Anvilore.");
  return await resposta.json() as T;
}

function dataCurta(valor?: string): string {
  if (!valor) return "—";
  const data = new Date(valor);
  return Number.isNaN(data.valueOf()) ? valor : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(data);
}

function Aplicacao() {
  const [itens, setItens] = useState<Item[] | null>(null);
  const [selecionado, setSelecionado] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("Todas");
  const [aba, setAba] = useState<"visual" | "markdown">("visual");
  const [tema, setTema] = useState<"claro" | "escuro">(() => localStorage.getItem("anvilore-tema") === "escuro" ? "escuro" : "claro");
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
  useEffect(() => {
    document.documentElement.dataset.theme = tema;
    localStorage.setItem("anvilore-tema", tema);
  }, [tema]);

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
      const resultado = await api<{ codigo: number; mensagens: string[] }>("/api/aprovar", "POST", { caminho: item.caminho });
      if (resultado.codigo !== 0) throw new Error(resultado.mensagens.join(" "));
      await carregar();
    } catch (motivo) { setErro(motivo instanceof Error ? motivo.message : "Não foi possível aprovar."); }
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

  return <div className="layout">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">a</span><span>anvilore</span></div>
      <div className="vault-label">REVISÃO</div>
      <div className="vault-path" title="Fila de páginas geradas">Rascunhos da wiki</div>
      <div className="sidebar-bottom"><span className="status-dot" /> Local · protegido <span className="sidebar-spacer" /> <span className="mono">127.0.0.1</span></div>
    </aside>

    <main className="main">
      <header className="topbar">
        <div><h1>Revisão</h1><span className="subhead">{pendentes ? `${pendentes} aguardando você` : itens === null ? "Lendo a wiki…" : "nada pendente"}</span></div>
        <div className="top-actions">
          <div className="segmented" role="group" aria-label="Filtrar rascunhos">
            {(["Todas", "Novas", "Atualizadas"] as Filtro[]).map(opcao => <button key={opcao} className={filtro === opcao ? "selected" : ""} aria-pressed={filtro === opcao} onClick={() => setFiltro(opcao)}>{opcao}</button>)}
          </div>
          <button className="icon-button" title="Alternar tema" aria-label="Alternar tema claro ou escuro" onClick={() => setTema(tema === "claro" ? "escuro" : "claro")}>{tema === "claro" ? "◐" : "☼"}</button>
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
    </main>
  </div>;
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
