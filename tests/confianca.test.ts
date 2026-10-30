import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { URL_CONFIANCA, consultarConfianca, fingerprintsDaLinha, filtrarAssinantes, validarConfianca, type BuscarConfianca } from "../src/lib/confianca";
import { criarChave } from "./apoio/kit-atualizavel";

// Estado das chaves fora do GitHub (PARECER-SOL-DECISOES-RELEASE.md §2): o site publica quais chaves ainda valem e a
// versão mínima; o atualizador só aceita a interseção com as chaves que já confiava.

const FP = "SHA256:" + "A".repeat(43);
const FP2 = "SHA256:" + "B".repeat(43);
const valido = (extra: Record<string, unknown> = {}) => JSON.stringify({ formato: 1, chaves: [FP], versaoMinima: "0.3.0", ...extra });
const FRASE = `não consegui conferir a lista atual de chaves em ${URL_CONFIANCA}; nada mudou; tente de novo mais tarde`;
const pastas: string[] = [];
afterAll(async () => { await Promise.all(pastas.map(p => rm(p, { recursive: true, force: true }))); });

describe("confianca.json: formato e validação estrita", () => {
  test("Dado a URL fixa, Então é o subdomínio do dono, em https", () => {
    expect(URL_CONFIANCA).toBe("https://anvilore.iagofrota.com.br/confianca.json");
  });

  test("Dado um documento certo, Quando valido, Então devolve formato, chaves e versão mínima", () => {
    expect(validarConfianca(valido({ chaves: [FP, FP2] }))).toEqual({ formato: 1, chaves: [FP, FP2], versaoMinima: "0.3.0" });
  });

  const ruins: [string, string][] = [
    ["não é JSON", "{"],
    ["é uma lista", "[]"],
    ["é null", "null"],
    ["tem campo extra", valido({ extra: 1 })],
    ["não tem versaoMinima", JSON.stringify({ formato: 1, chaves: [FP] })],
    ["não tem chaves", JSON.stringify({ formato: 1, versaoMinima: "0.3.0" })],
    ["formato 2", valido({ formato: 2 })],
    ["formato como texto", valido({ formato: "1" })],
    ["chaves vazia", valido({ chaves: [] })],
    ["chaves não é lista", valido({ chaves: FP })],
    ["chave que não é texto", valido({ chaves: [1] })],
    ["chave sem o prefixo SHA256:", valido({ chaves: ["A".repeat(43)] })],
    ["chave com tamanho errado", valido({ chaves: ["SHA256:abc"] })],
    ["chave com preenchimento =", valido({ chaves: ["SHA256:" + "A".repeat(42) + "="] })],
    ["chave com espaço nas pontas", valido({ chaves: [` ${FP}`] })],
    ["chaves repetidas", valido({ chaves: [FP, FP] })],
    ["versaoMinima que não é texto", valido({ versaoMinima: 3 })],
    ["versaoMinima com pré-release", valido({ versaoMinima: "0.3.0-rc.1" })],
    ["versaoMinima com build", valido({ versaoMinima: "0.3.0+x" })],
    ["versaoMinima com prefixo v", valido({ versaoMinima: "v0.3.0" })],
    ["versaoMinima incompleta", valido({ versaoMinima: "0.3" })],
  ];
  for (const [caso, texto] of ruins) {
    test(`Dado um documento que ${caso}, Quando valido, Então recusa`, () => {
      expect(() => validarConfianca(texto)).toThrow();
    });
  }
});

// Servidor de verdade, só em loopback; o fetcher injetado troca a URL fixa pela dele (a URL real nunca é acessada).
function servidor(rotas: Record<string, (req: Request) => Response | Promise<Response>>) {
  const s = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: req => (rotas[new URL(req.url).pathname] ?? (() => new Response("não achei", { status: 404 })))(req) });
  const buscar: BuscarConfianca = (url, init) => {
    expect(url).toBe(URL_CONFIANCA);
    return fetch(`http://127.0.0.1:${s.port}/confianca.json`, init);
  };
  return { s, buscar, parar: () => s.stop(true) };
}

describe("confianca.json: busca", () => {
  test("Dado o site no ar, Quando consulto, Então a requisição pede sem cache, não segue redirecionamento e devolve o documento", async () => {
    let visto: Request | undefined;
    const x = servidor({ "/confianca.json": req => { visto = req; return new Response(valido()); } });
    try {
      const lista = await consultarConfianca(x.buscar);
      expect(lista).toEqual({ formato: 1, chaves: [FP], versaoMinima: "0.3.0" });
      expect(visto!.headers.get("cache-control")).toBe("no-cache");
      expect(visto!.headers.get("pragma")).toBe("no-cache");
    } finally { x.parar(); }
  });

  test("Dado um buscador, Quando consulto, Então ele recebe redirect manual, sinal de tempo limite e os cabeçalhos sem cache", async () => {
    let init: RequestInit | undefined;
    await consultarConfianca(async (_url, i) => { init = i; return new Response(valido()); });
    expect(init!.redirect).toBe("manual");
    expect(init!.signal).toBeDefined();
    expect(new Headers(init!.headers).get("cache-control")).toBe("no-cache");
    expect(new Headers(init!.headers).get("pragma")).toBe("no-cache");
  });

  test("Dado um redirecionamento (301/302/307/308) para um documento válido, Quando consulto, Então recusa e não segue", async () => {
    for (const status of [301, 302, 307, 308]) {
      let seguiu = false;
      const x = servidor({
        "/confianca.json": () => new Response(null, { status, headers: { location: "/outro.json" } }),
        "/outro.json": () => { seguiu = true; return new Response(valido()); },
      });
      try {
        await expect(consultarConfianca(x.buscar)).rejects.toThrow(FRASE);
        expect([status, seguiu]).toEqual([status, false]);
      } finally { x.parar(); }
    }
  });

  for (const status of [204, 301, 403, 404, 500, 503]) {
    test(`Dado HTTP ${status}, Quando consulto, Então recusa com a mensagem simples`, async () => {
      const x = servidor({ "/confianca.json": () => new Response(status === 204 ? null : valido(), { status }) });
      try { await expect(consultarConfianca(x.buscar)).rejects.toThrow(FRASE); } finally { x.parar(); }
    });
  }

  test("Dado servidor fora do ar ou falha de TLS, Quando consulto, Então recusa com a mensagem simples", async () => {
    const x = servidor({});
    const porta = x.s.port;
    x.parar();
    await expect(consultarConfianca((_u, init) => fetch(`http://127.0.0.1:${porta}/confianca.json`, init))).rejects.toThrow(FRASE);
    await expect(consultarConfianca(async () => { throw new TypeError("unable to verify the first certificate"); })).rejects.toThrow(FRASE);
  });

  test("Dado servidor que não responde, Quando passa o tempo limite, Então recusa (mesmo se o buscador ignorar o sinal)", async () => {
    const t0 = Date.now();
    await expect(consultarConfianca(() => new Promise<Response>(() => {}), { tempoLimiteMs: 100 })).rejects.toThrow(FRASE);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  test("Dado documento maior que 64 KiB (com ou sem content-length), Quando consulto, Então recusa", async () => {
    const grande = valido({ chaves: [FP], versaoMinima: "0.3.0" }) + " ".repeat(64 * 1024);
    await expect(consultarConfianca(async () => new Response(grande))).rejects.toThrow(FRASE);
    const fluxo = new ReadableStream({ start(c) { const parte = new Uint8Array(8 * 1024); for (let i = 0; i < 16; i++) c.enqueue(parte); c.close(); } });
    await expect(consultarConfianca(async () => new Response(fluxo))).rejects.toThrow(FRASE);
    await expect(consultarConfianca(async () => new Response(valido(), { headers: { "content-length": String(64 * 1024 + 1) } }))).rejects.toThrow(FRASE);
  });

  test("Dado documento inválido, Quando consulto, Então recusa com a mesma mensagem simples", async () => {
    for (const texto of ["{", valido({ extra: 1 }), valido({ formato: 2 }), valido({ chaves: [] })]) {
      await expect(consultarConfianca(async () => new Response(texto))).rejects.toThrow(FRASE);
    }
  });

  test("Dado uma consulta que deu certo e o site depois fora do ar, Quando consulto de novo, Então recusa: não há cache nem fallback offline", async () => {
    let no_ar = true;
    const buscar: BuscarConfianca = async () => { if (!no_ar) throw new TypeError("fora do ar"); return new Response(valido()); };
    expect((await consultarConfianca(buscar)).chaves).toEqual([FP]);
    no_ar = false;
    await expect(consultarConfianca(buscar)).rejects.toThrow(FRASE);
  });

  test("Dado variáveis de ambiente que parecem apontar a URL, Quando consulto, Então a URL continua a constante", async () => {
    const nomes = ["ANVILORE_URL_CONFIANCA", "ANVILORE_CONFIANCA_URL", "URL_CONFIANCA", "ANVILORE_CONFIANCA", "HTTPS_PROXY"];
    const antes = nomes.map(n => process.env[n]);
    for (const n of nomes) process.env[n] = "http://127.0.0.1:1/x.json";
    try {
      let url = "";
      await consultarConfianca(async u => { url = u; return new Response(valido()); });
      expect(url).toBe(URL_CONFIANCA);
    } finally { nomes.forEach((n, i) => { if (antes[i] === undefined) delete process.env[n]; else process.env[n] = antes[i]; }); }
  });

  test("Dado o módulo da consulta, Então o código não lê o ambiente", async () => {
    const fonte = await readFile(resolve(import.meta.dir, "../src/lib/confianca.ts"), "utf8");
    expect(fonte).not.toMatch(/process\.env|Bun\.env/);
  });
});

describe("confianca.json: interseção com as chaves ancoradas", () => {
  async function duasChaves() {
    const a = await criarChave(await mkdtemp(join(tmpdir(), "anvilore-confianca-a-")));
    const b = await criarChave(await mkdtemp(join(tmpdir(), "anvilore-confianca-b-")));
    pastas.push(a.chave.replace(/\/[^/]+$/, ""), b.chave.replace(/\/[^/]+$/, ""));
    return { a, b };
  }

  test("Dado uma linha de allowed_signers, Quando calculo a fingerprint, Então é a mesma que o ssh-keygen -lf mostra", async () => {
    const { a, b } = await duasChaves();
    expect(fingerprintsDaLinha(a.assinantes.trim())).toBe(a.fingerprint);
    expect(fingerprintsDaLinha(b.assinantes.trim())).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(b.fingerprint);
    // com opções antes da chave e comentário depois
    const chave = a.assinantes.trim().split(/\s+/).slice(-2).join(" ");
    expect(fingerprintsDaLinha(`iago@exemplo.com valid-after="20260101" namespaces="git,file" ${chave} comentário qualquer`)).toBe(a.fingerprint);
  });

  test("Dado linha sem chave reconhecível, comentário ou linha em branco, Quando calculo a fingerprint, Então não há fingerprint", () => {
    for (const linha of ["", "# comentário", "só texto", "iago ssh-ed25519", "iago ssh-ed25519 não_é_base64!"]) expect(fingerprintsDaLinha(linha)).toBeUndefined();
  });

  test("Dado allowed_signers com duas chaves, Quando filtro pela lista, Então ficam só as linhas cuja fingerprint está na lista", async () => {
    const { a, b } = await duasChaves();
    const texto = `# âncoras\n${a.assinantes}\n${b.assinantes}`;
    expect(filtrarAssinantes(texto, [a.fingerprint])).toBe(a.assinantes);
    expect(filtrarAssinantes(texto, [b.fingerprint, FP])).toBe(b.assinantes);
    expect(filtrarAssinantes(texto, [a.fingerprint, b.fingerprint])).toBe(a.assinantes + b.assinantes);
  });

  test("Dado uma lista do site com chave que não está nas âncoras, Quando filtro, Então o site não acrescenta chave: interseção vazia", async () => {
    const { a, b } = await duasChaves();
    expect(filtrarAssinantes(a.assinantes, [b.fingerprint])).toBe("");
    expect(filtrarAssinantes(a.assinantes, [])).toBe("");
  });
});
