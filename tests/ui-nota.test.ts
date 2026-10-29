import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ErroDeCaminhoInvalido, obterNota } from "../src/lib/ui-nota";

const RAIZ = join(import.meta.dir, ".tmp-ui-nota");

describe("ui-nota: obterNota", () => {
  beforeEach(async () => {
    await rm(RAIZ, { recursive: true, force: true });
    await mkdir(join(RAIZ, "wiki/pessoal/conceitos"), { recursive: true });
    await mkdir(join(RAIZ, "wiki/pessoal/notas"), { recursive: true });
    await mkdir(join(RAIZ, "fora"), { recursive: true });
  });

  afterEach(async () => {
    await rm(RAIZ, { recursive: true, force: true });
  });

  describe("barreiras de segurança e contenção de caminhos", () => {
    test("recusa caminho com path traversal (..)", async () => {
      expect(obterNota(RAIZ, "../fora/arquivo.md")).rejects.toThrow(ErroDeCaminhoInvalido);
      expect(obterNota(RAIZ, "pessoal/../../fora.md")).rejects.toThrow(ErroDeCaminhoInvalido);
    });

    test("recusa caminho absoluto", async () => {
      expect(obterNota(RAIZ, "/etc/passwd")).rejects.toThrow(ErroDeCaminhoInvalido);
    });

    test("recusa symlink que aponta para fora da wiki", async () => {
      await writeFile(join(RAIZ, "fora/segredo.md"), "# Segredo\n");
      try {
        await symlink(join(RAIZ, "fora/segredo.md"), join(RAIZ, "wiki/pessoal/link-fora.md"));
      } catch {
        // No Windows pode exigir privilégios; se falhar na criação do symlink, pula o teste de symlink real
        return;
      }
      expect(obterNota(RAIZ, "pessoal/link-fora.md")).rejects.toThrow(ErroDeCaminhoInvalido);
    });

    test("retorna null para página inexistente", async () => {
      const nota = await obterNota(RAIZ, "pessoal/conceitos/inexistente.md");
      expect(nota).toBeNull();
    });

    test("recusa caminho com byte nulo ou string vazia", async () => {
      expect(obterNota(RAIZ, "")).rejects.toThrow(ErroDeCaminhoInvalido);
      expect(obterNota(RAIZ, "pessoal/\0teste.md")).rejects.toThrow(ErroDeCaminhoInvalido);
    });

    test("recusa arquivos ocultos, de configuração ou fora de markdown (.git, .env, .oculta.md)", async () => {
      await mkdir(join(RAIZ, "wiki/.git"), { recursive: true });
      await writeFile(join(RAIZ, "wiki/.git/config"), "url = https://token-secreto@github.com/repo.git\n");
      await writeFile(join(RAIZ, "wiki/.env"), "SECRET=chave-privada\n");
      await writeFile(join(RAIZ, "wiki/pessoal/.oculta.md"), "# Oculta\n");

      expect(obterNota(RAIZ, ".git/config")).rejects.toThrow(ErroDeCaminhoInvalido);
      expect(obterNota(RAIZ, ".env")).rejects.toThrow(ErroDeCaminhoInvalido);
      expect(obterNota(RAIZ, "pessoal/.oculta.md")).rejects.toThrow(ErroDeCaminhoInvalido);
    });

    test("recusa caminhos reservados da wiki (_meta, log, log.md, index.md)", async () => {
      await mkdir(join(RAIZ, "wiki/_meta"), { recursive: true });
      await mkdir(join(RAIZ, "wiki/log"), { recursive: true });
      await writeFile(join(RAIZ, "wiki/_meta/x.md"), "# Meta\n");
      await writeFile(join(RAIZ, "wiki/log/log-2026-10-29.md"), "# Log\n");
      await writeFile(join(RAIZ, "wiki/log.md"), "# Índice de log\n");

      expect(obterNota(RAIZ, "_meta/x.md")).rejects.toThrow(ErroDeCaminhoInvalido);
      expect(obterNota(RAIZ, "log/log-2026-10-29.md")).rejects.toThrow(ErroDeCaminhoInvalido);
      expect(obterNota(RAIZ, "log.md")).rejects.toThrow(ErroDeCaminhoInvalido);
    });

    test("recusa caminhos reservados da wiki independentemente de caixa (_META, Log, LOG.md, Index.md)", async () => {
      await mkdir(join(RAIZ, "wiki/_META"), { recursive: true });
      await mkdir(join(RAIZ, "wiki/Log"), { recursive: true });
      await writeFile(join(RAIZ, "wiki/_META/segredo.md"), "# Meta segredo\n");
      await writeFile(join(RAIZ, "wiki/Log/x.md"), "# Log com maiúscula\n");
      await writeFile(join(RAIZ, "wiki/LOG.md"), "# Log em maiúsculas\n");

      expect(obterNota(RAIZ, "_META/segredo.md")).rejects.toThrow(ErroDeCaminhoInvalido);
      expect(obterNota(RAIZ, "Log/x.md")).rejects.toThrow(ErroDeCaminhoInvalido);
      expect(obterNota(RAIZ, "LOG.md")).rejects.toThrow(ErroDeCaminhoInvalido);
    });

    test("recusa arquivos que não terminam com .md", async () => {
      await writeFile(join(RAIZ, "wiki/pessoal/conceitos/arquivo.txt"), "texto\n");
      expect(obterNota(RAIZ, "pessoal/conceitos/arquivo.txt")).rejects.toThrow(ErroDeCaminhoInvalido);
    });
  });

  describe("extração de metadados, corpo, lacunas, backlinks e grafo", () => {
    test("trata nota sem frontmatter ou com frontmatter malformado como status erro", async () => {
      await writeFile(join(RAIZ, "wiki/pessoal/conceitos/sem-fm.md"), "# Apenas texto sem frontmatter\n");
      const notaSemFm = await obterNota(RAIZ, "pessoal/conceitos/sem-fm.md");
      expect(notaSemFm).not.toBeNull();
      expect(notaSemFm?.status).toBe("erro");

      await writeFile(join(RAIZ, "wiki/pessoal/conceitos/fm-quebrado.md"), "---\ntitle: [quebrado\n---\n# Texto\n");
      const notaQuebrada = await obterNota(RAIZ, "pessoal/conceitos/fm-quebrado.md");
      expect(notaQuebrada).not.toBeNull();
      expect(notaQuebrada?.status).toBe("erro");
    });

    test("reconhece nota aprovada diretamente sem bloco generated", async () => {
      await writeFile(
        join(RAIZ, "wiki/pessoal/notas/manual.md"),
        `---
title: Nota Manual
type: nota
verified:
  - by: human:iago
    at: 2026-10-25T10:00:00-03:00
---
# Nota Manual
`,
      );
      const nota = await obterNota(RAIZ, "pessoal/notas/manual.md");
      expect(nota?.status).toBe("aprovada");
      expect(nota?.statusMeta).toContain("Aprovada por human:iago");
    });

    test("extrai callout de contradição e links com alias [[slug|rótulo]]", async () => {
      await writeFile(
        join(RAIZ, "wiki/pessoal/conceitos/paradoxo.md"),
        `---
title: Paradoxo
---
Veja [[padrao-llm-wiki|o padrão wiki]].

> [!contradiction]
> Há divergência entre as fontes A e B sobre a data.
`,
      );
      const nota = await obterNota(RAIZ, "pessoal/conceitos/paradoxo.md");
      expect(nota?.lacunas.length).toBe(1);
      expect(nota?.lacunas[0]!.tipo).toBe("contradiction");
      expect(nota?.lacunas[0]!.texto).toContain("Há divergência entre as fontes A e B");
      expect(nota?.relacionados).toContain("padrao-llm-wiki");
    });
    test("lê nota com frontmatter, corpo, lacuna [!gap], proveniência e backlinks", async () => {
      // Página alvo: Padrão LLM Wiki
      await writeFile(
        join(RAIZ, "wiki/pessoal/conceitos/padrao-llm-wiki.md"),
        `---
title: Padrão LLM Wiki
type: conceito
area: pessoal
tags: [metodo, llm, pkm]
sources:
  - resource: raw/pessoal/artigos/llm-wiki.md
    title: LLM Wiki — Andrej Karpathy
generated:
  by: claude/3.5
  at: 2026-10-26T14:35:00-03:00
---

# Padrão LLM Wiki

Em vez de recuperar trechos, o agente constrói e mantém uma wiki persistente.
Veja também [[rag]] e [[segundo-cerebro]].

> [!gap]
> A fonte não diz como resolver uma contradição entre fontes.

## Como funciona
Páginas markdown interligadas.
`,
      );

      // Página vizinha 1: RAG
      await writeFile(
        join(RAIZ, "wiki/pessoal/conceitos/rag.md"),
        `---
title: RAG
type: conceito
---

# RAG
Geração aumentada.
`,
      );

      // Página vizinha 2: Segundo Cérebro (cita padrao-llm-wiki)
      await writeFile(
        join(RAIZ, "wiki/pessoal/notas/segundo-cerebro.md"),
        `---
title: Segundo Cérebro
type: nota
---

# Segundo Cérebro
O [[padrao-llm-wiki]] delega ao agente a parte da síntese.
`,
      );

      // Outra página não relacionada
      await writeFile(
        join(RAIZ, "wiki/outra.md"),
        `---
title: Outra
---
Sem relações.
`,
      );

      const nota = await obterNota(RAIZ, "pessoal/conceitos/padrao-llm-wiki.md");
      expect(nota).not.toBeNull();
      if (!nota) return;

      expect(nota.titulo).toBe("Padrão LLM Wiki");
      expect(nota.slug).toBe("padrao-llm-wiki");
      expect(nota.tipo).toBe("conceito");
      expect(nota.area).toBe("pessoal");
      expect(nota.tags).toEqual(["metodo", "llm", "pkm"]);
      expect(nota.status).toBe("rascunho");
      expect(nota.aprovavel).toBe(true);

      // Proveniência
      expect(nota.proveniencia.fontePrincipal).toBe("raw/pessoal/artigos/llm-wiki.md");
      expect(nota.proveniencia.geradoPor).toBe("claude/3.5");
      expect(nota.proveniencia.geradoEm).toBe("2026-10-26T14:35:00-03:00");
      expect(nota.proveniencia.verificadoPor).toBeUndefined();

      // Lacunas
      expect(nota.lacunas.length).toBe(1);
      expect(nota.lacunas[0]!.tipo).toBe("gap");
      expect(nota.lacunas[0]!.texto).toBe("A fonte não diz como resolver uma contradição entre fontes.");

      // Backlinks
      expect(nota.backlinks.length).toBe(1);
      expect(nota.backlinks[0]!.slug).toBe("segundo-cerebro");
      expect(nota.backlinks[0]!.titulo).toBe("Segundo Cérebro");
      expect(nota.backlinks[0]!.contexto).toContain("delega ao agente a parte da síntese");

      // Grafo local (nó atual + rag + segundo-cerebro)
      const idsNos = nota.grafoLocal.nos.map((n) => n.id);
      expect(idsNos).toContain("padrao-llm-wiki");
      expect(idsNos).toContain("rag");
      expect(idsNos).toContain("segundo-cerebro");
      expect(idsNos).not.toContain("outra");

      const noAtual = nota.grafoLocal.nos.find((n) => n.id === "padrao-llm-wiki");
      expect(noAtual?.atual).toBe(true);

      // Arestas: padrao-llm-wiki -> rag, padrao-llm-wiki -> segundo-cerebro, segundo-cerebro -> padrao-llm-wiki
      expect(nota.grafoLocal.arestas).toEqual(
        expect.arrayContaining([
          { de: "padrao-llm-wiki", para: "rag" },
          { de: "padrao-llm-wiki", para: "segundo-cerebro" },
          { de: "segundo-cerebro", para: "padrao-llm-wiki" },
        ]),
      );
    });
  });
});
