import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type Step = { name?: string; uses?: string; run?: string; if?: string; with?: Record<string, unknown>; id?: string; env?: Record<string, string> };
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
  permissions?: Record<string, string>;
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

test("Dado ci.yml, Então nenhum nível pede pull-requests e nenhum passo usa dorny/paths-filter", async () => {
  const ci = await carregar("ci.yml");
  expect(ci.permissions?.["pull-requests"]).toBeUndefined();

  for (const [id, job] of Object.entries(ci.jobs)) {
    expect(job.permissions?.["pull-requests"], `job ${id}`).toBeUndefined();
    for (const step of job.steps ?? []) {
      expect(step.uses ?? "", `job ${id} step`).not.toContain("dorny/paths-filter");
    }
  }
});

test("Dado release.yml chamando ci.yml, Então toda permissão pedida em ci.yml (topo e jobs) está contida nas do job chamador", async () => {
  const release = await carregar("release.yml");
  const ci = await carregar("ci.yml");

  const jobCiNaRelease = release.jobs.ci;
  expect(jobCiNaRelease).toBeDefined();
  const permsChamador = jobCiNaRelease?.permissions ?? release.permissions ?? {};

  const permsTopoCi = ci.permissions ?? {};
  for (const [k, v] of Object.entries(permsTopoCi)) {
    expect(permsChamador[k], `topo ci.yml permissão ${k}`).toBeDefined();
    expect(permsChamador[k]).toBe(v);
  }

  for (const [id, job] of Object.entries(ci.jobs)) {
    for (const [k, v] of Object.entries(job.permissions ?? {})) {
      expect(permsChamador[k], `job ${id} permissão ${k}`).toBeDefined();
      expect(permsChamador[k]).toBe(v);
    }
  }
});

test("Dado o passo de detecção, Então ele sai com instalar-ps1=true quando o diff falha", async () => {
  const ci = await carregar("ci.yml");
  const mudancas = ci.jobs.mudancas;
  expect(mudancas).toBeDefined();
  if (!mudancas) throw new Error("job mudancas não encontrado");

  const passo = mudancas.steps?.find(s => s.id === "filtro");
  expect(passo).toBeDefined();
  expect(passo?.run).toBeDefined();
  const script = passo?.run ?? "";

  // Executa o script passando variáveis com SHA inválido para simular falha do git diff
  const tmpOutput = resolve(import.meta.dir, `../.tmp-test-output-${Date.now()}.txt`);
  try {
    const proc = Bun.spawnSync(["bash", "-c", script], {
      env: {
        ...process.env,
        BASE_SHA: "sha_invalido_0000",
        HEAD_SHA: "sha_invalido_1111",
        GITHUB_OUTPUT: tmpOutput,
      },
      cwd: resolve(import.meta.dir, ".."),
    });
    expect(proc.exitCode).toBe(0);
    const conteudoOutput = await Bun.file(tmpOutput).text();
    expect(conteudoOutput).toContain("instalar-ps1=true");
  } finally {
    const f = Bun.file(tmpOutput);
    if (await f.exists()) await f.delete();
  }
});

test.skip("Dado todo caminho scripts/*.ts citado em tests/instalar-ps1/*.ps1, Então ele e seus imports locais transitivos casam com o filtro", async () => {
  const raiz = resolve(import.meta.dir, "..");
  const dirPester = join(raiz, "tests/instalar-ps1");
  const arquivosPester = readdirSync(dirPester).filter(f => f.endsWith(".ps1"));

  const scriptsCitados = new Set<string>();
  const regexScript = /scripts\/[a-zA-Z0-9_-]+\.ts/g;

  for (const p of arquivosPester) {
    const texto = readFileSync(join(dirPester, p), "utf8");
    let match: RegExpExecArray | null;
    while ((match = regexScript.exec(texto)) !== null) {
      scriptsCitados.add(match[0]);
    }
  }

  expect(scriptsCitados.size).toBeGreaterThan(0);

  // Calcula fecho transitivo de imports locais
  const fecho = new Set<string>();
  const fila = Array.from(scriptsCitados);
  const regexImport = /(?:import|export)\s+.*?from\s+["'](\.[^"']+)["']/g;

  while (fila.length > 0) {
    const atual = fila.shift()!;
    if (fecho.has(atual)) continue;
    fecho.add(atual);

    const caminhoCompleto = join(raiz, atual);
    const texto = await Bun.file(caminhoCompleto).text();
    const dirAtual = dirname(caminhoCompleto);

    let m: RegExpExecArray | null;
    while ((m = regexImport.exec(texto)) !== null) {
      let rel = m[1];
      let alvo = resolve(dirAtual, rel);
      if (!alvo.endsWith(".ts") && !alvo.endsWith(".json")) {
        const comTs = `${alvo}.ts`;
        const comIndex = join(alvo, "index.ts");
        if (await Bun.file(comTs).exists()) alvo = comTs;
        else if (await Bun.file(comIndex).exists()) alvo = comIndex;
      }
      const relativoRaiz = alvo.replace(raiz + "/", "");
      if (relativoRaiz.startsWith("src/") || relativoRaiz.startsWith("scripts/")) {
        fila.push(relativoRaiz);
      }
    }
  }

  // Carrega o script de filtro do ci.yml
  const ci = await carregar("ci.yml");
  const mudancas = ci.jobs.mudancas;
  expect(mudancas).toBeDefined();
  const passo = mudancas?.steps?.find(s => s.id === "filtro");
  expect(passo?.run).toBeDefined();
  const scriptFiltro = passo?.run ?? "";

  const padroesBloco = /padroes=\(\s*([\s\S]*?)\s*\)/.exec(scriptFiltro)?.[1] ?? "";
  const padroes = padroesBloco
    .split("\n")
    .map(l => l.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);

  expect(padroes.length).toBeGreaterThan(0);

  // Todo arquivo do fecho deve casar com o filtro
  for (const arq of fecho) {
    const casa = padroes.some(p => new RegExp(p).test(arq));
    expect(casa, `arquivo do fecho ${arq} deve casar com o filtro`).toBe(true);
  }

  // Arquivos não relacionados não devem casar
  for (const arq of ["src/cli.ts", "docs/knowledge_base/README.md"]) {
    const casa = padroes.some(p => new RegExp(p).test(arq));
    expect(casa, `arquivo não relacionado ${arq} não deve casar`).toBe(false);
  }
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
