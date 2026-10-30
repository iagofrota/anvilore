import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { criarChave, gitReal } from "./apoio/kit-atualizavel";
import { embutirInstalador } from "../scripts/embutir-instalador";

// PLANO §8 cenários 1, 16 e 17 com o kit DE VERDADE (o commit atual deste repositório, com tag assinada por chave
// descartável): `bun install --frozen-lockfile`, `instalar --auto-commit`, `init` e `doctor` reais. É o mesmo que o job
// de CI "instalar-do-zero" faz. Precisa de rede para o npm; `ANVILORE_SEM_REDE=1` pula.

const raizDoRepo = resolve(import.meta.dir, "..");
const rodar = process.platform === "linux" && process.env.ANVILORE_SEM_REDE !== "1";
const pastas: string[] = [];
afterAll(async () => { await Promise.all(pastas.map(p => rm(p, { recursive: true, force: true }))); });
// O apoio só carrega quando o teste roda (Linux com rede).
const apoio = rodar ? await import("./apoio/instalar-sh") : undefined;
const existe = (caminho: string) => stat(caminho).then(() => true, () => false);

test.skipIf(!rodar)("Dado o kit real numa tag assinada, Quando instalo do zero em silêncio, Então o doctor sai 0, auto_commit liga, a wiki vira repositório e o hook recusa escrita em raw/", async () => {
  const base = await apoio!.criarCenario({ agentes: [] });
  pastas.push(base.pai);
  const pai = await mkdtemp(join(tmpdir(), "anvilore-kit-real-"));
  pastas.push(pai);
  const origem = join(pai, "origem");
  const clone = Bun.spawnSync(["git", "clone", "--quiet", raizDoRepo, origem]);
  expect(clone.exitCode, clone.stderr.toString()).toBe(0);
  const { chave, assinantes } = await criarChave(pai);
  const git = gitReal(origem);
  const pacote = JSON.parse(await readFile(join(origem, "package.json"), "utf8")) as { version: string };
  expect(git(["config", "user.name", "Teste"]).codigo).toBe(0);
  expect(git(["config", "user.email", "teste@localhost"]).codigo).toBe(0);
  git(["tag", "-d", `v${pacote.version}`]); // o clone traz a tag antiga (sem assinatura de teste)
  const tag = git(["-c", "gpg.format=ssh", "-c", `user.signingkey=${chave}`, "tag", "-s", `v${pacote.version}`, "-m", `v${pacote.version}`]);
  expect(tag.codigo, tag.saida).toBe(0);

  // O manifesto é o do teste (downloads por file://); o Bun do teste atende à versão pedida.
  const manifesto = base.manifesto;
  const script = join(pai, "instalar.sh");
  await writeFile(script, embutirInstalador(await readFile(join(raizDoRepo, "instalador/instalar.sh"), "utf8"), manifesto, assinantes, `${pacote.version}\n`), { mode: 0o755 });
  await base.comando("claude", '#!/bin/sh\ncase "$1" in --version) echo "2.1.312 (Claude Code)" ;; *) echo claude falso ;; esac\n');
  await base.comando("rg", "#!/bin/sh\necho ripgrep 15.2.0\n");

  const r = base.rodar({ ANVILORE_ORIGEM: origem }, [], script);
  expect(r.codigo, r.tudo).toBe(0);
  expect(r.saida).toContain(`Pronto: Anvilore v${pacote.version} instalado (agentes: claude).`);

  const pasta = base.pasta;
  const doctor = Bun.spawnSync([process.execPath, "src/cli.ts", "doctor", pasta], { cwd: pasta, env: base.env(), stdout: "pipe", stderr: "pipe" });
  expect(doctor.exitCode, doctor.stdout.toString() + doctor.stderr.toString()).toBe(0);
  expect(doctor.stdout.toString()).toContain("Commit automático das páginas de wiki: ligada");
  expect(doctor.stdout.toString()).toContain("Backup da branch no GitHub");
  const toml = await readFile(join(pasta, "anvilore.toml"), "utf8");
  expect(toml).toContain("auto_commit = true");
  expect(toml).not.toContain("github_backup = true");
  expect(await existe(join(pasta, "wiki/.git"))).toBe(true);
  const commits = Bun.spawnSync(["git", "-C", join(pasta, "wiki"), "rev-list", "--count", "HEAD"], { stdout: "pipe" }).stdout.toString().trim();
  expect(Number(commits)).toBeGreaterThanOrEqual(1);
  const settings = await readFile(join(pasta, ".claude/settings.json"), "utf8");
  expect(settings).toContain("hook proteger-raw");
  const hook = Bun.spawnSync([process.execPath, "src/cli.ts", "hook", "proteger-raw"], {
    cwd: pasta, env: base.env(), stdin: Buffer.from(JSON.stringify({ tool_name: "Write", tool_input: { file_path: join(pasta, "raw/nota.md") } })), stdout: "pipe", stderr: "pipe",
  });
  expect(hook.exitCode).toBe(2);
  expect(await base.estado()).toMatchObject({ versaoInstalada: pacote.version, alvos: ["claude"], autoCommit: true });
  expect(await existe(join(pasta, "wiki/pessoal"))).toBe(true);

  // O atualizador do próprio kit reconhece a instalação (estado do instalador + tag exata); a origem de teste não é a
  // oficial, então ele recusa — e é essa a recusa esperada para um clone que não veio do GitHub.
  const atualizar = Bun.spawnSync([process.execPath, "src/cli.ts", "atualizar", "--estado"], { cwd: pasta, env: base.env(), stdout: "pipe", stderr: "pipe" });
  expect(atualizar.exitCode, atualizar.stderr.toString()).toBe(0);
  expect(atualizar.stdout.toString()).toContain(`Versão: ${pacote.version}`);
  expect(atualizar.stdout.toString()).toContain("Estado: ocioso");
}, 240_000);
