import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { LISTA_DO_RASTREIO, copiarModelos } from "../src/lib/modelos";
import { lerManifestos, migrarRastreio, pendentes, puxar, situacaoDaMigracao, type Etapa } from "../src/lib/migracao";
import { comandoMigrarRastreio } from "../src/comandos/migrar-rastreio";
import { executar } from "../src/cli";
import { comandoDoctor, diagnosticar } from "../src/comandos/doctor";
import { capturarConsole } from "./apoio/console";
import { clonar, git, gitOk, montarOrigem, publicarN1 } from "./apoio/kit-git";

// Cada cenário monta origem, clone e versões com git de verdade: no runner Windows isso passa dos 5 s padrão.
setDefaultTimeout(30_000);

let tmp: string;
let console_: ReturnType<typeof capturarConsole>;
const ambiente = { ...process.env };

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "anvilore-migrar-"));
  console_ = capturarConsole();
  delete process.env.ANVILORE_WIKI;
  delete process.env.ANVILORE_DESTINO;
});
afterEach(() => {
  console_.restaurar();
  for (const chave of Object.keys(process.env)) if (!(chave in ambiente)) delete process.env[chave];
  Object.assign(process.env, ambiente);
  rmSync(tmp, { recursive: true, force: true });
});

const sha = (caminho: string) => createHash("sha256").update(readFileSync(caminho)).digest("hex");
const ls = (clone: string) => gitOk(clone, "ls-files", "--", ...LISTA_DO_RASTREIO);
function editar(clone: string, rel: string, texto: string) { writeFileSync(join(clone, rel), texto); }
function hashes(clone: string, rels: string[]) { return Object.fromEntries(rels.map(rel => [rel, sha(join(clone, rel))])); }
const EDITADOS = ["SCHEMA.md", "wiki/index.md", "wiki/log.md"];

// Clone da pessoa na versão N, com a N+1 já publicada na origem.
async function cenario(opcoes: { n1?: boolean } = {}) {
  const { origem, dev } = await montarOrigem(tmp);
  const pessoa = clonar(origem, join(tmp, "pessoa"));
  if (opcoes.n1 ?? true) publicarN1(dev, ls(dev).split("\n"));
  return { origem, dev, pessoa };
}

describe("migrar-rastreio: migração (PLANO §4b passos 1–4)", () => {
  test("Dado um clone antigo com SCHEMA.md, índice e log editados e wiki sem repositório, Quando a migração roda, Então os três têm o mesmo SHA-256, saem do índice e a wiki ganha commit com índice e log", async () => {
    const { pessoa } = await cenario({ n1: false });
    for (const rel of EDITADOS) editar(pessoa, rel, `MEU ${rel}\n`);
    const antes = hashes(pessoa, EDITADOS);
    expect(existsSync(join(pessoa, "wiki/.git"))).toBe(false);

    const r = await migrarRastreio(pessoa);

    expect(r.codigo).toBe(0);
    expect(r.situacao).toBe("migrada");
    expect(hashes(pessoa, EDITADOS)).toEqual(antes);
    expect(ls(pessoa)).toBe("");
    const naWiki = gitOk(join(pessoa, "wiki"), "ls-tree", "-r", "--name-only", "HEAD");
    expect(naWiki.split("\n")).toEqual(expect.arrayContaining(["index.md", "log.md"]));
    expect(gitOk(join(pessoa, "wiki"), "show", "HEAD:index.md")).toBe("MEU wiki/index.md");
    const [manifesto] = await lerManifestos(pessoa);
    expect(manifesto!.estado).toBe("concluida");
    expect(manifesto!.wiki).toMatchObject({ criada: true, commit: true });
    for (const { caminho, sha256 } of manifesto!.arquivos) {
      expect(sha(join(pessoa, ".anvilore/migracao", manifesto!.id, "arquivos", caminho))).toBe(sha256);
    }
    expect(manifesto!.arquivos.map(a => a.caminho)).toEqual(expect.arrayContaining([...EDITADOS, "wiki/exemplo/concepts/area-tematica.md", "raw/exemplo/llm-wiki.md"]));
  });

  test("Dado a migração já feita, Quando rodo de novo, Então nada a migrar e nenhuma cópia nova", async () => {
    const { pessoa } = await cenario({ n1: false });
    expect((await migrarRastreio(pessoa)).codigo).toBe(0);
    const r = await migrarRastreio(pessoa);
    expect(r).toMatchObject({ codigo: 0, situacao: "nada-a-migrar" });
    expect(readdirSync(join(pessoa, ".anvilore/migracao"))).toHaveLength(1);
  });

  test("Dado que a pessoa apagou wiki/exemplo e raw/exemplo, Quando migra, Então saem do índice, continuam apagados e o manifesto os lista como ausentes", async () => {
    const { pessoa } = await cenario({ n1: false });
    rmSync(join(pessoa, "wiki/exemplo"), { recursive: true }); rmSync(join(pessoa, "raw/exemplo"), { recursive: true });
    const r = await migrarRastreio(pessoa);
    expect(r.codigo).toBe(0);
    expect(ls(pessoa)).toBe("");
    expect(existsSync(join(pessoa, "wiki/exemplo"))).toBe(false);
    expect(existsSync(join(pessoa, "raw/exemplo"))).toBe(false);
    expect(r.manifesto!.ausentes).toEqual(expect.arrayContaining(["raw/exemplo/llm-wiki.md", "wiki/exemplo/concepts/area-tematica.md"]));
    expect(r.mensagens.join("\n")).toContain("continuam apagados");
  });

  test("Dado wiki com repositório próprio e commit, Quando migra, Então o repositório da wiki não é tocado", async () => {
    const { pessoa } = await cenario({ n1: false });
    const wiki = join(pessoa, "wiki");
    gitOk(wiki, "init", "-q"); gitOk(wiki, "add", "-A"); gitOk(wiki, "commit", "-qm", "da pessoa");
    const head = gitOk(wiki, "rev-parse", "HEAD");
    const r = await migrarRastreio(pessoa);
    expect(r.codigo).toBe(0);
    expect(gitOk(wiki, "rev-parse", "HEAD")).toBe(head);
    expect(r.manifesto!.wiki).toMatchObject({ criada: false, commit: true });
  });

  test("Dado wiki com repositório próprio sem nenhum commit, Quando migra, Então o primeiro commit guarda o que já está lá", async () => {
    const { pessoa } = await cenario({ n1: false });
    const wiki = join(pessoa, "wiki");
    gitOk(wiki, "init", "-q");
    expect((await migrarRastreio(pessoa)).codigo).toBe(0);
    expect(gitOk(wiki, "ls-tree", "-r", "--name-only", "HEAD").split("\n")).toContain("index.md");
  });

  test("Dado ANVILORE_WIKI fora do clone, Quando migra, Então o repositório nasce lá e o esqueleto do clone sai do índice", async () => {
    const { pessoa } = await cenario({ n1: false });
    const fora = join(tmp, "wiki-fora"); mkdirSync(fora); writeFileSync(join(fora, "index.md"), "fora");
    const r = await migrarRastreio(pessoa, { ambiente: { ANVILORE_WIKI: fora } });
    expect(r.codigo).toBe(0);
    expect(gitOk(fora, "ls-tree", "-r", "--name-only", "HEAD")).toBe("index.md");
    expect(ls(pessoa)).toBe("");
  });

  test("Dado a conferência acha um arquivo divergente, Quando a migração roda, Então ele volta da cópia e a migração termina", async () => {
    const { pessoa } = await cenario({ n1: false });
    editar(pessoa, "SCHEMA.md", "MEU SCHEMA");
    const r = await migrarRastreio(pessoa, { aoEntrarNaEtapa: (etapa) => { if (etapa === "conferir") editar(pessoa, "SCHEMA.md", "CORROMPIDO"); } });
    expect(r.codigo).toBe(0);
    expect(readFileSync(join(pessoa, "SCHEMA.md"), "utf8")).toBe("MEU SCHEMA");
  });

  test("Dado a conferência acha um hash diferente e a restauração falha, Quando a migração roda, Então nada é atualizado, o estado é migracao-incompleta e a cópia fica; resolvido o motivo, a nova execução termina", async () => {
    const { pessoa } = await cenario({ n1: false });
    editar(pessoa, "SCHEMA.md", "MEU SCHEMA");
    const r = await migrarRastreio(pessoa, {
      aoEntrarNaEtapa: (etapa) => {
        if (etapa !== "conferir") return;
        rmSync(join(pessoa, "SCHEMA.md")); mkdirSync(join(pessoa, "SCHEMA.md")); // algo que não é arquivo ocupa o lugar
      },
    });
    expect(r).toMatchObject({ codigo: 1, situacao: "incompleta" });
    expect(r.manifesto!.estado).toBe("migracao-incompleta");
    expect(r.manifesto!.etapa).toBe("conferir");
    expect(r.mensagens.join("\n")).toContain("Nada seu foi apagado");
    const copia = join(pessoa, ".anvilore/migracao", r.manifesto!.id, "arquivos/SCHEMA.md");
    expect(readFileSync(copia, "utf8")).toBe("MEU SCHEMA");
    expect((await pendentes(pessoa)).map(m => m.id)).toEqual([r.manifesto!.id]);
    expect((await situacaoDaMigracao(pessoa)).pendentes).toHaveLength(1);

    // O lugar continua ocupado: a retomada não apaga o diretório e continua incompleta.
    expect((await migrarRastreio(pessoa)).codigo).toBe(1);
    expect(existsSync(copia)).toBe(true);

    rmSync(join(pessoa, "SCHEMA.md"), { recursive: true });
    const de_novo = await migrarRastreio(pessoa);
    expect(de_novo.codigo).toBe(0);
    expect(readFileSync(join(pessoa, "SCHEMA.md"), "utf8")).toBe("MEU SCHEMA");
    expect(await pendentes(pessoa)).toEqual([]);
    expect((await lerManifestos(pessoa)).find(m => m.id === r.manifesto!.id)!.estado).toBe("retomada");
  });

  for (const etapa of ["copiar", "repositorio-wiki", "tirar-do-indice"] as Etapa[]) {
    test(`Dado uma falha na etapa ${etapa}, Quando a migração roda, Então para, nada é apagado e rodar de novo termina`, async () => {
      const { pessoa } = await cenario({ n1: false });
      for (const rel of EDITADOS) editar(pessoa, rel, `MEU ${rel}\n`);
      const antes = hashes(pessoa, EDITADOS);
      const r = await migrarRastreio(pessoa, { aoEntrarNaEtapa: (e) => { if (e === etapa) throw new Error("falha simulada"); } });
      expect(r).toMatchObject({ codigo: 1, situacao: "incompleta" });
      expect(r.manifesto!.etapa).toBe(etapa);
      expect(hashes(pessoa, EDITADOS)).toEqual(antes);
      const final = await migrarRastreio(pessoa);
      expect(final.codigo).toBe(0);
      expect(hashes(pessoa, EDITADOS)).toEqual(antes);
      expect(ls(pessoa)).toBe("");
      expect(await pendentes(pessoa)).toEqual([]);
    });
  }

  test("Dado o git rm --cached falha (índice travado), Quando a migração roda, Então fica incompleta e os arquivos ficam onde estão", async () => {
    const { pessoa } = await cenario({ n1: false });
    editar(pessoa, "SCHEMA.md", "MEU");
    writeFileSync(join(pessoa, ".git/index.lock"), "");
    const r = await migrarRastreio(pessoa);
    expect(r.codigo).toBe(1);
    expect(r.manifesto!.erro).toContain("git rm --cached falhou");
    expect(readFileSync(join(pessoa, "SCHEMA.md"), "utf8")).toBe("MEU");
    rmSync(join(pessoa, ".git/index.lock"));
    expect((await migrarRastreio(pessoa)).codigo).toBe(0);
  });

  test("Dado um item da lista que não é arquivo comum, Quando a migração roda, Então para na cópia sem mexer em nada", async () => {
    const { pessoa } = await cenario({ n1: false });
    rmSync(join(pessoa, "wiki/log.md")); mkdirSync(join(pessoa, "wiki/log.md"));
    const r = await migrarRastreio(pessoa);
    expect(r.codigo).toBe(1);
    expect(r.manifesto!.etapa).toBe("copiar");
    expect(ls(pessoa)).toContain("SCHEMA.md");
  });

  test("Dado uma pasta que não é a raiz de um clone git, Quando migro, Então recusa sem escrever nada", async () => {
    const pasta = join(tmp, "solta"); mkdirSync(pasta);
    const r = await migrarRastreio(pasta);
    expect(r.codigo).toBe(1);
    expect(r.mensagens.join("\n")).toContain("não é a raiz de um clone git");
    expect(readdirSync(pasta)).toEqual([]);
  });

  test("Dado outra migração rodando (trava de processo vivo), Quando migro, Então recusa; trava de processo morto é retomada", async () => {
    const { pessoa } = await cenario({ n1: false });
    mkdirSync(join(pessoa, ".anvilore"), { recursive: true });
    const vivo = Bun.spawn([process.execPath, "-e", "await Bun.sleep(20000)"]);
    try {
      writeFileSync(join(pessoa, ".anvilore/migracao.lock"), String(vivo.pid));
      const r = await migrarRastreio(pessoa);
      expect(r.codigo).toBe(1);
      expect(r.mensagens.join("\n")).toContain("outra migração está rodando");
    } finally { vivo.kill(); await vivo.exited; }
    expect((await migrarRastreio(pessoa)).codigo).toBe(0);
    expect(existsSync(join(pessoa, ".anvilore/migracao.lock"))).toBe(false);
  });

  test("Dado .anvilore/ do clone, Quando pergunto ao git, Então é ignorado pelo kit (a cópia e o estacionamento nunca travam o pull)", async () => {
    const { pessoa } = await cenario({ n1: false });
    expect(git(pessoa, "check-ignore", "-q", ".anvilore/migracao/x/estacionados/SCHEMA.md").codigo).toBe(0);
  });
});

describe("migrar-rastreio: atualizar o clone (PLANO §4b passo 5)", () => {
  test("Dado a N+1 publicada e o clone sem migrar com SCHEMA.md editado, Quando a pessoa faz git pull, Então o git recusa e o arquivo fica intacto [verificar no U1]", async () => {
    const { pessoa } = await cenario();
    editar(pessoa, "SCHEMA.md", "MEU");
    const pull = git(pessoa, "pull", "-q");
    expect(pull.codigo).not.toBe(0);
    expect(pull.saida).toContain("SCHEMA.md");
    expect(readFileSync(join(pessoa, "SCHEMA.md"), "utf8")).toBe("MEU");
    expect(gitOk(pessoa, "log", "-1", "--pretty=%s")).toBe("versão N");
  });

  test("Dado a N+1 publicada e o clone sem migrar e sem edição, Quando faz git pull, Então o git apaga os arquivos e os modelos os recriam sem o exemplo apagado voltar", async () => {
    const { pessoa } = await cenario();
    expect(git(pessoa, "pull", "-q").codigo).toBe(0);
    expect(existsSync(join(pessoa, "SCHEMA.md"))).toBe(false);
    mkdirSync(join(pessoa, "wiki/pessoal"), { recursive: true }); // a wiki da pessoa continua existindo
    const r = await copiarModelos(pessoa, { exemplo: true });
    expect(r.criados).toEqual(expect.arrayContaining(["SCHEMA.md", "wiki/index.md", "wiki/log.md"]));
    expect(existsSync(join(pessoa, "wiki/exemplo"))).toBe(false);
  });

  test("Dado a migração feita e a N+1 publicada, Quando a pessoa faz git pull direto, Então o git recusa (por isso existe --puxar) e nada é perdido", async () => {
    const { pessoa } = await cenario();
    editar(pessoa, "SCHEMA.md", "MEU");
    expect((await migrarRastreio(pessoa)).codigo).toBe(0);
    const pull = git(pessoa, "pull", "-q");
    expect(pull.codigo).not.toBe(0);
    expect(pull.saida).toContain("would be removed");
    expect(readFileSync(join(pessoa, "SCHEMA.md"), "utf8")).toBe("MEU");
  });

  test("Dado um clone antigo com arquivos editados e wiki sem repositório, Quando atualiza com --puxar, Então migra, aplica a N+1 e os arquivos têm o mesmo SHA-256 de antes", async () => {
    const { pessoa } = await cenario();
    for (const rel of EDITADOS) editar(pessoa, rel, `MEU ${rel}\n`);
    const antes = hashes(pessoa, [...EDITADOS, "wiki/exemplo/concepts/area-tematica.md", "raw/exemplo/llm-wiki.md"]);
    const r = await puxar(pessoa);
    expect(r).toMatchObject({ codigo: 0, situacao: "puxada" });
    expect(gitOk(pessoa, "log", "-1", "--pretty=%s")).toBe("versão N+1: dados fora do rastreio");
    expect(hashes(pessoa, Object.keys(antes))).toEqual(antes);
    expect(gitOk(pessoa, "status", "--porcelain")).toBe("");
    expect(gitOk(join(pessoa, "wiki"), "show", "HEAD:index.md")).toBe("MEU wiki/index.md");
    expect(await pendentes(pessoa)).toEqual([]);
    expect(r.mensagens.join("\n")).toContain("Migração concluída");
  });

  test("Dado um clone sem edição, Quando atualiza com --puxar, Então continuam no disco, iguais", async () => {
    const { pessoa } = await cenario();
    const rels = gitOk(pessoa, "ls-files", "--", ...LISTA_DO_RASTREIO).split("\n");
    const antes = hashes(pessoa, rels);
    expect((await puxar(pessoa)).codigo).toBe(0);
    expect(hashes(pessoa, rels)).toEqual(antes);
  });

  test("Dado wiki/exemplo e raw/exemplo apagados, Quando atualiza com --puxar e depois reinstala os modelos, Então nenhum dos dois volta", async () => {
    const { pessoa } = await cenario();
    rmSync(join(pessoa, "wiki/exemplo"), { recursive: true }); rmSync(join(pessoa, "raw/exemplo"), { recursive: true });
    expect((await puxar(pessoa)).codigo).toBe(0);
    await copiarModelos(pessoa, { exemplo: true });
    expect(existsSync(join(pessoa, "wiki/exemplo"))).toBe(false);
    expect(existsSync(join(pessoa, "raw/exemplo"))).toBe(false);
  });

  test("Dado o remoto inacessível (rede caindo), Quando atualiza com --puxar, Então o pull falha, os arquivos voltam conferidos e nada fica pendente", async () => {
    const { pessoa } = await cenario();
    editar(pessoa, "SCHEMA.md", "MEU");
    gitOk(pessoa, "remote", "set-url", "origin", join(tmp, "nao-existe.git"));
    const r = await puxar(pessoa);
    expect(r).toMatchObject({ codigo: 1, situacao: "pull-falhou" });
    expect(readFileSync(join(pessoa, "SCHEMA.md"), "utf8")).toBe("MEU");
    expect(r.mensagens.join("\n")).toContain("voltaram ao lugar");
    expect(await pendentes(pessoa)).toEqual([]);
    expect(gitOk(pessoa, "log", "-1", "--pretty=%s")).toBe("versão N");
  });

  test("Dado a rede cai durante o pull (falha depois de estacionar), Quando atualiza com --puxar, Então os arquivos voltam e o clone continua na N", async () => {
    const { pessoa } = await cenario();
    editar(pessoa, "SCHEMA.md", "MEU");
    const r = await puxar(pessoa, { aoEntrarNaEtapa: (etapa) => { if (etapa === "puxar") throw new Error("conexão perdida"); } });
    expect(r).toMatchObject({ codigo: 1, situacao: "pull-falhou" });
    expect(r.mensagens.join("\n")).toContain("conexão perdida");
    expect(readFileSync(join(pessoa, "SCHEMA.md"), "utf8")).toBe("MEU");
    expect(await pendentes(pessoa)).toEqual([]);
  });

  test("Dado o processo morto no meio do --puxar, Quando roda de novo, Então devolve os estacionados antes de qualquer coisa e termina a atualização", async () => {
    const { pessoa } = await cenario();
    editar(pessoa, "SCHEMA.md", "MEU");
    const script = join(import.meta.dir, "apoio", "morrer-no-meio.ts");
    const morto = Bun.spawnSync([process.execPath, script, pessoa, "puxar"], { stdout: "pipe", stderr: "pipe" });
    expect(morto.exitCode).toBe(9);
    expect(existsSync(join(pessoa, "SCHEMA.md"))).toBe(false); // estacionado em .anvilore/, não apagado
    const [pendente] = await pendentes(pessoa);
    expect(pendente!.estado).toBe("puxando");
    expect(readFileSync(join(pessoa, ".anvilore/migracao", pendente!.id, "estacionados/SCHEMA.md"), "utf8")).toBe("MEU");

    const r = await puxar(pessoa);
    expect(r.codigo).toBe(0);
    expect(readFileSync(join(pessoa, "SCHEMA.md"), "utf8")).toBe("MEU");
    expect(gitOk(pessoa, "log", "-1", "--pretty=%s")).toBe("versão N+1: dados fora do rastreio");
    expect(await pendentes(pessoa)).toEqual([]);
  });

  test("Dado o processo morto e o lugar ocupado de novo, Quando a retomada roda, Então não sobrescreve e fica incompleta com o arquivo estacionado", async () => {
    const { pessoa } = await cenario();
    editar(pessoa, "SCHEMA.md", "MEU");
    const script = join(import.meta.dir, "apoio", "morrer-no-meio.ts");
    expect(Bun.spawnSync([process.execPath, script, pessoa, "puxar"]).exitCode).toBe(9);
    editar(pessoa, "SCHEMA.md", "OUTRO");
    const r = await migrarRastreio(pessoa);
    expect(r.codigo).toBe(1);
    expect(r.mensagens.join("\n")).toContain("ocupado");
    expect(readFileSync(join(pessoa, "SCHEMA.md"), "utf8")).toBe("OUTRO");
    const [pendente] = await pendentes(pessoa);
    expect(readFileSync(join(pessoa, ".anvilore/migracao", pendente!.id, "estacionados/SCHEMA.md"), "utf8")).toBe("MEU");
  });

  test("Dado o lugar ocupado durante a atualização, Quando devolve, Então não sobrescreve e fica incompleta", async () => {
    const { pessoa } = await cenario();
    editar(pessoa, "SCHEMA.md", "MEU");
    const r = await puxar(pessoa, { aoEntrarNaEtapa: (etapa) => { if (etapa === "devolver") editar(pessoa, "SCHEMA.md", "INTRUSO"); } });
    expect(r).toMatchObject({ codigo: 1, situacao: "incompleta" });
    expect(readFileSync(join(pessoa, "SCHEMA.md"), "utf8")).toBe("INTRUSO");
    expect(r.manifesto!.estado).toBe("migracao-incompleta");
    expect(readFileSync(join(pessoa, ".anvilore/migracao", r.manifesto!.id, "estacionados/SCHEMA.md"), "utf8")).toBe("MEU");
  });

  test("Dado já na N+1, Quando --puxar roda de novo, Então nada é estacionado e o pull só confirma", async () => {
    const { pessoa } = await cenario();
    expect((await puxar(pessoa)).codigo).toBe(0);
    const r = await puxar(pessoa);
    expect(r.codigo).toBe(0);
    expect(r.manifesto!.estacionados).toEqual([]);
  });

  test("Dado a migração falha dentro do --puxar, Quando atualiza, Então não puxa", async () => {
    const { pessoa } = await cenario();
    const r = await puxar(pessoa, { aoEntrarNaEtapa: (etapa, m) => { if (etapa === "tirar-do-indice" && m.tipo === "migracao") throw new Error("falha"); } });
    expect(r.codigo).toBe(1);
    expect(gitOk(pessoa, "log", "-1", "--pretty=%s")).toBe("versão N");
  });

  test("Dado a N+1 aplicada e um SCHEMA.md ignorado, Quando alguém faz checkout --force da N (reversão R1 da U2), Então o git sobrescreve em silêncio — a restauração da cópia é obrigatória", async () => {
    const { pessoa } = await cenario();
    expect((await puxar(pessoa)).codigo).toBe(0);
    editar(pessoa, "SCHEMA.md", "MEU");
    gitOk(pessoa, "checkout", "-q", "--force", "--detach", "HEAD~1");
    expect(readFileSync(join(pessoa, "SCHEMA.md"), "utf8")).not.toBe("MEU");
  });
});

describe("migrar-rastreio: guarda de transporte no pull (A5-RR6)", () => {
  async function comExtHostil(pessoa: string, corpo: (marcador: string, helper: string) => Promise<void>) {
    const marcador = join(tmp, "marcador-ext");
    const helper = join(tmp, "helper-ext.sh");
    writeFileSync(helper, `#!/bin/sh\nprintf executado >> "${marcador}"\nexit 1\n`, { mode: 0o755 });
    gitOk(pessoa, "config", "protocol.ext.allow", "always");
    await corpo(marcador, helper);
  }

  test("Dado config local com protocol.ext.allow=always e origem ext::, Quando roda puxar, Então recusa o transporte e não executa o helper", async () => {
    const { pessoa } = await cenario();
    await comExtHostil(pessoa, async (marcador, helper) => {
      gitOk(pessoa, "config", "remote.origin.url", `ext::${helper}`);
      const r = await puxar(pessoa);
      expect(r.codigo).toBe(1);
      expect(r.situacao).toBe("pull-falhou");
      expect(existsSync(marcador)).toBe(false);
      expect(r.mensagens.join("\n")).toContain("Transporte recusado por segurança");
    });
  });

  test("Dado origem https e config com insteadOf que troca https por outro protocolo, Quando roda puxar, Então recusa o transporte e não executa o helper", async () => {
    const { pessoa } = await cenario();
    await comExtHostil(pessoa, async (marcador, helper) => {
      const oficial = "https://github.com/iagofrota/anvilore.git";
      gitOk(pessoa, "config", "remote.origin.url", oficial);
      gitOk(pessoa, "config", `url.ext::${helper}.insteadOf`, oficial);
      const r = await puxar(pessoa);
      expect(r.codigo).toBe(1);
      expect(r.situacao).toBe("pull-falhou");
      expect(existsSync(marcador)).toBe(false);
      expect(r.mensagens.join("\n")).toContain("Transporte recusado por segurança");
    });
  });

  test("Dado origem https normal, Quando roda puxar, Então a guarda de rede é aplicada com protocolo https e opções de segurança", async () => {
    const { pessoa } = await cenario();
    gitOk(pessoa, "remote", "set-url", "origin", "https://github.com/iagofrota/anvilore.git");
    const { guardaDeRede } = await import("../src/lib/atualizacao");
    const baseEnv = { PATH: process.env.PATH, GIT_ALLOW_PROTOCOL: "ext:fd:file", GIT_ASKPASS: "/tmp/askpass" };
    const g = guardaDeRede(["pull", "--ff-only"], baseEnv, "https://github.com/iagofrota/anvilore.git");
    expect(g.args).toEqual(["-c", "credential.helper=", "-c", "core.askPass=", "pull", "--ff-only"]);
    expect(g.env).toMatchObject({ GIT_ALLOW_PROTOCOL: "https", GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" });
  });

  test("Dado origem ssh (clonada por ssh), Quando roda puxar, Então o pull continua funcionando pela conexão ssh", async () => {
    const { origem, pessoa } = await cenario();
    gitOk(pessoa, "remote", "set-url", "origin", "git@github.com:iagofrota/anvilore.git");
    const fakeSsh = join(tmp, "fake-ssh.sh");
    writeFileSync(fakeSsh, `#!/bin/sh\nexec git-upload-pack "${origem}"\n`, { mode: 0o755 });
    gitOk(pessoa, "config", "core.sshCommand", `sh "${fakeSsh}"`);
    const r = await puxar(pessoa);
    expect(r.codigo).toBe(0);
    expect(r.situacao).toBe("puxada");
    expect(gitOk(pessoa, "log", "-1", "--pretty=%s")).toBe("versão N+1: dados fora do rastreio");
    expect(r.mensagens.join("\n")).toContain("Atualizado com git pull");
  });

  test("Dado origem ssh em sintaxe scp com alias de host (sem git@), Quando roda puxar, Então o pull continua funcionando pela conexão ssh", async () => {
    const { origem, pessoa } = await cenario();
    gitOk(pessoa, "remote", "set-url", "origin", "github:iagofrota/anvilore.git");
    const fakeSsh = join(tmp, "fake-ssh-alias.sh");
    writeFileSync(fakeSsh, `#!/bin/sh\nexec git-upload-pack "${origem}"\n`, { mode: 0o755 });
    gitOk(pessoa, "config", "core.sshCommand", `sh "${fakeSsh}"`);
    const r = await puxar(pessoa);
    expect(r.codigo).toBe(0);
    expect(r.situacao).toBe("puxada");
    expect(gitOk(pessoa, "log", "-1", "--pretty=%s")).toBe("versão N+1: dados fora do rastreio");
    expect(r.mensagens.join("\n")).toContain("Atualizado com git pull");
  });

  test("Dado um ramo rastreando o remoto upstream local e origin https, Quando roda puxar, Então o pull usa o transporte do remoto rastreado e atualiza com sucesso", async () => {
    const { origem, pessoa } = await cenario();
    gitOk(pessoa, "remote", "rename", "origin", "upstream");
    gitOk(pessoa, "remote", "add", "origin", "https://github.com/iagofrota/anvilore.git");
    expect(gitOk(pessoa, "config", "--get", "branch.main.remote")).toBe("upstream");
    const r = await puxar(pessoa);
    expect(r.codigo).toBe(0);
    expect(r.situacao).toBe("puxada");
    expect(gitOk(pessoa, "log", "-1", "--pretty=%s")).toBe("versão N+1: dados fora do rastreio");
    expect(r.mensagens.join("\n")).toContain("Atualizado com git pull");
  });

  test("Dado um ramo com remoto em caminho relativo simples (sem barra inicial nem ./), Quando roda puxar, Então o pull usa transporte local e atualiza com sucesso", async () => {
    const { origem, pessoa } = await cenario();
    const pastaRemoto = join(pessoa, "remoto-relativo");
    cpSync(origem, pastaRemoto, { recursive: true });
    gitOk(pessoa, "remote", "add", "relativo", "remoto-relativo");
    gitOk(pessoa, "config", "branch.main.remote", "relativo");
    const r = await puxar(pessoa);
    expect(r.codigo).toBe(0);
    expect(r.situacao).toBe("puxada");
    expect(gitOk(pessoa, "log", "-1", "--pretty=%s")).toBe("versão N+1: dados fora do rastreio");
    expect(r.mensagens.join("\n")).toContain("Atualizado com git pull");
  });

  test("Dado um ramo rastreando upstream local e config com insteadOf que troca o upstream por outro protocolo, Quando roda puxar, Então recusa o transporte e não executa o helper", async () => {
    const { origem, pessoa } = await cenario();
    gitOk(pessoa, "remote", "rename", "origin", "upstream");
    gitOk(pessoa, "remote", "add", "origin", "https://github.com/iagofrota/anvilore.git");
    await comExtHostil(pessoa, async (marcador, helper) => {
      gitOk(pessoa, "config", `url.ext::${helper}.insteadOf`, origem);
      const r = await puxar(pessoa);
      expect(r.codigo).toBe(1);
      expect(r.situacao).toBe("pull-falhou");
      expect(existsSync(marcador)).toBe(false);
      expect(r.mensagens.join("\n")).toContain("Transporte recusado por segurança");
    });
  });

  test("Dado resolverOrigem, Quando exercitado com diferentes argumentos e configurações, Então resolve a origem apropriada", async () => {
    const { pessoa } = await cenario();
    const { resolverOrigem } = await import("../src/lib/git-rede");
    expect(resolverOrigem(["status"], pessoa)).toBeUndefined();
    gitOk(pessoa, "remote", "set-url", "origin", "https://github.com/iagofrota/anvilore.git");
    expect(resolverOrigem(["fetch", "--depth", "1", "origin"], pessoa)).toBe("https://github.com/iagofrota/anvilore.git");
    expect(resolverOrigem(["fetch", "--", "origin"], pessoa)).toBe("https://github.com/iagofrota/anvilore.git");
    expect(resolverOrigem(["fetch", "https://exemplo.com/repo.git"], pessoa)).toBe("https://exemplo.com/repo.git");
    gitOk(pessoa, "config", "branch.main.remote", "/tmp/direto");
    expect(resolverOrigem(["pull", "--ff-only"], pessoa)).toBe("/tmp/direto");
    gitOk(pessoa, "config", "branch.main.remote", "remotes/upstream.git");
    expect(resolverOrigem(["pull", "--ff-only"], pessoa)).toBe("remotes/upstream.git");
    gitOk(pessoa, "remote", "remove", "origin");
    gitOk(pessoa, "config", "--unset", "branch.main.remote");
    expect(resolverOrigem(["pull", "--ff-only"], pessoa)).toBeUndefined();
  });
});

describe("migrar-rastreio: o próprio kit na N+1", () => {
  test("Dado este repositório, Quando listo o índice e o .gitignore, Então nenhum arquivo da pessoa é rastreado e todos são ignorados", () => {
    const kit = resolve(import.meta.dir, "..");
    expect(ls(kit)).toBe("");
    for (const rel of ["SCHEMA.md", "wiki/index.md", "wiki/pessoal/concepts/x.md", "raw/fonte.pdf", ".anvilore/migracao/x/manifesto.json"]) {
      expect(git(kit, "check-ignore", "-q", "--no-index", rel).codigo).toBe(0);
    }
    expect(git(kit, "check-ignore", "-q", "--no-index", "modelos/wiki/index.md").codigo).toBe(1);
  });
});

describe("migrar-rastreio: manifesto corrompido (revisão U1, B1)", () => {
  // Processo morto com SCHEMA.md estacionado; devolve o id do manifesto que ficou "puxando".
  async function mortoComEstacionado() {
    const { pessoa } = await cenario();
    editar(pessoa, "SCHEMA.md", "MEU");
    const script = join(import.meta.dir, "apoio", "morrer-no-meio.ts");
    expect(Bun.spawnSync([process.execPath, script, pessoa, "puxar"]).exitCode).toBe(9);
    const [pendente] = await pendentes(pessoa);
    const pasta = join(pessoa, ".anvilore/migracao", pendente!.id);
    return { pessoa, pendente: pendente!, pasta, manifesto: join(pasta, "manifesto.json") };
  }
  async function bloqueia(pessoa: string, pasta: string) {
    for (const r of [await migrarRastreio(pessoa), await puxar(pessoa)]) {
      expect(r.codigo).toBe(1);
      expect(r.situacao).not.toBe("nada-a-migrar");
      expect(r.mensagens.join("\n")).toContain(join(".anvilore", "migracao", basename(pasta)));
    }
    expect(readFileSync(join(pasta, "estacionados/SCHEMA.md"), "utf8")).toBe("MEU");
    expect(existsSync(join(pessoa, "SCHEMA.md"))).toBe(false);
    expect(gitOk(pessoa, "log", "-1", "--pretty=%s")).toBe("versão N");
    const trava = (await diagnosticar(pessoa)).travas.find(t => t.nome === "Migração dos seus arquivos para fora do rastreio do kit");
    expect(trava?.ligada).toBe(false);
    expect(trava?.detalhe).toContain(join(".anvilore", "migracao", basename(pasta)));
  }

  test("Dado o processo morto em puxar e o manifesto trocado por {}, Quando roda de novo, Então bloqueia apontando a cópia e nunca diz nada-a-migrar", async () => {
    const { pessoa, pasta, manifesto } = await mortoComEstacionado();
    writeFileSync(manifesto, "{}");
    await bloqueia(pessoa, pasta);
  });

  test("Dado o manifesto com id diferente do nome da pasta, Quando roda de novo, Então bloqueia", async () => {
    const { pessoa, pasta, manifesto } = await mortoComEstacionado();
    const dado = JSON.parse(readFileSync(manifesto, "utf8"));
    writeFileSync(manifesto, JSON.stringify({ ...dado, id: "outro" }));
    await bloqueia(pessoa, pasta);
  });

  for (const [caso, mudar] of [
    ["sem a lista de arquivos", (m: any) => { delete m.arquivos; }],
    ["com estado desconhecido", (m: any) => { m.estado = "feito"; }],
    ["com SHA-256 malformado", (m: any) => { m.arquivos[0].sha256 = "abc"; }],
    ["com caminho que sai do clone", (m: any) => { m.estacionados = ["../fora.md"]; }],
    ["com caminho absoluto", (m: any) => { m.arquivos[0].caminho = "/etc/passwd"; }],
    ["com estacionados que não é lista", (m: any) => { m.estacionados = "SCHEMA.md"; }],
    ["com a wiki sem forma", (m: any) => { m.wiki = { caminho: 1 }; }],
    ["que não é objeto", (_m: any) => null],
  ] as const) {
    test(`Dado o manifesto ${caso}, Quando roda de novo, Então bloqueia`, async () => {
      const { pessoa, pasta, manifesto } = await mortoComEstacionado();
      const dado = JSON.parse(readFileSync(manifesto, "utf8"));
      const resultado = (mudar as (m: any) => unknown)(dado);
      writeFileSync(manifesto, JSON.stringify(resultado === null ? [] : dado));
      await bloqueia(pessoa, pasta);
    });
  }

  test("Dado estacionados/ com arquivo e sem manifesto, Quando roda de novo, Então bloqueia", async () => {
    const { pessoa, pasta, manifesto } = await mortoComEstacionado();
    rmSync(manifesto);
    await bloqueia(pessoa, pasta);
  });

  test("Dado uma pasta de migração vazia, sem manifesto (morte antes de gravá-lo), Quando migra, Então segue normalmente", async () => {
    const { pessoa } = await cenario({ n1: false });
    mkdirSync(join(pessoa, ".anvilore/migracao/2026-01-01T00-00-00-000Z-abcdef"), { recursive: true });
    expect((await migrarRastreio(pessoa)).codigo).toBe(0);
  });

  test("Dado o manifesto corrompido corrigido à mão (o estacionado devolvido), Quando roda de novo, Então segue", async () => {
    const { pessoa, pasta, manifesto } = await mortoComEstacionado();
    writeFileSync(manifesto, "{}");
    expect((await puxar(pessoa)).codigo).toBe(1);
    renameSync(join(pasta, "estacionados/SCHEMA.md"), join(pessoa, "SCHEMA.md"));
    rmSync(pasta, { recursive: true });
    expect((await puxar(pessoa)).codigo).toBe(0);
    expect(readFileSync(join(pessoa, "SCHEMA.md"), "utf8")).toBe("MEU");
  });
});

describe("migrar-rastreio: nada volta ao lugar sem conferir o SHA-256 (revisão U1, B2)", () => {
  async function mortoComEstacionado() {
    const { pessoa } = await cenario();
    editar(pessoa, "SCHEMA.md", "MEU");
    const script = join(import.meta.dir, "apoio", "morrer-no-meio.ts");
    expect(Bun.spawnSync([process.execPath, script, pessoa, "puxar"]).exitCode).toBe(9);
    const [pendente] = await pendentes(pessoa);
    const pasta = join(pessoa, ".anvilore/migracao", pendente!.id);
    return { pessoa, id: pendente!.id, pasta };
  }

  test("Dado o processo morto em puxar e o SCHEMA.md estacionado corrompido, Quando roda de novo, Então devolve a cópia conferida e guarda o corrompido ao lado, sem apagar", async () => {
    const { pessoa, id, pasta } = await mortoComEstacionado();
    writeFileSync(join(pasta, "estacionados/SCHEMA.md"), "CORRUPTO");
    const r = await migrarRastreio(pessoa);
    expect(r.codigo).toBe(0);
    expect(readFileSync(join(pessoa, "SCHEMA.md"), "utf8")).toBe("MEU");
    expect(readFileSync(join(pessoa, `SCHEMA.md.divergente-${id}`), "utf8")).toBe("CORRUPTO");
    expect(r.mensagens.join("\n")).toContain(`SCHEMA.md.divergente-${id}`);
    expect(await pendentes(pessoa)).toEqual([]);
    expect((await puxar(pessoa)).codigo).toBe(0);
    expect(readFileSync(join(pessoa, "SCHEMA.md"), "utf8")).toBe("MEU");
  });

  test("Dado o estacionado e a cópia de arquivos/ corrompidos, Quando roda de novo, Então bloqueia com os caminhos, não mexe em nada e o doctor sai 1", async () => {
    const { pessoa, pasta } = await mortoComEstacionado();
    writeFileSync(join(pasta, "estacionados/SCHEMA.md"), "CORRUPTO");
    writeFileSync(join(pasta, "arquivos/SCHEMA.md"), "TAMBÉM");
    for (const r of [await migrarRastreio(pessoa), await puxar(pessoa)]) {
      expect(r.codigo).toBe(1);
      expect(r.mensagens.join("\n")).toContain(join(".anvilore", "migracao", basename(pasta)));
      expect(r.mensagens.join("\n")).toContain("SHA-256");
    }
    expect(existsSync(join(pessoa, "SCHEMA.md"))).toBe(false);
    expect(readFileSync(join(pasta, "estacionados/SCHEMA.md"), "utf8")).toBe("CORRUPTO");
    expect(gitOk(pessoa, "log", "-1", "--pretty=%s")).toBe("versão N");
    const trava = (await diagnosticar(pessoa)).travas.find(t => t.nome === "Migração dos seus arquivos para fora do rastreio do kit");
    expect(trava?.ligada).toBe(false);
  });

  test("Dado uma migração incompleta e o SCHEMA.md alterado depois, Quando retoma, Então a versão alterada fica guardada ao lado e o conferido volta", async () => {
    const { pessoa } = await cenario({ n1: false });
    editar(pessoa, "SCHEMA.md", "MEU");
    const r = await migrarRastreio(pessoa, { aoEntrarNaEtapa: (e) => { if (e === "tirar-do-indice") throw new Error("falha simulada"); } });
    editar(pessoa, "SCHEMA.md", "EDITADO DEPOIS");
    const de_novo = await migrarRastreio(pessoa);
    expect(de_novo.codigo).toBe(0);
    expect(readFileSync(join(pessoa, "SCHEMA.md"), "utf8")).toBe("MEU");
    expect(readFileSync(join(pessoa, `SCHEMA.md.divergente-${r.manifesto!.id}`), "utf8")).toBe("EDITADO DEPOIS");
  });

  test("Dado a conferência acha um arquivo divergente no mesmo processo, Quando restaura, Então o divergente fica guardado ao lado", async () => {
    const { pessoa } = await cenario({ n1: false });
    editar(pessoa, "SCHEMA.md", "MEU");
    const r = await migrarRastreio(pessoa, { aoEntrarNaEtapa: (etapa) => { if (etapa === "conferir") editar(pessoa, "SCHEMA.md", "CORROMPIDO"); } });
    expect(r.codigo).toBe(0);
    expect(readFileSync(join(pessoa, "SCHEMA.md"), "utf8")).toBe("MEU");
    expect(readFileSync(join(pessoa, `SCHEMA.md.divergente-${r.manifesto!.id}`), "utf8")).toBe("CORROMPIDO");
  });

  test("Dado um manifesto com estacionado que não está na lista de arquivos (sem hash), Quando roda de novo, Então bloqueia", async () => {
    const { pessoa, pasta } = await mortoComEstacionado();
    const caminho = join(pasta, "manifesto.json");
    const dado = JSON.parse(readFileSync(caminho, "utf8"));
    dado.arquivos = dado.arquivos.filter((a: { caminho: string }) => a.caminho !== "SCHEMA.md");
    writeFileSync(caminho, JSON.stringify(dado));
    expect((await migrarRastreio(pessoa)).codigo).toBe(1);
    expect(readFileSync(join(pasta, "estacionados/SCHEMA.md"), "utf8")).toBe("MEU");
  });
});

describe("migrar-rastreio: comando", () => {
  test("Dado ajuda, argumento a mais ou opção desconhecida, Quando rodo o comando, Então 0, 2 e 2", async () => {
    expect(await comandoMigrarRastreio(["--help"])).toBe(0);
    expect(console_.saida.join("\n")).toContain("Uso: anvilore migrar-rastreio");
    expect(await comandoMigrarRastreio(["a", "b"])).toBe(2);
    expect(await comandoMigrarRastreio(["--outra"])).toBe(2);
  });

  test("Dado um clone antigo, Quando rodo `anvilore migrar-rastreio <pasta>` e depois com --puxar, Então sai 0 nas duas", async () => {
    const { pessoa } = await cenario();
    expect(await executar(["migrar-rastreio", pessoa])).toBe(0);
    expect(console_.saida.join("\n")).toContain("Migração concluída");
    process.env.ANVILORE_DESTINO = pessoa;
    expect(await executar(["migrar-rastreio", "--puxar"])).toBe(0);
    expect(console_.saida.join("\n")).toContain("Atualizado com git pull");
  });

  test("Dado uma pasta que não é clone, Quando rodo o comando, Então sai 1 explicando", async () => {
    expect(await comandoMigrarRastreio([resolve(tmp)])).toBe(1);
    expect(console_.erros.join("\n")).toContain("não é a raiz de um clone git");
  });

  test("Dado um manifesto ilegível, Quando rodo o comando, Então sai 1 sem apagar nada", async () => {
    const { pessoa } = await cenario({ n1: false });
    mkdirSync(join(pessoa, ".anvilore/migracao/x"), { recursive: true });
    writeFileSync(join(pessoa, ".anvilore/migracao/x/manifesto.json"), "{");
    expect(await comandoMigrarRastreio([pessoa])).toBe(1);
    expect(console_.erros.join("\n")).toContain("Nada seu foi apagado");
    expect(existsSync(join(pessoa, ".anvilore/migracao/x/manifesto.json"))).toBe(true);
  });
});

describe("migrar-rastreio: doctor", () => {
  const MIGRACAO = "Migração dos seus arquivos para fora do rastreio do kit";

  test("Dado um clone na versão N que ainda rastreia os arquivos da pessoa, Quando o doctor roda, Então avisa 'clone a migrar' sem reprovar por isso", async () => {
    const { pessoa } = await cenario({ n1: false });
    const d = await diagnosticar(pessoa);
    expect(d.avisos.join("\n")).toContain("Clone a migrar");
    expect(d.avisos.join("\n")).toContain("migrar-rastreio --puxar");
    expect(d.travas.find(t => t.nome === MIGRACAO)).toBeUndefined();
  });

  test("Dado a migração feita, Quando o doctor roda, Então não avisa mais", async () => {
    const { pessoa } = await cenario({ n1: false });
    await migrarRastreio(pessoa);
    expect((await diagnosticar(pessoa)).avisos.join("\n")).not.toContain("Clone a migrar");
  });

  test("Dado uma migração incompleta, Quando o doctor roda, Então sai 1 mostrando a etapa e onde está a cópia", async () => {
    const { pessoa } = await cenario({ n1: false });
    const r = await migrarRastreio(pessoa, { aoEntrarNaEtapa: (e) => { if (e === "tirar-do-indice") throw new Error("falha simulada"); } });
    const trava = (await diagnosticar(pessoa)).travas.find(t => t.nome === MIGRACAO)!;
    expect(trava.ligada).toBe(false);
    expect(trava.opcional).toBeFalsy();
    expect(trava.detalhe).toContain('etapa "tirar-do-indice"');
    expect(trava.detalhe).toContain(join(".anvilore", "migracao", r.manifesto!.id));
    expect(trava.comoLigar).toContain("migrar-rastreio");
    // Sem consultar agentes reais: PATH só com o git e MCP de mentira (o doctor real pergunta a cada CLI de agente).
    process.env.PATH = dirname(Bun.which("git")!);
    const ambienteMcp = { home: tmp, existe: async () => false, executar: async () => ({ codigo: 1, saida: "" }) };
    expect(await comandoDoctor([pessoa], { ambienteMcp })).toBe(1);
    expect(console_.saida.join("\n")).toContain(MIGRACAO);
  });

  test("Dado um manifesto ilegível, Quando o doctor roda, Então a trava cai dizendo por quê", async () => {
    const { pessoa } = await cenario({ n1: false });
    mkdirSync(join(pessoa, ".anvilore/migracao/x"), { recursive: true });
    writeFileSync(join(pessoa, ".anvilore/migracao/x/manifesto.json"), "{");
    const trava = (await diagnosticar(pessoa)).travas.find(t => t.nome === MIGRACAO)!;
    expect(trava.ligada).toBe(false);
    expect(trava.detalhe).toContain("ilegível");
  });
});
