import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { criarKit } from "./apoio/kit-atualizavel";
import type { Kit } from "./apoio/kit-atualizavel";

// Cada cenário monta repositórios e servidor com git de verdade: no runner Windows isso passa dos 5 s padrão.
setDefaultTimeout(30_000);

let kit: Kit, servidor: ReturnType<typeof Bun.serve>, chaves: string[], status: number;
beforeEach(async () => {
  chaves = []; status = 200;
  servidor = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(JSON.stringify({ formato: 1, chaves, versaoMinima: "0.3.0" }), { status }) });
  // Só a âncora descartável usa loopback. A candidata tem um preload hostil que jamais pode rodar antes do gate.
  const modulo = (await readFile(resolve(import.meta.dir, "../src/lib/confianca.ts"), "utf8")).replace("https://anvilore.iagofrota.com.br/confianca.json", `http://127.0.0.1:${servidor.port}/confianca.json`);
  kit = await criarKit([
    { versao: "0.3.0", arquivos: { "src/lib/confianca.ts": modulo } },
    { versao: "0.3.1", arquivos: { "bunfig.toml": 'preload = ["./preload.ts"]\n', "preload.ts": 'await Bun.write("executou-candidata", "SIM");\n' } },
  ]);
  chaves = [kit.fingerprint];
  await Bun.write(join(kit.pai, "assinantes-anteriores"), kit.ok(["show", "v0.3.0:seguranca/assinantes"]));
});
afterEach(async () => { servidor.stop(true); await kit.limpar(); });
async function autenticar() {
  const w = Bun.YAML.parse(await readFile(resolve(import.meta.dir, "../.github/workflows/release.yml"), "utf8")) as { jobs: { assinatura: { steps: { id?: string; run?: string }[] } } };
  const shell = w.jobs.assinatura.steps.find(s => s.id === "verificar-revogacao")?.run;
  if (!shell) throw new Error("Gate de revogação antes do checkout ausente");
  const p = Bun.spawn(["bash", "-c", shell], { cwd: kit.raiz, stdout: "pipe", stderr: "pipe", env: { ...process.env, GITHUB_REF_NAME: "v0.3.1", RUNNER_TEMP: kit.pai.replace(/\\/g, "/") } });
  const [codigo, saida] = await Promise.all([p.exited, new Response(p.stderr).text()]);
  return { codigo, saida };
}
test("Dado chave ativa na âncora e no site, Quando executo o shell exato, Então só após conferir a assinatura faço checkout da candidata", async () => {
  const r = await autenticar(); expect(r.codigo, r.saida).toBe(0);
  expect(kit.head()).toBe(kit.commits["0.3.1"]!);
  expect(await Bun.file(join(kit.raiz, "executou-candidata")).exists()).toBe(false);
});
test("Dado chave revogada no site, Quando executo o shell exato, Então a candidata nem é extraída nem executada", async () => {
  chaves = ["SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"];
  const r = await autenticar(); expect(r.codigo).not.toBe(0);
  expect(kit.head()).toBe(kit.commits["0.3.0"]!);
  expect(await Bun.file(join(kit.raiz, "executou-candidata")).exists()).toBe(false);
});
test("Dado site indisponível, Quando executo o shell exato, Então falho fechado antes de checkout ou execução", async () => {
  status = 503;
  const r = await autenticar(); expect(r.codigo).not.toBe(0);
  expect(kit.head()).toBe(kit.commits["0.3.0"]!);
  expect(await Bun.file(join(kit.raiz, "executou-candidata")).exists()).toBe(false);
});
