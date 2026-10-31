import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raiz = join(import.meta.dir, "..");

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

test("Dado o script empacotar-linux, Quando executo o build em diretório temporário, Então gera anvilore.deb e anvilore.rpm com arquivos e permissões corretos", async () => {
  const base = await mkdtemp(join(tmpdir(), "anvilore-empacotar-"));
  try {
    const proc = Bun.spawnSync(["bun", join(raiz, "scripts/empacotar-linux.ts"), "--saida", base, "--versao", "0.3.0"], {
      cwd: raiz,
      stdout: "pipe",
      stderr: "pipe",
    });

    const saidaErro = proc.stderr.toString();
    if (saidaErro.includes("SKIP_OFFLINE") || proc.stdout.toString().includes("SKIP_OFFLINE")) {
      console.warn("SKIP: nfpm não pôde ser baixado sem rede; CI cobrirá.");
      return;
    }

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

test("Dado um download adulterado de nfpm, Quando o hash não confere, Então o empacotamento é recusado", async () => {
  const base = await mkdtemp(join(tmpdir(), "anvilore-adulterado-"));
  try {
    const proc = Bun.spawnSync(["bun", join(raiz, "scripts/empacotar-linux.ts"), "--hash-nfpm-teste-invalido", "--saida", base], {
      cwd: raiz,
      stdout: "pipe",
      stderr: "pipe",
    });
    // Deve falhar com código diferente de 0 acusando SHA-256 divergente
    expect(proc.exitCode).not.toBe(0);
    expect(`${proc.stdout.toString()}\n${proc.stderr.toString()}`).toMatch(/sha256|hash/i);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
