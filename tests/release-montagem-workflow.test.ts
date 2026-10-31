import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type Step = { uses?: string; run?: string; with?: Record<string, unknown> };
type Job = { uses?: string; needs?: string | string[]; if?: string; permissions?: Record<string, string>; steps?: Step[] };
type Workflow = { on: Record<string, unknown>; jobs: Record<string, Job> };
async function carregar(nome: string): Promise<Workflow> {
  const arquivo = Bun.file(resolve(import.meta.dir, "../.github/workflows", nome));
  return await arquivo.exists() ? Bun.YAML.parse(await arquivo.text()) as Workflow : { on: {}, jobs: {} };
}
const needs = (job: Job) => typeof job.needs === "string" ? [job.needs] : job.needs ?? [];

// Contrato estrutural; execução de Actions/builds é evidência separada.
test("Dado tag, Quando sigo todos os caminhos até o rascunho, Então nenhum gate pode ser pulado", async () => {
  const w = await carregar("release.yml");
  const visitados = new Set<string>();
  function visitar(id: string) {
    if (visitados.has(id)) return;
    visitados.add(id);
    const job = w.jobs[id];
    expect(job, id).toBeDefined();
    if (job) for (const dep of needs(job)) visitar(dep);
  }
  visitar("rascunho");
  for (const id of ["assinatura", "dependencias", "ci", "instalar-linux", "atualizar", "assets"]) expect(visitados.has(id), id).toBe(true);
  for (const [id, job] of Object.entries(w.jobs)) {
    if (id !== "assinatura") expect(needs(job).length, id).toBeGreaterThan(0);
    expect(job.if ?? "").not.toMatch(/always\(|!cancelled\(/);
    expect(job.permissions).toEqual({ contents: id === "rascunho" ? "write" : "read" });
  }
});
test("Dado CI reutilizável, Quando executo branch ou tag autenticada, Então uso a mesma montagem sem outro ponto de entrada de tag", async () => {
  const ci = await carregar("ci.yml"), linux = await carregar("instalar-linux.yml"), release = await carregar("release.yml");
  expect(Object.keys(ci.on)).toContain("workflow_call");
  for (const w of [ci, linux]) expect(w.on.push).toEqual({ branches: ["**"] });
  expect(release.jobs.ci?.uses).toBe("./.github/workflows/ci.yml");
  expect(needs(release.jobs.ci ?? {})).toContain("assinatura");
  expect(ci.jobs["builds-release"]?.uses).toBe("./.github/workflows/builds-release.yml");
  for (const id of ["testes", "instalar-ps1", "e2e-chromium"]) expect(ci.jobs[id]).toBeDefined();
});
test("Dado montagem de produção, Quando leio os contratos dos builds, Então versão explícita e instaladores conferidos não usam flags de fixture", async () => {
  const w = await carregar("builds-release.yml");
  expect(Object.keys(w.on)).toEqual(["workflow_call"]);
  for (const id of ["scripts", "linux", "windows"]) expect(w.jobs[id], id).toBeDefined();
  const linux = w.jobs.linux?.steps?.map(s => s.run ?? "").join("\n") ?? "";
  const windows = w.jobs.windows?.steps?.map(s => s.run ?? "").join("\n") ?? "";
  expect(linux).toContain("empacotar-linux.ts --versao");
  expect(linux).toContain("--instalar-sh");
  expect(linux).toContain("dpkg-deb");
  expect(linux).toContain("cmp");
  expect(windows).toContain("/DVersao=");
  expect(windows).toContain("/DInstallerPs1=");
  expect(windows).toContain("Resolve-Path");
  expect(windows).toContain("conferir-script-release.ts");
  for (const texto of [linux, windows]) expect(texto).not.toMatch(/--teste|--aceitar-url-de-teste|--url-confianca|--assinantes/);
  const arquivos = JSON.stringify(w);
  expect(arquivos).not.toMatch(/secrets\.|signingkey|ssh-keygen.*-Y.*sign/);
});
test("Dado rascunho, Quando examino sua operação, Então exige assets exatos e usa somente o comando protegido", async () => {
  const w = await carregar("release.yml");
  const texto = w.jobs.rascunho?.steps?.map(s => s.run ?? "").join("\n") ?? "";
  expect(texto).toContain("sha256sum -c SHA256SUMS");
  expect(texto).toContain("criar-rascunho-release.ts");
  expect(texto).toContain("--criar");
  expect(texto).not.toMatch(/release (?:edit|upload)|--clobber|--latest/);
});

test("Dado checkout inicial, Quando preparo a execução, Então revogação roda na âncora antes dos imports e do install da candidata", async () => {
  const w = await carregar("release.yml");
  const steps = w.jobs.assinatura?.steps ?? [];
  expect(steps[0]?.with?.ref).toBe("19578a1e6f3570975137488cd03ea0537e8c6a0e");
  const revogacao = steps.findIndex(s => s.run?.includes("assinantes-ativos"));
  const candidato = steps.findIndex(s => s.run?.includes("scripts/verificar-tag-release.ts"));
  const install = steps.findIndex(s => s.run?.includes("bun install"));
  expect(revogacao).toBeGreaterThan(0);
  expect(candidato).toBeGreaterThan(revogacao);
  expect(install).toBeGreaterThan(candidato);
});
