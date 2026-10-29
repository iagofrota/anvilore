import React from "react";

// Sem navegador e sem dependência nova: os testes de tela expandem os componentes (que não usam hooks) em
// elementos de HTML e chamam os manipuladores direto.
export type No = React.ReactNode;
type Elemento = React.ReactElement<Record<string, unknown>>;

export function expandir(no: No): No {
  if (Array.isArray(no)) return no.map(expandir);
  if (!React.isValidElement(no)) return no;
  const elemento = no as Elemento;
  if (typeof elemento.type === "function") return expandir((elemento.type as (p: unknown) => No)(elemento.props));
  return React.cloneElement(elemento, undefined, ...([] as No[]).concat(expandir(elemento.props.children as No) as No));
}

export function texto(no: No): string {
  if (Array.isArray(no)) return no.map(texto).join("");
  if (typeof no === "string" || typeof no === "number") return String(no);
  if (!React.isValidElement(no)) return "";
  return texto((no.props as { children?: No }).children);
}

export function achar(no: No, pred: (e: Elemento) => boolean): Elemento[] {
  if (Array.isArray(no)) return no.flatMap(filho => achar(filho, pred));
  if (!React.isValidElement(no)) return [];
  const elemento = no as Elemento;
  return [...(pred(elemento) ? [elemento] : []), ...achar(elemento.props.children as No, pred)];
}

export const botao = (arvore: No, rotulo: string) => achar(arvore, e => e.type === "button" && texto(e).includes(rotulo))[0];
export const link = (arvore: No, rotulo: string) => achar(arvore, e => e.type === "a" && texto(e).includes(rotulo))[0];
