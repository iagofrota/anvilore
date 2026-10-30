import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { comandoEmbutir, conferirEmbutidos, embutirInstalador, lerEmbutidos, validarAssinantes } from "../scripts/embutir-instalador";
import { capturarConsole } from "./apoio/console";
import { criarChave } from "./apoio/kit-atualizavel";

// PLANO §2 passo 4 e cenário 36: o build da release embute o manifesto e a chave pública no instalar.sh, e um teste
// confere que a cópia embutida é igual ao arquivo. A U5 só chama este mecanismo.

const raiz = resolve(import.meta.dir, "..");
const pastas: string[] = [];
afterAll(async () => { await Promise.all(pastas.map(p => rm(p, { recursive: true, force: true }))); });
async function assinantesDescartaveis(): Promise<string> {
  const pasta = await mkdtemp(join(tmpdir(), "anvilore-embutir-"));
  pastas.push(pasta);
  return (await criarChave(pasta)).assinantes;
}
const BASE = "0.3.0\n";
const MODELO_MINIMO = "# >>> ANVILORE:MANIFESTO\nmanifesto_embutido() {\n  :\n}\n# <<< ANVILORE:MANIFESTO\n# >>> ANVILORE:ASSINANTES\nassinantes_embutidas() {\n  :\n}\n# <<< ANVILORE:ASSINANTES\n# >>> ANVILORE:BASE_MINIMA\nbase_minima_embutida() {\n  :\n}\n# <<< ANVILORE:BASE_MINIMA\n";
const modelo = () => readFile(join(raiz, "instalador/instalar.sh"), "utf8");
const manifesto = () => readFile(join(raiz, "instalador/dependencias.json"), "utf8");

test("Dado o modelo do instalar.sh, Quando embuto manifesto e chave, Então a cópia embutida é igual aos arquivos", async () => {
  const assinantes = await assinantesDescartaveis();
  const pronto = embutirInstalador(await modelo(), await manifesto(), assinantes, BASE);
  const embutidos = lerEmbutidos(pronto);
  expect(embutidos.manifesto).toBe(await manifesto());
  expect(embutidos.assinantes).toBe(assinantes);
  expect(conferirEmbutidos(pronto, await manifesto(), assinantes, BASE)).toEqual([]);
});

test("Dado o modelo do repositório, Quando leio o que ele embute, Então não traz manifesto nem chave (nada que pareça confiança)", async () => {
  expect(lerEmbutidos(await modelo())).toEqual({ manifesto: "", assinantes: "", baseMinima: "" });
});

test("Dado um script já embutido, Quando embuto de novo, Então o resultado é o mesmo (idempotente) e o resto do script não muda", async () => {
  const assinantes = await assinantesDescartaveis();
  const uma = embutirInstalador(await modelo(), await manifesto(), assinantes, BASE);
  expect(embutirInstalador(uma, await manifesto(), assinantes, BASE)).toBe(uma);
  const semRegioes = (t: string) => t.replace(/# >>> ANVILORE:(\w+)[\s\S]*?# <<< ANVILORE:\1\n/g, "");
  expect(semRegioes(uma)).toBe(semRegioes(await modelo()));
  expect(semRegioes(uma).length).toBeLessThan(uma.length);
});

test("Dado um manifesto diferente do embutido, Quando confiro, Então aponta a diferença", async () => {
  const assinantes = await assinantesDescartaveis();
  const pronto = embutirInstalador(await modelo(), await manifesto(), assinantes, BASE);
  const outro = (await manifesto()).replace("15.2.0", "15.2.1");
  expect(conferirEmbutidos(pronto, outro, assinantes, BASE).join("\n")).toContain("manifesto embutido difere");
  expect(conferirEmbutidos(pronto, await manifesto(), "outra chave\n", BASE).join("\n")).toContain("chave embutida difere");
  expect(conferirEmbutidos(await modelo(), await manifesto(), assinantes, BASE).join("\n")).toContain("manifesto embutido difere");
});

test("Dado chave ausente, vazia ou que não é de assinar tags, Quando embuto, Então recusa em vez de embutir placeholder", async () => {
  const m = await modelo(), j = await manifesto();
  expect(() => embutirInstalador(m, j, "", BASE)).toThrow("assinantes vazio");
  expect(() => embutirInstalador(m, j, "# só comentário\n", BASE)).toThrow("assinantes vazio");
  expect(() => embutirInstalador(m, j, "iago namespaces=\"file\" ssh-ed25519 AAAAC3Nza\n", BASE)).toThrow("namespaces=\"git\"");
  expect(() => embutirInstalador(m, j, "iago namespaces=\"git\" ssh-ed25519\n", BASE)).toThrow("linha 1");
  expect(() => embutirInstalador(m, j, "iago namespaces=\"git\" ssh-ed25519 AAAA\nlixo\n", BASE)).toThrow("linha 2");
  expect(validarAssinantes("iago namespaces=\"git\" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPlaceholder iago@x\n")).toBeUndefined();
});

test("Dado manifesto que não é JSON ou de outro formato, Quando embuto, Então recusa", async () => {
  const assinantes = await assinantesDescartaveis();
  expect(() => embutirInstalador("modelo", "{", assinantes, BASE)).toThrow("manifesto");
  expect(() => embutirInstalador("modelo", JSON.stringify({ formato: 2, dependencias: {} }), assinantes, BASE)).toThrow("formato");
});

test("Dado um modelo sem as marcas ou chave com a linha que fecha o heredoc, Quando embuto, Então recusa", async () => {
  const assinantes = await assinantesDescartaveis(), j = await manifesto();
  expect(() => embutirInstalador("#!/usr/bin/env bash\n", j, assinantes, BASE)).toThrow("marca");
  expect(() => embutirInstalador(MODELO_MINIMO, j, "a namespaces=\"git\" ssh-ed25519 AAAA\nANVILORE_FIM_ASSINANTES\n", BASE)).toThrow("linha 2");
  expect(embutirInstalador(MODELO_MINIMO, j, assinantes, BASE)).toContain("ANVILORE_FIM_ASSINANTES");
});

test("Dado a linha de comando, Quando gero e confiro o instalar.sh, Então grava o arquivo e sai 0; arquivo adulterado sai 1", async () => {
  const pasta = await mkdtemp(join(tmpdir(), "anvilore-embutir-"));
  pastas.push(pasta);
  const assinantes = join(pasta, "assinantes");
  await writeFile(assinantes, await assinantesDescartaveis());
  const saida = join(pasta, "instalar.sh");
  const rodar = (...args: string[]) => Bun.spawnSync([process.execPath, join(raiz, "scripts/embutir-instalador.ts"), ...args], { stdout: "pipe", stderr: "pipe" });
  const gerar = rodar("--assinantes", assinantes, "--saida", saida);
  expect(gerar.exitCode).toBe(0);
  expect(rodar("--conferir", saida, "--assinantes", assinantes).exitCode).toBe(0);
  await writeFile(saida, (await readFile(saida, "utf8")).replace("15.2.0", "15.2.9"));
  const ruim = rodar("--conferir", saida, "--assinantes", assinantes);
  expect(ruim.exitCode).toBe(1);
  expect(ruim.stderr.toString()).toContain("manifesto embutido difere");
  // Sem seguranca/assinantes (a chave real ainda não existe): não há o que embutir.
  const semChave = rodar("--assinantes", join(pasta, "nao-existe"), "--saida", join(pasta, "x.sh"));
  expect(semChave.exitCode).toBe(1);
  expect(semChave.stderr.toString()).toContain("assinantes");
  expect(rodar("--lixo").exitCode).toBe(2);
});

test("Dado a função da linha de comando, Quando gero, confiro e peço ajuda, Então devolve os códigos e as mensagens combinados", async () => {
  const pasta = await mkdtemp(join(tmpdir(), "anvilore-embutir-"));
  pastas.push(pasta);
  const assinantes = join(pasta, "assinantes"), saida = join(pasta, "dist", "instalar.sh");
  await writeFile(assinantes, await assinantesDescartaveis());
  const c = capturarConsole();
  try {
    expect(await comandoEmbutir(["--help"])).toBe(0);
    expect(c.saida.join("\n")).toContain("Uso: bun scripts/embutir-instalador.ts");
    expect(await comandoEmbutir(["--assinantes", assinantes, "--saida", saida])).toBe(0);
    expect(await readFile(saida, "utf8")).toContain("cat <<'ANVILORE_FIM_ASSINANTES'");
    expect(await comandoEmbutir(["--conferir", saida, "--assinantes", assinantes])).toBe(0);
    expect(c.saida.join("\n")).toContain("embutidos conferem");
    expect(await comandoEmbutir(["--conferir", join(pasta, "nao-existe.sh"), "--assinantes", assinantes])).toBe(1);
    expect(c.erros.join("\n")).toContain("instalar.sh: não consegui ler");
    await writeFile(assinantes, "lixo\n");
    expect(await comandoEmbutir(["--conferir", saida, "--assinantes", assinantes])).toBe(1);
    expect(await comandoEmbutir(["--assinantes", assinantes, "--saida", saida])).toBe(1);
    expect(await comandoEmbutir(["--modelo", join(pasta, "sem-modelo.sh"), "--assinantes", assinantes])).toBe(1);
    expect(await comandoEmbutir(["--que-nao-existe"])).toBe(2);
  } finally { c.restaurar(); }
});
