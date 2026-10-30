import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Conversa, ResumoDeConversa } from "../../src/lib/ui-ingestao";
import { api } from "./api";
import { type AcoesDaConversa, ConversaDaIngestao, PainelDaIngestao } from "./conversa";
import { tamanhoLegivel } from "./ingestao";

export type EstadoAtualizador = { estado: string; versaoInstalada?: string; atualizadoEm?: string; disponivel?: string; etapa?: string; erro?: string; podeVoltar: boolean; mudancas: string[] };
export type EstadoDaIngestao = { agente: string; areas: string[]; conversas: ResumoDeConversa[]; atualizador: EstadoAtualizador | null };

type Propriedades = {
  id?: string;
  lacuna?: string;
  estado: EstadoDaIngestao | null;
  recarregarEstado: () => Promise<void>;
  abrir: (id?: string) => void;
  tema: "claro" | "escuro";
  alternarTema: () => void;
};

const RODANDO_A_CADA_MS = 800;

function mensagem(erro: unknown, padrao: string): string {
  return erro instanceof Error ? erro.message : padrao;
}

export function Chat({ id, lacuna, estado, recarregarEstado, abrir, tema, alternarTema }: Propriedades) {
  const [conversa, setConversa] = useState<Conversa | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [takeaways, setTakeaways] = useState<boolean[]>([]);
  const [paginas, setPaginas] = useState<boolean[]>([]);
  const [comentario, setComentario] = useState("");
  const situacaoAnterior = useRef("");
  // O motivo de não ter começado (ex.: sem login) vem da tela de envio e aparece na conversa aberta.
  const avisoAoAbrir = useRef("");

  const carregar = useCallback(async (alvo: string) => {
    try { setConversa(await api<Conversa>(`/api/conversas/${alvo}`)); }
    catch (motivo) { setConversa(null); setErro(mensagem(motivo, "Não foi possível abrir a ingestão.")); }
  }, []);

  useEffect(() => {
    setErro(avisoAoAbrir.current);
    avisoAoAbrir.current = "";
    if (id) void carregar(id);
    else setConversa(null);
  }, [id, carregar]);

  // Enquanto o agente roda, a tela relê o estado gravado em disco: recarregar a página volta ao mesmo ponto.
  useEffect(() => {
    if (!id || conversa?.situacao !== "rodando") return;
    const intervalo = setInterval(() => void carregar(id), RODANDO_A_CADA_MS);
    return () => clearInterval(intervalo);
  }, [id, conversa?.situacao, carregar]);

  useEffect(() => {
    const atual = `${conversa?.id}:${conversa?.passo}:${conversa?.situacao}`;
    if (situacaoAnterior.current && situacaoAnterior.current !== atual) void recarregarEstado();
    situacaoAnterior.current = atual;
  }, [conversa?.id, conversa?.passo, conversa?.situacao, recarregarEstado]);

  useEffect(() => {
    const relatorio = conversa?.relatorio;
    if (!relatorio) return;
    const escolha = conversa.escolha;
    setTakeaways(relatorio.takeaways.map((_, i) => escolha ? escolha.takeaways.includes(i) : true));
    setPaginas(relatorio.paginas.map((_, i) => escolha ? escolha.paginas.includes(i) : true));
  }, [conversa?.id, conversa?.relatorio, conversa?.escolha]);

  const agir = useCallback(async (acao: () => Promise<Conversa>) => {
    setOcupado(true);
    try { setConversa(await acao()); setErro(""); }
    catch (motivo) { setErro(mensagem(motivo, "Não foi possível falar com o Anvilore.")); if (id) await carregar(id); }
    finally { setOcupado(false); }
  }, [id, carregar]);

  const ler = () => conversa && agir(() => api<Conversa>(`/api/conversas/${conversa.id}/ler`, "POST"));
  const cancelar = () => conversa && agir(() => api<Conversa>(`/api/conversas/${conversa.id}/cancelar`, "POST"));
  const seguir = () => conversa?.relatorio && agir(() => api<Conversa>(`/api/conversas/${conversa.id}/seguir`, "POST", {
    takeaways: takeaways.flatMap((marcado, i) => marcado ? [i] : []),
    paginas: paginas.flatMap((marcada, i) => marcada ? [i] : []),
    comentario,
  }));

  const acoes: AcoesDaConversa = {
    aoLer: () => void ler(),
    aoCancelar: () => void cancelar(),
    aoSeguir: () => void seguir(),
    alternarTakeaway: indice => setTakeaways(atual => atual.map((v, j) => j === indice ? !v : v)),
    alternarPagina: indice => setPaginas(atual => atual.map((v, j) => j === indice ? !v : v)),
    mudarComentario: setComentario,
  };

  return <main className="main chat-main">
    <header className="topbar">
      <div className="breadcrumb"><span>Chat</span><span aria-hidden="true">›</span><h1>{conversa ? `Ingerir: ${conversa.nome}` : "Nova ingestão"}</h1></div>
      <div className="top-actions">
        <span className="pill"><span className="status-dot" /> {estado?.agente ?? "Agente"} · sessão local</span>
        {conversa?.area && <span className="pill">Área: <strong>{conversa.area}</strong></span>}
        <button className="icon-button" title="Alternar tema" aria-label="Alternar tema claro ou escuro" onClick={alternarTema}>{tema === "claro" ? "◐" : "☼"}</button>
      </div>
    </header>
    <div className="chat-workspace">
      <section className="thread" aria-label="Conversa da ingestão">
        <div className="thread-scroll">
          {erro && <div className="alert" role="alert">{erro}</div>}
          {!conversa ? (id ? <div className="loading">Abrindo a ingestão…</div> : <NovaIngestao lacuna={lacuna} estado={estado} aoCriar={async (criada, motivo) => { avisoAoAbrir.current = motivo ?? ""; await recarregarEstado(); abrir(criada.id); }} />)
            : <ConversaDaIngestao conversa={conversa} agente={estado?.agente ?? "Agente"} ocupado={ocupado} takeaways={takeaways} paginas={paginas} comentario={comentario} acoes={acoes} />}
        </div>
      </section>
      <PainelDaIngestao conversa={conversa} />
    </div>
  </main>;
}

function NovaIngestao({ lacuna, estado, aoCriar }: { lacuna?: string; estado: EstadoDaIngestao | null; aoCriar: (conversa: Conversa, motivo?: string) => Promise<void> }) {
  const [area, setArea] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [texto, setTexto] = useState(lacuna ?? "");
  const [arrastando, setArrastando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const areas = estado?.areas ?? [];
  useEffect(() => { if (!area && areas.length) setArea(areas[0]!); }, [area, areas]);
  useEffect(() => { setTexto(lacuna ?? ""); }, [lacuna]);

  const ingerir = async () => {
    setEnviando(true);
    setErro("");
    const dados = new FormData();
    dados.append("area", area);
    if (arquivo) dados.append("arquivo", arquivo, arquivo.name);
    else dados.append("texto", texto);
    let criada: Conversa | undefined;
    try {
      criada = await api<Conversa>("/api/fontes", "POST", dados);
      // Apertar Ingerir já dispara o leitor; se o agente não estiver pronto, a conversa fica na fonte com o motivo.
      criada = await api<Conversa>(`/api/conversas/${criada.id}/ler`, "POST");
      await aoCriar(criada);
      return;
    } catch (motivo) {
      const texto = mensagem(motivo, "Não foi possível ingerir.");
      if (criada) await aoCriar(criada, texto);
      else { setErro(texto); setEnviando(false); }
    }
  };

  return <div className="new-ingest">
    <h2>Ingerir uma fonte</h2>
    <p className="muted">A fonte vai para <code>raw/{area ? `${area}/` : ""}</code>. O agente lê, você aprova o que entra, e só então ele escreve.</p>
    {erro && <div className="alert inline" role="alert">{erro}</div>}
    {areas.length > 0 && <label className="field">Área
      <select value={area} onChange={evento => setArea(evento.target.value)}>{areas.map(a => <option key={a}>{a}</option>)}</select>
    </label>}
    <label className={`dropzone ${arrastando ? "dragging" : ""}`}
      onDragOver={evento => { evento.preventDefault(); setArrastando(true); }}
      onDragLeave={() => setArrastando(false)}
      onDrop={evento => { evento.preventDefault(); setArrastando(false); const solto = evento.dataTransfer.files[0]; if (solto) setArquivo(solto); }}>
      <input type="file" onChange={evento => setArquivo(evento.target.files?.[0] ?? null)} />
      {arquivo ? <span><strong>{arquivo.name}</strong> · {tamanhoLegivel(arquivo.size)}</span> : <span>Solte um arquivo aqui ou <u>escolha</u></span>}
    </label>
    {!arquivo && <textarea value={texto} onChange={evento => setTexto(evento.target.value)} placeholder="…ou cole o texto da fonte" aria-label="Texto da fonte" />}
    {arquivo && <button className="link-button" onClick={() => setArquivo(null)}>Trocar arquivo</button>}
    <div className="actions-row"><button className="approve-button" disabled={enviando || (!arquivo && !texto.trim())} onClick={() => void ingerir()}>{enviando ? "Enviando…" : "Ingerir"}</button></div>
  </div>;
}
