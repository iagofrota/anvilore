import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { criarKit } from "./apoio/kit-atualizavel";
import type { Kit } from "./apoio/kit-atualizavel";

let kit: Kit;
beforeEach(async () => {
  kit = await criarKit([{ versao: "0.3.0" }, { versao: "0.3.1" }]);
  kit.ok(["checkout", "--detach", "v0.3.1"]);
});
afterEach(async () => { await kit.limpar(); });

async function autenticar(objetoEsperado?: string) {
  const w = Bun.YAML.parse(await readFile(resolve(import.meta.dir, "../.github/workflows/release.yml"), "utf8")) as {
    jobs: { assinatura: { steps: { id?: string; run?: string }[] } };
  };
  const script = w.jobs.assinatura.steps.find(s => s.id === "autenticar-tag")?.run;
  if (!script) throw new Error("Etapa de autenticação ausente no workflow");
  return Bun.spawnSync(["bash", "-c", script], {
    cwd: kit.raiz, stdout: "pipe", stderr: "pipe",
    env: { ...process.env, TAG_ANTERIOR: "v0.3.0", GITHUB_REF_NAME: "v0.3.1",
      OBJETO_ANTERIOR: objetoEsperado ?? kit.ok(["rev-parse", "refs/tags/v0.3.0"]),
      COMMIT_ANTERIOR: kit.commits["0.3.0"]!, RUNNER_TEMP: kit.pai.replace(/\\/g, "/") },
  });
}

test("Dado tag SSH e âncora aprovada, Quando executo o trecho exato do workflow, Então a autenticação passa", async () => {
  const r = await autenticar(); expect(r.exitCode, r.stderr.toString()).toBe(0);
});
test("Dado tag sem assinatura, Quando executo o trecho do workflow, Então a autenticação falha", async () => {
  kit.ok(["tag", "-d", "v0.3.1"]); kit.ok(["tag", "-a", "v0.3.1", "-m", "sem assinatura"]);
  const r = await autenticar(); expect(r.exitCode).not.toBe(0);
});
test("Dado âncora reapontada, Quando executo o trecho do workflow com o pin aprovado, Então ele recusa", async () => {
  const aprovado = kit.ok(["rev-parse", "refs/tags/v0.3.0"]);
  kit.ok(["update-ref", "refs/tags/v0.3.0", kit.commits["0.3.1"]!]);
  const r = await autenticar(aprovado); expect(r.exitCode).not.toBe(0);
});
