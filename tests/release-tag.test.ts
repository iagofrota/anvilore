import { afterEach, expect, test } from "bun:test";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { criarChave, criarKit, respostaDaLista } from "./apoio/kit-atualizavel";
import type { Kit } from "./apoio/kit-atualizavel";
import { verificarTagRelease } from "../scripts/verificar-tag-release";
import { embutirInstalador } from "../scripts/embutir-instalador";

let kit: Kit;
afterEach(async () => { await kit?.limpar(); });
async function preparar() {
  kit = await criarKit([{ versao: "0.3.0" }, { versao: "0.3.1" }]);
  kit.ok(["checkout", "--detach", "v0.3.1"]);
  await mkdir(join(kit.raiz, "instalador/assinaturas"), { recursive: true });
  for (const nome of ["instalar.sh", "instalar.ps1", "dependencias.json", "base-minima"]) {
    await cp(resolve(import.meta.dir, "../instalador", nome), join(kit.raiz, "instalador", nome));
  }
  const manifesto = await readFile(join(kit.raiz, "instalador/dependencias.json"), "utf8");
  const assinantes = await readFile(join(kit.raiz, "seguranca/assinantes"), "utf8");
  const base = await readFile(join(kit.raiz, "instalador/base-minima"), "utf8");
  for (const dialeto of ["sh", "ps1"] as const) {
    const nome = `instalar.${dialeto}`, arquivo = join(kit.pai, nome);
    await writeFile(arquivo, embutirInstalador(await readFile(join(kit.raiz, "instalador", nome), "utf8"), manifesto, assinantes, base, dialeto));
    const p = Bun.spawnSync(["ssh-keygen", "-Y", "sign", "-n", "file", "-f", kit.chave, arquivo], { stdout: "pipe", stderr: "pipe" });
    if (p.exitCode) throw new Error("Falha ao assinar instalador descartável");
    await cp(`${arquivo}.sig`, join(kit.raiz, "instalador/assinaturas", `${nome}.sig`));
  }
  gravarCandidata();
}
function gravarCandidata() {
  kit.ok(["add", "instalador"]); kit.ok(["commit", "-qm", "artefatos públicos offline"]);
  assinarCandidata();
}
function assinarCandidata() {
  kit.ok(["tag", "-d", "v0.3.1"]);
  kit.ok(["-c", "gpg.format=ssh", "-c", `user.signingkey=${kit.chave}`, "tag", "-s", "v0.3.1", "-m", "candidata descartável"]);
  kit.commits["0.3.1"] = kit.head();
}
const buscar = async () => respostaDaLista({ formato: 1, chaves: [kit.fingerprint], versaoMinima: "0.3.0" });

test("Dado tag SSH da chave anterior, Quando verifico a release, Então obtenho o commit e a versão autenticados", async () => {
  await preparar();
  expect(await verificarTagRelease(kit.raiz, "v0.3.1", "v0.3.0", buscar)).toEqual({ versao: "0.3.1", commit: kit.commits["0.3.1"]! });
});
test("Dado tag leve, Quando verifico a release, Então recuso", async () => {
  await preparar(); kit.ok(["tag", "-d", "v0.3.1"]); kit.ok(["tag", "v0.3.1"]);
  await expect(verificarTagRelease(kit.raiz, "v0.3.1", "v0.3.0", buscar)).rejects.toThrow("tag anotada");
});
test("Dado chave só na candidata, Quando verifico a release, Então a confiança anterior recusa a assinatura", async () => {
  await preparar(); const outra = await criarChave(kit.raiz);
  await writeFile(join(kit.raiz, "seguranca/assinantes"), outra.assinantes);
  kit.ok(["add", "seguranca/assinantes"]); kit.ok(["commit", "-qm", "chave candidata"]);
  kit.ok(["tag", "-d", "v0.3.1"]);
  kit.ok(["-c", "gpg.format=ssh", "-c", `user.signingkey=${outra.chave}`, "tag", "-s", "v0.3.1", "-m", "candidata"]);
  const ambas = async () => respostaDaLista({ formato: 1, chaves: [kit.fingerprint, outra.fingerprint], versaoMinima: "0.3.0" });
  await expect(verificarTagRelease(kit.raiz, "v0.3.1", "v0.3.0", ambas)).rejects.toThrow("assinatura inválida");
});
test("Dado tag apontando para nome diferente, Quando verifico, Então não aceito só a validade criptográfica", async () => {
  await preparar(); kit.ok(["update-ref", "refs/tags/v0.3.2", "refs/tags/v0.3.1"]);
  await expect(verificarTagRelease(kit.raiz, "v0.3.2", "v0.3.0", buscar)).rejects.toThrow("ref foi trocada");
});
test("Dado checkout fora da tag, Quando verifico, Então recuso montar outro código", async () => {
  await preparar(); kit.ok(["checkout", "--detach", "v0.3.0"]);
  await expect(verificarTagRelease(kit.raiz, "v0.3.1", "v0.3.0", buscar)).rejects.toThrow("HEAD");
});
test("Dado âncora ausente ou igual à candidata, Quando verifico, Então não uso a chave da própria candidata", async () => {
  await preparar();
  for (const anterior of ["v9.0.0", "v0.3.1"]) {
    await expect(verificarTagRelease(kit.raiz, "v0.3.1", anterior, buscar)).rejects.toThrow();
  }
});
test("Dado chave revogada no site, Quando verifico, Então a tag assinada também é recusada", async () => {
  await preparar();
  const revogada = async () => respostaDaLista({ formato: 1, chaves: ["SHA256:" + "A".repeat(43)], versaoMinima: "0.3.0" });
  await expect(verificarTagRelease(kit.raiz, "v0.3.1", "v0.3.0", revogada)).rejects.toThrow("não inclui");
});

test("Dado tag válida sem assinatura pública offline, Quando verifico a release, Então o gate recusa", async () => {
  await preparar(); await rm(join(kit.raiz, "instalador/assinaturas/instalar.sh.sig")); gravarCandidata();
  await expect(verificarTagRelease(kit.raiz, "v0.3.1", "v0.3.0", buscar)).rejects.toThrow("assinatura");
});
test("Dado tag válida com assinatura pública inválida, Quando verifico a release, Então o gate recusa", async () => {
  await preparar(); await writeFile(join(kit.raiz, "instalador/assinaturas/instalar.ps1.sig"), "inválida\n"); gravarCandidata();
  await expect(verificarTagRelease(kit.raiz, "v0.3.1", "v0.3.0", buscar)).rejects.toThrow("assinatura");
});
test("Dado fonte do instalador alterada após assinatura offline, Quando verifico tag válida, Então o gate detecta a divergência", async () => {
  await preparar();
  const arquivo = join(kit.raiz, "instalador/instalar.sh");
  await writeFile(arquivo, (await readFile(arquivo, "utf8")) + "\necho alteração posterior\n"); gravarCandidata();
  await expect(verificarTagRelease(kit.raiz, "v0.3.1", "v0.3.0", buscar)).rejects.toThrow("assinatura");
});
test("Dado assinatura offline somente no disco, Quando ela não entrou no commit da tag, Então o gate recusa", async () => {
  await preparar();
  kit.ok(["rm", "--cached", "instalador/assinaturas/instalar.sh.sig"]);
  kit.ok(["commit", "-qm", "assinatura fora do commit"]); assinarCandidata();
  await expect(verificarTagRelease(kit.raiz, "v0.3.1", "v0.3.0", buscar)).rejects.toThrow("assinatura");
});
