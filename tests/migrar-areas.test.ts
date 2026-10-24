import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ErroDeMigracao, comandoMigrarAreas, migrarAreas } from "../src/comandos/migrar-areas";
import { executar, subcomandos } from "../src/cli";

let tmp: string;
let wiki: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "anvilore-areas-"));
  wiki = join(tmp, "wiki");
  mkdirSync(join(wiki, "_meta"), { recursive: true });
  mkdirSync(join(wiki, "log"));
  mkdirSync(join(wiki, "sources"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function gravar(relativo: string, conteudo: string, raiz: string = wiki): void {
  const caminho = join(raiz, relativo);
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, conteudo);
}

function ler(relativo: string, raiz: string = wiki): string {
  return readFileSync(join(raiz, relativo), "utf8");
}

function conteudoDaPagina(slug: string, tipo: string): string {
  return `---\ntitle: "${slug}"\nslug: ${slug}\ntype: ${tipo}\ntags: []\n---\n\nCorpo da pagina ${slug}.\n`;
}

function mapa(linhas: string[], raiz: string = wiki): void {
  gravar(
    "_meta/migration-routing.md",
    `# Roteamento de migracao (fixture sintetica)\n\n<!-- ROUTING-START -->\n| page | area |\n|---|---|\n${linhas.join("\n")}\n<!-- ROUTING-END -->\n`,
    raiz,
  );
}

function fixture(): void {
  gravar("pagina-um.md", conteudoDaPagina("pagina-um", "concept"));
  gravar("sources/pagina-dois.md", conteudoDaPagina("pagina-dois", "source"));
  mapa(["| pagina-um | alfa |", "| sources/pagina-dois | beta |"]);
}

async function capturar<T>(corpo: () => Promise<T>) {
  const saida: string[] = [];
  const erro: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...a) => {
    saida.push(a.join(" "));
  });
  const err = spyOn(console, "error").mockImplementation((...a) => {
    erro.push(a.join(" "));
  });
  try {
    const codigo = await corpo();
    return { codigo, saida, erro };
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
}

function git(cwd: string, ...args: string[]): string {
  const r = Bun.spawnSync(["git", "-c", "user.name=teste", "-c", "user.email=teste@exemplo.org", ...args], { cwd });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

function contarArea(texto: string): number {
  return texto.split("\n").filter((l) => l.startsWith("area: ")).length;
}

describe("migrar-areas: simulação", () => {
  beforeEach(fixture);

  test("Dado --simular, Quando migro, Então sai 0 e nada se move nem se cria", async () => {
    const r = await capturar(() => comandoMigrarAreas([wiki, "--simular"]));
    expect(r.codigo).toBe(0);
    expect(existsSync(join(wiki, "pagina-um.md"))).toBe(true);
    expect(existsSync(join(wiki, "sources", "pagina-dois.md"))).toBe(true);
    expect(existsSync(join(wiki, "alfa"))).toBe(false);
    expect(existsSync(join(wiki, "beta"))).toBe(false);
  });

  test("Dado --simular, Quando migro, Então relata os 2 movimentos com moveria", async () => {
    const r = await capturar(() => comandoMigrarAreas([wiki, "--simular"]));
    expect(r.saida.filter((l) => l.startsWith("moveria: "))).toHaveLength(2);
    expect(r.saida).toContain("moveria: pagina-um → alfa/pagina-um");
    expect(r.saida).toContain("moveria: sources/pagina-dois → beta/sources/pagina-dois");
    expect(r.saida.at(-1)).toBe("MIGRACAO (simulacao): 2 moveria(m), 0 ja migrada(s), 0 ausente(s)");
  });

  test("Dado o alias --dry-run, Quando migro, Então se comporta como --simular", async () => {
    const r = await capturar(() => comandoMigrarAreas(["--dry-run", wiki]));
    expect(r.codigo).toBe(0);
    expect(existsSync(join(wiki, "pagina-um.md"))).toBe(true);
    expect(r.saida.at(-1)).toContain("MIGRACAO (simulacao)");
  });

  test("Dado uma página já migrada sem area:, Quando simulo, Então o arquivo não é escrito", async () => {
    gravar("alfa/pronta.md", conteudoDaPagina("pronta", "concept"));
    mapa(["| pronta | alfa |"]);
    const antes = ler("alfa/pronta.md");
    const r = await capturar(() => comandoMigrarAreas([wiki, "--simular"]));
    expect(r.saida).toContain("ja migrada: pronta → alfa/pronta");
    expect(ler("alfa/pronta.md")).toBe(antes);
  });

  test("Dado --simular, Quando migro, Então os diretórios vazios não são limpos", async () => {
    mapa([]);
    await capturar(() => comandoMigrarAreas([wiki, "--simular"]));
    expect(existsSync(join(wiki, "sources"))).toBe(true);
  });
});

describe("migrar-areas: execução real", () => {
  beforeEach(fixture);

  test("Dado o mapa com 2 páginas, Quando migro de verdade, Então sai 0 e as páginas vão para as áreas (a checagem da simulação tem dentes)", async () => {
    const r = await capturar(() => comandoMigrarAreas([wiki]));
    expect(r.codigo).toBe(0);
    expect(existsSync(join(wiki, "pagina-um.md"))).toBe(false);
    expect(existsSync(join(wiki, "alfa", "pagina-um.md"))).toBe(true);
    expect(existsSync(join(wiki, "sources", "pagina-dois.md"))).toBe(false);
    expect(existsSync(join(wiki, "beta", "sources", "pagina-dois.md"))).toBe(true);
    expect(r.saida).toContain("movida: pagina-um → alfa/pagina-um");
    expect(r.saida.at(-1)).toBe("MIGRACAO: 2 movida(s), 0 ja migrada(s), 0 ausente(s)");
  });

  test("Dado a migração, Quando devolvo o resultado, Então movidas lista as páginas do mapa", async () => {
    const r = await migrarAreas(wiki);
    expect(r.movidas).toEqual(["pagina-um", "sources/pagina-dois"]);
    expect(r.jaMigradas).toEqual([]);
    expect(r.ausentes).toEqual([]);
  });

  test("Dado a migração, Quando leio a página movida, Então area: vem logo após type: e o corpo é preservado", async () => {
    await migrarAreas(wiki);
    const alfa = ler("alfa/pagina-um.md");
    expect(contarArea(alfa)).toBe(1);
    const linhas = alfa.split("\n");
    expect(linhas[linhas.findIndex((l) => l.startsWith("type: ")) + 1]).toBe("area: alfa");
    expect(alfa).toContain("Corpo da pagina pagina-um");
    const beta = ler("beta/sources/pagina-dois.md").split("\n");
    expect(beta[beta.findIndex((l) => l.startsWith("type: ")) + 1]).toBe("area: beta");
  });

  test("Dado uma terceira execução sobre o novo estado, Quando migro, Então sai 0, relata ja migrada e não duplica area:", async () => {
    await migrarAreas(wiki);
    const r = await capturar(() => comandoMigrarAreas([wiki]));
    expect(r.codigo).toBe(0);
    expect(r.saida).toContain("ja migrada: pagina-um → alfa/pagina-um");
    expect(r.saida.at(-1)).toBe("MIGRACAO: 0 movida(s), 2 ja migrada(s), 0 ausente(s)");
    expect(contarArea(ler("alfa/pagina-um.md"))).toBe(1);
    expect(contarArea(ler("beta/sources/pagina-dois.md"))).toBe(1);
  });

  test("Dado uma página já no destino sem area:, Quando migro, Então o campo é injetado", async () => {
    gravar("alfa/pronta.md", conteudoDaPagina("pronta", "concept"));
    mapa(["| pronta | alfa |"]);
    await migrarAreas(wiki);
    expect(ler("alfa/pronta.md")).toContain("type: concept\narea: alfa\n");
  });

  test("Dado a migração, Quando termina, Então o sources/ que ficou vazio é removido", async () => {
    await migrarAreas(wiki);
    expect(existsSync(join(wiki, "sources"))).toBe(false);
  });

  test("Dado log/ e _meta/ vazios ou não, Quando migro, Então os reservados são preservados", async () => {
    await migrarAreas(wiki);
    expect(existsSync(join(wiki, "log"))).toBe(true);
    expect(existsSync(join(wiki, "_meta"))).toBe(true);
  });

  test("Dado diretórios de topo vazios, não vazios e ocultos, Quando migro, Então só os vazios não reservados e não ocultos somem", async () => {
    mkdirSync(join(wiki, "vazio"));
    mkdirSync(join(wiki, ".oculto"));
    gravar("cheio/x.md", "x\n");
    await migrarAreas(wiki);
    expect(existsSync(join(wiki, "vazio"))).toBe(false);
    expect(existsSync(join(wiki, ".oculto"))).toBe(true);
    expect(existsSync(join(wiki, "cheio", "x.md"))).toBe(true);
  });

  test("Dado uma página sem linha type:, Quando migro, Então ela é movida e o conteúdo fica intacto", async () => {
    gravar("solta.md", "sem frontmatter\n");
    mapa(["| solta | alfa |"]);
    await migrarAreas(wiki);
    expect(ler("alfa/solta.md")).toBe("sem frontmatter\n");
  });

  test("Dado uma página com fim de linha CRLF, Quando migro, Então area: respeita o fim de linha e o resto fica byte a byte", async () => {
    gravar("crlf.md", "---\r\ntype: concept\r\n---\r\n\r\nCorpo.\r\n");
    mapa(["| crlf | alfa |"]);
    await migrarAreas(wiki);
    expect(ler("alfa/crlf.md")).toBe("---\r\ntype: concept\r\narea: alfa\r\n---\r\n\r\nCorpo.\r\n");
  });

  test("Dado um arquivo sem quebra de linha no fim, Quando migro, Então não acrescento uma", async () => {
    gravar("sem-fim.md", "type: concept");
    mapa(["| sem-fim | alfa |"]);
    await migrarAreas(wiki);
    expect(ler("alfa/sem-fim.md")).toBe("type: concept\narea: alfa");
  });
});

describe("migrar-areas: leitura do mapa", () => {
  test("Dado uma página no mapa que não existe no disco, Quando migro, Então sai 0 e relata ausente", async () => {
    mapa(["| nunca-existiu | gama |"]);
    const r = await capturar(() => comandoMigrarAreas([wiki]));
    expect(r.codigo).toBe(0);
    expect(r.saida).toContain("ausente (nem na origem nem no destino): nunca-existiu");
    expect(r.saida.at(-1)).toBe("MIGRACAO: 0 movida(s), 0 ja migrada(s), 1 ausente(s)");
  });

  test("Dado um mapa inexistente, Quando migro, Então reprova em voz alta", async () => {
    const r = await capturar(() => comandoMigrarAreas([wiki]));
    expect(r.codigo).toBe(1);
    expect(r.erro).toEqual([`FAIL: mapa de roteamento ausente: ${join(wiki, "_meta", "migration-routing.md")}`]);
  });

  test("Dado a linha separadora e o cabeçalho da tabela, Quando migro, Então nenhum dos dois vira página", async () => {
    mapa([]);
    const r = await migrarAreas(wiki);
    expect(r).toEqual({ movidas: [], jaMigradas: [], ausentes: [], conflitos: [], falhas: [], avisos: [], relato: [] });
  });

  test("Dado linhas fora dos marcadores, Quando migro, Então são ignoradas", async () => {
    gravar("fora.md", "x\n");
    gravar(
      "_meta/migration-routing.md",
      "| fora | alfa |\n<!-- ROUTING-START -->\n<!-- ROUTING-END -->\n| fora | alfa |\n",
    );
    expect((await migrarAreas(wiki)).movidas).toEqual([]);
    expect(existsSync(join(wiki, "fora.md"))).toBe(true);
  });

  test("Dado dois blocos de marcadores, Quando migro, Então os dois valem", async () => {
    gravar("a.md", "type: x\n");
    gravar("b.md", "type: x\n");
    gravar(
      "_meta/migration-routing.md",
      "<!-- ROUTING-START -->\n| a | alfa |\n<!-- ROUTING-END -->\ntexto\n<!-- ROUTING-START -->\n| b | beta |\n<!-- ROUTING-END -->\n",
    );
    expect((await migrarAreas(wiki)).movidas).toEqual(["a", "b"]);
  });

  test("Dado ROUTING-START sem ROUTING-END, Quando migro, Então o mapa vai até o fim do arquivo", async () => {
    gravar("a.md", "type: x\n");
    gravar("_meta/migration-routing.md", "<!-- ROUTING-START -->\n| a | alfa |\n");
    expect((await migrarAreas(wiki)).movidas).toEqual(["a"]);
  });

  test("Dado um mapa sem nenhum marcador, Quando migro, Então avisa em voz alta em vez de fingir que não havia nada", async () => {
    gravar("_meta/migration-routing.md", "| a | alfa |\n");
    const r = await capturar(() => comandoMigrarAreas([wiki]));
    expect(r.codigo).toBe(0);
    expect(r.erro.join("\n")).toContain("AVISO: o mapa não tem os marcadores ROUTING-START e ROUTING-END");
  });

  test("Dado um mapa com CRLF e espaços extras, Quando migro, Então as células são aparadas", async () => {
    gravar("a.md", "type: x\n");
    gravar("_meta/migration-routing.md", "<!-- ROUTING-START -->\r\n|   a   |   alfa   |\r\n<!-- ROUTING-END -->\r\n");
    await migrarAreas(wiki);
    expect(ler("alfa/a.md")).toContain("area: alfa\n");
  });

  test("Dado linhas com página fora do padrão de slug, sem área ou a página chamada page, Quando migro, Então são ignoradas", async () => {
    gravar("Maiuscula.md", "type: x\n");
    gravar("sem-area.md", "type: x\n");
    gravar("page.md", "type: x\n");
    mapa(["| Maiuscula | alfa |", "| sem-area |", "| sem-area |  |", "| page | alfa |"]);
    const r = await migrarAreas(wiki);
    expect(r.movidas).toEqual([]);
    expect(existsSync(join(wiki, "page.md"))).toBe(true);
  });

  test.each(["..", "../fora", "a/../b", "/abs", "a\\b", "C:x", "a//b", "."])(
    "Dado a área %p que escaparia da wiki, Quando migro, Então reprova antes de mover qualquer coisa",
    async (area) => {
      fixture();
      mapa(["| pagina-um | alfa |", `| sources/pagina-dois | ${area} |`]);
      const r = await capturar(() => comandoMigrarAreas([wiki]));
      expect(r.codigo).toBe(1);
      expect(r.erro.join("\n")).toContain("FAIL: área inválida no mapa");
      expect(existsSync(join(wiki, "pagina-um.md"))).toBe(true);
      expect(existsSync(join(wiki, "alfa"))).toBe(false);
    },
  );

  test("Dado uma área aninhada, Quando migro, Então a página vai para o caminho aninhado", async () => {
    gravar("a.md", "type: x\n");
    mapa(["| a | grupo/sub |"]);
    await migrarAreas(wiki);
    expect(existsSync(join(wiki, "grupo", "sub", "a.md"))).toBe(true);
  });
});

describe("migrar-areas: conflito entre origem e destino", () => {
  test("Dado a página existindo na origem e no destino, Quando migro, Então nada é sobrescrito, o conflito é relatado e sai 1", async () => {
    gravar("a.md", "origem\ntype: x\n");
    gravar("alfa/a.md", "destino\ntype: x\n");
    gravar("b.md", "type: x\n");
    mapa(["| a | alfa |", "| b | alfa |"]);
    const r = await capturar(() => comandoMigrarAreas([wiki]));
    expect(r.codigo).toBe(1);
    expect(r.saida).toContain("conflito (origem e destino existem, nada foi movido): a → alfa/a");
    expect(ler("alfa/a.md")).toBe("destino\ntype: x\n");
    expect(ler("a.md")).toBe("origem\ntype: x\n");
    expect(existsSync(join(wiki, "alfa", "b.md"))).toBe(true);
    expect(r.saida.at(-1)).toBe("MIGRACAO: 1 movida(s), 0 ja migrada(s), 0 ausente(s), 1 conflito(s)");
  });
});

describe("migrar-areas: git mv e rename", () => {
  test("Dado uma wiki dentro de um repositório git com as páginas versionadas, Quando migro, Então a movimentação entra no índice como renomeação", async () => {
    const repo = join(tmp, "repo");
    const w = join(repo, "wiki");
    mkdirSync(join(w, "_meta"), { recursive: true });
    gravar("pagina-um.md", conteudoDaPagina("pagina-um", "concept"), w);
    mapa(["| pagina-um | alfa |"], w);
    git(repo, "init", "-q");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "base");
    await migrarAreas(w);
    expect(existsSync(join(w, "alfa", "pagina-um.md"))).toBe(true);
    expect(git(repo, "status", "--porcelain")).toMatch(/^R. wiki\/pagina-um\.md -> wiki\/alfa\/pagina-um\.md$/m);
  });

  test("Dado uma wiki relativa dentro de um repositório git, Quando migro, Então git mv também é usado", async () => {
    const repo = join(tmp, "repo-rel");
    const w = join(repo, "wiki");
    mkdirSync(join(w, "_meta"), { recursive: true });
    gravar("pagina-um.md", conteudoDaPagina("pagina-um", "concept"), w);
    mapa(["| pagina-um | alfa |"], w);
    git(repo, "init", "-q");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "base");
    const original = process.cwd();
    process.chdir(repo);
    try {
      await migrarAreas("wiki");
    } finally {
      process.chdir(original);
    }
    expect(git(repo, "status", "--porcelain")).toMatch(/^R. wiki\/pagina-um\.md -> wiki\/alfa\/pagina-um\.md$/m);
  });

  test("Dado uma página não versionada num repositório git, Quando migro, Então cai para o rename e a página chega ao destino", async () => {
    const repo = join(tmp, "repo2");
    const w = join(repo, "wiki");
    mkdirSync(join(w, "_meta"), { recursive: true });
    git(repo, "init", "-q");
    gravar("nova.md", conteudoDaPagina("nova", "concept"), w);
    mapa(["| nova | alfa |"], w);
    const r = await migrarAreas(w);
    expect(r.movidas).toEqual(["nova"]);
    expect(existsSync(join(w, "nova.md"))).toBe(false);
    expect(ler("alfa/nova.md", w)).toContain("area: alfa");
  });

  test("Dado uma pasta que não é repositório git, Quando migro, Então usa rename", async () => {
    fixture();
    await migrarAreas(wiki);
    expect(existsSync(join(wiki, "alfa", "pagina-um.md"))).toBe(true);
    expect(existsSync(join(wiki, ".git"))).toBe(false);
  });
});

describe("migrar-areas: simulação com conflito", () => {
  test("Dado a página na origem e no destino, Quando simulo, Então relata o conflito, nada muda e sai 1", async () => {
    gravar("a.md", "origem\ntype: x\n");
    gravar("alfa/a.md", "destino\ntype: x\n");
    mapa(["| a | alfa |"]);
    const r = await capturar(() => comandoMigrarAreas([wiki, "--simular"]));
    expect(r.codigo).toBe(1);
    expect(r.saida).toContain("conflito (origem e destino existem, nada foi movido): a → alfa/a");
    expect(r.saida.at(-1)).toBe("MIGRACAO (simulacao): 0 moveria(m), 0 ja migrada(s), 0 ausente(s), 1 conflito(s)");
    expect(ler("alfa/a.md")).toBe("destino\ntype: x\n");
  });
});

describe("migrar-areas: caminho da wiki vazio", () => {
  test.each(["", "/"])(
    "Dado o caminho da wiki %p e um _meta/ no diretório atual, Quando rodo, Então reprova como o original e nada do diretório atual se move",
    async (arg) => {
      const original = process.cwd();
      const aqui = join(tmp, "aqui");
      gravar("x.md", "type: x\n", aqui);
      mapa(["| x | alfa |"], aqui);
      process.chdir(aqui);
      try {
        const r = await capturar(() => comandoMigrarAreas([arg]));
        expect(r.codigo).toBe(1);
        expect(r.erro).toEqual(["FAIL: mapa de roteamento ausente: /_meta/migration-routing.md"]);
        expect(r.saida).toEqual([]);
      } finally {
        process.chdir(original);
      }
      expect(existsSync(join(aqui, "x.md"))).toBe(true);
      expect(existsSync(join(aqui, "alfa"))).toBe(false);
    },
  );

  test("Dado migrarAreas com wiki vazia, Quando chamo, Então lança ErroDeMigracao antes de tocar em qualquer coisa", async () => {
    await expect(migrarAreas("")).rejects.toBeInstanceOf(ErroDeMigracao);
  });
});

describe("migrar-areas: falha no meio do laço", () => {
  test("Dado uma área que colide com um arquivo, Quando migro, Então a falha é relatada com o que já foi movido, sem stack trace, e sai 1", async () => {
    gravar("a.md", "type: x\n");
    gravar("b.md", "type: x\n");
    gravar("c.md", "type: x\n");
    gravar("ocupada", "isto é um arquivo");
    mapa(["| a | alfa |", "| b | ocupada |", "| c | alfa |"]);
    const r = await capturar(() => comandoMigrarAreas([wiki]));
    expect(r.codigo).toBe(1);
    expect(r.saida).toContain("movida: a → alfa/a");
    expect(r.erro).toHaveLength(1);
    expect(r.erro[0]).toMatch(/^FAIL: b: .+; já movidas: a$/);
    expect(r.erro[0]).not.toContain("\n");
    expect(existsSync(join(wiki, "alfa", "a.md"))).toBe(true);
    expect(existsSync(join(wiki, "b.md"))).toBe(true);
    expect(existsSync(join(wiki, "c.md"))).toBe(true);
    expect(r.saida.at(-1)).toBe("MIGRACAO: 1 movida(s), 0 ja migrada(s), 0 ausente(s), 1 falha(s)");
  });

  test.skipIf(process.platform === "win32")(
    "Dado uma página que é symlink relativo (pulado no Windows: criar symlink exige privilégio), Quando migro, Então relata a falha com o que já foi movido em vez de stack trace",
    async () => {
      gravar("a.md", "type: x\n");
      gravar("real.md", "type: x\n", join(tmp, "fora"));
      symlinkSync(join("..", "fora", "real.md"), join(wiki, "link.md"));
      gravar("b.md", "type: x\n");
      mapa(["| a | alfa |", "| link | alfa |", "| b | alfa |"]);
      const r = await capturar(() => comandoMigrarAreas([wiki]));
      expect(r.codigo).toBe(1);
      expect(r.saida).toContain("movida: a → alfa/a");
      // o link foi movido e só a injeção de area: falhou, então ele consta entre as movidas
      expect(r.erro[0]).toMatch(/^FAIL: link: .+; já movidas: a, link$/);
      expect(existsSync(join(wiki, "b.md"))).toBe(true);
    },
  );

  test("Dado a falha na primeira página, Quando migro, Então a mensagem diz que nada foi movido", async () => {
    gravar("a.md", "type: x\n");
    gravar("ocupada", "arquivo");
    mapa(["| a | ocupada |"]);
    const r = await capturar(() => comandoMigrarAreas([wiki]));
    expect(r.erro[0]).toMatch(/^FAIL: a: .+; já movidas: nenhuma$/);
  });

  test("Dado a falha, Quando migro, Então migrarAreas devolve a falha em falhas em vez de lançar", async () => {
    gravar("a.md", "type: x\n");
    gravar("ocupada", "arquivo");
    mapa(["| a | ocupada |"]);
    const r = await migrarAreas(wiki);
    expect(r.falhas).toHaveLength(1);
    expect(r.movidas).toEqual([]);
  });
});

describe("migrar-areas: links simbólicos (R58)", () => {
  const semLink = process.platform === "win32";

  test.skipIf(semLink)(
    "Dado uma página que é link quebrado (pulado no Windows), Quando migro, Então avisa em stderr e segue relatando ausente",
    async () => {
      symlinkSync("nao-existe.md", join(wiki, "quebrada.md"));
      mapa(["| quebrada | alfa |"]);
      const r = await capturar(() => comandoMigrarAreas([wiki]));
      expect(r.codigo).toBe(0);
      expect(r.erro).toContain(`AVISO: link quebrado: ${join(wiki, "quebrada.md")}`);
      expect(r.saida).toContain("ausente (nem na origem nem no destino): quebrada");
    },
  );

  test.skipIf(semLink)(
    "Dado um link quebrado no topo da wiki (pulado no Windows), Quando migro, Então a limpeza avisa em vez de ignorar calada",
    async () => {
      symlinkSync("nao-existe", join(wiki, "topo"));
      mapa([]);
      const r = await capturar(() => comandoMigrarAreas([wiki]));
      expect(r.erro).toContain(`AVISO: link quebrado: ${join(wiki, "topo")}`);
      expect(r.codigo).toBe(0);
    },
  );

  test.skipIf(semLink)(
    "Dado uma área que é link para fora da wiki (pulado no Windows), Quando migro, Então reprova antes de mover qualquer coisa",
    async () => {
      gravar("a.md", "type: x\n");
      gravar("b.md", "type: x\n");
      mkdirSync(join(tmp, "fora"));
      symlinkSync(join("..", "fora"), join(wiki, "saida"));
      mapa(["| a | alfa |", "| b | saida |"]);
      const r = await capturar(() => comandoMigrarAreas([wiki]));
      expect(r.codigo).toBe(1);
      expect(r.erro.join("\n")).toContain("FAIL: área sai da wiki por link simbólico: saida (página b)");
      expect(existsSync(join(wiki, "a.md"))).toBe(true);
      expect(readdirSync(join(tmp, "fora"))).toEqual([]);
    },
  );

  test.skipIf(semLink)(
    "Dado um segmento intermediário da área que é link para fora (pulado no Windows), Quando migro, Então também reprova",
    async () => {
      gravar("a.md", "type: x\n");
      mkdirSync(join(tmp, "fora"));
      symlinkSync(join("..", "fora"), join(wiki, "saida"));
      mapa(["| a | saida/sub |"]);
      const r = await capturar(() => comandoMigrarAreas([wiki]));
      expect(r.codigo).toBe(1);
      expect(readdirSync(join(tmp, "fora"))).toEqual([]);
    },
  );

  test.skipIf(semLink)(
    "Dado uma área que é link quebrado (pulado no Windows), Quando migro, Então reprova antes de mover",
    async () => {
      gravar("a.md", "type: x\n");
      symlinkSync("nao-existe", join(wiki, "alfa"));
      mapa(["| a | alfa |"]);
      const r = await capturar(() => comandoMigrarAreas([wiki]));
      expect(r.codigo).toBe(1);
      expect(r.erro.join("\n")).toContain("FAIL: área sai da wiki por link simbólico: alfa (página a)");
      expect(existsSync(join(wiki, "a.md"))).toBe(true);
    },
  );

  test.skipIf(semLink)(
    "Dado uma área que é link para dentro da wiki (pulado no Windows), Quando migro, Então segue normalmente",
    async () => {
      gravar("a.md", "type: x\n");
      mkdirSync(join(wiki, "grupo"));
      symlinkSync("grupo", join(wiki, "apelido"));
      mapa(["| a | apelido |"]);
      const r = await capturar(() => comandoMigrarAreas([wiki]));
      expect(r.codigo).toBe(0);
      expect(existsSync(join(wiki, "grupo", "a.md"))).toBe(true);
    },
  );
});

describe("subcomando migrar-areas", () => {
  test("Dado a tabela de subcomandos, Quando listo, Então migrar-areas está registrado", () => {
    expect(Object.keys(subcomandos)).toContain("migrar-areas");
  });

  test("Dado migrar-areas pelo executar, Quando rodo numa wiki válida, Então devolve 0", async () => {
    fixture();
    const r = await capturar(() => executar(["migrar-areas", wiki]));
    expect(r.codigo).toBe(0);
    expect(existsSync(join(wiki, "alfa", "pagina-um.md"))).toBe(true);
  });

  test("Dado uma flag desconhecida, Quando rodo, Então reprova com FAIL e não move nada", async () => {
    fixture();
    const r = await capturar(() => comandoMigrarAreas([wiki, "--forcar"]));
    expect(r.codigo).toBe(1);
    expect(r.erro).toEqual(["FAIL: flag desconhecida: --forcar"]);
    expect(existsSync(join(wiki, "pagina-um.md"))).toBe(true);
  });

  test("Dado --help, Quando rodo, Então mostra o uso e devolve 2", async () => {
    const r = await capturar(() => comandoMigrarAreas(["--help"]));
    expect(r.codigo).toBe(2);
    expect(r.erro.join("\n")).toContain("Uso: anvilore migrar-areas [WIKI] [--simular]");
  });

  test("Dado o caminho da wiki com barra no fim, Quando rodo, Então a barra é ignorada", async () => {
    fixture();
    const r = await capturar(() => comandoMigrarAreas([`${wiki}/`]));
    expect(r.codigo).toBe(0);
    expect(existsSync(join(wiki, "alfa", "pagina-um.md"))).toBe(true);
  });

  test("Dado nenhum argumento, Quando rodo, Então usa ./wiki a partir do diretório atual", async () => {
    const original = process.cwd();
    const raiz = join(tmp, "projeto");
    mkdirSync(join(raiz, "wiki", "_meta"), { recursive: true });
    gravar("a.md", "type: x\n", join(raiz, "wiki"));
    mapa(["| a | alfa |"], join(raiz, "wiki"));
    process.chdir(raiz);
    try {
      const r = await capturar(() => comandoMigrarAreas([]));
      expect(r.codigo).toBe(0);
      expect(existsSync(join(raiz, "wiki", "alfa", "a.md"))).toBe(true);
    } finally {
      process.chdir(original);
    }
  });

  test("Dado um erro de migração, Quando comparo, Então ErroDeMigracao é o tipo lançado", async () => {
    await expect(migrarAreas(wiki)).rejects.toBeInstanceOf(ErroDeMigracao);
  });
});

describe("migrar-areas: atribuição", () => {
  test("Dado o módulo derivado do wiki-wonka, Quando leio o fim do arquivo, Então o rodapé de atribuição MIT está nas últimas linhas", () => {
    const fim = readFileSync(join(import.meta.dir, "..", "src", "comandos", "migrar-areas.ts"), "utf8")
      .trimEnd()
      .split("\n")
      .slice(-6)
      .join("\n");
    for (const elemento of ["https://github.com/cooperacode/wiki-wonka", "Coopera Code", "licença MIT", "LICENSE"]) {
      expect(fim).toContain(elemento);
    }
  });
});
