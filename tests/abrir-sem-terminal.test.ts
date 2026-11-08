import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raiz = join(import.meta.dir, "..");
const lancadorOriginal = join(raiz, "instalador/anvilore-abrir");

test("Dado instância já rodando para a mesma pasta, Quando anvilore-abrir é executado, Então reabre o navegador na URL existente e não sobe outro servidor", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-instancia-unica-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const bin = join(base, "bin");
    const xdgRuntime = join(base, "run");
    const xdgState = join(base, "state");
    const navegadorChamado = join(base, "navegador-chamado");
    const uiChamada = join(base, "ui-chamada");

    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(bin, { recursive: true });
    await mkdir(xdgRuntime, { recursive: true });
    await mkdir(xdgState, { recursive: true });
    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    await writeFile(join(pasta, "package.json"), JSON.stringify({ version: "0.10.0" }));

    // Fake bun que roda o comando e responde ao fetch se necessário
    const bun = join(bin, "bun");
    await writeFile(bun, `#!/bin/sh
if [ "$1" = "-e" ]; then
  exec "${process.execPath}" "$@"
fi
printf '%s\\n' "$*" >>"$ANV_TEST_UI"
exit 0
`);
    await chmod(bun, 0o755);

    // Fake xdg-open para verificar reabertura do navegador
    const xdgOpen = join(bin, "xdg-open");
    await writeFile(xdgOpen, `#!/bin/sh
printf '%s\\n' "$*" >>"$ANV_TEST_BROWSER"
exit 0
`);
    await chmod(xdgOpen, 0o755);

    // Servidor real Bun na porta 4173 para responder ao GET autenticado
    const server = Bun.serve({
      port: 4173,
      fetch(req) {
        const url = new URL(req.url);
        if (url.searchParams.get("token") === "token-teste-123") {
          return new Response("OK", { status: 200 });
        }
        return new Response("Acesso recusado", { status: 403 });
      },
    });

    try {
      // Grava o arquivo de estado no XDG_RUNTIME_DIR
      const estadoFile = join(xdgRuntime, "anvilore-ui.json");
      await writeFile(estadoFile, JSON.stringify({
        pid: process.pid,
        porta: server.port,
        token: "token-teste-123",
        pasta,
        soRevisao: false,
      }, null, 2), { mode: 0o600 });

      const env = {
        ...process.env,
        HOME: home,
        PATH: `${bin}:/usr/bin:/bin`,
        XDG_RUNTIME_DIR: xdgRuntime,
        XDG_STATE_HOME: xdgState,
        ANVILORE_PASTA: pasta,
        ANV_TEST_BROWSER: navegadorChamado,
        ANV_TEST_UI: uiChamada,
      };

      const proc = Bun.spawn(["bash", lancadorOriginal], { cwd: base, env, stdout: "pipe", stderr: "pipe" });
      const codigo = await proc.exited;
      const stderr = await new Response(proc.stderr).text();
      expect(codigo, stderr).toBe(0);

      // Verificamos que o navegador foi reaberto com a URL e token corretos
      for (let i = 0; i < 20; i++) {
        if (await Bun.file(navegadorChamado).exists()) break;
        await new Promise(r => setTimeout(r, 25));
      }
      expect(await Bun.file(navegadorChamado).exists()).toBe(true);
      const urlChamada = await readFile(navegadorChamado, "utf8");
      expect(urlChamada.trim()).toBe(`http://127.0.0.1:${server.port}/?token=token-teste-123`);

      // Verificamos que o servidor NÃO foi iniciado de novo (fake bun ui não foi chamado)
      expect(await Bun.file(uiChamada).exists()).toBe(false);
    } finally {
      server.stop(true);
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado erro ao abrir sem terminal interativo, Quando o lançador falha, Então grava em abrir.log com modo 0600 sem segredos", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-erro-log-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const bin = join(base, "bin");
    const xdgState = join(base, "state");

    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(bin, { recursive: true });
    await mkdir(xdgState, { recursive: true });
    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    await writeFile(join(pasta, "package.json"), JSON.stringify({ version: "0.10.0" }));

    // Fake bun que falha com código 5 e exibe uma mensagem com token secreto
    const bun = join(bin, "bun");
    await writeFile(bun, `#!/bin/sh
echo "Erro com token=secreto_xyz_12345" >&2
exit 5
`);
    await chmod(bun, 0o755);

    const env = {
      ...process.env,
      HOME: home,
      PATH: `${bin}:/usr/bin:/bin`,
      XDG_STATE_HOME: xdgState,
      ANVILORE_PASTA: pasta,
      ANVILORE_SEM_DIALOGO: "1",
    };

    const proc = Bun.spawnSync(["bash", lancadorOriginal], { cwd: base, env, stdout: "pipe", stderr: "pipe" });
    expect(proc.exitCode).toBe(5);

    // Confere arquivo de log em XDG_STATE_HOME/anvilore/abrir.log
    const logFile = join(xdgState, "anvilore/abrir.log");
    expect(await Bun.file(logFile).exists()).toBe(true);

    const logInfo = await stat(logFile);
    expect(logInfo.mode & 0o777).toBe(0o600);

    const conteudoLog = await readFile(logFile, "utf8");
    expect(conteudoLog).not.toContain("token=secreto_xyz_12345");
    expect(conteudoLog).toContain("código 5");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado erro sem terminal interativo e zenity presente, Quando ANVILORE_TEST_DIALOGO=1, Então chama o diálogo gráfico", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-dialogo-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const bin = join(base, "bin");
    const zenityChamado = join(base, "zenity-chamado");

    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(bin, { recursive: true });
    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    await writeFile(join(pasta, "package.json"), JSON.stringify({ version: "0.10.0" }));

    // Fake bun que falha com código 3
    const bun = join(bin, "bun");
    await writeFile(bun, `#!/bin/sh
exit 3
`);
    await chmod(bun, 0o755);

    // Fake zenity que registra chamada e sai 0
    const zenity = join(bin, "zenity");
    await writeFile(zenity, `#!/bin/sh
printf '%s\\n' "$*" >>"$ANV_TEST_ZENITY"
exit 0
`);
    await chmod(zenity, 0o755);

    const env = {
      ...process.env,
      HOME: home,
      PATH: `${bin}:/usr/bin:/bin`,
      ANVILORE_PASTA: pasta,
      ANVILORE_TEST_DIALOGO: "1",
      ANV_TEST_ZENITY: zenityChamado,
      DISPLAY: ":0",
    };

    const proc = Bun.spawnSync(["bash", lancadorOriginal], { cwd: base, env, stdout: "pipe", stderr: "pipe" });
    expect(proc.exitCode).toBe(3);
    expect(await Bun.file(zenityChamado).exists()).toBe(true);
    const zenityArgs = await readFile(zenityChamado, "utf8");
    expect(zenityArgs).toContain("--error");
    expect(zenityArgs).toContain("--title=Anvilore");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado o ambiente de teste padrão, Quando o lançador falha sem TTY, Então nenhum zenity/kdialog/notify-send/emulador real é chamado", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-bloqueio-dialogos-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const bin = join(base, "bin");
    const arquivoCanary = join(base, "canary-chamado.txt");

    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(bin, { recursive: true });
    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    await writeFile(join(pasta, "package.json"), JSON.stringify({ version: "0.10.0" }));

    // Fake bun que falha com código 5
    const bun = join(bin, "bun");
    await writeFile(bun, `#!/bin/sh\nexit 5\n`);
    await chmod(bun, 0o755);

    // Falsos zenity, kdialog, notify-send, x-terminal-emulator no PATH que gravam no arquivoCanary
    const scriptCanary = `#!/bin/sh\nprintf '%s\\n' "$0 $*" >>"$ANV_TEST_CANARY"\nexit 0\n`;
    for (const ferramenta of ["zenity", "kdialog", "notify-send", "x-terminal-emulator"]) {
      const caminho = join(bin, ferramenta);
      await writeFile(caminho, scriptCanary);
      await chmod(caminho, 0o755);
    }

    // Ambiente padrão herdado de process.env (onde preload.ts limpou DISPLAY e setou ANVILORE_SEM_DIALOGO=1)
    const env = {
      ...process.env,
      HOME: home,
      PATH: `${bin}:/usr/bin:/bin`,
      ANVILORE_PASTA: pasta,
      ANV_TEST_CANARY: arquivoCanary,
    };

    const proc = Bun.spawnSync(["bash", lancadorOriginal], { cwd: base, env, stdout: "pipe", stderr: "pipe" });
    expect(proc.exitCode).toBe(5);

    // Nenhum dos comandos falsos deve ter sido executado: o arquivo deve estar ausente
    expect(await Bun.file(arquivoCanary).exists()).toBe(false);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado ausência de trava de diálogo com DISPLAY configurado, Quando o lançador falha sem TTY, Então o diálogo é chamado (prova RED sem o preload)", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-prova-red-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const bin = join(base, "bin");
    const arquivoCanary = join(base, "canary-chamado.txt");

    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(bin, { recursive: true });
    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    await writeFile(join(pasta, "package.json"), JSON.stringify({ version: "0.10.0" }));

    // Fake bun que falha com código 5
    const bun = join(bin, "bun");
    await writeFile(bun, `#!/bin/sh\nexit 5\n`);
    await chmod(bun, 0o755);

    // Falsos zenity, kdialog, notify-send, x-terminal-emulator no PATH que gravam no arquivoCanary
    const scriptCanary = `#!/bin/sh\nprintf '%s\\n' "$0 $*" >>"$ANV_TEST_CANARY"\nexit 0\n`;
    for (const ferramenta of ["zenity", "kdialog", "notify-send", "x-terminal-emulator"]) {
      const caminho = join(bin, ferramenta);
      await writeFile(caminho, scriptCanary);
      await chmod(caminho, 0o755);
    }

    // Sem preload: DISPLAY configurado e ANVILORE_SEM_DIALOGO desativado (assim como CI e AGENTISTICS_THROWAWAY vazios)
    const env = {
      ...process.env,
      HOME: home,
      PATH: `${bin}:/usr/bin:/bin`,
      ANVILORE_PASTA: pasta,
      ANV_TEST_CANARY: arquivoCanary,
      DISPLAY: ":0",
      ANVILORE_SEM_DIALOGO: "",
      AGENTISTICS_THROWAWAY: "",
      CI: "",
    };

    const proc = Bun.spawnSync(["bash", lancadorOriginal], { cwd: base, env, stdout: "pipe", stderr: "pipe" });
    expect(proc.exitCode).toBe(5);

    // Prova RED: sem o preload, o falso zenity é invocado e grava no canary
    expect(await Bun.file(arquivoCanary).exists()).toBe(true);
    const gravado = await readFile(arquivoCanary, "utf8");
    expect(gravado).toContain("zenity");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado estado com symlink malicioso, Quando verifico instância existente, Então não reutiliza e remove o link", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-symlink-estado-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const bin = join(base, "bin");
    const xdgRuntime = join(base, "run");
    const alvo = join(base, "alvo-secreto.txt");
    const uiChamada = join(base, "ui-chamada");

    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(bin, { recursive: true });
    await mkdir(xdgRuntime, { recursive: true });
    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    await writeFile(join(pasta, "package.json"), JSON.stringify({ version: "0.10.0" }));
    await writeFile(alvo, "conteudo confidencial");

    // Cria symlink apontando para arquivo alvo
    const link = join(xdgRuntime, "anvilore-ui.json");
    await symlink(alvo, link);

    const bun = join(bin, "bun");
    await writeFile(bun, `#!/bin/sh
if [ "$1" = "-e" ]; then
  exec "${process.execPath}" "$@"
fi
printf '%s\\n' "$*" >>"$ANV_TEST_UI"
exit 0
`);
    await chmod(bun, 0o755);

    const env = {
      ...process.env,
      HOME: home,
      PATH: `${bin}:/usr/bin:/bin`,
      XDG_RUNTIME_DIR: xdgRuntime,
      ANVILORE_PASTA: pasta,
      ANV_TEST_UI: uiChamada,
    };

    const proc = Bun.spawnSync(["bash", lancadorOriginal], { cwd: base, env, stdout: "pipe", stderr: "pipe" });
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);

    // O arquivo alvo original deve estar intacto
    expect(await readFile(alvo, "utf8")).toBe("conteudo confidencial");

    // O symlink deve ter sido destruído
    const linkAindaExiste = await stat(link).then(() => true).catch(() => false);
    expect(linkAindaExiste).toBe(false);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado pasta não instalada e ambiente gráfico sem terminal, Quando lançador é executado, Então reabre em emulador de terminal", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-reabre-terminal-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore ausente");
    const bin = join(base, "bin");
    const terminalChamado = join(base, "terminal-chamado");

    await mkdir(home, { recursive: true });
    await mkdir(bin, { recursive: true });

    // Mock de x-terminal-emulator
    const term = join(bin, "x-terminal-emulator");
    await writeFile(term, `#!/bin/sh
printf '%s\\n' "$*" >>"$ANV_TEST_TERM"
exit 0
`);
    await chmod(term, 0o755);

    // Mock de instalar.sh ao lado do lançador temporário
    const lancadorTemp = join(base, "anvilore-abrir");
    const scriptOriginal = await readFile(lancadorOriginal, "utf8");
    await writeFile(lancadorTemp, scriptOriginal);
    await chmod(lancadorTemp, 0o755);
    await writeFile(join(base, "instalar.sh"), "#!/bin/sh\nexit 0\n");

    const env = {
      ...process.env,
      HOME: home,
      PATH: `${bin}:/usr/bin:/bin`,
      ANVILORE_PASTA: pasta,
      ANV_TEST_TERM: terminalChamado,
      ANVILORE_TEST_DIALOGO: "1",
    };

    const proc = Bun.spawnSync(["bash", lancadorTemp], { cwd: base, env, stdout: "pipe", stderr: "pipe" });
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);

    expect(await Bun.file(terminalChamado).exists()).toBe(true);
    const termArgs = await readFile(terminalChamado, "utf8");
    expect(termArgs).toContain("-e env ANVILORE_EM_TERMINAL=1");
    expect(termArgs).toContain(lancadorTemp);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado atualização automática da pasta antiga (#69), Quando lançador roda sem janela, Então notifica via notify-send", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-notificacao-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const pacote = join(base, "usr/lib/anvilore");
    const bin = join(base, "bin");
    const notificacaoChamada = join(base, "notificacao-chamada");

    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(pacote, { recursive: true });
    await mkdir(bin, { recursive: true });
    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    await writeFile(join(pasta, "package.json"), JSON.stringify({ version: "0.9.0" }, null, 2));
    await writeFile(join(pacote, "VERSAO"), "0.10.0\n");

    const lancadorTemp = join(pacote, "anvilore-abrir");
    const scriptOriginal = await readFile(lancadorOriginal, "utf8");
    await writeFile(lancadorTemp, scriptOriginal);
    await chmod(lancadorTemp, 0o755);

    await writeFile(join(pacote, "instalar.sh"), `#!/bin/sh
sed 's/0.9.0/0.10.0/' "$ANVILORE_PASTA/package.json" >"$ANVILORE_PASTA/package.json.tmp"
mv "$ANVILORE_PASTA/package.json.tmp" "$ANVILORE_PASTA/package.json"
exit 0
`);
    await chmod(join(pacote, "instalar.sh"), 0o755);

    const notifySend = join(bin, "notify-send");
    await writeFile(notifySend, `#!/bin/sh
printf '%s\\n' "$*" >>"$ANV_TEST_NOTIFY"
exit 0
`);
    await chmod(notifySend, 0o755);

    const bun = join(bin, "bun");
    await writeFile(bun, `#!/bin/sh
exit 0
`);
    await chmod(bun, 0o755);

    const env = {
      ...process.env,
      HOME: home,
      PATH: `${bin}:/usr/bin:/bin`,
      ANVILORE_PASTA: pasta,
      ANV_TEST_NOTIFY: notificacaoChamada,
      ANVILORE_SEM_DIALOGO: "1",
    };

    const proc = Bun.spawnSync(["bash", lancadorTemp], { cwd: base, env, stdout: "pipe", stderr: "pipe" });
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);

    expect(await Bun.file(notificacaoChamada).exists()).toBe(true);
    const notifyArgs = await readFile(notificacaoChamada, "utf8");
    expect(notifyArgs).toContain("Atualizando o Anvilore de 0.9.0 para 0.10.0");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado uma versão mais nova disponível no pacote porém com servidor já ativo, Quando o lançador é executado, Então reaproveita a instância ativa e não executa a atualização (P3-4)", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-nao-atualiza-ativo-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const pacote = join(base, "usr/lib/anvilore");
    const bin = join(base, "bin");
    const instaladorChamado = join(base, "instalador-chamado");
    const xdgRuntime = join(base, "run");

    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(pacote, { recursive: true });
    await mkdir(bin, { recursive: true });
    await mkdir(xdgRuntime, { recursive: true });

    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    await writeFile(join(pasta, "package.json"), JSON.stringify({ version: "0.9.0" }, null, 2));
    await writeFile(join(pacote, "VERSAO"), "0.10.0\n");

    const lancadorTemp = join(pacote, "anvilore-abrir");
    const scriptOriginal = await readFile(lancadorOriginal, "utf8");
    await writeFile(lancadorTemp, scriptOriginal);
    await chmod(lancadorTemp, 0o755);

    await writeFile(join(pacote, "instalar.sh"), `#!/bin/sh
printf 'atualizou\\n' >>"${instaladorChamado}"
exit 0
`);
    await chmod(join(pacote, "instalar.sh"), 0o755);

    const xdgOpen = join(bin, "xdg-open");
    await writeFile(xdgOpen, `#!/bin/sh
exit 0
`);
    await chmod(xdgOpen, 0o755);

    const bun = join(bin, "bun");
    await writeFile(bun, `#!/bin/sh
if [ "$1" = "-e" ]; then
  exec "${process.execPath}" "$@"
fi
exit 0
`);
    await chmod(bun, 0o755);

    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("OK", { status: 200 });
      },
    });

    try {
      const estadoFile = join(xdgRuntime, "anvilore-ui.json");
      await writeFile(estadoFile, JSON.stringify({
        pid: process.pid,
        porta: server.port,
        token: "token-ativo",
        pasta,
        soRevisao: false,
      }, null, 2), { mode: 0o600 });

      const env = {
        ...process.env,
        HOME: home,
        PATH: `${bin}:/usr/bin:/bin`,
        ANVILORE_PASTA: pasta,
        XDG_RUNTIME_DIR: xdgRuntime,
        ANVILORE_SEM_DIALOGO: "1",
      };

      const proc = Bun.spawnSync(["bash", lancadorTemp], { cwd: base, env, stdout: "pipe", stderr: "pipe" });
      expect(proc.exitCode, proc.stderr.toString()).toBe(0);

      // Não deve ter chamado instalar.sh para atualizar porque a instância já estava ativa
      expect(await Bun.file(instaladorChamado).exists()).toBe(false);
    } finally {
      server.stop(true);
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado servidor com processo vivo porém com resposta HTTP lenta, Quando o lançador verifica a instância, Então preserva o estado e reabre o navegador na URL existente (P3-7)", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-timeout-launcher-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const bin = join(base, "bin");
    const xdgRuntime = join(base, "run");
    const navegadorChamado = join(base, "navegador-chamado");

    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(bin, { recursive: true });
    await mkdir(xdgRuntime, { recursive: true });

    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    await writeFile(join(pasta, "package.json"), JSON.stringify({ version: "0.10.0" }));

    const bun = join(bin, "bun");
    await writeFile(bun, `#!/bin/sh
if [ "$1" = "-e" ]; then
  exec "${process.execPath}" "$@"
fi
exit 0
`);
    await chmod(bun, 0o755);

    const xdgOpen = join(bin, "xdg-open");
    await writeFile(xdgOpen, `#!/bin/sh
printf '%s\\n' "$*" >>"${navegadorChamado}"
exit 0
`);
    await chmod(xdgOpen, 0o755);

    // Servidor que demora 3s para responder (induz timeout de 2000ms do fetch)
    const serverLento = Bun.serve({
      port: 0,
      async fetch() {
        await new Promise(r => setTimeout(r, 3000));
        return new Response("OK");
      },
    });

    try {
      const estadoFile = join(xdgRuntime, "anvilore-ui.json");
      await writeFile(estadoFile, JSON.stringify({
        pid: process.pid,
        porta: serverLento.port,
        token: "token-timeout",
        pasta,
        soRevisao: false,
      }, null, 2), { mode: 0o600 });

      const env = {
        ...process.env,
        HOME: home,
        PATH: `${bin}:/usr/bin:/bin`,
        ANVILORE_PASTA: pasta,
        XDG_RUNTIME_DIR: xdgRuntime,
        ANVILORE_SEM_DIALOGO: "1",
      };

      const proc = Bun.spawnSync(["bash", lancadorOriginal], { cwd: base, env, stdout: "pipe", stderr: "pipe" });
      expect(proc.exitCode, proc.stderr.toString()).toBe(0);

      // O arquivo de estado não deve ser apagado
      expect(await Bun.file(estadoFile).exists()).toBe(true);
      // O navegador deve ter sido aberto mesmo com o timeout do fetch
      for (let i = 0; i < 20; i++) {
        if (await Bun.file(navegadorChamado).exists()) break;
        await new Promise(r => setTimeout(r, 25));
      }
      expect(await Bun.file(navegadorChamado).exists()).toBe(true);
      const url = await readFile(navegadorChamado, "utf8");
      expect(url.trim()).toContain(`:${serverLento.port}/?token=token-timeout`);
    } finally {
      serverLento.stop(true);
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado dois lançamentos concorrentes sem instância prévia, Quando ambos executam simultaneamente, Então a trava atômica garante que apenas um servidor seja iniciado (P2-2)", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-trava-concorrente-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const bin = join(base, "bin");
    const xdgRuntime = join(base, "run");
    const contadorUi = join(base, "contador-ui");

    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(bin, { recursive: true });
    await mkdir(xdgRuntime, { recursive: true });

    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    await writeFile(join(pasta, "package.json"), JSON.stringify({ version: "0.10.0" }));

    const estadoFile = join(xdgRuntime, "anvilore-ui.json");
    const bun = join(bin, "bun");
    await writeFile(bun, `#!/bin/sh
if [ "$1" = "-e" ]; then
  exec "${process.execPath}" "$@"
fi
if [ "$1" = "src/cli.ts" ] && [ "$2" = "ui" ]; then
  printf 'iniciou\\n' >>"${contadorUi}"
  # Grava estado simulando servidor ativo
  cat <<EOF >"${estadoFile}"
{
  "pid": $$,
  "porta": 49123,
  "token": "token-lock",
  "pasta": "${pasta}",
  "soRevisao": false
}
EOF
  sleep 10 &
  wait $!
  exit 0
fi
exit 0
`);
    await chmod(bun, 0o755);

    const xdgOpen = join(bin, "xdg-open");
    await writeFile(xdgOpen, `#!/bin/sh
exit 0
`);
    await chmod(xdgOpen, 0o755);

    const server = Bun.serve({
      port: 49123,
      fetch() {
        return new Response("OK", { status: 200 });
      },
    });

    try {
      const env = {
        ...process.env,
        HOME: home,
        PATH: `${bin}:/usr/bin:/bin`,
        ANVILORE_PASTA: pasta,
        XDG_RUNTIME_DIR: xdgRuntime,
        ANVILORE_SEM_DIALOGO: "1",
      };

      const p1 = Bun.spawn(["bash", lancadorOriginal], { cwd: base, env, stdout: "pipe", stderr: "pipe" });
      const p2 = Bun.spawn(["bash", lancadorOriginal], { cwd: base, env, stdout: "pipe", stderr: "pipe" });

      const [c1, c2] = await Promise.all([p1.exited, p2.exited]);
      expect(c1).toBe(0);
      expect(c2).toBe(0);

      const contagem = (await readFile(contadorUi, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
      expect(contagem.length).toBe(1);
    } finally {
      server.stop(true);
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado processo com umask 0002, Quando o lançador desacoplado prepara log, Então o diretório é criado com permissão 0700 e o log com 0600 (P2-3, P3-2)", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-perm-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const bin = join(base, "bin");
    const xdgState = join(base, "state");

    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(bin, { recursive: true });

    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    await writeFile(join(pasta, "package.json"), JSON.stringify({ version: "0.10.0" }));

    const bun = join(bin, "bun");
    await writeFile(bun, `#!/bin/sh
exit 0
`);
    await chmod(bun, 0o755);

    const env = {
      ...process.env,
      HOME: home,
      PATH: `${bin}:/usr/bin:/bin`,
      ANVILORE_PASTA: pasta,
      XDG_STATE_HOME: xdgState,
      ANVILORE_SEM_DIALOGO: "1",
    };

    // Executa lançador com umask 0002 explícito
    const proc = Bun.spawnSync(["bash", "-c", `umask 0002; bash "${lancadorOriginal}"`], { cwd: base, env, stdout: "pipe", stderr: "pipe" });
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);

    const logDir = join(xdgState, "anvilore");
    const logFile = join(logDir, "abrir.log");

    const statDir = await stat(logDir);
    const modeDir = (statDir.mode & 0o777).toString(8);
    expect(modeDir).toBe("700");

    const statFile = await stat(logFile);
    const modeFile = (statFile.mode & 0o777).toString(8);
    expect(modeFile).toBe("600");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado falha ao subir o servidor sem terminal, Quando o diálogo de erro é exibido, Então contém as últimas linhas do erro com token mascarado, caminho do log e sem linha em branco inicial (P2-4)", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-dialogo-causa-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const bin = join(base, "bin");
    const xdgState = join(base, "state");
    const dialogoTexto = join(base, "dialogo-texto");

    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(bin, { recursive: true });

    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    await writeFile(join(pasta, "package.json"), JSON.stringify({ version: "0.10.0" }));

    // Fake bun que falha com código 3 e grava linhas de erro com token sensível
    const bun = join(bin, "bun");
    await writeFile(bun, `#!/bin/sh
if [ "$1" = "src/cli.ts" ] && [ "$2" = "ui" ]; then
  echo "Erro critico ao vincular porta 4173" >&2
  echo "Falha de autenticacao token=secreto_12345 no banco" >&2
  exit 3
fi
exit 0
`);
    await chmod(bun, 0o755);

    // Mock zenity que salva o texto do diálogo
    const zenity = join(bin, "zenity");
    await writeFile(zenity, `#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    --text=*) printf '%s' "\${arg#--text=}" >"${dialogoTexto}" ;;
  esac
done
exit 0
`);
    await chmod(zenity, 0o755);

    const env = {
      ...process.env,
      HOME: home,
      PATH: `${bin}:/usr/bin:/bin`,
      ANVILORE_PASTA: pasta,
      XDG_STATE_HOME: xdgState,
      DISPLAY: ":0",
      ANVILORE_TEST_DIALOGO: "1",
    };

    const proc = Bun.spawnSync(["bash", lancadorOriginal], { cwd: base, env, stdout: "pipe", stderr: "pipe" });
    expect(proc.exitCode).toBe(3);

    expect(await Bun.file(dialogoTexto).exists()).toBe(true);
    const texto = await readFile(dialogoTexto, "utf8");

    // Não deve começar com linha em branco
    expect(texto.startsWith("\n")).toBe(false);
    // Não deve conter a frase genérica antiga
    expect(texto).not.toContain("Confira a mensagem acima");
    // Deve conter detalhes das últimas linhas de erro
    expect(texto).toContain("Erro critico ao vincular porta 4173");
    // Deve mascarar o token
    expect(texto).toContain("token=[REDUZIDO]");
    expect(texto).not.toContain("secreto_12345");
    // Deve conter o caminho do log
    expect(texto).toContain(join(xdgState, "anvilore/abrir.log"));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado primeira instalação executada dentro do terminal com sucesso, Quando o instalador termina, Então exibe mensagem amigável, sai com código 0 e UI sobe desacoplada (P2-5)", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-primeira-inst-term-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const bin = join(base, "bin");
    const xdgRuntime = join(base, "run");

    await mkdir(bin, { recursive: true });
    await mkdir(xdgRuntime, { recursive: true });

    // Instalação simulada: instalar.sh cria os arquivos do kit
    const lancadorTemp = join(base, "anvilore-abrir");
    const scriptOriginal = await readFile(lancadorOriginal, "utf8");
    await writeFile(lancadorTemp, scriptOriginal);
    await chmod(lancadorTemp, 0o755);

    await writeFile(join(base, "instalar.sh"), `#!/bin/sh
mkdir -p "$ANVILORE_PASTA/.git" "$ANVILORE_PASTA/src" "$ANVILORE_PASTA/skills"
touch "$ANVILORE_PASTA/AGENTS.md" "$ANVILORE_PASTA/src/cli.ts"
echo '{"version":"0.10.0"}' >"$ANVILORE_PASTA/package.json"
exit 0
`);
    await chmod(join(base, "instalar.sh"), 0o755);

    const bun = join(bin, "bun");
    await writeFile(bun, `#!/bin/sh
if [ "$1" = "-e" ]; then
  exec "${process.execPath}" "$@"
fi
exit 0
`);
    await chmod(bun, 0o755);

    const env = {
      ...process.env,
      HOME: home,
      PATH: `${bin}:/usr/bin:/bin`,
      ANVILORE_PASTA: pasta,
      XDG_RUNTIME_DIR: xdgRuntime,
      ANVILORE_EM_TERMINAL: "1",
      ANVILORE_SEM_DIALOGO: "1",
    };

    const proc = Bun.spawnSync(["bash", lancadorTemp], { cwd: base, env, stdout: "pipe", stderr: "pipe" });
    const stdout = proc.stdout.toString();
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);
    // Deve avisar que está abrindo no navegador e fechar o terminal
    expect(stdout).toContain("Pronto, abrindo no navegador…");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado o script do lançador, Quando analisado seu conteúdo, Então não possui referências a AGENTISTICS_THROWAWAY nem CI (P3-1)", async () => {
  const conteudo = await readFile(lancadorOriginal, "utf8");
  expect(conteudo).not.toContain("AGENTISTICS_THROWAWAY");
  expect(conteudo).not.toContain("CI");
});

test("Dado lançamento desacoplado, Quando o processo é iniciado, Então utiliza setsid para desacoplar a sessão (P3-5)", async () => {
  if (process.platform !== "linux") return;
  const conteudo = await readFile(lancadorOriginal, "utf8");
  // O lançador deve utilizar setsid com fallback para nohup
  expect(conteudo).toContain("setsid");
  expect(conteudo).toContain("nohup");
});

test("Dado o lançador liberando a trava de inicialização, Quando uma mensagem é emitida para stderr após a liberação, Então a mensagem continua visível em stderr e não é silenciada (P2-A)", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-stderr-mudo-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const bin = join(base, "bin");

    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(bin, { recursive: true });

    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    await writeFile(join(pasta, "package.json"), JSON.stringify({ version: "0.10.0" }));

    const bun = join(bin, "bun");
    await writeFile(bun, `#!/bin/sh
if [ "$1" = "src/cli.ts" ] && [ "$2" = "ui" ]; then
  echo "falha critica na ui" >&2
  exit 7
fi
exit 0
`);
    await chmod(bun, 0o755);

    const env = {
      ...process.env,
      HOME: home,
      PATH: `${bin}:/usr/bin:/bin`,
      ANVILORE_PASTA: pasta,
      ANVILORE_SEM_DIALOGO: "1",
    };

    const proc = Bun.spawnSync(["bash", lancadorOriginal], {
      cwd: base,
      env,
      stdin: new TextEncoder().encode("\n"),
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = proc.stderr.toString();
    expect(proc.exitCode).toBe(7);
    expect(stderr).toContain("falha critica na ui");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado dois lançamentos simultâneos onde o servidor demora 8s para gravar estado, Quando ambos executam em paralelo, Então a trava aguarda a prontidão e produz apenas 1 início de servidor (P2-2, P3-A)", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-trava-8s-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const bin = join(base, "bin");
    const xdgRuntime = join(base, "run");
    const chamadas = join(base, "chamadas");

    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(bin, { recursive: true });
    await mkdir(xdgRuntime, { recursive: true });

    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    await writeFile(join(pasta, "package.json"), JSON.stringify({ version: "0.10.0" }));

    const estadoFile = join(xdgRuntime, "anvilore-ui.json");
    const bun = join(bin, "bun");
    await writeFile(bun, `#!/bin/sh
if [ "$1" = "-e" ]; then
  exec "${process.execPath}" "$@"
fi
if [ "$1" = "src/cli.ts" ] && [ "$2" = "ui" ]; then
  echo "start $$" >>"${chamadas}"
  sleep 8
  cat <<EOF >"${estadoFile}"
{
  "pid": $$,
  "porta": 45999,
  "token": "tok123",
  "pasta": "${pasta}",
  "soRevisao": false
}
EOF
  sleep 15 &
  wait $!
  exit 0
fi
exit 0
`);
    await chmod(bun, 0o755);

    const xdgOpen = join(bin, "xdg-open");
    await writeFile(xdgOpen, `#!/bin/sh
exit 0
`);
    await chmod(xdgOpen, 0o755);

    const server = Bun.serve({
      port: 45999,
      fetch() {
        return new Response("OK", { status: 200 });
      },
    });

    try {
      const env = {
        ...process.env,
        HOME: home,
        PATH: `${bin}:/usr/bin:/bin`,
        ANVILORE_PASTA: pasta,
        XDG_RUNTIME_DIR: xdgRuntime,
        ANVILORE_SEM_DIALOGO: "1",
      };

      const p1 = Bun.spawn(["bash", lancadorOriginal], { cwd: base, env, stdout: "pipe", stderr: "pipe" });
      const p2 = Bun.spawn(["bash", lancadorOriginal], { cwd: base, env, stdout: "pipe", stderr: "pipe" });

      const [c1, c2] = await Promise.all([p1.exited, p2.exited]);
      expect(c1).toBe(0);
      expect(c2).toBe(0);

      const starts = (await readFile(chamadas, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
      expect(starts.length).toBe(1);
    } finally {
      server.stop(true);
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}, 25000);

test("Dado arquivo de trava que é um symlink, Quando o lançador executa, Então recusa com erro e não desliga a trava em silêncio (P3-A)", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-trava-symlink-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const bin = join(base, "bin");
    const xdgRuntime = join(base, "run");

    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(bin, { recursive: true });
    await mkdir(xdgRuntime, { recursive: true });

    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    await writeFile(join(pasta, "package.json"), JSON.stringify({ version: "0.10.0" }));

    const bun = join(bin, "bun");
    await writeFile(bun, `#!/bin/sh\nexit 0\n`);
    await chmod(bun, 0o755);

    const lockTarget = join(base, "alvo-lock");
    await writeFile(lockTarget, "bloqueado");
    const lockFile = join(xdgRuntime, "anvilore-ui.lock");
    await symlink(lockTarget, lockFile);

    const env = {
      ...process.env,
      HOME: home,
      PATH: `${bin}:/usr/bin:/bin`,
      ANVILORE_PASTA: pasta,
      XDG_RUNTIME_DIR: xdgRuntime,
      ANVILORE_SEM_DIALOGO: "1",
    };

    const proc = Bun.spawnSync(["bash", lancadorOriginal], { cwd: base, env, stdout: "pipe", stderr: "pipe" });
    expect(proc.exitCode).toBe(1);
    const stderr = proc.stderr.toString();
    expect(stderr).toContain("symlink não é permitido");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado estado com PID vivo de outro processo e porta morta, Quando lançador executa, Então remove estado e sobe novo servidor (P2-C)", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-pid-reaproveitado-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const bin = join(base, "bin");
    const xdgRuntime = join(base, "run");
    const chamadas = join(base, "chamadas");

    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(bin, { recursive: true });
    await mkdir(xdgRuntime, { recursive: true });

    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    await writeFile(join(pasta, "package.json"), JSON.stringify({ version: "0.10.0" }));

    const procAlheio = Bun.spawn(["sleep", "60"]);

    try {
      const estadoFile = join(xdgRuntime, "anvilore-ui.json");
      await writeFile(estadoFile, JSON.stringify({
        pid: procAlheio.pid,
        porta: 45998,
        token: "tokX",
        pasta,
        soRevisao: false,
      }, null, 2), { mode: 0o600 });

      const bun = join(bin, "bun");
      await writeFile(bun, `#!/bin/sh
if [ "$1" = "-e" ]; then
  exec "${process.execPath}" "$@"
fi
if [ "$1" = "src/cli.ts" ] && [ "$2" = "ui" ]; then
  echo "start $$" >>"${chamadas}"
  cat <<EOF >"${estadoFile}"
{
  "pid": $$,
  "porta": 45999,
  "token": "tokNovo",
  "pasta": "${pasta}",
  "soRevisao": false
}
EOF
  sleep 15 &
  wait $!
  exit 0
fi
exit 0
`);
      await chmod(bun, 0o755);

      const env = {
        ...process.env,
        HOME: home,
        PATH: `${bin}:/usr/bin:/bin`,
        ANVILORE_PASTA: pasta,
        XDG_RUNTIME_DIR: xdgRuntime,
        ANVILORE_SEM_DIALOGO: "1",
      };

      const proc = Bun.spawnSync(["bash", lancadorOriginal], { cwd: base, env, stdout: "pipe", stderr: "pipe" });
      expect(proc.exitCode, proc.stderr.toString()).toBe(0);

      const starts = (await readFile(chamadas, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
      expect(starts.length).toBe(1);
    } finally {
      procAlheio.kill();
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}, 20000);

test("Dado pasta cujo caminho contém dois pontos (:), Quando lançador executa com servidor vivo, Então não corrompe a leitura de estado e reabre URL sem subir outro servidor (P2-2 QA3)", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-colon-"));
  try {
    const home = join(base, "home");
    // Pasta contendo dois pontos no nome
    const pasta = join(home, "An:vilore");
    const bin = join(base, "bin");
    const xdgRuntime = join(base, "run");
    const chamadas = join(base, "chamadas");
    const navegador = join(base, "navegador");

    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(bin, { recursive: true });
    await mkdir(xdgRuntime, { recursive: true });

    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    await writeFile(join(pasta, "package.json"), JSON.stringify({ version: "0.10.0" }));

    const bun = join(bin, "bun");
    await writeFile(bun, `#!/bin/sh
if [ "$1" = "-e" ]; then
  exec "${process.execPath}" "$@"
fi
if [ "$1" = "src/cli.ts" ] && [ "$2" = "ui" ]; then
  echo "start $$" >>"${chamadas}"
  exit 0
fi
exit 0
`);
    await chmod(bun, 0o755);

    const xdgOpen = join(bin, "xdg-open");
    await writeFile(xdgOpen, `#!/bin/sh
echo "$1" >>"${navegador}"
exit 0
`);
    await chmod(xdgOpen, 0o755);

    // Servidor real Bun na porta 45999
    const server = Bun.serve({
      port: 45999,
      fetch() {
        return new Response("OK", { status: 200 });
      },
    });

    try {
      // Obtém o starttime real do processo do teste para colocar no estado
      const statStr = await readFile(`/proc/${process.pid}/stat`, "utf8");
      const posP = statStr.lastIndexOf(")");
      const campos = statStr.slice(posP + 2).trim().split(/\s+/);
      const inicioProc = campos[19];

      const estadoFile = join(xdgRuntime, "anvilore-ui.json");
      await writeFile(estadoFile, JSON.stringify({
        pid: process.pid,
        porta: 45999,
        token: "tokColon",
        pasta,
        inicio: inicioProc,
        soRevisao: false,
      }, null, 2), { mode: 0o600 });

      const env = {
        ...process.env,
        HOME: home,
        PATH: `${bin}:/usr/bin:/bin`,
        ANVILORE_PASTA: pasta,
        XDG_RUNTIME_DIR: xdgRuntime,
        ANVILORE_SEM_DIALOGO: "1",
      };

      const proc = Bun.spawnSync(["bash", lancadorOriginal], { cwd: base, env, stdout: "pipe", stderr: "pipe" });
      expect(proc.exitCode, proc.stderr.toString()).toBe(0);

      // Não deve ter iniciado outro servidor (starts = 0)
      const starts = (await readFile(chamadas, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
      expect(starts.length).toBe(0);

      // Deve ter reaberto o navegador
      for (let i = 0; i < 20; i++) {
        if (await Bun.file(navegador).exists()) break;
        await new Promise(r => setTimeout(r, 25));
      }
      expect(await Bun.file(navegador).exists()).toBe(true);
      const url = await readFile(navegador, "utf8");
      expect(url.trim()).toContain(":45999/?token=tokColon");
    } finally {
      server.stop(true);
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado arquivo de trava que é um diretório, Quando lançador executa, Então rejeita com erro claro e não inicia servidor (P2-1 QA3)", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-trava-dir-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const bin = join(base, "bin");
    const xdgRuntime = join(base, "run");
    const chamadas = join(base, "chamadas");

    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(bin, { recursive: true });
    await mkdir(xdgRuntime, { recursive: true });

    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    await writeFile(join(pasta, "package.json"), JSON.stringify({ version: "0.10.0" }));

    const bun = join(bin, "bun");
    await writeFile(bun, `#!/bin/sh
echo "start $$" >>"${chamadas}"
exit 0
`);
    await chmod(bun, 0o755);

    // Cria a trava como um diretório
    const lockDir = join(xdgRuntime, "anvilore-ui.lock");
    await mkdir(lockDir, { recursive: true });

    const env = {
      ...process.env,
      HOME: home,
      PATH: `${bin}:/usr/bin:/bin`,
      ANVILORE_PASTA: pasta,
      XDG_RUNTIME_DIR: xdgRuntime,
      ANVILORE_SEM_DIALOGO: "1",
    };

    const proc = Bun.spawnSync(["bash", lancadorOriginal], { cwd: base, env, stdout: "pipe", stderr: "pipe" });
    // Deve sair com código 1
    expect(proc.exitCode).toBe(1);
    const stderr = proc.stderr.toString();
    expect(stderr).toContain("diretório");

    // Nenhum servidor deve ter sido iniciado
    const starts = (await readFile(chamadas, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
    expect(starts.length).toBe(0);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado segundo lançamento concorrente onde a trava fica ocupada por mais de 20s, Quando ocorre o timeout, Então sai com 0 sem exibir diálogo de erro (P3-1 QA3)", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-trava-timeout-ux-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const bin = join(base, "bin");
    const xdgRuntime = join(base, "run");
    const dialogoArquivo = join(base, "dialogo-aberto");

    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(bin, { recursive: true });
    await mkdir(xdgRuntime, { recursive: true });

    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    await writeFile(join(pasta, "package.json"), JSON.stringify({ version: "0.10.0" }));

    const bun = join(bin, "bun");
    await writeFile(bun, `#!/bin/sh
exit 0
`);
    await chmod(bun, 0o755);

    // Mock zenity para capturar se algum diálogo modal for aberto
    const zenity = join(bin, "zenity");
    await writeFile(zenity, `#!/bin/sh
echo "abriu zenity" >>"${dialogoArquivo}"
exit 0
`);
    await chmod(zenity, 0o755);

    // Segura a trava externamente via flock por 25s
    const lockFile = join(xdgRuntime, "anvilore-ui.lock");
    const procLock = Bun.spawn(["bash", "-c", `exec 9>"${lockFile}"; flock -x 9; sleep 25`]);

    try {
      // Aguarda 200ms para garantir que a trava externa foi adquirida
      await new Promise(r => setTimeout(r, 200));

      const env = {
        ...process.env,
        HOME: home,
        PATH: `${bin}:/usr/bin:/bin`,
        ANVILORE_PASTA: pasta,
        XDG_RUNTIME_DIR: xdgRuntime,
        DISPLAY: ":0",
        ANVILORE_TEST_DIALOGO: "1",
      };

      // Dispara o lançador que vai esperar na trava
      const proc = Bun.spawnSync(["bash", lancadorOriginal], { cwd: base, env, stdout: "pipe", stderr: "pipe" });

      // O segundo clique com início lento deve sair com 0
      expect(proc.exitCode, proc.stderr.toString()).toBe(0);

      // Não deve ter exibido diálogo modal
      expect(await Bun.file(dialogoArquivo).exists()).toBe(false);
    } finally {
      procLock.kill();
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}, 30000);

test("Dado uma instância ativa no modo só-revisão, Quando o lançador sem terminal executa, Então não reaproveita o servidor restrito e inicia uma instância completa (P2-1)", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-revisao-lancador-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const bin = join(base, "bin");
    const xdgRuntime = join(base, "run");
    const chamadas = join(base, "chamadas");

    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(bin, { recursive: true });
    await mkdir(xdgRuntime, { recursive: true });

    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    await writeFile(join(pasta, "package.json"), JSON.stringify({ version: "0.10.0" }));

    const bun = join(bin, "bun");
    await writeFile(bun, `#!/bin/sh
if [ "$1" = "-e" ]; then
  exec "${process.execPath}" "$@"
fi
if [ "$1" = "src/cli.ts" ] && [ "$2" = "ui" ]; then
  echo "start $$" >>"${chamadas}"
  exit 0
fi
exit 0
`);
    await chmod(bun, 0o755);

    // Servidor fake de revisão ativo na porta 49992
    const server = Bun.serve({
      port: 49992,
      fetch() {
        return new Response("OK", { status: 200 });
      },
    });

    try {
      const estadoFile = join(xdgRuntime, "anvilore-ui.json");
      await writeFile(estadoFile, JSON.stringify({
        pid: process.pid,
        porta: 49992,
        token: "tokRevisao",
        pasta,
        soRevisao: true,
      }, null, 2), { mode: 0o600 });

      const env = {
        ...process.env,
        HOME: home,
        PATH: `${bin}:/usr/bin:/bin`,
        ANVILORE_PASTA: pasta,
        XDG_RUNTIME_DIR: xdgRuntime,
        ANVILORE_SEM_DIALOGO: "1",
      };

      const proc = Bun.spawnSync(["bash", lancadorOriginal], { cwd: base, env, stdout: "pipe", stderr: "pipe" });
      expect(proc.exitCode, proc.stderr.toString()).toBe(0);

      // Deve ter iniciado um servidor completo (starts = 1)
      const starts = (await readFile(chamadas, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
      expect(starts.length).toBe(1);
    } finally {
      server.stop(true);
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado estado antigo sem campo soRevisao, Quando lançador sem terminal executa, Então trata como incompatível, não reaproveita e sobe novo servidor (P2-1)", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-estado-legado-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const bin = join(base, "bin");
    const xdgRuntime = join(base, "run");
    const chamadas = join(base, "chamadas");

    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(bin, { recursive: true });
    await mkdir(xdgRuntime, { recursive: true });

    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    await writeFile(join(pasta, "package.json"), JSON.stringify({ version: "0.10.0" }));

    const bun = join(bin, "bun");
    await writeFile(bun, `#!/bin/sh
if [ "$1" = "-e" ]; then
  exec "${process.execPath}" "$@"
fi
if [ "$1" = "src/cli.ts" ] && [ "$2" = "ui" ]; then
  echo "start $$" >>"${chamadas}"
  exit 0
fi
exit 0
`);
    await chmod(bun, 0o755);

    const server = Bun.serve({
      port: 49993,
      fetch() {
        return new Response("OK", { status: 200 });
      },
    });

    try {
      const estadoFile = join(xdgRuntime, "anvilore-ui.json");
      await writeFile(estadoFile, JSON.stringify({
        pid: process.pid,
        porta: 49993,
        token: "tokLegado",
        pasta,
      }, null, 2), { mode: 0o600 });

      const env = {
        ...process.env,
        HOME: home,
        PATH: `${bin}:/usr/bin:/bin`,
        ANVILORE_PASTA: pasta,
        XDG_RUNTIME_DIR: xdgRuntime,
        ANVILORE_SEM_DIALOGO: "1",
      };

      const proc = Bun.spawnSync(["bash", lancadorOriginal], { cwd: base, env, stdout: "pipe", stderr: "pipe" });
      expect(proc.exitCode, proc.stderr.toString()).toBe(0);

      const starts = (await readFile(chamadas, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
      expect(starts.length).toBe(1);

      expect(await Bun.file(estadoFile).exists()).toBe(true);
    } finally {
      server.stop(true);
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado estado só-revisão preservado e servidor novo que demora a gravar o estado, Quando dois lançadores sem terminal executam em sequência, Então só um servidor completo é iniciado (P2 rodada 2)", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-revisao-espera-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const bin = join(base, "bin");
    const xdgRuntime = join(base, "run");
    const chamadas = join(base, "chamadas");

    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(bin, { recursive: true });
    await mkdir(xdgRuntime, { recursive: true });

    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    await writeFile(join(pasta, "package.json"), JSON.stringify({ version: "0.10.0" }));

    const estadoFile = join(xdgRuntime, "anvilore-ui.json");
    const bun = join(bin, "bun");
    await writeFile(bun, `#!/bin/sh
if [ "$1" = "-e" ]; then
  exec "${process.execPath}" "$@"
fi
if [ "$1" = "src/cli.ts" ] && [ "$2" = "ui" ]; then
  echo "start $$" >>"${chamadas}"
  sleep 1.5
  cat <<EOF >"${estadoFile}"
{
  "pid": $$,
  "porta": 45999,
  "token": "tokNovoCompleto",
  "pasta": "${pasta}",
  "soRevisao": false
}
EOF
  sleep 10 &
  wait $!
  exit 0
fi
exit 0
`);
    await chmod(bun, 0o755);

    const xdgOpen = join(bin, "xdg-open");
    await writeFile(xdgOpen, `#!/bin/sh
exit 0
`);
    await chmod(xdgOpen, 0o755);

    const serverRevisao = Bun.serve({
      port: 49992,
      fetch() {
        return new Response("OK", { status: 200 });
      },
    });

    const serverCompleto = Bun.serve({
      port: 45999,
      fetch() {
        return new Response("OK", { status: 200 });
      },
    });

    try {
      await writeFile(estadoFile, JSON.stringify({
        pid: process.pid,
        porta: 49992,
        token: "tokRevisao",
        pasta,
        soRevisao: true,
      }, null, 2), { mode: 0o600 });

      const env = {
        ...process.env,
        HOME: home,
        PATH: `${bin}:/usr/bin:/bin`,
        ANVILORE_PASTA: pasta,
        XDG_RUNTIME_DIR: xdgRuntime,
        ANVILORE_SEM_DIALOGO: "1",
      };

      const p1 = Bun.spawn(["bash", lancadorOriginal], { cwd: base, env, stdout: "pipe", stderr: "pipe" });
      await new Promise(r => setTimeout(r, 100));
      const p2 = Bun.spawn(["bash", lancadorOriginal], { cwd: base, env, stdout: "pipe", stderr: "pipe" });

      const [c1, c2] = await Promise.all([p1.exited, p2.exited]);
      expect(c1).toBe(0);
      expect(c2).toBe(0);

      const starts = (await readFile(chamadas, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
      expect(starts.length).toBe(1);
    } finally {
      serverRevisao.stop(true);
      serverCompleto.stop(true);
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado estado de outro pid gravado no arquivo, Quando o lançador aguarda prontidão, Então não libera a trava prematuramente e aguarda o próprio servidor (P2 unitário prontidão)", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-outro-pid-trava-"));
  try {
    const home = join(base, "home");
    const pasta = join(home, "Anvilore");
    const bin = join(base, "bin");
    const xdgRuntime = join(base, "run");
    const chamadas = join(base, "chamadas");

    await mkdir(join(pasta, ".git"), { recursive: true });
    await mkdir(join(pasta, "src"), { recursive: true });
    await mkdir(join(pasta, "skills"), { recursive: true });
    await mkdir(bin, { recursive: true });
    await mkdir(xdgRuntime, { recursive: true });

    await writeFile(join(pasta, "AGENTS.md"), "");
    await writeFile(join(pasta, "src/cli.ts"), "");
    await writeFile(join(pasta, "package.json"), JSON.stringify({ version: "0.10.0" }));

    const estadoFile = join(xdgRuntime, "anvilore-ui.json");
    const travaFile = join(xdgRuntime, "anvilore-ui.lock");
    const bun = join(bin, "bun");

    // O fake bun demora 800ms para sobrescrever o estado com seu próprio PID
    await writeFile(bun, `#!/bin/sh
if [ "$1" = "-e" ]; then
  exec "${process.execPath}" "$@"
fi
if [ "$1" = "src/cli.ts" ] && [ "$2" = "ui" ]; then
  echo "start $$" >>"${chamadas}"
  sleep 0.8
  cat <<EOF >"${estadoFile}"
{
  "pid": $$,
  "porta": 45999,
  "token": "tokNovo",
  "pasta": "${pasta}",
  "soRevisao": false
}
EOF
  sleep 10 &
  wait $!
  exit 0
fi
exit 0
`);
    await chmod(bun, 0o755);

    const xdgOpen = join(bin, "xdg-open");
    await writeFile(xdgOpen, `#!/bin/sh
exit 0
`);
    await chmod(xdgOpen, 0o755);

    try {
      // Estado existente apontando para outro PID
      await writeFile(estadoFile, JSON.stringify({
        pid: 999998,
        porta: 49998,
        token: "tokOutro",
        pasta,
        soRevisao: false,
      }, null, 2), { mode: 0o600 });

      const env = {
        ...process.env,
        HOME: home,
        PATH: `${bin}:/usr/bin:/bin`,
        ANVILORE_PASTA: pasta,
        XDG_RUNTIME_DIR: xdgRuntime,
        ANVILORE_SEM_DIALOGO: "1",
      };

      const proc = Bun.spawn(["bash", lancadorOriginal], { cwd: base, env, stdout: "pipe", stderr: "pipe" });

      // Em 200ms, o servidor novo ainda não gravou seu estado (está no sleep 0.8)
      // O estado antigo pertence a outro PID (999998).
      // A trava AINDA DEVE ESTAR RETIDA (o flock não pode ter sido liberado prematuramente)
      await new Promise(r => setTimeout(r, 200));
      const testePreso = Bun.spawnSync(["flock", "-n", travaFile, "true"]);
      expect(testePreso.exitCode).not.toBe(0);

      const codigo = await proc.exited;
      expect(codigo).toBe(0);

      // Ao final, o flock foi liberado e o servidor próprio foi gravado
      const testeLivre = Bun.spawnSync(["flock", "-n", travaFile, "true"]);
      expect(testeLivre.exitCode).toBe(0);
      const conteudoFinal = JSON.parse(await readFile(estadoFile, "utf8"));
      expect(conteudoFinal.token).toBe("tokNovo");
    } finally {
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado estado de outro pid ou só-revisão, Quando estado_pronto_para_servidor é avaliado, Então recusa prontidão (P2 unitário estado_pronto)", async () => {
  if (process.platform !== "linux") return;
  const base = await mkdtemp(join(tmpdir(), "anvilore-unit-pronto-"));
  try {
    const estadoFile = join(base, "anvilore-ui.json");
    const script = join(base, "teste-pronto.sh");

    await writeFile(script, `#!/bin/bash
BUN_BIN="${process.execPath}"
source <(sed -n '/estado_pronto_para_servidor()/,/^}/p' "${lancadorOriginal}")
estado_pronto_para_servidor "$1" "$2" "$3"
`);
    await chmod(script, 0o755);

    // 1. Estado só-revisão com mesmo PID -> deve recusar
    await writeFile(estadoFile, JSON.stringify({
      pid: process.pid,
      porta: 4173,
      token: "tok",
      pasta: base,
      soRevisao: true,
    }));
    const r1 = Bun.spawnSync(["bash", script, estadoFile, String(process.pid), base]);
    expect(r1.exitCode).not.toBe(0);

    // 2. Estado de outro PID -> deve recusar
    await writeFile(estadoFile, JSON.stringify({
      pid: 999999,
      porta: 4173,
      token: "tok",
      pasta: base,
      soRevisao: false,
    }));
    const r2 = Bun.spawnSync(["bash", script, estadoFile, String(process.pid), base]);
    expect(r2.exitCode).not.toBe(0);

    // 3. Estado com pasta divergente -> deve recusar
    await writeFile(estadoFile, JSON.stringify({
      pid: process.pid,
      porta: 4173,
      token: "tok",
      pasta: "/outra/pasta",
      soRevisao: false,
    }));
    const r3 = Bun.spawnSync(["bash", script, estadoFile, String(process.pid), base]);
    expect(r3.exitCode).not.toBe(0);

    // 4. Estado compatível com mesmo PID e pasta -> deve aceitar
    await writeFile(estadoFile, JSON.stringify({
      pid: process.pid,
      porta: 4173,
      token: "tok",
      pasta: base,
      soRevisao: false,
    }));
    const r4 = Bun.spawnSync(["bash", script, estadoFile, String(process.pid), base]);
    expect(r4.exitCode).toBe(0);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
