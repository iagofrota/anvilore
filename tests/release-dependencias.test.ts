import { afterAll, expect, test } from "bun:test";
import { verificarDependencias } from "../scripts/verificar-dependencias-release";

// Retirar a comparação do SHA, ignorar uma plataforma ou aceitar resposta HTTP com erro derruba estes cenários.
const servidor = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: req => {
  const rota = new URL(req.url).pathname;
  if (rota === "/fora") return new Response("fora", { status: 503 });
  return new Response(rota === "/alterado" ? "adulterado" : "abc");
} });
afterAll(() => servidor.stop(true));
const hash = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const entrada = (arquivo = "ok") => ({ arquivo, url: `https://github.com/oven-sh/bun/releases/download/bun-v1.4.1/${arquivo}`, sha256: hash });
const manifesto = (...entradas: ReturnType<typeof entrada>[]) => ({ formato: 1, dependencias: {
  bun: { versao: "1.4.1", plataformas: Object.fromEntries(entradas.map((e, i) => [`plataforma-${i}`, e])) },
} });
// O transporte público é substituído por HTTP local real; leitura, status e hash continuam reais.
const obter = ((url: string | URL | Request, init?: RequestInit) =>
  fetch(new URL(new URL(String(url)).pathname.split("/").at(-1)!, servidor.url), init)) as typeof fetch;

test("Dado duas plataformas, Quando baixo cada entrada, Então confiro os bytes das duas", async () => {
  expect(await verificarDependencias(manifesto(entrada(), entrada("outra")), obter)).toEqual([
    "bun/plataforma-0: SHA-256 confere", "bun/plataforma-1: SHA-256 confere",
  ]);
});
test("Dado hash divergente, Quando verifico o download, Então o gate falha", async () => {
  await expect(verificarDependencias(manifesto(entrada("alterado")), obter)).rejects.toThrow("SHA-256 divergente: bun/plataforma-0");
});
test("Dado URL fora do ar, Quando verifico, Então o gate falha sem tratar corpo de erro como arquivo", async () => {
  await expect(verificarDependencias(manifesto(entrada("fora")), obter)).rejects.toThrow("HTTP 503: bun/plataforma-0");
});
test("Dado manifesto vazio ou malformado, Quando verifico, Então não aprovo sem downloads", async () => {
  for (const m of [{}, { formato: 1, dependencias: {} }, manifesto({ ...entrada(), sha256: "errado" }),
    { formato: 1, dependencias: { bun: { plataformas: {} } } }, manifesto({ ...entrada(), url: "http://github.com/arquivo" })]) {
    await expect(verificarDependencias(m, obter)).rejects.toThrow("Manifesto inválido");
  }
});
test("Dado falha de rede, Quando verifico, Então falho com identificação e sem divulgar a URL", async () => {
  const falhar = (async () => { throw new Error("https://origem/segredo"); }) as unknown as typeof fetch;
  await expect(verificarDependencias(manifesto(entrada()), falhar)).rejects.toThrow("Download falhou: bun/plataforma-0");
});
