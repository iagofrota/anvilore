import React from "react";
import type { Atividade, Conversa } from "../../src/lib/ui-ingestao";
import { avisoDoFechamento, passosDoPainel, podeLerDeNovo, tamanhoLegivel, textoDeSeguir } from "./ingestao";

const CERTEZA: Record<string, string> = { provavel: "provável", inferencia: "inferência" };

export type AcoesDaConversa = {
  aoLer: () => void;
  aoCancelar: () => void;
  aoSeguir: () => void;
  alternarTakeaway: (indice: number) => void;
  alternarPagina: (indice: number) => void;
  mudarComentario: (texto: string) => void;
};

type PropriedadesDaConversa = { conversa: Conversa; agente: string; ocupado: boolean; takeaways: boolean[]; paginas: boolean[]; comentario: string; acoes: AcoesDaConversa };

// A conversa de uma ingestão, só a partir do estado: sem hooks nem chamadas à API, para ser testável sem navegador.
export function ConversaDaIngestao({ conversa, agente, ocupado, takeaways, paginas, comentario, acoes }: PropriedadesDaConversa) {
  if (conversa.tipo === "ajuste") {
    return <>
      <Mensagem autor="Você">
        <p>Ajuste na página <code>{conversa.pagina ?? conversa.nome}</code>:</p>
        <p className="comment">{conversa.pedido}</p>
      </Mensagem>
      <div className="system-note"><span aria-hidden="true">🔒</span> Ajuste restrito a <code>{conversa.fonte}</code>. O escritor só pode editar esta página.</div>
      <Mensagem autor={agente} agente>
        <Escritas conversa={conversa} />
        {conversa.passo === "escrita" && <EstadoDaFase conversa={conversa} ocupado={ocupado} aoCancelar={acoes.aoCancelar} />}
        {conversa.passo === "fechamento" && <div className="now"><span className="pulse" /> Rodando <code>anvilore fechar</code>…</div>}
        {conversa.fechamento && <Fechamento conversa={conversa} />}
      </Mensagem>
    </>;
  }

  const naParada = conversa.passo === "parada" && conversa.situacao === "esperando";
  return <>
    <Mensagem autor="Você">
      <p>Ingere esta fonte{conversa.area ? ` na área ${conversa.area}` : ""}.</p>
      <div className="file-card"><span className="file-icon">{conversa.nome.split(".").pop()?.slice(0, 4).toUpperCase() || "ARQ"}</span><span><strong>{conversa.nome}</strong><small>{tamanhoLegivel(conversa.bytes)}</small></span></div>
    </Mensagem>
    <div className="system-note"><span aria-hidden="true">🔒</span> Você salvou o arquivo em <code>{conversa.fonte}</code>. O agente lê <code>raw/</code>, nunca escreve.</div>
    {conversa.passo === "fonte" && <div className="actions-row"><button className="approve-button" disabled={ocupado} onClick={acoes.aoLer}>Ingerir</button></div>}
    {conversa.passo !== "fonte" && <Mensagem autor={agente} agente>
      <Leituras itens={conversa.atividade.filter(a => a.papel === "leitor")} />
      {conversa.passo === "leitura" && <EstadoDaFase conversa={conversa} ocupado={ocupado} aoCancelar={acoes.aoCancelar} aoLerDeNovo={acoes.aoLer} />}
      {conversa.relatorio && <>
        <p>Li a fonte inteira. Estes são os pontos principais, cada um com o trecho que o sustenta. {naParada ? "Desmarque o que não deve entrar na wiki:" : ""}</p>
        {conversa.avisos.map(aviso => <div className="review-warning inline" role="note" key={aviso}>{aviso}</div>)}
        <div className="card">
          <div className="card-head"><strong>Takeaways</strong><span>{takeaways.filter(Boolean).length} de {takeaways.length} selecionados</span></div>
          {conversa.relatorio.takeaways.map((takeaway, i) => <label className={`takeaway ${takeaways[i] ? "" : "off"}`} key={i}>
            <input type="checkbox" checked={takeaways[i] ?? true} disabled={!naParada} onChange={() => acoes.alternarTakeaway(i)} />
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
                  <input type="checkbox" checked={paginas[i] ?? true} disabled={!naParada || fixa} onChange={() => acoes.alternarPagina(i)} />
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
          <textarea value={comentario} onChange={evento => acoes.mudarComentario(evento.target.value)} maxLength={4000} placeholder="Responda ao agente: enfatize, corte ou corrija um takeaway…" aria-label="Comentário para o escritor" />
          <div className="actions-row"><button className="approve-button" disabled={ocupado || !takeaways.some(Boolean)} onClick={acoes.aoSeguir}>Pode seguir</button></div>
        </div>}
      </>}
    </Mensagem>}
    {conversa.escolha && conversa.relatorio && <Mensagem autor="Você">
      <p>{textoDeSeguir(conversa.relatorio.takeaways.map((_, i) => conversa.escolha!.takeaways.includes(i)), conversa.relatorio.paginas.map((_, i) => conversa.escolha!.paginas.includes(i)))}</p>
      {conversa.escolha.comentario && <p className="comment">{conversa.escolha.comentario}</p>}
    </Mensagem>}
    {["escrita", "fechamento", "revisao"].includes(conversa.passo) && <Mensagem autor={agente} agente>
      <Escritas conversa={conversa} />
      {conversa.passo === "escrita" && <EstadoDaFase conversa={conversa} ocupado={ocupado} aoCancelar={acoes.aoCancelar} />}
      {conversa.passo === "fechamento" && <div className="now"><span className="pulse" /> Rodando <code>anvilore fechar</code>…</div>}
      {conversa.fechamento && <Fechamento conversa={conversa} />}
    </Mensagem>}
  </>;
}

export function PainelDaIngestao({ conversa }: { conversa: Conversa | null }) {
  const passos = passosDoPainel(conversa ?? undefined);
  const rodando = conversa?.situacao === "rodando";
  const ehAjuste = conversa?.tipo === "ajuste";
  return <aside className="ingest-panel" aria-label="Progresso da ingestão">
    <h2>{ehAjuste ? "Ajuste" : "Ingestão"}</h2>
    <ol className="steps">
      {passos.map(passo => <li key={passo.rotulo} className={passo.estado}>
        <span className="step-mark" aria-hidden="true">{passo.estado === "feito" ? "✓" : passo.estado === "parou" ? "!" : ""}</span>
        <span><strong>{passo.rotulo}</strong><small>{passo.dica}</small></span>
        <span className="sr-only">{passo.estado}</span>
      </li>)}
    </ol>
    {rodando && conversa?.agora && <div className="now panel-now"><span className="pulse" /> {conversa.agora}</div>}
    {conversa && <>
      <h2>{ehAjuste ? "Página" : "Fonte"}</h2>
      <code className="source-path">{conversa.fonte}</code>
      <dl className="facts"><dt>Tamanho</dt><dd>{tamanhoLegivel(conversa.bytes)}</dd>{conversa.rota && <><dt>Janela</dt><dd>{conversa.rota === "grande" ? "grande (custa mais)" : "padrão"}</dd></>}</dl>
    </>}
    <h2>Garantias</h2>
    <ul className="guarantees">
      <li><code>raw/</code> bloqueado pelo hook: o agente não grava lá.</li>
      {ehAjuste && <li>Escrita restrita: o agente só pode editar esta página.</li>}
      <li>Toda página nasce rascunho, com <code>generated</code>.</li>
      <li>Só você grava <code>verified</code>, na tela de Revisão.</li>
    </ul>
  </aside>;
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
  const ehAjuste = conversa.tipo === "ajuste";
  if (conversa.situacao === "rodando") return <div className="now"><span className="pulse" /> {conversa.agora ?? "Trabalhando…"}<button className="link-button" disabled={ocupado} onClick={aoCancelar}>{ehAjuste ? "Cancelar ajuste" : "Cancelar ingestão"}</button></div>;
  if (conversa.situacao === "cancelada") return <div className="system-note">{ehAjuste ? "Ajuste cancelado." : "Ingestão cancelada."} {conversa.passo === "escrita" ? "O que já foi escrito ficou na wiki como rascunho." : "Nada foi escrito."} {lerDeNovo}</div>;
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
