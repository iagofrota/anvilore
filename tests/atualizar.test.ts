import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atualizar, compararSemVer, comandoAtualizar, decidirPolitica, parsearSemVer, selecionarRelease } from "../src/lib/atualizacao";
import { capturarConsole } from "./apoio/console";
import { arvore, criarChave, criarKit, type Kit, type Versao } from "./apoio/kit-atualizavel";

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
const real = temFerramentas ? test : test.skip;
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
    expect(morto.signalCode).toBe("SIGKILL");
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
