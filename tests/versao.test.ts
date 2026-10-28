import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { comandoVersao, versaoDoKit } from "../src/comandos/versao";
import { executar } from "../src/cli";
import { capturarConsole } from "./apoio/console";

const raiz = resolve(import.meta.dir, "..");
let tmp: string;
let console_: ReturnType<typeof capturarConsole>;

function git(dir: string, ...args: string[]): string {
  const p = Bun.spawnSync(["git", "-C", dir, "-c", "user.name=Teste", "-c", "user.email=t@e", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args], { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(p.stderr.toString());
  return p.stdout.toString().trim();
}

function kit(versao = "9.8.7"): string {
  const dir = join(tmp, "kit"); mkdirSync(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "anvilore", version: versao }));
  return dir;
}

beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "anvilore-versao-")); console_ = capturarConsole(); });
afterEach(() => { console_.restaurar(); rmSync(tmp, { recursive: true, force: true }); });

test("Dado um kit sem git, Quando pergunto a versão, Então vem só a do package.json", async () => {
  expect(await versaoDoKit(kit())).toEqual({ versao: "9.8.7" });
});

test("Dado um kit com commit fora de tag, Quando pergunto a versão, Então vem a versão e o commit curto", async () => {
  const dir = kit();
  git(dir, "init", "-q"); git(dir, "add", "."); git(dir, "commit", "-qm", "c");
  const commit = git(dir, "rev-parse", "--short", "HEAD");
  expect(await versaoDoKit(dir)).toEqual({ versao: "9.8.7", commit });
});

test("Dado um kit exatamente numa tag, Quando pergunto a versão, Então vem a tag e o commit", async () => {
  const dir = kit();
  git(dir, "init", "-q"); git(dir, "add", "."); git(dir, "commit", "-qm", "c"); git(dir, "tag", "v9.8.7");
  const commit = git(dir, "rev-parse", "--short", "HEAD");
  expect(await versaoDoKit(dir)).toEqual({ versao: "9.8.7", tag: "v9.8.7", commit });
});

test("Dado um kit copiado para dentro de outro repositório, Quando pergunto a versão, Então não usa o git de fora", async () => {
  git(tmp, "init", "-q"); writeFileSync(join(tmp, "x"), "x"); git(tmp, "add", "x"); git(tmp, "commit", "-qm", "fora");
  expect(await versaoDoKit(kit())).toEqual({ versao: "9.8.7" });
});

test("Dado um package.json sem versão, Quando pergunto a versão, Então reprova dizendo por quê", async () => {
  const dir = join(tmp, "ruim"); mkdirSync(dir); writeFileSync(join(dir, "package.json"), "{}");
  await expect(versaoDoKit(dir)).rejects.toThrow("versão");
});

test("Dado o próprio kit, Quando rodo `anvilore versao`, Então imprime a versão do package.json e sai 0", async () => {
  const { version } = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8"));
  expect(await executar(["versao"])).toBe(0);
  expect(console_.saida.join("\n")).toMatch(new RegExp(`^anvilore ${version.replaceAll(".", "\\.")}( \\(.*\\))?$`));
});

test("Dado ajuda ou argumento estranho, Quando rodo versao, Então ajuda sai 0 e argumento sai 2", async () => {
  expect(await comandoVersao(["--help"])).toBe(0);
  expect(console_.saida.join("\n")).toContain("Uso: anvilore versao");
  expect(await comandoVersao(["extra"])).toBe(2);
  expect(console_.erros.join("\n")).toContain("Uso: anvilore versao");
});

test("Dado um kit com tag e commit, Quando formato a linha, Então mostra os dois entre parênteses", async () => {
  const { formatarVersao } = await import("../src/comandos/versao");
  expect(formatarVersao({ versao: "1.0.0" })).toBe("anvilore 1.0.0");
  expect(formatarVersao({ versao: "1.0.0", commit: "abc1234" })).toBe("anvilore 1.0.0 (commit abc1234)");
  expect(formatarVersao({ versao: "1.0.0", tag: "v1.0.0", commit: "abc1234" })).toBe("anvilore 1.0.0 (tag v1.0.0, commit abc1234)");
});
