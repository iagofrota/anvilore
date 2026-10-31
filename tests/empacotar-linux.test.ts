import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raiz = join(import.meta.dir, "..");
if (process.env.ANVILORE_PULAR_TESTE_NFPM === "1" && !process.env.CI) console.warn("SKIP LOCAL EXPLÍCITO: build nfpm com rede desabilitado por ANVILORE_PULAR_TESTE_NFPM=1; CI exige o build.");

test("Dado a configuração do pacote Linux, Quando leio instalador/linux/nfpm.yaml, Então declara nome anvilore, arch all, dependências e conteúdo do lançador", async () => {
  const yaml = await readFile(join(raiz, "instalador/linux/nfpm.yaml"), "utf8");

  expect(yaml).toMatch(/name:\s*["']?anvilore["']?/);
  expect(yaml).toMatch(/arch:\s*["']?all["']?/);
  expect(yaml).toMatch(/platform:\s*["']?linux["']?/);

  // Dependências
  expect(yaml).toContain("git");
  expect(yaml).toContain("unzip");
  expect(yaml).toContain("curl");
  expect(yaml).toContain("ca-certificates");
  expect(yaml).toMatch(/recommends:[\s\S]*?ripgrep/);

  // Conteúdo
  expect(yaml).toContain("/usr/lib/anvilore/anvilore-abrir");
  expect(yaml).toContain("/usr/lib/anvilore/instalar.sh");
  expect(yaml).toContain("/usr/bin/anvilore-abrir");
  expect(yaml).toContain("/usr/share/applications/anvilore.desktop");
  expect(yaml).toContain("/usr/share/icons/hicolor/scalable/apps/anvilore.svg");

  // Symlink
  expect(yaml).toMatch(/type:\s*symlink/);
});

test("Dado os scripts de pós-instalação e pós-remoção, Quando inspeciono o conteúdo, Então são idempotentes e nunca tocam na pasta de usuário", async () => {
  const posInstalacao = await readFile(join(raiz, "instalador/linux/pos-instalacao.sh"), "utf8");
  const posRemocao = await readFile(join(raiz, "instalador/linux/pos-remocao.sh"), "utf8");

  for (const script of [posInstalacao, posRemocao]) {
    expect(script).not.toContain("$HOME");
    expect(script).not.toMatch(/\b~\//);
    expect(script).not.toContain("/home/");
    expect(script).not.toContain("/root");

    // Tolerância a ferramentas ausentes e idempotência
    expect(script).toContain("command -v update-desktop-database");
    expect(script).toContain("command -v gtk-update-icon-cache");
    expect(script).toContain("|| true");
  }
});

test("Dado a entrada desktop do sistema, Quando leio instalador/linux/anvilore.desktop, Então passa no desktop-file-validate e usa Terminal=true", async () => {
  const desktop = join(raiz, "instalador/linux/anvilore.desktop");
  const texto = await readFile(desktop, "utf8");

  expect(texto).toContain("[Desktop Entry]");
  expect(texto).toContain("Name=Anvilore");
  expect(texto).toContain("Exec=anvilore-abrir");
  expect(texto).toContain("Terminal=true");
  expect(texto).toContain("Icon=anvilore");
  expect(texto).toContain("Categories=Office;Utility;");

  if (Bun.which("desktop-file-validate")) {
    const validacao = Bun.spawnSync(["desktop-file-validate", desktop], { stdout: "pipe", stderr: "pipe" });
    expect(validacao.exitCode, validacao.stderr.toString()).toBe(0);
  } else {
    console.warn("SKIP: desktop-file-validate não está instalado; validação ignorada.");
  }
});

test.skipIf(process.platform !== "linux" || (process.env.ANVILORE_PULAR_TESTE_NFPM === "1" && !process.env.CI))("Dado o script empacotar-linux, Quando executo o build em diretório temporário, Então gera anvilore.deb e anvilore.rpm com arquivos e permissões corretos", async () => {
  const base = await mkdtemp(join(tmpdir(), "anvilore-empacotar-"));
  try {
    const proc = Bun.spawnSync([process.execPath, join(raiz, "scripts/empacotar-linux.ts"), "--versao", "0.3.0", "--saida", base], {
      cwd: raiz,
      env: { ...process.env, ANVILORE_VERSAO: "", GITHUB_REF_NAME: "feat/u9-pacotes-linux", GITHUB_REF_TYPE: "branch" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const saidaErro = proc.stderr.toString();
    expect(proc.exitCode, `${proc.stdout.toString()}\n${saidaErro}`).toBe(0);

    const deb = join(base, "anvilore.deb");
    const rpm = join(base, "anvilore.rpm");

    const dpkgC = Bun.spawnSync(["dpkg-deb", "-c", deb], { stdout: "pipe", stderr: "pipe" });
    expect(dpkgC.exitCode, dpkgC.stderr.toString()).toBe(0);
    const arquivosDeb = dpkgC.stdout.toString();

    expect(arquivosDeb).toMatch(/-rwxr-xr-x .* \.\/usr\/lib\/anvilore\/anvilore-abrir/);
    expect(arquivosDeb).toMatch(/-rwxr-xr-x .* \.\/usr\/lib\/anvilore\/instalar\.sh/);
    expect(arquivosDeb).toMatch(/l--------- .* \.\/usr\/bin\/anvilore-abrir -> \/usr\/lib\/anvilore\/anvilore-abrir/);
    expect(arquivosDeb).toMatch(/-rw-r--r-- .* \.\/usr\/share\/applications\/anvilore\.desktop/);
    expect(arquivosDeb).toMatch(/-rw-r--r-- .* \.\/usr\/share\/icons\/hicolor\/scalable\/apps\/anvilore\.svg/);

    const dpkgI = Bun.spawnSync(["dpkg-deb", "-I", deb], { stdout: "pipe", stderr: "pipe" });
    expect(dpkgI.exitCode, dpkgI.stderr.toString()).toBe(0);
    const infoDeb = dpkgI.stdout.toString();

    expect(infoDeb).toContain("Package: anvilore");
    expect(infoDeb).toContain("Version: 0.3.0");
    expect(infoDeb).toContain("Architecture: all");
    expect(infoDeb).toMatch(/Depends:.*git/);
    expect(infoDeb).toMatch(/Depends:.*unzip/);
    expect(infoDeb).toMatch(/Depends:.*curl/);
    expect(infoDeb).toMatch(/Depends:.*ca-certificates/);
    expect(infoDeb).toMatch(/Depends:.*openssh-client/);

    const extracao = join(base, "extraido");
    expect(Bun.spawnSync(["dpkg-deb", "-x", deb, extracao]).exitCode).toBe(0);
    const { conferirEmbutidos } = await import("../scripts/embutir-instalador");
    const [script, manifesto, assinantes, baseMinima] = await Promise.all([join(extracao, "usr/lib/anvilore/instalar.sh"), join(raiz, "instalador/dependencias.json"), join(raiz, "seguranca/assinantes"), join(raiz, "instalador/base-minima")].map(p => readFile(p, "utf8")));
    expect(conferirEmbutidos(script!, manifesto!, assinantes!, baseMinima!)).toEqual([]);
    if (Bun.which("desktop-file-validate")) expect(Bun.spawnSync(["desktop-file-validate", join(extracao, "usr/share/applications/anvilore.desktop")]).exitCode).toBe(0);
    expect(infoDeb).toMatch(/Recommends:.*ripgrep/);

    if (Bun.which("rpm")) {
      const rpmQ = Bun.spawnSync(["rpm", "-qlp", rpm], { stdout: "pipe", stderr: "pipe" });
      expect(rpmQ.exitCode, rpmQ.stderr.toString()).toBe(0);
      const arquivosRpm = rpmQ.stdout.toString();
      expect(arquivosRpm).toContain("/usr/lib/anvilore/anvilore-abrir");
      expect(arquivosRpm).toContain("/usr/lib/anvilore/instalar.sh");
      expect(arquivosRpm).toContain("/usr/bin/anvilore-abrir");
      expect(arquivosRpm).toContain("/usr/share/applications/anvilore.desktop");
      expect(arquivosRpm).toContain("/usr/share/icons/hicolor/scalable/apps/anvilore.svg");
    } else {
      console.warn("SKIP: rpm não está disponível no host para conferência com rpm -qlp.");
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado um download adulterado de nfpm, Quando o hash não confere, Então o empacotamento é recusado e fecha com erro", async () => {
  const base = await mkdtemp(join(tmpdir(), "anvilore-adulterado-"));
  const preload = join(base, "fetch.ts");
  await writeFile(preload, "globalThis.fetch = async () => new Response(\"adulterado\");");
  try {
    const proc = Bun.spawnSync([process.execPath, "--preload", preload, join(raiz, "scripts/empacotar-linux.ts"), "--hash-nfpm-teste-invalido", "--saida", base], {
      cwd: raiz,
      stdout: "pipe",
      stderr: "pipe",
    });
    // Deve falhar fechado com código 1 acusando SHA-256 divergente
    expect(proc.exitCode).toBe(1);
    expect(`${proc.stdout.toString()}\n${proc.stderr.toString()}`).toMatch(/sha256|hash/i);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado pacotes pré-existentes no destino, Quando download falha, Então a CLI falha sem aceitar nem apagar o par anterior", async () => {
  const base = await mkdtemp(join(tmpdir(), "anvilore-limpeza-"));
  try {
    const preload = join(base, "fetch.ts");
    await writeFile(preload, "globalThis.fetch = async () => new Response('ausente', {status: 404});");
    for (const extensao of ["deb", "rpm"]) await writeFile(join(base, `anvilore.${extensao}`), "anterior");
    const proc = Bun.spawnSync([process.execPath, "--preload", preload, join(raiz, "scripts/empacotar-linux.ts"), "--saida", base], {
      cwd: raiz, env: { ...process.env, NFPM_BIN: "" }, stdout: "pipe", stderr: "pipe",
    });
    expect(proc.exitCode).toBe(1);
    expect(proc.stderr.toString()).toContain("HTTP 404");
    for (const extensao of ["deb", "rpm"]) expect(await readFile(join(base, `anvilore.${extensao}`), "utf8")).toBe("anterior");
  } finally { await rm(base, { recursive: true, force: true }); }
});
