// Rotas e menu da interface. É o ponto único que as telas novas (Nota, Biblioteca, Onboarding) estendem:
// 1. acrescente a tela em `Tela` e um item em `MENU`;
// 2. acrescente o caso em `lerRota` e em `hashDaRota`;
// 3. desenhe a tela em `main.tsx` (um `case` no `switch` de `Aplicacao`).
// O endereço é o hash (`#/tela/id`): a interface é uma página só, servida pelo `anvilore ui`.

export type Tela = "inicio" | "chat" | "revisao";
export type Rota = { tela: Tela; id?: string };
export type ItemDoMenu = { tela: Tela; rotulo: string; hash: string };

export const MENU: ItemDoMenu[] = [
  { tela: "inicio", rotulo: "Início", hash: "#/inicio" },
  { tela: "chat", rotulo: "＋ Nova ingestão", hash: "#/chat" },
  { tela: "revisao", rotulo: "Revisão", hash: "#/revisao" },
];

const ID_DA_CONVERSA = /^[a-z0-9-]+$/;

// Endereço vazio ou desconhecido cai no Início: é a tela inicial do `anvilore ui`.
export function lerRota(hash: string): Rota {
  const [, tela, id] = hash.split("/");
  if (tela === "revisao") return { tela: "revisao" };
  if (tela === "chat") return { tela: "chat", ...(id && ID_DA_CONVERSA.test(id) ? { id } : {}) };
  return { tela: "inicio" };
}

export function hashDaRota(rota: Rota): string {
  if (rota.tela === "chat") return rota.id ? `#/chat/${rota.id}` : "#/chat";
  return `#/${rota.tela}`;
}
