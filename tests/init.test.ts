import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { AREAS_PADRAO, comandoInit, inicializar } from "../src/comandos/init";
import { subcomandos } from "../src/cli";
import { capturarConsole } from "./apoio/console";

let raiz: string;
let console_: ReturnType<typeof capturarConsole>;

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "anvilore-init-"));
  console_ = capturarConsole();
});

afterEach(() => {
  console_.restaurar();
  rmSync(raiz, { recursive: true, force: true });
});

const TIPOS = ["concepts", "entities", "sources"];
const listar = (dir: string) => readdirSync(dir).sort();

function entradaCom(...respostas: string[]): Readable {
  return Readable.from(respostas.map((r) => `${r}\n`));
}

function saidaMudaEcoada(): { saida: PassThrough; texto: () => string } {
  const saida = new PassThrough();
  const pedacos: string[] = [];
  saida.on("data", (p) => pedacos.push(String(p)));
  return { saida, texto: () => pedacos.join("") };
}

describe("inicializar", () => {
  test("Dado as áreas padrão, Então são pessoal, profissional, projetos-paralelos e saude", () => {
    expect([...AREAS_PADRAO]).toEqual(["pessoal", "profissional", "projetos-paralelos", "saude"]);
  });

  test("Dado pessoal e saude, Quando inicializar, Então cria só essas duas com sources, entities e concepts", async () => {
    const r = await inicializar({ raiz, areas: ["pessoal", "saude"] });
    expect(r.criadas).toEqual(["pessoal", "saude"]);
    expect(r.jaExistiam).toEqual([]);
    expect(listar(join(raiz, "wiki"))).toEqual(["pessoal", "saude"]);
    expect(listar(join(raiz, "wiki", "pessoal"))).toEqual(TIPOS);
    expect(listar(join(raiz, "wiki", "saude"))).toEqual(TIPOS);
  });

  test("Dado init repetido, Quando inicializar de novo, Então devolve jaExistiam e não altera nada", async () => {
    await inicializar({ raiz, areas: ["pessoal"] });
    const pagina = join(raiz, "wiki", "pessoal", "concepts", "minha.md");
    writeFileSync(pagina, "conteudo do usuario");
    const r = await inicializar({ raiz, areas: ["pessoal"] });
    expect(r.criadas).toEqual([]);
    expect(r.jaExistiam).toEqual(["pessoal"]);
    expect(await Bun.file(pagina).text()).toBe("conteudo do usuario");
    expect(listar(join(raiz, "wiki", "pessoal", "concepts"))).toEqual(["minha.md"]);
  });

  test("Dado área existente sem um dos tipos, Quando inicializar, Então completa os tipos e conta como criada", async () => {
    mkdirSync(join(raiz, "wiki", "pessoal", "sources"), { recursive: true });
    const r = await inicializar({ raiz, areas: ["pessoal"] });
    expect(r.criadas).toEqual(["pessoal"]);
    expect(listar(join(raiz, "wiki", "pessoal"))).toEqual(TIPOS);
  });

  test("Dado uma área nova e uma existente, Quando inicializar, Então separa criadas de jaExistiam", async () => {
    await inicializar({ raiz, areas: ["pessoal"] });
    const r = await inicializar({ raiz, areas: ["pessoal", "saude"] });
    expect(r.criadas).toEqual(["saude"]);
    expect(r.jaExistiam).toEqual(["pessoal"]);
  });

  test("Dado _meta como nome de área, Quando inicializar, Então recusa e não cria nada", async () => {
    await expect(inicializar({ raiz, areas: ["pessoal", "_meta"] })).rejects.toThrow(/reservado/);
    expect(existsSync(join(raiz, "wiki"))).toBe(false);
  });

  test("Dado log em outra caixa como nome de área, Quando inicializar, Então recusa como reservado", async () => {
    await expect(inicializar({ raiz, areas: ["LOG"] })).rejects.toThrow(/reservado/);
  });

  test("Dado nome de diretório de tipo como área, Quando inicializar, Então recusa", async () => {
    await expect(inicializar({ raiz, areas: ["sources"] })).rejects.toThrow(/tipo/);
  });

  for (const nome of ["../fora", "a/b", "a\\b", "C:x", "..", ".", "a..b", "", "   "]) {
    test(`Dado o nome ${JSON.stringify(nome)}, Quando inicializar, Então recusa nome inválido`, async () => {
      await expect(inicializar({ raiz, areas: [nome] })).rejects.toThrow(/inválido|vazio/);
      expect(existsSync(join(raiz, "wiki"))).toBe(false);
    });
  }

  for (const nome of ["nul", "CON", "com1", "Lpt9", "nul.txt", "aux.", "a<b", 'a"b', "a|b", "a?b", "a*b", "a\u0001b", ".obsidian", ".git"]) {
    test(`Dado o nome ${JSON.stringify(nome)} proibido no Windows ou oculto, Quando inicializar, Então recusa`, async () => {
      await expect(inicializar({ raiz, areas: [nome] })).rejects.toThrow(/inválido/);
      expect(existsSync(join(raiz, "wiki"))).toBe(false);
    });
  }

  test("Dado nomes que só começam como um reservado do Windows, Quando inicializar, Então aceita", async () => {
    const r = await inicializar({ raiz, areas: ["console", "comp", "com10", "lpt0", "novo-nul"] });
    expect(r.criadas).toEqual(["console", "comp", "com10", "lpt0", "novo-nul"]);
  });

  test("Dado nome com ponto ou espaço no fim, Quando inicializar, Então recusa porque o Windows os descarta", async () => {
    await expect(inicializar({ raiz, areas: ["saude."] })).rejects.toThrow(/inválido/);
    await expect(inicializar({ raiz, areas: ["saude "] })).rejects.toThrow(/inválido/);
  });

  test("Dado nenhuma área, Quando inicializar, Então recusa", async () => {
    await expect(inicializar({ raiz, areas: [] })).rejects.toThrow(/nenhuma área/);
  });

  test("Dado a mesma área duas vezes, Quando inicializar, Então cria uma só", async () => {
    const r = await inicializar({ raiz, areas: ["pessoal", "pessoal"] });
    expect(r.criadas).toEqual(["pessoal"]);
  });

  test("Dado nomes que só diferem na caixa, Quando inicializar, Então aponta o conflito e não cria nada", async () => {
    await expect(inicializar({ raiz, areas: ["Saude", "saude"] })).rejects.toThrow(/conflito/);
    expect(existsSync(join(raiz, "wiki"))).toBe(false);
  });

  test("Dado nomes que só diferem pela normalização Unicode, Quando inicializar, Então aponta o conflito", async () => {
    await expect(inicializar({ raiz, areas: ["saúde", "saúde"] })).rejects.toThrow(/conflito/);
  });

  test("Dado pasta existente que só difere na caixa, Quando inicializar, Então aponta o conflito", async () => {
    mkdirSync(join(raiz, "wiki", "Saude"), { recursive: true });
    await expect(inicializar({ raiz, areas: ["saude"] })).rejects.toThrow(/conflito/);
  });

  test("Dado área que existe como arquivo, Quando inicializar, Então falha dizendo que não é diretório", async () => {
    mkdirSync(join(raiz, "wiki"), { recursive: true });
    writeFileSync(join(raiz, "wiki", "pessoal"), "x");
    await expect(inicializar({ raiz, areas: ["pessoal"] })).rejects.toThrow(/não é um diretório/);
  });

  test("Dado área que é link simbólico para uma pasta, Quando inicializar, Então segue o link e completa os tipos", async () => {
    const alvo = mkdtempSync(join(tmpdir(), "anvilore-init-alvo-"));
    try {
      mkdirSync(join(raiz, "wiki"), { recursive: true });
      symlinkSync(alvo, join(raiz, "wiki", "pessoal"), process.platform === "win32" ? "junction" : "dir");
      const r = await inicializar({ raiz, areas: ["pessoal"] });
      expect(r.criadas).toEqual(["pessoal"]);
      expect(listar(alvo)).toEqual(TIPOS);
    } finally {
      rmSync(alvo, { recursive: true, force: true });
    }
  });

  test("Dado raiz inexistente, Quando inicializar, Então recusa e não cria nada", async () => {
    const inexistente = join(raiz, "nao", "existe");
    await expect(inicializar({ raiz: inexistente, areas: ["pessoal"] })).rejects.toThrow(/raiz inexistente.*existe/);
    expect(existsSync(join(raiz, "nao"))).toBe(false);
  });

  test("Dado raiz que é arquivo, Quando inicializar, Então recusa dizendo que não é diretório", async () => {
    const arquivo = join(raiz, "arquivo");
    writeFileSync(arquivo, "x");
    await expect(inicializar({ raiz: arquivo, areas: ["pessoal"] })).rejects.toThrow(/raiz não é um diretório/);
  });

  test("Dado wiki que é link simbólico quebrado, Quando inicializar, Então recusa com o caminho e não cria nada", async () => {
    symlinkSync(join(raiz, "nao-existe"), join(raiz, "wiki"), process.platform === "win32" ? "junction" : "dir");
    await expect(inicializar({ raiz, areas: ["pessoal"] })).rejects.toThrow(/wiki.*link simbólico quebrado/);
    expect(existsSync(join(raiz, "nao-existe"))).toBe(false);
  });

  test("Dado wiki que é arquivo, Quando inicializar, Então recusa dizendo que não é diretório", async () => {
    writeFileSync(join(raiz, "wiki"), "x");
    await expect(inicializar({ raiz, areas: ["pessoal"] })).rejects.toThrow(/wiki.*não é um diretório/);
  });

  test("Dado tipo que é link simbólico quebrado dentro da área, Quando inicializar, Então recusa com o caminho", async () => {
    mkdirSync(join(raiz, "wiki", "pessoal"), { recursive: true });
    symlinkSync(join(raiz, "nao-existe"), join(raiz, "wiki", "pessoal", "sources"), process.platform === "win32" ? "junction" : "dir");
    await expect(inicializar({ raiz, areas: ["pessoal"] })).rejects.toThrow(/wiki.pessoal.sources.*link simbólico quebrado/);
  });

  test("Dado área que é link simbólico quebrado, Quando inicializar, Então avisa e não cria", async () => {
    mkdirSync(join(raiz, "wiki"), { recursive: true });
    symlinkSync(join(raiz, "nao-existe"), join(raiz, "wiki", "pessoal"), process.platform === "win32" ? "junction" : "dir");
    const r = await inicializar({ raiz, areas: ["pessoal", "saude"] });
    expect(r.criadas).toEqual(["saude"]);
    expect(r.avisos.join("\n")).toMatch(/pessoal.*quebrado/);
  });
});

describe("comandoInit", () => {
  test("Dado --areas pessoal,saude, Quando rodar sem perguntas, Então cria as duas e devolve 0", async () => {
    const codigo = await comandoInit(["--areas", "pessoal,saude"], { raiz });
    expect(codigo).toBe(0);
    expect(listar(join(raiz, "wiki"))).toEqual(["pessoal", "saude"]);
    expect(listar(join(raiz, "wiki", "saude"))).toEqual(TIPOS);
  });

  test("Dado --areas, Quando rodar, Então a saída tem a mensagem de sucesso e o próximo passo em uma linha", async () => {
    mkdirSync(join(raiz, "raw", "exemplo"), { recursive: true });
    writeFileSync(join(raiz, "raw", "exemplo", "llm-wiki.md"), "# exemplo");
    await comandoInit(["--areas", "pessoal"], { raiz });
    const saida = console_.saida.join("\n");
    expect(saida).toContain("Pronto: 1 área criada em wiki/ (pessoal).");
    const proximo = console_.saida.filter((l) => l.startsWith("Próximo passo:"));
    expect(proximo).toEqual(["Próximo passo: peça ao seu agente para seguir skills/ingest/SKILL.md e ingerir raw/exemplo/llm-wiki.md."]);
  });

  test("Dado raw/exemplo ausente, Quando rodar, Então o próximo passo pede um documento em raw/", async () => {
    await comandoInit(["--areas", "pessoal"], { raiz });
    const proximo = console_.saida.filter((l) => l.startsWith("Próximo passo:"));
    expect(proximo).toEqual(["Próximo passo: coloque um documento em raw/ e peça ao seu agente para seguir skills/ingest/SKILL.md e ingeri-lo."]);
  });

  test("Dado init repetido, Quando rodar de novo, Então informa que já existiam e devolve 0", async () => {
    await comandoInit(["--areas", "pessoal,saude"], { raiz });
    console_.saida.length = 0;
    const codigo = await comandoInit(["--areas", "pessoal,saude"], { raiz });
    expect(codigo).toBe(0);
    const saida = console_.saida.join("\n");
    expect(saida).toContain("Já existiam: pessoal, saude.");
    expect(saida).toContain("Pronto: nada novo a criar");
    expect(saida).toContain("Próximo passo:");
  });

  test("Dado área nova e existente, Quando rodar, Então lista as duas situações", async () => {
    await comandoInit(["--areas", "pessoal"], { raiz });
    console_.saida.length = 0;
    await comandoInit(["--areas", "pessoal,saude"], { raiz });
    const saida = console_.saida.join("\n");
    expect(saida).toContain("Já existiam: pessoal.");
    expect(saida).toContain("Pronto: 1 área criada em wiki/ (saude).");
  });

  test("Dado várias áreas criadas, Quando rodar, Então a mensagem usa o plural", async () => {
    await comandoInit(["--areas", "pessoal,saude"], { raiz });
    expect(console_.saida.join("\n")).toContain("Pronto: 2 áreas criadas em wiki/ (pessoal, saude).");
  });

  test("Dado raiz inexistente, Quando rodar, Então devolve 1 nomeando a raiz e não cria nada", async () => {
    const inexistente = join(raiz, "nao", "existe");
    expect(await comandoInit(["--areas", "pessoal"], { raiz: inexistente })).toBe(1);
    expect(console_.erros.join("\n")).toMatch(/raiz inexistente.*existe/);
    expect(console_.saida.join("\n")).not.toContain("Pronto");
    expect(existsSync(join(raiz, "nao"))).toBe(false);
  });

  test("Dado única área pedida que é link quebrado, Quando rodar, Então avisa em stderr, não diz pronto nem já existiam e devolve 1", async () => {
    mkdirSync(join(raiz, "wiki"), { recursive: true });
    symlinkSync(join(raiz, "nao-existe"), join(raiz, "wiki", "saude"), process.platform === "win32" ? "junction" : "dir");
    expect(await comandoInit(["--areas", "saude"], { raiz })).toBe(1);
    expect(console_.avisos.join("\n")).toMatch(/AVISO: .*saude.*quebrado/);
    expect(console_.erros.join("\n")).toContain("Nenhuma área criada");
    const saida = console_.saida.join("\n");
    expect(saida).not.toContain("Pronto");
    expect(saida).not.toContain("Já existiam");
    expect(saida).not.toContain("Próximo passo");
  });

  test("Dado uma área boa e uma quebrada, Quando rodar, Então cria a boa, avisa da outra e devolve 0", async () => {
    mkdirSync(join(raiz, "wiki"), { recursive: true });
    symlinkSync(join(raiz, "nao-existe"), join(raiz, "wiki", "saude"), process.platform === "win32" ? "junction" : "dir");
    expect(await comandoInit(["--areas", "pessoal,saude"], { raiz })).toBe(0);
    expect(console_.avisos.join("\n")).toMatch(/AVISO: .*saude.*quebrado/);
    expect(console_.avisos.join("\n")).toContain("1 área não criada");
    expect(console_.saida.join("\n")).toContain("Pronto: 1 área criada em wiki/ (pessoal).");
  });

  test("Dado área existente e outra quebrada, Quando rodar, Então não diz que tudo já existia", async () => {
    await comandoInit(["--areas", "pessoal"], { raiz });
    symlinkSync(join(raiz, "nao-existe"), join(raiz, "wiki", "saude"), process.platform === "win32" ? "junction" : "dir");
    console_.saida.length = 0;
    expect(await comandoInit(["--areas", "pessoal,saude"], { raiz })).toBe(0);
    const saida = console_.saida.join("\n");
    expect(saida).toContain("Já existiam: pessoal.");
    expect(saida).not.toContain("as áreas pedidas já existiam");
    expect(console_.avisos.join("\n")).toContain("1 área não criada");
  });

  test("Dado --areas _meta, Quando rodar, Então devolve 1, nomeia o motivo e não imprime sucesso", async () => {
    const codigo = await comandoInit(["--areas", "_meta"], { raiz });
    expect(codigo).toBe(1);
    expect(console_.erros.join("\n")).toMatch(/reservado/);
    expect(console_.saida.join("\n")).not.toContain("Pronto");
  });

  test("Dado --areas com item vazio, Quando rodar, Então devolve 1 recusando o nome vazio", async () => {
    const codigo = await comandoInit(["--areas", "pessoal,,saude"], { raiz });
    expect(codigo).toBe(1);
    expect(console_.erros.join("\n")).toMatch(/vazio/);
    expect(existsSync(join(raiz, "wiki"))).toBe(false);
  });

  test("Dado argumento desconhecido, Quando rodar, Então devolve 2 com o uso", async () => {
    expect(await comandoInit(["--nada"], { raiz })).toBe(2);
    expect(console_.erros.join("\n")).toContain("Uso: anvilore init");
  });

  test("Dado argumento posicional, Quando rodar, Então devolve 2 com o uso", async () => {
    expect(await comandoInit(["pessoal"], { raiz })).toBe(2);
    expect(console_.erros.join("\n")).toContain("Uso: anvilore init");
  });

  test("Dado --help, Quando rodar, Então devolve 2 com o uso (R56)", async () => {
    expect(await comandoInit(["--help"], { raiz })).toBe(2);
    expect(console_.erros.join("\n")).toContain("--areas");
  });

  test("Dado sem --areas e sem terminal, Quando rodar, Então reprova sem travar e sem criar nada", async () => {
    const codigo = await comandoInit([], { raiz, interativo: false });
    expect(codigo).toBe(2);
    expect(console_.erros.join("\n")).toMatch(/--areas.*terminal|terminal.*--areas/);
    expect(existsSync(join(raiz, "wiki"))).toBe(false);
  });
});

describe("comandoInit interativo", () => {
  test("Dado Enter nas duas perguntas, Quando rodar, Então aceita as quatro áreas padrão", async () => {
    const { saida, texto } = saidaMudaEcoada();
    const codigo = await comandoInit([], { raiz, interativo: true, entrada: entradaCom("", ""), saida });
    expect(codigo).toBe(0);
    expect(listar(join(raiz, "wiki"))).toEqual(["pessoal", "profissional", "projetos-paralelos", "saude"]);
    expect(texto()).toContain("pessoal");
    expect(texto()).toContain("projetos-paralelos");
  });

  test("Dado números 1,4 e uma nova, Quando rodar, Então mantém essas e adiciona a outra", async () => {
    const { saida } = saidaMudaEcoada();
    const codigo = await comandoInit([], { raiz, interativo: true, entrada: entradaCom("1,4", "estudos"), saida });
    expect(codigo).toBe(0);
    expect(listar(join(raiz, "wiki"))).toEqual(["estudos", "pessoal", "saude"]);
  });

  test("Dado nomes na resposta, Quando rodar, Então mantém as nomeadas", async () => {
    const { saida } = saidaMudaEcoada();
    await comandoInit([], { raiz, interativo: true, entrada: entradaCom("saude, pessoal", ""), saida });
    expect(listar(join(raiz, "wiki"))).toEqual(["pessoal", "saude"]);
  });

  test("Dado nenhuma e duas novas, Quando rodar, Então cria só as novas", async () => {
    const { saida } = saidaMudaEcoada();
    await comandoInit([], { raiz, interativo: true, entrada: entradaCom("nenhuma", "estudos, casa"), saida });
    expect(listar(join(raiz, "wiki"))).toEqual(["casa", "estudos"]);
  });

  test("Dado nenhuma e nada novo, Quando rodar, Então devolve 1 dizendo que nenhuma área foi escolhida", async () => {
    const { saida } = saidaMudaEcoada();
    const codigo = await comandoInit([], { raiz, interativo: true, entrada: entradaCom("nenhuma", ""), saida });
    expect(codigo).toBe(1);
    expect(console_.erros.join("\n")).toMatch(/nenhuma área/);
    expect(existsSync(join(raiz, "wiki"))).toBe(false);
  });

  test("Dado resposta com número fora da lista, Quando rodar, Então devolve 1 sem criar nada", async () => {
    const { saida } = saidaMudaEcoada();
    const codigo = await comandoInit([], { raiz, interativo: true, entrada: entradaCom("9", ""), saida });
    expect(codigo).toBe(1);
    expect(console_.erros.join("\n")).toMatch(/9/);
    expect(existsSync(join(raiz, "wiki"))).toBe(false);
  });

  test("Dado resposta com nome que não é padrão, Quando rodar, Então devolve 1 sugerindo adicionar na segunda pergunta", async () => {
    const { saida } = saidaMudaEcoada();
    const codigo = await comandoInit([], { raiz, interativo: true, entrada: entradaCom("estudos", ""), saida });
    expect(codigo).toBe(1);
    expect(console_.erros.join("\n")).toMatch(/estudos.*padrão/);
  });

  test("Dado área extra reservada, Quando rodar, Então devolve 1 recusando", async () => {
    const { saida } = saidaMudaEcoada();
    const codigo = await comandoInit([], { raiz, interativo: true, entrada: entradaCom("", "_meta"), saida });
    expect(codigo).toBe(1);
    expect(console_.erros.join("\n")).toMatch(/reservado/);
    expect(existsSync(join(raiz, "wiki"))).toBe(false);
  });

  test("Dado entrada que acaba antes da resposta, Quando rodar, Então devolve 1 sem travar", async () => {
    const { saida } = saidaMudaEcoada();
    const codigo = await comandoInit([], { raiz, interativo: true, entrada: Readable.from([]), saida });
    expect(codigo).toBe(1);
    expect(console_.erros.join("\n")).toMatch(/entrada encerrada/);
    expect(existsSync(join(raiz, "wiki"))).toBe(false);
  });

  test("Dado raiz inexistente e terminal, Quando rodar, Então reprova antes de perguntar", async () => {
    const { saida, texto } = saidaMudaEcoada();
    const codigo = await comandoInit([], { raiz: join(raiz, "nao-existe"), interativo: true, entrada: Readable.from([]), saida });
    expect(codigo).toBe(1);
    expect(console_.erros.join("\n")).toMatch(/raiz inexistente/);
    expect(texto()).toBe("");
  });

  test.skipIf(process.platform === "win32")("Dado diretório atual removido, Quando rodar sem raiz, Então devolve 1 com mensagem e sem stack trace", async () => {
    const antes = process.cwd();
    const sumido = mkdtempSync(join(tmpdir(), "anvilore-init-sumido-"));
    process.chdir(sumido);
    rmSync(sumido, { recursive: true, force: true });
    try {
      expect(await comandoInit(["--areas", "pessoal"])).toBe(1);
    } finally {
      process.chdir(antes);
    }
    expect(console_.erros.length).toBe(1);
    expect(console_.erros[0]).not.toContain("\n    at ");
  });

  test("Dado --areas e terminal, Quando rodar, Então não pergunta nada", async () => {
    const { saida, texto } = saidaMudaEcoada();
    const codigo = await comandoInit(["--areas", "saude"], { raiz, interativo: true, entrada: Readable.from([]), saida });
    expect(codigo).toBe(0);
    expect(texto()).toBe("");
  });
});

describe("cli", () => {
  const cli = join(import.meta.dir, "..", "src", "cli.ts");

  async function rodar(...args: string[]) {
    const processo = Bun.spawn([process.execPath, cli, ...args], { cwd: raiz, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [saida, erro, codigo] = await Promise.all([new Response(processo.stdout).text(), new Response(processo.stderr).text(), processo.exited]);
    return { saida, erro, codigo };
  }

  test("Dado a tabela de subcomandos, Então init aponta para comandoInit", () => {
    expect(subcomandos.init).toBe(comandoInit);
  });

  test("Dado o subcomando init de verdade, Quando rodar com --areas, Então cria as áreas no diretório atual", async () => {
    const r = await rodar("init", "--areas", "pessoal");
    expect(r.codigo).toBe(0);
    expect(r.saida).toContain("Pronto: 1 área criada em wiki/ (pessoal).");
    expect(listar(join(raiz, "wiki", "pessoal"))).toEqual(TIPOS);
  });

  test("Dado o subcomando init de verdade, Quando rodar sem --areas e sem terminal, Então reprova com 2 sem esperar", async () => {
    const r = await rodar("init");
    expect(r.codigo).toBe(2);
    expect(r.erro).toContain("--areas");
    expect(existsSync(join(raiz, "wiki"))).toBe(false);
  });
});

describe("init × anvilore.toml (R70-F)", () => {
  const toml = (conteudo: string) => writeFileSync(join(raiz, "anvilore.toml"), conteudo);

  test("Dado toml com areas, Quando init pede área fora da lista, Então recusa nomeando a área e a lista e não cria nada", async () => {
    toml('areas = ["pessoal", "saude"]\n');
    const codigo = await comandoInit(["--areas", "pessoal,profissional"], { raiz });
    expect(codigo).toBe(1);
    const erro = console_.erros.join("\n");
    expect(erro).toContain("profissional");
    expect(erro).toContain("pessoal, saude");
    expect(erro).toContain("anvilore.toml");
    expect(existsSync(join(raiz, "wiki"))).toBe(false);
  });

  test("Dado toml com areas, Quando init pede só áreas da lista, Então cria normalmente", async () => {
    toml('areas = ["pessoal", "saude"]\n');
    expect(await comandoInit(["--areas", "pessoal,saude"], { raiz })).toBe(0);
    expect(listar(join(raiz, "wiki"))).toEqual(["pessoal", "saude"]);
  });

  test("Dado toml com areas e a caixa diferente, Quando init pede, Então a comparação segue a normalização do disco", async () => {
    toml('areas = ["Pessoal"]\n');
    expect(await comandoInit(["--areas", "pessoal"], { raiz })).toBe(0);
  });

  test("Dado toml sem areas, Quando init pede qualquer área, Então não restringe", async () => {
    toml('tipos = ["concept"]\n');
    expect(await comandoInit(["--areas", "qualquer"], { raiz })).toBe(0);
  });

  test("Dado toml ilegível ou com chave desconhecida, Quando init roda, Então reprova com a mensagem do perfil e não cria nada", async () => {
    toml("chave_estranha = 1\n");
    expect(await comandoInit(["--areas", "pessoal"], { raiz })).toBe(1);
    expect(console_.erros.join("\n")).toContain("chave desconhecida");
    expect(existsSync(join(raiz, "wiki"))).toBe(false);
  });

  test("Dado a API, Quando inicializar com área fora do toml, Então lança sem criar", async () => {
    toml('areas = ["pessoal"]\n');
    await expect(inicializar({ raiz, areas: ["saude"] })).rejects.toThrow(/saude.*pessoal/s);
    expect(existsSync(join(raiz, "wiki"))).toBe(false);
  });

  test("Dado toml com areas e wiki/exemplo no disco, Quando init cria áreas permitidas, Então avisa que o validar vai reprovar o exemplo", async () => {
    toml('areas = ["pessoal"]\n');
    mkdirSync(join(raiz, "wiki", "exemplo", "concepts"), { recursive: true });
    expect(await comandoInit(["--areas", "pessoal"], { raiz })).toBe(0);
    const avisos = console_.avisos.join("\n");
    expect(avisos).toContain("wiki/exemplo");
    expect(avisos).toContain("apague");
  });

  test("Dado toml com exemplo na lista, Quando existe wiki/exemplo, Então não avisa", async () => {
    toml('areas = ["pessoal", "exemplo"]\n');
    mkdirSync(join(raiz, "wiki", "exemplo"), { recursive: true });
    await comandoInit(["--areas", "pessoal"], { raiz });
    expect(console_.avisos.join("\n")).not.toContain("wiki/exemplo");
  });
});
