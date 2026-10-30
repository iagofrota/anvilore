// Rotas e menu da interface. É o ponto único que as telas novas (Nota, Biblioteca, Onboarding) estendem:
// 1. acrescente a tela em `Tela` e um item em `MENU`;
// 2. acrescente o caso em `lerRota` e em `hashDaRota`;
// 3. desenhe a tela em `main.tsx` (um `case` no `switch` de `Aplicacao`).
// O endereço é o hash (`#/tela/id`): a interface é uma página só, servida pelo `anvilore ui`.

export type Tela = "inicio" | "chat" | "biblioteca" | "nota" | "revisao";
export type Rota = { tela: Tela; id?: string; lacuna?: string };
export type ItemDoMenu = { tela: Tela; rotulo: string; hash: string };

export const MENU: ItemDoMenu[] = [
  { tela: "inicio", rotulo: "Início", hash: "#/inicio" },
  { tela: "chat", rotulo: "＋ Nova ingestão", hash: "#/chat" },
  { tela: "biblioteca", rotulo: "Biblioteca", hash: "#/biblioteca" },
  { tela: "revisao", rotulo: "Revisão", hash: "#/revisao" },
];

const ID_DA_CONVERSA = /^[a-z0-9-]+$/;

// Endereço vazio ou desconhecido cai no Início: é a tela inicial do `anvilore ui`.
export function lerRota(hash: string): Rota {
  const limpo = hash.startsWith("#/") ? hash.slice(2) : hash.startsWith("#") ? hash.slice(1) : hash;
  const separadorConsulta = limpo.indexOf("?");
  const caminho = separadorConsulta === -1 ? limpo : limpo.slice(0, separadorConsulta);
  const consulta = new URLSearchParams(separadorConsulta === -1 ? "" : limpo.slice(separadorConsulta + 1));
  const lacuna = consulta.get("lacuna");
  const barra = caminho.indexOf("/");
  const tela = barra === -1 ? caminho : caminho.slice(0, barra);
  const resto = barra === -1 ? undefined : caminho.slice(barra + 1);

  if (tela === "revisao") return { tela: "revisao" };
  if (tela === "biblioteca") return { tela: "biblioteca" };
  if (tela === "nota" && resto) return { tela: "nota", id: resto };
  if (tela === "chat") return {
    tela: "chat",
    ...(resto && ID_DA_CONVERSA.test(resto) ? { id: resto } : {}),
    ...(lacuna === null ? {} : { lacuna }),
  };
  return { tela: "inicio" };
}

export function hashDaRota(rota: Rota): string {
  if (rota.tela === "chat") {
    const caminho = rota.id ? `#/chat/${rota.id}` : "#/chat";
    return rota.lacuna === undefined ? caminho : `${caminho}?lacuna=${encodeURIComponent(rota.lacuna)}`;
  }
  if (rota.tela === "nota") return rota.id ? `#/nota/${rota.id}` : "#/biblioteca";
  return `#/${rota.tela}`;
}
