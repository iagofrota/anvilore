import { ErroApi, erroDaResposta } from "./revisao";

// Lido na chamada, não na importação: os componentes que importam este módulo são testados sem navegador.
function parametroToken(): string {
  const token = document.querySelector<HTMLMetaElement>('meta[name="anvilore-token"]')?.content ?? "";
  return `token=${encodeURIComponent(token)}`;
}

export async function api<T>(rota: string, metodo = "GET", corpo?: unknown): Promise<T> {
  const formulario = corpo instanceof FormData;
  const separador = rota.includes("?") ? "&" : "?";
  let resposta: Response;
  try {
    resposta = await fetch(`${rota}${separador}${parametroToken()}`, {
      method: metodo,
      ...(corpo === undefined ? {} : formulario ? { body: corpo } : { headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) }),
    });
  } catch {
    throw new ErroApi("Não consegui falar com o Anvilore. Ele pode ter sido fechado; abra de novo.");
  }
  if (!resposta.ok) throw await erroDaResposta(resposta);
  try { return await resposta.json() as T; }
  catch { throw new ErroApi("O Anvilore respondeu em um formato inesperado."); }
}
