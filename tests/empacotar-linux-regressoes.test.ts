import { expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { embutirInstalador, lerEmbutidos } from "../scripts/embutir-instalador";

const raiz = resolve(import.meta.dir, "..");
const linux = test.skipIf(process.platform !== "linux");

async function cenario(rodar: (c: { base: string; cli: (args?: string[], env?: Record<string, string>) => ReturnType<typeof Bun.spawnSync>; modelo: string; manifesto: string; assinantes: string; baseMinima: string }) => Promise<void>) {
  const base = await mkdtemp(join(tmpdir(), "anvilore-regressao-pacotes-"));
  try {
    const [modelo, manifesto, assinantes, baseMinima] = await Promise.all(["instalador/instalar.sh", "instalador/dependencias.json", "seguranca/assinantes", "instalador/base-minima"].map(p => readFile(join(raiz, p), "utf8")));
    const nfpm = join(base, "nfpm");
    await writeFile(nfpm, `#!${process.execPath}
const { readFileSync, writeFileSync } = require('node:fs');
const args = process.argv.slice(2), formato = args[args.indexOf('-p')+1], destino = args[args.indexOf('-t')+1];
writeFileSync(process.env.CAPTURA, process.env.ANVILORE_INSTALAR_SH ? readFileSync(process.env.ANVILORE_INSTALAR_SH) : 'modelo cru');
if (formato === 'rpm' && process.env.FALHAR_RPM) process.exit(42);
if (!process.env.SEM_ARTEFATO) writeFileSync(destino, formato === 'deb' ? '!<arch>\\nnovo-deb' : Buffer.from('edabeedb006e6f766f2d72706d', 'hex'));
`, { mode: 0o755 });
    const cli = (args: string[] = [], env: Record<string, string> = {}) => Bun.spawnSync([process.execPath, join(raiz, "scripts/empacotar-linux.ts"), "--saida", base, ...args], {
      cwd: raiz, env: { ...process.env, ANVILORE_VERSAO: "", GITHUB_REF_NAME: "", NFPM_BIN: nfpm, CAPTURA: join(base, "captura"), ...env }, stdout: "pipe", stderr: "pipe",
    });
    await rodar({ base, cli, modelo: modelo!, manifesto: manifesto!, assinantes: assinantes!, baseMinima: baseMinima! });
  } finally { await rm(base, { recursive: true, force: true }); }
}

linux("Dado o build padrão de produção, Quando nfpm recebe o instalador, Então os quatro campos embutidos conferem com as fontes", () => cenario(async c => {
  const r = c.cli();
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  expect(lerEmbutidos(await readFile(join(c.base, "captura"), "utf8"))).toEqual(lerEmbutidos(embutirInstalador(c.modelo, c.manifesto, c.assinantes, c.baseMinima)));
}));

linux("Dado --instalar-sh cru ou adulterado, Quando empacoto, Então recusa antes de executar nfpm", () => cenario(async c => {
  const pronto = embutirInstalador(c.modelo, c.manifesto, c.assinantes, c.baseMinima);
  for (const texto of [c.modelo, pronto.replace(c.assinantes, ""), pronto.replace(c.baseMinima, "0.0.0\n"), pronto.replace('https://anvilore.iagofrota.com.br', 'http://127.0.0.1:1234')]) {
    const arquivo = join(c.base, "instalar.sh");
    await writeFile(arquivo, texto);
    const r = c.cli(["--instalar-sh", arquivo]);
    expect(r.exitCode).toBe(1);
    expect(await Bun.file(join(c.base, "captura")).exists()).toBe(false);
  }
}));

linux("Dado artefato de teste e relaxamento herdado, Quando build é de produção, Então recusa e exige --teste explícito", () => cenario(async c => {
  const url = "http://127.0.0.1:12345/confianca.json";
  const arquivo = join(c.base, "instalar.sh");
  await writeFile(arquivo, embutirInstalador(c.modelo, c.manifesto, c.assinantes, c.baseMinima, "sh", { urlConfianca: url, urlDeTeste: true }));
  const r = c.cli(["--instalar-sh", arquivo], { ANVILORE_ACEITAR_URL_DE_TESTE: "1", ANVILORE_URL_CONFIANCA: url });
  expect(r.exitCode).toBe(1);
  expect(c.cli(["--url-confianca", url]).exitCode).toBe(1);
  const teste = c.cli(["--teste", "--instalar-sh", arquivo, "--url-confianca", url]);
  expect(teste.exitCode, teste.stderr.toString()).toBe(0);
}));

linux("Dado saídas anteriores, Quando o segundo pacote falha, Então conserva o par anterior e não publica o DEB novo", () => cenario(async c => {
  await writeFile(join(c.base, "anvilore.deb"), "deb-anterior");
  await writeFile(join(c.base, "anvilore.rpm"), "rpm-anterior");
  const r = c.cli([], { FALHAR_RPM: "1" });
  expect(r.exitCode).toBe(1);
  expect(r.stderr.toString()).toContain("42");
  expect(await readFile(join(c.base, "anvilore.deb"), "utf8")).toBe("deb-anterior");
  expect(await readFile(join(c.base, "anvilore.rpm"), "utf8")).toBe("rpm-anterior");
  expect((await readdir(c.base)).filter(p => p.startsWith(".anvilore-"))).toEqual([]);
}));

linux("Dado nfpm que retorna sucesso sem arquivos, Quando empacoto, Então não anuncia nem publica entrega", () => cenario(async c => {
  const r = c.cli([], { SEM_ARTEFATO: "1" });
  expect(r.exitCode).toBe(1);
  expect(r.stdout.toString()).not.toContain("Pacotes criados");
}));

linux("Dado ref de branch, Quando empacoto sem versão explícita, Então usa package.json; tag e SemVer explícito são validados", () => cenario(async c => {
  const versao = JSON.parse(await readFile(join(raiz, "package.json"), "utf8")).version;
  const branch = c.cli([], { GITHUB_REF_NAME: "feat/u9-pacotes-linux", GITHUB_REF_TYPE: "branch" });
  expect(branch.exitCode, branch.stderr.toString()).toBe(0);
  expect(branch.stdout.toString()).toContain(`Anvilore ${versao}`);
  const tag = c.cli([], { GITHUB_REF_NAME: "v1.2.3-rc.1+build.7", GITHUB_REF_TYPE: "tag" });
  expect(tag.exitCode, tag.stderr.toString()).toBe(0);
  expect(tag.stdout.toString()).toContain("Anvilore 1.2.3-rc.1+build.7");
  for (const versaoRuim of ["feat/u9-pacotes-linux", "1.02.3", "1.2.3-01", "", "v1.2"]) {
    const r = c.cli(["--versao", versaoRuim]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("SemVer");
  }
}));

for (const modo of ["404", "rede", "hash"]) linux(`Dado download nfpm com ${modo}, Quando CLI roda em CI, Então falha fechado e preserva saídas anteriores`, () => cenario(async c => {
  const preload = join(c.base, "fetch.ts");
  await writeFile(preload, modo === "rede" ? "globalThis.fetch = async () => { throw new Error('offline'); };" : `globalThis.fetch = async () => new Response('adulterado', {status: ${modo === "404" ? 404 : 200}});`);
  await writeFile(join(c.base, "anvilore.deb"), "deb-anterior");
  await writeFile(join(c.base, "anvilore.rpm"), "rpm-anterior");
  const r = Bun.spawnSync([process.execPath, "--preload", preload, join(raiz, "scripts/empacotar-linux.ts"), "--saida", c.base], {
    cwd: raiz, env: { ...process.env, CI: "true", NFPM_BIN: "", ANVILORE_VERSAO: "", GITHUB_REF_NAME: "" }, stdout: "pipe", stderr: "pipe",
  });
  expect(r.exitCode).toBe(1);
  expect(r.stderr.toString()).toMatch(modo === "404" ? /HTTP 404/ : modo === "rede" ? /Falha de rede/ : /SHA-256/);
  expect(await readFile(join(c.base, "anvilore.deb"), "utf8")).toBe("deb-anterior");
  expect(await readFile(join(c.base, "anvilore.rpm"), "utf8")).toBe("rpm-anterior");
}));
