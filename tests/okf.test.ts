import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  classificarRecurso,
  problemaDoRecurso,
  validarProveniencia,
  validarRecurso,
} from "../src/lib/okf";

let raiz: string;

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "anvilore-okf-"));
});
afterEach(() => {
  rmSync(raiz, { recursive: true, force: true });
});

function gravar(relativo: string, conteudo = "bruto\n"): void {
  const caminho = join(raiz, relativo);
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, conteudo);
}

describe("classificarRecurso", () => {
  test("Dado um valor com esquema de URI, Quando classifico, Então é url e a barra não decide", () => {
    expect(classificarRecurso("https://example.com/doc.pdf")).toBe("url");
    expect(classificarRecurso("ftp://example.com/doc.pdf")).toBe("url");
    expect(classificarRecurso("mailto:a@b.c")).toBe("url");
    expect(classificarRecurso("file:///etc/passwd")).toBe("url");
    expect(classificarRecurso("https://example.com/a b.md")).toBe("url");
  });

  test("Dado a letra de unidade do Windows, Quando classifico, Então vira url de propósito", () => {
    expect(classificarRecurso("C:\\notas.md")).toBe("url");
  });

  test("Dado um valor com barra ou terminado em extensão, Quando classifico, Então é caminho", () => {
    expect(classificarRecurso("raw/x.md")).toBe("caminho");
    expect(classificarRecurso("2026/Q3")).toBe("caminho");
    expect(classificarRecurso("notas.md")).toBe("caminho");
    expect(classificarRecurso("raw/notas do dia")).toBe("caminho");
    expect(classificarRecurso("rw meetings x.md")).toBe("caminho");
  });

  test("Dado um valor sem barra e sem extensão, Quando classifico, Então é descritor", () => {
    expect(classificarRecurso("todas as sessões de 2026")).toBe("descritor");
    expect(classificarRecurso("slack")).toBe("descritor");
    expect(classificarRecurso("2026")).toBe("descritor");
    expect(classificarRecurso("rw meetings x")).toBe("descritor");
  });

  test("Dado uma extensão que não começa por letra, Quando classifico, Então v2.0 continua descritor", () => {
    expect(classificarRecurso("v2.0")).toBe("descritor");
  });

  test("Dado um caminho com espaço, Quando classifico, Então o espaço não muda a forma", () => {
    expect(classificarRecurso("raw/meetings/notas de reuniao.md")).toBe("caminho");
    expect(classificarRecurso("raw/2026 Q3/notas.md")).toBe("caminho");
  });
});

describe("validarRecurso", () => {
  test("Dado um caminho que existe na raiz, Quando valido, Então aprova", () => {
    gravar("raw/existe.md");
    expect(validarRecurso("raw/existe.md", raiz)).toBe(true);
    expect(problemaDoRecurso("raw/existe.md", raiz)).toBeNull();
  });

  test("Dado um caminho inexistente, Quando valido, Então reprova e o motivo diz inexistente", () => {
    expect(validarRecurso("raw/nao/existe.md", raiz)).toBe(false);
    expect(problemaDoRecurso("raw/nao/existe.md", raiz)).toContain("inexistente");
  });

  test("Dado um caminho com espaço que existe, Quando valido, Então aprova", () => {
    gravar("raw/notas do dia.md");
    expect(validarRecurso("raw/notas do dia.md", raiz)).toBe(true);
  });

  test("Dado um caminho com espaço que não existe, Quando valido, Então reprova", () => {
    expect(validarRecurso("raw/reuniao sem arquivo.md", raiz)).toBe(false);
  });

  test("Dado um diretório existente, Quando valido, Então aprova: a regra checa existência, não tipo", () => {
    mkdirSync(join(raiz, "raw", "dir-existente"), { recursive: true });
    expect(validarRecurso("raw/dir-existente", raiz)).toBe(true);
  });

  test("Dado um descritor ou uma url, Quando valido, Então não é checado e aprova", () => {
    expect(validarRecurso("todas as sessões de 2026", raiz)).toBe(true);
    expect(validarRecurso("https://example.com/x", raiz)).toBe(true);
  });

  test("Dado um caminho que sai da raiz, Quando valido, Então reprova dizendo que está fora da raiz", () => {
    expect(problemaDoRecurso("../README.md", raiz)).toContain("fora da raiz");
    expect(problemaDoRecurso("raw/../../etc/passwd", raiz)).toContain("fora da raiz");
    expect(problemaDoRecurso("/etc", raiz)).toContain("fora da raiz");
  });

  test("Dado um caminho que sobe e volta sem sair da raiz, Quando valido, Então a existência decide", () => {
    gravar("raw/existe.md");
    expect(validarRecurso("raw/../raw/existe.md", raiz)).toBe(true);
    expect(validarRecurso("./raw/existe.md", raiz)).toBe(true);
  });
});

function avaliar(frontmatter: Record<string, unknown>, agora = new Date("2026-10-24T12:00:00Z")) {
  return validarProveniencia(frontmatter, "pagina.md", raiz, agora);
}

const completo = {
  sources: [
    {
      id: "fonte-teste",
      resource: "https://example.com/fonte",
      author: "human:autor",
      last_modified: "2026-09-03T10:00:00-03:00",
    },
  ],
  generated: { by: "process:anvilore-ingest", at: "2026-09-03T10:30:00-03:00" },
  verified: [{ by: "human:revisor", at: "2026-09-03T11:00:00-03:00" }],
  stale_after: "2099-09-03T00:00:00-03:00",
};

describe("validarProveniencia: formato", () => {
  test("Dado o perfil completo bem formado, Quando valido, Então não há erro nem métrica", () => {
    expect(avaliar(completo)).toEqual({ erros: [], vencida: false, geradaAposVerificacao: false });
  });

  test("Dado nenhum campo de proveniência, Quando valido, Então a ausência nunca reprova", () => {
    expect(avaliar({ title: "T" })).toEqual({ erros: [], vencida: false, geradaAposVerificacao: false });
  });

  test("Dado campos de proveniência nulos, Quando valido, Então contam como ausentes", () => {
    expect(avaliar({ sources: null, generated: null, verified: null, stale_after: null }).erros).toEqual([]);
  });

  test("Dado sources que não é lista, Quando valido, Então reprova nomeando o arquivo e o campo", () => {
    const [erro] = avaliar({ sources: "x" }).erros;
    expect(erro).toContain("sources deve ser lista");
    expect(erro).toContain("pagina.md");
  });

  test("Dado uma entrada de sources que não é mapping, Quando valido, Então reprova nomeando o índice", () => {
    expect(avaliar({ sources: ["texto"] }).erros[0]).toContain("sources[0] deve ser mapping");
  });

  test("Dado uma entrada de sources sem resource, Quando valido, Então reprova", () => {
    const [erro] = avaliar({ sources: [{ author: "human:autor" }] }).erros;
    expect(erro).toContain("sources[0] sem resource");
    expect(erro).toContain("pagina.md");
  });

  test("Dado resource que não é texto nem número, Quando valido, Então reprova em vez de quebrar", () => {
    expect(avaliar({ sources: [{ resource: { a: 1 } }] }).erros[0]).toContain("sources[0].resource deve ser texto");
  });

  test("Dado resource numérico, Quando valido, Então é o descritor 2026 e aprova", () => {
    expect(avaliar({ sources: [{ resource: 2026 }] }).erros).toEqual([]);
  });

  test("Dado resource com caminho inexistente, Quando valido, Então reprova nomeando o arquivo e o caminho", () => {
    const [erro] = avaliar({ sources: [{ resource: "raw/nao/existe.md" }] }).erros;
    expect(erro).toContain("sources[].resource inexistente");
    expect(erro).toContain("pagina.md");
    expect(erro).toContain("raw/nao/existe.md");
  });

  test("Dado resource que sai da raiz, Quando valido, Então reprova dizendo fora da raiz", () => {
    expect(avaliar({ sources: [{ resource: "../fora.md" }] }).erros[0]).toContain("fora da raiz do repositorio");
  });

  test("Dado resource com caminho que existe, Quando valido, Então aprova", () => {
    gravar("raw/notas do dia.md");
    expect(avaliar({ sources: [{ resource: "raw/notas do dia.md" }] }).erros).toEqual([]);
  });

  test("Dado author fora da convenção, Quando valido, Então reprova citando o campo", () => {
    const [erro] = avaliar({ sources: [{ resource: "slack", author: "ninguem" }] }).erros;
    expect(erro).toContain("sources[0].author");
    expect(erro).toContain("fora da convencao de atores");
  });

  test("Dado author que não é texto, Quando valido, Então reprova em vez de quebrar", () => {
    expect(avaliar({ sources: [{ resource: "slack", author: 7 }] }).erros[0]).toContain("fora da convencao de atores");
  });

  test("Dado os três formatos de ator válidos, Quando valido, Então aprovam", () => {
    for (const ator of ["human:iago", "process:anvilore-ingest", "claude-opus/2026-09"]) {
      expect(avaliar({ verified: { by: ator } }).erros).toEqual([]);
    }
  });

  test("Dado last_modified sem offset, Quando valido, Então reprova citando o campo", () => {
    const [erro] = avaliar({ sources: [{ resource: "slack", last_modified: "2026-09-03" }] }).erros;
    expect(erro).toContain("sources[0].last_modified");
    expect(erro).toContain("sem offset explicito");
  });

  test("Dado generated sem by, Quando valido, Então reprova citando generated", () => {
    expect(avaliar({ generated: { at: "2026-09-03T10:30:00-03:00" } }).erros[0]).toContain("generated sem by");
  });

  test("Dado generated.by fora da convenção, Quando valido, Então reprova citando generated", () => {
    const [erro] = avaliar({ generated: { by: "nao-e-ator-valido" } }).erros;
    expect(erro).toContain("generated.by");
    expect(erro).toContain("pagina.md");
  });

  test("Dado generated.at sem offset, Quando valido, Então reprova", () => {
    expect(avaliar({ generated: { by: "process:x", at: "2026-09-03" } }).erros[0]).toContain("generated.at sem offset");
  });

  test("Dado generated como data escalar legada, Quando valido, Então é ignorado", () => {
    expect(avaliar({ generated: "2026-10-24" })).toEqual({ erros: [], vencida: false, geradaAposVerificacao: false });
  });

  test("Dado verified sem by, Quando valido, Então reprova citando verified", () => {
    expect(avaliar({ verified: [{ at: "2026-09-03T11:00:00-03:00" }] }).erros[0]).toContain("verified[0] sem by");
  });

  test("Dado verified que é um único mapping, Quando valido, Então é aceito como lista de um", () => {
    expect(avaliar({ verified: { by: "human:iago", at: "2026-09-03T11:00:00-03:00" } }).erros).toEqual([]);
  });

  test("Dado verified que é texto, Quando valido, Então reprova", () => {
    expect(avaliar({ verified: "sim" }).erros[0]).toContain("verified deve ser mapping ou lista");
  });

  test("Dado uma entrada de verified que não é mapping, Quando valido, Então reprova nomeando o índice", () => {
    expect(avaliar({ verified: ["sim"] }).erros[0]).toContain("verified[0] deve ser mapping");
  });

  test("Dado verified[].by e at inválidos, Quando valido, Então reprova os dois", () => {
    const { erros } = avaliar({ verified: [{ by: "x", at: "ontem" }] });
    expect(erros.join("\n")).toContain("verified[0].by");
    expect(erros.join("\n")).toContain("verified[0].at");
  });

  test("Dado stale_after só com data, Quando valido, Então reprova citando stale_after", () => {
    const [erro] = avaliar({ stale_after: "2027-09-03" }).erros;
    expect(erro).toContain("stale_after");
    expect(erro).toContain("sem offset explicito");
  });

  test("Dado timestamp com formato certo e dia fora do calendário, Quando valido, Então reprova em vez de ignorar", () => {
    const [erro] = avaliar({ stale_after: "2026-02-30T00:00:00-03:00" }).erros;
    expect(erro).toContain("stale_after");
    expect(erro).toContain("data invalida");
  });

  test("Dado hora, minuto ou offset fora da faixa, Quando valido, Então reprova", () => {
    for (const ts of ["2026-09-03T24:00:00-03:00", "2026-09-03T10:60:00-03:00", "2026-09-03T10:00:60-03:00", "2026-13-03T10:00:00-03:00", "2026-09-03T10:00:00-24:00", "2026-09-03T10:00:00-03:60", "2026-00-10T10:00:00-03:00", "2026-04-31T10:00:00-03:00"]) {
      expect(avaliar({ stale_after: ts }).erros[0]).toContain("data invalida");
    }
  });

  test("Dado fevereiro de ano bissexto e o separador de espaço, Quando valido, Então aprova", () => {
    expect(avaliar({ stale_after: "2028-02-29 10:00:00-03:00" }).erros).toEqual([]);
    expect(avaliar({ stale_after: "2100-02-29T10:00:00-03:00" }).erros[0]).toContain("data invalida");
    expect(avaliar({ stale_after: "2000-02-29T10:00:00+05:30" }).erros).toEqual([]);
  });
});

describe("validarProveniencia: métricas", () => {
  test("Dado stale_after no passado, Quando valido, Então a página vence sem reprovar", () => {
    const r = avaliar({ stale_after: "2000-01-01T00:00:00-03:00" });
    expect(r.erros).toEqual([]);
    expect(r.vencida).toBe(true);
  });

  test("Dado stale_after exatamente agora, Quando valido, Então já está vencida", () => {
    expect(avaliar({ stale_after: "2026-10-24T12:00:00+00:00" }).vencida).toBe(true);
  });

  test("Dado stale_after no futuro, Quando valido, Então não vence", () => {
    expect(avaliar({ stale_after: "2099-01-01T00:00:00-03:00" }).vencida).toBe(false);
  });

  test("Dado geração depois da última verificação, Quando valido, Então só a métrica acusa", () => {
    const r = avaliar({
      generated: { by: "process:x", at: "2026-09-05T10:00:00-03:00" },
      verified: [{ by: "human:iago", at: "2026-09-03T10:00:00-03:00" }],
    });
    expect(r.geradaAposVerificacao).toBe(true);
  });

  test("Dado várias verificações, Quando valido, Então vale a mais recente", () => {
    const r = avaliar({
      generated: { by: "process:x", at: "2026-09-05T10:00:00-03:00" },
      verified: [
        { by: "human:iago", at: "2026-09-03T10:00:00-03:00" },
        { by: "human:ana", at: "2026-09-06T10:00:00-03:00" },
      ],
    });
    expect(r.geradaAposVerificacao).toBe(false);
  });
});

describe("validarProveniencia: portão humano (R28)", () => {
  const gerada = { by: "claude-opus/2026-09", at: "2026-09-03T10:00:00-03:00" };

  test("Dado generated sem nenhuma verified, Quando valido, Então reprova como gerada sem aprovação humana", () => {
    const [erro] = avaliar({ generated: gerada }).erros;
    expect(erro).toContain("página gerada sem aprovação humana");
    expect(erro).toContain("pagina.md");
  });

  test("Dado verified humana posterior à geração, Quando valido, Então aprova", () => {
    expect(avaliar({ generated: gerada, verified: [{ by: "human:iago", at: "2026-09-03T11:00:00-03:00" }] }).erros).toEqual([]);
  });

  test("Dado verified humana no mesmo instante da geração, Quando valido, Então aprova", () => {
    expect(avaliar({ generated: gerada, verified: [{ by: "human:iago", at: "2026-09-03T10:00:00-03:00" }] }).erros).toEqual([]);
  });

  test("Dado verified humana anterior à geração, Quando valido, Então reprova", () => {
    expect(avaliar({ generated: gerada, verified: [{ by: "human:iago", at: "2026-09-03T09:59:59-03:00" }] }).erros[0]).toContain("sem aprovação humana");
  });

  test("Dado offsets diferentes, Quando comparo, Então vale o instante e não o texto", () => {
    const g = { by: "process:x", at: "2026-09-03T10:00:00-03:00" };
    expect(avaliar({ generated: g, verified: [{ by: "human:iago", at: "2026-09-03T13:30:00+00:00" }] }).erros).toEqual([]);
    expect(avaliar({ generated: g, verified: [{ by: "human:iago", at: "2026-09-03T12:30:00+00:00" }] }).erros[0]).toContain("sem aprovação humana");
  });

  test("Dado verified feita por processo ou gerador, Quando valido, Então não conta como humana", () => {
    for (const por of ["process:revisor", "claude-opus/2026-09"]) {
      expect(avaliar({ generated: gerada, verified: [{ by: por, at: "2026-09-03T11:00:00-03:00" }] }).erros[0]).toContain("sem aprovação humana");
    }
  });

  test("Dado verified humana sem at, Quando a geração tem at, Então não prova ser posterior e reprova", () => {
    expect(avaliar({ generated: gerada, verified: [{ by: "human:iago" }] }).erros[0]).toContain("sem aprovação humana");
  });

  test("Dado várias verificações em que só uma humana é posterior, Quando valido, Então aprova", () => {
    const r = avaliar({
      generated: gerada,
      verified: [
        { by: "human:iago", at: "2026-09-01T10:00:00-03:00" },
        { by: "process:x", at: "2026-09-04T10:00:00-03:00" },
        { by: "human:ana", at: "2026-09-05T10:00:00-03:00" },
      ],
    });
    expect(r.erros).toEqual([]);
  });

  test("Dado generated sem at e uma verified humana, Quando valido, Então aprova pela falta de ordem a conferir", () => {
    expect(avaliar({ generated: { by: "process:x" }, verified: { by: "human:iago" } }).erros).toEqual([]);
    expect(avaliar({ generated: { by: "process:x" } }).erros[0]).toContain("sem aprovação humana");
  });

  test("Dado generated com at malformado, Quando valido, Então reprova o formato e trata a ordem como desconhecida", () => {
    const { erros } = avaliar({ generated: { by: "process:x", at: "ontem" }, verified: { by: "human:iago", at: "2026-09-03T11:00:00-03:00" } });
    expect(erros).toHaveLength(1);
    expect(erros[0]).toContain("generated.at sem offset");
  });

  test("Dado página escrita à mão, sem generated, Quando valido, Então o portão não a afeta", () => {
    expect(avaliar({ verified: { by: "process:x", at: "2026-09-03T11:00:00-03:00" } }).erros).toEqual([]);
  });

  test("Dado generated escalar do formato do projeto, Quando valido, Então o portão não se aplica", () => {
    expect(avaliar({ generated: "2026-10-24", verified: "2026-10-24" }).erros[0]).toContain("verified deve ser mapping ou lista");
    expect(avaliar({ generated: "2026-10-24" }).erros).toEqual([]);
  });
});
