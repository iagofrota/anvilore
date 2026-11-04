import React, { useState } from "react";
import type { EstadoOnboarding } from "../../src/lib/ui-onboarding";
import { api } from "./api";

type Tema = "claro" | "escuro";

export type AcoesDoOnboarding = {
  aoMudarPasta: (nova: string) => void;
  aoConfirmarPasta: () => void;
  aoTestarAgente: () => void;
  aoMudarNovaArea: (val: string) => void;
  aoAlternarArea: (area: string) => void;
  aoAdicionarArea: () => void;
  aoAlternarRemoverExemplo: (val: boolean) => void;
  aoCriarAreas: () => void;
  aoConcluir: (destino: string) => void;
  aoIngerirExemplo?: (area?: string) => Promise<void>;
  aoNavegar: (passo: number) => void;
};

export type PropriedadesDoPainel = {
  passo: number;
  dados: EstadoOnboarding;
  pasta: string;
  erroPasta: string | null;
  carregandoPasta: boolean;
  testandoAgente: boolean;
  resultadoTeste: string | null;
  sucessoTeste: boolean | null;
  areasSelecionadas: string[];
  novaArea: string;
  removerExemplo: boolean;
  criandoAreas: boolean;
  erroAreas: string | null;
  concluindo: boolean;
  acoes: AcoesDoOnboarding;
};

export function PainelDoOnboarding({
  passo,
  dados,
  pasta,
  erroPasta,
  carregandoPasta,
  testandoAgente,
  resultadoTeste,
  sucessoTeste,
  areasSelecionadas,
  novaArea,
  removerExemplo,
  criandoAreas,
  erroAreas,
  concluindo,
  acoes,
}: PropriedadesDoPainel) {
  return (
    <div
      style={{
        minHeight: "100vh",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "40px 16px 32px",
        gap: "28px",
        background: "var(--bg)",
        color: "var(--fg)",
        fontSize: "13px",
        lineHeight: "1.5",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "560px",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "16px",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "10px", fontWeight: 600, fontSize: "14px" }}>
          <span
            style={{
              width: "26px",
              height: "26px",
              borderRadius: "7px",
              background: "var(--accent)",
              color: "var(--accent-text)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            a
          </span>
          Anvilore
        </span>
        <ol aria-label="Etapas" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", gap: "6px" }}>
          {[
            { num: 1, rotulo: "Vault" },
            { num: 2, rotulo: "Agente" },
            { num: 3, rotulo: "Áreas" },
            { num: 4, rotulo: "Ingestão" },
          ].map(e => {
            const ativo = passo === e.num;
            const concluidoPasso = passo > e.num;
            return (
              <li
                key={e.num}
                aria-current={ativo ? "step" : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  height: "26px",
                  padding: "0 10px 0 4px",
                  borderRadius: "13px",
                  background: ativo ? "var(--panel)" : "transparent",
                  border: ativo ? "1px solid var(--line)" : "none",
                  fontSize: "12px",
                  fontWeight: ativo ? 500 : 400,
                  color: ativo ? "var(--fg)" : concluidoPasso ? "var(--fg-2)" : "var(--fg-3)",
                }}
              >
                <span
                  style={{
                    width: "18px",
                    height: "18px",
                    borderRadius: "50%",
                    background: ativo ? "var(--accent)" : concluidoPasso ? "var(--ok-soft)" : "transparent",
                    color: ativo ? "var(--accent-text)" : concluidoPasso ? "var(--ok)" : "inherit",
                    border: !ativo && !concluidoPasso ? "1px solid var(--line-strong)" : "none",
                    boxSizing: "border-box",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "11px",
                  }}
                >
                  {concluidoPasso ? "✓" : e.num}
                </span>
                {e.rotulo}
              </li>
            );
          })}
        </ol>
      </div>

      <main
        style={{
          width: "100%",
          maxWidth: "560px",
          boxSizing: "border-box",
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "14px",
          boxShadow: "var(--shadow)",
          padding: "36px 36px 28px",
          display: "flex",
          flexDirection: "column",
          gap: "24px",
        }}
      >
        {passo === 1 && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 600, letterSpacing: "-0.015em" }}>
                Abra a pasta da sua wiki
              </h1>
              <p style={{ margin: 0, fontSize: "14px", color: "var(--fg-2)" }}>
                O Anvilore trabalha sobre um clone do kit: markdown em disco, versionado no git. Sem banco de dados, sem
                servidor na nuvem.
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <label htmlFor="vault" style={{ fontWeight: 500 }}>
                Pasta do vault
              </label>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  id="vault"
                  className="mono"
                  type="text"
                  value={pasta}
                  onChange={e => acoes.aoMudarPasta(e.target.value)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: "38px",
                    padding: "0 12px",
                    border: "1px solid var(--line-strong)",
                    borderRadius: "8px",
                    background: "var(--panel)",
                    color: "inherit",
                    fontSize: "12.5px",
                    outline: "none",
                  }}
                />
              </div>
              {erroPasta && <span style={{ color: "var(--danger)", fontSize: "12px" }}>{erroPasta}</span>}
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                border: "1px solid var(--line)",
                borderRadius: "10px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  height: "36px",
                  padding: "0 14px",
                  background: "var(--subtle)",
                  fontSize: "12px",
                  fontWeight: 500,
                  color: "var(--fg-2)",
                }}
              >
                Encontrado nesta pasta
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  minHeight: "40px",
                  padding: "0 14px",
                  borderTop: "1px solid var(--line)",
                }}
              >
                <span style={{ color: dados.inspecao.wiki.existe ? "var(--ok)" : "var(--draft)" }}>
                  {dados.inspecao.wiki.existe ? "✓" : "•"}
                </span>
                <span className="mono" style={{ fontSize: "12.5px", width: "160px" }}>
                  wiki/
                </span>
                <span style={{ color: "var(--fg-3)", fontSize: "12.5px" }}>{dados.inspecao.wiki.detalhe}</span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  minHeight: "40px",
                  padding: "0 14px",
                  borderTop: "1px solid var(--line)",
                }}
              >
                <span style={{ color: dados.inspecao.raw.existe ? "var(--ok)" : "var(--draft)" }}>
                  {dados.inspecao.raw.existe ? "✓" : "•"}
                </span>
                <span className="mono" style={{ fontSize: "12.5px", width: "160px" }}>
                  raw/
                </span>
                <span style={{ color: "var(--fg-3)", fontSize: "12.5px" }}>{dados.inspecao.raw.detalhe}</span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  minHeight: "40px",
                  padding: "0 14px",
                  borderTop: "1px solid var(--line)",
                }}
              >
                <span style={{ color: dados.inspecao.contratos.existe ? "var(--ok)" : "var(--draft)" }}>
                  {dados.inspecao.contratos.existe ? "✓" : "•"}
                </span>
                <span className="mono" style={{ fontSize: "12.5px", width: "160px" }}>
                  SCHEMA.md · AGENTS.md
                </span>
                <span style={{ color: "var(--fg-3)", fontSize: "12.5px" }}>{dados.inspecao.contratos.detalhe}</span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  minHeight: "40px",
                  padding: "0 14px",
                  borderTop: "1px solid var(--line)",
                }}
              >
                <span style={{ color: dados.inspecao.bun.existe ? "var(--ok)" : "var(--danger)" }}>
                  {dados.inspecao.bun.existe ? "✓" : "•"}
                </span>
                <span className="mono" style={{ fontSize: "12.5px", width: "160px" }}>
                  bun
                </span>
                <span style={{ color: "var(--fg-3)", fontSize: "12.5px" }}>{dados.inspecao.bun.detalhe}</span>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "12px" }}>
              <button
                type="button"
                disabled={carregandoPasta}
                onClick={acoes.aoConfirmarPasta}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  height: "38px",
                  padding: "0 18px",
                  borderRadius: "8px",
                  background: "var(--accent)",
                  color: "var(--accent-text)",
                  fontWeight: 500,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Continuar →
              </button>
            </div>
          </>
        )}

        {passo === 2 && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 600, letterSpacing: "-0.015em" }}>
                Conecte o seu agente
              </h1>
              <p style={{ margin: 0, fontSize: "14px", color: "var(--fg-2)" }}>
                O chat conversa com o Claude Code instalado nesta máquina e usa a conta em que você já entrou nele. O
                Anvilore não pede nem guarda chave de API.
              </p>
            </div>

            <fieldset style={{ margin: 0, padding: 0, border: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
              <legend style={{ fontWeight: 500, marginBottom: "8px" }}>Provedor</legend>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "12px 14px",
                  border: "1.5px solid var(--accent)",
                  borderRadius: "10px",
                  background: "var(--subtle)",
                  cursor: "pointer",
                }}
              >
                <input type="radio" name="prov" checked readOnly style={{ accentColor: "var(--accent)", width: "16px", height: "16px", margin: 0 }} />
                <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>Claude Code</span>
                  <span className="mono" style={{ fontSize: "11.5px", color: "var(--fg-2)" }}>
                    {dados.agente.disponivel
                      ? `claude encontrado no PATH ${dados.agente.versao ? `· v${dados.agente.versao}` : ""}`
                      : "claude não encontrado no PATH"}
                  </span>
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "12px",
                    fontWeight: 500,
                    color: dados.agente.disponivel ? "var(--ok)" : "var(--draft)",
                  }}
                >
                  <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: dados.agente.disponivel ? "var(--ok)" : "var(--draft)" }} />
                  {dados.agente.disponivel ? "pronto" : "ausente"}
                </span>
              </label>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {["Codex", "Gemini CLI", "Copilot"].map(nome => (
                  <label
                    key={nome}
                    style={{
                      flex: "1 1 140px",
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "10px 12px",
                      border: "1px solid var(--line)",
                      borderRadius: "10px",
                      color: "var(--fg-3)",
                    }}
                  >
                    <input type="radio" name="prov" disabled style={{ margin: 0 }} />
                    <span style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ fontWeight: 500 }}>{nome}</span>
                      <span style={{ fontSize: "11.5px" }}>etapa 3</span>
                    </span>
                  </label>
                ))}
              </div>
              <p style={{ margin: 0, fontSize: "12px", color: "var(--fg-3)" }}>
                O instalador do kit já configura os quatro; o chat da interface começa pelo Claude Code.
              </p>
            </fieldset>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                border: "1px solid var(--line)",
                borderRadius: "10px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  height: "36px",
                  padding: "0 14px",
                  background: "var(--subtle)",
                  fontSize: "12px",
                  fontWeight: 500,
                  color: "var(--fg-2)",
                }}
              >
                <span style={{ flex: 1 }}>Travas do vault</span>
                <span className="mono" style={{ fontWeight: 400, color: "var(--fg-3)" }}>
                  anvilore doctor
                </span>
              </div>
              {dados.agente.travas.map(trava => (
                <div
                  key={trava.nome}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    minHeight: "40px",
                    padding: "0 14px",
                    borderTop: "1px solid var(--line)",
                  }}
                >
                  <span style={{ color: trava.ligada ? "var(--ok)" : trava.opcional ? "var(--draft)" : "var(--danger)" }}>
                    {trava.ligada ? "✓" : "•"}
                  </span>
                  <span style={{ flex: 1 }}>{trava.nome}</span>
                  <span style={{ fontSize: "12px", color: "var(--fg-3)" }}>
                    {trava.ligada ? "ligado" : trava.opcional ? (trava.detalhe ?? "opcional · desligada") : "desligado"}
                  </span>
                </div>
              ))}
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "10px",
                padding: "12px 14px",
                border: "1px solid var(--line)",
                borderRadius: "10px",
              }}
            >
              <span style={{ display: "flex", flexDirection: "column", flex: "1 1 220px" }}>
                <span style={{ fontWeight: 500 }}>Teste rápido</span>
                <span
                  style={{
                    fontSize: "12px",
                    color: sucessoTeste ? "var(--ok)" : sucessoTeste === false ? "var(--danger)" : "var(--fg-3)",
                  }}
                >
                  {resultadoTeste ?? "Pede ao agente para ler AGENTS.md, sem escrever nada."}
                </span>
              </span>
              <button
                type="button"
                disabled={testandoAgente}
                onClick={acoes.aoTestarAgente}
                style={{
                  height: "32px",
                  padding: "0 12px",
                  borderRadius: "7px",
                  border: "1px solid var(--line-strong)",
                  background: "var(--panel)",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                {testandoAgente ? "Testando…" : resultadoTeste ? "Testar de novo" : "Testar conexão"}
              </button>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px" }}>
              <button
                type="button"
                onClick={() => acoes.aoNavegar(1)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  height: "38px",
                  padding: "0 14px",
                  borderRadius: "8px",
                  color: "var(--fg-2)",
                  fontWeight: 500,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                }}
              >
                ← Voltar
              </button>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                onClick={() => acoes.aoNavegar(3)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  height: "38px",
                  padding: "0 18px",
                  borderRadius: "8px",
                  background: "var(--accent)",
                  color: "var(--accent-text)",
                  fontWeight: 500,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Continuar →
              </button>
            </div>
          </>
        )}

        {passo === 3 && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 600, letterSpacing: "-0.015em" }}>
                Você e suas áreas
              </h1>
              <p style={{ margin: 0, fontSize: "14px", color: "var(--fg-2)" }}>
                O agente escreve; quem aprova é você. Diga em que áreas da vida a wiki vai crescer.
              </p>
            </div>

            <fieldset style={{ margin: 0, padding: 0, border: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
              <legend style={{ fontWeight: 500, marginBottom: "10px" }}>Áreas</legend>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
                  gap: "8px",
                }}
              >
                {[
                  { name: "pessoal", hint: "leituras, ideias, metas" },
                  { name: "profissional", hint: "trabalho e carreira" },
                  { name: "projetos-paralelos", hint: "produtos e estudos" },
                  { name: "saude", hint: "treino, rotina" },
                  ...areasSelecionadas
                    .filter(a => !["pessoal", "profissional", "projetos-paralelos", "saude"].includes(a))
                    .map(a => ({ name: a, hint: "área personalizada" })),
                ].map(area => {
                  const marcada = areasSelecionadas.includes(area.name);
                  return (
                    <label
                      key={area.name}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        minHeight: "44px",
                        padding: "0 12px",
                        border: marcada ? "1.5px solid var(--accent)" : "1px solid var(--line)",
                        background: marcada ? "var(--subtle)" : "transparent",
                        borderRadius: "9px",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={marcada}
                        onChange={() => acoes.aoAlternarArea(area.name)}
                        style={{ accentColor: "var(--accent)", width: "16px", height: "16px", margin: 0 }}
                      />
                      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                        <span className="mono" style={{ fontSize: "12.5px", fontWeight: 500 }}>
                          {area.name}
                        </span>
                        <span style={{ fontSize: "11.5px", color: "var(--fg-3)" }}>{area.hint}</span>
                      </span>
                    </label>
                  );
                })}
              </div>

              <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                <input
                  className="mono"
                  type="text"
                  placeholder="nova-area"
                  value={novaArea}
                  onChange={e => acoes.aoMudarNovaArea(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      acoes.aoAdicionarArea();
                    }
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: "36px",
                    padding: "0 12px",
                    border: "1px dashed var(--line-strong)",
                    borderRadius: "8px",
                    background: "transparent",
                    color: "inherit",
                    fontSize: "12.5px",
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={acoes.aoAdicionarArea}
                  style={{
                    height: "36px",
                    padding: "0 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--line-strong)",
                    background: "var(--panel)",
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Adicionar
                </button>
              </div>
              <p style={{ margin: 0, fontSize: "12px", color: "var(--fg-3)" }}>
                Cada área vira <span className="mono">wiki/&lt;área&gt;/</span> com <span className="mono">sources</span>,{" "}
                <span className="mono">entities</span> e <span className="mono">concepts</span>.
              </p>
            </fieldset>

            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
                padding: "12px 14px",
                border: "1px solid var(--line)",
                borderRadius: "10px",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={removerExemplo}
                onChange={e => acoes.aoAlternarRemoverExemplo(e.target.checked)}
                style={{ accentColor: "var(--accent)", width: "16px", height: "16px", margin: "2px 0 0" }}
              />
              <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontWeight: 500 }}>Remover a área de exemplo</span>
                <span style={{ fontSize: "12px", color: "var(--fg-3)" }}>
                  Apaga <span className="mono">wiki/exemplo/</span> e a seção dela no <span className="mono">index.md</span>,
                  para a validação não reprovar um link órfão.
                </span>
              </span>
            </label>

            {erroAreas && <span style={{ color: "var(--danger)", fontSize: "12px" }}>{erroAreas}</span>}

            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px" }}>
              <button
                type="button"
                onClick={() => acoes.aoNavegar(2)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  height: "38px",
                  padding: "0 14px",
                  borderRadius: "8px",
                  color: "var(--fg-2)",
                  fontWeight: 500,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                }}
              >
                ← Voltar
              </button>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                disabled={criandoAreas}
                onClick={acoes.aoCriarAreas}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  height: "38px",
                  padding: "0 18px",
                  borderRadius: "8px",
                  background: "var(--accent)",
                  color: "var(--accent-text)",
                  fontWeight: 500,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                {criandoAreas ? "Criando áreas…" : "Criar áreas →"}
              </button>
            </div>
          </>
        )}

        {passo === 4 && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 600, letterSpacing: "-0.015em" }}>
                Faça a primeira ingestão
              </h1>
              <p style={{ margin: 0, fontSize: "14px", color: "var(--fg-2)" }}>
                Comece pelo texto que originou o padrão. Ele já está no vault e leva uns minutos.
              </p>
            </div>

            {dados.primeiraIngestao.exemploDisponivel && (
              <>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: "14px",
                    padding: "16px",
                    border: "1.5px solid var(--accent)",
                    borderRadius: "12px",
                    background: "var(--subtle)",
                  }}
                >
                  <span
                    style={{
                      width: "36px",
                      height: "42px",
                      borderRadius: "5px",
                      border: "1px solid var(--line-strong)",
                      background: "var(--panel)",
                      display: "flex",
                      alignItems: "flex-end",
                      justifyContent: "center",
                      paddingBottom: "6px",
                      boxSizing: "border-box",
                      flex: "none",
                    }}
                  >
                    <span className="mono" style={{ fontSize: "9px", color: "var(--accent)", fontWeight: 500 }}>
                      MD
                    </span>
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: "2px", flex: "1 1 220px", minWidth: 0 }}>
                    <span style={{ fontWeight: 600, fontSize: "14px" }}>LLM Wiki — Andrej Karpathy</span>
                    <span className="mono" style={{ fontSize: "11.5px", color: "var(--fg-2)" }}>
                      raw/exemplo/llm-wiki.md · 12 KB
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={concluindo}
                    onClick={() =>
                      acoes.aoIngerirExemplo
                        ? acoes.aoIngerirExemplo(areasSelecionadas[0] ?? "pessoal")
                        : acoes.aoConcluir("#/chat")
                    }
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "8px",
                      height: "36px",
                      padding: "0 14px",
                      borderRadius: "8px",
                      background: "var(--accent)",
                      color: "var(--accent-text)",
                      fontWeight: 500,
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    Ingerir em {areasSelecionadas[0] ?? "pessoal"}
                  </button>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    color: "var(--fg-3)",
                    fontSize: "12px",
                  }}
                >
                  <span style={{ flex: 1, height: "1px", background: "var(--line)" }} />
                  ou traga a sua fonte
                  <span style={{ flex: 1, height: "1px", background: "var(--line)" }} />
                </div>
              </>
            )}

            <button
              type="button"
              disabled={concluindo}
              onClick={() => acoes.aoConcluir("#/chat")}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "6px",
                padding: "22px 16px",
                border: "1.5px dashed var(--line-strong)",
                borderRadius: "12px",
                background: "var(--subtle)",
                cursor: "pointer",
              }}
            >
              <span style={{ fontWeight: 500 }}>Solte um arquivo .md, .txt ou .pdf</span>
              <span style={{ fontSize: "12px", color: "var(--fg-3)" }}>
                Você o salva em <span className="mono">raw/&lt;área&gt;/</span>; o agente só lê.
              </span>
            </button>

            <ol
              style={{
                listStyle: "none",
                margin: 0,
                padding: "14px 0 0",
                borderTop: "1px solid var(--line)",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(140px, 100%), 1fr))",
                gap: "14px",
              }}
            >
              <li style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span className="mono" style={{ fontSize: "11.5px", color: "var(--accent)", fontWeight: 500 }}>
                  01
                </span>
                <span style={{ fontWeight: 500 }}>Você adiciona a fonte</span>
                <span style={{ fontSize: "12px", color: "var(--fg-3)" }}>em raw/, que o agente não altera</span>
              </li>
              <li style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span className="mono" style={{ fontSize: "11.5px", color: "var(--accent)", fontWeight: 500 }}>
                  02
                </span>
                <span style={{ fontWeight: 500 }}>Você aprova o que entra</span>
                <span style={{ fontSize: "12px", color: "var(--fg-3)" }}>takeaways e lista de páginas</span>
              </li>
              <li style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span className="mono" style={{ fontSize: "11.5px", color: "var(--accent)", fontWeight: 500 }}>
                  03
                </span>
                <span style={{ fontWeight: 500 }}>Você aprova o que ficou</span>
                <span style={{ fontSize: "12px", color: "var(--fg-3)" }}>as páginas nascem rascunho</span>
              </li>
            </ol>

            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px" }}>
              <button
                type="button"
                onClick={() => acoes.aoNavegar(3)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  height: "38px",
                  padding: "0 14px",
                  borderRadius: "8px",
                  color: "var(--fg-2)",
                  fontWeight: 500,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                }}
              >
                ← Voltar
              </button>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                disabled={concluindo}
                onClick={() => acoes.aoConcluir("#/inicio")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  height: "38px",
                  padding: "0 14px",
                  borderRadius: "8px",
                  border: "1px solid var(--line-strong)",
                  background: "var(--panel)",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Pular por agora
              </button>
            </div>
          </>
        )}
      </main>

      <p style={{ margin: 0, maxWidth: "560px", textAlign: "center", fontSize: "12px", color: "var(--fg-3)" }}>
        A interface roda nesta máquina, em <span className="mono">localhost</span>. O que o agente lê é enviado ao provedor
        dele.
      </p>
    </div>
  );
}

export type ContextoAcoesDoOnboarding = {
  pasta: string;
  setPasta: (p: string) => void;
  setCarregandoPasta: (c: boolean) => void;
  setErroPasta: (e: string | null) => void;
  setTestandoAgente: (t: boolean) => void;
  setResultadoTeste: (r: string | null) => void;
  setSucessoTeste: (s: boolean | null) => void;
  areasSelecionadas: string[];
  setAreasSelecionadas: React.Dispatch<React.SetStateAction<string[]>>;
  novaArea: string;
  setNovaArea: (n: string) => void;
  removerExemplo: boolean;
  setRemoverExemplo: (r: boolean) => void;
  setCriandoAreas: (c: boolean) => void;
  setErroAreas: (e: string | null) => void;
  setConcluindo: (c: boolean) => void;
  aoAtualizar?: () => Promise<void>;
  navegar?: (hash: string) => void;
  chamarApi?: typeof api;
};

export function criarAcoesDoOnboarding(ctx: ContextoAcoesDoOnboarding): AcoesDoOnboarding {
  const navegar = ctx.navegar ?? ((hash: string) => {
    if (typeof window !== "undefined") window.location.hash = hash;
  });
  const chamarApi = ctx.chamarApi ?? api;

  return {
    aoMudarPasta: ctx.setPasta,
    aoConfirmarPasta: async () => {
      ctx.setCarregandoPasta(true);
      ctx.setErroPasta(null);
      try {
        const resp = await chamarApi<{ ok: boolean; pasta: string }>("/api/onboarding/pasta", "POST", { pasta: ctx.pasta });
        if (resp && typeof resp.pasta === "string") {
          ctx.setPasta(resp.pasta);
        }
        if (ctx.aoAtualizar) await ctx.aoAtualizar();
        navegar("#/onboarding/2");
      } catch (erro) {
        ctx.setErroPasta(erro instanceof Error ? erro.message : "Erro ao validar a pasta.");
      } finally {
        ctx.setCarregandoPasta(false);
      }
    },
    aoTestarAgente: async () => {
      ctx.setTestandoAgente(true);
      ctx.setResultadoTeste(null);
      try {
        const resp = await chamarApi<{ ok: boolean; mensagem: string }>("/api/onboarding/testar-agente", "POST", {});
        ctx.setSucessoTeste(resp.ok);
        ctx.setResultadoTeste(resp.mensagem);
      } catch (erro) {
        ctx.setSucessoTeste(false);
        ctx.setResultadoTeste(erro instanceof Error ? erro.message : "Falha ao testar conexão.");
      } finally {
        ctx.setTestandoAgente(false);
      }
    },
    aoMudarNovaArea: ctx.setNovaArea,
    aoAlternarArea: (area: string) => {
      ctx.setAreasSelecionadas(atuais =>
        atuais.includes(area) ? atuais.filter(a => a !== area) : [...atuais, area],
      );
    },
    aoAdicionarArea: () => {
      const limpa = ctx.novaArea.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-");
      if (limpa && !ctx.areasSelecionadas.includes(limpa)) {
        ctx.setAreasSelecionadas(atuais => [...atuais, limpa]);
        ctx.setNovaArea("");
      }
    },
    aoAlternarRemoverExemplo: ctx.setRemoverExemplo,
    aoCriarAreas: async () => {
      if (ctx.areasSelecionadas.length === 0) {
        ctx.setErroAreas("Selecione pelo menos uma área.");
        return;
      }
      ctx.setCriandoAreas(true);
      ctx.setErroAreas(null);
      try {
        await chamarApi("/api/onboarding/areas", "POST", { areas: ctx.areasSelecionadas, removerExemplo: ctx.removerExemplo });
        if (ctx.aoAtualizar) await ctx.aoAtualizar();
        navegar("#/onboarding/4");
      } catch (erro) {
        ctx.setErroAreas(erro instanceof Error ? erro.message : "Erro ao inicializar áreas.");
      } finally {
        ctx.setCriandoAreas(false);
      }
    },
    aoConcluir: async (destino: string) => {
      ctx.setConcluindo(true);
      try {
        await chamarApi("/api/onboarding/concluir", "POST", {});
        navegar(destino);
      } catch {
        navegar(destino);
      } finally {
        ctx.setConcluindo(false);
      }
    },
    aoIngerirExemplo: async (area?: string) => {
      ctx.setConcluindo(true);
      try {
        const resp = await chamarApi<{ ok: boolean; id: string }>("/api/onboarding/ingerir-exemplo", "POST", { area });
        if (ctx.aoAtualizar) await ctx.aoAtualizar();
        navegar(`#/chat/${resp.id}`);
      } catch {
        navegar("#/chat");
      } finally {
        ctx.setConcluindo(false);
      }
    },
    aoNavegar: (novoPasso: number) => {
      navegar(`#/onboarding/${novoPasso}`);
    },
  };
}

type Propriedades = {
  passo: number;
  tema: Tema;
  alternarTema: () => void;
  dados: EstadoOnboarding;
  aoAtualizar?: () => Promise<void>;
};

export function Onboarding({ passo, tema: _tema, alternarTema: _alternarTema, dados, aoAtualizar }: Propriedades) {
  const [pasta, setPasta] = useState(dados.pasta);
  const [erroPasta, setErroPasta] = useState<string | null>(null);
  const [carregandoPasta, setCarregandoPasta] = useState(false);

  const [testandoAgente, setTestandoAgente] = useState(false);
  const [resultadoTeste, setResultadoTeste] = useState<string | null>(null);
  const [sucessoTeste, setSucessoTeste] = useState<boolean | null>(null);

  const [areasSelecionadas, setAreasSelecionadas] = useState<string[]>(
    dados.areas.existentes.length > 0 ? dados.areas.existentes : dados.areas.padrao,
  );
  const [novaArea, setNovaArea] = useState("");
  const [removerExemplo, setRemoverExemplo] = useState(dados.areas.temExemplo);
  const [criandoAreas, setCriandoAreas] = useState(false);
  const [erroAreas, setErroAreas] = useState<string | null>(null);

  const [concluindo, setConcluindo] = useState(false);

  const acoes = criarAcoesDoOnboarding({
    pasta,
    setPasta,
    setCarregandoPasta,
    setErroPasta,
    setTestandoAgente,
    setResultadoTeste,
    setSucessoTeste,
    areasSelecionadas,
    setAreasSelecionadas,
    novaArea,
    setNovaArea,
    removerExemplo,
    setRemoverExemplo,
    setCriandoAreas,
    setErroAreas,
    setConcluindo,
    aoAtualizar,
  });

  return (
    <PainelDoOnboarding
      passo={passo}
      dados={dados}
      pasta={pasta}
      erroPasta={erroPasta}
      carregandoPasta={carregandoPasta}
      testandoAgente={testandoAgente}
      resultadoTeste={resultadoTeste}
      sucessoTeste={sucessoTeste}
      areasSelecionadas={areasSelecionadas}
      novaArea={novaArea}
      removerExemplo={removerExemplo}
      criandoAreas={criandoAreas}
      erroAreas={erroAreas}
      concluindo={concluindo}
      acoes={acoes}
    />
  );
}
