import React from "react";
import type { ResumoDeConversa } from "../../src/lib/ui-ingestao";
import { MENU, type Rota } from "./navegacao";

// O casco comum das telas: barra lateral (menu, conversas, agente) e a coluna da tela.
// Uma tela nova só entrega o seu `<main className="main">…</main>` como `children`; o menu vem de `MENU`
// em `navegacao.ts`. `aviso` é uma faixa opcional acima da tela (hoje, o atualizador).
type Propriedades = {
  rota: Rota;
  conversas: ResumoDeConversa[];
  agente: string;
  aviso?: React.ReactNode;
  children: React.ReactNode;
};

export function Shell({ rota, conversas, agente, aviso, children }: Propriedades) {
  return <div className="layout">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">a</span><span>anvilore</span></div>
      <nav className="nav" aria-label="Telas">
        {MENU.map(item => {
          const ativo = rota.tela === item.tela && !(item.tela === "chat" && rota.id);
          return <a key={item.tela} href={item.hash} className={ativo ? "active" : ""} aria-current={ativo ? "page" : undefined}>{item.rotulo}</a>;
        })}
      </nav>
      {conversas.length > 0 && <>
        <div className="vault-label">CONVERSAS</div>
        <nav className="conversations" aria-label="Conversas">
          {conversas.map(c => <a key={c.id} href={`#/chat/${c.id}`} className={rota.id === c.id ? "active" : ""} title={c.fonte}>
            <span className={`conversation-dot ${c.situacao}`} aria-hidden="true" />Ingerir: {c.nome}
          </a>)}
        </nav>
      </>}
      <div className="sidebar-bottom"><span className="status-dot" /> <span>{agente}</span> <span className="sidebar-spacer" /> <span className="mono">raw/ protegido</span></div>
    </aside>
    <div className="main-column">
      {aviso}
      {children}
    </div>
  </div>;
}
