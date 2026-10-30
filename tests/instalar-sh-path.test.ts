import { afterEach, expect, test } from "bun:test";
import { chmod, lstat, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { criarCenario as CriarCenario, Cenario } from "./apoio/instalar-sh";

// Achado P1 do Codex (PR #34): no Linux, os hooks chamam `bun` pelo PATH, e o instalador só exportava o PATH no próprio processo.
// Agora ele persiste ~/.local/bin (e ~/.bun/bin, se o Bun é o gerenciado) num bloco marcado, como os instaladores do Bun e do rustup.
// Todo teste roda num HOME vazio, dentro de `agentop run --rm` ou não: nada toca no HOME real.

const linux = process.platform === "linux";
const apoio = linux ? await import("./apoio/instalar-sh") : undefined;
const cenarios: Cenario[] = [];
afterEach(async () => { await Promise.all(cenarios.splice(0).map(c => c.limpar())); });
async function novo(...args: Parameters<typeof CriarCenario>) { const c = await apoio!.criarCenario(...args); cenarios.push(c); return c; }
const existe = (caminho: string) => stat(caminho).then(() => true, () => false);
const INICIO = "# >>> Anvilore: PATH >>>";
const FIM = "# <<< Anvilore: PATH <<<";
const ocorrencias = (texto: string, trecho: string) => texto.split(trecho).length - 1;
// Um terminal novo de verdade: ambiente limpo, só o HOME e o PATH padrão do sistema, shell de login.
const terminalNovo = (home: string, comando: string, shell = "bash") =>
  Bun.spawnSync(["env", "-i", `HOME=${home}`, "PATH=/usr/bin:/bin", shell, shell === "bash" ? "-lc" : "-ic", comando], { stdout: "pipe", stderr: "pipe" }).stdout.toString().trim();

test.skipIf(!linux)("Dado um HOME sem nenhum arquivo de shell e o Bun gerenciado, Quando instalo, Então ~/.profile ganha o bloco marcado uma vez e ~/.bashrc e ~/.zshrc não são criados", async () => {
  const c = await novo({ comBun: false });
  const r = c.rodar();
  expect(r.codigo, r.tudo).toBe(0);
  const profile = await readFile(join(c.home, ".profile"), "utf8");
  expect(ocorrencias(profile, INICIO)).toBe(1);
  expect(ocorrencias(profile, FIM)).toBe(1);
  expect(profile).toContain('$HOME/.local/bin');
  expect(profile).toContain('$HOME/.bun/bin');
  expect(await existe(join(c.home, ".bashrc"))).toBe(false);
  expect(await existe(join(c.home, ".zshrc"))).toBe(false);
});

test.skipIf(!linux)("Dado o Bun que já existia (não gerenciado), Quando instalo, Então o bloco traz ~/.local/bin mas não ~/.bun/bin", async () => {
  const c = await novo();
  const r = c.rodar();
  expect(r.codigo, r.tudo).toBe(0);
  const profile = await readFile(join(c.home, ".profile"), "utf8");
  expect(profile).toContain('$HOME/.local/bin');
  expect(profile).not.toContain('.bun/bin');
});

test.skipIf(!linux)("Dado .bashrc e .zshrc e .profile com conteúdo da pessoa, Quando instalo, Então cada um ganha o bloco uma vez e o resto fica byte a byte igual", async () => {
  const c = await novo();
  const originais: Record<string, string> = {
    ".profile": "# meu profile\nexport EDITOR=vim\n",
    ".bashrc": "# meu bashrc\nalias ll='ls -l'\n",
    ".zshrc": "# meu zshrc\nsetopt autocd",   // sem quebra de linha no fim, de propósito
  };
  for (const [nome, texto] of Object.entries(originais)) await writeFile(join(c.home, nome), texto);
  const r = c.rodar();
  expect(r.codigo, r.tudo).toBe(0);
  for (const [nome, texto] of Object.entries(originais)) {
    const depois = await readFile(join(c.home, nome), "utf8");
    expect(depois.startsWith(texto), nome).toBe(true);
    expect(ocorrencias(depois, INICIO), nome).toBe(1);
    expect(depois.slice(texto.length).replace(/^\n+/, "").startsWith(INICIO), nome).toBe(true);
  }
});

test.skipIf(!linux)("Dado uma instalação já feita, Quando instalo de novo, Então os arquivos de shell não mudam e o bloco não duplica", async () => {
  const c = await novo();
  await writeFile(join(c.home, ".bashrc"), "# bashrc\n");
  expect(c.rodar().codigo).toBe(0);
  const antes = { profile: await readFile(join(c.home, ".profile"), "utf8"), bashrc: await readFile(join(c.home, ".bashrc"), "utf8") };
  const r = c.rodar();
  expect(r.codigo, r.tudo).toBe(0);
  expect(await readFile(join(c.home, ".profile"), "utf8")).toBe(antes.profile);
  expect(await readFile(join(c.home, ".bashrc"), "utf8")).toBe(antes.bashrc);
  expect(ocorrencias(antes.profile, INICIO)).toBe(1);
  expect(ocorrencias(antes.bashrc, INICIO)).toBe(1);
});

test.skipIf(!linux)("Dado o Bun baixado pelo instalador, Quando abro um terminal novo (env -i, PATH do sistema), Então o comando bun e o rg são achados", async () => {
  const c = await novo({ comBun: false });
  const r = c.rodar();
  expect(r.codigo, r.tudo).toBe(0);
  expect([join(c.home, ".bun/bin/bun"), join(c.home, ".local/bin/bun")]).toContain(terminalNovo(c.home, "command -v bun"));
  expect(terminalNovo(c.home, "command -v rg")).toBe(join(c.home, ".local/bin/rg"));
});

test.skipIf(!linux)("Dado um HOME em que o PATH já tem ~/.local/bin, Quando abro um terminal novo, Então a pasta não aparece duas vezes", async () => {
  const c = await novo({ comBun: false });
  expect(c.rodar().codigo).toBe(0);
  const p = terminalNovo(c.home, "printf %s \"$PATH\"");
  const pasta = join(c.home, ".local/bin");
  expect(p.split(":").filter(x => x === pasta)).toHaveLength(1);
  const dentro = Bun.spawnSync(["env", "-i", `HOME=${c.home}`, `PATH=${pasta}:/usr/bin:/bin`, "bash", "-lc", "printf %s \"$PATH\""], { stdout: "pipe" }).stdout.toString();
  expect(dentro.split(":").filter(x => x === pasta)).toHaveLength(1);
});

test.skipIf(!linux)("Dado o instalador concluído, Quando leio o resumo, Então ele diz em linguagem simples que um terminal novo já acha o comando", async () => {
  const c = await novo();
  const r = c.rodar();
  expect(r.codigo, r.tudo).toBe(0);
  expect(r.saida).toContain("Um terminal novo já acha o comando");
  expect(r.saida).toContain("~/.profile");
});

test.skipIf(!linux || process.getuid?.() === 0)("Dado um ~/.profile que não aceita escrita, Quando instalo, Então avisa em linguagem simples e a instalação termina", async () => {
  const c = await novo();
  await writeFile(join(c.home, ".profile"), "# somente leitura\n");
  await chmod(join(c.home, ".profile"), 0o444);
  const r = c.rodar();
  expect(r.codigo, r.tudo).toBe(0);
  expect(r.tudo).toContain("não consegui acrescentar");
  expect(await readFile(join(c.home, ".profile"), "utf8")).toBe("# somente leitura\n");
});

test.skipIf(!linux || !Bun.which("zsh"))("Dado um ~/.zshrc existente, Quando abro um zsh novo (env -i, PATH do sistema), Então o comando bun é achado", async () => {
  const c = await novo({ comBun: false });
  await writeFile(join(c.home, ".zshrc"), "# zshrc\n");
  expect(c.rodar().codigo).toBe(0);
  expect([join(c.home, ".bun/bin/bun"), join(c.home, ".local/bin/bun")]).toContain(terminalNovo(c.home, "command -v bun", "zsh"));
});

test.skipIf(!linux)("Dado um bloco PATH truncado no ~/.profile, Quando reinstalo, Então substitui o trecho parcial, preserva o prefixo e não duplica depois", async () => {
  const c = await novo();
  expect(c.rodar().codigo).toBe(0);
  const profile = join(c.home, ".profile");
  const prefixo = "# configuração pessoal\nexport EDITOR=vim\n";
  await writeFile(profile, `${prefixo}${INICIO}\n# bloco truncado\ncase \":$PATH:\" in`);
  const r = c.rodar();
  expect(r.codigo, r.tudo).toBe(0);
  const reparado = await readFile(profile, "utf8");
  expect(reparado.startsWith(prefixo)).toBe(true);
  expect(reparado.slice(prefixo.length)).toContain(INICIO);
  expect(reparado.slice(prefixo.length)).toContain(FIM);
  expect(reparado).not.toContain("# bloco truncado");
  expect(ocorrencias(reparado, INICIO)).toBe(1);
  expect(ocorrencias(reparado, FIM)).toBe(1);
  expect(c.rodar().codigo).toBe(0);
  expect(await readFile(profile, "utf8")).toBe(reparado);
});

test.skipIf(!linux)("Dado um arquivo de shell com permissões próprias, Quando persisto o PATH, Então preservo as permissões", async () => {
  const c = await novo();
  const profile = join(c.home, ".profile");
  await writeFile(profile, "# pessoal\n");
  await chmod(profile, 0o640);
  const r = c.rodar();
  expect(r.codigo, r.tudo).toBe(0);
  expect((await stat(profile)).mode & 0o777).toBe(0o640);
});

test.skipIf(!linux)("Dado ~/.profile como symlink, Quando persisto o PATH, Então recuso sem alterar o alvo e aviso", async () => {
  const c = await novo();
  const alvo = join(c.pai, "dotfiles-profile");
  const profile = join(c.home, ".profile");
  await writeFile(alvo, "# dotfile compartilhado\n");
  await symlink(alvo, profile);
  const r = c.rodar();
  expect(r.codigo, r.tudo).toBe(0);
  expect(r.tudo).toContain("symlink");
  expect(await readFile(alvo, "utf8")).toBe("# dotfile compartilhado\n");
  expect((await lstat(profile)).isSymbolicLink()).toBe(true);
});
