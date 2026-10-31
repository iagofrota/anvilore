import { expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raiz = join(import.meta.dir, "..");
const shell = await readFile(join(raiz, "instalador/anvilore-abrir"), "utf8").catch(() => "");
const ps1 = await readFile(join(raiz, "instalador/abrir.ps1"), "utf8").catch(() => "");

test("Dado a distribuição, Quando procuro os lançadores, Então há um shell Linux e um PowerShell UTF-8", () => {
  expect(shell).toMatch(/^#!\/usr\/bin\/env bash/);
  expect(ps1).toContain("Get-Content -Raw");
  expect(ps1).toContain("Encoding UTF8");
});

test("Dado o lançador PowerShell, Quando abre o instalador, Então avalia scriptblock lido como texto e nunca usa -File", () => {
  expect(ps1).toMatch(/\[scriptblock\]::Create\(\(Get-Content -Raw -Encoding UTF8/);
  expect(ps1.split("\n").filter(l => !l.trimStart().startsWith("#")).join("\n")).not.toMatch(/\-File\b/);
});

test("Dado o atalho Linux, Quando leio a criação, Então é uma entrada Anvilore que abre Terminal e chama o lançador", async () => {
  const instalador = await readFile(join(raiz, "instalador/instalar.sh"), "utf8");
  const funcao = /criar_atalho\(\) \{[\s\S]*?\n\}/.exec(instalador)?.[0] ?? "";
  expect(funcao).toContain("anvilore.desktop");
  expect(funcao).toContain("Terminal=true");
  expect(funcao).toContain("anvilore-abrir");
  expect(funcao).not.toContain("ponto de chamada ainda vazio");
});

test("Dado um HOME descartável, Quando executo criar_atalho, Então gravo o .desktop e o lançador por usuário", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-atalho-"));
  try {
    const home = join(base, "perfil 100% com espaço");
    await mkdir(home);
    const script = join(raiz, "instalador/instalar.sh");
    const pasta = join(home, 'Anvilore pasta $literal `crase` "aspas" \\barra');
    await mkdir(join(pasta, "instalador"), { recursive: true });
    await writeFile(join(pasta, "instalador/anvilore-abrir"), shell);
    await writeFile(join(pasta, "instalador/abrir.ps1"), ps1);
    await writeFile(join(pasta, "instalador/anvilore.svg"), await readFile(join(raiz, "instalador/anvilore.svg"), "utf8"));
    const comando = `ANVILORE_INSTALAR_CARREGAR=1; source "$1"; registrar() { :; }; criar_atalho "$2"`;
    const proc = Bun.spawnSync(["bash", "-c", comando, "_", script, pasta], {
      env: { ...process.env, HOME: home }, stdout: "pipe", stderr: "pipe",
    });
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);
    const desktop = join(home, ".local/share/applications/anvilore.desktop");
    const texto = await readFile(desktop, "utf8");
    expect(texto).toContain("Name=Anvilore");
    expect(texto).toContain("Terminal=true");
    expect(texto).toContain('Exec=env ANVILORE_PASTA="');
    expect(texto).toContain("100%%");
    const pastaEscapada = pasta.replace(/[\\"`$]/g, "\\$&").replaceAll("\\", "\\\\").replaceAll("%", "%%");
    expect(texto).toContain(`ANVILORE_PASTA="${pastaEscapada}"`);
    expect(await readFile(join(home, ".local/bin/anvilore-abrir"), "utf8")).toBe(shell);
    expect(await readFile(join(home, ".local/share/icons/hicolor/scalable/apps/anvilore.svg"), "utf8")).toContain("<svg");
    if (Bun.which("desktop-file-validate")) {
      const validacao = Bun.spawnSync(["desktop-file-validate", desktop], { stdout: "pipe", stderr: "pipe" });
      expect(validacao.exitCode, validacao.stderr.toString()).toBe(0);
    }
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("Dado o instalador Windows, Quando cria o atalho, Então aponta os .lnk ao abrir.ps1", async () => {
  const instalador = await readFile(join(raiz, "instalador/instalar.ps1"), "utf8");
  const funcao = /function AnvCriarAtalho \{[\s\S]*?\n\}/.exec(instalador)?.[0] ?? "";
  expect(funcao).toContain("WScript.Shell");
  expect(funcao).toContain("CreateShortcut");
  expect(funcao).toContain("abrir.ps1");
  expect(funcao).not.toContain("ponto de chamada ainda vazio");
});

test("Dado o instalador Windows, Quando está em Constrained Language Mode, Então deixa a criação para o Inno Setup", async () => {
  const instalador = await readFile(join(raiz, "instalador/instalar.ps1"), "utf8");
  const funcao = /function AnvCriarAtalho \{[\s\S]*?\n\}/.exec(instalador)?.[0] ?? "";
  expect(funcao).toMatch(/LanguageMode -eq 'ConstrainedLanguage'[\s\S]*?return \$false/);
});

test("Dado que as pastas conhecidas do Windows estão vazias, Quando crio atalhos, Então uso APPDATA e USERPROFILE como fallback", async () => {
  const instalador = await readFile(join(raiz, "instalador/instalar.ps1"), "utf8");
  const funcao = /function AnvCriarAtalho \{[\s\S]*?\n\}/.exec(instalador)?.[0] ?? "";
  expect(funcao).toMatch(/GetFolderPath\('Programs'\)[\s\S]*?AnvVariavel 'APPDATA'/);
  expect(funcao).toMatch(/GetFolderPath\('DesktopDirectory'\)[\s\S]*?AnvVariavel 'USERPROFILE'/);
});

test("Dado uma pasta instalada e Bun falso, Quando abro no Linux e a UI falha sem TTY, Então executo o CLI e mostro o erro", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-abrir-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const bin = join(base, "bin");
    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(bin);
    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    const chamadas = join(base, "chamadas");
    const bun = join(bin, "bun");
    await writeFile(bun, `#!/bin/sh\nprintf '%s\\n' "$*" >>"$ANVILORE_TEST_CHAMADAS"\necho 'falha da interface' >&2\nexit 7\n`);
    await chmod(bun, 0o755);
    const proc = Bun.spawnSync(["bash", join(raiz, "instalador/anvilore-abrir")], {
      cwd: base,
      env: { ...process.env, HOME: home, PATH: `${bin}:/usr/bin:/bin`, ANVILORE_PASTA: pasta, ANVILORE_TEST_CHAMADAS: chamadas },
      stdin: new TextEncoder().encode("\n"), stdout: "pipe", stderr: "pipe",
    });
    const saida = proc.stdout.toString() + proc.stderr.toString();
    expect(proc.exitCode).toBe(7);
    expect(saida).toContain("falha da interface");
    expect(saida).toContain("A interface do Anvilore fechou com erro (código 7)");
    expect(shell).toMatch(/Pressione Enter para fechar esta janela/);
    expect(shell).toContain("if [ -t 0 ]");
    expect(await readFile(chamadas, "utf8")).toContain("src/cli.ts ui");
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("Dado que o Anvilore não está instalado e não há instalador, Quando abro no Linux em terminal, Então leio o erro antes de pressionar Enter", async () => {
  if (process.platform !== "linux" || !Bun.which("script")) return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-sem-instalador-"));
  try {
    const home = join(base, "home");
    const kit = join(base, "kit");
    const pasta = join(base, "Anvilore ausente");
    await mkdir(home);
    await mkdir(kit);
    const lancador = join(kit, "anvilore-abrir");
    await writeFile(lancador, shell);
    const proc = Bun.spawnSync(["script", "-q", "-e", "-c", `bash '${lancador}'`, "/dev/null"], {
      env: { ...process.env, HOME: home, ANVILORE_PASTA: pasta },
      stdin: new TextEncoder().encode("\n"), stdout: "pipe", stderr: "pipe",
    });
    const saida = proc.stdout.toString() + proc.stderr.toString();
    expect(proc.exitCode).toBe(1);
    expect(saida).toContain("O Anvilore ainda não está instalado");
    expect(saida).toContain("Pressione Enter para fechar esta janela.");
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("Dado a UI sem descoberta de servidor existente, Quando o segundo clique é solicitado, Então o limite fica documentado", async () => {
  const docs = await readFile(join(raiz, "docs/knowledge_base/plataformas.md"), "utf8");
  expect(docs).toMatch(/segundo clique|outra instância|outra instancia/i);
});
