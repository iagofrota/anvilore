import { erroDaResposta } from "./revisao";

// Lido na chamada, não na importação: os componentes que importam este módulo são testados sem navegador.
function parametroToken(): string {
  const token = document.querySelector<HTMLMetaElement>('meta[name="anvilore-token"]')?.content ?? "";
  return `token=${encodeURIComponent(token)}`;
}

export async function api<T>(rota: string, metodo = "GET", corpo?: unknown): Promise<T> {
  const formulario = corpo instanceof FormData;
  const separador = rota.includes("?") ? "&" : "?";
  const resposta = await fetch(`${rota}${separador}${parametroToken()}`, {
    method: metodo,
    ...(corpo === undefined ? {} : formulario ? { body: corpo } : { headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) }),
  });
  if (!resposta.ok) throw await erroDaResposta(resposta);
  return await resposta.json() as T;
}
