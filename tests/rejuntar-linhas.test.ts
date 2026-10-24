import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executar } from "../src/cli";
import {
  ErroDeRejuntamento,
  comandoRejuntarLinhas,
  rejuntarLinhas,
  rejuntarTexto,
} from "../src/comandos/rejuntar-linhas";

let pasta: string;

beforeEach(() => {
  pasta = mkdtempSync(join(tmpdir(), "anvilore-rejuntar-"));
});
afterEach(() => {
  rmSync(pasta, { recursive: true, force: true });
});

function capturar<T>(corpo: () => Promise<T>) {
  const saida: string[] = [];
  const erro: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...a) => {
    saida.push(a.join(" "));
  });
  const err = spyOn(console, "error").mockImplementation((...a) => {
    erro.push(a.join(" "));
  });
  return corpo()
    .then((codigo) => ({ codigo, saida: saida.join("\n"), erro: erro.join("\n") }))
    .finally(() => {
      log.mockRestore();
      err.mockRestore();
    });
}

const hashDe = (arquivo: string) => createHash("sha256").update(readFileSync(arquivo)).digest("hex");

// Mesma página do teste antigo (tests/test-rejuntar-linhas.sh).
const QUEBRADA = `---
title: "Quebrada"
slug: quebrada
type: concept
tags: []
---

## Secao

Este e um paragrafo de prosa que foi quebrado manualmente em tres linhas
diferentes para caber em noventa e cinco colunas, o que o renderizador exibe
como tres quebras visuais em vez de um paragrafo continuo.

- Um item de lista que tambem foi quebrado manualmente em duas linhas
  seguidas, com a continuacao indentada.

> Um blockquote que foi quebrado manualmente em duas linhas e precisa voltar
> a ser uma linha so.

| coluna a | coluna b |
|---|---|
| valor um | valor dois |

\`\`\`bash
echo "primeira linha do fence"
echo "segunda linha do fence"
\`\`\`
`;

const ESPERADO_PARAGRAFO =
  "Este e um paragrafo de prosa que foi quebrado manualmente em tres linhas diferentes para caber em noventa e cinco colunas, o que o renderizador exibe como tres quebras visuais em vez de um paragrafo continuo.";
const ESPERADO_ITEM =
  "- Um item de lista que tambem foi quebrado manualmente em duas linhas seguidas, com a continuacao indentada.";
const ESPERADO_CITACAO = "> Um blockquote que foi quebrado manualmente em duas linhas e precisa voltar a ser uma linha so.";

function pagina(): string {
  const caminho = join(pasta, "quebrada.md");
  writeFileSync(caminho, QUEBRADA);
  return caminho;
}

const linhasDe = (arquivo: string) => readFileSync(arquivo, "utf8").split("\n");

describe("rejuntar-linhas: simulação", () => {
  test("Dado uma página quebrada à mão, Quando rodo com --simular, Então sai 0 e o relatório diz quantos mudariam e nomeia o arquivo", async () => {
    const caminho = pagina();
    const r = await capturar(() => comandoRejuntarLinhas([caminho, "--simular"]));
    expect(r.codigo).toBe(0);
    expect(r.erro).toContain("1/1 arquivos mudariam.");
    expect(r.erro).toContain("quebrada.md");
  });

  test("Dado uma página quebrada à mão, Quando rodo com --simular, Então o arquivo não é escrito", async () => {
    const caminho = pagina();
    const antes = hashDe(caminho);
    await capturar(() => comandoRejuntarLinhas([caminho, "--simular"]));
    expect(hashDe(caminho)).toBe(antes);
  });

  test("Dado o alias --dry-run, Quando rodo, Então se comporta como --simular", async () => {
    const caminho = pagina();
    const antes = hashDe(caminho);
    const r = await capturar(() => comandoRejuntarLinhas([caminho, "--dry-run"]));
    expect(r.codigo).toBe(0);
    expect(r.erro).toContain("mudariam");
    expect(hashDe(caminho)).toBe(antes);
  });

  test("Dado --simular --diff, Quando rodo, Então imprime o diff unificado e não escreve", async () => {
    const caminho = pagina();
    const antes = hashDe(caminho);
    const r = await capturar(() => comandoRejuntarLinhas([caminho, "--simular", "--diff"]));
    expect(r.codigo).toBe(0);
    expect(hashDe(caminho)).toBe(antes);
    expect(r.saida).toMatch(/^--- .*quebrada\.md$/m);
    expect(r.saida).toMatch(/^\+\+\+ .*quebrada\.md \(rejuntado\)$/m);
    expect(r.saida).toMatch(/^@@ -\d+(,\d+)? \+\d+(,\d+)? @@$/m);
    expect(r.saida).toContain(`+${ESPERADO_PARAGRAFO}`);
    expect(r.saida).toContain("-diferentes para caber em noventa e cinco colunas, o que o renderizador exibe");
  });

  test("Dado --simular --diff, Quando o diff sai, Então a lista de arquivos não é repetida no relatório", async () => {
    const caminho = pagina();
    const r = await capturar(() => comandoRejuntarLinhas([caminho, "--simular", "--diff"]));
    expect(r.erro).toContain("1/1 arquivos mudariam.");
    expect(r.erro).not.toContain("quebrada.md");
  });

  test("Dado um arquivo sem nada a rejuntar, Quando rodo com --simular --diff, Então não imprime diff e relata 0/1", async () => {
    const caminho = join(pasta, "limpa.md");
    writeFileSync(caminho, "Uma linha so.\n");
    const r = await capturar(() => comandoRejuntarLinhas([caminho, "--simular", "--diff"]));
    expect(r.codigo).toBe(0);
    expect(r.saida).toBe("");
    expect(r.erro).toContain("0/1 arquivos mudariam.");
  });
});

describe("rejuntar-linhas: execução real", () => {
  test("Dado uma página quebrada, Quando rodo sem --simular, Então sai 0 e relata que mudou", async () => {
    const caminho = pagina();
    const r = await capturar(() => comandoRejuntarLinhas([caminho]));
    expect(r.codigo).toBe(0);
    expect(r.erro).toContain("1/1 arquivos mudaram.");
  });

  test("Dado uma página quebrada, Quando rodo, Então parágrafo, item de lista e blockquote viram uma linha cada", async () => {
    const caminho = pagina();
    await capturar(() => comandoRejuntarLinhas([caminho]));
    const linhas = linhasDe(caminho);
    expect(linhas).toContain(ESPERADO_PARAGRAFO);
    expect(linhas).toContain(ESPERADO_ITEM);
    expect(linhas).toContain(ESPERADO_CITACAO);
  });

  test("Dado uma página quebrada, Quando rodo, Então code fence, tabela, frontmatter e heading ficam intactos", async () => {
    const caminho = pagina();
    await capturar(() => comandoRejuntarLinhas([caminho]));
    const antes = QUEBRADA.split("\n");
    const depois = linhasDe(caminho);
    const fence = (l: string[]) => l.slice(l.indexOf("```bash"), l.lastIndexOf("```") + 1);
    expect(fence(depois)).toEqual(fence(antes));
    expect(depois.filter((l) => l.startsWith("|"))).toEqual(antes.filter((l) => l.startsWith("|")));
    expect(depois.slice(0, 6)).toEqual(antes.slice(0, 6));
    expect(depois).toContain("## Secao");
  });

  test("Dado a prova de dentes, Quando rodo sem --simular, Então o hash MUDA (a asserção de não-escrita tem dentes)", async () => {
    const caminho = pagina();
    const antes = hashDe(caminho);
    await capturar(() => comandoRejuntarLinhas([caminho]));
    expect(hashDe(caminho)).not.toBe(antes);
  });

  test("Dado um arquivo já rejuntado, Quando rodo de novo, Então a segunda passada não muda nada", async () => {
    const caminho = pagina();
    await capturar(() => comandoRejuntarLinhas([caminho]));
    const antes = hashDe(caminho);
    const r = await capturar(() => comandoRejuntarLinhas([caminho]));
    expect(hashDe(caminho)).toBe(antes);
    expect(r.erro).toContain("0/1 arquivos mudaram.");
  });
});

describe("rejuntar-linhas: diretório como alvo", () => {
  test("Dado um diretório com 2 .md e 1 sujo, Quando rodo com --simular, Então conta 1/2 arquivos mudariam", async () => {
    mkdirSync(join(pasta, "sub"));
    writeFileSync(join(pasta, "limpa.md"), "Uma linha so.\n");
    writeFileSync(join(pasta, "sub", "suja.md"), "Linha uma que continua\nna linha dois.\n");
    writeFileSync(join(pasta, "ignorado.txt"), "a\nb\n");
    const r = await capturar(() => comandoRejuntarLinhas([pasta, "--simular"]));
    expect(r.codigo).toBe(0);
    expect(r.erro).toContain("1/2 arquivos mudariam.");
    expect(r.erro).toContain(join("sub", "suja.md"));
    expect(readFileSync(join(pasta, "ignorado.txt"), "utf8")).toBe("a\nb\n");
  });

  test("Dado .md com extensão em maiúsculas, Quando varro o diretório, Então ele entra na contagem", async () => {
    writeFileSync(join(pasta, "MAIUSCULA.MD"), "a\nb\n");
    const r = await rejuntarLinhas(pasta, { simular: true });
    expect(r.total).toBe(1);
    expect(r.mudariam).toEqual([join(pasta, "MAIUSCULA.MD")]);
  });

  test("Dado um diretório chamado x.md, Quando varro, Então ele não é lido como arquivo", async () => {
    mkdirSync(join(pasta, "x.md"));
    writeFileSync(join(pasta, "x.md", "dentro.md"), "a\nb\n");
    const r = await rejuntarLinhas(pasta, { simular: true });
    expect(r.total).toBe(1);
  });

  test("Dado vários arquivos, Quando varro, Então a ordem é a de caminho por componente (a/b antes de a.md)", async () => {
    mkdirSync(join(pasta, "a"));
    writeFileSync(join(pasta, "a", "b.md"), "x\ny\n");
    writeFileSync(join(pasta, "a.md"), "x\ny\n");
    const r = await rejuntarLinhas(pasta, { simular: true });
    expect(r.mudariam).toEqual([join(pasta, "a", "b.md"), join(pasta, "a.md")]);
  });

  test.skipIf(process.platform === "win32")(
    "Dado um symlink para .md, Quando varro, Então o alvo do link é lido e reescrito (stat segue o link)",
    async () => {
      const real = join(pasta, "real.md");
      writeFileSync(real, "a\nb\n");
      mkdirSync(join(pasta, "dir"));
      symlinkSync(real, join(pasta, "dir", "link.md"));
      const r = await rejuntarLinhas(join(pasta, "dir"));
      expect(r.mudariam).toEqual([join(pasta, "dir", "link.md")]);
      expect(readFileSync(real, "utf8")).toBe("a b\n");
    },
  );

  test.skipIf(process.platform === "win32")(
    "Dado um symlink quebrado para .md, Quando varro, Então avisa AVISO: em stderr e não o conta",
    async () => {
      symlinkSync(join(pasta, "nao-existe.md"), join(pasta, "quebrado.md"));
      writeFileSync(join(pasta, "ok.md"), "a\nb\n");
      const r = await capturar(() => comandoRejuntarLinhas([pasta, "--simular"]));
      expect(r.codigo).toBe(0);
      expect(r.erro).toContain("AVISO:");
      expect(r.erro).toContain("quebrado.md");
      expect(r.erro).toContain("1/1 arquivos mudariam.");
    },
  );

  test.skipIf(process.platform === "win32")(
    "Dado um symlink de diretório, Quando varro, Então não desce nele (como o rglob do original)",
    async () => {
      mkdirSync(join(pasta, "real"));
      writeFileSync(join(pasta, "real", "a.md"), "a\nb\n");
      symlinkSync(join(pasta, "real"), join(pasta, "atalho"));
      const r = await rejuntarLinhas(pasta, { simular: true });
      expect(r.total).toBe(1);
    },
  );
});

describe("rejuntar-linhas: uso e erros", () => {
  test("Dado um alvo inexistente, Quando rodo, Então sai 2 com 'erro: alvo não encontrado'", async () => {
    const alvo = join(pasta, "nada.md");
    const r = await capturar(() => comandoRejuntarLinhas([alvo]));
    expect(r.codigo).toBe(2);
    expect(r.erro).toContain(`erro: alvo não encontrado: ${alvo}`);
  });

  test("Dado nenhum argumento, Quando rodo, Então sai 2 com a linha de uso", async () => {
    const r = await capturar(() => comandoRejuntarLinhas([]));
    expect(r.codigo).toBe(2);
    expect(r.erro).toContain("Uso: anvilore rejuntar-linhas <arquivo-ou-diretório> [--simular] [--diff]");
  });

  test("Dado --help, Quando rodo, Então sai 2 (R56) com a linha de uso", async () => {
    const r = await capturar(() => comandoRejuntarLinhas(["--help"]));
    expect(r.codigo).toBe(2);
    expect(r.erro).toContain("Uso: anvilore rejuntar-linhas");
  });

  test("Dado uma opção desconhecida, Quando rodo, Então sai 2 e não toca no arquivo", async () => {
    const caminho = pagina();
    const antes = hashDe(caminho);
    const r = await capturar(() => comandoRejuntarLinhas([caminho, "--forcar"]));
    expect(r.codigo).toBe(2);
    expect(r.erro).toContain("Uso: anvilore rejuntar-linhas");
    expect(hashDe(caminho)).toBe(antes);
  });

  test("Dado dois alvos, Quando rodo, Então sai 2", async () => {
    const r = await capturar(() => comandoRejuntarLinhas(["a.md", "b.md"]));
    expect(r.codigo).toBe(2);
  });

  test("Dado o subcomando na tabela do cli, Quando executo rejuntar-linhas, Então roda o comando", async () => {
    const caminho = pagina();
    const r = await capturar(() => executar(["rejuntar-linhas", caminho, "--simular"]));
    expect(r.codigo).toBe(0);
    expect(r.erro).toContain("mudariam");
  });

  test("Dado um alvo que não é UTF-8 válido, Quando rodo, Então sai 1 nomeando o arquivo e nada é escrito", async () => {
    writeFileSync(join(pasta, "a-boa.md"), "a\nb\n");
    writeFileSync(join(pasta, "b-ruim.md"), Buffer.from([0x61, 0x0a, 0xff, 0xfe, 0x0a]));
    const r = await capturar(() => comandoRejuntarLinhas([pasta]));
    expect(r.codigo).toBe(1);
    expect(r.erro).toContain("ERRO:");
    expect(r.erro).toContain("b-ruim.md");
    expect(readFileSync(join(pasta, "a-boa.md"), "utf8")).toBe("a\nb\n");
  });

  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "Dado um arquivo sem permissão de leitura, Quando rodo, Então sai 1 nomeando o arquivo",
    async () => {
      const caminho = join(pasta, "fechado.md");
      writeFileSync(caminho, "a\nb\n");
      chmodSync(caminho, 0o000);
      const r = await capturar(() => comandoRejuntarLinhas([caminho]));
      chmodSync(caminho, 0o644);
      expect(r.codigo).toBe(1);
      expect(r.erro).toContain("fechado.md");
    },
  );

  test("Dado um alvo inexistente, Quando chamo rejuntarLinhas, Então lança ErroDeRejuntamento", async () => {
    await expect(rejuntarLinhas(join(pasta, "nada"))).rejects.toBeInstanceOf(ErroDeRejuntamento);
  });
});

describe("rejuntarTexto: o que se junta e o que se preserva", () => {
  test("Dado uma tabela seguida de prosa sem linha em branco, Quando rejunto, Então a prosa continua tratada como tabela até a linha em branco", () => {
    const texto = "| a | b |\n|---|---|\n| 1 | 2 |\ntexto\nmais\n\nfora\ndela\n";
    expect(rejuntarTexto(texto)).toBe("| a | b |\n|---|---|\n| 1 | 2 |\ntexto\nmais\n\nfora dela\n");
  });

  test("Dado cerca com til, Quando rejunto, Então o conteúdo da cerca fica intacto e a prosa depois dela é rejuntada", () => {
    expect(rejuntarTexto("~~~\na\nb\n~~~\nx\ny\n")).toBe("~~~\na\nb\n~~~\nx y\n");
  });

  test("Dado um callout [!gap] em blockquote, Quando rejunto, Então vira uma linha só mantendo o prefixo", () => {
    expect(rejuntarTexto("> [!gap] titulo\n> corpo um\n> corpo dois\n")).toBe("> [!gap] titulo corpo um corpo dois\n");
  });

  test("Dado lista numerada com continuação, Quando rejunto, Então o item fica numa linha e o seguinte não é tocado", () => {
    expect(rejuntarTexto("1. item um\n   continua\n2. item dois\n")).toBe("1. item um continua\n2. item dois\n");
  });

  test("Dado linhas 'Rótulo: valor' empilhadas, Quando rejunto, Então não se fundem", () => {
    const texto = "Resumo: primeiro\nOutro: segundo\ncontinua aqui\n";
    expect(rejuntarTexto(texto)).toBe(texto);
  });

  test("Dado rótulo com parêntese aberto, Quando rejunto, Então a próxima linha é continuação", () => {
    expect(rejuntarTexto("Nota: texto (aberto\nfecha aqui)\n")).toBe("Nota: texto (aberto fecha aqui)\n");
  });

  test("Dado rótulo terminado em vírgula, Quando rejunto, Então a próxima linha é continuação", () => {
    expect(rejuntarTexto("Nota: termina em,\ncontinua\n")).toBe("Nota: termina em, continua\n");
  });

  test("Dado frontmatter sem o --- de fechamento, Quando rejunto, Então o arquivo inteiro fica intacto", () => {
    const texto = "---\na: 1\nb: 2\n\ntexto\nmais\n";
    expect(rejuntarTexto(texto)).toBe(texto);
  });

  test("Dado heading e régua horizontal entre prosa, Quando rejunto, Então cada um fica na própria linha", () => {
    expect(rejuntarTexto("a\nb\n# T\nc\nd\n---\ne\nf\n")).toBe("a b\n# T\nc d\n---\ne f\n");
  });

  test("Dado texto sem quebra final, Quando rejunto, Então continua sem quebra final", () => {
    expect(rejuntarTexto("um\ndois")).toBe("um dois");
  });

  test("Dado CRLF e CR solto, Quando rejunto, Então o resultado usa só LF", () => {
    expect(rejuntarTexto("um\r\ndois\r\n\r\ntres\rquatro\r\n")).toBe("um dois\n\ntres quatro\n");
  });

  test("Dado BOM antes do frontmatter, Quando rejunto, Então o frontmatter segue intacto e o BOM é mantido", () => {
    const texto = "\ufeff---\ntitle: x\n---\n\nlinha um\nlinha dois\n";
    expect(rejuntarTexto(texto)).toBe("\ufeff---\ntitle: x\n---\n\nlinha um linha dois\n");
  });

  test("Dado BOM antes de um heading, Quando rejunto, Então o heading não vira prosa", () => {
    expect(rejuntarTexto("\ufeff# Titulo\ntexto\nmais\n")).toBe("\ufeff# Titulo\ntexto mais\n");
  });

  test("Dado separadores de linha do str.splitlines (FF, NEL, LS), Quando rejunto, Então quebram a linha como no original", () => {
    expect(rejuntarTexto("um\fdois\ntres\n")).toBe("um dois tres\n");
    expect(rejuntarTexto("um\x85dois\n")).toBe("um dois\n");
    expect(rejuntarTexto("um\u2028dois\n")).toBe("um dois\n");
    expect(rejuntarTexto("um\vdois\n")).toBe("um dois\n");
    expect(rejuntarTexto("um\x1cdois\x1d tres\x1e quatro\n")).toBe("um dois tres quatro\n");
  });

  test("Dado espaços Unicode nas pontas, Quando rejunto, Então são aparados como o str.strip do original", () => {
    expect(rejuntarTexto("um\xa0\n\u3000dois\n")).toBe("um dois\n");
  });

  test("Dado texto vazio, Quando rejunto, Então devolve vazio", () => {
    expect(rejuntarTexto("")).toBe("");
    expect(rejuntarTexto("\n")).toBe("\n");
    expect(rejuntarTexto("\n\n")).toBe("\n\n");
  });

  test("Dado item de lista vazio seguido de continuação, Quando rejunto, Então o prefixo é mantido", () => {
    expect(rejuntarTexto("- \n  texto\n")).toBe("- texto\n");
  });

  test("Dado dígitos Unicode no marcador de lista, Quando rejunto, Então \\d do original é reproduzido (Nd)", () => {
    expect(rejuntarTexto("١. item\n   continua\n")).toBe("١. item continua\n");
  });
});

describe("rejuntar-linhas: BOM e CRLF no arquivo", () => {
  test("Dado um arquivo CRLF, Quando rodo, Então ele é reescrito com LF e conta como mudado", async () => {
    const caminho = join(pasta, "crlf.md");
    writeFileSync(caminho, "um\r\ndois\r\n");
    const r = await rejuntarLinhas(caminho);
    expect(r.mudariam).toEqual([caminho]);
    expect(readFileSync(caminho, "utf8")).toBe("um dois\n");
  });

  test("Dado um arquivo com BOM, Quando rodo, Então o BOM sobrevive na gravação", async () => {
    const caminho = join(pasta, "bom.md");
    writeFileSync(caminho, "\ufeffa\nb\n");
    await rejuntarLinhas(caminho);
    expect(readFileSync(caminho)[0]).toBe(0xef);
    expect(readFileSync(caminho, "utf8")).toBe("\ufeffa b\n");
  });
});

describe("rejuntar-linhas: diff unificado", () => {
  test("Dado duas mudanças distantes, Quando peço o diff, Então saem dois hunks com 3 linhas de contexto", async () => {
    const meio = Array.from({ length: 12 }, (_, i) => `\nmeio ${i}`).join("\n");
    const caminho = join(pasta, "longa.md");
    writeFileSync(caminho, `a\nb\n${meio}\n\nc\nd\n`);
    const r = await capturar(() => comandoRejuntarLinhas([caminho, "--simular", "--diff"]));
    expect(r.saida.match(/^@@ /gm)).toHaveLength(2);
    expect(r.saida).toContain("@@ -1,5 +1,4 @@");
    expect(r.saida).toContain("-a\n-b\n+a b");
  });

  test("Dado um arquivo sem LF final, Quando peço o diff, Então a linha ganha a marca de falta de quebra", async () => {
    const caminho = join(pasta, "sem-fim.md");
    writeFileSync(caminho, "um\ndois");
    const r = await capturar(() => comandoRejuntarLinhas([caminho, "--simular", "--diff"]));
    expect(r.saida).toBe(
      `--- ${caminho}\n+++ ${caminho} (rejuntado)\n@@ -1,2 +1 @@\n-um\n-dois\n\\ No newline at end of file\n+um dois\n\\ No newline at end of file`,
    );
  });
});

describe("rejuntar-linhas: falhas ao gravar", () => {
  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "Dado um arquivo somente leitura, Quando rodo, Então sai 1 nomeando o arquivo",
    async () => {
      const caminho = join(pasta, "leitura.md");
      writeFileSync(caminho, "a\nb\n");
      chmodSync(caminho, 0o444);
      const r = await capturar(() => comandoRejuntarLinhas([caminho]));
      chmodSync(caminho, 0o644);
      expect(r.codigo).toBe(1);
      expect(r.erro).toContain("não foi possível gravar");
      expect(r.erro).toContain("leitura.md");
    },
  );

  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "Dado um subdiretório sem permissão, Quando varro, Então sai 1 nomeando a pasta",
    async () => {
      mkdirSync(join(pasta, "fechada"));
      chmodSync(join(pasta, "fechada"), 0o000);
      const r = await capturar(() => comandoRejuntarLinhas([pasta]));
      chmodSync(join(pasta, "fechada"), 0o755);
      expect(r.codigo).toBe(1);
      expect(r.erro).toContain("fechada");
    },
  );
});

describe("rejuntar-linhas: atribuição", () => {
  test("Dado o módulo derivado do wiki-wonka, Quando leio o fim do arquivo, Então o rodapé cita projeto, titular, licença e LICENSE", () => {
    const fonte = readFileSync(join(import.meta.dir, "..", "src", "comandos", "rejuntar-linhas.ts"), "utf8");
    const rodape = fonte.trimEnd().split("\n").slice(-6).join("\n");
    for (const elemento of ["https://github.com/cooperacode/wiki-wonka", "Coopera Code", "licença MIT", "LICENSE"]) {
      expect(rodape).toContain(elemento);
    }
  });
});
