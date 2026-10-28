import { erroDaResposta } from "./revisao";

const token = document.querySelector<HTMLMetaElement>('meta[name="anvilore-token"]')?.content ?? "";
const parametroToken = `token=${encodeURIComponent(token)}`;

export async function api<T>(rota: string, metodo = "GET", corpo?: unknown): Promise<T> {
  const formulario = corpo instanceof FormData;
  const resposta = await fetch(`${rota}?${parametroToken}`, {
    method: metodo,
    ...(corpo === undefined ? {} : formulario ? { body: corpo } : { headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) }),
  });
  if (!resposta.ok) throw await erroDaResposta(resposta);
  return await resposta.json() as T;
}
