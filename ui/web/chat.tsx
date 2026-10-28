import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Atividade, Conversa, ResumoDeConversa } from "../../src/lib/ui-ingestao";
import { api } from "./api";
import { avisoDoFechamento, passosDoPainel, podeLerDeNovo, tamanhoLegivel, textoDeSeguir } from "./ingestao";

export type EstadoDaIngestao = { agente: string; areas: string[]; conversas: ResumoDeConversa[] };

type Propriedades = {
  id?: string;
  estado: EstadoDaIngestao | null;
  recarregarEstado: () => Promise<void>;
  abrir: (id?: string) => void;
  tema: "claro" | "escuro";
  alternarTema: () => void;
};

const RODANDO_A_CADA_MS = 800;
const CERTEZA: Record<string, string> = { provavel: "provável", inferencia: "inferência" };

function mensagem(erro: unknown, padrao: string): string {
  return erro instanceof Error ? erro.message : padrao;
}

export function Chat({ id, estado, recarregarEstado, abrir, tema, alternarTema }: Propriedades) {
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

  const naParada = conversa?.passo === "parada" && conversa.situacao === "esperando";
  const rodando = conversa?.situacao === "rodando";
  const passos = passosDoPainel(conversa ?? undefined);

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
          {!conversa ? (id ? <div className="loading">Abrindo a ingestão…</div> : <NovaIngestao estado={estado} aoCriar={async (criada, motivo) => { avisoAoAbrir.current = motivo ?? ""; await recarregarEstado(); abrir(criada.id); }} />) : <>
            <Mensagem autor="Você">
              <p>Ingere esta fonte{conversa.area ? ` na área ${conversa.area}` : ""}.</p>
              <div className="file-card"><span className="file-icon">{conversa.nome.split(".").pop()?.slice(0, 4).toUpperCase() || "ARQ"}</span><span><strong>{conversa.nome}</strong><small>{tamanhoLegivel(conversa.bytes)}</small></span></div>
            </Mensagem>
            <div className="system-note"><span aria-hidden="true">🔒</span> Você salvou o arquivo em <code>{conversa.fonte}</code>. O agente lê <code>raw/</code>, nunca escreve.</div>
            {conversa.passo === "fonte" && <div className="actions-row"><button className="approve-button" disabled={ocupado} onClick={() => void ler()}>Ingerir</button></div>}
            {conversa.passo !== "fonte" && <Mensagem autor={estado?.agente ?? "Agente"} agente>
              <Leituras itens={conversa.atividade.filter(a => a.papel === "leitor")} />
              {conversa.passo === "leitura" && <EstadoDaFase conversa={conversa} ocupado={ocupado} aoCancelar={cancelar} aoLerDeNovo={ler} />}
              {conversa.relatorio && <>
                <p>Li a fonte inteira. Estes são os pontos principais, cada um com o trecho que o sustenta. {naParada ? "Desmarque o que não deve entrar na wiki:" : ""}</p>
                {conversa.avisos.map(aviso => <div className="review-warning inline" role="note" key={aviso}>{aviso}</div>)}
                <div className="card">
                  <div className="card-head"><strong>Takeaways</strong><span>{takeaways.filter(Boolean).length} de {takeaways.length} selecionados</span></div>
                  {conversa.relatorio.takeaways.map((takeaway, i) => <label className={`takeaway ${takeaways[i] ? "" : "off"}`} key={i}>
                    <input type="checkbox" checked={takeaways[i] ?? true} disabled={!naParada} onChange={() => setTakeaways(atual => atual.map((v, j) => j === i ? !v : v))} />
                    <span><span className="takeaway-text">{takeaway.texto}{takeaway.certeza !== "comprovado" && <em className="certainty"> · {CERTEZA[takeaway.certeza]}</em>}</span>
                      <span className="quote">“{takeaway.citacao.trecho}” <code>§ {takeaway.citacao.secao}</code></span></span>
                  </label>)}
                </div>
                <div className="plan-grid">
                  {(["criar", "atualizar"] as const).map(acao => {
                    const indices = conversa.relatorio!.paginas.flatMap((p, i) => p.acao === acao ? [i] : []);
                    return <div className="card" key={acao}>
                      <div className="card-head"><strong>{acao === "criar" ? "Criar" : "Atualizar"} · {indices.length}</strong></div>
                      {indices.map(i => {
                        const pagina = conversa.relatorio!.paginas[i]!;
                        const fixa = pagina.tipo === "source";
                        return <label className={`plan-item ${paginas[i] ? "" : "off"}`} key={pagina.caminho} title={pagina.motivo}>
                          <input type="checkbox" checked={paginas[i] ?? true} disabled={!naParada || fixa} onChange={() => setPaginas(atual => atual.map((v, j) => j === i ? !v : v))} />
                          <span className={`glyph ${pagina.tipo}`} aria-hidden="true" /><code>{pagina.caminho}</code>
                        </label>;
                      })}
                      {indices.length === 0 && <div className="empty-filter">Nenhuma.</div>}
                    </div>;
                  })}
                </div>
                {conversa.relatorio.lacunas.length > 0 && <div className="note-list"><strong>Lacunas</strong><ul>{conversa.relatorio.lacunas.map(l => <li key={l}>{l}</li>)}</ul></div>}
                {conversa.relatorio.contradicoes.length > 0 && <div className="note-list"><strong>Contradições (registradas, não resolvidas)</strong><ul>{conversa.relatorio.contradicoes.map(c => <li key={c.pagina + c.descricao}><code>{c.pagina}</code>: {c.descricao}</li>)}</ul></div>}
                {naParada && <div className="decision">
                  <textarea value={comentario} onChange={evento => setComentario(evento.target.value)} maxLength={4000} placeholder="Responda ao agente: enfatize, corte ou corrija um takeaway…" aria-label="Comentário para o escritor" />
                  <div className="actions-row"><button className="approve-button" disabled={ocupado || !takeaways.some(Boolean)} onClick={() => void seguir()}>Pode seguir</button></div>
                </div>}
              </>}
            </Mensagem>}
            {conversa.escolha && conversa.relatorio && <Mensagem autor="Você">
              <p>{textoDeSeguir(conversa.relatorio.takeaways.map((_, i) => conversa.escolha!.takeaways.includes(i)), conversa.relatorio.paginas.map((_, i) => conversa.escolha!.paginas.includes(i)))}</p>
              {conversa.escolha.comentario && <p className="comment">{conversa.escolha.comentario}</p>}
            </Mensagem>}
            {["escrita", "fechamento", "revisao"].includes(conversa.passo) && <Mensagem autor={estado?.agente ?? "Agente"} agente>
              <Escritas conversa={conversa} />
              {conversa.passo === "escrita" && <EstadoDaFase conversa={conversa} ocupado={ocupado} aoCancelar={cancelar} />}
              {conversa.passo === "fechamento" && <div className="now"><span className="pulse" /> Rodando <code>anvilore fechar</code>…</div>}
              {conversa.fechamento && <Fechamento conversa={conversa} />}
            </Mensagem>}
          </>}
        </div>
      </section>
      <aside className="ingest-panel" aria-label="Progresso da ingestão">
        <h2>Ingestão</h2>
        <ol className="steps">
          {passos.map(passo => <li key={passo.rotulo} className={passo.estado}>
            <span className="step-mark" aria-hidden="true">{passo.estado === "feito" ? "✓" : passo.estado === "parou" ? "!" : ""}</span>
            <span><strong>{passo.rotulo}</strong><small>{passo.dica}</small></span>
            <span className="sr-only">{passo.estado}</span>
          </li>)}
        </ol>
        {rodando && conversa?.agora && <div className="now panel-now"><span className="pulse" /> {conversa.agora}</div>}
        {conversa && <>
          <h2>Fonte</h2>
          <code className="source-path">{conversa.fonte}</code>
          <dl className="facts"><dt>Tamanho</dt><dd>{tamanhoLegivel(conversa.bytes)}</dd>{conversa.rota && <><dt>Janela</dt><dd>{conversa.rota === "grande" ? "grande (custa mais)" : "padrão"}</dd></>}</dl>
        </>}
        <h2>Garantias</h2>
        <ul className="guarantees">
          <li><code>raw/</code> bloqueado pelo hook: o agente não grava lá.</li>
          <li>Toda página nasce rascunho, com <code>generated</code>.</li>
          <li>Só você grava <code>verified</code>, na tela de Revisão.</li>
        </ul>
      </aside>
    </div>
  </main>;
}

function Mensagem({ autor, agente = false, children }: { autor: string; agente?: boolean; children: React.ReactNode }) {
  return <div className="message">
    <span className={`avatar ${agente ? "agent" : ""}`} aria-hidden="true">{agente ? ">_" : autor.slice(0, 1)}</span>
    <div className="message-body"><div className="message-author">{autor}</div>{children}</div>
  </div>;
}

function Leituras({ itens }: { itens: Atividade[] }) {
  if (!itens.length) return null;
  return <details className="activity" open>
    <summary><span>{itens.length} {itens.length === 1 ? "leitura" : "leituras"}</span><span className="muted">nada escrito</span></summary>
    {itens.map(item => <div className={`activity-row ${item.estado}`} key={item.id}><span className="verb">{item.verbo}</span><code>{item.alvo}</code>{item.motivo && <span className="muted">{item.motivo}</span>}</div>)}
  </details>;
}

function Escritas({ conversa }: { conversa: Conversa }) {
  const itens = conversa.atividade.filter(a => a.papel === "escritor");
  const meta = (item: Atividade) => item.estado === "andamento" ? "escrevendo…" : item.estado === "recusado" ? item.motivo ?? "recusado" : item.estado === "interrompido" ? "interrompido" : item.alvo.startsWith("wiki/") && !item.alvo.startsWith("wiki/log/") && item.alvo !== "wiki/index.md" ? "rascunho" : "";
  return <div className="activity writes">
    <div className="activity-head"><span>{conversa.passo === "escrita" && conversa.situacao === "rodando" ? `Escrevendo · ${itens.length}` : `${itens.length} ${itens.length === 1 ? "escrita" : "escritas"}`}</span><span className="muted">só na wiki</span></div>
    {itens.map(item => <div className={`activity-row ${item.estado}`} key={item.id}><span className="verb">{item.verbo}</span><code>{item.alvo}</code><span className="muted">{meta(item)}</span></div>)}
    {itens.length === 0 && <div className="activity-row"><span className="muted">Nada escrito ainda.</span></div>}
  </div>;
}

function EstadoDaFase({ conversa, ocupado, aoCancelar, aoLerDeNovo }: { conversa: Conversa; ocupado: boolean; aoCancelar: () => void; aoLerDeNovo?: () => void }) {
  const lerDeNovo = aoLerDeNovo && podeLerDeNovo(conversa) ? <button className="secondary-button" disabled={ocupado} onClick={aoLerDeNovo}>Ler de novo</button> : null;
  if (conversa.situacao === "rodando") return <div className="now"><span className="pulse" /> {conversa.agora ?? "Trabalhando…"}<button className="link-button" disabled={ocupado} onClick={aoCancelar}>Cancelar ingestão</button></div>;
  if (conversa.situacao === "cancelada") return <div className="system-note">Ingestão cancelada. {conversa.passo === "escrita" ? "O que já foi escrito ficou na wiki como rascunho." : "Nada foi escrito."} {lerDeNovo}</div>;
  if (conversa.situacao === "erro" || conversa.situacao === "interrompida") return <div className="alert inline" role="alert">
    <p>{conversa.erro}</p>
    {conversa.mensagens && <pre className="validation-output">{conversa.mensagens.join("\n")}</pre>}
    {lerDeNovo}
  </div>;
  return null;
}

function Fechamento({ conversa }: { conversa: Conversa }) {
  const fechamento = conversa.fechamento!;
  const aviso = avisoDoFechamento(fechamento);
  const novas = conversa.atividade.filter(a => a.papel === "escritor" && a.verbo === "Criou").length;
  const atualizadas = conversa.atividade.filter(a => a.papel === "escritor" && a.verbo === "Atualizou" && a.alvo !== "wiki/index.md").length;
  return <>
    <details className="activity" open={aviso.tipo === "erro"}>
      <summary><span>Rodou <code>anvilore fechar</code></span><span className={`result-badge ${fechamento.codigo === 0 ? "pass" : aviso.tipo === "rascunhos" ? "draft" : "fail"}`}>CÓDIGO {fechamento.codigo}</span></summary>
      <pre className="validation-output">{fechamento.saida}</pre>
    </details>
    {aviso.tipo === "erro" ? <div className="alert inline" role="alert">
      <p>{aviso.texto}. Veja a saída acima.</p>
      {fechamento.rascunhos > 0 && <a className="secondary-button" href="#/revisao">Revisar os {fechamento.rascunhos} rascunhos</a>}
    </div> : <div className="drafts-card">
      <div><strong>{aviso.texto}</strong><small>{novas} {novas === 1 ? "nova" : "novas"} · {atualizadas} {atualizadas === 1 ? "atualizada" : "atualizadas"}{atualizadas ? " (a aprovação antiga deixa de valer)" : ""}</small></div>
      <a className="approve-button" href="#/revisao">Revisar agora</a>
    </div>}
  </>;
}

function NovaIngestao({ estado, aoCriar }: { estado: EstadoDaIngestao | null; aoCriar: (conversa: Conversa, motivo?: string) => Promise<void> }) {
  const [area, setArea] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [texto, setTexto] = useState("");
  const [arrastando, setArrastando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const areas = estado?.areas ?? [];
  useEffect(() => { if (!area && areas.length) setArea(areas[0]!); }, [area, areas]);

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
