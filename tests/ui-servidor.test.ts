import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  const resposta = await fetch(`http://127.0.0.1:${app.porta}/api/aprovar?token=token-teste`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ caminho: "concepts/aprovar.md" }) });
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
    const resposta = await fetch(`http://127.0.0.1:${app.porta}/api/aprovar?token=token-teste`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ caminho: "concepts/consistente.md" }) });
    expect(resposta.status).toBe(200);
    expect(readFileSync(arquivo, "utf8")).toContain("by: human:local");
  });
}

test("Dado wiki válida Quando peço Tudo revisado Então roda validar e devolve saída e código reais", async () => {
  writeFileSync(join(raiz, "wiki/index.md"), "# Wiki\n");
  const app = await servidor();
  const resposta = await fetch(`http://127.0.0.1:${app.porta}/api/validar?token=token-teste`, { method: "POST" });
  expect(resposta.status).toBe(200);
  expect(await resposta.json()).toMatchObject({ codigo: 0, saida: expect.stringContaining("VALIDACAO: PASS") });
});

test("Dado porta inicial ocupada Quando inicio a interface Então escolhe a próxima porta", async () => {
  const ocupada = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ocupada") });
  servidores.push(ocupada);
  const portaOcupada = ocupada.port!;
  const app = await servidor(portaOcupada);
  expect(app.porta).toBe(portaOcupada + 1);
});

test("Dado inicialização padrão Quando o servidor sobe Então abre URL de loopback com token", async () => {
  let aberta = "";
  const app = await iniciarServidorUi(raiz, { portaInicial: 0, token: "token-teste", abrir: url => { aberta = url; } });
  servidores.push(app.servidor);
  expect(app.servidor.hostname).toBe("127.0.0.1");
  expect(aberta).toBe(`http://127.0.0.1:${app.porta}/?token=token-teste`);
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

test("Dado servidor encerrado Quando inicio outra escuta na mesma porta Então a porta está livre", async () => {
  const app = await servidor();
  const porta = app.porta;
  app.servidor.stop(true);
  const novo = Bun.serve({ hostname: "127.0.0.1", port: porta, fetch: () => new Response("livre") });
  servidores.push(novo);
  expect((await fetch(`http://127.0.0.1:${porta}`)).status).toBe(200);
});
