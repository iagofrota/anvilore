import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { criarCenario as CriarCenario, Cenario } from "./apoio/instalar-sh";

// Correção de segurança A1 e A2 (revisão Codex da cadeia de instalação).
// A1: nada do que a candidata traz (filtros do git, hooks) pode rodar antes de a assinatura da tag passar.
// A2: o verificador SSH é fixado no comando; um `gpg.ssh.program` da configuração global não pode aprovar a tag.

const linux = process.platform === "linux";
// O apoio só carrega no Linux: no Windows e no macOS ele nunca roda e derrubaria a cobertura por arquivo.
const apoio = linux ? await import("./apoio/instalar-sh") : undefined;
const cenarios: Cenario[] = [];
afterEach(async () => { await Promise.all(cenarios.splice(0).map(c => c.limpar())); });
async function novo(...args: Parameters<typeof CriarCenario>) { const c = await apoio!.criarCenario(...args); cenarios.push(c); return c; }
const existe = (caminho: string) => stat(caminho).then(() => true, () => false);

// Configuração global do git da pessoa: o teste a escreve no arquivo que o cenário aponta em GIT_CONFIG_GLOBAL.
const global = (c: Cenario, ...args: string[]) => {
  const r = Bun.spawnSync(["git", "config", "--file", join(c.pai, "gitconfig-vazio"), ...args], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
};

// Candidata com filtro de checkout (`* filter=x`) e uma tag $versao: assinada pela chave do kit ou anotada sem assinatura.
async function candidataComFiltro(c: Cenario, versao: string, assinada: boolean) {
  await writeFile(join(c.kit.raiz, ".gitattributes"), "* filter=x\n");
  c.kit.ok(["add", "-f", ".gitattributes"]);
  c.kit.ok(["commit", "-qm", `candidata ${versao}`]);
  const nome = `v${versao}`;
  if (assinada) c.kit.ok(["-c", "gpg.format=ssh", "-c", `user.signingkey=${c.kit.chave}`, "tag", "-s", nome, "-m", nome]);
  else c.kit.ok(["-c", "tag.gpgsign=false", "tag", "-a", nome, "-m", "sem assinatura"]);
}
async function smudgeComMarcador(c: Cenario) {
  const marcador = join(c.pai, "marcador-smudge");
  const script = join(c.pai, "smudge.sh");
  await writeFile(script, `#!/bin/sh\nprintf executado >> "${marcador}"\ncat\n`, { mode: 0o755 });
  global(c, "filter.x.smudge", script);
  global(c, "filter.x.clean", "cat");
  return marcador;
}
async function hookComMarcador(c: Cenario) {
  const marcador = join(c.pai, "marcador-hook");
  const pasta = join(c.pai, "hooks-do-usuario");
  await mkdir(pasta);
  await writeFile(join(pasta, "reference-transaction"), `#!/bin/sh\nprintf "$1 " >> "${marcador}"\ncat >/dev/null\n`, { mode: 0o755 });
  await chmod(join(pasta, "reference-transaction"), 0o755);
  global(c, "core.hooksPath", pasta);
  return marcador;
}
const semSobras = (c: Cenario) => Bun.spawnSync(["sh", "-c", `ls -A ${c.home}`], { stdout: "pipe" }).stdout.toString();

test.skipIf(!linux)("A1: Dado filtro de checkout na config global e candidata com tag sem assinatura válida, Quando instalo, Então recusa, apaga o staging e o filtro não roda", async () => {
  const c = await novo();
  const marcador = await smudgeComMarcador(c);
  await candidataComFiltro(c, "0.3.1", false);
  const r = c.rodar({ ANVILORE_VERSAO: "v0.3.1" });
  expect(r.codigo, r.tudo).toBe(1);
  expect(r.erro).toContain("assinatura inválida");
  expect(await existe(marcador)).toBe(false);
  expect(await existe(c.pasta)).toBe(false);
  expect(semSobras(c)).not.toContain("baixando");
});

test.skipIf(!linux)("A1: Dado o mesmo filtro e uma tag válida, Quando instalo, Então a instalação termina e o filtro só roda depois da autenticação", async () => {
  const c = await novo();
  const marcador = await smudgeComMarcador(c);
  await candidataComFiltro(c, "0.3.1", true);
  const r = c.rodar({ ANVILORE_VERSAO: "v0.3.1" });
  expect(r.codigo, r.tudo).toBe(0);
  expect(await existe(join(c.pasta, "src/cli.ts"))).toBe(true);
  expect(await readFile(marcador, "utf8")).toContain("executado");
  expect(c.kit.git(["-C", c.pasta, "status", "--porcelain"]).saida.trim().split("\n").filter(l => !l.includes(".anvilore") && l !== "")).toEqual([]);
  expect(c.kit.git(["-C", c.pasta, "rev-parse", "HEAD"]).saida.trim()).toBe(c.kit.git(["rev-parse", "refs/tags/v0.3.1^{commit}"]).saida.trim());
});

test.skipIf(!linux)("A1: Dado hook reference-transaction em core.hooksPath global e tag sem assinatura válida, Quando instalo, Então recusa sem rodar o hook", async () => {
  const c = await novo();
  const marcador = await hookComMarcador(c);
  await candidataComFiltro(c, "0.3.1", false);
  const r = c.rodar({ ANVILORE_VERSAO: "v0.3.1" });
  expect(r.codigo, r.tudo).toBe(1);
  expect(r.erro).toContain("assinatura inválida");
  expect(await existe(marcador)).toBe(false);
  expect(await existe(c.pasta)).toBe(false);
});

test.skipIf(!linux)("A1: Dado o hook global e uma tag válida, Quando instalo, Então a instalação termina", async () => {
  const c = await novo();
  await hookComMarcador(c);
  const r = c.rodar();
  expect(r.codigo, r.tudo).toBe(0);
  expect(await existe(join(c.pasta, "src/cli.ts"))).toBe(true);
});
test.skipIf(!linux)("A2: Dado o verify-tag, Quando o instalador o chama, Então o argv fixa os quatro programas de verificação", async () => {
  const c = await novo();
  const log = join(c.pai, "git-argv.log");
  await c.comando("git", `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nexec ${Bun.which("git")} "$@"\n`);
  const r = c.rodar();
  expect(r.codigo, r.tudo).toBe(0);
  const linhas = (await readFile(log, "utf8")).split("\n").filter(l => l.includes(" verify-tag "));
  expect(linhas.length).toBe(1);
  for (const opcao of ["gpg.format=ssh", "gpg.ssh.program=ssh-keygen", "gpg.program=false", "gpg.openpgp.program=false", "gpg.x509.program=false", "gpg.ssh.allowedSignersFile="]) {
    expect(linhas[0], opcao).toContain(`-c ${opcao}`);
  }
});

test.skipIf(!linux)("A2: Dado gpg.ssh.program aprovador na config global e tag assinada por chave fora dos assinantes, Quando instalo, Então recusa", async () => {
  const c = await novo();
  const atacante = await novo();
  const aprovador = join(c.pai, "aprova-tudo.sh");
  await writeFile(aprovador, `#!/bin/sh
case "$*" in
  *find-principals*) echo atacante@exemplo ;;
  *) echo 'Good "git" signature for atacante@exemplo with ED25519 key SHA256:falso' ;;
esac
exit 0
`, { mode: 0o755 });
  global(c, "gpg.ssh.program", aprovador);
  const r = c.rodar({ ANVILORE_ORIGEM: atacante.kit.raiz });
  expect(r.codigo, r.tudo).toBe(1);
  expect(r.erro).toContain("a assinatura da tag v0.3.0 não é do Iago");
  expect(await existe(c.pasta)).toBe(false);
});

// Correção A5 (re-revisão 2): a configuração global do git da pessoa não pode abrir um transporte que execute programa
// (`ext::`) nas chamadas de rede feitas antes de a assinatura da tag passar (ls-remote e clone).
async function helperExtComMarcador(c: Cenario) {
  const marcador = join(c.pai, "marcador-ext");
  const helper = join(c.pai, "helper-ext.sh");
  await writeFile(helper, `#!/bin/sh\nprintf executado >> "${marcador}"\nexit 1\n`, { mode: 0o755 });
  global(c, "protocol.ext.allow", "always");
  global(c, `url.ext::${helper}.insteadOf`, c.kit.raiz);
  return marcador;
}

test.skipIf(!linux)("A5: Dado protocol.ext.allow=always e um insteadOf para ext:: na config global, Quando descubro a última versão, Então recusa sem rodar o helper", async () => {
  const c = await novo();
  const marcador = await helperExtComMarcador(c);
  const r = c.rodar();
  expect(r.codigo, r.tudo).toBe(1);
  expect(await existe(marcador)).toBe(false);
  expect(await existe(c.pasta)).toBe(false);
  expect(semSobras(c)).not.toContain("baixando");
});

test.skipIf(!linux)("A5: Dado o mesmo ext:: e versão fixa em ANVILORE_VERSAO, Quando baixo o kit, Então recusa sem rodar o helper", async () => {
  const c = await novo();
  const marcador = await helperExtComMarcador(c);
  const r = c.rodar({ ANVILORE_VERSAO: "v0.3.0" });
  expect(r.codigo, r.tudo).toBe(1);
  expect(r.erro).toContain("não consegui baixar o Anvilore v0.3.0");
  expect(await existe(marcador)).toBe(false);
  expect(await existe(c.pasta)).toBe(false);
  expect(semSobras(c)).not.toContain("baixando");
});
