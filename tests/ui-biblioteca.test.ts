import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ehCaminhoDeNotaValido, listarBiblioteca } from "../src/lib/ui-biblioteca";

const RAIZ = join(import.meta.dir, ".tmp-ui-biblioteca");

describe("ui-biblioteca: listarBiblioteca", () => {
  beforeEach(async () => {
    await rm(RAIZ, { recursive: true, force: true });
    await mkdir(join(RAIZ, "wiki/pessoal/conceitos"), { recursive: true });
    await mkdir(join(RAIZ, "wiki/_meta"), { recursive: true });
    await mkdir(join(RAIZ, "wiki/log"), { recursive: true });
  });

  afterEach(async () => {
    await rm(RAIZ, { recursive: true, force: true });
  });

  test("retorna lista vazia quando não há páginas de conteúdo", async () => {
    await writeFile(join(RAIZ, "wiki/index.md"), "# Índice\n");
    await writeFile(join(RAIZ, "wiki/log.md"), "# Log\n");
    await writeFile(join(RAIZ, "wiki/log/log-2026-10-29.md"), "## [2026-10-29] ingest | teste\n");
    await writeFile(join(RAIZ, "wiki/_meta/schema.md"), "# Schema\n");

    const resultado = await listarBiblioteca(RAIZ);
    expect(resultado.paginas).toEqual([]);
    expect(resultado.totais).toEqual({ total: 0, rascunhos: 0, aprovadas: 0, erros: 0 });
    expect(resultado.tipos).toEqual([{ tipo: "todos", rotulo: "Todas", contagem: 0 }]);
  });

  test("lista páginas extraindo metadados, status de rascunho e aprovada, e contagem de links", async () => {
    // Página 1: rascunho gerado sem aprovação
    await writeFile(
      join(RAIZ, "wiki/pessoal/conceitos/padrao-llm-wiki.md"),
      `---
title: Padrão LLM Wiki
type: conceito
area: pessoal
tags: [metodo, llm]
generated:
  by: claude/3.5
  at: 2026-10-29T10:00:00-03:00
---

# Padrão LLM Wiki
Veja também [[rag]] e [[segundo-cerebro]].
`,
    );

    // Página 2: aprovada
    await writeFile(
      join(RAIZ, "wiki/pessoal/conceitos/rag.md"),
      `---
title: RAG
type: conceito
area: pessoal
tags: [metodo]
generated:
  by: claude/3.5
  at: 2026-10-28T10:00:00-03:00
verified:
  - by: human:iago
    at: 2026-10-28T11:00:00-03:00
---

# RAG
Recuperação aumentada.
`,
    );

    // Página 3: nota rápida aprovada
    await writeFile(
      join(RAIZ, "wiki/nota-rapida.md"),
      `---
title: Nota Rápida
type: nota
verified:
  - by: human:iago
    at: 2026-10-27T10:00:00-03:00
---

# Nota
`,
    );

    const resultado = await listarBiblioteca(RAIZ);
    expect(resultado.totais.total).toBe(3);
    expect(resultado.totais.rascunhos).toBe(1);
    expect(resultado.totais.aprovadas).toBe(2);

    const p1 = resultado.paginas.find((p) => p.slug === "padrao-llm-wiki");
    expect(p1).toBeDefined();
    expect(p1?.titulo).toBe("Padrão LLM Wiki");
    expect(p1?.tipo).toBe("conceito");
    expect(p1?.area).toBe("pessoal");
    expect(p1?.tags).toEqual(["metodo", "llm"]);
    expect(p1?.status).toBe("rascunho");
    expect(p1?.links).toBe(2);

    const p2 = resultado.paginas.find((p) => p.slug === "rag");
    expect(p2).toBeDefined();
    expect(p2?.status).toBe("aprovada");
    expect(p2?.links).toBe(0);

    // Abas/tipos agrupados
    const tipoConceito = resultado.tipos.find((t) => t.tipo === "conceito");
    expect(tipoConceito?.contagem).toBe(2);
    const tipoNota = resultado.tipos.find((t) => t.tipo === "nota");
    expect(tipoNota?.contagem).toBe(1);
  });

  test("trata frontmatter malformado como status erro", async () => {
    await writeFile(
      join(RAIZ, "wiki/pessoal/conceitos/quebrada.md"),
      `---
title: [malformado
---
# Conteudo
`,
    );

    const resultado = await listarBiblioteca(RAIZ);
    expect(resultado.totais.total).toBe(1);
    expect(resultado.totais.erros).toBe(1);
    expect(resultado.paginas[0]!.status).toBe("erro");
    expect(resultado.paginas[0]!.slug).toBe("quebrada");
  });

  test("extrai tags em formato de string separada por vírgula e formato numérico/outro", async () => {
    await writeFile(
      join(RAIZ, "wiki/tags-string.md"),
      `---
title: Tags String
tags: "alfa, beta , gama"
---
`,
    );
    await writeFile(
      join(RAIZ, "wiki/tags-invalida.md"),
      `---
title: Tags Inválida
tags: 123
---
`,
    );

    const resultado = await listarBiblioteca(RAIZ);
    const p1 = resultado.paginas.find((p) => p.slug === "tags-string");
    expect(p1?.tags).toEqual(["alfa", "beta", "gama"]);
    const p2 = resultado.paginas.find((p) => p.slug === "tags-invalida");
    expect(p2?.tags).toEqual([]);
    expect(resultado.tags).toEqual(["alfa", "beta", "gama"]);
  });

  test("ehCaminhoDeNotaValido valida extensão .md e recusa pontos, caminhos absolutos e reservados", () => {
    expect(ehCaminhoDeNotaValido("")).toBe(false);
    expect(ehCaminhoDeNotaValido("nota\0.md")).toBe(false);
    expect(ehCaminhoDeNotaValido("/etc/passwd")).toBe(false);
    expect(ehCaminhoDeNotaValido(".git/config")).toBe(false);
    expect(ehCaminhoDeNotaValido(".env")).toBe(false);
    expect(ehCaminhoDeNotaValido("area/.oculta.md")).toBe(false);
    expect(ehCaminhoDeNotaValido("_meta/x.md")).toBe(false);
    expect(ehCaminhoDeNotaValido("_META/x.md")).toBe(false);
    expect(ehCaminhoDeNotaValido("_Meta/x.md")).toBe(false);
    expect(ehCaminhoDeNotaValido("log/log-2026-10-29.md")).toBe(false);
    expect(ehCaminhoDeNotaValido("Log/x.md")).toBe(false);
    expect(ehCaminhoDeNotaValido("LOG/x.md")).toBe(false);
    expect(ehCaminhoDeNotaValido("log.md")).toBe(false);
    expect(ehCaminhoDeNotaValido("LOG.md")).toBe(false);
    expect(ehCaminhoDeNotaValido("index.md")).toBe(false);
    expect(ehCaminhoDeNotaValido("Index.md")).toBe(false);
    expect(ehCaminhoDeNotaValido("area/index.md")).toBe(false);
    expect(ehCaminhoDeNotaValido("area/Index.md")).toBe(false);
    expect(ehCaminhoDeNotaValido("area/arquivo.txt")).toBe(false);
    expect(ehCaminhoDeNotaValido("pessoal/conceitos/padrao.md")).toBe(true);
    expect(ehCaminhoDeNotaValido("simples.md")).toBe(true);
  });
});

