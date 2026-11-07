import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raiz = join(import.meta.dir, "..");
const shell = await readFile(join(raiz, "instalador/anvilore-abrir"), "utf8").catch(() => "");
const ps1 = await readFile(join(raiz, "instalador/abrir.ps1"), "utf8").catch(() => "");

async function criarCenarioAtualizacaoPacote(opcoes: { versaoPacote?: string; jsonInstalado?: string; codigoAtualizador?: number; pularAtualizacao?: boolean }) {
  const base = await mkdtemp(join(tmpdir(), "anvilore-atualiza-pacote-"));
  const home = join(base, "home");
  const pasta = join(home, "Anvilore");
  const pacote = join(base, "usr/lib/anvilore");
  const bin = join(base, "bin");
  const atualizador = join(base, "atualizador-chamado");
  const versaoRecebida = join(base, "versao-recebida");
  const ui = join(base, "ui-chamada");
  await mkdir(join(pasta, ".git"), { recursive: true });
  await mkdir(join(pasta, "src"), { recursive: true });
  await mkdir(join(pasta, "skills"), { recursive: true });
  await mkdir(pacote, { recursive: true });
  await mkdir(bin, { recursive: true });
  await writeFile(join(pasta, "AGENTS.md"), "");
  await writeFile(join(pasta, "src/cli.ts"), "");
  await writeFile(join(pasta, "package.json"), opcoes.jsonInstalado ?? JSON.stringify({ version: "0.9.0" }, null, 2));
  const lancador = join(pacote, "anvilore-abrir");
  await writeFile(lancador, shell);
  await chmod(lancador, 0o755);
  if (opcoes.versaoPacote !== undefined) await writeFile(join(pacote, "VERSAO"), `${opcoes.versaoPacote}\n`);
  await writeFile(join(pacote, "instalar.sh"), [
    "#!/bin/sh",
    'printf chamado >"$ANV_TEST_ATUALIZADOR"',
    'printf \'%s\' "${ANVILORE_VERSAO:-}" >"$ANV_TEST_VERSAO_RECEBIDA"',
    'if [ "${ANV_TEST_CODIGO_ATUALIZADOR:-0}" -eq 0 ] && [ "${ANV_TEST_PULAR_ATUALIZACAO:-0}" != 1 ]; then sed "s/0[.]9[.]0/${ANV_TEST_VERSAO_PACOTE}/" "$ANVILORE_PASTA/package.json" >"$ANVILORE_PASTA/package.json.tmp"; mv "$ANVILORE_PASTA/package.json.tmp" "$ANVILORE_PASTA/package.json"; fi',
    'exit "${ANV_TEST_CODIGO_ATUALIZADOR:-0}"',
  ].join("\n"));
  const bun = join(bin, "bun");
  await writeFile(bun, `#!/bin/sh\nprintf '%s\\n' "$*" >>"$ANV_TEST_UI"\n`);
  await chmod(bun, 0o755);
  const env = {
    ...process.env,
    HOME: home,
    XDG_STATE_HOME: join(home, ".local/state"),
    XDG_CONFIG_HOME: join(home, ".config"),
    PATH: `${bin}:/usr/bin:/bin`,
    ANVILORE_PASTA: pasta,
    ANV_TEST_ATUALIZADOR: atualizador,
    ANV_TEST_VERSAO_RECEBIDA: versaoRecebida,
    ANV_TEST_CODIGO_ATUALIZADOR: String(opcoes.codigoAtualizador ?? 0),
    ANV_TEST_PULAR_ATUALIZACAO: opcoes.pularAtualizacao ? "1" : "0",
    ANV_TEST_VERSAO_PACOTE: opcoes.versaoPacote ?? "",
    ANV_TEST_UI: ui,
  };
  const executar = () => Bun.spawnSync(["bash", lancador], { cwd: base, env, stdout: "pipe", stderr: "pipe" });
  return { base, pasta, atualizador, versaoRecebida, ui, executar };
}

test("Dado o pacote 0.10.0 e a pasta 0.9.0, Quando abro o atalho do pacote, Então atualizo numericamente antes de abrir a UI", async () => {
  if (process.platform !== "linux") return;
  const c = await criarCenarioAtualizacaoPacote({ versaoPacote: "0.10.0" });
  try {
    const proc = c.executar();
    const saida = proc.stdout.toString() + proc.stderr.toString();
    expect(proc.exitCode, saida).toBe(0);
    expect(saida).toContain("Atualizando o Anvilore de 0.9.0 para 0.10.0");
    expect(await Bun.file(c.atualizador).exists()).toBe(true);
    expect(await readFile(c.versaoRecebida, "utf8")).toBe("0.10.0");
    expect(JSON.parse(await readFile(join(c.pasta, "package.json"), "utf8")).version).toBe("0.10.0");
    expect(await readFile(c.ui, "utf8")).toContain("src/cli.ts ui");
  } finally { await rm(c.base, { recursive: true, force: true }); }
});

test("Dado a pasta na mesma versão do pacote, Quando abro, Então não executo o instalador", async () => {
  if (process.platform !== "linux") return;
  const c = await criarCenarioAtualizacaoPacote({ versaoPacote: "0.9.0" });
  try {
    const proc = c.executar();
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);
    expect(await Bun.file(c.atualizador).exists()).toBe(false);
    expect(await readFile(c.ui, "utf8")).toContain("src/cli.ts ui");
  } finally { await rm(c.base, { recursive: true, force: true }); }
});

test("Dado a pasta mais nova que o pacote, Quando abro, Então não rebaixo nem executo o instalador", async () => {
  if (process.platform !== "linux") return;
  const c = await criarCenarioAtualizacaoPacote({ versaoPacote: "0.8.9", jsonInstalado: "{\n  \"version\": \"0.9.0\"\n}" });
  try {
    const proc = c.executar();
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);
    expect(await Bun.file(c.atualizador).exists()).toBe(false);
    expect(JSON.parse(await readFile(join(c.pasta, "package.json"), "utf8")).version).toBe("0.9.0");
    expect(await readFile(c.ui, "utf8")).toContain("src/cli.ts ui");
  } finally { await rm(c.base, { recursive: true, force: true }); }
});

test("Dado que o instalador do pacote falha, Quando abro, Então aviso e abro a versão já instalada", async () => {
  if (process.platform !== "linux") return;
  const c = await criarCenarioAtualizacaoPacote({ versaoPacote: "0.10.0", codigoAtualizador: 7 });
  try {
    const proc = c.executar();
    const saida = proc.stdout.toString() + proc.stderr.toString();
    expect(proc.exitCode, saida).toBe(0);
    expect(saida).toContain("Não consegui atualizar o Anvilore de 0.9.0 para 0.10.0");
    expect(JSON.parse(await readFile(join(c.pasta, "package.json"), "utf8")).version).toBe("0.9.0");
    expect(await readFile(c.ui, "utf8")).toContain("src/cli.ts ui");
  } finally { await rm(c.base, { recursive: true, force: true }); }
});

test("Dado que o instalador não atualiza mas retorna zero, Quando abro, Então aviso e uso o kit existente", async () => {
  if (process.platform !== "linux") return;
  const c = await criarCenarioAtualizacaoPacote({ versaoPacote: "0.10.0", pularAtualizacao: true });
  try {
    const proc = c.executar();
    const saida = proc.stdout.toString() + proc.stderr.toString();
    expect(proc.exitCode, saida).toBe(0);
    expect(saida).toContain("Não consegui atualizar o Anvilore de 0.9.0 para 0.10.0");
    expect(JSON.parse(await readFile(join(c.pasta, "package.json"), "utf8")).version).toBe("0.9.0");
    expect(await readFile(c.ui, "utf8")).toContain("src/cli.ts ui");
  } finally { await rm(c.base, { recursive: true, force: true }); }
});

test("Dado que a atualização do pacote falha, Quando clico de novo no lançador, Então não repito a tentativa de atualização e abro direto a versão existente", async () => {
  if (process.platform !== "linux") return;
  const c = await criarCenarioAtualizacaoPacote({ versaoPacote: "0.10.0", codigoAtualizador: 7 });
  try {
    const proc1 = c.executar();
    const saida1 = proc1.stdout.toString() + proc1.stderr.toString();
    expect(proc1.exitCode, saida1).toBe(0);
    expect(saida1).toContain("Atualizando o Anvilore de 0.9.0 para 0.10.0");
    expect(saida1).toContain("Não consegui atualizar o Anvilore de 0.9.0 para 0.10.0");
    expect(await Bun.file(c.atualizador).exists()).toBe(true);

    // Remove o marcador de chamada do atualizador para testar se é chamado de novo
    await rm(c.atualizador, { force: true });

    // Segundo clique: não deve chamar o atualizador nem exibir mensagem de atualização
    const proc2 = c.executar();
    const saida2 = proc2.stdout.toString() + proc2.stderr.toString();
    expect(proc2.exitCode, saida2).toBe(0);
    expect(await Bun.file(c.atualizador).exists()).toBe(false);
    expect(saida2).not.toContain("Atualizando o Anvilore de 0.9.0 para 0.10.0");
    expect(saida2).not.toContain("Não consegui atualizar");
    expect(await readFile(c.ui, "utf8")).toContain("src/cli.ts ui");

    // Novo pacote (versão muda para 0.10.1): deve tentar de novo
    await writeFile(join(c.base, "usr/lib/anvilore/VERSAO"), "0.10.1\n");
    const proc3 = c.executar();
    const saida3 = proc3.stdout.toString() + proc3.stderr.toString();
    expect(proc3.exitCode, saida3).toBe(0);
    expect(saida3).toContain("Atualizando o Anvilore de 0.9.0 para 0.10.1");
    expect(await Bun.file(c.atualizador).exists()).toBe(true);
  } finally { await rm(c.base, { recursive: true, force: true }); }
});

test("Dado o instalador real em pasta existente e ANVILORE_VERSAO definida, Quando executa passo_atualizar_existente, Então repassa --versao ao comando atualizar", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-instalar-versao-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const chamadasCli = join(base, "cli-chamadas.log");
    const script = join(raiz, "instalador/instalar.sh");
    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "package.json"), JSON.stringify({ version: "0.9.0" }, null, 2));
    await writeFile(join(pasta, "src/cli.ts"), `
import { appendFileSync } from "node:fs";
appendFileSync(process.env.CHAMADAS_CLI!, process.argv.slice(2).join(" ") + "\\n");
if (process.argv[2] === "atualizar") {
  console.log("atualizado com sucesso");
  process.exit(0);
}
process.exit(0);
`);
    const comando = `
      ANVILORE_INSTALAR_CARREGAR=1
      source "$1"
      conferir_estado_das_chaves() { :; }
      dizer() { :; }
      avisar() { :; }
      falhar() { printf '%s\\n' "$1" >&2; exit 1; }
      CONFIANCA_MINIMA="0.0.0"
      TMP_DIR="$2"
      mkdir -p "$TMP_DIR"
      touch "$TMP_DIR/assinantes"
      PASTA="$3"
      ANVILORE_VERSAO="v0.10.0"
      passo_atualizar_existente
    `;
    const proc = Bun.spawnSync(["bash", "-c", comando, "_", script, join(base, "tmp"), pasta], {
      env: { ...process.env, HOME: home, PATH: process.env.PATH, CHAMADAS_CLI: chamadasCli },
      stdout: "pipe", stderr: "pipe",
    });
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);
    const chamadas = await readFile(chamadasCli, "utf8");
    expect(chamadas).toContain("atualizar");
    expect(chamadas).toContain("--assinantes-do-instalador");
    expect(chamadas).toContain("--versao 0.10.0");
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("Dado que o lançador não tem metadado VERSAO, Quando abro, Então não tento atualizar a pasta", async () => {
  if (process.platform !== "linux") return;
  const c = await criarCenarioAtualizacaoPacote({});
  try {
    const proc = c.executar();
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);
    expect(await Bun.file(c.atualizador).exists()).toBe(false);
    expect(await readFile(c.ui, "utf8")).toContain("src/cli.ts ui");
  } finally { await rm(c.base, { recursive: true, force: true }); }
});

test("Dado que a versão instalada é ilegível, Quando abro, Então não atualizo nem deixo de abrir a UI", async () => {
  if (process.platform !== "linux") return;
  const c = await criarCenarioAtualizacaoPacote({ versaoPacote: "0.10.0", jsonInstalado: "{quebrado" });
  try {
    const proc = c.executar();
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);
    expect(await Bun.file(c.atualizador).exists()).toBe(false);
    expect(await readFile(c.ui, "utf8")).toContain("src/cli.ts ui");
  } finally { await rm(c.base, { recursive: true, force: true }); }
});

test("Dado a distribuição, Quando procuro os lançadores, Então há um shell Linux e um PowerShell UTF-8", () => {
  expect(shell).toMatch(/^#!\/usr\/bin\/env bash/);
  expect(ps1).toContain("Get-Content -Raw");
  expect(ps1).toContain("Encoding UTF8");
});

test("Dado o lançador PowerShell, Quando abre o instalador, Então avalia scriptblock lido como texto e nunca usa -File", () => {
  expect(ps1).toMatch(/\[scriptblock\]::Create\(\(Get-Content -Raw -Encoding UTF8/);
  expect(ps1.split("\n").filter(l => !l.trimStart().startsWith("#")).join("\n")).not.toMatch(/\-File\b/);
});

test("Dado o lançador PowerShell, Quando prepara a UI, Então usa USERPROFILE, PortableGit e UTF-8 compatível com CLM", () => {
  expect(ps1).toContain("$env:USERPROFILE");
  expect(ps1).toContain("Anvilore\\git\\cmd");
  expect(ps1).toContain("Join-Path $env:APPDATA 'npm'");
  expect(ps1).toContain("AnvAbrirConfigurarUtf8");
  expect(ps1).toContain("chcp.com 65001");
  expect(ps1).toContain("Get-Command bun");
  expect(ps1).not.toContain("[Console]::Error.WriteLine");
  expect(ps1).toMatch(/\[scriptblock\]::Create[\s\S]*?\$null = AnvAbrirConfigurarUtf8/);
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
      env: { ...process.env, HOME: home, ANVILORE_SYSTEM_APPLICATIONS_DIR: join(base, "applications-system") }, stdout: "pipe", stderr: "pipe",
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
    } else {
      console.warn("SKIP: desktop-file-validate não está instalado; o .desktop não foi validado.");
    }
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("Dado o lançador do pacote por symlink, Quando instalo pela primeira vez, Então encontro instalar.sh ao lado do destino", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-symlink-pacote-"));
  try {
    const home = join(base, "perfil");
    const biblioteca = join(base, "usr/lib/anvilore");
    const bin = join(base, "usr/bin");
    const fakeBin = join(base, "fake-bin");
    const destino = join(biblioteca, "anvilore-abrir");
    const link = join(bin, "anvilore-abrir");
    const pasta = join(home, "Anvilore");
    const chamadas = join(base, "chamadas");
    await mkdir(home, { recursive: true });
    await mkdir(biblioteca, { recursive: true });
    await mkdir(bin, { recursive: true });
    await mkdir(fakeBin, { recursive: true });
    await writeFile(destino, shell);
    await chmod(destino, 0o755);
    await symlink(destino, link);
    await writeFile(join(biblioteca, "instalar.sh"), [
      "#!/usr/bin/env bash",
      'mkdir -p "$ANVILORE_PASTA/.git" "$ANVILORE_PASTA/src" "$ANVILORE_PASTA/skills"',
      'touch "$ANVILORE_PASTA/AGENTS.md" "$ANVILORE_PASTA/src/cli.ts"',
    ].join("\n"));
    const bun = join(fakeBin, "bun");
    await writeFile(bun, `#!/bin/sh\nprintf '%s\\n' "$*" >>"$ANVILORE_TEST_CHAMADAS"\n`);
    await chmod(bun, 0o755);
    const proc = Bun.spawnSync(["bash", link], {
      cwd: base,
      env: { ...process.env, HOME: home, ANVILORE_PASTA: pasta, ANVILORE_TEST_CHAMADAS: chamadas, PATH: `${fakeBin}:/usr/bin:/bin` },
      stdout: "pipe", stderr: "pipe",
    });
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);
    expect(await readFile(chamadas, "utf8")).toContain("src/cli.ts ui");
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("Dado que o pacote já tem .desktop de sistema, Quando crio_atalho, Então não deixo uma cópia de usuário órfã", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-atalho-pacote-"));
  try {
    const home = join(base, "perfil");
    const pasta = join(home, "Anvilore");
    const sistema = join(base, "applications-sistema");
    const registro = join(base, "registro");
    await mkdir(join(pasta, "instalador"), { recursive: true });
    await mkdir(sistema, { recursive: true });
    await writeFile(join(pasta, "instalador/anvilore-abrir"), shell);
    await writeFile(join(pasta, "instalador/abrir.ps1"), ps1);
    await writeFile(join(pasta, "instalador/anvilore.svg"), await readFile(join(raiz, "instalador/anvilore.svg"), "utf8"));
    await writeFile(join(sistema, "anvilore.desktop"), "[Desktop Entry]\nName=Anvilore\n");
    const script = join(raiz, "instalador/instalar.sh");
    const comando = `ANVILORE_INSTALAR_CARREGAR=1; source "$1"; registrar() { printf '%s\\n' "$*" >>"$ANVILORE_TEST_REGISTRO"; }; criar_atalho "$2"`;
    const proc = Bun.spawnSync(["bash", "-c", comando, "_", script, pasta], {
      env: { ...process.env, HOME: home, ANVILORE_SYSTEM_APPLICATIONS_DIR: sistema, ANVILORE_TEST_REGISTRO: registro },
      stdout: "pipe", stderr: "pipe",
    });
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);
    expect(await readFile(registro, "utf8")).toMatch(/entrada de sistema.*não criei cópias do usuário/);
    expect(await Bun.file(join(home, ".local/share/applications/anvilore.desktop")).exists()).toBe(false);
    expect(await Bun.file(join(home, ".local/bin/anvilore-abrir")).exists()).toBe(false);
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

test("Dado Bun em nvm fora do PATH e uma shell de login, Quando abro no Linux, Então encontro o executável sem executar conteúdo do kit", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-bun-login-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const bin = join(home, ".nvm/versions/node/v24.15.0/bin");
    const chamadas = join(base, "chamadas");
    const login = join(base, "login-shell");
    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(bin, { recursive: true });
    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    const bun = join(bin, "bun");
    await writeFile(bun, `#!/bin/sh\nprintf '%s\\n' "$*" >>"$ANVILORE_TEST_CHAMADAS"\n`);
    await chmod(bun, 0o755);
    await writeFile(login, `#!/bin/sh\nif [ "$1" = "-lic" ]; then printf '%s\\n' "$ANVILORE_TEST_BUN"; else exec /bin/bash "$@"; fi\n`);
    await chmod(login, 0o755);
    const proc = Bun.spawnSync(["bash", join(raiz, "instalador/anvilore-abrir")], {
      cwd: base,
      env: { ...process.env, HOME: home, NVM_DIR: join(home, ".nvm"), PATH: "/usr/bin:/bin", SHELL: login, ANVILORE_PASTA: pasta, ANVILORE_TEST_BUN: bun, ANVILORE_TEST_CHAMADAS: chamadas },
      stdout: "pipe", stderr: "pipe",
    });
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);
    expect(await readFile(chamadas, "utf8")).toContain("src/cli.ts ui");
  } finally { await rm(base, { recursive: true, force: true }); }
}, 15_000);

test("Dado o caminho do Bun registrado pelo instalador, Quando abro sem PATH e sem ~/.bun, Então uso o registro antes da shell de login", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-bun-registro-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const config = join(home, ".config/anvilore");
    const bin = join(home, ".nvm/versions/node/v24.15.0/bin");
    const chamadas = join(base, "chamadas");
    const loginChamadas = join(base, "login-chamadas");
    const login = join(base, "login-shell");
    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(config, { recursive: true });
    await mkdir(bin, { recursive: true });
    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    const bun = join(bin, "bun");
    await writeFile(bun, `#!/bin/sh\nprintf '%s\\n' "$*" >>"$ANVILORE_TEST_CHAMADAS"\n`);
    await chmod(bun, 0o755);
    await writeFile(join(config, "bun-path"), `${bun}\n`);
    await writeFile(login, `#!/bin/sh\nprintf '%s\\n' "$*" >>"$ANVILORE_TEST_LOGIN"\n`);
    await chmod(login, 0o755);
    const proc = Bun.spawnSync(["bash", join(raiz, "instalador/anvilore-abrir")], {
      cwd: base,
      env: { ...process.env, HOME: home, NVM_DIR: join(home, ".nvm"), XDG_CONFIG_HOME: join(home, ".config"), PATH: "/usr/bin:/bin", SHELL: login, ANVILORE_PASTA: pasta, ANVILORE_TEST_CHAMADAS: chamadas, ANVILORE_TEST_LOGIN: loginChamadas },
      stdout: "pipe", stderr: "pipe",
    });
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);
    expect(await readFile(chamadas, "utf8")).toContain("src/cli.ts ui");
    expect(await Bun.file(loginChamadas).exists()).toBe(false);
  } finally { await rm(base, { recursive: true, force: true }); }
}, 15_000);

test("Dado Bun em ~/.bun e outro caminho registrado, Quando abro sem Bun no PATH, Então priorizo ~/.bun", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-bun-dotbun-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const config = join(home, ".config/anvilore");
    const bunLocal = join(home, ".bun/bin/bun");
    const bunRegistrado = join(home, ".nvm/versions/node/v24.15.0/bin/bun");
    const chamadas = join(base, "chamadas");
    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(config, { recursive: true });
    await mkdir(join(home, ".bun/bin"), { recursive: true });
    await mkdir(join(home, ".nvm/versions/node/v24.15.0/bin"), { recursive: true });
    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    await writeFile(bunLocal, `#!/bin/sh\nprintf 'bun-local\\n' >>"$ANVILORE_TEST_CHAMADAS"\n`);
    await writeFile(bunRegistrado, `#!/bin/sh\nprintf 'registrado\\n' >>"$ANVILORE_TEST_CHAMADAS"\n`);
    await chmod(bunLocal, 0o755);
    await chmod(bunRegistrado, 0o755);
    await writeFile(join(config, "bun-path"), `${bunRegistrado}\n`);
    const proc = Bun.spawnSync(["bash", join(raiz, "instalador/anvilore-abrir")], {
      cwd: base,
      env: { ...process.env, HOME: home, NVM_DIR: join(home, ".nvm"), XDG_CONFIG_HOME: join(home, ".config"), PATH: "/usr/bin:/bin", ANVILORE_PASTA: pasta, ANVILORE_TEST_CHAMADAS: chamadas },
      stdout: "pipe", stderr: "pipe",
    });
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);
    expect(await readFile(chamadas, "utf8")).toContain("bun-local");
    expect(await readFile(chamadas, "utf8")).not.toContain("registrado");
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("Dado Bun só em ~/.local/bin e PATH sem ele, Quando abro no Linux, Então preservo a busca pelo PATH local do lançador", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-bun-localbin-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const bin = join(home, ".local/bin");
    const chamadas = join(base, "chamadas");
    const login = join(base, "login-shell");
    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(bin, { recursive: true });
    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    const bun = join(bin, "bun");
    await writeFile(bun, `#!/bin/sh\nprintf '%s\\n' "$*" >>"$ANVILORE_TEST_CHAMADAS"\n`);
    await chmod(bun, 0o755);
    await writeFile(login, "#!/bin/sh\nexit 1\n");
    await chmod(login, 0o755);
    const proc = Bun.spawnSync(["bash", join(raiz, "instalador/anvilore-abrir")], {
      cwd: base,
      env: { ...process.env, HOME: home, PATH: "/usr/bin:/bin", SHELL: login, ANVILORE_PASTA: pasta, ANVILORE_TEST_CHAMADAS: chamadas },
      stdout: "pipe", stderr: "pipe",
    });
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);
    expect(await readFile(chamadas, "utf8")).toContain("src/cli.ts ui");
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("Dado Bun só em nvm e SHELL que dorme 5 s, Quando abro no Linux com PATH de menu, Então acho o Bun do nvm sem estourar timeout e registro o caminho", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-bun-nvm-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const bin = join(home, ".nvm/versions/node/v24.15.0/bin");
    const chamadas = join(base, "chamadas");
    const shellLenta = join(base, "shell-lenta");
    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(bin, { recursive: true });
    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    const bun = join(bin, "bun");
    await writeFile(bun, `#!/bin/sh\nprintf '%s\\n' "$*" >>"$ANVILORE_TEST_CHAMADAS"\n`);
    await chmod(bun, 0o755);
    await writeFile(shellLenta, `#!/bin/sh\nsleep 5\nprintf '%s\\n' "$ANVILORE_TEST_BUN"\n`);
    await chmod(shellLenta, 0o755);
    const proc = Bun.spawnSync(["bash", join(raiz, "instalador/anvilore-abrir")], {
      cwd: base,
      env: {
        ...process.env,
        HOME: home,
        NVM_DIR: join(home, ".nvm"),
        XDG_CONFIG_HOME: join(home, ".config"),
        PATH: "/usr/bin:/bin",
        SHELL: shellLenta,
        ANVILORE_PASTA: pasta,
        ANVILORE_TEST_BUN: bun,
        ANVILORE_TEST_CHAMADAS: chamadas,
      },
      stdout: "pipe", stderr: "pipe",
    });
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);
    expect(await readFile(chamadas, "utf8")).toContain("src/cli.ts ui");
    const registro = join(home, ".config/anvilore/bun-path");
    expect(await readFile(registro, "utf8")).toBe(`${bun}\n`);
    expect((await stat(registro)).mode & 0o777).toBe(0o600);
  } finally { await rm(base, { recursive: true, force: true }); }
}, 15_000);

test("Dado múltiplos nós no nvm, Quando há alias/default válido, Então prefiro o default; senão a maior versão", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-bun-nvm-multi-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const nvmDir = join(home, ".nvm");
    const v18 = join(nvmDir, "versions/node/v18.20.0/bin");
    const v20 = join(nvmDir, "versions/node/v20.10.0/bin");
    const v24 = join(nvmDir, "versions/node/v24.15.0/bin");
    const chamadas = join(base, "chamadas");
    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(v18, { recursive: true });
    await mkdir(v20, { recursive: true });
    await mkdir(v24, { recursive: true });
    await mkdir(join(nvmDir, "alias"), { recursive: true });
    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");

    await writeFile(join(v18, "bun"), `#!/bin/sh\nprintf 'v18\\n' >>"$ANVILORE_TEST_CHAMADAS"\n`);
    await writeFile(join(v20, "bun"), `#!/bin/sh\nprintf 'v20\\n' >>"$ANVILORE_TEST_CHAMADAS"\n`);
    await writeFile(join(v24, "bun"), `#!/bin/sh\nprintf 'v24\\n' >>"$ANVILORE_TEST_CHAMADAS"\n`);
    await chmod(join(v18, "bun"), 0o755);
    await chmod(join(v20, "bun"), 0o755);
    await chmod(join(v24, "bun"), 0o755);

    // Cenário 1: alias/default aponta para v20.10.0
    await writeFile(join(nvmDir, "alias/default"), "v20.10.0\n");
    let proc = Bun.spawnSync(["bash", join(raiz, "instalador/anvilore-abrir")], {
      cwd: base,
      env: { ...process.env, HOME: home, NVM_DIR: nvmDir, XDG_CONFIG_HOME: join(home, ".config"), PATH: "/usr/bin:/bin", ANVILORE_PASTA: pasta, ANVILORE_TEST_CHAMADAS: chamadas },
      stdout: "pipe", stderr: "pipe",
    });
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);
    expect(await readFile(chamadas, "utf8")).toContain("v20");

    // Remove registro para testar fallback para a maior versão
    await rm(join(home, ".config/anvilore/bun-path"), { force: true });
    await rm(join(nvmDir, "alias/default"), { force: true });
    await rm(chamadas, { force: true });

    // Cenário 2: sem alias/default, escolhe a maior versão (v24.15.0)
    proc = Bun.spawnSync(["bash", join(raiz, "instalador/anvilore-abrir")], {
      cwd: base,
      env: { ...process.env, HOME: home, NVM_DIR: nvmDir, XDG_CONFIG_HOME: join(home, ".config"), PATH: "/usr/bin:/bin", ANVILORE_PASTA: pasta, ANVILORE_TEST_CHAMADAS: chamadas },
      stdout: "pipe", stderr: "pipe",
    });
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);
    expect(await readFile(chamadas, "utf8")).toContain("v24");
  } finally { await rm(base, { recursive: true, force: true }); }
}, 15_000);

test("Dado Bun fora do nvm e achado pela shell de login em 4 s, Quando abro, Então não estouro timeout de 10 s e gravo bun-path", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-bun-shell-grava-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const bin = join(base, "custom-node/bin");
    const chamadas = join(base, "chamadas");
    const login = join(base, "login-shell");
    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(bin, { recursive: true });
    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    const bun = join(bin, "bun");
    await writeFile(bun, `#!/bin/sh\nprintf '%s\\n' "$*" >>"$ANVILORE_TEST_CHAMADAS"\n`);
    await chmod(bun, 0o755);
    await writeFile(login, `#!/bin/sh\nif [ "$1" = "-lic" ]; then sleep 4; printf '%s\\n' "$ANVILORE_TEST_BUN"; else exec /bin/bash "$@"; fi\n`);
    await chmod(login, 0o755);
    const proc = Bun.spawnSync(["bash", join(raiz, "instalador/anvilore-abrir")], {
      cwd: base,
      env: { ...process.env, HOME: home, NVM_DIR: join(home, ".nvm"), XDG_CONFIG_HOME: join(home, ".config"), PATH: "/usr/bin:/bin", SHELL: login, ANVILORE_PASTA: pasta, ANVILORE_TEST_BUN: bun, ANVILORE_TEST_CHAMADAS: chamadas },
      stdout: "pipe", stderr: "pipe",
    });
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);
    expect(await readFile(chamadas, "utf8")).toContain("src/cli.ts ui");
    const registro = join(home, ".config/anvilore/bun-path");
    expect(await readFile(registro, "utf8")).toBe(`${bun}\n`);
    expect((await stat(registro)).mode & 0o777).toBe(0o600);
  } finally { await rm(base, { recursive: true, force: true }); }
}, 15_000);

test("Dado o instalador com Bun em nvm, Quando registra o caminho para o lançador, Então grava em configuração do usuário com permissão privada", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-registra-bun-"));
  try {
    const home = join(base, "home");
    const bun = join(home, ".nvm/versions/node/v24.15.0/bin/bun");
    await mkdir(join(home, ".nvm/versions/node/v24.15.0/bin"), { recursive: true });
    await writeFile(bun, "#!/bin/sh\nexit 0\n");
    await chmod(bun, 0o755);
    const proc = Bun.spawnSync(["bash", "-c", 'ANVILORE_INSTALAR_CARREGAR=1; source "$1"; registrar_bun_para_lancador "$2"', "_", join(raiz, "instalador/instalar.sh"), bun], {
      env: { ...process.env, HOME: home, NVM_DIR: join(home, ".nvm"), XDG_CONFIG_HOME: join(home, ".config") },
      stdout: "pipe", stderr: "pipe",
    });
    const registro = join(home, ".config/anvilore/bun-path");
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);
    expect(await readFile(registro, "utf8")).toBe(`${bun}\n`);
    expect((await stat(registro)).mode & 0o777).toBe(0o600);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("Dado que não há Bun nos locais conhecidos nem na shell de login, Quando abro, Então explico como instalar e não saio com 127", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-sem-bun-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const login = join(base, "login-shell");
    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    await writeFile(login, "#!/bin/sh\nexit 1\n");
    await chmod(login, 0o755);
    const proc = Bun.spawnSync(["bash", join(raiz, "instalador/anvilore-abrir")], {
      cwd: base,
      env: { ...process.env, HOME: home, PATH: "/usr/bin:/bin", SHELL: login, ANVILORE_PASTA: pasta },
      stdout: "pipe", stderr: "pipe",
    });
    const saida = proc.stdout.toString() + proc.stderr.toString();
    expect(proc.exitCode).toBe(2);
    expect(saida).toContain("Bun não encontrado");
    expect(saida).toContain("npm install -g bun");
    expect(saida).not.toContain("command not found");
  } finally { await rm(base, { recursive: true, force: true }); }
});

test.skipIf(process.platform !== "linux" || !Bun.which("script") || existsSync("/usr/lib/anvilore/instalar.sh"))("Dado que o Anvilore não está instalado e não há instalador, Quando abro no Linux em terminal, Então leio o erro antes de pressionar Enter", async () => {
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
      env: { ...process.env, HOME: home, ANVILORE_PASTA: pasta, ANVILORE_PACKAGE_DIR: join(base, "sem-pacote") },
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
