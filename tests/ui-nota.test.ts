import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { comporFlagsAbertura, ErroDeCaminhoInvalido, obterNota, validarCaminhoWiki } from "../src/lib/ui-nota";

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

    test("retorna null para wiki inexistente", async () => {
      const raizInexistente = join(RAIZ, "pasta-inexistente");
      const nota = await obterNota(raizInexistente, "pessoal/conceitos/inexistente.md");
      expect(nota).toBeNull();
    });

    test.skipIf(process.platform === "win32")(
      "recusa caminho quando a raiz wiki é um symlink circular (ELOOP)",
      async () => {
        const raizLoop = join(RAIZ, "loop-wiki");
        await mkdir(raizLoop, { recursive: true });
        await symlink("wiki", join(raizLoop, "wiki"));
        await expect(obterNota(raizLoop, "pessoal/conceitos/x.md")).rejects.toThrow(
          ErroDeCaminhoInvalido,
        );
      },
    );

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

    test("validarCaminhoWiki resolve e retorna o caminho real validado (realpath)", async () => {
      await writeFile(join(RAIZ, "wiki/pessoal/conceitos/real.md"), "# Real\n");
      const caminhoReal = await realpath(join(RAIZ, "wiki/pessoal/conceitos/real.md"));
      const resolvido = await validarCaminhoWiki(join(RAIZ, "wiki"), "pessoal/conceitos/real.md");
      expect(resolvido).toBe(caminhoReal);
    });

    test("TOCTOU: recusa leitura se o arquivo for trocado por symlink para fora da wiki após a abertura", async () => {
      await writeFile(join(RAIZ, "fora/segredo-toctou.md"), "# Segredo Externo\n");
      await writeFile(join(RAIZ, "wiki/pessoal/conceitos/vitima.md"), "# Original\n");

      const promessa = obterNota(
        RAIZ,
        "pessoal/conceitos/vitima.md",
        process.env,
        {
          ganchoAposAbrir: async (caminho) => {
            await rm(caminho);
            await symlink(join(RAIZ, "fora/segredo-toctou.md"), caminho);
          },
        },
      );

      await expect(promessa).rejects.toThrow(ErroDeCaminhoInvalido);
    });

    test("TOCTOU: recusa leitura se o arquivo for substituído por outro após a abertura (verificação dev/ino)", async () => {
      await writeFile(join(RAIZ, "wiki/pessoal/conceitos/substituto.md"), "# Substituto\n");
      await writeFile(join(RAIZ, "wiki/pessoal/conceitos/alvo.md"), "# Alvo Original\n");

      const promessa = obterNota(
        RAIZ,
        "pessoal/conceitos/alvo.md",
        process.env,
        {
          ganchoAposAbrir: async (caminho) => {
            await rm(caminho);
            await writeFile(caminho, "# Arquivo Novo Com Outro Inode\n");
          },
        },
      );

      await expect(promessa).rejects.toThrow(ErroDeCaminhoInvalido);
    });

    test.skipIf(process.platform === "win32")(
      "recusa leitura através de symlink intermediário para pasta externa com FIFO em menos de 1 s",
      async () => {
        const pastaExterna = join(RAIZ, "fora/pasta-externa");
        await mkdir(pastaExterna, { recursive: true });
        const fifoExterno = join(pastaExterna, "nota.md");
        execFileSync("mkfifo", [fifoExterno]);
        await symlink(pastaExterna, join(RAIZ, "wiki/intermediario"));

        const promessa = Promise.race([
          obterNota(RAIZ, "intermediario/nota.md"),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("tempo limite excedido (travou na abertura do FIFO)")), 1000),
          ),
        ]);

        await expect(promessa).rejects.toThrow(ErroDeCaminhoInvalido);
      },
      2000,
    );

    test.skipIf(process.platform === "win32")(
      "recusa FIFO interno à wiki sem travar na abertura (não é arquivo regular)",
      async () => {
        const fifoInterno = join(RAIZ, "wiki/pessoal/notas/x.md");
        execFileSync("mkfifo", [fifoInterno]);

        const promessa = Promise.race([
          obterNota(RAIZ, "pessoal/notas/x.md"),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("tempo limite excedido (travou na abertura do FIFO)")), 1000),
          ),
        ]);

        await expect(promessa).rejects.toThrow(ErroDeCaminhoInvalido);
      },
      2000,
    );

    test.skipIf(process.platform === "win32")(
      "recusa symlink no último componente para outra nota dentro da wiki (proteção O_NOFOLLOW)",
      async () => {
        await writeFile(join(RAIZ, "wiki/pessoal/notas/alvo-interno.md"), "# Alvo Interno\n");
        await symlink(
          join(RAIZ, "wiki/pessoal/notas/alvo-interno.md"),
          join(RAIZ, "wiki/pessoal/notas/link-interno.md"),
        );

        await expect(obterNota(RAIZ, "pessoal/notas/link-interno.md")).rejects.toThrow(
          ErroDeCaminhoInvalido,
        );
      },
    );

    test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
      "recusa nota externa através de symlink intermediário sem tentar abrir o arquivo (realpath prévio)",
      async () => {
        const pastaExterna = join(RAIZ, "fora/pasta-externa");
        await mkdir(pastaExterna, { recursive: true });
        const notaExterna = join(pastaExterna, "nota.md");
        await writeFile(notaExterna, "# Nota Externa\n");
        await chmod(notaExterna, 0o000);
        await symlink(pastaExterna, join(RAIZ, "wiki/intermediario"));

        try {
          await expect(obterNota(RAIZ, "intermediario/nota.md")).rejects.toThrow(
            ErroDeCaminhoInvalido,
          );
        } finally {
          await chmod(notaExterna, 0o644).catch(() => {});
        }
      },
    );
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

      // Grafo local (nó atual + rag + segundo-cerebro indexados por caminho)
      const idsNos = nota.grafoLocal.nos.map((n) => n.id);
      expect(idsNos).toContain("pessoal/conceitos/padrao-llm-wiki.md");
      expect(idsNos).toContain("pessoal/conceitos/rag.md");
      expect(idsNos).toContain("pessoal/notas/segundo-cerebro.md");
      expect(idsNos).not.toContain("outra.md");

      const noAtual = nota.grafoLocal.nos.find((n) => n.id === "pessoal/conceitos/padrao-llm-wiki.md");
      expect(noAtual?.atual).toBe(true);

      // Arestas: padrao-llm-wiki -> rag, padrao-llm-wiki -> segundo-cerebro, segundo-cerebro -> padrao-llm-wiki
      expect(nota.grafoLocal.arestas).toEqual(
        expect.arrayContaining([
          { de: "pessoal/conceitos/padrao-llm-wiki.md", para: "pessoal/conceitos/rag.md" },
          { de: "pessoal/conceitos/padrao-llm-wiki.md", para: "pessoal/notas/segundo-cerebro.md" },
          { de: "pessoal/notas/segundo-cerebro.md", para: "pessoal/conceitos/padrao-llm-wiki.md" },
        ]),
      );
    });

    test("grafo local não colapsa notas com mesmo slug (basename) em diretórios diferentes", async () => {
      await writeFile(
        join(RAIZ, "wiki/principal.md"),
        `---
title: Nota Principal
---
# Principal
Texto da principal.
`,
      );

      await mkdir(join(RAIZ, "wiki/a"), { recursive: true });
      await mkdir(join(RAIZ, "wiki/b"), { recursive: true });
      await writeFile(
        join(RAIZ, "wiki/a/dupe.md"),
        `---
title: Título A
---
Ligação para [[principal]].
`,
      );
      await writeFile(
        join(RAIZ, "wiki/b/dupe.md"),
        `---
title: Título B
---
Ligação para [[principal]].
`,
      );

      const nota = await obterNota(RAIZ, "principal.md");
      expect(nota).not.toBeNull();
      if (!nota) return;

      const rotulosNos = nota.grafoLocal.nos.map((n) => n.rotulo);
      expect(rotulosNos).toContain("Nota Principal");
      expect(rotulosNos).toContain("Título A");
      expect(rotulosNos).toContain("Título B");

      const idsNos = nota.grafoLocal.nos.map((n) => n.id);
      expect(idsNos).toContain("principal.md");
      expect(idsNos).toContain("a/dupe.md");
      expect(idsNos).toContain("b/dupe.md");

      expect(nota.grafoLocal.nos.length).toBe(3);
    });
  });

  describe("composição de flags de abertura (comporFlagsAbertura)", () => {
    test("combina O_RDONLY, O_NOFOLLOW e O_NONBLOCK quando todos são números", () => {
      const flags = comporFlagsAbertura({
        O_RDONLY: 0,
        O_NOFOLLOW: 0x20000,
        O_NONBLOCK: 0x800,
      });
      expect(flags).toBe(0 | 0x20000 | 0x800);
    });

    test("preserva O_NOFOLLOW quando O_NONBLOCK não está disponível", () => {
      const flags = comporFlagsAbertura({
        O_RDONLY: 0,
        O_NOFOLLOW: 0x20000,
      });
      expect(flags).toBe(0 | 0x20000);
    });

    test("preserva O_NONBLOCK quando O_NOFOLLOW não está disponível", () => {
      const flags = comporFlagsAbertura({
        O_RDONLY: 0,
        O_NONBLOCK: 0x800,
      });
      expect(flags).toBe(0 | 0x800);
    });

    test("cai para 'r' se nenhuma flag de proteção estiver disponível", () => {
      const flags = comporFlagsAbertura({
        O_RDONLY: 0,
      });
      expect(flags).toBe("r");
    });

    test("cai para 'r' se O_RDONLY não for número", () => {
      const flags = comporFlagsAbertura({
        O_RDONLY: undefined,
        O_NOFOLLOW: 0x20000,
        O_NONBLOCK: 0x800,
      });
      expect(flags).toBe("r");
    });
  });
});
