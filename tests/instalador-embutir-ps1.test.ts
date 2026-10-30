import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { comandoEmbutir, conferirEmbutidos, dialetoDe, embutirInstalador, lerEmbutidos } from "../scripts/embutir-instalador";
import { criarChave } from "./apoio/kit-atualizavel";

// PLANO §2 passo 4 e cenário 36 para o instalar.ps1: o build da release embute o manifesto e a chave pública no script do
// Windows com o mesmo mecanismo do instalar.sh, só que a região é um here-string do PowerShell.

const BASE = "0.3.0\n";
const raiz = resolve(import.meta.dir, "..");
const pastas: string[] = [];
afterAll(async () => { await Promise.all(pastas.map(p => rm(p, { recursive: true, force: true }))); });
async function assinantesDescartaveis(): Promise<string> {
  const pasta = await mkdtemp(join(tmpdir(), "anvilore-embutir-ps1-"));
  pastas.push(pasta);
  return (await criarChave(pasta)).assinantes;
}
const modelo = () => readFile(join(raiz, "instalador/instalar.ps1"), "utf8");
const manifesto = () => readFile(join(raiz, "instalador/dependencias.json"), "utf8");

test("Dado um arquivo .ps1 ou .sh, Quando pergunto o dialeto, Então a extensão decide", () => {
  expect(dialetoDe("dist/instalar.ps1")).toBe("ps1");
  expect(dialetoDe("INSTALAR.PS1")).toBe("ps1");
  expect(dialetoDe("instalar.sh")).toBe("sh");
});

test("Dado o modelo do instalar.ps1 do repositório, Quando leio o que ele embute, Então não traz manifesto nem chave", async () => {
  expect(lerEmbutidos(await modelo(), "ps1")).toEqual({ manifesto: "", assinantes: "", baseMinima: "" });
});

test("Dado o modelo do instalar.ps1, Quando embuto manifesto e chave, Então a cópia embutida é igual aos arquivos (cenário 36)", async () => {
  const assinantes = await assinantesDescartaveis();
  const pronto = embutirInstalador(await modelo(), await manifesto(), assinantes, BASE, "ps1");
  expect(lerEmbutidos(pronto, "ps1")).toEqual({ manifesto: await manifesto(), assinantes, baseMinima: BASE });
  expect(conferirEmbutidos(pronto, await manifesto(), assinantes, BASE, "ps1")).toEqual([]);
  expect(pronto).toContain("$script:AnvManifestoEmbutido = @'\n{");
});

test("Dado um script já embutido, Quando embuto de novo, Então é idempotente e o resto do script não muda", async () => {
  const assinantes = await assinantesDescartaveis();
  const uma = embutirInstalador(await modelo(), await manifesto(), assinantes, BASE, "ps1");
  expect(embutirInstalador(uma, await manifesto(), assinantes, BASE, "ps1")).toBe(uma);
  const semRegioes = (t: string) => t.replace(/# >>> ANVILORE:(\w+)[\s\S]*?# <<< ANVILORE:\1\n/g, "");
  expect(semRegioes(uma)).toBe(semRegioes(await modelo()));
});

test("Dado manifesto diferente do embutido, Quando confiro, Então aponta a diferença", async () => {
  const assinantes = await assinantesDescartaveis();
  const pronto = embutirInstalador(await modelo(), await manifesto(), assinantes, BASE, "ps1");
  expect(conferirEmbutidos(pronto, (await manifesto()).replace("15.2.0", "15.2.1"), assinantes, BASE, "ps1").join("\n")).toContain("manifesto embutido difere");
  expect(conferirEmbutidos(pronto, await manifesto(), "outra\n", BASE, "ps1").join("\n")).toContain("chave embutida difere");
});

test("Dado conteúdo com CRLF ou sem chave, Quando embuto, Então recusa", async () => {
  const assinantes = await assinantesDescartaveis();
  const m = await modelo(), real = await manifesto();
  const json = JSON.stringify({ formato: 1, dependencias: {} });
  expect(() => embutirInstalador(m, `${json}\r\n`, assinantes, BASE, "ps1")).toThrow("retorno de carro");
  expect(() => embutirInstalador(m, real, "", BASE, "ps1")).toThrow("assinantes vazio");
});

test("Dado a linha de comando com --modelo .ps1, Quando gero e confiro, Então o arquivo gerado é o instalar.ps1 embutido", async () => {
  const pasta = await mkdtemp(join(tmpdir(), "anvilore-embutir-ps1-"));
  pastas.push(pasta);
  const assinantes = join(pasta, "assinantes");
  await Bun.write(assinantes, await assinantesDescartaveis());
  const saida = join(pasta, "instalar.ps1");
  expect(await comandoEmbutir(["--modelo", join(raiz, "instalador/instalar.ps1"), "--assinantes", assinantes, "--saida", saida])).toBe(0);
  expect(await comandoEmbutir(["--conferir", saida, "--assinantes", assinantes])).toBe(0);
  expect(await readFile(saida, "utf8")).toContain("ssh-");
});
