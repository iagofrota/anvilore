import { afterEach, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { criarChave, criarKit, respostaDaLista } from "./apoio/kit-atualizavel";
import type { Kit } from "./apoio/kit-atualizavel";
import { verificarTagRelease } from "../scripts/verificar-tag-release";

let kit: Kit;
afterEach(async () => { await kit?.limpar(); });
async function preparar() {
  kit = await criarKit([{ versao: "0.3.0" }, { versao: "0.3.1" }]);
  kit.ok(["checkout", "--detach", "v0.3.1"]);
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
