import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  caminhoEstadoUi,
  gravarEstadoUi,
  obterEstadoUi,
  removerEstadoUi,
  verificarInstanciaExistente,
} from "../src/lib/ui-estado";

test("Dado XDG_RUNTIME_DIR definido, Quando obtenho caminho do estado, Então usa o diretório de runtime", () => {
  const caminho = caminhoEstadoUi({ XDG_RUNTIME_DIR: "/run/user/1000" });
  expect(caminho).toBe("/run/user/1000/anvilore-ui.json");
});

test("Dado XDG_RUNTIME_DIR ausente e XDG_STATE_HOME definido, Quando obtenho caminho do estado, Então usa anvilore sob state home", () => {
  const caminho = caminhoEstadoUi({ XDG_STATE_HOME: "/tmp/state" });
  expect(caminho).toBe("/tmp/state/anvilore/anvilore-ui.json");
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
    const caminho = join(base, "anvilore", "anvilore-ui.json");
    await gravarEstadoUi(estado, { XDG_STATE_HOME: base });
    const lido = await obterEstadoUi({ XDG_STATE_HOME: base });
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
    const link = join(dir, "anvilore-ui.json");
    await symlink(alvo, link);

    const lido = await obterEstadoUi({ XDG_STATE_HOME: base });
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
    expect(await obterEstadoUi({ XDG_STATE_HOME: base })).toBeNull();
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
