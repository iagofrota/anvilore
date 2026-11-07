import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { aprovarPelaInterface, comandoAprovar, fecharProcessosRevisao, lancarServidorRevisao } from "../src/comandos/aprovar";
import { lerFrontmatter } from "../src/lib/frontmatter";
import { iniciarServidorUi } from "../src/ui/servidor/servidor";
import { capturarConsole } from "./apoio/console";

let raiz: string;
beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "anvilore-aprovar-"));
  mkdirSync(join(raiz, "wiki/pessoal"), { recursive: true });
});
afterEach(async () => {
  fecharProcessosRevisao();
  try {
    rmSync(raiz, { recursive: true, force: true });
  } catch {
    await new Promise(r => setTimeout(r, 50));
    try {
      rmSync(raiz, { recursive: true, force: true });
    } catch {}
  }
});

function versaoArquivo(caminho: string): string {
  return createHash("sha256").update(readFileSync(caminho)).digest("hex");
}

test("Dado nome Git e página gerada Quando aprovo pela interface Então registra identidade local e proveniência humana", async () => {
  const wiki = join(raiz, "wiki");
  for (const args of [["init", "-q"], ["config", "user.name", "Iago Ávila"]]) {
    const resultado = Bun.spawnSync(["git", "-C", wiki, ...args], { stdout: "pipe", stderr: "pipe" });
    expect(resultado.exitCode).toBe(0);
  }
  const pagina = join(wiki, "pessoal/ideia.md");
  writeFileSync(pagina, "---\ntitle: Ideia\ngenerated:\n  by: agente\n  at: 2026-10-27T10:00:00-03:00\n---\n\nCorpo.\n");
  const versao = versaoArquivo(pagina);
  expect(await aprovarPelaInterface(raiz, pagina, versao)).toEqual({ codigo: 0, mensagens: ["Aprovadas: 1 página (human:iago-avila)."] });
  expect(readFileSync(join(raiz, ".anvilore/identidade"), "utf8")).toBe("human:iago-avila\n");
  expect(readFileSync(pagina, "utf8")).toMatch(/verified:\n  - by: human:iago-avila\n    at: \d{4}-\d\d-\d\dT.*Z\n---/);
});

test("Dado git sem user.name Quando aprovo pela interface Então grava human:local sem pedir identidade", async () => {
  const wiki = join(raiz, "wiki");
  expect(Bun.spawnSync(["git", "-C", wiki, "init", "-q"], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
  const pagina = join(wiki, "pessoal/local.md");
  writeFileSync(pagina, "---\ngenerated:\n  by: agente\n  at: 2026-10-27T10:00:00Z\n---\n");
  const ambiente = { ...process.env, GIT_CONFIG_GLOBAL: join(raiz, "gitconfig-ausente"), GIT_CONFIG_NOSYSTEM: "1" };
  const versao = versaoArquivo(pagina);
  expect(await aprovarPelaInterface(raiz, pagina, versao, ambiente)).toEqual({ codigo: 0, mensagens: ["Aprovadas: 1 página (human:local)."] });
  expect(readFileSync(join(raiz, ".anvilore/identidade"), "utf8")).toBe("human:local\n");
  expect(readFileSync(pagina, "utf8")).toContain("by: human:local");
});

test("Dado auto-commit ligado Quando aprovo pela interface Então commita verified no repo da wiki", async () => {
  const wiki = join(raiz, "wiki");
  for (const args of [["init", "-q"], ["config", "user.name", "Iago Avila"], ["config", "user.email", "iago@example.test"]]) {
    expect(Bun.spawnSync(["git", "-C", wiki, ...args], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
  }
  writeFileSync(join(raiz, "anvilore.toml"), "[hooks]\nauto_commit = true\n");
  const pagina = join(wiki, "pessoal/concepts/ideia.md");
  mkdirSync(join(wiki, "pessoal/concepts"), { recursive: true });
  writeFileSync(pagina, "---\ngenerated:\n  by: agente\n  at: 2026-10-27T10:00:00Z\n---\nIdeia.\n");
  const versao = versaoArquivo(pagina);
  const resultado = await aprovarPelaInterface(raiz, pagina, versao);
  expect(resultado.codigo).toBe(0);
  const commit = Bun.spawnSync(["git", "-C", wiki, "log", "-1", "--format=%s"], { stdout: "pipe", stderr: "pipe" });
  expect(commit.stdout.toString().trim()).toBe("wiki(verify): ideia");
  expect(Bun.spawnSync(["git", "-C", wiki, "show", "HEAD:pessoal/concepts/ideia.md"], { stdout: "pipe", stderr: "pipe" }).stdout.toString()).toContain("by: human:iago-avila");
});

test("Dado falha no commit automático Quando aprovo pela interface Então avisa sem descartar verified", async () => {
  const wiki = join(raiz, "wiki");
  for (const args of [["init", "-q"], ["config", "user.name", "Iago Avila"], ["config", "user.email", "iago@example.test"], ["add", "."], ["commit", "-qm", "base"]]) {
    if (args[0] === "add") writeFileSync(join(wiki, "alheio.txt"), "alheio\n");
    if (args[0] === "commit") expect(Bun.spawnSync(["git", "-C", wiki, ...args], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
    else expect(Bun.spawnSync(["git", "-C", wiki, ...args], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
  }
  writeFileSync(join(raiz, "anvilore.toml"), "[hooks]\nauto_commit = true\n");
  const pagina = join(wiki, "pessoal/ideia.md");
  writeFileSync(pagina, "---\ngenerated:\n  by: agente\n  at: 2026-10-27T10:00:00Z\n---\nIdeia.\n");
  writeFileSync(join(wiki, "alheio.txt"), "alterado\n");
  Bun.spawnSync(["git", "-C", wiki, "add", "alheio.txt"], { stdout: "pipe", stderr: "pipe" });
  const versao = versaoArquivo(pagina);
  const resultado = await aprovarPelaInterface(raiz, pagina, versao);
  expect(resultado.codigo).toBe(0);
  expect(resultado.mensagens.join(" ")).toContain("AVISO: aprovação registrada, mas commit automático não realizado");
  expect(readFileSync(pagina, "utf8")).toContain("by: human:iago-avila");
});

test("Dado página fora de wiki Quando aprovo pela interface Então recusa sem alterar o arquivo", async () => {
  const pagina = join(raiz, "fora.md");
  writeFileSync(pagina, "---\ngenerated:\n  by: agente\n  at: 2026-10-27T10:00:00Z\n---\n");
  const versao = versaoArquivo(pagina);
  const resultado = await aprovarPelaInterface(raiz, pagina, versao);
  expect(resultado.codigo).toBe(1);
  expect(readFileSync(pagina, "utf8")).not.toContain("verified:");
});

test("Dado symlink dentro de wiki apontando para fora Quando aprovo pela interface Então recusa sem escrever no alvo", async () => {
  const fora = join(raiz, "fora.md");
  writeFileSync(fora, "---\ngenerated:\n  by: agente/teste\n  at: 2026-10-27T10:00:00Z\n---\n");
  const link = join(raiz, "wiki/pessoal/atalho.md");
  symlinkSync(fora, link);
  const versao = versaoArquivo(fora);
  expect((await aprovarPelaInterface(raiz, link, versao)).codigo).toBe(1);
  expect(readFileSync(fora, "utf8")).not.toContain("verified:");
});

test("Dado página sem generated ou aprovada depois da última geração Quando aprovo pela interface Então recusa", async () => {
  const semGerada = join(raiz, "wiki/sem-gerada.md");
  const jaAprovada = join(raiz, "wiki/aprovada.md");
  writeFileSync(semGerada, "---\ntitle: rascunho\n---\n");
  writeFileSync(jaAprovada, "---\ngenerated:\n  at: 2026-10-27T10:00:00Z\nverified:\n  - by: human:ana\n    at: 2026-10-27T11:00:00Z\n---\n");
  expect((await aprovarPelaInterface(raiz, semGerada, versaoArquivo(semGerada))).codigo).toBe(1);
  expect((await aprovarPelaInterface(raiz, jaAprovada, versaoArquivo(jaAprovada))).codigo).toBe(1);
});

test("Dado página aprovada antes da geração atual Quando aprovo pela interface Então acrescenta nova entrada ao verified", async () => {
  const wiki = join(raiz, "wiki");
  expect(Bun.spawnSync(["git", "-C", wiki, "init", "-q"], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
  expect(Bun.spawnSync(["git", "-C", wiki, "config", "user.name", "Iago Ávila"], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
  const pagina = join(wiki, "pessoal/atualizada.md");
  writeFileSync(pagina, "---\ngenerated:\n  by: agente\n  at: 2026-10-27T12:00:00Z\nverified:\n  - by: human:ana\n    at: 2026-10-27T11:00:00Z\n---\n\nAtualizada.\n");
  expect((await aprovarPelaInterface(raiz, pagina, versaoArquivo(pagina))).codigo).toBe(0);
  const texto = readFileSync(pagina, "utf8");
  expect(texto).toContain("- by: human:ana\n    at: 2026-10-27T11:00:00Z");
  expect(texto).toMatch(/- by: human:iago-avila\n    at: \d{4}-\d\d-\d\dT.*Z/);
});

test("Dado verified e campos irmãos entre aspas Quando aprovo pela interface Então preservo os outros valores do frontmatter", async () => {
  const pagina = join(raiz, "wiki/pessoal/quoted-fields.md");
  const original = [
    "---",
    "type: concept",
    "slug: quoted-fields",
    "generated:",
    "  by: agente",
    "  at: 2026-10-27T12:00:00Z",
    '"verified":',
    "  - by: human:ana",
    "    at: 2026-10-27T11:00:00Z",
    '"title": Quoted title',
    "'tags': [uma, duas]",
    "---",
    "Corpo.",
  ].join("\n");
  writeFileSync(pagina, original);
  const antes = lerFrontmatter(original)!;

  expect(await aprovarPelaInterface(raiz, pagina, versaoArquivo(pagina))).toMatchObject({ codigo: 0 });

  const depois = lerFrontmatter(readFileSync(pagina, "utf8"))!;
  expect(depois.type).toBe(antes.type);
  expect(depois.slug).toBe(antes.slug);
  expect(depois.generated).toEqual(antes.generated);
  expect(depois.title).toBe(antes.title);
  expect(depois.tags).toEqual(antes.tags);
  expect(depois.verified).toHaveLength(2);
});

test("Dado página em CRLF Quando aprovo pela interface Então preservo os bytes do corpo e o fim de linha", async () => {
  const pagina = join(raiz, "wiki/pessoal/crlf.md");
  const original = Buffer.from("---\r\ntitle: CRLF\r\ngenerated:\r\n  by: agente\r\n  at: 2026-10-27T10:00:00Z\r\n---\r\nCorpo preservado.\r\n", "utf8");
  writeFileSync(pagina, original);
  const versao = createHash("sha256").update(original).digest("hex");
  expect((await aprovarPelaInterface(raiz, pagina, versao)).codigo).toBe(0);
  const atualizado = readFileSync(pagina);
  const sufixoOriginal = Buffer.from("\r\n---\r\nCorpo preservado.\r\n", "utf8");
  expect(atualizado.subarray(atualizado.length - sufixoOriginal.length)).toEqual(sufixoOriginal);
  expect(Buffer.from(atualizado.toString("utf8").replaceAll("\r\n", ""), "utf8").includes(Buffer.from("\n"))).toBe(false);
});

test("Dado versão ausente ou inválida Quando aprovo pela interface Então recusa", async () => {
  const pagina = join(raiz, "wiki/pessoal/teste.md");
  writeFileSync(pagina, "---\ngenerated:\n  at: 2026-10-27T10:00:00Z\n---\n");
  expect(await aprovarPelaInterface(raiz, pagina, "")).toEqual({ codigo: 2, mensagens: ["Versão inválida."] });
  expect(await aprovarPelaInterface(raiz, pagina, "curta")).toEqual({ codigo: 2, mensagens: ["Versão inválida."] });
});

test("Dado versão esperada divergente do arquivo Quando aprovo pela interface Então recusa com código 3", async () => {
  const pagina = join(raiz, "wiki/pessoal/divergente.md");
  writeFileSync(pagina, "---\ntitle: Div\ntype: concept\nslug: divergente\ngenerated:\n  by: process:agente\n  at: 2026-10-27T10:00:00Z\n---\nCorpo.\n");
  const versaoErrada = "0".repeat(64);
  const resultado = await aprovarPelaInterface(raiz, pagina, versaoErrada);
  expect(resultado.codigo).toBe(3);
  expect(resultado.mensagens[0]).toContain("A página mudou desde que você abriu");
});

test("Dado identidade local já armazenada Quando aprovo pela interface outra página Então reutiliza a mesma pessoa sem perguntar", async () => {
  const pagina = join(raiz, "wiki/pessoal/ideia.md");
  mkdirSync(join(raiz, ".anvilore"), { recursive: true });
  writeFileSync(join(raiz, ".anvilore/identidade"), "human:iago-avila\n");
  writeFileSync(pagina, "---\ngenerated:\n  by: agente\n  at: 2026-10-27T10:00:00Z\n---\n");
  const resultado = await aprovarPelaInterface(raiz, pagina, versaoArquivo(pagina));
  expect(resultado).toEqual({ codigo: 0, mensagens: ["Aprovadas: 1 página (human:iago-avila)."] });
});

test("Dado identidade armazenada inválida Quando aprovo pela interface Então recusa sem aprovar página", async () => {
  const pagina = join(raiz, "wiki/pessoal/ideia.md");
  mkdirSync(join(raiz, ".anvilore"), { recursive: true });
  writeFileSync(join(raiz, ".anvilore/identidade"), "alguém\n");
  const original = "---\ngenerated:\n  by: agente\n  at: 2026-10-27T10:00:00Z\n---\n";
  writeFileSync(pagina, original);
  expect((await aprovarPelaInterface(raiz, pagina, versaoArquivo(pagina))).codigo).toBe(1);
  expect(readFileSync(pagina, "utf8")).toBe(original);
});

test("Dado comando com caminhos absolutos Quando aprovo pela interface Então aceita página na wiki", async () => {
  const wiki = join(raiz, "wiki");
  for (const args of [["init", "-q"], ["config", "user.name", "Iago Avila"]]) {
    expect(Bun.spawnSync(["git", "-C", wiki, ...args], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
  }
  const pagina = join(wiki, "pessoal/absoluta.md");
  writeFileSync(pagina, "---\ngenerated:\n  by: agente\n  at: 2026-10-27T10:00:00Z\n---\n");
  expect(await aprovarPelaInterface(raiz, pagina, versaoArquivo(pagina))).toMatchObject({ codigo: 0 });
});

test("Dado páginas aprováveis Quando aprovar roda Então sobe a interface só de Revisão sem imprimir token= e não grava nada", async () => {
  const wiki = join(raiz, "wiki");
  mkdirSync(join(wiki, "pessoal"), { recursive: true });
  const pagina = join(wiki, "pessoal/cli.md");
  const conteudo = "---\ntitle: CLI\ntype: concept\nslug: cli\ngenerated:\n  by: process:agente\n  at: 2026-10-27T10:00:00Z\n---\nTexto.\n";
  writeFileSync(pagina, conteudo);

  const raizAnterior = process.env.ANVILORE_DESTINO;
  process.env.ANVILORE_DESTINO = raiz;
  const c = capturarConsole();
  try {
    expect(await comandoAprovar(["wiki/pessoal/cli.md"])).toBe(0);
    expect(c.saida.join(" ")).toContain("Revisão do Anvilore");
    expect(c.saida.join(" ")).not.toContain("token=");
    expect(readFileSync(pagina, "utf8")).not.toContain("verified:");
  } finally {
    c.restaurar();
    if (raizAnterior === undefined) delete process.env.ANVILORE_DESTINO;
    else process.env.ANVILORE_DESTINO = raizAnterior;
  }
});

test("Dado caminho fora da fila ou fora de wiki/ Quando aprovar roda Então recusa sem abrir a interface", async () => {
  const raizAnterior = process.env.ANVILORE_DESTINO;
  process.env.ANVILORE_DESTINO = raiz;
  const c = capturarConsole();
  try {
    expect(await comandoAprovar([])).toBe(2);
    expect(await comandoAprovar(["fora.md"])).toBe(1);
    expect(await comandoAprovar(["wiki/pessoal/inexistente.md"])).toBe(1);
  } finally {
    c.restaurar();
    if (raizAnterior === undefined) delete process.env.ANVILORE_DESTINO;
    else process.env.ANVILORE_DESTINO = raizAnterior;
  }
});

test("Dado interface só de Revisão Quando chega pedido de ingestão ou atualizador Então responde 404 e não toca .anvilore/atualizacao.json", async () => {
  const app = await iniciarServidorUi(raiz, { soRevisao: true, abrirNavegador: false });
  try {
    const resIngestao = await fetch(`http://127.0.0.1:${app.porta}/api/ingestao?token=${app.token}`);
    expect(resIngestao.status).toBe(404);

    const resFontes = await fetch(`http://127.0.0.1:${app.porta}/api/fontes?token=${app.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: `http://127.0.0.1:${app.porta}` },
      body: JSON.stringify({ texto: "fonte" }),
    });
    expect(resFontes.status).toBe(404);

    const resConversa = await fetch(`http://127.0.0.1:${app.porta}/api/conversas/qualquer?token=${app.token}`);
    expect(resConversa.status).toBe(404);

    const resAtualizador = await fetch(`http://127.0.0.1:${app.porta}/api/atualizador?token=${app.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: `http://127.0.0.1:${app.porta}` },
      body: JSON.stringify({ acao: "verificar" }),
    });
    expect(resAtualizador.status).toBe(404);

    const arquivoAtualizacao = join(raiz, ".anvilore/atualizacao.json");
    expect(existsSync(arquivoAtualizacao)).toBe(false);
  } finally {
    app.servidor.stop(true);
  }
});

test("Dado página gerada na fila e sessão em bypass Quando o agente roda bun src/cli.ts aprovar wiki/a.md Então a página segue sem verified e a saída manda para a Revisão", () => {
  const wiki = join(raiz, "wiki");
  const pagina = join(wiki, "pessoal/ideia.md");
  const conteudoOriginal = "---\ntitle: Ideia\ntype: concept\nslug: ideia\ngenerated:\n  by: process:agente\n  at: 2026-10-27T10:00:00Z\n---\n\nCorpo da ideia.\n";
  writeFileSync(pagina, conteudoOriginal);

  const proc = Bun.spawnSync([process.execPath, resolve(import.meta.dir, "../src/cli.ts"), "aprovar", "wiki/pessoal/ideia.md"], {
    cwd: raiz,
    env: { ...process.env, ANVILORE_DESTINO: raiz },
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(proc.exitCode).toBe(0);
  const saida = proc.stdout.toString();
  expect(saida).toContain("Revisão do Anvilore");
  expect(saida).not.toContain("token=");
  const conteudoDepois = readFileSync(pagina, "utf8");
  expect(conteudoDepois).not.toContain("verified:");
  expect(conteudoDepois).toBe(conteudoOriginal);
});

test("Dado página com campos extras no verified Quando aprova Então serializa tipos não-padrão no YAML", async () => {
  const wiki = join(raiz, "wiki");
  const pagina = join(wiki, "pessoal/extra.md");
  writeFileSync(pagina, "---\ntitle: Extra\ntype: concept\nslug: extra\ngenerated:\n  by: process:agente\n  at: 2026-10-27T10:00:00Z\nverified:\n  - by: human:ana\n    at: 2026-10-27T09:00:00Z\n    nota: \"revisão aprovada com ressalvas\"\n    pontos: 42\n---\nCorpo.\n");
  const resultado = await aprovarPelaInterface(raiz, pagina, versaoArquivo(pagina));
  expect(resultado.codigo).toBe(0);
  const texto = readFileSync(pagina, "utf8");
  expect(texto).toContain("nota: \"revisão aprovada com ressalvas\"");
  expect(texto).toContain("pontos: 42");
});

test("Dado falha ao listar fila de rascunhos Quando aprovar roda Então exibe erro e retorna 1", async () => {
  const raizInvalida = join(raiz, "inexistente-total");
  const raizAnterior = process.env.ANVILORE_DESTINO;
  process.env.ANVILORE_DESTINO = raizInvalida;
  const c = capturarConsole();
  try {
    expect(await comandoAprovar(["wiki/qualquer.md"])).toBe(1);
    expect(c.erros.join(" ")).toContain("Aprovação recusada:");
  } finally {
    c.restaurar();
    if (raizAnterior === undefined) delete process.env.ANVILORE_DESTINO;
    else process.env.ANVILORE_DESTINO = raizAnterior;
  }
});

test("Dado ANVILORE_WIKI e ANVILORE_DESTINO relativos Quando o servidor da Revisão nasce em outro cwd Então o filho recebe os dois absolutos, a partir do cwd do pai", () => {
  const antes = { wiki: process.env.ANVILORE_WIKI, destino: process.env.ANVILORE_DESTINO, pasta: process.env.ANVILORE_PASTA };
  const cwdAntes = process.cwd();
  const espiao = spyOn(Bun, "spawn").mockImplementation((() => ({ unref() {}, kill() {} })) as never);
  try {
    process.chdir(raiz);
    process.env.ANVILORE_WIKI = "wiki";
    process.env.ANVILORE_DESTINO = ".";
    process.env.ANVILORE_PASTA = "pasta";
    lancarServidorRevisao(".");
    const opcoes = espiao.mock.calls[0]![1] as { cwd?: string; env: Record<string, string> };
    const base = process.cwd();
    expect(opcoes.cwd).not.toBe(base);
    expect(opcoes.env.ANVILORE_DESTINO).toBe(base);
    expect(opcoes.env.ANVILORE_WIKI).toBe(join(base, "wiki"));
    expect(opcoes.env.ANVILORE_PASTA).toBe(join(base, "pasta"));
  } finally {
    espiao.mockRestore();
    process.chdir(cwdAntes);
    for (const [chave, valor] of [["ANVILORE_WIKI", antes.wiki], ["ANVILORE_DESTINO", antes.destino], ["ANVILORE_PASTA", antes.pasta]] as const) {
      if (valor === undefined) delete process.env[chave]; else process.env[chave] = valor;
    }
  }
});

test("Dado ANVILORE_WIKI e ANVILORE_DESTINO já absolutos Quando o servidor da Revisão nasce Então os valores ficam iguais", () => {
  const antes = { wiki: process.env.ANVILORE_WIKI, destino: process.env.ANVILORE_DESTINO };
  const espiao = spyOn(Bun, "spawn").mockImplementation((() => ({ unref() {}, kill() {} })) as never);
  try {
    process.env.ANVILORE_WIKI = join(raiz, "wiki");
    process.env.ANVILORE_DESTINO = raiz;
    lancarServidorRevisao(raiz);
    const opcoes = espiao.mock.calls[0]![1] as { env: Record<string, string> };
    expect(opcoes.env.ANVILORE_DESTINO).toBe(raiz);
    expect(opcoes.env.ANVILORE_WIKI).toBe(join(raiz, "wiki"));
  } finally {
    espiao.mockRestore();
    for (const [chave, valor] of [["ANVILORE_WIKI", antes.wiki], ["ANVILORE_DESTINO", antes.destino]] as const) {
      if (valor === undefined) delete process.env[chave]; else process.env[chave] = valor;
    }
  }
});
