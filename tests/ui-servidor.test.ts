import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { iniciarServidorUi } from "../src/ui/servidor/servidor";

let raiz: string;
let servidores: Array<{ stop: (forcibly?: boolean) => void }> = [];
beforeEach(() => { raiz = mkdtempSync(join(tmpdir(), "anvilore-ui-http-")); mkdirSync(join(raiz, "wiki/concepts"), { recursive: true }); });
afterEach(() => { for (const servidor of servidores) servidor.stop(true); servidores = []; rmSync(raiz, { recursive: true, force: true }); });

async function servidor(porta = 0) {
  const app = await iniciarServidorUi(raiz, { portaInicial: porta, token: "token-teste", abrirNavegador: false });
  servidores.push(app.servidor);
  return app;
}

function versaoAtual(caminho: string): string {
  try { return createHash("sha256").update(readFileSync(join(raiz, "wiki", caminho))).digest("hex"); }
  catch { return "0".repeat(64); }
}

function postAprovar(app: Awaited<ReturnType<typeof iniciarServidorUi>>, caminho: string, headers: Record<string, string> = {}, versao = versaoAtual(caminho)) {
  return fetch(`http://127.0.0.1:${app.porta}/api/aprovar?token=token-teste`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: `http://127.0.0.1:${app.porta}`, ...headers },
    body: JSON.stringify({ caminho, versao }),
  });
}

test("Dado página alterada depois de abrir a fila Quando aprovo a versão exibida Então recebo 409 sem aprovar o texto novo", async () => {
  const caminho = "concepts/alterada.md";
  const exibido = "---\ntype: concept\nslug: alterada\ntitle: Alterada\ngenerated:\n  by: agente/teste\n  at: 2026-10-27T10:00:00Z\n---\nTexto que revisei.\n";
  writeFileSync(join(raiz, "wiki", caminho), exibido);
  const app = await servidor();
  const fila = await (await fetch(`http://127.0.0.1:${app.porta}/api/rascunhos?token=token-teste`)).json() as Array<{ caminho: string; versao: string }>;
  writeFileSync(join(raiz, "wiki", caminho), exibido.replace("Texto que revisei.", "Texto novo que não revisei."));

  const resposta = await postAprovar(app, caminho, {}, fila[0]!.versao);
  expect(resposta.status).toBe(409);
  expect(await resposta.json()).toMatchObject({ mensagens: ["A página mudou desde que você abriu. Recarregue para revisar a versão nova."] });
  expect(readFileSync(join(raiz, "wiki", caminho), "utf8")).not.toContain("verified:");
});

test("Dado interface local ativa Quando acesso sem token Então recebe 403", async () => {
  const app = await servidor();
  const resposta = await fetch(`http://127.0.0.1:${app.porta}/api/rascunhos`);
  expect(resposta.status).toBe(403);
});

test("Dado token válido com Host externo Quando acesso a API Então recebe 403", async () => {
  const app = await servidor();
  const resposta = await fetch(`http://127.0.0.1:${app.porta}/api/rascunhos?token=token-teste`, { headers: { host: "exemplo.test" } });
  expect(resposta.status).toBe(403);
});

test("Dado rascunho no vault Quando consulto com token e Host local Então retorna a fila", async () => {
  writeFileSync(join(raiz, "wiki/concepts/ideia.md"), "---\ntype: concept\nslug: ideia\ntitle: Ideia\ngenerated:\n  by: agente/teste\n  at: 2026-10-27T10:00:00Z\n---\nIdeia.\n");
  const app = await servidor();
  const resposta = await fetch(`http://127.0.0.1:${app.porta}/api/rascunhos?token=token-teste`);
  expect(resposta.status).toBe(200);
  expect(await resposta.json()).toMatchObject([{ caminho: "concepts/ideia.md", status: "nova" }]);
});

test("Dado aprovação autorizada Quando envio a ação Então o servidor usa o domínio de aprovação", async () => {
  const arquivo = join(raiz, "wiki/concepts/aprovar.md");
  mkdirSync(join(raiz, ".anvilore"), { recursive: true });
  writeFileSync(join(raiz, ".anvilore/identidade"), "human:local\n");
  writeFileSync(arquivo, "---\ntype: concept\nslug: aprovar\ntitle: Aprovar\ngenerated:\n  by: agente/teste\n  at: 2026-10-27T10:00:00Z\n---\nCorpo.\n");
  const app = await servidor();
  const resposta = await postAprovar(app, "concepts/aprovar.md");
  expect(resposta.status).toBe(200);
  expect(await resposta.json()).toMatchObject({ codigo: 0 });
  expect(readFileSync(arquivo, "utf8")).toContain("by: human:local");
});

for (const caso of [
  { nome: "verified posterior de ator não humano", verified: "verified:\n  - by: agente/revisor\n    at: 2026-10-27T11:00:00Z\n" },
  { nome: "verified humano um nanossegundo anterior", verified: "verified:\n  - by: human:ana\n    at: 2026-10-27T10:00:00.000000001Z\n", generated: "2026-10-27T10:00:00.000000002Z" },
  { nome: "verified humano em flow YAML", verified: 'verified: [{by: "human:ana", at: 2026-10-27T09:00:00Z}]\n', generated: "2026-10-27T10:00:00Z" },
]) {
  test(`Dado ${caso.nome} Quando aprovo via HTTP Então a decisão coincide com a fila`, async () => {
    const arquivo = join(raiz, "wiki/concepts/consistente.md");
    mkdirSync(join(raiz, ".anvilore"), { recursive: true });
    writeFileSync(join(raiz, ".anvilore/identidade"), "human:local\n");
    writeFileSync(arquivo, `---\ntype: concept\nslug: consistente\ntitle: Consistente\ngenerated:\n  by: agente/teste\n  at: ${caso.generated ?? "2026-10-27T10:00:00Z"}\n${caso.verified}---\nCorpo.\n`);
    const app = await servidor();
    const resposta = await postAprovar(app, "concepts/consistente.md");
    expect(resposta.status).toBe(200);
    expect(readFileSync(arquivo, "utf8")).toContain("by: human:local");
  });
}

test("Dado wiki válida Quando peço Tudo revisado Então roda validar e devolve saída e código reais", async () => {
  writeFileSync(join(raiz, "wiki/index.md"), "# Wiki\n");
  const app = await servidor();
  const resposta = await fetch(`http://127.0.0.1:${app.porta}/api/validar?token=token-teste`, { method: "POST", headers: { origin: `http://127.0.0.1:${app.porta}` } });
  expect(resposta.status).toBe(200);
  expect(await resposta.json()).toMatchObject({ codigo: 0, saida: expect.stringContaining("VALIDACAO: PASS") });
});

test("Dado porta inicial e seguinte ocupadas Quando inicio Então escuta em qualquer porta livre", async () => {
  let ocupada: ReturnType<typeof Bun.serve> | undefined;
  let vizinha: ReturnType<typeof Bun.serve> | undefined;
  for (let tentativa = 0; tentativa < 20 && !vizinha; tentativa++) {
    const candidata = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ocupada") });
    try {
      const proxima = Bun.serve({ hostname: "127.0.0.1", port: candidata.port! + 1, fetch: () => new Response("também ocupada") });
      ocupada = candidata; vizinha = proxima;
    } catch { candidata.stop(true); }
  }
  expect(ocupada).toBeDefined();
  expect(vizinha).toBeDefined();
  servidores.push(ocupada!, vizinha!);
  const app = await servidor(ocupada!.port!);
  expect([ocupada!.port, vizinha!.port]).not.toContain(app.porta);
  expect((await fetch(`http://127.0.0.1:${app.porta}`)).status).toBe(403);
});

test("Dado inicialização padrão Quando o servidor sobe Então abre URL de loopback com token", async () => {
  let aberta = "";
  const app = await iniciarServidorUi(raiz, { portaInicial: 0, token: "token-teste", abrir: url => { aberta = url; } });
  servidores.push(app.servidor);
  expect(app.servidor.hostname).toBe("127.0.0.1");
  expect(aberta).toBe(`http://127.0.0.1:${app.porta}/?token=token-teste`);
});

test("Dado abertura padrão no Linux Quando inicio a interface Então usa xdg-open para a URL local", async () => {
  const bun = Bun as unknown as { spawn: (...args: unknown[]) => unknown };
  const original = bun.spawn;
  let comando: unknown;
  bun.spawn = ((args: unknown) => { comando = args; return {}; }) as typeof bun.spawn;
  try {
    const app = await iniciarServidorUi(raiz, { portaInicial: 0, token: "token-teste" });
    servidores.push(app.servidor);
    expect(comando).toEqual(["xdg-open", app.url]);
  } finally { bun.spawn = original; }
});

test("Dado rota local desconhecida Quando consulto Então recebe 404", async () => {
  const app = await servidor();
  expect((await fetch(`http://127.0.0.1:${app.porta}/rota-inexistente?token=token-teste`)).status).toBe(404);
});

test("Dado interface autorizada Quando carrego a página e os assets Então o token segue na URL", async () => {
  const app = await servidor();
  const pagina = await fetch(app.url);
  expect(pagina.status).toBe(200);
  expect(await pagina.text()).toContain('content="token-teste"');
  const css = await fetch(`http://127.0.0.1:${app.porta}/assets/main.css?token=token-teste`);
  expect(css.status).toBe(200);
  expect(css.headers.get("content-type")).toContain("text/css");
});

test("Dado requisição do favicon local Quando o navegador pede o ícone Então responde sem erro", async () => {
  const app = await servidor();
  expect((await fetch(`http://127.0.0.1:${app.porta}/favicon.ico`)).status).toBe(204);
});

test("Dado página válida Quando faço POST sem token ou com Host externo Então recebo 403 sem gravar aprovação", async () => {
  const arquivo = join(raiz, "wiki/concepts/sem-autorizacao.md");
  const original = "---\ntype: concept\nslug: sem-autorizacao\ntitle: Sem autorização\ngenerated:\n  by: agente/teste\n  at: 2026-10-27T10:00:00Z\n---\nCorpo.\n";
  writeFileSync(arquivo, original);
  const app = await servidor();
  const url = `http://127.0.0.1:${app.porta}/api/aprovar`;
  const semToken = await fetch(url, { method: "POST", headers: { "content-type": "application/json", origin: `http://127.0.0.1:${app.porta}` }, body: JSON.stringify({ caminho: "concepts/sem-autorizacao.md" }) });
  expect(semToken.status).toBe(403);
  const hostErrado = await fetch(`${url}?token=token-teste`, { method: "POST", headers: { "content-type": "application/json", origin: `http://127.0.0.1:${app.porta}`, host: "evil.test" }, body: JSON.stringify({ caminho: "concepts/sem-autorizacao.md" }) });
  expect(hostErrado.status).toBe(403);
  expect(readFileSync(arquivo, "utf8")).toBe(original);
});

test("Dado caminhos fora da fila Quando tento aprovar ../, raw e symlink Então recusa sem alterar os arquivos", async () => {
  const raw = join(raiz, "raw/segredo.md");
  const fora = join(raiz, "fora.md");
  const alvo = join(raiz, "fora/concepts/symlink.md");
  const rawOriginal = "raw intocado\n";
  const foraOriginal = "fora intocado\n";
  mkdirSync(join(raiz, "raw"), { recursive: true });
  mkdirSync(join(raiz, "fora/concepts"), { recursive: true });
  mkdirSync(join(raiz, "wiki/atalho"), { recursive: true });
  writeFileSync(raw, rawOriginal); writeFileSync(fora, foraOriginal); writeFileSync(alvo, foraOriginal);
  symlinkSync(join(raiz, "fora/concepts"), join(raiz, "wiki/atalho/concepts"), "junction");
  const app = await servidor();
  for (const caminho of ["../raw/segredo.md", "raw/segredo.md", "atalho/concepts/symlink.md", fora]) {
    expect((await postAprovar(app, caminho)).status).toBe(409);
  }
  expect(readFileSync(raw, "utf8")).toBe(rawOriginal);
  expect(readFileSync(fora, "utf8")).toBe(foraOriginal);
  expect(readFileSync(alvo, "utf8")).toBe(foraOriginal);
});

test("Dado Origin externo Quando envio POST de aprovação Então recusa e não altera a página", async () => {
  const arquivo = join(raiz, "wiki/concepts/csrf.md");
  const original = "---\ntype: concept\nslug: csrf\ntitle: CSRF\ngenerated:\n  by: agente/teste\n  at: 2026-10-27T10:00:00Z\n---\nCorpo.\n";
  writeFileSync(arquivo, original);
  const app = await servidor();
  expect((await postAprovar(app, "concepts/csrf.md", { origin: "http://evil.test" })).status).toBe(403);
  expect(readFileSync(arquivo, "utf8")).toBe(original);
});

test("Dado asset ausente Quando acesso a interface Então recebo 404 sem instrução de desenvolvimento", async () => {
  const app = await servidor();
  const resposta = await fetch(`http://127.0.0.1:${app.porta}/assets/inexistente.js?token=token-teste`);
  expect(resposta.status).toBe(404);
  expect(await resposta.text()).not.toContain("bun run");
});

test("Dado qualquer resposta local Quando o navegador recebe cabeçalhos Então a política não vaza Referer", async () => {
  const app = await servidor();
  const resposta = await fetch(app.url);
  expect(resposta.headers.get("referrer-policy")).toBe("no-referrer");
});

test("Dado página com cópia anterior real Quando listo rascunhos Então a API devolve seu conteúdo", async () => {
  writeFileSync(join(raiz, "wiki/concepts/com-copia.md"), "---\ntype: concept\nslug: com-copia\ntitle: Com cópia\ngenerated:\n  by: agente/teste\n  at: 2026-10-27T10:00:00Z\n---\nDepois.\n");
  const copia = join(raiz, ".anvilore/ui/copias/sessao-1/concepts/com-copia.md");
  mkdirSync(join(copia, ".."), { recursive: true });
  writeFileSync(copia, "Antes.\n");
  const app = await servidor();
  const resposta = await fetch(`http://127.0.0.1:${app.porta}/api/rascunhos?token=token-teste`);
  expect(await resposta.json()).toMatchObject([{ caminho: "concepts/com-copia.md", anterior: "Antes.\n" }]);
});

test("Dado servidor encerrado Quando inicio outra escuta na mesma porta Então a porta está livre", async () => {
  const app = await servidor();
  const porta = app.porta;
  app.servidor.stop(true);
  const novo = Bun.serve({ hostname: "127.0.0.1", port: porta, fetch: () => new Response("livre") });
  servidores.push(novo);
  expect((await fetch(`http://127.0.0.1:${porta}`)).status).toBe(200);
});
