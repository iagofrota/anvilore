import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type Job = { needs?: string | string[]; permissions?: Record<string, string>; uses?: string; steps?: { uses?: string }[]; strategy?: { matrix?: { os?: string[] } } };
type Workflow = { on?: { push?: { tags?: string[] }; workflow_call?: unknown }; permissions?: Record<string, string>; jobs?: Record<string, Job> };
async function carregar(nome: string): Promise<Workflow> {
  const texto = await readFile(resolve(import.meta.dir, "../.github/workflows", nome), "utf8").catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return "{}"; throw e;
  });
  return Bun.YAML.parse(texto) as Workflow;
}
function dependencias(job: Job): string[] { return typeof job.needs === "string" ? [job.needs] : job.needs ?? []; }

// São guardas do grafo/configuração. Não executam GitHub Actions e não provam instalação de pacotes.
test("Dado workflow de tags, Quando examino o grafo, Então downloads, instalação e atualização dependem da autenticação", async () => {
  const w = await carregar("release.yml"), jobs = w.jobs ?? {};
  expect(w.on?.push?.tags).toContain("*");
  expect(jobs.assinatura).toBeDefined();
  for (const nome of ["dependencias", "instalar-linux", "atualizar"]) {
    expect(jobs[nome], nome).toBeDefined();
    expect(dependencias(jobs[nome] ?? {}), nome).toContain("assinatura");
  }
  expect(jobs.atualizar?.strategy?.matrix?.os).toEqual(["ubuntu-latest", "windows-latest"]);
});
test("Dado prova Linux reutilizada, Quando leio a chamada, Então o workflow chamado aceita workflow_call", async () => {
  const w = await carregar("release.yml");
  expect(w.jobs?.["instalar-linux"]?.uses).toBe("./.github/workflows/instalar-linux.yml");
  expect(Object.keys((await carregar("instalar-linux.yml")).on ?? {})).toContain("workflow_call");
});
test("Dado gates independentes, Quando examino permissões e ações, Então não concedem escrita e fixam ações externas por commit", async () => {
  const w = await carregar("release.yml");
  expect(w.permissions).toEqual({ contents: "read" });
  const jobs = Object.values(w.jobs ?? {});
  expect(jobs.length).toBeGreaterThanOrEqual(4);
  for (const [nome, job] of Object.entries(w.jobs ?? {})) {
    if (nome !== "rascunho") expect(Object.values(job.permissions ?? {})).not.toContain("write");
    for (const step of job.steps ?? []) {
      if (step.uses) expect(step.uses).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    }
  }
});
