import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { iniciarServidorUi } from "../src/ui/servidor/servidor";
import { PonteFalsa } from "./apoio/ponte-falsa";
import { SESSAO } from "./apoio/eventos-claude";
import type { EventoDoAgente, FimDaFase } from "../src/lib/ponte-agente";
import type { Conversa } from "../src/lib/ui-ingestao";

// Classe fechada aqui: toda página que um ajuste deixa com bytes diferentes dos da versão aprovada tem de
// terminar pendente de revisão, conferida pelas mesmas rotas que a pessoa usa (fila e Biblioteca).
// Quando o texto não pode ser consertado com segurança, a página volta à cópia-base.

const CAMINHO = "pessoal/concepts/segundo-cerebro.md";

const APROVADA = [
  "---", "type: concept", "slug: segundo-cerebro", "title: Segundo cérebro",
  "generated:", "  by: claude-opus/2026-10", "  at: 2026-10-26T14:35:00-03:00",
  "verified:", "  by: human:iago", "  at: 2026-10-26T14:36:00-03:00",
  "---", "", "Texto original aprovado.",
].join("\n");

const CORPO_ALTERADO = "Texto alterado sem revisão.";

function versaoAlterada(geracao: string[] | null): string {
  return [
    "---", "type: concept", "slug: segundo-cerebro", "title: Segundo cérebro",
    ...(geracao ?? []),
    "verified:", "  by: human:iago", "  at: 2026-10-26T14:36:00-03:00",
    "---", "", CORPO_ALTERADO,
  ].join("\n");
}

type Variante = { nome: string; conteudo: string; esperado: "pendente" | "restaurada" };

const VARIANTES: Variante[] = [
  { nome: "sem o bloco generated", conteudo: versaoAlterada(null), esperado: "pendente" },
  { nome: "generated com at inválido", conteudo: versaoAlterada(["generated:", "  by: claude-haiku/2.1", "  at: ontem à tarde"]), esperado: "pendente" },
  { nome: "generated sem at", conteudo: versaoAlterada(["generated:", "  by: claude-haiku/2.1"]), esperado: "pendente" },
  { nome: "generated escalar", conteudo: versaoAlterada(["generated: rascunho"]), esperado: "pendente" },
  { nome: "generated mais antigo que a aprovação", conteudo: versaoAlterada(["generated:", "  by: claude-haiku/2.1", "  at: 2026-10-26T14:00:00-03:00"]), esperado: "pendente" },
  { nome: "sem frontmatter", conteudo: `${CORPO_ALTERADO}\n`, esperado: "restaurada" },
];

type Desfecho = "cancelada" | "falhou" | "concluida" | "rejeitada";

let raiz: string;
let servidores: Array<{ stop: (forcibly?: boolean) => void }> = [];

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "anvilore-ui-ajuste-reconciliacao-"));
  for (const dir of ["wiki/pessoal/sources", "wiki/pessoal/concepts", "raw/pessoal"]) mkdirSync(join(raiz, dir), { recursive: true });
  writeFileSync(join(raiz, "wiki/index.md"), "# Índice\n");
});

afterEach(() => {
  for (const servidor of servidores) servidor.stop(true);
  servidores = [];
  rmSync(raiz, { recursive: true, force: true });
});

async function subirServidor(ponte = new PonteFalsa()) {
  const app = await iniciarServidorUi(raiz, { portaInicial: 0, token: "token-teste", abrirNavegador: false, ponte, fechar: async () => ({ codigo: 0, saida: "FECHAMENTO: OK" }) });
  servidores.push(app.servidor);
  const base = `http://127.0.0.1:${app.porta}`;
  const chamar = (rota: string, init: RequestInit = {}) =>
    fetch(`${base}${rota}?token=token-teste`, { ...init, headers: { origin: base, ...(init.headers as Record<string, string> | undefined) } });
  const postar = (rota: string, corpo: unknown) =>
    chamar(rota, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
  return { chamar, postar };
}

async function paginaNaFila(chamar: (rota: string) => Promise<Response>) {
  const fila = await (await chamar("/api/rascunhos")).json() as Array<{ caminho: string; status: string }>;
  return fila.find(item => item.caminho === CAMINHO);
}

async function statusNaBiblioteca(chamar: (rota: string) => Promise<Response>) {
  const resumo = await (await chamar("/api/biblioteca")).json() as { paginas: Array<{ caminho: string; status: string }> };
  return resumo.paginas.find(item => item.caminho === CAMINHO)?.status;
}

async function conferir(variante: Variante, chamar: (rota: string) => Promise<Response>) {
  const final = readFileSync(join(raiz, "wiki", CAMINHO), "utf8");
  if (variante.esperado === "restaurada") {
    expect(final).toBe(APROVADA);
    expect(await statusNaBiblioteca(chamar)).toBe("aprovada");
    return;
  }
  expect(final).toContain(CORPO_ALTERADO);
  expect(await paginaNaFila(chamar)).toMatchObject({ caminho: CAMINHO, status: "atualizada" });
  expect(await statusNaBiblioteca(chamar)).toBe("rascunho");
}

async function rodarAjuste(variante: Variante, desfecho: Desfecho) {
  writeFileSync(join(raiz, "wiki", CAMINHO), APROVADA);
  const escritor = async (aoEvento: (evento: EventoDoAgente) => void): Promise<FimDaFase> => {
    aoEvento({ tipo: "inicio", sessao: SESSAO, autor: "claude-haiku/2.1.311" });
    aoEvento({ tipo: "ferramenta", id: "w1", nome: "Edit", caminho: join(raiz, "wiki", CAMINHO) });
    writeFileSync(join(raiz, "wiki", CAMINHO), variante.conteudo);
    aoEvento({ tipo: "resultado-ferramenta", id: "w1", erro: false, texto: "Editado" });
    if (desfecho === "rejeitada") throw new Error("stream corrompido");
    if (desfecho === "falhou") return { situacao: "falhou", erro: "falha do escritor", recusas: [] };
    if (desfecho === "cancelada") return { situacao: "cancelada", recusas: [] };
    return { situacao: "concluida", sessao: SESSAO, texto: "Ajuste feito", recusas: [] };
  };
  const { chamar, postar } = await subirServidor(new PonteFalsa({ escritor: async (_pedido, aoEvento) => escritor(aoEvento) }));
  const resposta = await postar("/api/ajuste", { caminho: CAMINHO, versao: createHash("sha256").update(APROVADA).digest("hex"), pedido: "Ajuste o texto" });
  expect(resposta.status).toBe(201);
  const { id } = await resposta.json() as { id: string };
  let conversa: Conversa | undefined;
  for (let i = 0; i < 40; i++) {
    conversa = await (await chamar(`/api/conversas/${id}`)).json() as Conversa;
    if (conversa.situacao !== "rodando") break;
    await new Promise(r => setTimeout(r, 50));
  }
  return { chamar, conversa };
}

describe("Ajuste: página alterada sempre termina pendente de revisão", () => {
  for (const desfecho of ["cancelada", "falhou", "concluida", "rejeitada"] as const) {
    for (const variante of VARIANTES) {
      test(`Dado ajuste ${desfecho} que deixa a página aprovada ${variante.nome} Então a página ${variante.esperado === "pendente" ? "está pendente na fila e é rascunho na Biblioteca" : "volta à cópia-base aprovada"}`, async () => {
        const { chamar, conversa } = await rodarAjuste(variante, desfecho);
        expect(conversa?.situacao).not.toBe("rodando");
        await conferir(variante, chamar);
      });
    }
  }

  for (const variante of VARIANTES) {
    test(`Dado ajuste interrompido e persistido como rodando com a página aprovada ${variante.nome} Quando o servidor inicia Então a primeira rota já a encontra conforme o desenho`, async () => {
      writeFileSync(join(raiz, "wiki", CAMINHO), variante.conteudo);
      const id = "ajuste-interrompido-reconciliacao";
      mkdirSync(join(raiz, ".anvilore/ui/copias", id, "pessoal/concepts"), { recursive: true });
      writeFileSync(join(raiz, ".anvilore/ui/copias", id, CAMINHO), APROVADA);
      mkdirSync(join(raiz, ".anvilore/ui/conversas"), { recursive: true });
      writeFileSync(join(raiz, ".anvilore/ui/conversas", `${id}.json`), JSON.stringify({
        versao: 1, id, criadaEm: "2026-11-07T00:00:00.000Z", atualizadaEm: "2026-11-07T00:00:00.000Z",
        tipo: "ajuste", pagina: CAMINHO, versaoEsperada: createHash("sha256").update(APROVADA).digest("hex"), pedido: "Ajustar",
        area: "pessoal", fonte: `wiki/${CAMINHO}`, nome: "segundo-cerebro.md", bytes: 1, passo: "escrita", situacao: "rodando",
        geracao: { by: "claude-haiku/2.1.311", at: "2026-11-07T00:00:00.000Z" }, atividade: [], avisos: [], recusas: [],
      }));
      const { chamar } = await subirServidor();
      await conferir(variante, chamar);
    });
  }

  test("Dado ajuste concluído sem mudar nenhum byte Então a aprovação e os bytes são preservados", async () => {
    writeFileSync(join(raiz, "wiki", CAMINHO), APROVADA);
    const ponte = new PonteFalsa({ escritor: async () => ({ situacao: "concluida", sessao: SESSAO, texto: "Nada a mudar", recusas: [] }) });
    const { chamar, postar } = await subirServidor(ponte);
    const { id } = await (await postar("/api/ajuste", { caminho: CAMINHO, versao: createHash("sha256").update(APROVADA).digest("hex"), pedido: "Ajuste" })).json() as { id: string };
    for (let i = 0; i < 40; i++) {
      const conversa = await (await chamar(`/api/conversas/${id}`)).json() as Conversa;
      if (conversa.situacao !== "rodando") break;
      await new Promise(r => setTimeout(r, 50));
    }
    expect(readFileSync(join(raiz, "wiki", CAMINHO), "utf8")).toBe(APROVADA);
    expect(await statusNaBiblioteca(chamar)).toBe("aprovada");
    expect(await paginaNaFila(chamar)).toBeUndefined();
  });
});
