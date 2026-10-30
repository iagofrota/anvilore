import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { criarCenario as CriarCenario, Cenario } from "./apoio/instalar-sh";

// PLANO §2 (instalar.sh, passos 1–12) e §8 (cenários 1, 3–5, 16, 17, 33–35). Todo teste roda num HOME vazio, com o
// PATH montado pelo teste e um repositório local no lugar do GitHub (ANVILORE_ORIGEM). Só Linux: o script recusa macOS.

const linux = process.platform === "linux";
// O apoio só carrega no Linux: no Windows e no macOS ele nunca roda e derrubaria a cobertura por arquivo.
const apoio = linux ? await import("./apoio/instalar-sh") : undefined;
const cenarios: Cenario[] = [];
afterEach(async () => { await Promise.all(cenarios.splice(0).map(c => c.limpar())); });
async function novo(...args: Parameters<typeof CriarCenario>) { const c = await apoio!.criarCenario(...args); cenarios.push(c); return c; }
const existe = (caminho: string) => stat(caminho).then(() => true, () => false);
const hashDe = async (caminho: string) => createHash("sha256").update(await readFile(caminho)).digest("hex");

test.skipIf(!linux)("Dado um HOME vazio e o Claude Code instalado, Quando rodo o instalador em silêncio, Então instala o kit da tag assinada, configura o agente e grava estado e log (cenários 1 e 17)", async () => {
  const c = await novo({ agentes: ["claude"] });
  const r = c.rodar();
  expect(r.codigo, r.tudo).toBe(0);
  expect(await existe(join(c.pasta, "src/cli.ts"))).toBe(true);
  expect(c.kit.git(["rev-parse", "HEAD"]).saida.trim()).toBe(c.kit.commits["0.3.0"]!);
  const clone = Bun.spawnSync(["git", "-C", c.pasta, "describe", "--tags", "--exact-match", "HEAD"], { stdout: "pipe" });
  expect(clone.stdout.toString().trim()).toBe("v0.3.0");
  const estado = await c.estado();
  expect(estado).toMatchObject({ versao: 1, modo: "automatico", canal: "estavel", estado: "ocioso", versaoInstalada: "0.3.0", alvos: ["claude"], autoCommit: true, bunGerenciado: false });
  expect(await readFile(join(c.pasta, "anvilore.toml"), "utf8")).toContain("auto_commit = true");
  expect(await readFile(join(c.pasta, "anvilore.toml"), "utf8")).not.toContain("github_backup");
  expect((await c.chamadas()).filter(l => l.startsWith("instalar"))[0]).toContain("--auto-commit");
  expect(await c.chamadas()).toContain("init --areas pessoal,profissional,projetos-paralelos,saude");
  expect((await c.chamadas()).some(l => l.startsWith("doctor"))).toBe(true);
  // 3 linhas finais: o que foi instalado, onde está, o próximo passo.
  expect(r.saida).toContain("Pronto: Anvilore v0.3.0 instalado (agentes: claude).");
  expect(r.saida).toContain(`Onde está: ${c.pasta}`);
  expect(r.saida).toContain("Próximo passo: abra o Claude Code");
  const log = await c.log();
  expect(log).toContain("tag: v0.3.0");
  expect(log).toContain("resumo:");
  expect(await readFile(join(c.pasta, ".anvilore/instalacao.log"), "utf8")).toBe(log);
  expect(((await stat(join(c.pasta, ".anvilore/instalacao.log"))).mode & 0o777).toString(8)).toBe("600");
  // Nada ficou para trás: pasta temporária de download e clone parcial.
  expect(await existe(join(c.home, ".anvilore-baixando"))).toBe(false);
  expect(Bun.spawnSync(["sh", "-c", `ls -A ${c.home} | grep -c baixando`], { stdout: "pipe" }).stdout.toString().trim()).toBe("0");
});

test.skipIf(!linux)("Dado o rg ausente e o manifesto com ele, Quando instalo, Então o rg vai para ~/.local/bin com o hash conferido (cenário 35)", async () => {
  const c = await novo();
  const r = c.rodar();
  expect(r.codigo, r.tudo).toBe(0);
  expect(await existe(join(c.home, ".local/bin/rg"))).toBe(true);
  expect(r.saida).not.toContain("sem rg");
  expect(await c.log()).toContain("rg: instalado em");
});

test.skipIf(!linux)("Dado rg com SHA-256 que não confere, Quando instalo, Então apaga o arquivo, segue sem rg e avisa (cenários 33 e 34)", async () => {
  const c = await novo({ entradas: { rgCorrompido: true } });
  const r = c.rodar();
  expect(r.codigo, r.tudo).toBe(0);
  expect(await existe(join(c.home, ".local/bin/rg"))).toBe(false);
  expect(r.saida).toContain("Aviso: o download do rg não confere com o SHA-256");
  expect(r.saida).toContain("sem o rg, a busca da skill query fica indisponível");
  expect(r.saida).toContain("sem rg: a busca da skill query fica indisponível");
  expect(await existe(join(c.tmp, "rg"))).toBe(false);
  expect(await existe(join(c.pasta, "src/cli.ts"))).toBe(true);
});

test.skipIf(!linux)("Dado plataforma sem entrada de rg no manifesto, Quando instalo, Então termina com sucesso e avisa (cenário 34)", async () => {
  const c = await novo({ entradas: { semRg: true } });
  const r = c.rodar();
  expect(r.codigo, r.tudo).toBe(0);
  expect(r.saida).toContain("não consegui instalar o rg");
  expect(r.saida).toContain("Pronto:");
});

test.skipIf(!linux)("Dado rg já no sistema, Quando instalo, Então usa o dele e não baixa nada", async () => {
  const c = await novo();
  await c.comando("rg", "#!/bin/sh\necho rg do sistema\n");
  const r = c.rodar();
  expect(r.codigo, r.tudo).toBe(0);
  expect(await existe(join(c.home, ".local/bin/rg"))).toBe(false);
  expect(await c.log()).toContain("rg: usando o do sistema");
});

test.skipIf(!linux)("Dado tag assinada por outra chave, Quando instalo, Então apaga o que baixou, não liga agente e diz por quê (cenário 5)", async () => {
  const c = await novo();
  const outra = await novo();
  // O instalar.sh do teste confia na chave do kit `c`; o repositório servido é o do kit `outra` (chave diferente).
  const r = c.rodar({ ANVILORE_ORIGEM: outra.kit.raiz });
  expect(r.codigo).toBe(1);
  expect(r.erro).toContain("assinatura inválida");
  expect(r.erro).toContain("a assinatura da tag v0.3.0 não é do Iago");
  expect(await existe(c.pasta)).toBe(false);
  expect(await existe(join(c.home, ".claude"))).toBe(false);
  expect(Bun.spawnSync(["sh", "-c", `ls -A ${c.home}`], { stdout: "pipe" }).stdout.toString()).not.toContain("baixando");
});

test.skipIf(!linux)("Dado tag sem assinatura (leve ou anotada), Quando instalo, Então recusa", async () => {
  const c = await novo();
  c.kit.ok(["tag", "-d", "v0.3.0"]);
  c.kit.ok(["tag", "v0.3.0"]);
  const leve = c.rodar();
  expect(leve.codigo).toBe(1);
  expect(leve.erro).toContain("não é uma tag anotada e assinada");
  c.kit.ok(["tag", "-d", "v0.3.0"]);
  c.kit.ok(["-c", "tag.gpgsign=false", "tag", "-a", "v0.3.0", "-m", "sem assinatura"]);
  const anotada = c.rodar();
  expect(anotada.codigo).toBe(1);
  expect(anotada.erro).toContain("assinatura inválida");
  expect(await existe(c.pasta)).toBe(false);
});

test.skipIf(!linux)("Dado tag com assinatura de outro tipo (OpenPGP), Quando instalo, Então recusa sem chamar o gpg do usuário", async () => {
  const c = await novo();
  const commit = c.kit.commits["0.3.0"]!;
  const texto = `object ${commit}\ntype commit\ntag v0.3.0\ntagger Teste <teste@localhost> 1700000000 +0000\n\nv0.3.0\n-----BEGIN PGP SIGNATURE-----\n\niQEzBAABCAAdFiEEfalsa\n-----END PGP SIGNATURE-----\n`;
  const objeto = Bun.spawnSync(["git", "-C", c.kit.raiz, "hash-object", "-t", "tag", "-w", "--stdin"], { stdin: Buffer.from(texto), stdout: "pipe", stderr: "pipe" }).stdout.toString().trim();
  expect(objeto).toMatch(/^[0-9a-f]{40}/);
  c.kit.ok(["update-ref", "refs/tags/v0.3.0", objeto]);
  // Um gpg que aprovaria tudo: se o instalador o chamasse, a tag passaria.
  await c.comando("gpg", "#!/bin/sh\necho '[GNUPG:] GOODSIG 0 falso' >&2\nexit 0\n");
  const r = c.rodar();
  expect(r.codigo).toBe(1);
  expect(r.erro).toContain("não tem assinatura SSH");
  expect(await existe(c.pasta)).toBe(false);
});

test.skipIf(!linux)("Dado a ref v0.3.1 apontando para a tag assinada da v0.3.0, Quando instalo essa versão, Então recusa (o nome assinado é outro)", async () => {
  const c = await novo();
  const objeto = c.kit.ok(["rev-parse", "refs/tags/v0.3.0"]);
  c.kit.ok(["update-ref", "refs/tags/v0.3.1", objeto]);
  const r = c.rodar({ ANVILORE_VERSAO: "v0.3.1" });
  expect(r.codigo).toBe(1);
  expect(r.erro).toContain("a tag assinada se chama 'v0.3.0', não 'v0.3.1'");
  expect(await existe(c.pasta)).toBe(false);
});

test.skipIf(!linux)("Dado o modelo do repositório (sem chave embutida), Quando rodo, Então recusa e explica sem tocar em nada", async () => {
  const c = await novo();
  const modelo = join(c.pai, "modelo.sh");
  await writeFile(modelo, c.modelo);
  const r = c.rodar({}, [], modelo);
  expect(r.codigo).toBe(1);
  expect(r.erro).toContain("não traz o manifesto");
  const semChave = join(c.pai, "sem-chave.sh");
  await writeFile(semChave, c.modelo.replace(/# >>> ANVILORE:MANIFESTO[\s\S]*?# <<< ANVILORE:MANIFESTO\n/, () => `# >>> ANVILORE:MANIFESTO\nmanifesto_embutido() {\n  cat <<'ANVILORE_FIM_MANIFESTO'\n${c.manifesto}ANVILORE_FIM_MANIFESTO\n}\n# <<< ANVILORE:MANIFESTO\n`));
  const s = c.rodar({}, [], semChave);
  expect(s.codigo).toBe(1);
  expect(s.erro).toContain("não traz a chave de assinatura");
  expect(await existe(c.pasta)).toBe(false);
  expect(await existe(join(c.home, ".bun"))).toBe(false);
});

test.skipIf(!linux)("Dado nenhum agente e oferta recusada (padrão sem perguntas), Quando instalo, Então o kit fica e o resultado é parcial (cenário 3)", async () => {
  const c = await novo({ agentes: [] });
  const r = c.rodar();
  expect(r.codigo, r.tudo).toBe(0);
  expect(r.saida).toContain("Não achei nenhum agente");
  expect(r.saida).toContain("Instalação parcial");
  expect(r.saida).toContain("Instale um agente (por exemplo o Claude Code) e rode este instalador de novo: ele só completa o que falta.");
  expect(await existe(join(c.pasta, "src/cli.ts"))).toBe(true);
  expect(await c.estado()).toMatchObject({ alvos: [], autoCommit: true });
  expect(await readFile(join(c.pasta, "anvilore.toml"), "utf8")).toContain("auto_commit = true");
  const doctor = Bun.spawnSync([process.execPath, join(c.pasta, "src/cli.ts"), "doctor", c.pasta], { cwd: c.pasta, env: c.env(), stdout: "pipe" });
  expect(doctor.exitCode).toBe(1);
  expect(doctor.stdout.toString()).toContain("nenhum agente com a trava");
});

test.skipIf(!linux)("Dado nenhum agente e oferta aceita, Quando instalo, Então o Claude Code oficial é instalado antes do instalar e fica configurado (cenário 16)", async () => {
  const c = await novo({ agentes: [] });
  // O instalador oficial é de mentira: um `curl` que serve o script do Claude Code para o endereço dele e repassa o resto.
  const curlReal = Bun.which("curl")!;
  await c.comando("curl", `#!/bin/sh
case "$*" in
  *claude.ai/install.sh*) out=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done
    printf '#!/bin/sh\\nmkdir -p "$HOME/.local/bin"\\nprintf "#!/bin/sh\\\\necho claude falso\\\\n" > "$HOME/.local/bin/claude"\\nchmod +x "$HOME/.local/bin/claude"\\n' > "$out" ;;
  *) exec ${curlReal} "$@" ;;
esac
`);
  const r = c.rodar({ ANVILORE_INSTALAR_CLAUDE: "sim" });
  expect(r.codigo, r.tudo).toBe(0);
  expect(r.saida).toContain("Instalando o Claude Code");
  expect(await existe(join(c.home, ".local/bin/claude"))).toBe(true);
  expect(await c.estado()).toMatchObject({ alvos: ["claude"] });
  expect(r.saida).toContain("Pronto: Anvilore v0.3.0 instalado (agentes: claude).");
  expect(await existe(join(c.pasta, ".claude/hook.json"))).toBe(true);
});

test.skipIf(!linux)("Dado oferta aceita mas o instalador do Claude falha, Quando instalo, Então termina parcial e avisa", async () => {
  const c = await novo({ agentes: [] });
  const curlReal = Bun.which("curl")!;
  await c.comando("curl", `#!/bin/sh\ncase "$*" in *claude.ai/install.sh*) exit 22 ;; *) exec ${curlReal} "$@" ;; esac\n`);
  const r = c.rodar({ ANVILORE_INSTALAR_CLAUDE: "sim" });
  expect(r.codigo, r.tudo).toBe(0);
  expect(r.saida).toContain("Aviso: não consegui instalar o Claude Code");
  expect(r.saida).toContain("Instalação parcial");
});

test.skipIf(!linux)("Dado uma instalação existente, Quando rodo de novo, Então não sobrescreve nada da pessoa, preserva as escolhas e só confere (cenário 4)", async () => {
  const c = await novo({ agentes: ["claude"] });
  expect(c.rodar().codigo).toBe(0);
  await mkdir(join(c.pasta, "raw"), { recursive: true });
  await writeFile(join(c.pasta, "raw/nota.md"), "minha nota\n");
  await writeFile(join(c.pasta, "SCHEMA.md"), "meu esquema\n");
  await mkdir(join(c.pasta, "wiki/pessoal"), { recursive: true });
  await writeFile(join(c.pasta, "wiki/pessoal/pagina.md"), "minha página\n");
  const antes = { raw: await hashDe(join(c.pasta, "raw/nota.md")), schema: await hashDe(join(c.pasta, "SCHEMA.md")), pagina: await hashDe(join(c.pasta, "wiki/pessoal/pagina.md")) };
  // Escolhas da pessoa: commit automático desligado, área padrão apagada.
  await writeFile(join(c.pasta, ".anvilore/atualizacao.json"), JSON.stringify({ ...(await c.estado()), modo: "perguntar", canal: "teste", autoCommit: false }));
  await rm(join(c.pasta, "anvilore.toml"));
  await rm(join(c.pasta, "wiki/saude"), { recursive: true });
  const chamadasAntes = (await c.chamadas()).length;
  const cabeca = c.kit.git(["-C", c.pasta, "rev-parse", "HEAD"]).saida.trim();
  const r = c.rodar();
  expect(r.codigo, r.tudo).toBe(0);
  expect(r.saida).toContain("Já existe uma instalação");
  expect(r.saida).toContain("Aviso: não atualizei agora");
  expect(r.saida).not.toContain("Baixando o Anvilore");
  expect({ raw: await hashDe(join(c.pasta, "raw/nota.md")), schema: await hashDe(join(c.pasta, "SCHEMA.md")), pagina: await hashDe(join(c.pasta, "wiki/pessoal/pagina.md")) }).toEqual(antes);
  expect(await c.estado()).toMatchObject({ modo: "perguntar", canal: "teste", alvos: ["claude"], versaoInstalada: "0.3.0", autoCommit: false });
  expect(await existe(join(c.pasta, "anvilore.toml"))).toBe(false);
  expect(await existe(join(c.pasta, "wiki/saude"))).toBe(false);
  const novas = (await c.chamadas()).slice(chamadasAntes);
  expect(novas.some(l => l.startsWith("instalar") && !l.includes("--auto-commit"))).toBe(true);
  expect(novas.some(l => l.startsWith("init"))).toBe(false);
  expect(Bun.spawnSync(["git", "-C", c.pasta, "rev-parse", "HEAD"], { stdout: "pipe" }).stdout.toString().trim()).toBe(cabeca);
  const log = await c.log();
  expect(log.match(/início: instalar\.sh/g)?.length).toBe(2);
  expect(r.saida).toContain("Pronto:");
});

test.skipIf(!linux)("R1: Dado uma instalação existente, Quando rodo de novo, Então o atualizador recebe as chaves embutidas pela opção --assinantes-do-instalador (arquivo com o conteúdo embutido)", async () => {
  const c = await novo({ agentes: ["claude"] });
  expect(c.rodar().codigo).toBe(0);
  const r = c.rodar({ STUB_ATUALIZAR_CODIGO: "0" });
  expect(r.codigo, r.tudo).toBe(0);
  expect(r.saida).not.toContain("não atualizei agora");
  const entregas = (await readFile(join(c.pasta, ".anvilore/atualizar-entrega.log"), "utf8")).trim().split("\n").map(l => JSON.parse(l) as { variavel: string | null; arquivo: string | null; conteudo: string | null });
  const ultima = entregas.at(-1)!;
  expect(ultima.arquivo).toMatch(/assinantes-reinstalacao$/);
  expect(ultima.conteudo).toBe(c.assinantes);
  expect(ultima.variavel).toBeNull();
});

test.skipIf(!linux)("R1: Dado o instalador sem variável no ambiente, Quando reinstalo, Então o atualizador não recebe variável nenhuma (só a opção)", async () => {
  const c = await novo({ agentes: ["claude"] });
  expect(c.rodar().codigo).toBe(0);
  const r = c.rodar({ STUB_ATUALIZAR_CODIGO: "0" });
  expect(r.codigo, r.tudo).toBe(0);
  const ultima = JSON.parse((await readFile(join(c.pasta, ".anvilore/atualizar-entrega.log"), "utf8")).trim().split("\n").at(-1)!) as { variavel: string | null; arquivo: string | null };
  expect(ultima.variavel).toBeNull();
  expect(ultima.arquivo).not.toBeNull();
});

test.skipIf(!linux)("R1: Dado o atualizador antigo da pasta (devolve 2 com 'Uso:' para a opção), Quando reinstalo, Então avisa em linguagem simples, sai com erro e não muda HEAD nem arquivos", async () => {
  const c = await novo({ agentes: ["claude"] });
  expect(c.rodar().codigo).toBe(0);
  await mkdir(join(c.pasta, "raw"), { recursive: true });
  await writeFile(join(c.pasta, "raw/nota.md"), "minha nota\n");
  const antes = { nota: await hashDe(join(c.pasta, "raw/nota.md")), agentes: await hashDe(join(c.pasta, "AGENTS.md")) };
  const cabeca = c.kit.git(["-C", c.pasta, "rev-parse", "HEAD"]).saida.trim();
  const chamadasAntes = (await c.chamadas()).length;
  const r = c.rodar({ STUB_ATUALIZAR_CODIGO: "2" });
  expect(r.codigo, r.tudo).not.toBe(0);
  expect(r.tudo).toContain("A pasta tem uma versão antiga do Anvilore que não sabe receber as chaves do instalador");
  expect(r.tudo).toContain("nada foi mudado");
  expect(r.tudo).not.toContain("Uso:");
  expect(r.tudo).not.toContain("Pronto:");
  expect(c.kit.git(["-C", c.pasta, "rev-parse", "HEAD"]).saida.trim()).toBe(cabeca);
  expect({ nota: await hashDe(join(c.pasta, "raw/nota.md")), agentes: await hashDe(join(c.pasta, "AGENTS.md")) }).toEqual(antes);
  // Parou ali: só o atualizador foi chamado (nem instalar nem doctor rodaram depois).
  const novas = (await c.chamadas()).slice(chamadasAntes);
  expect(novas.map(l => l.split(" ")[0])).toEqual(["atualizar"]);
});

test.skipIf(!linux)("Dado uma primeira instalação interrompida na configuração, Quando rodo de novo, Então termina como instalação nova (áreas e commit automático) e não a recusa", async () => {
  const c = await novo();
  const cai = c.rodar({ STUB_INSTALAR_CODIGO: "4" });
  expect(cai.codigo).toBe(1);
  expect(await existe(join(c.pasta, ".anvilore/instalacao-em-andamento"))).toBe(true);
  const r = c.rodar();
  expect(r.codigo, r.tudo).toBe(0);
  expect(r.saida).toContain("Já existe uma instalação");
  expect(await existe(join(c.pasta, ".anvilore/instalacao-em-andamento"))).toBe(false);
  expect(await existe(join(c.pasta, "wiki/saude"))).toBe(true);
  expect(await c.estado()).toMatchObject({ autoCommit: true, alvos: ["claude"] });
  expect(await readFile(join(c.pasta, "anvilore.toml"), "utf8")).toContain("auto_commit = true");
  expect(await c.log()).toContain("retomando como instalação nova");
});

test.skipIf(!linux)("Dado a pasta padrão ocupada por outra coisa, Quando instalo em silêncio, Então para sem mexer em nada", async () => {
  const c = await novo();
  await mkdir(c.pasta);
  await writeFile(join(c.pasta, "meus-arquivos.txt"), "importante\n");
  const r = c.rodar();
  expect(r.codigo).toBe(1);
  expect(r.erro).toContain("escolha outra pasta");
  expect(await readFile(join(c.pasta, "meus-arquivos.txt"), "utf8")).toBe("importante\n");
  expect(await existe(join(c.pasta, "src"))).toBe(false);
});

test.skipIf(!linux)("Dado ANVILORE_PASTA e uma pasta vazia que já existe, Quando instalo, Então usa essa pasta", async () => {
  const c = await novo();
  const destino = join(c.pai, "outro lugar", "Meu Anvilore");
  await mkdir(destino, { recursive: true });
  const r = c.rodar({ ANVILORE_PASTA: destino });
  expect(r.codigo, r.tudo).toBe(0);
  expect(await existe(join(destino, "src/cli.ts"))).toBe(true);
  expect(await existe(join(destino, ".anvilore/instalacao.log"))).toBe(true);
});

test.skipIf(!linux)("Dado o configurar com erro, Quando instalo, Então falha com mensagem simples e o kit fica para a próxima rodada", async () => {
  const c = await novo();
  const r = c.rodar({ STUB_INSTALAR_CODIGO: "4" });
  expect(r.codigo).toBe(1);
  expect(r.erro).toContain("a configuração dos agentes terminou com erro");
  expect(await existe(join(c.pasta, "src/cli.ts"))).toBe(true);
  expect(r.erro).toContain("instalacao.log");
});

test.skipIf(!linux)("Dado sem o Bun no PATH, Quando instalo, Então baixa o zip do manifesto, confere o SHA-256 e marca o Bun como gerenciado", async () => {
  const c = await novo({ comBun: false });
  const r = c.rodar();
  expect(r.codigo, r.tudo).toBe(0);
  expect(await existe(join(c.home, ".bun/bin/bun"))).toBe(true);
  expect((await lstat(join(c.home, ".local/bin/bun"))).isSymbolicLink()).toBe(true);
  expect(await readlink(join(c.home, ".local/bin/bun"))).toBe(join(c.home, ".bun/bin/bun"));
  expect(await c.estado()).toMatchObject({ bunGerenciado: true });
  expect(r.saida).toContain("Instalando o Bun");
  expect(await c.log()).toContain("bun: instalado em");
});

test.skipIf(!linux)("Dado Bun com SHA-256 que não confere, Quando instalo, Então para sem instalar o Bun nem baixar o kit (cenário 33)", async () => {
  const c = await novo({ comBun: false, entradas: { bunCorrompido: true } });
  const r = c.rodar();
  expect(r.codigo).toBe(1);
  expect(r.erro).toContain("não confere com o SHA-256 do manifesto");
  expect(await existe(join(c.home, ".bun/bin/bun"))).toBe(false);
  expect(await existe(c.pasta)).toBe(false);
});

test.skipIf(!linux)("Dado Bun mais velho que o do manifesto, Quando instalo em silêncio, Então instala o do manifesto em ~/.bun/bin", async () => {
  const c = await novo({ comBun: false });
  await c.comando("bun", "#!/bin/sh\necho 0.9.0\n");
  const r = c.rodar();
  expect(r.codigo, r.tudo).toBe(0);
  expect(r.saida).toContain("Seu Bun é 0.9.0");
  expect((await readFile(join(c.home, ".bun/bin/bun"), "utf8").catch(() => "")).length).toBeGreaterThanOrEqual(0);
  expect(await existe(join(c.home, ".bun/bin/bun"))).toBe(true);
});

test.skipIf(!linux)("Dado sistema que não é Linux x64/arm64, Quando rodo, Então diz que não é suportado e não faz nada", async () => {
  const c = await novo();
  await c.comando("uname", '#!/bin/sh\ncase "$1" in -s) echo Darwin ;; *) echo arm64 ;; esac\n');
  const mac = c.rodar();
  expect(mac.codigo).toBe(1);
  expect(mac.erro).toContain("macOS");
  await c.comando("uname", '#!/bin/sh\ncase "$1" in -s) echo Linux ;; *) echo riscv64 ;; esac\n');
  const raro = c.rodar();
  expect(raro.codigo).toBe(1);
  expect(raro.erro).toContain("arquitetura não suportada: riscv64");
  expect(await existe(c.pasta)).toBe(false);
});

test.skipIf(!linux)("Dado git ausente e sudo disponível, Quando instalo em silêncio, Então instala o pacote pelo gerenciador e segue", async () => {
  const c = await novo();
  const gitReal = Bun.which("git")!;
  Bun.spawnSync(["rm", "-f", join(c.bin, "git")]);
  await c.comando("sudo", '#!/bin/sh\nwhile [ "${1#-}" != "$1" ]; do shift; done\nexec "$@"\n');
  await c.comando("apt-get", `#!/bin/sh\necho "$@" >> "${join(c.pai, "apt.log")}"\nln -sf ${gitReal} "${c.bin}/git"\n`);
  const r = c.rodar();
  expect(r.codigo, r.tudo).toBe(0);
  expect(r.saida).toContain("Faltam no seu computador: git.");
  expect(await readFile(join(c.pai, "apt.log"), "utf8")).toContain("install -y git");
  expect(await existe(join(c.pasta, "src/cli.ts"))).toBe(true);
});

test.skipIf(!linux)("Dado git ausente e nenhum gerenciador de pacotes, Quando instalo, Então explica o que instalar e não faz nada", async () => {
  const c = await novo();
  Bun.spawnSync(["rm", "-f", join(c.bin, "git")]);
  const r = c.rodar();
  expect(r.codigo).toBe(1);
  expect(r.erro).toContain("faltam: git");
  expect(await existe(c.pasta)).toBe(false);
});

test.skipIf(!linux)("Dado ssh-keygen ausente, Quando o gerenciador é o dnf, Então pede o pacote openssh-clients", async () => {
  const c = await novo();
  Bun.spawnSync(["rm", "-f", join(c.bin, "ssh-keygen")]);
  await c.comando("sudo", '#!/bin/sh\nwhile [ "${1#-}" != "$1" ]; do shift; done\nexec "$@"\n');
  await c.comando("dnf", `#!/bin/sh\necho "$@" >> "${join(c.pai, "dnf.log")}"\nln -sf ${Bun.which("ssh-keygen")!} "${c.bin}/ssh-keygen"\n`);
  const r = c.rodar();
  expect(r.codigo, r.tudo).toBe(0);
  expect(await readFile(join(c.pai, "dnf.log"), "utf8")).toContain("install -y openssh-clients");
});

test.skipIf(!linux)("Dado --ajuda, Quando rodo, Então mostra o uso sem instalar nada", async () => {
  const c = await novo();
  const r = c.rodar({}, ["--ajuda"]);
  expect(r.codigo).toBe(0);
  expect(r.saida).toContain("ANVILORE_SEM_PERGUNTAS");
  expect(c.rodar({}, ["--lixo"]).codigo).toBe(2);
  expect(await existe(c.pasta)).toBe(false);
});
