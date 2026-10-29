import React, { useCallback, useEffect, useState } from "react";
import type { ItemDaBiblioteca, ResumoDaBiblioteca, StatusDaPagina } from "../../src/lib/ui-biblioteca";
import { api } from "./api";

type PropriedadesPainel = {
  resumo: ResumoDaBiblioteca | null;
  carregando: boolean;
  erro: string;
  filtroTexto: string;
  aoMudarFiltroTexto: (valor: string) => void;
  tipoSelecionado: string;
  aoSelecionarTipo: (tipo: string) => void;
  statusSelecionado: "todos" | "rascunho" | "aprovada";
  aoSelecionarStatus: (status: "todos" | "rascunho" | "aprovada") => void;
  areaSelecionada: string;
  aoSelecionarArea: (area: string) => void;
  tagSelecionada: string;
  aoSelecionarTag: (tag: string) => void;
};

export function formatarData(dataIso: string): string {
  if (!dataIso) return "—";
  try {
    const d = new Date(dataIso);
    if (Number.isNaN(d.valueOf())) return dataIso;
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(d);
  } catch {
    return dataIso;
  }
}

export function iconeDoTipo(tipo: string) {
  if (tipo === "conceito" || tipo === "concept") {
    return <svg className="i-sm" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.6L10.4 6L6 10.4L1.6 6Z" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>;
  }
  if (tipo === "nota" || tipo === "note") {
    return <svg className="i-sm" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>;
  }
  return <svg className="i-sm" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>;
}

export async function lerBibliotecaDaApi(
  cliente: typeof api = api,
): Promise<{ valor: ResumoDaBiblioteca | null; erro?: string }> {
  try {
    const valor = await cliente<ResumoDaBiblioteca>("/api/biblioteca");
    return { valor };
  } catch (erro) {
    return { valor: null, erro: erro instanceof Error ? erro.message : "Não foi possível carregar a biblioteca." };
  }
}

export function PainelDaBiblioteca({
  resumo,
  carregando,
  erro,
  filtroTexto,
  aoMudarFiltroTexto,
  tipoSelecionado,
  aoSelecionarTipo,
  statusSelecionado,
  aoSelecionarStatus,
  areaSelecionada,
  aoSelecionarArea,
  tagSelecionada,
  aoSelecionarTag,
}: PropriedadesPainel) {
  const paginasFiltradas = !resumo
    ? []
    : resumo.paginas.filter((item) => {
        if (tipoSelecionado !== "todos" && item.tipo !== tipoSelecionado) return false;
        if (statusSelecionado !== "todos" && item.status !== statusSelecionado) return false;
        if (areaSelecionada !== "todas" && item.area !== areaSelecionada) return false;
        if (tagSelecionada !== "todas" && !item.tags.includes(tagSelecionada)) return false;
        if (filtroTexto.trim()) {
          const termo = filtroTexto.toLowerCase().trim();
          const bateTitulo = item.titulo.toLowerCase().includes(termo);
          const bateSlug = item.slug.toLowerCase().includes(termo);
          const bateTag = item.tags.some((t) => t.toLowerCase().includes(termo));
          if (!bateTitulo && !bateSlug && !bateTag) return false;
        }
        return true;
      });

  // Agrupamento por status: Rascunhos primeiro, depois Aprovadas
  const rascunhos = paginasFiltradas.filter((p) => p.status === "rascunho");
  const aprovadas = paginasFiltradas.filter((p) => p.status === "aprovada");
  const erros = paginasFiltradas.filter((p) => p.status === "erro");
  const grupos: { chave: string; rotulo: string; status: StatusDaPagina; itens: ItemDaBiblioteca[]; dica: string }[] = [];

  if (rascunhos.length > 0) {
    grupos.push({
      chave: "rascunhos",
      rotulo: "Rascunhos",
      status: "rascunho",
      itens: rascunhos,
      dica: "Aguardando aprovação humana",
    });
  }
  if (aprovadas.length > 0) {
    grupos.push({
      chave: "aprovadas",
      rotulo: "Aprovadas",
      status: "aprovada",
      itens: aprovadas,
      dica: "Validadas e vigentes na wiki",
    });
  }
  if (erros.length > 0) {
    grupos.push({
      chave: "erros",
      rotulo: "Com problema",
      status: "erro",
      itens: erros,
      dica: "Frontmatter inválido ou erro de validação",
    });
  }

  return (
    <main className="main lib-main" aria-label="Biblioteca">
      <header className="lib-header">
        <h1 className="lib-title">Biblioteca</h1>
        <div role="tablist" aria-label="Tipo de página" className="lib-tabs">
          {(resumo?.tipos ?? [{ tipo: "todos", rotulo: "Todas", contagem: 0 }]).map((t) => (
            <button
              key={t.tipo}
              type="button"
              role="tab"
              aria-selected={tipoSelecionado === t.tipo}
              className={`lib-tab ${tipoSelecionado === t.tipo ? "active" : ""}`}
              onClick={() => aoSelecionarTipo(t.tipo)}
            >
              {t.rotulo}
              <span className="mono lib-tab-count">{t.contagem}</span>
            </button>
          ))}
        </div>
        <span className="spacer" />
        <a href="#/chat" className="approve-button lib-new-btn">
          <svg className="i-sm" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 2.5V9.5M5 6.5L8 9.5L11 6.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <path d="M2.5 10.5V13.5H13.5V10.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
          Nova ingestão
        </a>
      </header>

      <div className="lib-filterbar">
        <div className="lib-search">
          <label htmlFor="lib-filter" className="sr">Filtrar páginas</label>
          <svg className="i-sm lib-search-icon" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M10.5 10.5L13.5 13.5" stroke="currentColor" strokeWidth="1.3" />
          </svg>
          <input
            id="lib-filter"
            type="text"
            placeholder="Filtrar por título, slug ou tag"
            value={filtroTexto}
            onChange={(e) => aoMudarFiltroTexto(e.target.value)}
          />
        </div>

        <label className="lib-select-label">
          Status:
          <select
            value={statusSelecionado}
            onChange={(e) => aoSelecionarStatus(e.target.value as "todos" | "rascunho" | "aprovada")}
          >
            <option value="todos">todos</option>
            <option value="rascunho">rascunho</option>
            <option value="aprovada">aprovada</option>
          </select>
        </label>

        {resumo && resumo.areas.length > 0 && (
          <label className="lib-select-label">
            Área:
            <select value={areaSelecionada} onChange={(e) => aoSelecionarArea(e.target.value)}>
              <option value="todas">todas</option>
              {resumo.areas.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </label>
        )}

        {resumo && resumo.tags.length > 0 && (
          <label className="lib-select-label">
            Tag:
            <select value={tagSelecionada} onChange={(e) => aoSelecionarTag(e.target.value)}>
              <option value="todas">todas</option>
              {resumo.tags.map((tg) => (
                <option key={tg} value={tg}>{tg}</option>
              ))}
            </select>
          </label>
        )}

        <span className="spacer" />
        <span className="lib-order-hint">Agrupado por status · ordenado por atualização</span>
      </div>

      <div className="lib-body">
        {carregando && <div className="loading">Lendo a biblioteca…</div>}
        {erro && <div className="alert inline" role="alert">{erro}</div>}
        {!carregando && !erro && paginasFiltradas.length === 0 && (
          <div className="lib-empty">Nenhuma página encontrada.</div>
        )}

        {!carregando && !erro && grupos.map((grupo) => (
          <section key={grupo.chave} className="lib-group" aria-label={grupo.rotulo}>
            <header className="lib-group-header">
              {grupo.status === "rascunho" ? (
                <svg className="i-sm status-icon draft" viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.4 2.2" />
                </svg>
              ) : (
                <svg className="i-sm status-icon ok" viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="8" cy="8" r="6" fill="currentColor" />
                  <path d="M5.5 8.2L7.3 10L10.6 6.3" stroke="var(--panel)" strokeWidth="1.6" fill="none" />
                </svg>
              )}
              <h2 className="lib-group-title">{grupo.rotulo}</h2>
              <span className="mono lib-group-count">{grupo.itens.length}</span>
              <span className="lib-group-hint">{grupo.dica}</span>
            </header>

            <div className="lib-rows">
              {grupo.itens.map((r) => (
                <a key={r.caminho} className="lib-row" href={`#/nota/${r.caminho}`}>
                  <span className="lib-row-glyph" title={r.tipo || "página"}>
                    {iconeDoTipo(r.tipo)}
                  </span>
                  <span className="sr">{r.tipo || "página"}</span>
                  <strong className="lib-row-title">{r.titulo}</strong>
                  <span className="mono lib-row-slug">{r.slug}</span>
                  <span className="lib-row-tags">
                    {r.tags.map((tg) => (
                      <span key={tg} className="tag">{tg}</span>
                    ))}
                  </span>
                  <span className="lib-row-area">{r.area}</span>
                  <span className="lib-row-links" title={`${r.links} ligações`}>
                    <svg className="i-xs" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M6.5 9.5L9.5 6.5M7 4.5L8.5 3A2.5 2.5 0 0 1 13 6.5L11.5 8M9 11.5L7.5 13A2.5 2.5 0 0 1 3 9.5L4.5 8" fill="none" stroke="currentColor" strokeWidth="1.4" />
                    </svg>
                    {r.links}
                  </span>
                  <span className="mono lib-row-date">{formatarData(r.data)}</span>
                </a>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

export async function carregarBiblioteca(
  setResumo: (r: ResumoDaBiblioteca | null) => void,
  setCarregando: (c: boolean) => void,
  setErro: (e: string) => void,
  leitor: typeof lerBibliotecaDaApi = lerBibliotecaDaApi,
) {
  setCarregando(true);
  const leitura = await leitor();
  if (leitura.erro !== undefined) setErro(leitura.erro);
  else setResumo(leitura.valor);
  setCarregando(false);
}

export function Biblioteca({ tema, alternarTema }: { tema: "claro" | "escuro"; alternarTema: () => void }) {
  const [resumo, setResumo] = useState<ResumoDaBiblioteca | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [filtroTexto, setFiltroTexto] = useState("");
  const [tipoSelecionado, setTipoSelecionado] = useState("todos");
  const [statusSelecionado, setStatusSelecionado] = useState<"todos" | "rascunho" | "aprovada">("todos");
  const [areaSelecionada, setAreaSelecionada] = useState("todas");
  const [tagSelecionada, setTagSelecionada] = useState("todas");

  const recarregar = useCallback(() => {
    void carregarBiblioteca(setResumo, setCarregando, setErro);
  }, []);

  useEffect(() => {
    recarregar();
  }, [recarregar]);

  return (
    <PainelDaBiblioteca
      resumo={resumo}
      carregando={carregando}
      erro={erro}
      filtroTexto={filtroTexto}
      aoMudarFiltroTexto={setFiltroTexto}
      tipoSelecionado={tipoSelecionado}
      aoSelecionarTipo={setTipoSelecionado}
      statusSelecionado={statusSelecionado}
      aoSelecionarStatus={setStatusSelecionado}
      areaSelecionada={areaSelecionada}
      aoSelecionarArea={setAreaSelecionada}
      tagSelecionada={tagSelecionada}
      aoSelecionarTag={setTagSelecionada}
    />
  );
}
