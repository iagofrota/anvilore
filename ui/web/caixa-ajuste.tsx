import React from "react";

export type PropriedadesDoAjuste = {
  aberto: boolean;
  texto: string;
  enviando: boolean;
  aoMudarTexto: (texto: string) => void;
  aoCancelar: () => void;
  aoEnviar: () => void;
  nomeDoAgente?: string;
};

export function CaixaDeAjuste({
  aberto,
  texto,
  enviando,
  aoMudarTexto,
  aoCancelar,
  aoEnviar,
  nomeDoAgente = "Claude Code",
}: PropriedadesDoAjuste) {
  if (!aberto) return null;
  return (
    <div className="adjustment-box">
      <label htmlFor="ajuste">O que o agente deve mudar nesta página?</label>
      <textarea
        id="ajuste"
        rows={3}
        placeholder="Ex.: a frase sobre o Obsidian exagera, a fonte só diz que ele fica aberto ao lado do agente."
        value={texto}
        onChange={evento => aoMudarTexto(evento.target.value)}
        disabled={enviando}
      />
      <div className="adjustment-actions">
        <button type="button" className="secondary-button" disabled={enviando} onClick={aoCancelar}>Cancelar</button>
        <button type="button" className="approve-button" disabled={enviando || !texto.trim()} onClick={aoEnviar}>{enviando ? "Enviando…" : `Enviar ao ${nomeDoAgente}`}</button>
      </div>
    </div>
  );
}
