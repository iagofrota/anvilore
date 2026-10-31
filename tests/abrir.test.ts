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
  expect(ps1).not.toMatch(/\-File\b/);
});

test("Dado o atalho Linux, Quando leio a criação, Então é uma entrada Anvilore que abre Terminal e chama o lançador", async () => {
  const instalador = await readFile(join(raiz, "instalador/instalar.sh"), "utf8");
  const funcao = /criar_atalho\(\) \{[\s\S]*?\n\}/.exec(instalador)?.[0] ?? "";
  expect(funcao).toContain("anvilore.desktop");
  expect(funcao).toContain("Terminal=true");
  expect(funcao).toContain("anvilore-abrir");
  expect(funcao).not.toContain("ponto de chamada ainda vazio");
});

test("Dado o instalador Windows, Quando cria o atalho, Então aponta os .lnk ao abrir.ps1", async () => {
  const instalador = await readFile(join(raiz, "instalador/instalar.ps1"), "utf8");
  const funcao = /function AnvCriarAtalho \{[\s\S]*?\n\}/.exec(instalador)?.[0] ?? "";
  expect(funcao).toContain("WScript.Shell");
  expect(funcao).toContain("CreateShortcut");
  expect(funcao).toContain("abrir.ps1");
  expect(funcao).not.toContain("ponto de chamada ainda vazio");
});

test("Dado uma pasta instalada e Bun falso, Quando abro no Linux e a UI falha, Então executo o CLI, mostro o erro e aguardo Enter", async () => {
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
    expect(saida).toMatch(/Enter|fechar/i);
    expect(await readFile(chamadas, "utf8")).toContain("src/cli.ts ui");
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("Dado a UI sem descoberta de servidor existente, Quando o segundo clique é solicitado, Então o limite fica documentado", async () => {
  const docs = await readFile(join(raiz, "docs/knowledge_base/plataformas.md"), "utf8");
  expect(docs).toMatch(/segundo clique|outra instância|outra instancia/i);
});
