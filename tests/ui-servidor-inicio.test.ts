import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { iniciarServidorUi } from "../src/ui/servidor/servidor";
import { PonteFalsa } from "./apoio/ponte-falsa";

let raiz: string;
let servidores: Array<{ stop: (forcibly?: boolean) => void }> = [];
beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "anvilore-ui-inicio-"));
  for (const dir of ["wiki/pessoal/concepts", "wiki/log", "raw/pessoal"]) mkdirSync(join(raiz, dir), { recursive: true });
  writeFileSync(join(raiz, "wiki/index.md"), "# Índice\n");
});
afterEach(() => { for (const servidor of servidores) servidor.stop(true); servidores = []; rmSync(raiz, { recursive: true, force: true }); });

async function servidor() {
  const app = await iniciarServidorUi(raiz, { portaInicial: 0, token: "token-teste", abrirNavegador: false, ponte: new PonteFalsa() });
  servidores.push(app.servidor);
  const base = `http://127.0.0.1:${app.porta}`;
  return { base, chamar: (rota: string, init: RequestInit = {}) => fetch(`${base}${rota}?token=token-teste`, { ...init, headers: { origin: base, ...(init.headers as Record<string, string> | undefined) } }) };
}

const rascunho = (slug: string) => `---\ntype: concept\nslug: ${slug}\ntitle: ${slug}\ngenerated:\n  by: agente/teste\n  at: 2026-10-27T10:00:00Z\n---\nTexto.\n`;

test("Dado a interface local Quando peço o Início ou a saúde sem token ou com Host externo Então recebo 403", async () => {
  const { base } = await servidor();
  for (const rota of ["/api/inicio", "/api/saude"]) {
    expect((await fetch(`${base}${rota}`)).status).toBe(403);
    expect((await fetch(`${base}${rota}?token=token-teste`, { headers: { host: "exemplo.test" } })).status).toBe(403);
  }
});

test("Dado rascunho, log, fonte solta e conversa aberta Quando abro o Início Então a API traz cada bloco", async () => {
  writeFileSync(join(raiz, "wiki/pessoal/concepts/novo.md"), rascunho("novo"));
  writeFileSync(join(raiz, "wiki/log/log-2026-10-29.md"), "## [2026-10-29] ingest | Chegou uma fonte\n");
  writeFileSync(join(raiz, "raw/pessoal/solta.md"), "texto");
  const { chamar } = await servidor();
  const corpo = await (await chamar("/api/inicio")).json() as Record<string, unknown>;
  expect(corpo).toMatchObject({
    agente: "Agente falso",
    areas: ["pessoal"],
    rascunhos: { total: 1, novas: 1, itens: [{ caminho: "pessoal/concepts/novo.md", status: "nova" }] },
    atividade: [{ data: "2026-10-29", tipo: "ingest", resumo: "Chegou uma fonte" }],
    fontes: [{ caminho: "raw/pessoal/solta.md", area: "pessoal", bytes: 5 }],
    conversas: [],
  });
});

test("Dado conversa de ingestão em andamento Quando abro o Início Então a fonte dela aparece com o id e a conversa é listada", async () => {
  writeFileSync(join(raiz, "raw/pessoal/em-curso.md"), "x");
  const { chamar } = await servidor();
  const dados = new FormData();
  dados.append("area", "pessoal");
  dados.append("texto", "conteúdo colado");
  const criada = await (await chamar("/api/fontes", { method: "POST", body: dados })).json() as { id: string; fonte: string };
  const corpo = await (await chamar("/api/inicio")).json() as { conversas: { id: string }[]; fontes: { caminho: string; conversa?: string }[] };
  expect(corpo.conversas.map(c => c.id)).toEqual([criada.id]);
  expect(corpo.fontes.find(f => f.caminho === criada.fonte)?.conversa).toBe(criada.id);
  expect(corpo.fontes.find(f => f.caminho === "raw/pessoal/em-curso.md")?.conversa).toBeUndefined();
});

test("Dado página gerada sem aprovação Quando peço a saúde Então validar reprova pelo portão, sem pedir comando", async () => {
  writeFileSync(join(raiz, "wiki/pessoal/concepts/novo.md"), rascunho("novo"));
  writeFileSync(join(raiz, "wiki/index.md"), "# Índice\n\n- [[novo]]\n");
  const { chamar } = await servidor();
  const resposta = await chamar("/api/saude");
  expect(resposta.status).toBe(200);
  const saude = await resposta.json() as { validar: { ok: boolean; semAprovacao: number }; lacunas: { total: number } };
  expect(saude.validar).toMatchObject({ ok: false, semAprovacao: 1 });
  expect(saude.lacunas.total).toBe(0);
  expect(JSON.stringify(saude)).not.toContain("bun src/cli.ts");
});

test("Dado o Início Quando envio POST ou rota desconhecida Então 404, sem rodar nada", async () => {
  const { chamar } = await servidor();
  expect((await chamar("/api/inicio", { method: "POST" })).status).toBe(404);
  expect((await chamar("/api/saude", { method: "POST" })).status).toBe(404);
});
