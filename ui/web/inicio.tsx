import React, { useCallback, useEffect, useState } from "react";
import type { ResumoDeConversa } from "../../src/lib/ui-ingestao";
import type { ResumoDoInicio, SaudeDaWiki } from "../../src/lib/ui-inicio";
import { api } from "./api";
import { tamanhoLegivel } from "./ingestao";

export type DadosDoInicio = ResumoDoInicio & { agente: string; areas: string[]; conversas: ResumoDeConversa[] };
export type SituacaoDaSaude = "ok" | "portao" | "atencao" | "problema";

export function saudacao(hora: number): string {
  return hora >= 5 && hora < 12 ? "Bom dia" : hora >= 12 && hora < 18 ? "Boa tarde" : "Boa noite";
}

// "portao": só falta aprovar páginas geradas, que é o validador funcionando como deve.
export function situacaoDaSaude(saude: SaudeDaWiki): SituacaoDaSaude {
  if (saude.auditoria.erro !== undefined || saude.validar.outrosErros.length > 0) return "problema";
  if (!saude.validar.ok) return "portao";
  return saude.auditoria.total > 0 ? "atencao" : "ok";
}

const plural = (n: number, singular: string, mais: string) => `${n} ${n === 1 ? singular : mais}`;

type Propriedades = {
  dados: DadosDoInicio | null;
  saude: SaudeDaWiki | null;
  saudeCarregando: boolean;
  erro: string;
  aoValidar: () => void;
  hora?: number;
};

// A tela, sem estado nem rede: quem busca os dados é `Inicio`. Assim ela se prova só com os dados.
export function PainelDoInicio({ dados, saude, saudeCarregando, erro, aoValidar, hora = new Date().getHours() }: Propriedades) {
  const rascunhos = dados?.rascunhos;
  const subtitulo = !rascunhos ? "Lendo a wiki…"
    : rascunhos.total === 0 ? "Nada esperando a sua aprovação."
      : `${rascunhos.total === 1 ? "1 página espera" : `${rascunhos.total} páginas esperam`} a sua aprovação.`;
  return <div className="home-scroll">
    <div className="home-content">
      <div className="home-greeting"><h2>{saudacao(hora)}</h2><p>{subtitulo}</p></div>
      {erro && <div className="alert inline" role="alert">{erro}</div>}
      {!dados ? <div className="loading">Lendo a wiki…</div> : <>
        <section className="composer" aria-label="O que fazer agora">
          <h3>O que você quer fazer?</h3>
          <div className="composer-actions">
            <a className="approve-button" href="#/chat">Ingerir uma fonte</a>
            <a className="secondary-button" href="#/revisao">Revisar rascunhos</a>
          </div>
          {dados.conversas.length > 0 && <ul className="plain-list" aria-label="Ingestões em andamento">
            {dados.conversas.map(c => <li key={c.id}><span className={`conversation-dot ${c.situacao}`} aria-hidden="true" /><span>Ingerir: {c.nome}</span><a href={`#/chat/${c.id}`}>Continuar</a></li>)}
          </ul>}
        </section>
        <div className="home-grid">
          <div className="home-col">
            <CartaoParaRevisar rascunhos={dados.rascunhos} />
            <CartaoDeAtividade atividade={dados.atividade} />
          </div>
          <div className="home-col">
            <CartaoDeSaude saude={saude} carregando={saudeCarregando} aoValidar={aoValidar} />
            <CartaoDeFontes fontes={dados.fontes} />
          </div>
        </div>
      </>}
    </div>
  </div>;
}

function CartaoParaRevisar({ rascunhos }: { rascunhos: ResumoDoInicio["rascunhos"] }) {
  const restantes = rascunhos.total - rascunhos.itens.length;
  return <section className="home-card" aria-label="Para revisar">
    <header className="home-card-head"><h3>Para revisar</h3><span className="count">{rascunhos.total}</span></header>
    {rascunhos.total === 0 ? <p className="home-card-empty">Nenhuma página espera aprovação.</p> : <>
      <ul className="plain-list">
        {rascunhos.itens.map(item => <li key={item.caminho}>
          <a href="#/revisao"><strong>{item.titulo}</strong></a>
          <span className="item-meta">{item.tipo || "página"} · {item.status === "nova" ? "nova" : item.status === "atualizada" ? "atualizada" : "com erro"}</span>
        </li>)}
      </ul>
      {restantes > 0 && <p className="home-card-note">e mais {restantes} na Revisão</p>}
      <a className="home-card-link" href="#/revisao">Abrir revisão</a>
    </>}
  </section>;
}

function CartaoDeAtividade({ atividade }: { atividade: ResumoDoInicio["atividade"] }) {
  return <section className="home-card" aria-label="Atividade recente">
    <header className="home-card-head"><h3>Atividade recente</h3><code>wiki/log/</code></header>
    {atividade.length === 0 ? <p className="home-card-empty">Nada registrado ainda.</p> : <ul className="plain-list">
      {atividade.map((entrada, n) => <li key={`${entrada.arquivo}-${n}`}>
        <span className="mono item-date">{entrada.data}</span><span className="tag">{entrada.tipo}</span><span className="grow">{entrada.resumo}</span>
      </li>)}
    </ul>}
  </section>;
}

const TITULO_DA_SAUDE: Record<SituacaoDaSaude, string> = { ok: "Tudo certo", portao: "Falta aprovar", atencao: "Pede atenção", problema: "Há problemas" };

function CartaoDeSaude({ saude, carregando, aoValidar }: { saude: SaudeDaWiki | null; carregando: boolean; aoValidar: () => void }) {
  const situacao = saude ? situacaoDaSaude(saude) : undefined;
  return <section className="home-card" aria-label="Saúde da wiki">
    <header className="home-card-head">
      <h3>Saúde da wiki</h3>
      {situacao && <span className={`result-badge ${situacao === "ok" ? "pass" : situacao === "portao" || situacao === "atencao" ? "warn" : "fail"}`}>{TITULO_DA_SAUDE[situacao]}</span>}
    </header>
    {!saude ? <p className="home-card-empty">{carregando ? "Conferindo a wiki…" : "Ainda não conferida."}</p> : <>
      {situacao === "ok" && <p className="home-card-note">A validação passou e a auditoria não achou nada.</p>}
      {saude.validar.semAprovacao > 0 && <p className="home-card-note">Falta aprovar {plural(saude.validar.semAprovacao, "página", "páginas")}. O validador reprova enquanto houver página gerada sem aprovação humana. Isso é o portão funcionando.</p>}
      {saude.validar.outrosErros.length > 0 && <>
        <p className="home-card-note">A validação encontrou problemas:</p>
        <ul className="plain-list problems">{saude.validar.outrosErros.slice(0, 5).map(erro => <li key={erro}>{erro}</li>)}</ul>
        {saude.validar.outrosErros.length > 5 && <p className="home-card-note">e mais {saude.validar.outrosErros.length - 5}</p>}
      </>}
      {saude.auditoria.erro !== undefined && <p className="home-card-note">A auditoria não rodou: {saude.auditoria.erro}</p>}
      {saude.auditoria.total > 0 && <>
        <p className="home-card-note">A auditoria achou {plural(saude.auditoria.total, "ponto", "pontos")} de estrutura:</p>
        <ul className="plain-list problems">{saude.auditoria.resumo.map(linha => <li key={linha}>{linha.replace(/^- /, "")}</li>)}</ul>
      </>}
      <dl className="health-counters">
        <div><dt>Sem aprovação</dt><dd>{saude.validar.semAprovacao}</dd></div>
        <div><dt>Lacunas abertas</dt><dd>{saude.lacunas.total - saude.lacunas.contradicoes}</dd></div>
        <div><dt>Contradições</dt><dd>{saude.lacunas.contradicoes}</dd></div>
        <div><dt>Vencidas</dt><dd>{saude.vencidas}</dd></div>
      </dl>
      {saude.lacunas.abertas.length > 0 && <ul className="plain-list gaps">{saude.lacunas.abertas.map(linha => <li key={linha}><code>{linha}</code></li>)}</ul>}
    </>}
    <button className="secondary-button" onClick={aoValidar} disabled={carregando}>{carregando ? "Conferindo…" : "Validar agora"}</button>
  </section>;
}

function CartaoDeFontes({ fontes }: { fontes: ResumoDoInicio["fontes"] }) {
  return <section className="home-card" aria-label="Em raw/, sem ingestão">
    <header className="home-card-head"><h3>Em raw/, sem ingestão</h3><span className="count">{fontes.length}</span></header>
    {fontes.length === 0 ? <p className="home-card-empty">Tudo em raw/ já foi ingerido.</p> : <ul className="plain-list">
      {fontes.map(fonte => <li key={fonte.caminho}>
        <code className="grow">{fonte.caminho}</code><span className="item-meta">{tamanhoLegivel(fonte.bytes)}</span>
        {fonte.conversa && <a href={`#/chat/${fonte.conversa}`}>Continuar</a>}
      </li>)}
    </ul>}
  </section>;
}

type PropriedadesDaTela = { tema: "claro" | "escuro"; alternarTema: () => void };

export function Inicio({ tema, alternarTema }: PropriedadesDaTela) {
  const [dados, setDados] = useState<DadosDoInicio | null>(null);
  const [saude, setSaude] = useState<SaudeDaWiki | null>(null);
  const [saudeCarregando, setSaudeCarregando] = useState(true);
  const [erro, setErro] = useState("");

  // A saúde é a parte lenta (varre a wiki toda): a tela aparece primeiro e ela chega depois.
  const conferirSaude = useCallback(async () => {
    setSaudeCarregando(true);
    try { setSaude(await api<SaudeDaWiki>("/api/saude")); }
    catch (motivo) { setErro(motivo instanceof Error ? motivo.message : "Não foi possível conferir a saúde da wiki."); }
    finally { setSaudeCarregando(false); }
  }, []);

  useEffect(() => {
    let ativo = true;
    api<DadosDoInicio>("/api/inicio").then(
      resposta => { if (ativo) setDados(resposta); },
      motivo => { if (ativo) setErro(motivo instanceof Error ? motivo.message : "Não foi possível ler a wiki."); },
    );
    void conferirSaude();
    return () => { ativo = false; };
  }, [conferirSaude]);

  return <main className="main">
    <header className="topbar">
      <div><h1>Início</h1></div>
      <div className="top-actions">
        {dados && <span className="pill"><span className="status-dot" /> {dados.agente} · sessão local</span>}
        <button className="icon-button" title="Alternar tema" aria-label="Alternar tema claro ou escuro" onClick={alternarTema}>{tema === "claro" ? "◐" : "☼"}</button>
      </div>
    </header>
    <PainelDoInicio dados={dados} saude={saude} saudeCarregando={saudeCarregando} erro={erro} aoValidar={() => void conferirSaude()} />
  </main>;
}
