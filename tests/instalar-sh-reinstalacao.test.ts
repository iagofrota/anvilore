import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { criarChave, gitReal } from "./apoio/kit-atualizavel";
import { embutirInstalador } from "../scripts/embutir-instalador";

// Correção da fase 2 (ALTO): a reinstalação roda o atualizador da pasta já instalada. Com um `gpg.ssh.program` aprovador na
// configuração global, uma tag nova assinada por chave fora dos assinantes não pode ser aplicada. Usa o kit DE VERDADE
// (o código deste repositório) e precisa de rede para o npm, como tests/instalar-sh-kit-real.test.ts; `ANVILORE_SEM_REDE=1` pula.
// A lista de releases do GitHub e o protocolo `file` do fetch são simulados só no cenário (a guarda do atualizador só abre https).

const raizDoRepo = resolve(import.meta.dir, "..");
const rodar = process.platform === "linux" && process.env.ANVILORE_SEM_REDE !== "1";
const pastas: string[] = [];
afterAll(async () => { await Promise.all(pastas.map(p => rm(p, { recursive: true, force: true }))); });
const apoio = rodar ? await import("./apoio/instalar-sh") : undefined;
const OFICIAL = "https://github.com/iagofrota/anvilore.git";

const PRELOAD = `const original = globalThis.fetch;
globalThis.fetch = (async (url, init) => String(url).startsWith("https://api.github.com/")
  ? Response.json({ tag_name: process.env.RELEASE_FALSA, draft: false, prerelease: false })
  : original(url, init)) as typeof fetch;
`;
const APROVADOR = `#!/bin/sh
case "$*" in
  *find-principals*) echo teste@localhost ;;
  *) echo 'Good "git" signature for teste@localhost with ED25519 key SHA256:falso' ;;
esac
exit 0
`;

test.skipIf(!rodar)("Dado uma pasta instalada e gpg.ssh.program aprovador na config global, Quando reinstalo com uma tag nova assinada por chave fora dos assinantes, Então não aplica a versão e avisa; com a chave certa, aplica", async () => {
  const base = await apoio!.criarCenario({ agentes: [] });
  pastas.push(base.pai);
  const pai = await mkdtemp(join(tmpdir(), "anvilore-reinstala-"));
  pastas.push(pai);
  const origem = join(pai, "origem");
  expect(Bun.spawnSync(["git", "clone", "--quiet", raizDoRepo, origem]).exitCode).toBe(0);
  await mkdir(join(pai, "a")); await mkdir(join(pai, "b"));
  const confiavel = await criarChave(join(pai, "a")), atacante = await criarChave(join(pai, "b"));
  const git = gitReal(origem);
  const ok = (args: string[]) => { const r = git(args); expect(r.codigo, `${args.join(" ")}: ${r.saida}`).toBe(0); return r.saida.trim(); };
  const assinar = (tag: string, chave: string) => ok(["-c", "gpg.format=ssh", "-c", `user.signingkey=${chave}`, "tag", "-f", "-s", tag, "-m", tag]);
  const pacote = JSON.parse(await readFile(join(origem, "package.json"), "utf8")) as { version: string };
  const [maior, menor, patch] = pacote.version.split(".").map(Number) as [number, number, number];
  const atual = `v${pacote.version}`, nova = `v${maior}.${menor}.${patch + 1}`;
  ok(["config", "user.name", "Teste"]); ok(["config", "user.email", "teste@localhost"]);
  git(["tag", "-d", atual]);
  await mkdir(join(origem, "seguranca"), { recursive: true });
  await writeFile(join(origem, "seguranca/assinantes"), confiavel.assinantes);
  ok(["add", "-f", "seguranca/assinantes"]); ok(["commit", "-qm", "assinantes de teste"]);
  assinar(atual, confiavel.chave);

  const script = join(pai, "instalar.sh");
  await writeFile(script, embutirInstalador(await readFile(join(raizDoRepo, "instalador/instalar.sh"), "utf8"), base.manifesto, confiavel.assinantes, `${pacote.version}\n`), { mode: 0o755 });
  const primeira = base.rodar({ ANVILORE_ORIGEM: origem }, [], script);
  expect(primeira.codigo, primeira.tudo).toBe(0);

  // A pasta passa a ter a origin oficial (o atualizador exige).
  const pasta = gitReal(base.pasta);
  expect(pasta(["remote", "set-url", "origin", OFICIAL]).codigo).toBe(0);
  const config = join(base.pai, "gitconfig-vazio");
  const preload = join(pai, "releases-falsas.ts");
  await writeFile(preload, PRELOAD);
  const bun = Bun.which("bun") ?? process.execPath;
  await base.comando("bun", `#!/bin/sh\ncase "$1" in src/cli.ts) exec ${bun} --preload ${preload} "$@" ;; esac\nexec ${bun} "$@"\n`);
  // Só no fetch: o `origin` vira o repositório do teste e o protocolo `file` é liberado. O `remote get-url` continua oficial.
  await base.comando("git", `#!/bin/sh
case " $* " in *" fetch "*)
  GIT_ALLOW_PROTOCOL=https:file; export GIT_ALLOW_PROTOCOL
  for a in "$@"; do shift; if [ "$a" = origin ]; then set -- "$@" "${origem}"; else set -- "$@" "$a"; fi; done ;;
esac
exec ${Bun.which("git")} "$@"
`);
  const antes = pasta(["rev-parse", "HEAD"]).saida.trim();

  // Tag nova assinada pela chave do atacante + aprovador global: a reinstalação não pode aplicar.
  ok(["commit", "-q", "--allow-empty", "-m", "versão nova"]);
  const novoCommit = ok(["rev-parse", "HEAD"]);
  assinar(nova, atacante.chave);
  const aprovador = join(pai, "aprova-tudo.sh");
  await writeFile(aprovador, APROVADOR, { mode: 0o755 });
  expect(Bun.spawnSync(["git", "config", "--file", config, "gpg.ssh.program", aprovador]).exitCode).toBe(0);
  const recusa = base.rodar({ ANVILORE_ORIGEM: origem, RELEASE_FALSA: nova }, [], script);
  expect(recusa.codigo, recusa.tudo).toBe(0);
  expect(recusa.saida).toContain("Já existe uma instalação");
  expect(recusa.saida).toContain("não atualizei agora");
  expect(recusa.saida).not.toContain("Atualizado para");
  expect(pasta(["rev-parse", "HEAD"]).saida.trim()).toBe(antes);

  // Controle: sem o aprovador e com a tag assinada pela chave certa, a mesma reinstalação aplica a versão.
  expect(Bun.spawnSync(["git", "config", "--file", config, "--unset", "gpg.ssh.program"]).exitCode).toBe(0);
  assinar(nova, confiavel.chave);
  const aplica = base.rodar({ ANVILORE_ORIGEM: origem, RELEASE_FALSA: nova }, [], script);
  expect(aplica.codigo, aplica.tudo).toBe(0);
  expect(aplica.saida).not.toContain("não atualizei agora");
  expect(pasta(["rev-parse", "HEAD"]).saida.trim()).toBe(novoCommit);

  // RR6: instalação atrasada na troca de chave. A pasta só conhece a chave antiga (seguranca/assinantes local); a versão seguinte
  // traz a chave nova e é assinada por ela. O instalador novo, com a chave nova embutida, entrega-a ao atualizador.
  const nova2 = `v${maior}.${menor}.${patch + 2}`;
  const chaveNova = await criarChave(await mkdtemp(join(pai, "c-")));
  await writeFile(join(origem, "seguranca/assinantes"), chaveNova.assinantes);
  ok(["add", "-f", "seguranca/assinantes"]); ok(["commit", "-q", "-m", "troca de chave"]);
  const commitTrocado = ok(["rev-parse", "HEAD"]);
  assinar(nova2, chaveNova.chave);
  const scriptNovo = join(pai, "instalar-novo.sh");
  await writeFile(scriptNovo, embutirInstalador(await readFile(join(raizDoRepo, "instalador/instalar.sh"), "utf8"), base.manifesto, chaveNova.assinantes, `${pacote.version}\n`), { mode: 0o755 });
  await mkdir(join(base.pasta, "raw"), { recursive: true });
  await writeFile(join(base.pasta, "raw/nota.md"), "minha nota\n");
  const notaAntes = await readFile(join(base.pasta, "raw/nota.md"), "utf8");
  const atrasada = base.rodar({ ANVILORE_ORIGEM: origem, RELEASE_FALSA: nova2 }, [], scriptNovo);
  expect(atrasada.codigo, atrasada.tudo).toBe(0);
  expect(atrasada.saida).not.toContain("não atualizei agora");
  expect(pasta(["rev-parse", "HEAD"]).saida.trim()).toBe(commitTrocado);
  expect(pasta(["status", "--porcelain", "--", "seguranca/assinantes"]).saida.trim()).toBe("");
  expect(await readFile(join(base.pasta, "seguranca/assinantes"), "utf8")).toBe(chaveNova.assinantes);
  expect(await readFile(join(base.pasta, "raw/nota.md"), "utf8")).toBe(notaAntes);
}, 300_000);
