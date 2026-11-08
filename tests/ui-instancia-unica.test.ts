import { expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  caminhoEstadoUi,
  gravarEstadoUi,
  obterEstadoUi,
  removerEstadoUi,
  verificarInstanciaExistente,
} from "../src/lib/ui-estado";

test("Dado XDG_RUNTIME_DIR definido, Quando obtenho caminho do estado, Então usa o diretório de runtime", () => {
  const caminho = caminhoEstadoUi("/tmp/minha-wiki", { XDG_RUNTIME_DIR: "/run/user/1000" });
  expect(caminho).toMatch(/^\/run\/user\/1000\/anvilore-ui-[a-f0-9]{16}\.json$/);
});

test("Dado XDG_RUNTIME_DIR ausente e XDG_STATE_HOME definido, Quando obtenho caminho do estado, Então usa anvilore sob state home", () => {
  const caminho = caminhoEstadoUi("/tmp/minha-wiki", { XDG_STATE_HOME: "/tmp/state" });
  expect(caminho).toMatch(/^\/tmp\/state\/anvilore\/anvilore-ui-[a-f0-9]{16}\.json$/);
});

test("Dado gravação do estado, Quando gravo dados da instância, Então o arquivo tem modo 0600 e conteúdo JSON válido", async () => {
  const base = await mkdtemp(join(tmpdir(), "anvilore-estado-"));
  try {
    const estado = {
      pid: process.pid,
      porta: 4173,
      token: "meu-token-seguro",
      pasta: "/caminho/minha-wiki",
    };
    await gravarEstadoUi(estado, { XDG_STATE_HOME: base });
    const lido = await obterEstadoUi(estado.pasta, { XDG_STATE_HOME: base });
    expect(lido).toEqual(estado);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado arquivo de estado que é symlink, Quando tento ler, Então recusa reutilizar e não segue o link", async () => {
  const base = await mkdtemp(join(tmpdir(), "anvilore-symlink-"));
  try {
    const dir = join(base, "anvilore");
    await mkdir(dir, { recursive: true });
    const alvo = join(base, "alvo.json");
    await writeFile(alvo, JSON.stringify({ pid: process.pid, porta: 4173, token: "tk", pasta: "/pasta" }));
    const caminho = caminhoEstadoUi("/pasta", { XDG_STATE_HOME: base });
    await symlink(alvo, caminho);

    const lido = await obterEstadoUi("/pasta", { XDG_STATE_HOME: base });
    expect(lido).toBeNull();
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado estado com processo morto, Quando verifico instância existente, Então apaga o estado e relata inativo", async () => {
  const base = await mkdtemp(join(tmpdir(), "anvilore-morto-"));
  try {
    // PID 999999 provavelmente não existe
    const estado = {
      pid: 999999,
      porta: 4173,
      token: "tk",
      pasta: "/pasta/inexistente",
    };
    await gravarEstadoUi(estado, { XDG_STATE_HOME: base });
    const resultado = await verificarInstanciaExistente("/pasta/inexistente", { XDG_STATE_HOME: base });
    expect(resultado.ativa).toBe(false);
    expect(await obterEstadoUi("/pasta/inexistente", { XDG_STATE_HOME: base })).toBeNull();
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado servidor com processo vivo porém com resposta HTTP lenta, Quando a verificação sofre timeout, Então o arquivo de estado é preservado e a URL é reaberta", async () => {
  const base = await mkdtemp(join(tmpdir(), "anvilore-timeout-vivo-"));
  try {
    const serverLento = Bun.serve({
      port: 0,
      async fetch() {
        await new Promise(r => setTimeout(r, 3000));
        return new Response("OK");
      },
    });

    try {
      const estado = {
        pid: process.pid,
        porta: serverLento.port as number,
        token: "token-timeout-vivo",
        pasta: base,
      };
      await gravarEstadoUi(estado, { XDG_STATE_HOME: base });

      const resultado = await verificarInstanciaExistente(base, { XDG_STATE_HOME: base });

      expect(resultado.ativa).toBe(true);
      expect(resultado.url).toContain(`:${serverLento.port}/?token=token-timeout-vivo`);

      const estadoAindaExiste = await obterEstadoUi(base, { XDG_STATE_HOME: base });
      expect(estadoAindaExiste).not.toBeNull();
      expect(estadoAindaExiste?.porta).toBe(serverLento.port);
    } finally {
      serverLento.stop(true);
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado estado com PID vivo de outro processo e porta morta, Quando verifico instância existente, Então remove o estado e retorna inativa (P2-C)", async () => {
  const base = await mkdtemp(join(tmpdir(), "anvilore-pid-reaproveitado-unit-"));
  const procAlheio = Bun.spawn(["sleep", "60"]);
  try {
    const estado = {
      pid: procAlheio.pid,
      porta: 45998,
      token: "tokX",
      pasta: base,
    };
    await gravarEstadoUi(estado, { XDG_STATE_HOME: base });

    const resultado = await verificarInstanciaExistente(base, { XDG_STATE_HOME: base });
    expect(resultado.ativa).toBe(false);

    const estadoApos = await obterEstadoUi(base, { XDG_STATE_HOME: base });
    expect(estadoApos).toBeNull();
  } finally {
    procAlheio.kill();
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado instância em execução em modo só-revisão, Quando verifico instância existente para uso completo, Então relata inativo e preserva o estado (P2-1)", async () => {
  const base = await mkdtemp(join(tmpdir(), "anvilore-revisao-incompativel-"));
  try {
    const estado = {
      pid: process.pid,
      porta: 49991,
      token: "tok-revisao",
      pasta: base,
      soRevisao: true,
    };
    await gravarEstadoUi(estado, { XDG_STATE_HOME: base });

    // Pedido completo (soRevisao: false) não deve reaproveitar a instância de revisão
    const resultado = await verificarInstanciaExistente(base, { XDG_STATE_HOME: base }, { soRevisao: false });
    expect(resultado.ativa).toBe(false);

    // O estado da revisão deve continuar preservado para seu próprio watchdog
    const estadoGravado = await obterEstadoUi(base, { XDG_STATE_HOME: base });
    expect(estadoGravado).not.toBeNull();
    expect(estadoGravado?.soRevisao).toBe(true);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado servidor ativo na pasta A, Quando a rota /api/onboarding/pasta troca para a pasta B, Então o estado é regravado apontando para B e A fica inativa (P2-3)", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "anvilore-troca-pasta-")));
  try {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { iniciarServidorUi } = await import("../src/ui/servidor/servidor");
    const { PonteClaudeCode } = await import("../src/lib/ponte-claude-code");
    class PonteFalsa extends PonteClaudeCode {
      override async disponibilidade() {
        return { ok: true as const, binario: "claude", versao: "fake" };
      }
    }

    const home = join(base, "home");
    const pastaA = join(home, "vault-a");
    const pastaB = join(home, "vault-b");
    const xdgRuntime = join(base, "run");
    await mkdir(xdgRuntime, { recursive: true });

    await mkdir(join(pastaA, "wiki"), { recursive: true });
    await writeFile(join(pastaA, "SCHEMA.md"), "# Schema\n");
    await writeFile(join(pastaA, "AGENTS.md"), "# Agentes\n");

    await mkdir(join(pastaB, "wiki"), { recursive: true });
    await writeFile(join(pastaB, "SCHEMA.md"), "# Schema\n");
    await writeFile(join(pastaB, "AGENTS.md"), "# Agentes\n");

    const ambiente = { ...process.env, HOME: home, XDG_RUNTIME_DIR: xdgRuntime };

    const app = await iniciarServidorUi(pastaA, {
      portaInicial: 0,
      token: "tok-troca-pasta",
      abrirNavegador: false,
      ponte: new PonteFalsa(),
      ambiente,
    });

    try {
      // Grava o estado inicial apontando para pastaA
      await gravarEstadoUi({
        pid: process.pid,
        porta: app.porta!,
        token: app.token,
        pasta: pastaA,
        soRevisao: false,
      }, ambiente);

      // Confere que pastaA está ativa inicialmente
      const instAInicial = await verificarInstanciaExistente(pastaA, ambiente);
      expect(instAInicial.ativa).toBe(true);

      // Troca para pastaB via POST /api/onboarding/pasta
      const res = await fetch(`http://127.0.0.1:${app.porta}/api/onboarding/pasta?token=${app.token}`, {
        method: "POST",
        headers: {
          origin: `http://127.0.0.1:${app.porta}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ pasta: pastaB }),
      });
      expect(res.status).toBe(200);

      // Após a troca: pastaA deve ser inativa e pastaB deve ser ativa
      const instA = await verificarInstanciaExistente(pastaA, ambiente);
      expect(instA.ativa).toBe(false);

      const instB = await verificarInstanciaExistente(pastaB, ambiente);
      expect(instB.ativa).toBe(true);
      expect(instB.url).toContain(`:${app.porta}/?token=${app.token}`);
    } finally {
      await app.encerrar();
      app.servidor.stop(true);
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado arquivo de estado pertencente a outro PID, Quando a rota /api/onboarding/pasta troca de cofre, Então o arquivo de estado não é alterado (P2-3 ajuste)", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "anvilore-outro-pid-")));
  try {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { iniciarServidorUi } = await import("../src/ui/servidor/servidor");
    const { PonteClaudeCode } = await import("../src/lib/ponte-claude-code");
    class PonteFalsa extends PonteClaudeCode {
      override async disponibilidade() {
        return { ok: true as const, binario: "claude", versao: "fake" };
      }
    }

    const home = join(base, "home");
    const pastaA = join(home, "vault-a");
    const pastaB = join(home, "vault-b");
    const xdgRuntime = join(base, "run");
    await mkdir(xdgRuntime, { recursive: true });

    await mkdir(join(pastaA, "wiki"), { recursive: true });
    await writeFile(join(pastaA, "SCHEMA.md"), "# Schema\n");
    await writeFile(join(pastaA, "AGENTS.md"), "# Agentes\n");

    await mkdir(join(pastaB, "wiki"), { recursive: true });
    await writeFile(join(pastaB, "SCHEMA.md"), "# Schema\n");
    await writeFile(join(pastaB, "AGENTS.md"), "# Agentes\n");

    const ambiente = { ...process.env, HOME: home, XDG_RUNTIME_DIR: xdgRuntime };

    const app = await iniciarServidorUi(pastaA, {
      portaInicial: 0,
      token: "tok-servidor-atual",
      abrirNavegador: false,
      ponte: new PonteFalsa(),
      ambiente,
    });

    try {
      // Grava o arquivo de estado como se pertencesse a OUTRO servidor/PID
      const estadoOutro = {
        pid: 999999,
        porta: 54321,
        token: "tok-outro-servidor",
        pasta: pastaA,
        soRevisao: false,
      };
      await gravarEstadoUi(estadoOutro, ambiente);

      // Troca para pastaB via POST /api/onboarding/pasta no servidor atual
      const res = await fetch(`http://127.0.0.1:${app.porta}/api/onboarding/pasta?token=${app.token}`, {
        method: "POST",
        headers: {
          origin: `http://127.0.0.1:${app.porta}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ pasta: pastaB }),
      });
      expect(res.status).toBe(200);

      // O arquivo de estado NÃO pode ter sido alterado pelo servidor atual
      const estadoApos = await obterEstadoUi(pastaA, ambiente);
      expect(estadoApos?.pid).toBe(999999);
      expect(estadoApos?.token).toBe("tok-outro-servidor");
      expect(estadoApos?.pasta).toBe(pastaA);
      expect(estadoApos?.porta).toBe(54321);
      expect(await obterEstadoUi(pastaB, ambiente)).toBeNull();
    } finally {
      await app.encerrar();
      app.servidor.stop(true);
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado servidor ativo sem arquivo de estado gravado, Quando a rota /api/onboarding/pasta troca de cofre, Então nenhum arquivo de estado é criado (P2-3 ajuste)", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "anvilore-sem-estado-")));
  try {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { iniciarServidorUi } = await import("../src/ui/servidor/servidor");
    const { PonteClaudeCode } = await import("../src/lib/ponte-claude-code");
    class PonteFalsa extends PonteClaudeCode {
      override async disponibilidade() {
        return { ok: true as const, binario: "claude", versao: "fake" };
      }
    }

    const home = join(base, "home");
    const pastaA = join(home, "vault-a");
    const pastaB = join(home, "vault-b");
    const xdgRuntime = join(base, "run");
    await mkdir(xdgRuntime, { recursive: true });

    await mkdir(join(pastaA, "wiki"), { recursive: true });
    await writeFile(join(pastaA, "SCHEMA.md"), "# Schema\n");
    await writeFile(join(pastaA, "AGENTS.md"), "# Agentes\n");

    await mkdir(join(pastaB, "wiki"), { recursive: true });
    await writeFile(join(pastaB, "SCHEMA.md"), "# Schema\n");
    await writeFile(join(pastaB, "AGENTS.md"), "# Agentes\n");

    const ambiente = { ...process.env, HOME: home, XDG_RUNTIME_DIR: xdgRuntime };

    // Inicia servidor diretamente sem gravar estado
    const app = await iniciarServidorUi(pastaA, {
      portaInicial: 0,
      token: "tok-sem-estado",
      abrirNavegador: false,
      ponte: new PonteFalsa(),
      ambiente,
    });

    try {
      expect(await obterEstadoUi(pastaA, ambiente)).toBeNull();

      // Troca para pastaB via POST /api/onboarding/pasta
      const res = await fetch(`http://127.0.0.1:${app.porta}/api/onboarding/pasta?token=${app.token}`, {
        method: "POST",
        headers: {
          origin: `http://127.0.0.1:${app.porta}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ pasta: pastaB }),
      });
      expect(res.status).toBe(200);

      // Como o servidor nunca gravou estado, a troca NÃO deve criar arquivo de estado
      expect(await obterEstadoUi(pastaA, ambiente)).toBeNull();
      expect(await obterEstadoUi(pastaB, ambiente)).toBeNull();
    } finally {
      await app.encerrar();
      app.servidor.stop(true);
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado servidor do cofre A ativo, Quando abro o cofre B, Então o registro de A continua e reabrir A reaproveita o servidor de A (Item A)", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "anvilore-dois-cofres-")));
  try {
    const home = join(base, "home");
    const pastaA = join(home, "vault-a");
    const pastaB = join(home, "vault-b");
    const xdgRuntime = join(base, "run");
    await mkdir(xdgRuntime, { recursive: true });

    await mkdir(pastaA, { recursive: true });
    await mkdir(pastaB, { recursive: true });

    const ambiente = { ...process.env, HOME: home, XDG_RUNTIME_DIR: xdgRuntime };

    const serverA = Bun.serve({ port: 0, fetch() { return new Response("OK", { status: 200 }); } });
    const serverB = Bun.serve({ port: 0, fetch() { return new Response("OK", { status: 200 }); } });

    try {
      await gravarEstadoUi({
        pid: process.pid,
        porta: serverA.port!,
        token: "tokA",
        pasta: pastaA,
        soRevisao: false,
      }, ambiente);

      await gravarEstadoUi({
        pid: process.pid,
        porta: serverB.port!,
        token: "tokB",
        pasta: pastaB,
        soRevisao: false,
      }, ambiente);

      const instA = await verificarInstanciaExistente(pastaA, ambiente);
      expect(instA.ativa).toBe(true);
      expect(instA.estado?.token).toBe("tokA");

      const instB = await verificarInstanciaExistente(pastaB, ambiente);
      expect(instB.ativa).toBe(true);
      expect(instB.estado?.token).toBe("tokB");
    } finally {
      serverA.stop(true);
      serverB.stop(true);
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado o mesmo cofre por caminho real e por symlink, Quando calculo o caminho do estado no TS e no lançador, Então os dois são iguais (Item A)", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "anvilore-paridade-")));
  try {
    const pastaReal = join(base, "real");
    const pastaLink = join(base, "link");
    await mkdir(pastaReal, { recursive: true });
    await symlink(pastaReal, pastaLink);

    const xdgRuntime = join(base, "run");
    await mkdir(xdgRuntime, { recursive: true });
    const ambiente = { ...process.env, XDG_RUNTIME_DIR: xdgRuntime };

    const caminhoTsReal = caminhoEstadoUi(pastaReal, ambiente);
    const caminhoTsLink = caminhoEstadoUi(pastaLink, ambiente);
    expect(caminhoTsReal).toBe(caminhoTsLink);

    const lancadorOriginal = resolve(import.meta.dir, "../instalador/anvilore-abrir");
    const procBashReal = Bun.spawnSync([
      "bash", "-c",
      `BUN_BIN="${process.execPath}"; eval "$(sed -n '/obter_chave_cofre()/,/^}/p;/obter_caminho_estado()/,/^}/p' "${lancadorOriginal}")"; obter_caminho_estado "$1"`,
      "_", pastaReal,
    ], { env: ambiente });
    const procBashLink = Bun.spawnSync([
      "bash", "-c",
      `BUN_BIN="${process.execPath}"; eval "$(sed -n '/obter_chave_cofre()/,/^}/p;/obter_caminho_estado()/,/^}/p' "${lancadorOriginal}")"; obter_caminho_estado "$1"`,
      "_", pastaLink,
    ], { env: ambiente });

    const caminhoBashReal = procBashReal.stdout.toString().trim();
    const caminhoBashLink = procBashLink.stdout.toString().trim();

    expect(caminhoBashReal).toBe(caminhoTsReal);
    expect(caminhoBashLink).toBe(caminhoTsLink);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Dado cofre B já aberto por outro servidor, Quando troco o cofre A para B pela rota, Então recebo 409 e nada muda (Item A)", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "anvilore-troca-409-")));
  try {
    const { iniciarServidorUi } = await import("../src/ui/servidor/servidor");
    const { PonteClaudeCode } = await import("../src/lib/ponte-claude-code");
    class PonteFalsa extends PonteClaudeCode {
      override async disponibilidade() {
        return { ok: true as const, binario: "claude", versao: "fake" };
      }
    }

    const home = join(base, "home");
    const pastaA = join(home, "vault-a");
    const pastaB = join(home, "vault-b");
    const xdgRuntime = join(base, "run");
    await mkdir(xdgRuntime, { recursive: true });

    await mkdir(join(pastaA, "wiki"), { recursive: true });
    await writeFile(join(pastaA, "SCHEMA.md"), "# Schema\n");
    await writeFile(join(pastaA, "AGENTS.md"), "# Agentes\n");

    await mkdir(join(pastaB, "wiki"), { recursive: true });
    await writeFile(join(pastaB, "SCHEMA.md"), "# Schema\n");
    await writeFile(join(pastaB, "AGENTS.md"), "# Agentes\n");

    const ambiente = { ...process.env, HOME: home, XDG_RUNTIME_DIR: xdgRuntime };

    const serverOutroB = Bun.serve({ port: 0, fetch() { return new Response("OK", { status: 200 }); } });
    await gravarEstadoUi({
      pid: process.pid,
      porta: serverOutroB.port!,
      token: "tok-outro-b",
      pasta: pastaB,
      soRevisao: false,
    }, ambiente);

    const appA = await iniciarServidorUi(pastaA, {
      portaInicial: 0,
      token: "tok-servidor-a",
      abrirNavegador: false,
      ponte: new PonteFalsa(),
      ambiente,
    });

    try {
      await gravarEstadoUi({
        pid: process.pid,
        porta: appA.porta!,
        token: appA.token,
        pasta: pastaA,
        soRevisao: false,
      }, ambiente);

      const res = await fetch(`http://127.0.0.1:${appA.porta}/api/onboarding/pasta?token=${appA.token}`, {
        method: "POST",
        headers: {
          origin: `http://127.0.0.1:${appA.porta}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ pasta: pastaB }),
      });

      expect(res.status).toBe(409);
      const corpo = await res.json() as { erro?: string };
      expect(corpo.erro).toBe("Esse cofre já está aberto em outra janela.");

      const instA = await verificarInstanciaExistente(pastaA, ambiente);
      expect(instA.ativa).toBe(true);
      expect(instA.estado?.token).toBe(appA.token);
    } finally {
      await appA.encerrar();
      appA.servidor.stop(true);
      serverOutroB.stop(true);
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
