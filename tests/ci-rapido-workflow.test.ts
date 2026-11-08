import { expect, test } from "bun:test";
import { resolve } from "node:path";

type Step = { name?: string; uses?: string; run?: string; if?: string; with?: Record<string, unknown>; id?: string };
type Job = {
  name?: string;
  uses?: string;
  needs?: string | string[];
  if?: string;
  permissions?: Record<string, string>;
  steps?: Step[];
  outputs?: Record<string, string>;
};
type Workflow = {
  name: string;
  on: Record<string, any>;
  concurrency?: { group: string; "cancel-in-progress": unknown };
  jobs: Record<string, Job>;
};

async function carregar(nome: string): Promise<Workflow> {
  const arquivo = Bun.file(resolve(import.meta.dir, "../.github/workflows", nome));
  return await arquivo.exists() ? (Bun.YAML.parse(await arquivo.text()) as Workflow) : { name: "", on: {}, jobs: {} };
}

test("Dado os workflows ci.yml e instalar-linux.yml, Quando leio os gatilhos de push, Então disparam apenas na branch main", async () => {
  const ci = await carregar("ci.yml");
  const linux = await carregar("instalar-linux.yml");

  expect(ci.on.push).toEqual({ branches: ["main"] });
  expect(linux.on.push).toEqual({ branches: ["main"] });
  expect(ci.on.pull_request).toBeDefined();
  expect(ci.on.workflow_call).toBeDefined();
});

test("Dado ci.yml e instalar-linux.yml, Quando leio o grupo de concorrência, Então cada um tem prefixo literal próprio e não usa github.workflow", async () => {
  const ci = await carregar("ci.yml");
  const linux = await carregar("instalar-linux.yml");

  expect(ci.concurrency).toBeDefined();
  expect(linux.concurrency).toBeDefined();

  const grupoCi = ci.concurrency?.group ?? "";
  const grupoLinux = linux.concurrency?.group ?? "";

  expect(grupoCi).toStartWith("ci-");
  expect(grupoLinux).toStartWith("instalar-linux-");

  expect(grupoCi).not.toContain("github.workflow");
  expect(grupoLinux).not.toContain("github.workflow");
});

test("Dado um evento que não é pull_request, Quando o grupo é montado, Então inclui github.run_id (grupo único; main e release nunca enfileiram nem cancelam)", async () => {
  const ci = await carregar("ci.yml");
  const linux = await carregar("instalar-linux.yml");

  const esperadoCi = "ci-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || format('run-{0}-{1}', github.run_id, github.run_attempt) }}";
  const esperadoLinux = "instalar-linux-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || format('run-{0}-{1}', github.run_id, github.run_attempt) }}";

  expect(ci.concurrency?.group).toBe(esperadoCi);
  expect(linux.concurrency?.group).toBe(esperadoLinux);

  expect(ci.concurrency?.["cancel-in-progress"]).toBe("${{ github.event_name == 'pull_request' }}");
  expect(linux.concurrency?.["cancel-in-progress"]).toBe("${{ github.event_name == 'pull_request' }}");
});

test("Dado o workflow ci.yml, Quando verifico a detecção de mudanças, Então o job mudancas usa dorny/paths-filter fixado por SHA com os caminhos do instalador", async () => {
  const ci = await carregar("ci.yml");
  const mudancas = ci.jobs.mudancas;
  expect(mudancas).toBeDefined();
  if (!mudancas) throw new Error("job mudancas não encontrado");
  expect(mudancas.outputs?.["instalar-ps1"]).toBeDefined();

  const passoFiltro = mudancas.steps?.find(s => s.uses?.startsWith("dorny/paths-filter@"));
  expect(passoFiltro).toBeDefined();
  expect(passoFiltro?.uses).toBe("dorny/paths-filter@de90cc6fb38fc0963ad72b210f1f284cd68cea36");
  const ciTexto = await Bun.file(resolve(import.meta.dir, "../.github/workflows/ci.yml")).text();
  expect(ciTexto).toContain("dorny/paths-filter@de90cc6fb38fc0963ad72b210f1f284cd68cea36 # v3.0.2");
  const filtros = String(passoFiltro?.with?.filters ?? "");
  expect(filtros).toContain("instalador/**");
  expect(filtros).toContain("tests/instalar-ps1/**");
  expect(filtros).toContain("seguranca/**");
  expect(filtros).toContain(".github/workflows/ci.yml");
});

test("Dado o filtro do instalar-ps1, Então inclui package.json e bun.lock", async () => {
  const ci = await carregar("ci.yml");
  const mudancas = ci.jobs.mudancas;
  expect(mudancas).toBeDefined();
  if (!mudancas) throw new Error("job mudancas não encontrado");

  const passoFiltro = mudancas.steps?.find(s => s.uses?.startsWith("dorny/paths-filter@"));
  expect(passoFiltro).toBeDefined();
  const filtros = String(passoFiltro?.with?.filters ?? "");
  expect(filtros).toContain("package.json");
  expect(filtros).toContain("bun.lock");
});

test("Dado o workflow ci.yml, Quando verifico o job instalar-ps1, Então depende de mudancas, é sempre criado e possui passos condicionais", async () => {
  const ci = await carregar("ci.yml");
  const job = ci.jobs["instalar-ps1"];
  expect(job).toBeDefined();
  if (!job) throw new Error("job instalar-ps1 não encontrado");
  // Job sempre criado: sem "if" no nível do job que descarte a criação
  expect(job.if).toBeUndefined();
  // Depende do job de detecção
  const needs = typeof job.needs === "string" ? [job.needs] : job.needs ?? [];
  expect(needs).toContain("mudancas");

  // Passos de teste do Windows possuem condição para não rodar desnecessariamente em PR
  const passosTestes = job.steps?.filter(s => s.run?.includes("Invoke-Pester") || s.run?.includes("Install-Module Pester")) ?? [];
  expect(passosTestes.length).toBeGreaterThanOrEqual(3);
  for (const passo of passosTestes) {
    expect(passo.if).toBeDefined();
    expect(passo.if).toContain("github.event_name != 'pull_request'");
  }
});
