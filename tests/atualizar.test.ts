import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atualizar, compararSemVer, comandoAtualizar, decidirPolitica, parsearSemVer, selecionarRelease, tipoDeLink } from "../src/lib/atualizacao";
import { capturarConsole } from "./apoio/console";
import { arvore, criarChave, criarKit, gitReal, type Kit, type Versao } from "./apoio/kit-atualizavel";

describe("atualizador: SemVer e canal", () => {
  test("Dado versões SemVer válidas e inválidas, Quando analiso, Então recusa forma inválida sem normalizar", () => {
    expect(parsearSemVer("0.3.1")).toMatchObject({ major: 0n, minor: 3n, patch: 1n });
    expect(parsearSemVer("v0.3.1")).toBeUndefined();
    expect(parsearSemVer("0.03.1")).toBeUndefined();
    expect(parsearSemVer("0.3.1-01")).toBeUndefined();
  });

  test("Dado pré-releases SemVer, Quando comparo, Então ordena identificadores numéricos antes dos textuais", () => {
    expect(compararSemVer("1.0.0-rc.2", "1.0.0-rc.10")).toBeLessThan(0);
    expect(compararSemVer("1.0.0-rc", "1.0.0")).toBeLessThan(0);
    expect(compararSemVer("1.0.0", "1.0.0")).toBe(0);
  });

  test("Dado uma correção, menor e pré-release, Quando escolho política, Então aplica correção, pergunta pela menor e limita pré-release ao canal teste", () => {
    expect(decidirPolitica("0.3.0", "0.3.1", "automatico")).toBe("aplicar");
    expect(decidirPolitica("0.3.1", "0.4.0", "automatico")).toBe("perguntar");
    expect(decidirPolitica("0.3.1", "0.4.0", "nunca")).toBe("ignorar");
    expect(decidirPolitica("0.3.1", "0.4.0-rc.1", "automatico", "estavel")).toBe("ignorar");
    expect(decidirPolitica("0.3.1", "0.4.0-rc.1", "automatico", "teste")).toBe("perguntar");
  });

  test("Dado releases misturadas, Quando seleciono canal estável ou de teste, Então ignora rascunhos, pré-release fora do canal e versões menores", () => {
    const releases = [
      { tag_name: "v0.4.0-rc.1", draft: false, prerelease: true },
      { tag_name: "v0.3.2", draft: true, prerelease: false },
      { tag_name: "v0.3.1", draft: false, prerelease: false },
      { tag_name: "v0.3.0", draft: false, prerelease: false },
    ];
    expect(selecionarRelease("0.3.0", releases, "estavel")?.tag).toBe("v0.3.1");
    expect(selecionarRelease("0.3.0", releases, "teste")?.tag).toBe("v0.4.0-rc.1");
    expect(selecionarRelease("0.3.1", releases, "estavel")).toBeUndefined();
  });
});

test("Dado opção desconhecida, Quando invoca o comando atualizar, Então mostra o uso e devolve 2", async () => {
  const c = capturarConsole();
  try {
    expect(await comandoAtualizar(["--desconhecida"])).toBe(2);
    expect(c.erros.join("\n")).toContain("Uso: anvilore atualizar");
  } finally { c.restaurar(); }
});
test("Dado allow_signers ausente, vazio ou inválido, Quando verifica uma tag, Então recusa e orienta a configuração", async () => {
  if (!Bun.which("git")) return;
  const raiz = await mkdtemp(join(tmpdir(), "anvilore-signers-invalidos-"));
  const git = (args: string[]) => {
    const p = Bun.spawnSync(["git", "-C", raiz, ...args], { stdout: "pipe", stderr: "pipe" });
    return { codigo: p.exitCode, saida: `${p.stdout.toString()}${p.stderr.toString()}`.trim() };
  };
  try {
    expect(git(["init", "-q"]).codigo).toBe(0);
    expect(git(["config", "core.autocrlf", "false"]).codigo).toBe(0);
    const { verificarAssinaturaTag } = await import("../src/lib/atualizacao");
    expect(verificarAssinaturaTag(raiz, "v0.3.1", git)).toContain("seguranca/assinantes ausente");
    await mkdir(join(raiz, "seguranca"), { recursive: true });
    await writeFile(join(raiz, "seguranca/assinantes"), "");
    expect(verificarAssinaturaTag(raiz, "v0.3.1", git)).toContain("seguranca/assinantes vazio");
    await writeFile(join(raiz, "seguranca/assinantes"), "linha inválida sem chave SSH\n");
    expect(verificarAssinaturaTag(raiz, "v0.3.1", git)).toContain("git verify-tag recusou");
    expect(verificarAssinaturaTag(raiz, "v0.3.1", git)).toContain("principal");
  } finally { await rm(raiz, { recursive: true, force: true }); }
});

test("Dado tags SSH descartáveis, Quando a confiança vem do commit anterior, Então ignora assinante da candidata e detecta assinatura adulterada", async () => {
  if (!Bun.which("ssh-keygen") || !Bun.which("git")) return;
  const raiz = await mkdtemp(join(tmpdir(), "anvilore-tag-ssh-"));
  const pasta = join(raiz, "seguranca");
  await mkdir(pasta, { recursive: true });
  const chaveAnterior = join(raiz, "chave-anterior-descartavel");
  const chaveCandidata = join(raiz, "chave-candidata-descartavel");
  for (const chave of [chaveAnterior, chaveCandidata]) {
    const gerada = Bun.spawnSync(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "fixture-descartavel", "-f", chave], { stdout: "pipe", stderr: "pipe" });
    expect(gerada.exitCode).toBe(0);
  }
  const chavePublica = async (chave: string) => (await readFile(`${chave}.pub`, "utf8")).trim().split(/\s+/).slice(0, 2).join(" ");
  const allowAnterior = `teste@localhost namespaces="git" ${await chavePublica(chaveAnterior)}\n`;
  const allowCandidata = `teste@localhost namespaces="git" ${await chavePublica(chaveCandidata)}\n`;
  await writeFile(join(pasta, "assinantes"), allowAnterior);
  const git = (args: string[]) => {
    const p = Bun.spawnSync(["git", "-C", raiz, ...args], { stdout: "pipe", stderr: "pipe" });
    return { codigo: p.exitCode, saida: `${p.stdout.toString()}${p.stderr.toString()}`.trim() };
  };
  const assinarTag = (nome: string, chave: string) => git(["-c", "gpg.format=ssh", "-c", `user.signingkey=${chave}`, "tag", "-s", nome, "-m", nome]);
  const { verificarAssinaturaTag } = await import("../src/lib/atualizacao");
  try {
    expect(git(["init", "-q"]).codigo).toBe(0);
    expect(git(["config", "core.autocrlf", "false"]).codigo).toBe(0);
    expect(git(["config", "user.name", "Teste Anvilore"]).codigo).toBe(0);
    expect(git(["config", "user.email", "teste@localhost"]).codigo).toBe(0);
    expect(git(["config", "commit.gpgsign", "false"]).codigo).toBe(0);
    await writeFile(join(raiz, "arquivo.txt"), "fixture\n");
    await writeFile(join(raiz, "seguranca/assinantes"), allowAnterior);
    expect(git(["add", "arquivo.txt"]).codigo).toBe(0);
    expect(git(["add", "seguranca/assinantes"]).codigo).toBe(0);
    expect(git(["commit", "-qm", "fixture"]).codigo).toBe(0);
    const anterior = git(["rev-parse", "HEAD"]).saida;
    expect(assinarTag("v0.3.0", chaveAnterior).codigo).toBe(0);
    expect(verificarAssinaturaTag(raiz, "v0.3.0", git)).toBeUndefined();

    await writeFile(join(raiz, "arquivo.txt"), "candidata\n");
    await writeFile(join(pasta, "assinantes"), allowCandidata);
    expect(git(["add", "arquivo.txt", "seguranca/assinantes"]).codigo).toBe(0);
    expect(git(["commit", "-qm", "candidata troca assinante"]).codigo).toBe(0);
    expect(assinarTag("v0.3.1", chaveCandidata).codigo).toBe(0);
    expect(git(["checkout", "--detach", anterior]).codigo).toBe(0);
    expect(await readFile(join(pasta, "assinantes"), "utf8")).toBe(allowAnterior);

    // A tag é válida quando se fornece a chave que veio apenas no commit candidato.
    await writeFile(join(raiz, "seguranca/assinantes"), allowCandidata);
    expect(git(["-c", "gpg.format=ssh", "-c", `gpg.ssh.allowedSignersFile=${join(pasta, "assinantes")}`, "verify-tag", "v0.3.1"]).codigo).toBe(0);
    // O verificador do atualizador usa apenas o arquivo confiável ainda presente no checkout anterior.
    await writeFile(join(pasta, "assinantes"), allowAnterior);
    expect(verificarAssinaturaTag(raiz, "v0.3.1", git)).toContain("assinatura inválida");

    // Alterar a assinatura do objeto tag, mantendo o assinante anterior confiável, deve falhar.
    const tagRaw = git(["cat-file", "tag", "v0.3.0"]).saida;
    const adulterada = tagRaw.replace(/(-----BEGIN SSH SIGNATURE-----\n)([^\n]+)/, (_m, inicio: string, assinatura: string) => {
      const troca = assinatura[0] === "A" ? "B" : "A";
      return `${inicio}${troca}${assinatura.slice(1)}`;
    });
    expect(adulterada).not.toBe(tagRaw);
    const arquivoTag = join(raiz, "tag-adulterada");
    await writeFile(arquivoTag, adulterada);
    const objeto = git(["hash-object", "-w", "-t", "tag", arquivoTag]);
    expect(objeto.codigo).toBe(0);
    expect(git(["update-ref", "refs/tags/v0.3.0", objeto.saida]).codigo).toBe(0);
    expect(verificarAssinaturaTag(raiz, "v0.3.0", git)).toContain("assinatura inválida");
  } finally { await rm(raiz, { recursive: true, force: true }); }
});

test("Dado SCHEMA.md ignorado preservado na migração, Quando checkout --force volta a sobrescrevê-lo, Então devolverTudo restaura a cópia conferida", async () => {
  if (!Bun.which("git")) return;
  const raiz = await mkdtemp(join(tmpdir(), "anvilore-checkout-migracao-"));
  const git = (args: string[]) => {
    const p = Bun.spawnSync(["git", "-C", raiz, ...args], { stdout: "pipe", stderr: "pipe" });
    return { codigo: p.exitCode, saida: `${p.stdout.toString()}${p.stderr.toString()}`.trim() };
  };
  try {
    expect(git(["init", "-q"]).codigo).toBe(0);
    expect(git(["config", "core.autocrlf", "false"]).codigo).toBe(0);
    expect(git(["config", "user.name", "Teste Anvilore"]).codigo).toBe(0);
    expect(git(["config", "user.email", "teste@localhost"]).codigo).toBe(0);
    await writeFile(join(raiz, "SCHEMA.md"), "modelo da tag\n");
    expect(git(["add", "SCHEMA.md"]).codigo).toBe(0);
    expect(git(["commit", "-qm", "versão antiga"]).codigo).toBe(0);
    const original = git(["rev-parse", "HEAD"]).saida;
    await writeFile(join(raiz, "SCHEMA.md"), "contrato da pessoa\n");
    const { migrarRastreio, devolverTudo } = await import("../src/lib/migracao");
    const migration = await migrarRastreio(raiz, { listaDoRastreio: ["SCHEMA.md"] });
    expect(migration.codigo).toBe(0);
    expect(git(["ls-files", "SCHEMA.md"]).saida).toBe("");
    expect(git(["checkout", "--force", "--detach", original]).codigo).toBe(0);
    expect(await readFile(join(raiz, "SCHEMA.md"), "utf8")).toBe("modelo da tag\n");
    const restored = await devolverTudo(raiz, migration.manifesto!);
    expect(restored.problemas).toEqual([]);
    expect(await readFile(join(raiz, "SCHEMA.md"), "utf8")).toBe("contrato da pessoa\n");
  } finally { await rm(raiz, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------------------
// Cenários com Git, checkout e tags SSH reais (tests/apoio/kit-atualizavel.ts). Só rede e, quando dito, instalar,
// doctor e hook são simulados; nos demais, rodam em subprocesso pelo src/cli.ts da versão ativa no disco.
// ---------------------------------------------------------------------------------------------------------------

const temFerramentas = Boolean(Bun.which("git") && Bun.which("ssh-keygen"));
// 30 s: no Windows do CI cada cenário com Git real levou de 2 a 4 s, perto do limite padrão de 5 s.
const real = (nome: string, corpo: () => Promise<void>) => (temFerramentas ? test : test.skip)(nome, corpo, 30_000);
const CONFIG = [".claude", ".codex", ".agents", ".gemini", ".github", "anvilore.toml"];
const kits: Kit[] = [];
afterAll(async () => { for (const kit of kits) await kit.limpar(); });
async function kit(versoes: Versao[], opcoes?: Parameters<typeof criarKit>[1]) {
  const k = await criarKit(versoes, opcoes); kits.push(k); return k;
}
const tres: Versao[] = [
  { versao: "0.3.0", arquivos: { "pessoal.txt": "modelo antigo\n" } },
  { versao: "0.3.1", arquivos: { "pessoal.txt": "modelo novo\n" } },
  { versao: "0.3.2", cli: { doctorRuim: true, hookNovo: true } },
];
async function comConfigInicial(k: Kit) {
  expect(k.rodarCli(["instalar", "--alvo", "claude,codex"])).toBe(0);
  await mkdir(join(k.raiz, ".claude/skills/minha"), { recursive: true });
  await writeFile(join(k.raiz, ".claude/skills/minha/SKILL.md"), "skill pessoal\n");
  await symlink("../../skills/ingest", join(k.raiz, ".claude/skills/ingest"));
  await writeFile(join(k.raiz, ".claude/agents/pessoal.md"), "agente da pessoa\n");
  await writeFile(join(k.raiz, "anvilore.toml"), "[hooks]\nauto_commit = true\n");
  await writeFile(join(k.raiz, ".anvilore/chamadas.log"), "");
}

describe("atualizador com Git real: aplicar", () => {
  real("Dado bun.lock diferente na candidata, Quando aplico, Então instalo as dependências uma vez e rodo o instalar da versão nova em subprocesso", async () => {
    const k = await kit(tres.slice(0, 2));
    await comConfigInicial(k);
    const msg = await atualizar("aplicar", k.deps());
    expect(msg).toContain("Atualizado para 0.3.1");
    expect(k.dependencias()).toBe(1);
    expect(k.head()).toBe(k.commits["0.3.1"]!);
    expect(await k.chamadas()).toContain(`0.3.1 instalar --alvo claude,codex --destino ${k.raiz} --auto-commit`);
    expect(await readFile(join(k.raiz, ".codex/config.toml"), "utf8")).toBe("# hook gerado pela 0.3.1\n");
    const estado = await k.estado();
    expect(estado).toMatchObject({ estado: "ocioso", versaoInstalada: "0.3.1", ultima: { de: { versao: "0.3.0", commit: k.commits["0.3.0"] }, para: { versao: "0.3.1" } } });
    expect(estado.operacao).toBeUndefined();
    expect(k.ok(["rev-parse", "refs/anvilore/anterior"])).toBe(k.commits["0.3.0"]!);
  });

  real("Dado git diff que falha ao comparar o bun.lock, Quando aplico, Então recuso sem checkout em vez de supor lockfile igual", async () => {
    const k = await kit(tres.slice(0, 2));
    const deps = k.deps();
    const executar = (args: string[], cwd: string) => args[0] === "diff" && args[1] === "--quiet" ? { codigo: 128, saida: "fatal: objeto ilegível" } : deps.executar!(args, cwd);
    await expect(atualizar("aplicar", { ...deps, executar })).rejects.toThrow("git diff");
    expect(k.head()).toBe(k.commits["0.3.0"]!);
    expect(k.dependencias()).toBe(0);
  });

  real("Dado arquivos rastreados editado (nome com espaço), renomeado e apagado pela pessoa, Quando aplico, Então o conteúdo dela fica e o apagado continua apagado", async () => {
    const k = await kit([
      { versao: "0.3.0", arquivos: { "notas pessoais.txt": "modelo\n", "apagar.txt": "modelo\n", "velho.txt": "texto velho\n" } },
      { versao: "0.3.1", arquivos: { "notas pessoais.txt": "modelo novo\n", "apagar.txt": "modelo novo\n", "velho.txt": "texto novo\n" } },
    ]);
    await writeFile(join(k.raiz, "notas pessoais.txt"), "minhas notas\n");
    await rm(join(k.raiz, "apagar.txt"));
    k.ok(["mv", "velho.txt", "novo.txt"]);
    await atualizar("aplicar", k.deps());
    expect(k.head()).toBe(k.commits["0.3.1"]!);
    expect(await readFile(join(k.raiz, "notas pessoais.txt"), "utf8")).toBe("minhas notas\n");
    expect(await readFile(join(k.raiz, "novo.txt"), "utf8")).toBe("texto velho\n");
    expect(existsSync(join(k.raiz, "apagar.txt"))).toBe(false);
    expect(existsSync(join(k.raiz, "velho.txt"))).toBe(false);
  });

  real("Dado raw/ alterado pelo instalar da versão nova, Quando aplico, Então desfaço, recuso a versão e não afirmo que raw/ ficou como antes", async () => {
    const k = await kit([{ versao: "0.3.0" }, { versao: "0.3.1", cli: { corromperRaw: true } }]);
    await mkdir(join(k.raiz, "raw/sub"), { recursive: true });
    await writeFile(join(k.raiz, "raw/evidencia.md"), "original\n");
    await writeFile(join(k.raiz, "raw/sub/outra.md"), "outra\n");
    const falha = atualizar("aplicar", k.deps());
    await expect(falha).rejects.toThrow("atualização falhou e foi desfeita");
    await expect(falha).rejects.toThrow("raw/evidencia.md mudou");
    await expect(falha).rejects.toThrow("ATENÇÃO");
    expect(k.head()).toBe(k.commits["0.3.0"]!);
    const estado = await k.estado();
    expect(estado).toMatchObject({ estado: "ocioso", versaoInstalada: "0.3.0", recusadas: ["0.3.1"] });
    expect(estado.alerta).toContain("raw/evidencia.md mudou");
    expect(estado.ultima).toBeUndefined();
    expect(await atualizar("estado", k.deps())).toContain("ATENÇÃO: raw/ ou wiki/ mudaram");
  });

  real("Dado a wiki em ANVILORE_WIKI fora da pasta, Quando o instalar cria só o .git e a peça do esqueleto que faltava, Então a atualização passa", async () => {
    const k = await kit([{ versao: "0.3.0" }, { versao: "0.3.1", cli: { mexerNaWiki: "esqueleto" } }]);
    const wiki = join(k.pai, "wiki-externa");
    await mkdir(wiki);
    await writeFile(join(wiki, "pagina.md"), "minha página\n");
    const anterior = process.env.ANVILORE_WIKI;
    process.env.ANVILORE_WIKI = wiki;
    try {
      expect(await atualizar("aplicar", k.deps())).toContain("Atualizado para 0.3.1");
      expect(await readFile(join(wiki, "pagina.md"), "utf8")).toBe("minha página\n");
      expect(existsSync(join(wiki, "index.md"))).toBe(true);
    } finally { if (anterior === undefined) delete process.env.ANVILORE_WIKI; else process.env.ANVILORE_WIKI = anterior; }
  });

  real("Dado a wiki em ANVILORE_WIKI fora da pasta, Quando o instalar reescreve uma página, Então a medição pega pelo caminho real da wiki e desfaz", async () => {
    const k = await kit([{ versao: "0.3.0" }, { versao: "0.3.1", cli: { mexerNaWiki: "pagina" } }]);
    const wiki = join(k.pai, "wiki-externa");
    await mkdir(wiki);
    await writeFile(join(wiki, "pagina.md"), "minha página\n");
    const anterior = process.env.ANVILORE_WIKI;
    process.env.ANVILORE_WIKI = wiki;
    try {
      await expect(atualizar("aplicar", k.deps())).rejects.toThrow("wiki/pagina.md mudou");
      expect(k.head()).toBe(k.commits["0.3.0"]!);
    } finally { if (anterior === undefined) delete process.env.ANVILORE_WIKI; else process.env.ANVILORE_WIKI = anterior; }
  });

  real("Dado a candidata que deixa de rastrear raw/ sem declarar a migração, Quando aplico, Então recuso antes do checkout e o arquivo continua no disco", async () => {
    const k = await kit([{ versao: "0.3.0", arquivos: { "raw/exemplo/nota.md": "nota da pessoa\n" } }, { versao: "0.3.1", arquivos: { "raw/exemplo/nota.md": null } }]);
    await expect(atualizar("aplicar", k.deps())).rejects.toThrow("deixaria de rastrear arquivos que são seus (raw/exemplo/nota.md)");
    expect(k.head()).toBe(k.commits["0.3.0"]!);
    expect(await readFile(join(k.raiz, "raw/exemplo/nota.md"), "utf8")).toBe("nota da pessoa\n");
    expect(await k.estado()).toMatchObject({ estado: "recusada", recusadas: ["0.3.1"] });
  });

  real("Dado a candidata que declara a migração, Quando aplico e depois volto, Então SCHEMA.md e raw/exemplo da pessoa continuam com o conteúdo dela", async () => {
    const k = await kit([
      { versao: "0.3.0", arquivos: { "SCHEMA.md": "modelo do kit\n", "raw/exemplo/nota.md": "modelo de nota\n" } },
      { versao: "0.3.1", arquivos: { "SCHEMA.md": null, "raw/exemplo/nota.md": null, "atualizacao/migracoes.json": JSON.stringify({ deixa_de_rastrear: ["SCHEMA.md", "raw/exemplo"] }), ".gitignore": `${"SCHEMA.md\n"}.anvilore/\n.claude/\n.codex/\nraw/\nwiki/\nanvilore.toml\n` } },
    ], { alvos: [] });
    await writeFile(join(k.raiz, "SCHEMA.md"), "contrato da pessoa\n");
    expect(await atualizar("aplicar", k.deps())).toContain("Atualizado para 0.3.1");
    expect(k.ok(["ls-files", "SCHEMA.md", "raw/exemplo"])).toBe("");
    expect(await readFile(join(k.raiz, "SCHEMA.md"), "utf8")).toBe("contrato da pessoa\n");
    expect(await readFile(join(k.raiz, "raw/exemplo/nota.md"), "utf8")).toBe("modelo de nota\n");
    expect(await atualizar("voltar", k.deps())).toContain("Voltou para 0.3.0");
    expect(k.head()).toBe(k.commits["0.3.0"]!);
    expect(await readFile(join(k.raiz, "SCHEMA.md"), "utf8")).toBe("contrato da pessoa\n");
  });

  real("Dado .claude como link para fora da pasta, Quando aplico, Então recuso antes de mexer e nada fora é tocado", async () => {
    const k = await kit(tres.slice(0, 2));
    const fora = join(k.pai, "fora");
    await mkdir(join(fora, "agents"), { recursive: true });
    await writeFile(join(fora, "settings.json"), "de fora\n");
    await symlink(fora, join(k.raiz, ".claude"));
    await expect(atualizar("aplicar", k.deps())).rejects.toThrow("caminho inseguro");
    expect(k.head()).toBe(k.commits["0.3.0"]!);
    expect(await readFile(join(fora, "settings.json"), "utf8")).toBe("de fora\n");
  });
});

describe("atualizador com Git real: Bun exigido pela versão nova (D9)", () => {
  const versoes: Versao[] = [{ versao: "0.3.0", packageManager: "bun@1.4.1" }, { versao: "0.3.1", packageManager: "bun@9.9.9" }];
  real("Dado Bun da pessoa mais velho que o pedido, Quando aplico, Então recuso sem mudar nada e digo como atualizar", async () => {
    const k = await kit(versoes);
    await expect(atualizar("aplicar", k.deps())).rejects.toThrow("bun upgrade");
    expect(k.head()).toBe(k.commits["0.3.0"]!);
    expect(existsSync(join(k.raiz, ".anvilore/atualizacao"))).toBe(false);
  });
  real("Dado Bun instalado pelo Anvilore e nenhum atualizador do Bun neste kit, Quando aplico, Então recuso dizendo que depende do instalador", async () => {
    const k = await kit(versoes, { estado: { bunGerenciado: true } });
    await expect(atualizar("aplicar", k.deps())).rejects.toThrow("fatia dos instaladores");
    expect(k.head()).toBe(k.commits["0.3.0"]!);
  });
  real("Dado Bun instalado pelo Anvilore e o ponto de atualização do Bun, Quando aplico, Então atualizo o Bun e confiro a versão depois", async () => {
    const k = await kit(versoes, { estado: { bunGerenciado: true } });
    let bun = "1.4.1"; const pedidos: string[] = [];
    const msg = await atualizar("aplicar", k.deps({ versaoBun: async () => bun, atualizarBun: async (_r, minima) => { pedidos.push(minima); bun = minima; return 0; } }));
    expect(msg).toContain("Atualizado para 0.3.1");
    expect(pedidos).toEqual(["9.9.9"]);
  });
});

describe("atualizador com Git real: voltar, três tags e interrupção", () => {
  real("Dado skills e configurações pessoais, Quando aplico e depois volto, Então a árvore (b) volta igual por SHA-256 e o instalar da 0.3.0 roda na volta", async () => {
    const k = await kit(tres.slice(0, 2));
    await comConfigInicial(k);
    const antes = await arvore(k.raiz, CONFIG);
    await atualizar("aplicar", k.deps());
    expect(await arvore(k.raiz, CONFIG)).not.toEqual(antes);
    expect(await atualizar("voltar", k.deps())).toContain("Voltou para 0.3.0");
    expect(k.head()).toBe(k.commits["0.3.0"]!);
    expect(await arvore(k.raiz, CONFIG)).toEqual(antes);
    expect((await k.chamadas()).filter(l => l.includes(" instalar ")).map(l => l.split(" ")[0])).toEqual(["0.3.1", "0.3.0"]);
    const estado = await k.estado();
    expect(estado).toMatchObject({ estado: "ocioso", versaoInstalada: "0.3.0", recusadas: ["0.3.1"] });
    expect(estado.ultima).toBeUndefined();
    expect(k.git(["rev-parse", "--verify", "-q", "refs/anvilore/anterior"]).codigo).not.toBe(0);
    expect(await readFile(join(k.raiz, "pessoal.txt"), "utf8")).toBe("modelo antigo\n");
  });

  real("Dado três tags, Quando a 0.3.1 dá certo, a 0.3.2 piora o doctor com hook novo e é desfeita, e depois peço para voltar, Então volto à 0.3.0 com a cópia da primeira", async () => {
    const k = await kit(tres);
    await comConfigInicial(k);
    const antesDaPrimeira = await arvore(k.raiz, CONFIG);
    k.publicar(["v0.3.1"]);
    await atualizar("aplicar", k.deps());
    const depoisDaPrimeira = await arvore(k.raiz, CONFIG);
    const ultima = (await k.estado()).ultima;
    k.publicar(["v0.3.1", "v0.3.2"]);
    await expect(atualizar("aplicar", k.deps())).rejects.toThrow("o doctor ficou pior");
    expect(k.head()).toBe(k.commits["0.3.1"]!);
    expect(await arvore(k.raiz, CONFIG)).toEqual(depoisDaPrimeira);
    expect(await readFile(join(k.raiz, ".claude/settings.json"), "utf8")).not.toContain("subcomando-novo");
    expect(await k.estado()).toMatchObject({ estado: "ocioso", versaoInstalada: "0.3.1", recusadas: ["0.3.2"], ultima });
    expect(await atualizar("voltar", k.deps())).toContain("Voltou para 0.3.0");
    expect(k.head()).toBe(k.commits["0.3.0"]!);
    expect(await arvore(k.raiz, CONFIG)).toEqual(antesDaPrimeira);
    expect((await k.estado()).recusadas.sort()).toEqual(["0.3.1", "0.3.2"]);
  });

  real("Dado o processo morto (SIGKILL) no meio do instalar, Quando a próxima sessão começa, Então a trava abandonada sai, a reversão é retomada e nenhuma release é consultada", async () => {
    const k = await kit(tres.slice(0, 2));
    await comConfigInicial(k);
    const antes = await arvore(k.raiz, CONFIG);
    const morto = Bun.spawnSync([process.execPath, join(import.meta.dir, "apoio/atualizar-e-morrer.ts"), k.raiz, "v0.3.1"], { stdout: "pipe", stderr: "pipe" });
    // POSIX: morte por sinal. Windows: o kill encerra sem sinal POSIX (TerminateProcess), mas nunca com sucesso.
    if (process.platform === "win32") { expect(morto.exitCode).not.toBe(0); expect(morto.exitCode).not.toBeNull(); }
    else expect(morto.signalCode).toBe("SIGKILL");
    expect(await k.estado()).toMatchObject({ estado: "aplicando", etapa: "instalar" });
    expect(existsSync(join(k.raiz, ".anvilore/atualizar.lock"))).toBe(true);
    expect(k.head()).toBe(k.commits["0.3.1"]!);
    let consultas = 0;
    const msg = await atualizar("automatico", k.deps({ releases: async () => { consultas++; return []; } }));
    expect(msg).toContain("Recuperação concluída: voltei para 0.3.0");
    expect(consultas).toBe(0);
    expect(k.head()).toBe(k.commits["0.3.0"]!);
    expect(await arvore(k.raiz, CONFIG)).toEqual(antes);
    expect(existsSync(join(k.raiz, ".anvilore/atualizar.lock"))).toBe(false);
    expect(await k.estado()).toMatchObject({ estado: "ocioso", versaoInstalada: "0.3.0", recusadas: ["0.3.1"] });
    expect(await readFile(join(k.raiz, ".anvilore/atualizacao.log"), "utf8")).toContain("trava abandonada removida");
  });

  real("Dado a cópia (b) adulterada com caminho para fora da pasta, Quando volto, Então recuso antes do checkout e nada fora é escrito", async () => {
    const k = await kit(tres.slice(0, 2));
    await comConfigInicial(k);
    await atualizar("aplicar", k.deps());
    const id = (await k.estado()).ultima.id;
    const manifesto = join(k.raiz, ".anvilore/atualizacao", id, "manifesto.json");
    const copia = JSON.parse(await readFile(manifesto, "utf8"));
    copia.config[0].entradas.push({ path: "../fora.txt", tipo: "arquivo", sha256: "0".repeat(64) });
    await writeFile(manifesto, JSON.stringify(copia));
    await expect(atualizar("voltar", k.deps())).rejects.toThrow("cópia inválida");
    expect(existsSync(join(k.pai, "fora.txt"))).toBe(false);
    expect(k.head()).toBe(k.commits["0.3.1"]!);
    expect(await k.estado()).toMatchObject({ estado: "ocioso", versaoInstalada: "0.3.1" });
  });
});

describe("atualizador com Git real: reversão que falha (R1–R5)", () => {
  for (const etapa of ["R1 checkout", "R2 dependências", "R3 restaurar cópia", "R4 instalar configurações", "R5 doctor e proteção raw"]) {
    real(`Dado falha em ${etapa}, Quando a atualização precisa voltar, Então fica reversao-incompleta com a etapa, mantém cópia e ref, e retoma quando a causa some`, async () => {
      const k = await kit(tres.slice(0, 2));
      await comConfigInicial(k);
      let causa = true, instalacoes = 0, provas = 0, dependencias = 0;
      const base = k.deps();
      const executar = (args: string[], cwd: string) => causa && etapa.startsWith("R1") && args[0] === "checkout" && args.at(-1) === k.commits["0.3.0"] ? { codigo: 1, saida: "erro R1" } : base.executar!(args, cwd);
      const deps = k.deps({
        executar,
        instalar: async () => {
          if (++instalacoes === 1) {
            if (etapa.startsWith("R3")) {
              const op = (await k.estado()).operacao;
              await writeFile(join(k.raiz, ".anvilore/atualizacao", op.id, "config/.codex/config.toml"), "cópia adulterada\n");
            }
            return 4;
          }
          return causa && etapa.startsWith("R4") ? 4 : 0;
        },
        provarHook: async () => ++provas === 1 || !(causa && etapa.startsWith("R5")),
        diagnosticar: async () => ({ travas: [{ nome: "raw", ligada: true }], prerequisitos: [], avisos: [] }),
        instalarDependencias: async () => ++dependencias === 1 || !(causa && etapa.startsWith("R2")) ? 0 : 1,
      });
      const falha = atualizar("aplicar", deps);
      await expect(falha).rejects.toThrow("reversão incompleta");
      await expect(falha).rejects.toThrow(`etapa: ${etapa}`);
      if (etapa.startsWith("R5")) await expect(falha).rejects.toThrow("A proteção de raw/ pode estar desligada");
      await expect(falha).rejects.not.toThrow("foi desfeita");
      const estado = await k.estado();
      expect(estado).toMatchObject({ estado: "reversao-incompleta", etapa });
      expect(existsSync(join(k.raiz, ".anvilore/atualizacao", estado.operacao.id, "manifesto.json"))).toBe(true);
      expect(k.ok(["rev-parse", "refs/anvilore/operacao"])).toBe(k.commits["0.3.0"]!);
      if (etapa.startsWith("R3")) return; // a cópia adulterada não volta sozinha: continua pendente, sem apagar nada.
      causa = false;
      let consultas = 0;
      expect(await atualizar("aplicar", { ...deps, releases: async () => { consultas++; return []; } })).toContain("Recuperação concluída");
      expect(consultas).toBe(0);
      expect(k.head()).toBe(k.commits["0.3.0"]!);
      expect(await k.estado()).toMatchObject({ estado: "ocioso", versaoInstalada: "0.3.0", recusadas: ["0.3.1"] });
    });
  }
});

describe("atualizador com Git real: confiança, trava e estado", () => {
  real("Dado o kit instalado sem seguranca/assinantes, Quando verifico, Então recuso a candidata sem checkout", async () => {
    const k = await kit(tres.slice(0, 2));
    await rm(join(k.raiz, "seguranca/assinantes"));
    await expect(atualizar("verificar", k.deps())).rejects.toThrow("seguranca/assinantes ausente");
    expect(k.head()).toBe(k.commits["0.3.0"]!);
    expect((await k.estado()).estado).toBe("recusada");
  });

  real("Dado a candidata assinada por chave que o kit instalado não conhece, Quando verifico, Então recuso", async () => {
    const k = await kit(tres.slice(0, 2));
    await mkdir(join(k.pai, "outra"));
    const outra = await criarChave(join(k.pai, "outra"));
    await writeFile(join(k.raiz, "seguranca/assinantes"), outra.assinantes);
    await expect(atualizar("verificar", k.deps())).rejects.toThrow("git verify-tag recusou a tag v0.3.1");
    expect(k.head()).toBe(k.commits["0.3.0"]!);
    expect(await k.estado()).toMatchObject({ estado: "recusada" });
    expect((await k.estado()).recusadas ?? []).not.toContain("0.3.1");
    expect(Date.now() - Date.parse((await k.estado()).verificadoEm)).toBeLessThan(60_000);
  });

  real("Dado versão candidata com SemVer inválido, Quando verifico, Então não consulta assinatura nem aplica", async () => {
    const k = await kit(tres.slice(0, 2));
    k.publicar(["v0.03.1"]);
    expect(await atualizar("verificar", k.deps())).toContain("já está atualizado");
  });

  real("Dado duas sessões no mesmo processo, Quando verificam ao mesmo tempo, Então apenas uma obtém a trava", async () => {
    const k = await kit(tres.slice(0, 2));
    let liberar!: (r: { tag_name: string; draft: boolean; prerelease: boolean }[]) => void, iniciou!: () => void;
    const aguardando = new Promise<{ tag_name: string; draft: boolean; prerelease: boolean }[]>(r => { liberar = r; });
    const pronta = new Promise<void>(r => { iniciou = r; });
    const primeira = atualizar("verificar", k.deps({ releases: async () => { iniciou(); return aguardando; } }));
    await pronta;
    await expect(atualizar("verificar", k.deps())).rejects.toThrow("atualização já em andamento");
    liberar([]);
    await primeira;
  });

  real("Dado trava de outro processo vivo, Quando aplico, Então recuso sem mexer", async () => {
    const k = await kit(tres.slice(0, 2));
    await writeFile(join(k.raiz, ".anvilore/atualizar.lock"), `${process.ppid}\n`);
    await expect(atualizar("aplicar", k.deps())).rejects.toThrow("atualização já em andamento");
    expect(k.head()).toBe(k.commits["0.3.0"]!);
  });

  real("Dado estado com id de cópia que sai da pasta, Quando aplico, Então recuso o estado sem montar caminho com ele", async () => {
    const k = await kit(tres.slice(0, 2));
    const ponto = { versao: "0.3.0", commit: k.commits["0.3.0"] };
    await k.mudarEstado({ estado: "reversao-incompleta", operacao: { tipo: "aplicar", id: "../../fora", copiaConfig: "../../fora", origem: ponto, alvo: ponto, volta: ponto, lockMudou: false } });
    await expect(atualizar("aplicar", k.deps())).rejects.toThrow("estado inválido");
  });

  real("Dado voltar pedido quando HEAD não é a versão da última atualização, Quando volto, Então recuso sem misturar cópia e ref", async () => {
    const k = await kit(tres.slice(0, 2));
    await atualizar("aplicar", k.deps());
    await k.mudarEstado({ ultima: { ...(await k.estado()).ultima, para: { versao: "0.3.1", commit: k.commits["0.3.0"] } } });
    await expect(atualizar("voltar", k.deps())).rejects.toThrow("versão anterior indisponível");
    expect(k.head()).toBe(k.commits["0.3.1"]!);
  });
});

describe("atualizador com Git real: verificar, automático e estado", () => {
  real("Dado uma correção publicada, Quando a sessão verifica e depois abre de novo, Então a primeira só baixa e a segunda aplica", async () => {
    const k = await kit(tres.slice(0, 2));
    expect(await atualizar("verificar", k.deps())).toContain("Versão 0.3.1 conferida e aguardando a próxima sessão");
    expect(await k.estado()).toMatchObject({ estado: "baixada", disponivel: "0.3.1", tagDisponivel: "v0.3.1" });
    expect(k.head()).toBe(k.commits["0.3.0"]!);
    expect(await atualizar("automatico", k.deps())).toContain("Atualizado para 0.3.1");
    expect(k.head()).toBe(k.commits["0.3.1"]!);
  });

  real("Dado uma versão menor publicada, Quando a sessão começa, Então nada é aplicado até a pessoa confirmar", async () => {
    const k = await kit([{ versao: "0.3.0" }, { versao: "0.4.0" }]);
    expect(await atualizar("verificar", k.deps())).toContain("pede confirmação: 0.4.0");
    expect(await atualizar("automatico", k.deps())).toContain("0.4.0 aguardando confirmação");
    expect(k.head()).toBe(k.commits["0.3.0"]!);
    expect(await atualizar("aplicar", k.deps())).toContain("Atualizado para 0.4.0");
  });

  real("Dado HEAD numa tag diferente da versão gravada, Quando verifico, Então recuso como clone não gerenciado", async () => {
    const k = await kit(tres.slice(0, 2));
    await k.mudarEstado({ versaoInstalada: "0.3.1" });
    await expect(atualizar("verificar", k.deps())).rejects.toThrow("não corresponde à versão instalada");
  });

  real("Dado uma atualização aplicada, Quando peço o estado, Então mostra versão, HEAD e para onde dá para voltar", async () => {
    const k = await kit(tres.slice(0, 2));
    await atualizar("aplicar", k.deps());
    const texto = await atualizar("estado", k.deps());
    expect(texto).toContain("Estado: ocioso");
    expect(texto).toContain(`HEAD: ${k.commits["0.3.1"]}`);
    expect(texto).toContain("Pode voltar para: 0.3.0");
    const c = capturarConsole();
    try { expect(await comandoAtualizar(["--estado"], k.deps())).toBe(0); } finally { c.restaurar(); }
    expect(await atualizar("estado", { raiz: await mkdtemp(join(k.pai, "solta-")) })).toContain("instalação não gerenciada");
  });

  real("Dado migracao-incompleta gravada, Quando a próxima sessão começa, Então refaz a migração antes de consultar releases", async () => {
    const k = await kit([{ versao: "0.3.0", arquivos: { "SCHEMA.md": "modelo\n" } }, { versao: "0.3.1" }]);
    await writeFile(join(k.raiz, "SCHEMA.md"), "contrato da pessoa\n");
    const ponto = { versao: "0.3.0", commit: k.commits["0.3.0"] };
    await k.mudarEstado({ estado: "migracao-incompleta", operacao: { tipo: "aplicar", id: "1-aabbccdd00", copiaConfig: "1-aabbccdd00", origem: ponto, alvo: { versao: "0.3.1", commit: k.commits["0.3.1"] }, volta: ponto, lockMudou: false, migracoes: ["SCHEMA.md"] } });
    let consultas = 0;
    expect(await atualizar("automatico", k.deps({ releases: async () => { consultas++; return []; } }))).toContain("Migração recuperada");
    expect(consultas).toBe(0);
    expect(k.ok(["ls-files", "SCHEMA.md"])).toBe("");
    expect(await readFile(join(k.raiz, "SCHEMA.md"), "utf8")).toBe("contrato da pessoa\n");
    const estado = await k.estado();
    expect(estado.estado).toBe("ocioso");
    expect(estado.operacao).toBeUndefined();
  });
});

describe("atualizador com Git real: ciclo do alerta de raw/ alterado", () => {
  real("Dado raw/ alterado numa atualização desfeita, Quando verifico, outra versão falha, peço o estado e volto (falhando e retomando), Então o alerta continua; Quando uma atualização termina conferida, Então ele sai", async () => {
    const k = await kit([
      { versao: "0.3.0" }, { versao: "0.3.1" }, { versao: "0.3.2", cli: { corromperRaw: true } },
      { versao: "0.3.3", cli: { doctorRuim: true } }, { versao: "0.3.4" },
    ]);
    await mkdir(join(k.raiz, "raw"), { recursive: true });
    await writeFile(join(k.raiz, "raw/evidencia.md"), "original\n");
    const alerta = async () => (await k.estado()).alerta as string | undefined;

    k.publicar(["v0.3.1"]);
    expect(await atualizar("aplicar", k.deps())).toContain("Atualizado para 0.3.1");
    k.publicar(["v0.3.2"]);
    await expect(atualizar("aplicar", k.deps())).rejects.toThrow("raw/evidencia.md mudou");
    expect(await alerta()).toContain("raw/evidencia.md mudou");

    k.publicar(["v0.3.3"]);
    expect(await atualizar("verificar", k.deps())).toContain("0.3.3 conferida");
    expect(await alerta()).toContain("raw/evidencia.md mudou");

    // Falha sem tocar em dados: a reversão não acha problema novo e o alerta antigo não pode sumir.
    await expect(atualizar("aplicar", k.deps())).rejects.toThrow("o doctor ficou pior");
    expect(await alerta()).toContain("raw/evidencia.md mudou");
    const estado = await atualizar("estado", k.deps());
    expect(estado).toContain("ATENÇÃO: raw/ ou wiki/ mudaram");
    expect(estado).toContain("Último erro: prova: o doctor ficou pior");

    let negarR1 = true;
    const base = k.deps();
    const executar = (args: string[], cwd: string) => negarR1 && args[0] === "checkout" && args.at(-1) === k.commits["0.3.0"] ? { codigo: 1, saida: "erro R1" } : base.executar!(args, cwd);
    await expect(atualizar("voltar", k.deps({ executar }))).rejects.toThrow("reversão incompleta");
    expect(await alerta()).toContain("raw/evidencia.md mudou");
    negarR1 = false;
    expect(await atualizar("automatico", k.deps())).toContain("Recuperação concluída: voltei para 0.3.0");
    expect(k.head()).toBe(k.commits["0.3.0"]!);
    expect(await alerta()).toContain("raw/evidencia.md mudou");

    k.publicar(["v0.3.4"]);
    expect(await atualizar("aplicar", k.deps())).toContain("Atualizado para 0.3.4");
    expect(await alerta()).toBeUndefined();
  });
});

describe("atualizador com Git real: o nome assinado da tag é a versão anunciada", () => {
  async function semMudanca(k: Kit, versao: string) {
    expect(k.head()).toBe(k.commits["0.3.0"]!);
    const estado = await k.estado();
    expect(estado).toMatchObject({ versaoInstalada: "0.3.0", estado: "recusada" });
    expect(estado.recusadas ?? []).not.toContain(versao);
    expect(estado.operacao).toBeUndefined();
    expect(estado.ultima).toBeUndefined();
    expect(existsSync(join(k.raiz, ".anvilore/atualizacao"))).toBe(false);
    // A recusa conta como checagem: o hook (1×/24h) não tenta de novo a cada início de sessão.
    expect(Date.now() - Date.parse(estado.verificadoEm)).toBeLessThan(60_000);
  }

  real("Dado a ref v0.3.2 apontando para a tag assinada da v0.3.1, Quando aplico, Então recuso antes de qualquer cópia ou checkout", async () => {
    const k = await kit(tres.slice(0, 2));
    k.ok(["update-ref", "refs/tags/v0.3.2", k.ok(["rev-parse", "refs/tags/v0.3.1"])]);
    k.publicar(["v0.3.2"]);
    await expect(atualizar("aplicar", k.deps())).rejects.toThrow("a tag assinada se chama v0.3.1, não v0.3.2");
    await semMudanca(k, "0.3.2");
  });

  real("Dado a ref trocada recusada uma vez, Quando o origin traz depois a tag legítima da mesma versão, Então o fetch a substitui e a versão é aceita", async () => {
    const k = await kit([...tres.slice(0, 2), { versao: "0.3.2" }]);
    const espelho = join(k.pai, "espelho.git");
    expect(Bun.spawnSync(["git", "clone", "-q", "--bare", k.raiz, espelho]).exitCode).toBe(0);
    const legitima = k.ok(["rev-parse", "refs/tags/v0.3.2"]);
    k.ok(["update-ref", "refs/tags/v0.3.2", k.ok(["rev-parse", "refs/tags/v0.3.1"])]);
    k.publicar(["v0.3.2"]);
    await expect(atualizar("aplicar", k.deps())).rejects.toThrow("não v0.3.2");
    expect((await k.estado()).recusadas ?? []).not.toContain("0.3.2");
    const fetches: string[][] = [];
    const executar = (args: string[]) => {
      if (args[0] === "fetch") { fetches.push(args); return k.git(["-c", `url.${espelho}.insteadOf=https://github.com/iagofrota/anvilore.git`, ...args]); }
      return k.git(args);
    };
    expect(await atualizar("aplicar", k.deps({ executar }))).toContain("Atualizado para 0.3.2");
    expect(fetches).toEqual([["fetch", "--no-tags", "origin", "+refs/tags/v0.3.2:refs/tags/v0.3.2"]]);
    expect(k.ok(["rev-parse", "refs/tags/v0.3.2"])).toBe(legitima);
    expect(k.head()).toBe(k.commits["0.3.2"]!);
  });

  real("Dado a ref v0.3.2 apontando para a tag assinada da v0.3.1, Quando só verifico, Então também recuso e não marco como baixada", async () => {
    const k = await kit(tres.slice(0, 2));
    k.ok(["update-ref", "refs/tags/v0.3.2", k.ok(["rev-parse", "refs/tags/v0.3.1"])]);
    k.publicar(["v0.3.2"]);
    await expect(atualizar("verificar", k.deps())).rejects.toThrow("não v0.3.2");
    await semMudanca(k, "0.3.2");
  });

  real("Dado a v0.3.2 como tag leve, Quando aplico, Então recuso", async () => {
    const k = await kit(tres.slice(0, 2));
    k.ok(["tag", "v0.3.2", k.commits["0.3.1"]!]);
    k.publicar(["v0.3.2"]);
    await expect(atualizar("aplicar", k.deps())).rejects.toThrow("v0.3.2");
    await semMudanca(k, "0.3.2");
  });

  real("Dado a v0.3.2 assinada mas apontando para outra tag, Quando aplico, Então recuso a tag aninhada", async () => {
    const k = await kit(tres.slice(0, 2));
    k.ok(["-c", "gpg.format=ssh", "-c", `user.signingkey=${k.chave}`, "tag", "-s", "v0.3.2", "refs/tags/v0.3.1", "-m", "v0.3.2"]);
    expect(k.git(["-c", "gpg.format=ssh", "-c", `gpg.ssh.allowedSignersFile=${join(k.raiz, "seguranca/assinantes")}`, "verify-tag", "v0.3.2"]).codigo).toBe(0);
    k.publicar(["v0.3.2"]);
    await expect(atualizar("aplicar", k.deps())).rejects.toThrow("aponta para um objeto do tipo tag");
    await semMudanca(k, "0.3.2");
  });
});

describe("atualizador: links na cópia (b) e no Windows", () => {
  test("Dado um link de pasta, Quando escolho o tipo para recriar no Windows, Então só alvo absoluto vira junção e o relativo continua link de pasta", () => {
    expect(tipoDeLink("C:\\Users\\p\\Anvilore\\skills\\ingest", true, "win32")).toBe("junction");
    expect(tipoDeLink("..\\..\\skills\\ingest", true, "win32")).toBe("dir");
    expect(tipoDeLink("../../skills/ingest", true, "win32")).toBe("dir");
    expect(tipoDeLink("SKILL.md", false, "win32")).toBe("file");
    expect(tipoDeLink("../../skills/ingest", true, "linux")).toBeUndefined();
    expect(tipoDeLink("/abs/skills/ingest", true, "darwin")).toBeUndefined();
  });

  real("Dado um link de pasta relativo em .claude/skills, Quando aplico e volto, Então a cópia guarda só o alvo no manifesto e o link volta com o mesmo texto", async () => {
    const k = await kit(tres.slice(0, 2));
    await comConfigInicial(k);
    const antes = await readlink(join(k.raiz, ".claude/skills/ingest"));
    await atualizar("aplicar", k.deps());
    const id = (await k.estado()).ultima.id;
    const copia = JSON.parse(await readFile(join(k.raiz, ".anvilore/atualizacao", id, "manifesto.json"), "utf8"));
    const entrada = copia.config.flatMap((g: { entradas: { path: string }[] }) => g.entradas).find((e: { path: string }) => e.path === ".claude/skills/ingest");
    expect(entrada).toMatchObject({ tipo: "link", link: antes, alvoPasta: true });
    expect(await lstat(join(k.raiz, ".anvilore/atualizacao", id, "config/.claude/skills/ingest")).then(() => "existe", () => "ausente")).toBe("ausente");
    await rm(join(k.raiz, ".claude/skills/ingest"));
    expect(await atualizar("voltar", k.deps())).toContain("Voltou para 0.3.0");
    expect((await lstat(join(k.raiz, ".claude/skills/ingest"))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(k.raiz, ".claude/skills/ingest"))).toBe(antes);
  });
});

describe("atualizador com Git real: tags que não são candidatas nunca são buscadas", () => {
  real("Dado a tag local da candidata 0.3.2 envenenada apontando para o commit instalado, Quando o origin traz a legítima, Então a proteção não a bloqueia e a versão aplica", async () => {
    const k = await kit([...tres.slice(0, 2), { versao: "0.3.2" }]);
    const espelho = join(k.pai, "espelho.git");
    expect(Bun.spawnSync(["git", "clone", "-q", "--bare", k.raiz, espelho]).exitCode).toBe(0);
    k.ok(["update-ref", "refs/tags/v0.3.2", k.commits["0.3.0"]!]);
    const executar = (args: string[]) => args[0] === "fetch" ? k.git(["-c", `url.${espelho}.insteadOf=https://github.com/iagofrota/anvilore.git`, ...args]) : k.git(args);
    k.publicar(["v0.3.2"]);
    expect(await atualizar("aplicar", k.deps({ executar }))).toContain("Atualizado para 0.3.2");
    expect(k.ok(["describe", "--tags", "--exact-match", "HEAD"])).toBe("v0.3.2");
    expect(k.ok(["rev-parse", "refs/tags/v0.3.0"])).not.toBe(k.commits["0.3.2"]!);
  });

  for (const disponivel of ["0.3.1", "0.3.0"]) {
    real(`Dado 0.3.1 instalada, baixada obsoleta da ${disponivel} e um espelho que troca as tags, Quando aplico, Então não busco nada, as tags locais ficam e a próxima execução é normal`, async () => {
      const k = await kit(tres.slice(0, 2));
      await atualizar("aplicar", k.deps());
      const tags = { "v0.3.0": k.ok(["rev-parse", "refs/tags/v0.3.0"]), "v0.3.1": k.ok(["rev-parse", "refs/tags/v0.3.1"]) };
      const espelho = join(k.pai, "espelho.git");
      expect(Bun.spawnSync(["git", "clone", "-q", "--bare", k.raiz, espelho]).exitCode).toBe(0);
      const noEspelho = gitReal(espelho);
      expect(noEspelho(["update-ref", "refs/tags/v0.3.0", tags["v0.3.1"]]).codigo).toBe(0);
      expect(noEspelho(["update-ref", "refs/tags/v0.3.1", tags["v0.3.0"]]).codigo).toBe(0);
      const fetches: string[][] = [];
      const executar = (args: string[]) => {
        if (args[0] === "fetch") { fetches.push(args); return k.git(["-c", `url.${espelho}.insteadOf=https://github.com/iagofrota/anvilore.git`, ...args]); }
        return k.git(args);
      };
      await k.mudarEstado({ estado: "baixada", disponivel, tagDisponivel: `v${disponivel}` });
      k.publicar(["v0.3.1", "v0.3.0"]);
      expect(await atualizar("aplicar", k.deps({ executar }))).toContain("0.3.1 já está atualizado");
      expect(fetches).toEqual([]);
      expect(k.ok(["rev-parse", "refs/tags/v0.3.0"])).toBe(tags["v0.3.0"]);
      expect(k.ok(["rev-parse", "refs/tags/v0.3.1"])).toBe(tags["v0.3.1"]);
      expect(k.ok(["describe", "--tags", "--exact-match", "HEAD"])).toBe("v0.3.1");
      const estado = await k.estado();
      expect(estado.estado).toBe("ocioso");
      expect(estado.disponivel).toBeUndefined();
      expect(await atualizar("verificar", k.deps({ executar }))).toContain("0.3.1 já está atualizado");
      expect(await atualizar("voltar", k.deps({ executar }))).toContain("Voltou para 0.3.0");
    });
  }
});

describe("atualizador com Git real: recusa depois do fetch devolve a ref da tag", () => {
  async function espelhos(k: Kit) {
    const legitimo = join(k.pai, "legitimo.git"), malicioso = join(k.pai, "malicioso.git");
    for (const destino of [legitimo, malicioso]) expect(Bun.spawnSync(["git", "clone", "-q", "--bare", k.raiz, destino]).exitCode).toBe(0);
    // v0.3.2 anotada, sem assinatura, apontando para o commit instalado.
    const ruim = gitReal(malicioso);
    expect(ruim(["update-ref", "-d", "refs/tags/v0.3.2"]).codigo).toBe(0);
    expect(ruim(["-c", "user.name=Espelho", "-c", "user.email=espelho@localhost", "tag", "-a", "v0.3.2", k.commits["0.3.0"]!, "-m", "v0.3.2"]).codigo).toBe(0);
    const por = (espelho: string) => (args: string[]) => args[0] === "fetch" ? k.git(["-c", `url.${espelho}.insteadOf=https://github.com/iagofrota/anvilore.git`, ...args]) : k.git(args);
    return { legitimo: por(legitimo), malicioso: por(malicioso) };
  }

  real("Dado a v0.3.2 ausente localmente e um espelho que a serve sem assinatura apontando para o HEAD, Quando a recusa, Então a ref some, o clone segue gerenciado e a legítima aplica depois", async () => {
    const k = await kit([...tres.slice(0, 2), { versao: "0.3.2" }]);
    const e = await espelhos(k);
    k.ok(["update-ref", "-d", "refs/tags/v0.3.2"]);
    k.publicar(["v0.3.2"]);
    await expect(atualizar("aplicar", k.deps({ executar: e.malicioso }))).rejects.toThrow("git verify-tag recusou a tag v0.3.2");
    expect(k.git(["rev-parse", "--verify", "-q", "refs/tags/v0.3.2"]).codigo).not.toBe(0);
    expect(k.ok(["describe", "--tags", "--exact-match", "HEAD"])).toBe("v0.3.0");
    expect(await atualizar("verificar", k.deps({ executar: e.legitimo, releases: async () => [] }))).toContain("0.3.0 já está atualizado");
    expect(await atualizar("aplicar", k.deps({ executar: e.legitimo }))).toContain("Atualizado para 0.3.2");
    expect(k.head()).toBe(k.commits["0.3.2"]!);
  });

  real("Dado a v0.3.2 legítima já no clone e um espelho que a troca por uma sem assinatura, Quando a recusa, Então a ref volta ao objeto anterior", async () => {
    const k = await kit([...tres.slice(0, 2), { versao: "0.3.2" }]);
    const e = await espelhos(k);
    const antes = k.ok(["rev-parse", "refs/tags/v0.3.2"]);
    k.publicar(["v0.3.2"]);
    await expect(atualizar("verificar", k.deps({ executar: e.malicioso }))).rejects.toThrow("git verify-tag recusou a tag v0.3.2");
    expect(k.ok(["rev-parse", "refs/tags/v0.3.2"])).toBe(antes);
    expect(k.ok(["describe", "--tags", "--exact-match", "HEAD"])).toBe("v0.3.0");
    expect(await atualizar("aplicar", k.deps({ executar: e.legitimo }))).toContain("Atualizado para 0.3.2");
  });
});

describe("atualizador com Git real: só aceita assinatura SSH na tag", () => {
  async function semMudanca(k: Kit, versao: string) {
    expect(k.head()).toBe(k.commits["0.3.0"]!);
    const estado = await k.estado();
    expect(estado).toMatchObject({ versaoInstalada: "0.3.0", estado: "recusada" });
    expect(estado.recusadas ?? []).not.toContain(versao);
    expect(estado.operacao).toBeUndefined();
    expect(estado.ultima).toBeUndefined();
    expect(existsSync(join(k.raiz, ".anvilore/atualizacao"))).toBe(false);
    expect(Date.now() - Date.parse(estado.verificadoEm)).toBeLessThan(60_000);
  }

  function criarTagPgp(k: Kit, tag: string, commit: string) {
    const corpo = `object ${commit}\ntype commit\ntag ${tag}\ntagger CI <ci@anvilore.test> 1700000000 +0000\n\nprova pgp\n-----BEGIN PGP SIGNATURE-----\n\niQEzBAABCAAdFiEEfalso\n=abcd\n-----END PGP SIGNATURE-----\n`;
    const p = Bun.spawnSync(["git", "-C", k.raiz, "hash-object", "-t", "tag", "-w", "--stdin"], {
      stdin: Buffer.from(corpo),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (p.exitCode !== 0) throw new Error(`hash-object falhou: ${p.stderr.toString()}`);
    return p.stdout.toString().trim();
  }

  function criarTagX509(k: Kit, tag: string, commit: string) {
    const corpo = `object ${commit}\ntype commit\ntag ${tag}\ntagger CI <ci@anvilore.test> 1700000000 +0000\n\nprova x509\n-----BEGIN SIGNED MESSAGE-----\nfakex509\n-----END SIGNED MESSAGE-----\n`;
    const p = Bun.spawnSync(["git", "-C", k.raiz, "hash-object", "-t", "tag", "-w", "--stdin"], {
      stdin: Buffer.from(corpo),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (p.exitCode !== 0) throw new Error(`hash-object falhou: ${p.stderr.toString()}`);
    return p.stdout.toString().trim();
  }

  async function comVerificadorAprovador(k: Kit, nome: "gpg" | "gpgsm") {
    const pastaBin = join(k.pai, "bin");
    await mkdir(pastaBin, { recursive: true });
    const arq = join(pastaBin, nome);
    const script = `#!/bin/sh\necho '[GNUPG:] NEWSIG'\necho '[GNUPG:] GOODSIG ABCDEF0123456789 falso <f@x>'\necho '[GNUPG:] VALIDSIG ABCDEF0123456789 2026-10-29 1 0 4 0 1 8 00 ABCDEF0123456789'\necho '[GNUPG:] TRUST_ULTIMATE 0 pgp'\nexit 0\n`;
    await writeFile(arq, script, { mode: 0o755 });
    return { pastaBin, arq };
  }

  real("Dado chamada direta a verificarAssinaturaTag com tag OpenPGP falsa e gpg aprovador, Quando verifico, Então recusa com mensagem explicativa", async () => {
    const k = await kit(tres.slice(0, 2));
    const { pastaBin, arq } = await comVerificadorAprovador(k, "gpg");
    const oid = criarTagPgp(k, "v0.3.1", k.commits["0.3.1"]!);
    k.ok(["update-ref", "refs/tags/v0.3.1", oid]);
    k.ok(["config", "gpg.program", arq]);

    const pathAntes = process.env.PATH;
    process.env.PATH = `${pastaBin}:${pathAntes}`;
    try {
      const { verificarAssinaturaTag } = await import("../src/lib/atualizacao");
      const recusa = verificarAssinaturaTag(k.raiz, "v0.3.1", k.git, oid);
      expect(recusa).toBeDefined();
      expect(recusa).toContain("a tag não tem assinatura SSH");
    } finally {
      process.env.PATH = pathAntes;
    }
  });

  real("Dado chamada direta a verificarAssinaturaTag com tag x509 falsa e gpgsm aprovador, Quando verifico, Então recusa com mensagem explicativa", async () => {
    const k = await kit(tres.slice(0, 2));
    const { pastaBin, arq } = await comVerificadorAprovador(k, "gpgsm");
    const oid = criarTagX509(k, "v0.3.1", k.commits["0.3.1"]!);
    k.ok(["update-ref", "refs/tags/v0.3.1", oid]);
    k.ok(["config", "gpg.x509.program", arq]);

    const pathAntes = process.env.PATH;
    process.env.PATH = `${pastaBin}:${pathAntes}`;
    try {
      const { verificarAssinaturaTag } = await import("../src/lib/atualizacao");
      const recusa = verificarAssinaturaTag(k.raiz, "v0.3.1", k.git, oid);
      expect(recusa).toBeDefined();
      expect(recusa).toContain("a tag não tem assinatura SSH");
    } finally {
      process.env.PATH = pathAntes;
    }
  });

  real("Dado tag com assinatura OpenPGP falsa e gpg aprovador no PATH e no gitconfig, Quando aplico, Então recusa por não ter assinatura SSH e devolve a ref", async () => {
    const k = await kit([...tres.slice(0, 2), { versao: "0.3.2" }]);
    const { pastaBin, arq } = await comVerificadorAprovador(k, "gpg");
    const oid = criarTagPgp(k, "v0.3.2", k.commits["0.3.2"]!);
    const espelho = join(k.pai, "espelho-pgp.git");
    expect(Bun.spawnSync(["git", "clone", "-q", "--bare", k.raiz, espelho]).exitCode).toBe(0);
    const espelhoGit = gitReal(espelho);
    expect(espelhoGit(["update-ref", "refs/tags/v0.3.2", oid]).codigo).toBe(0);
    k.ok(["config", "gpg.program", arq]);
    k.ok(["update-ref", "-d", "refs/tags/v0.3.2"]);

    const homeGitconfig = join(process.env.HOME ?? tmpdir(), ".gitconfig");
    let gitconfigAntes: string | null = null;
    try {
      if (existsSync(homeGitconfig)) gitconfigAntes = await readFile(homeGitconfig, "utf8");
      await writeFile(homeGitconfig, `[gpg]\n\tprogram = ${arq}\n`);

      k.publicar(["v0.3.2"]);
      const pathAntes = process.env.PATH;
      process.env.PATH = `${pastaBin}:${pathAntes}`;
      try {
        const executar = (args: string[]) => args[0] === "fetch"
          ? k.git(["-c", `url.${espelho}.insteadOf=https://github.com/iagofrota/anvilore.git`, ...args])
          : k.git(args);

        await expect(atualizar("aplicar", k.deps({ executar }))).rejects.toThrow("a tag não tem assinatura SSH");
        await semMudanca(k, "0.3.2");
        expect(k.git(["rev-parse", "--verify", "-q", "refs/tags/v0.3.2"]).codigo).not.toBe(0);
      } finally {
        process.env.PATH = pathAntes;
      }
    } finally {
      if (gitconfigAntes !== null) await writeFile(homeGitconfig, gitconfigAntes);
      else await rm(homeGitconfig, { force: true });
    }
  });

  real("Dado tag com assinatura x509 falsa e gpgsm aprovador no PATH, Quando aplico, Então recusa por não ter assinatura SSH e devolve a ref", async () => {
    const k = await kit([...tres.slice(0, 2), { versao: "0.3.2" }]);
    const { pastaBin, arq } = await comVerificadorAprovador(k, "gpgsm");
    const oid = criarTagX509(k, "v0.3.2", k.commits["0.3.2"]!);
    const espelho = join(k.pai, "espelho-x509.git");
    expect(Bun.spawnSync(["git", "clone", "-q", "--bare", k.raiz, espelho]).exitCode).toBe(0);
    const espelhoGit = gitReal(espelho);
    expect(espelhoGit(["update-ref", "refs/tags/v0.3.2", oid]).codigo).toBe(0);
    k.ok(["config", "gpg.x509.program", arq]);
    k.ok(["update-ref", "-d", "refs/tags/v0.3.2"]);

    const homeGitconfig = join(process.env.HOME ?? tmpdir(), ".gitconfig");
    let gitconfigAntes: string | null = null;
    try {
      if (existsSync(homeGitconfig)) gitconfigAntes = await readFile(homeGitconfig, "utf8");
      await writeFile(homeGitconfig, `[gpg "x509"]\n\tprogram = ${arq}\n[gpg]\n\tx509program = ${arq}\n`);

      k.publicar(["v0.3.2"]);
      const pathAntes = process.env.PATH;
      process.env.PATH = `${pastaBin}:${pathAntes}`;
      try {
        const executar = (args: string[]) => args[0] === "fetch"
          ? k.git(["-c", `url.${espelho}.insteadOf=https://github.com/iagofrota/anvilore.git`, ...args])
          : k.git(args);

        await expect(atualizar("aplicar", k.deps({ executar }))).rejects.toThrow("a tag não tem assinatura SSH");
        await semMudanca(k, "0.3.2");
        expect(k.git(["rev-parse", "--verify", "-q", "refs/tags/v0.3.2"]).codigo).not.toBe(0);
      } finally {
        process.env.PATH = pathAntes;
      }
    } finally {
      if (gitconfigAntes !== null) await writeFile(homeGitconfig, gitconfigAntes);
      else await rm(homeGitconfig, { force: true });
    }
  });

  real("Dado GIT_CONFIG_GLOBAL hostil e GNUPGHOME apontando para diretório inválido, Quando aplico, Então o resultado não é alterado pelas variáveis de ambiente", async () => {
    const k = await kit([...tres.slice(0, 2), { versao: "0.3.2" }]);
    const { pastaBin, arq } = await comVerificadorAprovador(k, "gpg");
    const oid = criarTagPgp(k, "v0.3.2", k.commits["0.3.2"]!);
    const espelho = join(k.pai, "espelho-pgp-env.git");
    expect(Bun.spawnSync(["git", "clone", "-q", "--bare", k.raiz, espelho]).exitCode).toBe(0);
    const espelhoGit = gitReal(espelho);
    expect(espelhoGit(["update-ref", "refs/tags/v0.3.2", oid]).codigo).toBe(0);
    k.ok(["update-ref", "-d", "refs/tags/v0.3.2"]);

    const gitconfigHostil = join(k.pai, "gitconfig-hostil");
    await writeFile(gitconfigHostil, `[gpg]\n\tformat = openpgp\n\tprogram = ${arq}\n[gpg "ssh"]\n\tallowedSignersFile = /dev/null\n`);

    k.publicar(["v0.3.2"]);
    const envAntes = {
      GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
      GNUPGHOME: process.env.GNUPGHOME,
      PATH: process.env.PATH,
    };
    process.env.GIT_CONFIG_GLOBAL = gitconfigHostil;
    process.env.GNUPGHOME = join(k.pai, "gnupghome-inexistente");
    process.env.PATH = `${pastaBin}:${process.env.PATH}`;
    try {
      const executar = (args: string[]) => args[0] === "fetch"
        ? k.git(["-c", `url.${espelho}.insteadOf=https://github.com/iagofrota/anvilore.git`, ...args])
        : k.git(args);

      // A tag OpenPGP DEVE continuar sendo recusada, mesmo com GIT_CONFIG_GLOBAL apontando para o gpg falso
      await expect(atualizar("aplicar", k.deps({ executar }))).rejects.toThrow("a tag não tem assinatura SSH");
      await semMudanca(k, "0.3.2");
      expect(k.git(["rev-parse", "--verify", "-q", "refs/tags/v0.3.2"]).codigo).not.toBe(0);

      // Agora com a tag SSH legítima: as flags CLI do verificarAssinaturaTag prevalecem sobre o GIT_CONFIG_GLOBAL hostil
      k.ok(["-c", "gpg.format=ssh", "-c", `user.signingkey=${k.chave}`, "tag", "-s", "v0.3.2", k.commits["0.3.2"]!, "-m", "v0.3.2"]);
      const espelhoBom = join(k.pai, "espelho-ssh-bom.git");
      expect(Bun.spawnSync(["git", "clone", "-q", "--bare", k.raiz, espelhoBom]).exitCode).toBe(0);
      k.ok(["update-ref", "-d", "refs/tags/v0.3.2"]);
      const executarBom = (args: string[]) => args[0] === "fetch"
        ? k.git(["-c", `url.${espelhoBom}.insteadOf=https://github.com/iagofrota/anvilore.git`, ...args])
        : k.git(args);
      expect(await atualizar("aplicar", k.deps({ executar: executarBom }))).toContain("Atualizado para 0.3.2");
      expect(k.head()).toBe(k.commits["0.3.2"]!);
    } finally {
      if (envAntes.GIT_CONFIG_GLOBAL !== undefined) process.env.GIT_CONFIG_GLOBAL = envAntes.GIT_CONFIG_GLOBAL;
      else delete process.env.GIT_CONFIG_GLOBAL;
      if (envAntes.GNUPGHOME !== undefined) process.env.GNUPGHOME = envAntes.GNUPGHOME;
      else delete process.env.GNUPGHOME;
      process.env.PATH = envAntes.PATH;
    }
  });

  real("Dado tag assinada por chave SSH desconhecida e gpg.ssh.program aprovador no gitconfig, Quando aplico, Então recusa a assinatura", async () => {
    const k = await kit([...tres.slice(0, 2), { versao: "0.3.2" }]);
    const pastaOutra = join(k.pai, "outra");
    await mkdir(pastaOutra, { recursive: true });
    const outra = await criarChave(pastaOutra);
    k.ok(["-c", "gpg.format=ssh", "-c", `user.signingkey=${outra.chave}`, "tag", "-f", "-s", "v0.3.2", k.commits["0.3.2"]!, "-m", "v0.3.2"]);
    const espelho = join(k.pai, "espelho-ssh-atacante.git");
    expect(Bun.spawnSync(["git", "clone", "-q", "--bare", k.raiz, espelho]).exitCode).toBe(0);
    k.ok(["update-ref", "-d", "refs/tags/v0.3.2"]);

    const fakeSshKeygen = join(k.pai, "fake-ssh-keygen");
    const fakeScript = `#!/bin/sh\nfor arg in "$@"; do\n  if [ "$arg" = "find-principals" ]; then\n    echo "teste@localhost"\n    exit 0\n  fi\ndone\necho 'Good "git" signature for teste@localhost with ED25519 key SHA256:FAKE'\nexit 0\n`;
    await writeFile(fakeSshKeygen, fakeScript, { mode: 0o755 });

    const homeGitconfig = join(process.env.HOME ?? tmpdir(), ".gitconfig");
    let gitconfigAntes: string | null = null;
    try {
      if (existsSync(homeGitconfig)) gitconfigAntes = await readFile(homeGitconfig, "utf8");
      await writeFile(homeGitconfig, `[gpg "ssh"]\n\tprogram = ${fakeSshKeygen}\n`);

      k.publicar(["v0.3.2"]);
      const executar = (args: string[]) => args[0] === "fetch"
        ? k.git(["-c", `url.${espelho}.insteadOf=https://github.com/iagofrota/anvilore.git`, ...args])
        : k.git(args);

      await expect(atualizar("aplicar", k.deps({ executar }))).rejects.toThrow("git verify-tag recusou a tag v0.3.2");
      await semMudanca(k, "0.3.2");
      expect(k.git(["rev-parse", "--verify", "-q", "refs/tags/v0.3.2"]).codigo).not.toBe(0);
    } finally {
      if (gitconfigAntes !== null) await writeFile(homeGitconfig, gitconfigAntes);
      else await rm(homeGitconfig, { force: true });
    }
  });

  test("Dado verificarAssinaturaTag com tag SSH, Quando executa verify-tag, Então o argv contém gpg.program, gpg.openpgp.program, gpg.x509.program e gpg.ssh.program fixados", async () => {
    const raiz = await mkdtemp(join(tmpdir(), "anvilore-mutacao-"));
    try {
      await mkdir(join(raiz, "seguranca"), { recursive: true });
      await writeFile(join(raiz, "seguranca/assinantes"), "principal namespaces=\"git\" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA\n");
      const chamadas: string[][] = [];
      const execFalso = (args: string[]) => {
        chamadas.push(args);
        if (args[0] === "cat-file") {
          return { codigo: 0, saida: "object abc\ntype commit\ntag v0.3.1\n\nmsg\n-----BEGIN SSH SIGNATURE-----\nsig\n-----END SSH SIGNATURE-----\n" };
        }
        return { codigo: 0, saida: "" };
      };
      const { verificarAssinaturaTag } = await import("../src/lib/atualizacao");
      const r = verificarAssinaturaTag(raiz, "v0.3.1", execFalso, "objeto-tag");
      expect(r).toBeUndefined();
      const verifyTagArgs = chamadas.find(args => args.includes("verify-tag"));
      expect(verifyTagArgs).toBeDefined();
      expect(verifyTagArgs).toContain("gpg.format=ssh");
      expect(verifyTagArgs).toContain("gpg.ssh.program=ssh-keygen");
      expect(verifyTagArgs).toContain("gpg.program=anvilore-sem-gpg");
      expect(verifyTagArgs).toContain("gpg.openpgp.program=anvilore-sem-gpg");
      expect(verifyTagArgs).toContain("gpg.x509.program=anvilore-sem-gpg");
    } finally {
      await rm(raiz, { recursive: true, force: true });
    }
  });

  test("Dado verificarAssinaturaTag quando cat-file sai com código diferente de zero, Então recusa (falha fechado) e não chama verify-tag", async () => {
    const raiz = await mkdtemp(join(tmpdir(), "anvilore-fail-closed-"));
    try {
      await mkdir(join(raiz, "seguranca"), { recursive: true });
      await writeFile(join(raiz, "seguranca/assinantes"), "principal namespaces=\"git\" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA\n");
      const chamadas: string[][] = [];
      const execFalso = (args: string[]) => {
        chamadas.push(args);
        if (args[0] === "cat-file") {
          return { codigo: 1, saida: "fatal: objeto corrompido" };
        }
        return { codigo: 0, saida: "" };
      };
      const { verificarAssinaturaTag } = await import("../src/lib/atualizacao");
      const r = verificarAssinaturaTag(raiz, "v0.3.1", execFalso, "objeto-tag");
      expect(r).toBeDefined();
      expect(r).toContain("a tag não tem assinatura SSH");
      expect(chamadas.some(args => args.includes("verify-tag"))).toBe(false);
    } finally {
      await rm(raiz, { recursive: true, force: true });
    }
  });
});
