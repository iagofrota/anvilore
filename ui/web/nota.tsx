import React, { useCallback, useEffect, useState } from "react";
import type { DetalhesDaNota, GrafoLocal } from "../../src/lib/ui-nota";
import { api } from "./api";

type PropriedadesPainel = {
  nota: DetalhesDaNota | null;
  carregando: boolean;
  erro: string;
  aoAprovar?: () => Promise<void>;
  aprovando?: boolean;
  tema?: "claro" | "escuro";
  alternarTema?: () => void;
};

export function formatarData(dataIso?: string): string {
  if (!dataIso) return "—";
  try {
    const d = new Date(dataIso);
    if (Number.isNaN(d.valueOf())) return dataIso;
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(d);
  } catch {
    return dataIso;
  }
}

export function renderizarTextoComWikilinks(texto: string): React.ReactNode {
  const partes: React.ReactNode[] = [];
  const regex = /(\[\[[^\]\n|]+(?:\|[^\]\n]+)?\]\]|\*\*[^*]+\*\*|`[^`]+`)/g;
  let ultimoIndice = 0;
  let match;

  while ((match = regex.exec(texto)) !== null) {
    if (match.index > ultimoIndice) {
      partes.push(texto.slice(ultimoIndice, match.index));
    }
    const token = match[0];
    if (token.startsWith("[[")) {
      const semColchetes = token.slice(2, -2);
      const pipe = semColchetes.indexOf("|");
      const alvo = (pipe >= 0 ? semColchetes.slice(0, pipe) : semColchetes).trim();
      const rotulo = (pipe >= 0 ? semColchetes.slice(pipe + 1) : alvo).trim();
      const destino = alvo.endsWith(".md") ? alvo : `${alvo}.md`;
      partes.push(
        <a key={`${match.index}-${alvo}`} className="wl" href={`#/nota/${destino}`}>
          {rotulo}
        </a>,
      );
    } else if (token.startsWith("**")) {
      partes.push(<strong key={`strong-${match.index}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      partes.push(<code key={`code-${match.index}`}>{token.slice(1, -1)}</code>);
    }
    ultimoIndice = match.index + match[0].length;
  }
  if (ultimoIndice < texto.length) {
    partes.push(texto.slice(ultimoIndice));
  }
  return partes.length > 0 ? partes : texto;
}

export function renderizarCorpoMarkdown(corpo: string): React.ReactNode[] {
  const linhas = corpo.split(/\r?\n/);
  const elementos: React.ReactNode[] = [];
  let i = 0;

  while (i < linhas.length) {
    const linha = linhas[i]!;

    // Callout (> [!gap] ou > [!contradiction])
    const calloutMatch = /^>\s*\[!(gap|contradiction)\]\s?(.*)$/i.exec(linha);
    if (calloutMatch) {
      const tipo = calloutMatch[1]!.toLowerCase() as "gap" | "contradiction";
      const textoInicial = calloutMatch[2]?.trim() ?? "";
      const partes: string[] = textoInicial ? [textoInicial] : [];
      i++;
      while (i < linhas.length && /^>\s?(.*)$/.test(linhas[i]!) && !/^>\s*\[!/i.test(linhas[i]!)) {
        const continuacao = /^>\s?(.*)$/.exec(linhas[i]!);
        if (continuacao && continuacao[1]?.trim()) {
          partes.push(continuacao[1].trim());
        }
        i++;
      }
      elementos.push(
        <aside key={`callout-${i}`} aria-label={tipo === "gap" ? "Lacuna" : "Contradição"} className={`note-callout ${tipo} callout-${tipo}`}>
          <svg className="i-sm" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M8 5.5V8.5M8 10.6V10.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <div className="note-callout-body">
            <span className="mono note-callout-type">{tipo === "gap" ? "LACUNA" : "CONTRADIÇÃO"}</span>
            <p>{renderizarTextoComWikilinks(partes.join(" "))}</p>
            <a href={`#/chat?lacuna=${encodeURIComponent(partes.join(" "))}`} className="note-gap-link callout-chat-btn callout-botao-chat">Buscar fonte no Chat</a>
          </div>
        </aside>,
      );
      continue;
    }

    // Citação simples
    if (/^>\s?(.*)$/.test(linha)) {
      const citacoes: string[] = [];
      while (i < linhas.length && /^>\s?(.*)$/.test(linhas[i]!)) {
        const c = /^>\s?(.*)$/.exec(linhas[i]!);
        if (c) citacoes.push(c[1] ?? "");
        i++;
      }
      elementos.push(
        <blockquote key={`quote-${i}`}>
          {renderizarTextoComWikilinks(citacoes.join(" "))}
        </blockquote>,
      );
      continue;
    }

    // Títulos
    if (linha.startsWith("# ")) {
      elementos.push(<h1 key={`h1-${i}`}>{renderizarTextoComWikilinks(linha.slice(2))}</h1>);
      i++;
      continue;
    }
    if (linha.startsWith("## ")) {
      elementos.push(<h2 key={`h2-${i}`}>{renderizarTextoComWikilinks(linha.slice(3))}</h2>);
      i++;
      continue;
    }
    if (linha.startsWith("### ")) {
      elementos.push(<h3 key={`h3-${i}`}>{renderizarTextoComWikilinks(linha.slice(4))}</h3>);
      i++;
      continue;
    }

    // Lista não-ordenada
    if (/^[-*]\s+(.*)$/.test(linha)) {
      const itens: React.ReactNode[] = [];
      while (i < linhas.length && /^[-*]\s+(.*)$/.test(linhas[i]!)) {
        const m = /^[-*]\s+(.*)$/.exec(linhas[i]!);
        if (m) itens.push(<li key={`li-${i}`}>{renderizarTextoComWikilinks(m[1]!)}</li>);
        i++;
      }
      elementos.push(<ul key={`ul-${i}`}>{itens}</ul>);
      continue;
    }

    // Linha vazia
    if (!linha.trim()) {
      i++;
      continue;
    }

    // Parágrafo comum
    elementos.push(<p key={`p-${i}`}>{renderizarTextoComWikilinks(linha)}</p>);
    i++;
  }

  return elementos;
}

export function GrafoLocalVisual({ grafo }: { grafo: GrafoLocal }) {
  const largura = 264;
  const altura = 176;
  const centroX = 132;
  const centroY = 88;

  const noAtual = grafo.nos.find((n) => n.atual) ?? grafo.nos[0];
  const outrosNos = grafo.nos.filter((n) => n !== noAtual);

  const posicoes = new Map<string, { x: number; y: number; r: number }>();
  if (noAtual) {
    posicoes.set(noAtual.id, { x: centroX, y: centroY, r: 8 });
  }

  const raioCirculo = 65;
  outrosNos.forEach((no, idx) => {
    const angulo = (idx / Math.max(outrosNos.length, 1)) * 2 * Math.PI - Math.PI / 2;
    const x = Math.round(centroX + raioCirculo * Math.cos(angulo));
    const y = Math.round(centroY + (raioCirculo * 0.75) * Math.sin(angulo));
    posicoes.set(no.id, { x, y, r: 6 });
  });

  return (
    <svg
      role="img"
      aria-label={`Grafo local: ${grafo.nos.map((n) => n.rotulo).join(", ")}`}
      viewBox={`0 0 ${largura} ${altura}`}
      className="note-graph-svg local-graph-svg"
    >
      <g className="graph-edges">
        {grafo.arestas.map((a, idx) => {
          const de = posicoes.get(a.de);
          const para = posicoes.get(a.para);
          if (!de || !para) return null;
          return (
            <line
              key={`edge-${idx}`}
              x1={de.x}
              y1={de.y}
              x2={para.x}
              y2={para.y}
              stroke="var(--line-2)"
              strokeWidth="1.2"
            />
          );
        })}
      </g>
      <g className="graph-nodes">
        {grafo.nos.map((no) => {
          const pos = posicoes.get(no.id);
          if (!pos) return null;
          return (
            <g key={`node-${no.id}`}>
              <circle
                cx={pos.x}
                cy={pos.y}
                r={pos.r}
                fill={no.atual ? "var(--accent)" : "var(--panel)"}
                stroke={no.atual ? "var(--accent)" : "var(--line-2)"}
                strokeWidth={no.atual ? "2" : "1.5"}
              />
              <text
                x={pos.x}
                y={pos.y + pos.r + 11}
                textAnchor="middle"
                className="graph-node-label"
                fill="var(--fg-2)"
                fontSize="10"
              >
                {no.rotulo.length > 14 ? `${no.rotulo.slice(0, 12)}…` : no.rotulo}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

export async function lerNotaDaApi(
  caminho: string,
  cliente: typeof api = api,
): Promise<{ valor: DetalhesDaNota | null; erro?: string }> {
  try {
    const valor = await cliente<DetalhesDaNota>(`/api/nota?caminho=${encodeURIComponent(caminho)}`);
    return { valor };
  } catch (erro) {
    return { valor: null, erro: erro instanceof Error ? erro.message : "Não foi possível carregar a nota." };
  }
}

export function PainelDaNota({
  nota,
  carregando,
  erro,
  aoAprovar,
  aprovando,
  tema,
  alternarTema,
}: PropriedadesPainel) {
  if (carregando) {
    return (
      <main className="main note-main" aria-label="Nota">
        <div className="loading">Lendo a nota…</div>
      </main>
    );
  }

  if (erro || !nota) {
    return (
      <main className="main note-main" aria-label="Nota">
        <div className="alert inline" role="alert">{erro || "Nota não encontrada."}</div>
      </main>
    );
  }

  return (
    <main className="main note-main" aria-label="Nota">
      <header className="note-header">
        <nav aria-label="Caminho" className="note-breadcrumbs">
          <a href="#/biblioteca">{nota.area}</a>
          <svg className="i-xs" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 3.5L10.5 8L6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span aria-current="page">{nota.titulo}</span>
        </nav>
        <span className="spacer" />
        <a href="#/chat" className="secondary-button note-ask-btn">
          <svg className="i-sm" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2.5 3.5H13.5V11H6.5L3.5 13.5V11H2.5Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
          </svg>
          Perguntar sobre esta página
        </a>
        {alternarTema && (
          <button className="icon-button" title="Alternar tema" aria-label="Alternar tema claro ou escuro" onClick={alternarTema}>
            {tema === "claro" ? "◐" : "☼"}
          </button>
        )}
      </header>

      {nota.status === "rascunho" && (
        <div className="note-status-banner draft" role="status">
          <svg className="i-sm" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.4 2.2" />
          </svg>
          <span className="note-banner-copy">
            <strong>Rascunho.</strong> {nota.statusMeta}
          </span>
          <a href="#/revisao" className="note-banner-link">Ver na revisão</a>
          {aoAprovar && (
            <button type="button" className="approve-button" onClick={() => void aoAprovar()} disabled={aprovando}>
              Aprovar
            </button>
          )}
        </div>
      )}

      {nota.status === "aprovada" && (
        <div className="note-status-banner approved" role="status">
          <svg className="i-sm" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6" fill="currentColor" />
            <path d="M5.5 8.2L7.3 10L10.6 6.3" stroke="var(--panel)" strokeWidth="1.6" fill="none" />
          </svg>
          <span className="note-banner-copy">
            <strong>Aprovada.</strong> {nota.statusMeta}
          </span>
        </div>
      )}

      {nota.status === "erro" && (
        <div className="note-status-banner error" role="alert">
          <span className="note-banner-copy">
            <strong>Problema.</strong> {nota.statusMeta}
          </span>
        </div>
      )}

      <div className="note-layout">
        <div className="note-content-column">
          <article className="note-article">
            <header className="note-article-header">
              {nota.tipo && <span className="tag note-type-badge">{nota.tipo}</span>}
              <h1 className="note-article-title">{nota.titulo}</h1>
            </header>

            <div className="note-props">
              <span className="note-prop-label">Área</span>
              <span className="note-prop-val">{nota.area}</span>

              {nota.tags.length > 0 && (
                <>
                  <span className="note-prop-label">Tags</span>
                  <span className="note-prop-val note-tags-list">
                    {nota.tags.map((tg) => (
                      <span key={tg} className="tag">{tg}</span>
                    ))}
                  </span>
                </>
              )}

              {nota.fontes.length > 0 && (
                <>
                  <span className="note-prop-label">Fontes</span>
                  <span className="note-prop-val">
                    {nota.fontes.map((f, idx) => (
                      <span key={idx} className="note-source-item">{f.titulo || f.recurso}</span>
                    ))}
                  </span>
                </>
              )}

              {nota.relacionados.length > 0 && (
                <>
                  <span className="note-prop-label">Relacionados</span>
                  <span className="note-prop-val note-related-list">
                    {nota.relacionados.map((rel) => (
                      <a key={rel} className="wl" href={`#/nota/${rel.endsWith(".md") ? rel : `${rel}.md`}`}>
                        {rel}
                      </a>
                    ))}
                  </span>
                </>
              )}

              <span className="note-prop-label">Status</span>
              <span className="note-prop-val">
                <span className={`status-pill ${nota.status}`}>{nota.status}</span>
              </span>
            </div>

            <div className="note-body">
              {renderizarCorpoMarkdown(nota.corpo)}
            </div>
          </article>
        </div>

        <aside className="note-rail" aria-label="Ligações da página">
          {nota.grafoLocal.nos.length > 1 && (
            <section className="note-rail-card" aria-label="Grafo local">
              <h2>Grafo local</h2>
              <GrafoLocalVisual grafo={nota.grafoLocal} />
            </section>
          )}

          <section className="note-rail-card" aria-label="Backlinks">
            <h2>
              Backlinks <span className="mono count">{nota.backlinks.length}</span>
            </h2>
            {nota.backlinks.length === 0 ? (
              <p className="note-empty-hint">Nenhuma outra página cita esta ainda.</p>
            ) : (
              <div className="note-backlinks-list">
                {nota.backlinks.map((b) => (
                  <a key={b.caminho} href={`#/nota/${b.caminho}`} className="note-backlink-item">
                    <div className="note-backlink-head">
                      <strong>{b.titulo}</strong>
                      {b.tipo && <span className="tag">{b.tipo}</span>}
                    </div>
                    {b.contexto && <p className="note-backlink-snippet">{b.contexto}</p>}
                  </a>
                ))}
              </div>
            )}
          </section>

          <section className="note-rail-card" aria-label="Proveniência">
            <h2>Proveniência</h2>
            <dl className="note-provenance-dl">
              <dt>Fonte</dt>
              <dd className="mono">{nota.proveniencia.fontePrincipal || "—"}</dd>

              <dt>Gerada</dt>
              <dd className="mono">
                {nota.proveniencia.geradoPor || "—"} {formatarData(nota.proveniencia.geradoEm)}
              </dd>

              <dt>Verificada</dt>
              <dd className="mono">
                {nota.proveniencia.verificadoPor
                  ? `${nota.proveniencia.verificadoPor} ${formatarData(nota.proveniencia.verificadoEm)}`
                  : "pendente"}
              </dd>
            </dl>
          </section>
        </aside>
      </div>
    </main>
  );
}

export async function carregarNota(
  caminho: string | undefined,
  setNota: (n: DetalhesDaNota | null) => void,
  setCarregando: (c: boolean) => void,
  setErro: (e: string) => void,
  leitor: typeof lerNotaDaApi = lerNotaDaApi,
) {
  if (!caminho) {
    setCarregando(false);
    setErro("Caminho da nota não informado.");
    return;
  }
  setCarregando(true);
  const leitura = await leitor(caminho);
  if (leitura.erro !== undefined) setErro(leitura.erro);
  else setNota(leitura.valor);
  setCarregando(false);
}

export function Nota({
  caminho,
  tema,
  alternarTema,
}: {
  caminho?: string;
  tema: "claro" | "escuro";
  alternarTema: () => void;
}) {
  const [nota, setNota] = useState<DetalhesDaNota | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [aprovando, setAprovando] = useState(false);

  const carregar = useCallback((caminhoAlvo: string | undefined) => {
    void carregarNota(caminhoAlvo, setNota, setCarregando, setErro);
  }, []);

  useEffect(() => {
    carregar(caminho);
  }, [caminho, carregar]);

  const aoAprovar = async () => {
    if (!nota) return;
    setAprovando(true);
    try {
      await api<{ codigo: number }>("/api/aprovar", "POST", {
        caminho: nota.caminho,
        versao: nota.versao,
      });
      carregar(nota.caminho);
    } catch (motivo) {
      setErro(motivo instanceof Error ? motivo.message : "Não foi possível aprovar a página.");
    } finally {
      setAprovando(false);
    }
  };

  return (
    <PainelDaNota
      nota={nota}
      carregando={carregando}
      erro={erro}
      aoAprovar={nota?.aprovavel ? aoAprovar : undefined}
      aprovando={aprovando}
      tema={tema}
      alternarTema={alternarTema}
    />
  );
}
