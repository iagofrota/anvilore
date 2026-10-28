import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { compararSemVer, comandoAtualizar, decidirPolitica, parsearSemVer, selecionarRelease } from "../src/lib/atualizacao";
import { capturarConsole } from "./apoio/console";

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

import { atualizar } from "../src/lib/atualizacao";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const diagnosticoLimpo = { travas: [{ nome: "raw", ligada: true }], prerequisitos: [], avisos: [] };
async function raizGerenciada() {
  const raiz = await mkdtemp(join(tmpdir(), "anvilore-atualizar-"));
  await mkdir(join(raiz, ".anvilore"), { recursive: true });
  await mkdir(join(raiz, "seguranca"), { recursive: true });
  await writeFile(join(raiz, "package.json"), JSON.stringify({ version: "0.3.0" }));
  await writeFile(join(raiz, ".anvilore/atualizacao.json"), JSON.stringify({ versao: 1, modo: "automatico", canal: "estavel", estado: "ocioso", versaoInstalada: "0.3.0" }));
  return raiz;
}
function gitSimulado(opcoes: { verify?: number; hook?: boolean; head?: string; checkoutFalha?: boolean } = {}) {
  let head = opcoes.head ?? "commit-anterior";
  const chamadas: string[][] = [];
  return {
    chamadas,
    executar: (args: string[], _cwd: string) => {
      chamadas.push(args);
      if (args[0] === "remote") return { codigo: 0, saida: "https://github.com/iagofrota/anvilore.git" };
      if (args[0] === "describe") return { codigo: 0, saida: head === "commit-anterior" ? "v0.3.0" : "v0.3.1" };
      if (args[0] === "rev-parse") return { codigo: 0, saida: head };
      if (args[0] === "fetch" || args[0] === "update-ref" || args[0] === "diff" || args[0] === "status") return { codigo: 0, saida: "" };
      if (args.includes("verify-tag")) return { codigo: opcoes.verify ?? 0, saida: "bad signature" };
      if (args[0] === "show") return { codigo: 128, saida: "path not found" };
      if (args[0] === "checkout") {
        if (opcoes.checkoutFalha && args.at(-1) === "v0.3.1") return { codigo: 1, saida: "checkout falhou" };
        head = args.at(-1) === "v0.3.1" ? "commit-novo" : "commit-anterior";
        return { codigo: 0, saida: "" };
      }
      return { codigo: 0, saida: "" };
    },
    head: () => head,
  };
}
const releasesPatch = async () => [{ tag_name: "v0.3.1", draft: false, prerelease: false }];

test("Dado versão candidata inválida, Quando verifica, Então não consulta assinatura nem aplica", async () => {
  const raiz = await raizGerenciada();
  const git = gitSimulado();
  try {
    const msg = await atualizar("verificar", { raiz, executar: git.executar, releases: async () => [{ tag_name: "v0.03.1", draft: false, prerelease: false }] });
    expect(msg).toContain("já está atualizado");
    expect(git.chamadas.some(c => c.includes("verify-tag"))).toBe(false);
  } finally { await rm(raiz, { recursive: true, force: true }); }
});

test("Dado o clone sem chave pública local, Quando verifica tag candidata, Então recusa sem tentar checkout", async () => {
  const raiz = await raizGerenciada();
  const git = gitSimulado();
  try {
    await expect(atualizar("verificar", { raiz, executar: git.executar, releases: releasesPatch })).rejects.toThrow("seguranca/assinantes ausente");
    expect(git.chamadas.some(c => c[0] === "checkout")).toBe(false);
    expect(JSON.parse(await readFile(join(raiz, ".anvilore/atualizacao.json"), "utf8")).estado).toBe("recusada");
  } finally { await rm(raiz, { recursive: true, force: true }); }
});

test("Dado assinatura SSH inválida, Quando verifica, Então marca release recusada e não aplica", async () => {
  const raiz = await raizGerenciada();
  const git = gitSimulado({ verify: 1 });
  try {
    await writeFile(join(raiz, "seguranca/assinantes"), "fixture de chave descartável\n");
    await expect(atualizar("verificar", { raiz, executar: git.executar, releases: releasesPatch })).rejects.toThrow("assinatura inválida");
    expect(git.chamadas.some(c => c[0] === "checkout")).toBe(false);
    expect(git.chamadas.some(c => c.includes("verify-tag"))).toBe(true);
  } finally { await rm(raiz, { recursive: true, force: true }); }
});

test("Dado duas sessões concorrentes, Quando verificam ao mesmo tempo, Então apenas uma obtém a trava", async () => {
  const raiz = await raizGerenciada();
  const git = gitSimulado();
  let liberar!: (releases: { tag_name: string; draft: boolean; prerelease: boolean }[]) => void;
  let iniciou!: () => void;
  const aguardando = new Promise<{ tag_name: string; draft: boolean; prerelease: boolean }[]>(resolve => { liberar = resolve; });
  const pronta = new Promise<void>(resolve => { iniciou = resolve; });
  const primeira = atualizar("verificar", { raiz, executar: git.executar, releases: async () => { iniciou(); return aguardando; } });
  try {
    await pronta;
    await expect(atualizar("verificar", { raiz, executar: git.executar, releases: releasesPatch })).rejects.toThrow("atualização já em andamento");
    liberar([]);
    await primeira;
  } finally { liberar([]); await rm(raiz, { recursive: true, force: true }); }
});

test("Dado atualização concluída, Quando solicita voltar, Então volta ao commit anterior e restaura configuração dos agentes", async () => {
  const raiz = await raizGerenciada();
  const git = gitSimulado();
  const settings = join(raiz, ".claude/settings.json");
  await mkdir(join(raiz, ".claude"), { recursive: true });
  await writeFile(settings, '{"hooks":{"old":true}}\n');
  await writeFile(join(raiz, "anvilore.toml"), "[hooks]\nauto_commit = true\ngithub_backup = true\n");
  await writeFile(join(raiz, "seguranca/assinantes"), "fixture de chave descartável\n");
  const deps = { raiz, executar: git.executar, releases: releasesPatch, diagnosticar: async () => diagnosticoLimpo, provarHook: async () => true, instalar: async () => 0 };
  try {
    expect(await atualizar("aplicar", deps)).toContain("Atualizado para 0.3.1");
    expect(JSON.parse(await readFile(join(raiz, ".anvilore/atualizacao.json"), "utf8"))).toMatchObject({ autoCommit: true, githubBackup: true, alvos: ["claude"] });
    await writeFile(settings, '{"hooks":{"new":true}}\n');
    expect(await atualizar("voltar", deps)).toContain("Voltou para 0.3.0");
    expect(git.head()).toBe("commit-anterior");
    expect(await readFile(settings, "utf8")).toBe('{"hooks":{"old":true}}\n');
  } finally { await rm(raiz, { recursive: true, force: true }); }
});

test("Dado doctor que ganha um pré-requisito ausente, Quando a atualização termina, Então reverte sem afirmar saúde igual", async () => {
  const raiz = await raizGerenciada();
  const git = gitSimulado();
  await writeFile(join(raiz, "seguranca/assinantes"), "fixture de chave descartável\n");
  let leituras = 0;
  const deps = {
    raiz, executar: git.executar, releases: releasesPatch,
    diagnosticar: async () => ++leituras === 2 ? { ...diagnosticoLimpo, prerequisitos: [{ nome: "git", presente: false }] } : diagnosticoLimpo,
    provarHook: async () => true, instalar: async () => 0,
  };
  try {
    await expect(atualizar("aplicar", deps)).rejects.toThrow("atualização falhou e foi desfeita");
    expect(leituras).toBe(3);
    expect(git.head()).toBe("commit-anterior");
    expect(JSON.parse(await readFile(join(raiz, ".anvilore/atualizacao.json"), "utf8")).estado).toBe("ocioso");
  } finally { await rm(raiz, { recursive: true, force: true }); }
});

test("Dado tag SSH assinada por chave descartável, Quando verify-tag usa confiança local, Então aceita a chave ancorada e recusa outra", async () => {
  if (!Bun.which("ssh-keygen") || !Bun.which("git")) return;
  const raiz = await mkdtemp(join(tmpdir(), "anvilore-tag-ssh-"));
  const pasta = join(raiz, "seguranca");
  await mkdir(pasta, { recursive: true });
  const chave = join(raiz, "chave-temporaria");
  const gerada = Bun.spawnSync(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "atualizador-teste", "-f", chave], { stdout: "pipe", stderr: "pipe" });
  expect(gerada.exitCode).toBe(0);
  const publico = (await readFile(`${chave}.pub`, "utf8")).trim().split(/\s+/).slice(0, 2).join(" ");
  await writeFile(join(pasta, "assinantes"), `teste@localhost ${publico} namespaces="git"\n`);
  const git = (args: string[]) => {
    const p = Bun.spawnSync(["git", "-C", raiz, ...args], { stdout: "pipe", stderr: "pipe" });
    return { codigo: p.exitCode, saida: `${p.stdout.toString()}${p.stderr.toString()}`.trim() };
  };
  try {
    expect(git(["init", "-q"]).codigo).toBe(0);
    expect(git(["config", "user.name", "Teste Anvilore"]).codigo).toBe(0);
    expect(git(["config", "user.email", "teste@localhost"]).codigo).toBe(0);
    await writeFile(join(raiz, "arquivo.txt"), "fixture\n");
    expect(git(["add", "arquivo.txt"]).codigo).toBe(0);
    expect(git(["commit", "-qm", "fixture"]).codigo).toBe(0);
    const tag = git(["-c", "gpg.format=ssh", "-c", `user.signingkey=${chave}`, "tag", "-s", "v0.3.1", "-m", "v0.3.1"]);
    expect(tag.codigo).toBe(0);
    expect((await import("../src/lib/atualizacao")).verificarAssinaturaTag(raiz, "v0.3.1", git)).toBeUndefined();
    await writeFile(join(pasta, "assinantes"), `teste@localhost ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyForTestOnly namespaces="git"\n`);
    expect((await import("../src/lib/atualizacao")).verificarAssinaturaTag(raiz, "v0.3.1", git)).toContain("assinatura inválida");
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

test("Dado atualização que migra SCHEMA.md e depois volta, Quando checkout antigo o sobrescreve, Então a cópia U2 restaura o arquivo da pessoa", async () => {
  const raiz = await raizGerenciada();
  const comandoGit = (args: string[]) => Bun.spawnSync(["git", "-C", raiz, ...args], { stdout: "pipe", stderr: "pipe" });
  expect(comandoGit(["init", "-q"]).exitCode).toBe(0);
  expect(comandoGit(["config", "user.name", "Teste Anvilore"]).exitCode).toBe(0);
  expect(comandoGit(["config", "user.email", "teste@localhost"]).exitCode).toBe(0);
  await writeFile(join(raiz, "SCHEMA.md"), "modelo da tag\n");
  expect(comandoGit(["add", "SCHEMA.md"]).exitCode).toBe(0);
  expect(comandoGit(["commit", "-qm", "versão anterior"]).exitCode).toBe(0);
  await writeFile(join(raiz, "SCHEMA.md"), "contrato pessoal\n");
  await writeFile(join(raiz, "seguranca/assinantes"), "fixture de chave descartável\n");
  const base = gitSimulado();
  let head = "commit-anterior";
  const executar = (args: string[], cwd: string) => {
    if (args[0] === "rev-parse") return { codigo: 0, saida: head };
    if (args[0] === "describe") return { codigo: 0, saida: head === "commit-anterior" ? "v0.3.0" : "v0.3.1" };
    if (args[0] === "show" && args[1] === "v0.3.1:atualizacao/migracoes.json") return { codigo: 0, saida: JSON.stringify({ deixa_de_rastrear: ["SCHEMA.md"] }) };
    if (args[0] === "checkout" && args.at(-1) === "commit-anterior") {
      head = "commit-anterior";
      writeFileSync(join(raiz, "SCHEMA.md"), "modelo da tag\n");
      return { codigo: 0, saida: "" };
    }
    const resultado = base.executar(args, cwd);
    if (args[0] === "checkout" && args.at(-1) === "v0.3.1") head = "commit-novo";
    return resultado;
  };
  const deps = { raiz, executar, releases: releasesPatch, diagnosticar: async () => diagnosticoLimpo, provarHook: async () => true, instalar: async () => 0 };
  try {
    expect(await atualizar("aplicar", deps)).toContain("Atualizado para 0.3.1");
    expect(await readFile(join(raiz, "SCHEMA.md"), "utf8")).toBe("contrato pessoal\n");
    expect(await atualizar("voltar", deps)).toContain("Voltou para 0.3.0");
    expect(head).toBe("commit-anterior");
    expect(await readFile(join(raiz, "SCHEMA.md"), "utf8")).toBe("contrato pessoal\n");
  } finally { await rm(raiz, { recursive: true, force: true }); }
});

test("Dado falha em R1 e estado reversao-incompleta, Quando a causa some, Então retoma antes de buscar release nova", async () => {
  const raiz = await raizGerenciada();
  const git = gitSimulado();
  await writeFile(join(raiz, "seguranca/assinantes"), "fixture de chave descartável\n");
  let falharVolta = true, chamadasHook = 0;
  const executar = (args: string[], cwd: string) => {
    if (falharVolta && args[0] === "checkout" && args.at(-1) === "commit-anterior") return { codigo: 1, saida: "R1 indisponível" };
    return git.executar(args, cwd);
  };
  let consultas = 0;
  const deps = { raiz, executar, releases: async () => { consultas++; return [{ tag_name: "v0.3.1", draft: false, prerelease: false }]; }, diagnosticar: async () => diagnosticoLimpo, provarHook: async () => chamadasHook++ !== 1, instalar: async () => 0 };
  try {
    await expect(atualizar("aplicar", deps)).rejects.toThrow("reversão incompleta");
    expect(JSON.parse(await readFile(join(raiz, ".anvilore/atualizacao.json"), "utf8")).estado).toBe("reversao-incompleta");
    falharVolta = false;
    const mensagem = await atualizar("aplicar", { ...deps, releases: async () => { consultas++; return []; } });
    expect(mensagem).toContain("Recuperação concluída");
    expect(consultas).toBe(1);
    expect(JSON.parse(await readFile(join(raiz, ".anvilore/atualizacao.json"), "utf8")).estado).toBe("ocioso");
  } finally { await rm(raiz, { recursive: true, force: true }); }
});

for (const etapa of ["R1 checkout", "R2 dependências", "R3 restaurar cópia", "R4 instalar configurações", "R5 doctor e proteção raw"]) {
  test(`Dado falha em ${etapa}, Quando a atualização precisa voltar, Então persiste reversao-incompleta com a etapa e mantém a cópia`, async () => {
    const raiz = await raizGerenciada();
    const git = gitSimulado();
    await writeFile(join(raiz, "seguranca/assinantes"), "fixture de chave descartável\n");
    await mkdir(join(raiz, ".claude"), { recursive: true });
    await writeFile(join(raiz, ".claude/settings.json"), '{"hooks":{"before":true}}\n');
    let installs = 0, hooks = 0, dependencias = 0, negarR1 = etapa === "R1 checkout";
    const executar = (args: string[], cwd: string) => {
      if (etapa === "R1 checkout" && negarR1 && args[0] === "checkout" && args.at(-1) === "commit-anterior") return { codigo: 1, saida: "erro R1" };
      if (etapa === "R2 dependências" && args[0] === "diff" && args.includes("--quiet")) return { codigo: 1, saida: "bun.lock mudou" };
      return git.executar(args, cwd);
    };
    const deps = {
      raiz, executar, releases: releasesPatch, diagnosticar: async () => diagnosticoLimpo,
      provarHook: async () => ++hooks === 1 || etapa !== "R5 doctor e proteção raw",
      instalar: async () => {
        installs++;
        if (installs === 1) {
          if (etapa === "R3 restaurar cópia") {
            const state = JSON.parse(await readFile(join(raiz, ".anvilore/atualizacao.json"), "utf8"));
            await writeFile(join(raiz, ".anvilore/atualizacao", state.id, "arquivos/.claude/settings.json"), "cópia adulterada\n");
          }
          return 4;
        }
        return etapa === "R4 instalar configurações" ? 4 : 0;
      },
      instalarDependencias: async () => ++dependencias === 1 ? 0 : etapa === "R2 dependências" ? 1 : 0,
    };
    try {
      await expect(atualizar("aplicar", deps)).rejects.toThrow("reversão incompleta");
      const state = JSON.parse(await readFile(join(raiz, ".anvilore/atualizacao.json"), "utf8"));
      expect(state.estado).toBe("reversao-incompleta");
      expect(state.etapa).toBe(etapa);
      expect(await readFile(join(raiz, ".anvilore/atualizacao", state.id, "manifesto.json"), "utf8")).toContain('"id"');
      if (etapa !== "R1 checkout") negarR1 = false;
    } finally { await rm(raiz, { recursive: true, force: true }); }
  });
}
