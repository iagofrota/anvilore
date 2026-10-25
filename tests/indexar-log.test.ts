import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import * as fsp from "node:fs/promises";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexarLog, comandoIndexarLog } from "../src/comandos/indexar-log";
import { executar } from "../src/cli";

let temporario: string;
let wiki: string;

beforeEach(() => {
  temporario = mkdtempSync(join(tmpdir(), "anvilore-indexar-log-"));
  wiki = join(temporario, "wiki");
  mkdirSync(join(wiki, "log"), { recursive: true });
});

afterEach(() => rmSync(temporario, { recursive: true, force: true }));

function dia(data: string, conteudo: string): void {
  writeFileSync(join(wiki, "log", `log-${data}.md`), conteudo);
}

function montarDias(): void {
  dia("2026-09-01", "## [2026-09-01] ingest | Primeira fonte\n## [2026-09-01] nota | Observacao solta\n");
  dia("2026-09-02", "## [2026-09-02] ingest | Segunda fonte\n```markdown\n## [2026-09-02] ingest | Nao conta\n```\n");
  dia("2026-10-05", "## [2026-10-05] revisao | Passada de revisao\n");
}

function log(): string {
  return readFileSync(join(wiki, "log.md"), "utf8");
}

async function capturar(acao: () => Promise<number>): Promise<{ codigo: number; saida: string[]; erro: string[] }> {
  const saida: string[] = [];
  const erro: string[] = [];
  const stdout = spyOn(console, "log").mockImplementation((...args) => saida.push(args.join(" ")));
  const stderr = spyOn(console, "error").mockImplementation((...args) => erro.push(args.join(" ")));
  try {
    return { codigo: await acao(), saida, erro };
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
}

test("Dado três arquivos de dia, Quando indexo, Então wiki/log.md é gerado", async () => {
  montarDias();
  const resultado = await indexarLog(wiki);
  expect(resultado.escreveu).toBe(true);
  expect(existsSync(join(wiki, "log.md"))).toBe(true);
});

test("Dado três arquivos de dia, Quando indexo duas vezes, Então a saída é byte-identica", async () => {
  montarDias();
  await indexarLog(wiki);
  const primeiro = readFileSync(join(wiki, "log.md"));
  await indexarLog(wiki);
  expect(readFileSync(join(wiki, "log.md"))).toEqual(primeiro);
});

test("Dado quatro entradas em três dias, Quando indexo, Então o cabeçalho conta 4 entradas em 3 dias", async () => {
  montarDias();
  await indexarLog(wiki);
  expect(log()).toContain("4 entradas em 3 dias");
});

test.each(["2026-09-01", "2026-09-02", "2026-10-05"])(
  "Dado o arquivo de %s, Quando indexo, Então o índice lista o dia",
  async (data) => {
    montarDias();
    await indexarLog(wiki);
    expect(log()).toContain(`[[log-${data}]]`);
  },
);

test("Dado um titulo dentro de code fence, Quando indexo, Então não conto a entrada", async () => {
  montarDias();
  await indexarLog(wiki);
  expect(log()).toContain("[[log-2026-09-02]] — 1 ");
});

test("Dado dias em dois meses, Quando indexo, Então crio duas seções de mês", async () => {
  montarDias();
  await indexarLog(wiki);
  expect(log().match(/^## 2026-/gm)).toHaveLength(2);
});

test("Dado dias em setembro e outubro, Quando indexo, Então o mês mais recente vem primeiro", async () => {
  montarDias();
  await indexarLog(wiki);
  expect(log().match(/^## 2026-.*$/gm)?.[0]).toBe("## 2026-10 — 1 entradas");
});

test("Dado log.md existente, Quando uso --stdout, Então não escrevo wiki/log.md", async () => {
  montarDias();
  writeFileSync(join(wiki, "log.md"), "# Log original\n");
  const r = await indexarLog(wiki, { stdout: true });
  expect(r.escreveu).toBe(false);
  expect(r.saida).toContain("4 entradas em 3 dias");
  expect(log()).toBe("# Log original\n");
});

test("Dado log vazio, Quando indexo, Então saio 0 e aviso LOG: nada a indexar", async () => {
  const r = await capturar(() => comandoIndexarLog([wiki]));
  expect(r.codigo).toBe(0);
  expect(r.saida.join("\n")).toContain("LOG: nada a indexar");
  expect(r.erro).toEqual([]);
});

test("Dado log.md do clone e log vazio, Quando indexo, Então preservo os bytes", async () => {
  writeFileSync(join(wiki, "log.md"), "# Log\n\nRegistro do que foi ingerido.\n");
  const antes = readFileSync(join(wiki, "log.md"));
  const r = await indexarLog(wiki);
  expect(r.escreveu).toBe(false);
  expect(readFileSync(join(wiki, "log.md"))).toEqual(antes);
});

test("Dado log antes vazio e novo arquivo de dia, Quando indexo, Então o hash muda", async () => {
  writeFileSync(join(wiki, "log.md"), "# Log\n");
  const antes = readFileSync(join(wiki, "log.md"));
  dia("2026-11-01", "## [2026-11-01] nota | Primeira entrada de verdade\n");
  await indexarLog(wiki);
  expect(readFileSync(join(wiki, "log.md")).equals(antes)).toBe(false);
});

test("Dado dois tipos com mesma contagem, Quando indexo, Então ordeno alfabeticamente", async () => {
  dia("2026-09-01", "## [2026-09-01] zeta | x\n## [2026-09-01] alfa | y\n");
  await indexarLog(wiki);
  expect(log()).toContain("2 · alfa ×1, zeta ×1");
});

test("Dado flag desconhecida, Quando executo o subcomando, Então saio 1 e explico o erro", async () => {
  const r = await capturar(() => comandoIndexarLog([wiki, "--invalida"]));
  expect(r.codigo).toBe(1);
  expect(r.erro).toEqual(["FAIL: flag desconhecida: --invalida"]);
});

test("Dado indexar-log registrado no CLI, Quando executo, Então devolvo 0 e imprimo o resumo", async () => {
  montarDias();
  const r = await capturar(() => executar(["indexar-log", wiki]));
  expect(r.codigo).toBe(0);
  expect(r.saida.join("\n")).toContain("LOG: 4 entradas em 3 dias");
});

test("Dado arquivo de dia com CRLF, Quando indexo, Então o tipo não inclui o título", async () => {
  dia("2026-09-01", "## [2026-09-01] ingest | a\r\n## [2026-09-01] nota | b\r\n");
  await indexarLog(wiki);
  expect(log()).toContain("2 · ingest ×1, nota ×1");
});

test("Dado log.md existente, Quando uso --stdout pelo comando, Então imprimo o índice sem escrever", async () => {
  montarDias();
  writeFileSync(join(wiki, "log.md"), "# Log original\n");
  const antes = readFileSync(join(wiki, "log.md"));
  const r = await capturar(() => comandoIndexarLog([wiki, "--stdout"]));
  expect(r.codigo).toBe(0);
  expect(r.saida.join("\n")).toContain("4 entradas em 3 dias");
  expect(readFileSync(join(wiki, "log.md"))).toEqual(antes);
});

test("Dado wiki sem pasta log, Quando indexo, Então aviso e preservo log.md", async () => {
  rmSync(join(wiki, "log"), { recursive: true });
  writeFileSync(join(wiki, "log.md"), "# Log do clone\n");
  const antes = readFileSync(join(wiki, "log.md"));
  const r = await capturar(() => comandoIndexarLog([wiki]));
  expect(r.codigo).toBe(0);
  expect(r.saida.join("\n")).toContain("LOG: nada a indexar");
  expect(readFileSync(join(wiki, "log.md"))).toEqual(antes);
});

test("Dado pasta log apenas com .gitkeep, Quando indexo, Então aviso e preservo log.md", async () => {
  writeFileSync(join(wiki, "log", ".gitkeep"), "");
  writeFileSync(join(wiki, "log.md"), "# Log do clone\n");
  const antes = readFileSync(join(wiki, "log.md"));
  const r = await capturar(() => comandoIndexarLog([wiki]));
  expect(r.codigo).toBe(0);
  expect(r.saida.join("\n")).toContain("LOG: nada a indexar");
  expect(readFileSync(join(wiki, "log.md"))).toEqual(antes);
});

test("Dado wiki/log como arquivo, Quando indexo, Então saio 0 com LOG e AVISO sem stack trace", async () => {
  rmSync(join(wiki, "log"), { recursive: true });
  writeFileSync(join(wiki, "log"), "arquivo no lugar da pasta\n");
  writeFileSync(join(wiki, "log.md"), "# Log do clone\n");
  const antes = readFileSync(join(wiki, "log.md"));
  const r = await capturar(() => comandoIndexarLog([wiki]));
  expect(r.codigo).toBe(0);
  expect(r.saida.join("\n")).toContain("LOG: nada a indexar");
  expect(r.erro.join("\n")).toContain(`AVISO: ${join(wiki, "log")} não é diretório`);
  expect(r.erro.join("\n")).not.toContain("at ");
  expect(readFileSync(join(wiki, "log.md"))).toEqual(antes);
});

test("Dado erro de escrita em log.md, Quando indexo pelo comando, Então saio 1 com caminho e sem stack trace", async () => {
  dia("2026-09-01", "## [2026-09-01] nota | x\n");
  mkdirSync(join(wiki, "log.md"));
  const r = await capturar(() => comandoIndexarLog([wiki]));
  expect(r.codigo).toBe(1);
  expect(r.erro.join("\n")).toContain("FAIL:");
  expect(r.erro.join("\n")).toContain(join(wiki, "log.md"));
  expect(r.erro.join("\n")).not.toContain("at ");
});

test("Dado um erro de escrita cujo path aponta para a pasta (como no Windows), Quando indexo pelo comando, Então a mensagem nomeia o log.md e não o path do erro", async () => {
  dia("2026-09-01", "## [2026-09-01] nota | x\n");
  const escrita = spyOn(fsp, "writeFile").mockRejectedValue(
    Object.assign(new Error("EISDIR: illegal operation on a directory, write"), {
      code: "EISDIR",
      syscall: "write",
      path: wiki,
    }),
  );
  try {
    const r = await capturar(() => comandoIndexarLog([wiki]));
    expect(r.codigo).toBe(1);
    expect(r.erro).toEqual([`FAIL: ${join(wiki, "log.md")}: EISDIR: illegal operation on a directory, write`]);
  } finally {
    escrita.mockRestore();
  }
});

const semLink = process.platform === "win32";

test.skipIf(semLink)(
  "Dado arquivo de dia que é symlink para arquivo (pulado no Windows: criar symlink exige privilégio), Quando indexo, Então o dia entra no índice",
  async () => {
    montarDias();
    writeFileSync(join(temporario, "alvo.md"), "## [2026-11-03] nota | Via link\n");
    symlinkSync(join("..", "..", "alvo.md"), join(wiki, "log", "log-2026-11-03.md"));
    const r = await capturar(() => comandoIndexarLog([wiki]));
    expect(r.codigo).toBe(0);
    expect(r.erro).toEqual([]);
    expect(log()).toContain("5 entradas em 4 dias");
    expect(log()).toContain("- [[log-2026-11-03]] — 1 · nota ×1");
  },
);

test.skipIf(semLink)(
  "Dado arquivo de dia que é link quebrado (pulado no Windows), Quando indexo, Então avisa em stderr nomeando o caminho e indexa o resto",
  async () => {
    montarDias();
    symlinkSync("nao-existe.md", join(wiki, "log", "log-2026-11-04.md"));
    const r = await capturar(() => comandoIndexarLog([wiki]));
    expect(r.codigo).toBe(0);
    expect(r.erro).toEqual([`AVISO: link quebrado: ${join(wiki, "log", "log-2026-11-04.md")}`]);
    expect(log()).toContain("4 entradas em 3 dias");
    expect(log()).not.toContain("log-2026-11-04");
  },
);

test.skipIf(semLink)(
  "Dado arquivo de dia que é link para diretório (pulado no Windows), Quando indexo, Então avisa que não é arquivo e segue",
  async () => {
    montarDias();
    mkdirSync(join(temporario, "pasta"));
    symlinkSync(join("..", "..", "pasta"), join(wiki, "log", "log-2026-11-05.md"));
    const r = await capturar(() => comandoIndexarLog([wiki]));
    expect(r.codigo).toBe(0);
    expect(r.erro).toEqual([`AVISO: não é arquivo: ${join(wiki, "log", "log-2026-11-05.md")}`]);
    expect(log()).toContain("4 entradas em 3 dias");
  },
);

test.skipIf(semLink)(
  "Dado arquivo de dia que é laço de symlinks (pulado no Windows), Quando indexo, Então avisa que o link é ilegível e segue",
  async () => {
    montarDias();
    symlinkSync("log-2026-11-06.md", join(wiki, "log", "log-2026-11-06.md"));
    const r = await capturar(() => comandoIndexarLog([wiki]));
    expect(r.codigo).toBe(0);
    expect(r.erro).toEqual([`AVISO: link ilegível: ${join(wiki, "log", "log-2026-11-06.md")}: ELOOP`]);
  },
);

test.skipIf(semLink)(
  "Dado só um link quebrado na pasta log, Quando indexo, Então avisa o link, informa que não há o que indexar e preserva log.md",
  async () => {
    writeFileSync(join(wiki, "log.md"), "original\n");
    symlinkSync("nao-existe.md", join(wiki, "log", "log-2026-11-04.md"));
    const r = await capturar(() => comandoIndexarLog([wiki]));
    expect(r.codigo).toBe(0);
    expect(r.erro).toEqual([`AVISO: link quebrado: ${join(wiki, "log", "log-2026-11-04.md")}`]);
    expect(r.saida.join("\n")).toContain("LOG: nada a indexar");
    expect(log()).toBe("original\n");
  },
);

test.skipIf(semLink)(
  "Dado link quebrado, Quando uso indexarLog direto, Então o resultado traz o aviso em avisos",
  async () => {
    montarDias();
    symlinkSync("nao-existe.md", join(wiki, "log", "log-2026-11-04.md"));
    const r = await indexarLog(wiki);
    expect(r.avisos).toEqual([`link quebrado: ${join(wiki, "log", "log-2026-11-04.md")}`]);
  },
);

test("Dado módulo portado, Quando confiro o rodapé, Então preservo os quatro elementos da atribuição B8", () => {
  const codigo = readFileSync(join(import.meta.dir, "..", "src", "comandos", "indexar-log.ts"), "utf8");
  const rodape = codigo.split("\n").slice(-5).join("\n");
  for (const elemento of ["https://github.com/cooperacode/wiki-wonka", "Coopera Code", "licença MIT", "LICENSE"]) {
    expect(rodape).toContain(elemento);
  }
});
