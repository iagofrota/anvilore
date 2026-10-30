import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { comandoEmbutir, conferirEmbutidos, embutirInstalador, lerEmbutidos, validarUrlConfianca } from "../scripts/embutir-instalador";
import { URL_CONFIANCA } from "../src/lib/confianca";
import { criarChave } from "./apoio/kit-atualizavel";

// Estado das chaves fora do GitHub: a URL da lista é constante de build, embutida na região URL_CONFIANCA dos
// instaladores. O embutir só aceita https (ou loopback http, com a flag explícita de teste).

const raiz = resolve(import.meta.dir, "..");
const pastas: string[] = [];
afterAll(async () => { await Promise.all(pastas.map(p => rm(p, { recursive: true, force: true }))); });
async function pastaNova() { const p = await mkdtemp(join(tmpdir(), "anvilore-embutir-url-")); pastas.push(p); return p; }
const manifesto = () => readFile(join(raiz, "instalador/dependencias.json"), "utf8");
const MODELO_SH = "# >>> ANVILORE:MANIFESTO\nmanifesto_embutido() {\n  :\n}\n# <<< ANVILORE:MANIFESTO\n# >>> ANVILORE:ASSINANTES\nassinantes_embutidas() {\n  :\n}\n# <<< ANVILORE:ASSINANTES\n# >>> ANVILORE:URL_CONFIANCA\nurl_confianca_embutida() {\n  :\n}\n# <<< ANVILORE:URL_CONFIANCA\n";
const MODELO_PS1 = "# >>> ANVILORE:MANIFESTO\n$script:AnvManifestoEmbutido = @'\n'@\n# <<< ANVILORE:MANIFESTO\n# >>> ANVILORE:ASSINANTES\n$script:AnvAssinantesEmbutido = @'\n'@\n# <<< ANVILORE:ASSINANTES\n# >>> ANVILORE:URL_CONFIANCA\n$script:AnvUrlConfiancaEmbutida = @'\n'@\n# <<< ANVILORE:URL_CONFIANCA\n";
const LOOPBACK = "http://127.0.0.1:8123/confianca.json";
const assinantes = async () => (await criarChave(await pastaNova())).assinantes;

test("Dado a URL fixa e um modelo com a região, Quando embuto (sh e ps1), Então a URL entra na região e a leitura devolve a mesma", async () => {
  const a = await assinantes(), j = await manifesto();
  for (const [dialeto, modelo] of [["sh", MODELO_SH], ["ps1", MODELO_PS1]] as const) {
    const pronto = embutirInstalador(modelo, j, a, dialeto, { urlConfianca: URL_CONFIANCA });
    expect(lerEmbutidos(pronto, dialeto).urlConfianca).toBe(`${URL_CONFIANCA}\n`);
    expect(conferirEmbutidos(pronto, j, a, dialeto, { urlConfianca: URL_CONFIANCA })).toEqual([]);
    expect(embutirInstalador(pronto, j, a, dialeto, { urlConfianca: URL_CONFIANCA })).toBe(pronto);
  }
  expect(embutirInstalador(MODELO_SH, j, a, "sh", { urlConfianca: URL_CONFIANCA })).toContain(`cat <<'ANVILORE_FIM_URL_CONFIANCA'\n${URL_CONFIANCA}\nANVILORE_FIM_URL_CONFIANCA`);
  expect(embutirInstalador(MODELO_PS1, j, a, "ps1", { urlConfianca: URL_CONFIANCA })).toContain(`$script:AnvUrlConfiancaEmbutida = @'\n${URL_CONFIANCA}\n'@`);
});

test("Dado URL http fora de loopback, Quando embuto ou confiro, Então recusa (mesmo com a flag de teste)", async () => {
  const a = await assinantes(), j = await manifesto();
  for (const url of ["http://anvilore.iagofrota.com.br/confianca.json", "http://localhost:8123/confianca.json", "http://127.0.0.2/x.json", "http://10.0.0.5/x.json", "ftp://anvilore.iagofrota.com.br/x", "file:///etc/passwd"]) {
    for (const urlDeTeste of [false, true]) {
      expect(() => embutirInstalador(MODELO_SH, j, a, "sh", { urlConfianca: url, urlDeTeste })).toThrow(/https|loopback/);
      expect(validarUrlConfianca(url, urlDeTeste)).toBeDefined();
    }
  }
});

test("Dado loopback http://127.0.0.1, Quando embuto sem a flag, Então recusa; com a flag de teste, aceita", async () => {
  const a = await assinantes(), j = await manifesto();
  expect(() => embutirInstalador(MODELO_SH, j, a, "sh", { urlConfianca: LOOPBACK })).toThrow("https");
  const pronto = embutirInstalador(MODELO_SH, j, a, "sh", { urlConfianca: LOOPBACK, urlDeTeste: true });
  expect(lerEmbutidos(pronto).urlConfianca).toBe(`${LOOPBACK}\n`);
  expect(conferirEmbutidos(pronto, j, a, "sh", { urlConfianca: LOOPBACK })[0]).toContain("https");
  expect(conferirEmbutidos(pronto, j, a, "sh", { urlConfianca: LOOPBACK, urlDeTeste: true })).toEqual([]);
});

test("Dado URL malformada (aspas, espaço, usuário, consulta, fragmento, https sem host), Quando valido, Então recusa", () => {
  for (const url of ["", "https://", "https://exemplo.com/a b", "https://exemplo.com/a\"b", "https://u:s@exemplo.com/x", "https://exemplo.com/x?a=1", "https://exemplo.com/x#y", "https://exemplo.com/x\n", "exemplo.com/x", "https://exemplo.com/'@"]) {
    expect([url, validarUrlConfianca(url, true) !== undefined]).toEqual([url, true]);
  }
  expect(validarUrlConfianca(URL_CONFIANCA, false)).toBeUndefined();
  expect(validarUrlConfianca(LOOPBACK, true)).toBeUndefined();
});

test("Dado instalador com URL embutida diferente da esperada ou ausente, Quando confiro, Então aponta", async () => {
  const a = await assinantes(), j = await manifesto();
  const pronto = embutirInstalador(MODELO_SH, j, a, "sh", { urlConfianca: URL_CONFIANCA });
  expect(conferirEmbutidos(pronto, j, a, "sh", { urlConfianca: "https://outro.exemplo.com/confianca.json" }).join("\n")).toContain("URL de confiança embutida difere");
  expect(conferirEmbutidos(MODELO_SH, j, a, "sh", { urlConfianca: URL_CONFIANCA }).join("\n")).toContain("URL de confiança embutida difere");
  // O instalador que traz http fora de loopback já embutido (por edição à mão) é recusado na conferência.
  const adulterado = pronto.replace(URL_CONFIANCA, "http://anvilore.iagofrota.com.br/confianca.json");
  expect(conferirEmbutidos(adulterado, j, a, "sh", { urlConfianca: "http://anvilore.iagofrota.com.br/confianca.json" }).join("\n")).toContain("https");
});

test("Dado um modelo sem a marca URL_CONFIANCA, Quando peço para embutir a URL, Então recusa em vez de seguir sem a consulta", async () => {
  const a = await assinantes(), j = await manifesto();
  const semMarca = MODELO_SH.replace(/# >>> ANVILORE:URL_CONFIANCA[\s\S]*$/, "");
  expect(() => embutirInstalador(semMarca, j, a, "sh", { urlConfianca: URL_CONFIANCA })).toThrow("URL_CONFIANCA");
});

test("Dado a linha de comando, Quando gero e confiro com URL de teste, Então só passa com --aceitar-url-de-teste; sem a opção usa a URL fixa", async () => {
  const pasta = await pastaNova();
  const modelo = join(pasta, "modelo.sh"), arq = join(pasta, "assinantes"), saida = join(pasta, "instalar.sh");
  await writeFile(modelo, MODELO_SH); await writeFile(arq, await assinantes());
  const rodar = (...args: string[]) => Bun.spawnSync([process.execPath, join(raiz, "scripts/embutir-instalador.ts"), ...args], { stdout: "pipe", stderr: "pipe" });
  expect(rodar("--modelo", modelo, "--assinantes", arq, "--saida", saida).exitCode).toBe(0);
  expect(lerEmbutidos(await readFile(saida, "utf8")).urlConfianca).toBe(`${URL_CONFIANCA}\n`);
  expect(rodar("--conferir", saida, "--assinantes", arq).exitCode).toBe(0);
  const semFlag = rodar("--modelo", modelo, "--assinantes", arq, "--saida", saida, "--url-confianca", LOOPBACK);
  expect(semFlag.exitCode).toBe(1);
  expect(semFlag.stderr.toString()).toContain("https");
  expect(rodar("--modelo", modelo, "--assinantes", arq, "--saida", saida, "--url-confianca", LOOPBACK, "--aceitar-url-de-teste").exitCode).toBe(0);
  expect(rodar("--conferir", saida, "--assinantes", arq, "--url-confianca", LOOPBACK).exitCode).toBe(1);
  expect(rodar("--conferir", saida, "--assinantes", arq, "--url-confianca", LOOPBACK, "--aceitar-url-de-teste").exitCode).toBe(0);
  // a variável de ambiente não muda a URL embutida
  const comAmbiente = Bun.spawnSync([process.execPath, join(raiz, "scripts/embutir-instalador.ts"), "--modelo", modelo, "--assinantes", arq, "--saida", saida], { stdout: "pipe", stderr: "pipe", env: { ...process.env, ANVILORE_URL_CONFIANCA: LOOPBACK, URL_CONFIANCA: LOOPBACK } });
  expect(comAmbiente.exitCode).toBe(0);
  expect(lerEmbutidos(await readFile(saida, "utf8")).urlConfianca).toBe(`${URL_CONFIANCA}\n`);
  expect(await comandoEmbutir(["--que-nao-existe"])).toBe(2);
});
