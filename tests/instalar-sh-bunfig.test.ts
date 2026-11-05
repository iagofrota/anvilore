import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { criarCenario as CriarCenario, Cenario } from "./apoio/instalar-sh";

// Correção de segurança S3 (auditoria run-1):
// Toda chamada ao Bun no instalador roda com cwd controlado (neutro em TMP_DIR ou na pasta de instalação),
// impedindo que um bunfig.toml no diretório em que o usuário invocou o instalador execute código via preload.

const linux = process.platform === "linux";
const apoio = linux ? await import("./apoio/instalar-sh") : undefined;
const cenarios: Cenario[] = [];
afterEach(async () => { await Promise.all(cenarios.splice(0).map(c => c.limpar())); });
async function novo(...args: Parameters<typeof CriarCenario>) { const c = await apoio!.criarCenario(...args); cenarios.push(c); return c; }
const existe = (caminho: string) => stat(caminho).then(() => true, () => false);

async function prepararPreloadHostil(pastaCwd: string) {
  const canario = join(pastaCwd, "canario-bunfig.txt");
  const bunfig = join(pastaCwd, "bunfig.toml");
  const scriptPwn = join(pastaCwd, "pwn-preload.ts");
  await writeFile(bunfig, 'preload = ["./pwn-preload.ts"]\n');
  await writeFile(
    scriptPwn,
    'import { appendFileSync } from "node:fs";\n' +
    'const arq = process.env.MARCADOR_CANARIO;\n' +
    'if (arq) appendFileSync(arq, `preload em ${process.cwd()} com argv: ${process.argv.join(" ")}\\n`);\n'
  );
  return canario;
}

test.skipIf(!linux)("S3: Dado um bunfig.toml hostil com preload no cwd de quem executa o instalador, Quando instalo o Anvilore pela primeira vez, Então a instalação conclui com sucesso e nenhum código do preload executa", async () => {
  const c = await novo();
  const canario = await prepararPreloadHostil(c.pai);
  const r = c.rodar({ MARCADOR_CANARIO: canario });

  expect(r.codigo, r.tudo).toBe(0);
  expect(await existe(join(c.pasta, "src/cli.ts"))).toBe(true);
  expect(await existe(canario)).toBe(false);
});

test.skipIf(!linux)("S3: Dado uma instalação existente e um bunfig.toml hostil com preload no cwd, Quando o instalador roda para atualizar, Então a atualização ocorre sem executar o preload do cwd", async () => {
  const c = await novo();
  const r1 = c.rodar();
  expect(r1.codigo, r1.tudo).toBe(0);

  const canario = await prepararPreloadHostil(c.pai);
  const r2 = c.rodar({ MARCADOR_CANARIO: canario });

  expect(r2.codigo, r2.tudo).toBe(0);
  expect(await existe(canario)).toBe(false);
});

test.skipIf(!linux)("S3: Dado um bunfig.toml hostil no cwd e chamada a passo_estado com ANVILORE_INSTALAR_CARREGAR=1, Quando gravo o estado, Então o preload não executa", async () => {
  const c = await novo();
  const canario = await prepararPreloadHostil(c.pai);
  const bashScript = `
    source "${c.script}"
    TMP_DIR="${c.tmp}"
    PASTA="${c.pasta}"
    INSTALADOS="claude"
    BUN_GERENCIADO=0
    AUTO_COMMIT=1
    mkdir -p "${c.pasta}/.anvilore"
    passo_estado
  `;
  const p = Bun.spawnSync(["bash", "-c", bashScript], {
    cwd: c.pai,
    env: c.env({ ANVILORE_INSTALAR_CARREGAR: "1", MARCADOR_CANARIO: canario }),
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(p.exitCode).toBe(0);
  expect(await existe(join(c.pasta, ".anvilore/atualizacao.json"))).toBe(true);
  expect(await existe(canario)).toBe(false);
});

test.skipIf(!linux)("S3: Dado um bunfig.toml hostil no cwd e chamada a acrescentar_bloco_path com ANVILORE_INSTALAR_CARREGAR=1, Quando acrescento o bloco do PATH, Então o preload não executa", async () => {
  const c = await novo();
  const canario = await prepararPreloadHostil(c.pai);
  const perfil = join(c.home, ".profile");
  await writeFile(perfil, "# profile inicial\n");

  const bashScript = `
    source "${c.script}"
    TMP_DIR="${c.tmp}"
    acrescentar_bloco_path "${perfil}"
  `;
  const p = Bun.spawnSync(["bash", "-c", bashScript], {
    cwd: c.pai,
    env: c.env({ ANVILORE_INSTALAR_CARREGAR: "1", MARCADOR_CANARIO: canario }),
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(p.exitCode).toBe(0);
  const conteudoPerfil = await readFile(perfil, "utf8");
  expect(conteudoPerfil).toContain("Anvilore: PATH");
  expect(await existe(canario)).toBe(false);
});

test.skipIf(!linux)("S3: Dado caminho relativo em ANVILORE_PASTA a partir do cwd, Quando instalo, Então resolve o caminho para absoluto e instala corretamente", async () => {
  const c = await novo();
  // Passa pasta relativa "destino-relativo/wiki" em relação ao cwd (c.pai)
  const r = c.rodar({ ANVILORE_PASTA: "destino-relativo/minha-wiki" });
  expect(r.codigo, r.tudo).toBe(0);
  const destinoEsperado = join(c.pai, "destino-relativo/minha-wiki");
  expect(await existe(join(destinoEsperado, "src/cli.ts"))).toBe(true);
  expect(await existe(join(destinoEsperado, ".anvilore/atualizacao.json"))).toBe(true);
});

test.skipIf(!linux)("S3: Dado caminho relativo em ANVILORE_ORIGEM a partir do cwd, Quando instalo, Então resolve a origem para absoluto e clona com sucesso", async () => {
  const c = await novo();
  const origemRelativa = relative(c.pai, c.kit.raiz);
  const r = c.rodar({ ANVILORE_ORIGEM: origemRelativa });
  expect(r.codigo, r.tudo).toBe(0);
  expect(await existe(join(c.pasta, "src/cli.ts"))).toBe(true);
});

test.skipIf(!linux)("S3 P2-1: Dado modo biblioteca sem TMP_DIR e um persistir-path.mjs hostil somente leitura no TMPDIR, Quando chamo acrescentar_bloco_path, Então o instalador cria diretório privado e não executa o script plantado", async () => {
  const c = await novo();
  const tmpdirCompartilhado = join(c.pai, "tmp-compartilhado-path");
  await mkdir(tmpdirCompartilhado, { recursive: true });
  const canario = join(c.pai, "canario-p2-path.txt");
  const scriptPlantado = join(tmpdirCompartilhado, "persistir-path.mjs");
  await writeFile(
    scriptPlantado,
    'import { appendFileSync } from "node:fs";\n' +
    'const arq = process.env.MARCADOR_CANARIO;\n' +
    'if (arq) appendFileSync(arq, "pwned via persistir-path\\n");\n' +
    'process.exit(10);\n',
    { mode: 0o444 }
  );
  await chmod(scriptPlantado, 0o444);

  const perfil = join(c.home, ".profile");
  await writeFile(perfil, "# profile inicial\n");

  const bashScript = `
    source "${c.script}"
    unset TMP_DIR
    acrescentar_bloco_path "${perfil}"
  `;
  const p = Bun.spawnSync(["bash", "-c", bashScript], {
    cwd: c.pai,
    env: {
      ...c.env({ ANVILORE_INSTALAR_CARREGAR: "1", MARCADOR_CANARIO: canario }),
      TMPDIR: tmpdirCompartilhado,
      TMP_DIR: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(p.exitCode).toBe(0);
  expect(await existe(canario)).toBe(false);
  const conteudoPerfil = await readFile(perfil, "utf8");
  expect(conteudoPerfil).toContain("Anvilore: PATH");
});

test.skipIf(!linux)("S3 P2-1: Dado modo biblioteca sem TMP_DIR e um estado.ts hostil somente leitura no TMPDIR, Quando chamo passo_estado, Então o instalador cria diretório privado e não executa o script plantado", async () => {
  const c = await novo();
  const tmpdirCompartilhado = join(c.pai, "tmp-compartilhado-estado");
  await mkdir(tmpdirCompartilhado, { recursive: true });
  const canario = join(c.pai, "canario-p2-estado.txt");
  const scriptPlantado = join(tmpdirCompartilhado, "estado.ts");
  await writeFile(
    scriptPlantado,
    'import { appendFileSync } from "node:fs";\n' +
    'const arq = process.env.MARCADOR_CANARIO;\n' +
    'if (arq) appendFileSync(arq, "pwned via estado\\n");\n' +
    'process.exit(0);\n',
    { mode: 0o444 }
  );
  await chmod(scriptPlantado, 0o444);

  const bashScript = `
    source "${c.script}"
    unset TMP_DIR
    PASTA="${c.pasta}"
    INSTALADOS="claude"
    BUN_GERENCIADO=0
    AUTO_COMMIT=1
    mkdir -p "${c.pasta}/.anvilore"
    passo_estado
  `;
  const p = Bun.spawnSync(["bash", "-c", bashScript], {
    cwd: c.pai,
    env: {
      ...c.env({ ANVILORE_INSTALAR_CARREGAR: "1", MARCADOR_CANARIO: canario }),
      TMPDIR: tmpdirCompartilhado,
      TMP_DIR: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(p.exitCode).toBe(0);
  expect(await existe(canario)).toBe(false);
  expect(await existe(join(c.pasta, ".anvilore/atualizacao.json"))).toBe(true);
});

test.skipIf(!linux)("S3 P3-1: Dado TMPDIR relativo no ambiente do chamador, Quando o instalador executa, Então normaliza TMPDIR para caminho absoluto e conclui com sucesso", async () => {
  const c = await novo();
  const tmpRelativo = "meu-tmp-relativo";
  await mkdir(join(c.pai, tmpRelativo), { recursive: true });
  const r = c.rodar({ TMPDIR: tmpRelativo });
  expect(r.codigo, r.tudo).toBe(0);
  expect(await existe(join(c.pasta, "src/cli.ts"))).toBe(true);
});

async function plantarArmadilha(pasta: string, pastaCanario: string = pasta) {
  const canario = join(pastaCanario, `canario-${Math.random().toString(36).slice(2)}.txt`);
  const vitima = join(pasta, "vitima.txt");
  const bunfig = join(pasta, "bunfig.toml");
  const scriptPwn = join(pasta, "pwn-preload.ts");
  await writeFile(bunfig, 'preload = ["./pwn-preload.ts"]\n');
  await writeFile(
    scriptPwn,
    'import { appendFileSync } from "node:fs";\n' +
    'const arq = process.env.MARCADOR_CANARIO;\n' +
    'if (arq) appendFileSync(arq, `preload em ${process.cwd()}\\n`);\n'
  );
  await writeFile(vitima, "conteudo da vitima intacto\n");
  return { canario, vitima, bunfig, scriptPwn };
}

test.skipIf(!linux)("S3 P2-2: Dado modo biblioteca sem TMP_DIR e TMPDIR sem escrita (555), Quando chamo versao_da_pasta, Então o canário não é criado, a vítima continua lá e devolve erro com mensagem", async () => {
  const c = await novo();
  const tmpdir555 = join(c.pai, "tmp-555-pasta");
  await mkdir(tmpdir555, { recursive: true });
  const { canario, vitima } = await plantarArmadilha(tmpdir555, c.pai);

  await mkdir(c.pasta, { recursive: true });
  await writeFile(join(c.pasta, "package.json"), JSON.stringify({ name: "anvilore", version: "0.3.1" }) + "\n");

  const bashScript = `
    source "${c.script}"
    unset TMP_DIR
    versao_da_pasta "${c.pasta}"
  `;
  let p!: ReturnType<typeof Bun.spawnSync>;
  try {
    await chmod(tmpdir555, 0o555);
    p = Bun.spawnSync(["bash", "-c", bashScript], {
      cwd: c.pai,
      env: {
        ...c.env({ ANVILORE_INSTALAR_CARREGAR: "1", MARCADOR_CANARIO: canario }),
        TMPDIR: tmpdir555,
        TMP_DIR: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
  } finally {
    await chmod(tmpdir555, 0o755);
  }

  expect(await existe(canario)).toBe(false);
  expect(await existe(vitima)).toBe(true);
  expect(p.exitCode).not.toBe(0);
  expect(p.stderr?.toString()).toContain("Erro:");
});

test.skipIf(!linux)("S3 P2-2: Dado modo biblioteca sem TMP_DIR e mktemp -d falhando (shim), Quando chamo versao_da_pasta, Então o canário não é criado, a vítima continua lá e devolve erro com mensagem", async () => {
  const c = await novo();
  const realMktemp = Bun.which("mktemp");
  await c.comando("mktemp", `#!/bin/sh\nfor a in "$@"; do [ "$a" = "-d" ] && exit 1; done\nexec ${realMktemp} "$@"\n`);

  const tmpdirCompartilhado = join(c.pai, "tmp-shim-pasta");
  await mkdir(tmpdirCompartilhado, { recursive: true });
  const { canario, vitima } = await plantarArmadilha(tmpdirCompartilhado, c.pai);

  await mkdir(c.pasta, { recursive: true });
  await writeFile(join(c.pasta, "package.json"), JSON.stringify({ name: "anvilore", version: "0.3.1" }) + "\n");

  const bashScript = `
    source "${c.script}"
    unset TMP_DIR
    versao_da_pasta "${c.pasta}"
  `;
  const p = Bun.spawnSync(["bash", "-c", bashScript], {
    cwd: c.pai,
    env: {
      ...c.env({ ANVILORE_INSTALAR_CARREGAR: "1", MARCADOR_CANARIO: canario }),
      TMPDIR: tmpdirCompartilhado,
      TMP_DIR: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(await existe(canario)).toBe(false);
  expect(await existe(vitima)).toBe(true);
  expect(p.exitCode).not.toBe(0);
  expect(p.stderr.toString()).toContain("Erro:");
});

test.skipIf(!linux)("S3 P2-2: Dado modo biblioteca sem TMP_DIR e TMPDIR sem escrita (555), Quando chamo versao_do_bun, Então o canário não é criado, a vítima continua lá e devolve erro com mensagem", async () => {
  const c = await novo();
  const tmpdir555 = join(c.pai, "tmp-555-bun");
  await mkdir(tmpdir555, { recursive: true });
  const { canario, vitima } = await plantarArmadilha(tmpdir555, c.pai);

  const bashScript = `
    source "${c.script}"
    unset TMP_DIR
    versao_do_bun
  `;
  let p!: ReturnType<typeof Bun.spawnSync>;
  try {
    await chmod(tmpdir555, 0o555);
    p = Bun.spawnSync(["bash", "-c", bashScript], {
      cwd: c.pai,
      env: {
        ...c.env({ ANVILORE_INSTALAR_CARREGAR: "1", MARCADOR_CANARIO: canario }),
        TMPDIR: tmpdir555,
        TMP_DIR: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
  } finally {
    await chmod(tmpdir555, 0o755);
  }

  expect(await existe(canario)).toBe(false);
  expect(await existe(vitima)).toBe(true);
  expect(p.exitCode).not.toBe(0);
  expect(p.stderr?.toString()).toContain("Erro:");
});

test.skipIf(!linux)("S3 P2-2: Dado modo biblioteca sem TMP_DIR e mktemp -d falhando (shim), Quando chamo versao_do_bun, Então o canário não é criado, a vítima continua lá e devolve erro com mensagem", async () => {
  const c = await novo();
  const realMktemp = Bun.which("mktemp");
  await c.comando("mktemp", `#!/bin/sh\nfor a in "$@"; do [ "$a" = "-d" ] && exit 1; done\nexec ${realMktemp} "$@"\n`);

  const tmpdirCompartilhado = join(c.pai, "tmp-shim-bun");
  await mkdir(tmpdirCompartilhado, { recursive: true });
  const { canario, vitima } = await plantarArmadilha(tmpdirCompartilhado, c.pai);

  const bashScript = `
    source "${c.script}"
    unset TMP_DIR
    versao_do_bun
  `;
  const p = Bun.spawnSync(["bash", "-c", bashScript], {
    cwd: c.pai,
    env: {
      ...c.env({ ANVILORE_INSTALAR_CARREGAR: "1", MARCADOR_CANARIO: canario }),
      TMPDIR: tmpdirCompartilhado,
      TMP_DIR: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(await existe(canario)).toBe(false);
  expect(await existe(vitima)).toBe(true);
  expect(p.exitCode).not.toBe(0);
  expect(p.stderr.toString()).toContain("Erro:");
});

test.skipIf(!linux)("S3 P2-2: Dado modo biblioteca sem TMP_DIR e TMPDIR sem escrita (555), Quando chamo passo_atualizar_existente, Então o canário não é criado, a vítima continua lá e devolve erro com mensagem", async () => {
  const c = await novo();
  const tmpdir555 = join(c.pai, "tmp-555-atualizar");
  await mkdir(tmpdir555, { recursive: true });
  const { canario, vitima } = await plantarArmadilha(tmpdir555, c.pai);

  await mkdir(join(c.pasta, ".anvilore"), { recursive: true });
  await writeFile(join(c.pasta, "package.json"), JSON.stringify({ name: "anvilore", version: "0.3.1" }) + "\n");
  await writeFile(join(c.pasta, ".anvilore/atualizacao.json"), JSON.stringify({ versao: 1, autoCommit: true }) + "\n");

  const bashScript = `
    source "${c.script}"
    unset TMP_DIR
    conferir_estado_das_chaves() { return 0; }
    versao_da_pasta() { echo "0.3.1"; }
    PASTA="${c.pasta}"
    passo_atualizar_existente
  `;
  let p!: ReturnType<typeof Bun.spawnSync>;
  try {
    await chmod(tmpdir555, 0o555);
    p = Bun.spawnSync(["bash", "-c", bashScript], {
      cwd: c.pai,
      env: {
        ...c.env({ ANVILORE_INSTALAR_CARREGAR: "1", MARCADOR_CANARIO: canario }),
        TMPDIR: tmpdir555,
        TMP_DIR: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
  } finally {
    await chmod(tmpdir555, 0o755);
  }

  expect(await existe(canario)).toBe(false);
  expect(await existe(vitima)).toBe(true);
  expect(p.exitCode).not.toBe(0);
});

test.skipIf(!linux)("S3 P2-2: Dado modo biblioteca sem TMP_DIR e mktemp -d falhando (shim), Quando chamo passo_atualizar_existente, Então o canário não é criado, a vítima continua lá e devolve erro com mensagem", async () => {
  const c = await novo();
  const realMktemp = Bun.which("mktemp");
  await c.comando("mktemp", `#!/bin/sh\nfor a in "$@"; do [ "$a" = "-d" ] && exit 1; done\nexec ${realMktemp} "$@"\n`);

  const tmpdirCompartilhado = join(c.pai, "tmp-shim-atualizar");
  await mkdir(tmpdirCompartilhado, { recursive: true });
  const { canario, vitima } = await plantarArmadilha(tmpdirCompartilhado, c.pai);

  await mkdir(join(c.pasta, ".anvilore"), { recursive: true });
  await writeFile(join(c.pasta, "package.json"), JSON.stringify({ name: "anvilore", version: "0.3.1" }) + "\n");
  await writeFile(join(c.pasta, ".anvilore/atualizacao.json"), JSON.stringify({ versao: 1, autoCommit: true }) + "\n");

  const bashScript = `
    source "${c.script}"
    unset TMP_DIR
    conferir_estado_das_chaves() { return 0; }
    versao_da_pasta() { echo "0.3.1"; }
    PASTA="${c.pasta}"
    passo_atualizar_existente
  `;
  const p = Bun.spawnSync(["bash", "-c", bashScript], {
    cwd: c.pai,
    env: {
      ...c.env({ ANVILORE_INSTALAR_CARREGAR: "1", MARCADOR_CANARIO: canario }),
      TMPDIR: tmpdirCompartilhado,
      TMP_DIR: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(await existe(canario)).toBe(false);
  expect(await existe(vitima)).toBe(true);
  expect(p.exitCode).not.toBe(0);
});

test.skipIf(!linux)("S3 P3-2: Dado modo biblioteca sem TMP_DIR e TMPDIR inexistente, Quando chamo versao_da_pasta, Então devolve erro e avisa no stderr", async () => {
  const c = await novo();
  await mkdir(c.pasta, { recursive: true });
  await writeFile(join(c.pasta, "package.json"), JSON.stringify({ name: "anvilore", version: "0.3.1" }) + "\n");
  const tmpdirInexistente = join(c.pai, "pasta-que-nao-existe-12345");
  const canario = join(c.pai, "canario-p3-2.txt");

  const bashScript = `
    source "${c.script}"
    unset TMP_DIR
    versao_da_pasta "${c.pasta}"
  `;
  const p = Bun.spawnSync(["bash", "-c", bashScript], {
    cwd: c.pai,
    env: {
      ...c.env({ ANVILORE_INSTALAR_CARREGAR: "1", MARCADOR_CANARIO: canario }),
      TMPDIR: tmpdirInexistente,
      TMP_DIR: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(p.exitCode).not.toBe(0);
  expect(p.stderr.toString().trim().split("\n").length).toBe(1);
  expect(p.stderr.toString()).toContain("Erro:");
});
