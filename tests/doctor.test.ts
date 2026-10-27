import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { comandoDoctor, diagnosticar } from "../src/comandos/doctor";
import { alvosConhecidos, instalar } from "../src/comandos/instalar";
import { executar } from "../src/cli";
import { capturarConsole } from "./apoio/console";

const raizKit = resolve(import.meta.dir, "..");
const ambiente = { ...process.env };
let tmp: string, clone: string, bin: string;
let consoleCapturado: ReturnType<typeof capturarConsole>;

function executavel(nome: string) {
  writeFileSync(join(bin, process.platform === "win32" ? `${nome}.cmd` : nome), "echo teste\n", { mode: 0o755 });
}
beforeEach(() => {
  consoleCapturado = capturarConsole();
  tmp = mkdtempSync(join(tmpdir(), "doctor-"));
  clone = join(tmp, "clone com espaço"); bin = join(tmp, "bin");
  for (const dir of [clone, bin, join(tmp, "lar")]) mkdirSync(dir);
  writeFileSync(join(clone, "AGENTS.md"), "contrato");
  mkdirSync(join(clone, "skills")); mkdirSync(join(clone, "src"));
  writeFileSync(join(clone, "src/cli.ts"), "cli");
  for (const nome of ["bun", "git", "rg", ...alvosConhecidos]) executavel(nome);
  process.env.BUN_INSTALL = join(tmp, "bun"); process.env.BUN_INSTALL_CACHE_DIR = join(tmp, "bun-cache");
  process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH = join(tmp, "bun-transpiler"); process.env.XDG_CACHE_HOME = join(tmp, "cache");
  process.env.PATH = bin; process.env.HOME = join(tmp, "lar"); process.env.USERPROFILE = join(tmp, "lar");
});
afterEach(() => {
  try { expect(readdirSync(join(tmp, "lar"))).toEqual([]); }
  finally {
    consoleCapturado.restaurar();
    for (const chave of Object.keys(process.env)) if (!(chave in ambiente)) delete process.env[chave];
    Object.assign(process.env, ambiente);
    rmSync(tmp, { recursive: true, force: true });
  }
});

async function instalarTudo() {
  const r = await instalar({ alvos: [...alvosConhecidos], destino: clone, simular: false });
  expect(r.codigo).toBe(0);
}
function gravar(rel: string, texto: string) {
  mkdirSync(join(clone, rel, ".."), { recursive: true }); writeFileSync(join(clone, rel), texto);
}
function completar() {
  gravar("src/comandos/fechar.ts", 'const passos = [["validar-wiki", () => comandoValidar([raiz])]];\n');
  gravar(".github/workflows/ci.yml", "jobs:\n  t:\n    steps:\n      - run: bun src/cli.ts checar-docs\n");
}
async function travas() { return Object.fromEntries((await diagnosticar(clone)).travas.map(t => [t.nome, t])); }
const protecao = (agente: string) => `Proteção do raw/ no ${agente}`;

test("Dado rg ausente mas travas completas Quando rodo doctor Então avisa sobre query e continua com saída zero", async () => {
  await instalarTudo(); completar();
  rmSync(join(bin, process.platform === "win32" ? "rg.cmd" : "rg"));
  expect(await comandoDoctor([clone])).toBe(0);
  expect(consoleCapturado.saida.join("\n")).toMatch(/AVISO:.*query.*rg/);
  expect(consoleCapturado.saida.join("\n")).toContain("MCP de consulta à wiki: opcional");
  expect(readdirSync(bin).some(nome => /^rg(?:\.cmd|\.exe)?$/.test(nome))).toBe(false);
});

test("Dado servidor MCP registrado no agente, Quando roda doctor, Então mostra estado real", async () => {
  const ambienteMcp = { home: tmp, existe: async (nome: string) => nome === "claude", executar: async () => ({ codigo: 0, saida: `anvilore: bun "${join(clone, "src", "cli.ts")}" mcp` }) };
  await comandoDoctor([clone], { ambienteMcp });
  expect(consoleCapturado.saida.join("\n")).toContain("MCP de consulta à wiki: opcional — ligado em claude");
});

test("Dado fechamento TypeScript atual Quando diagnostico Então a validação no fechamento está ligada", async () => {
  completar();
  expect((await travas())["Validação no fechamento da wiki"]?.ligada).toBe(true);
});

test("Dado repositório com a proteção do raw instalada Quando diagnostico Então as quatro travas do hook estão ligadas", async () => {
  await instalarTudo();
  const t = await travas();
  for (const agente of ["Claude Code", "Codex", "Gemini", "Copilot"]) {
    expect(t[protecao(agente)]?.ligada).toBe(true); expect(t[protecao(agente)]?.comoLigar).toBeUndefined();
  }
});

test("Dado repositório sem a proteção Quando rodo o doctor Então diz que nenhum agente tem a trava, o comando que a liga e devolve 1", async () => {
  completar();
  const codigo = await comandoDoctor([clone]);
  const saida = consoleCapturado.saida.join("\n");
  expect(codigo).toBe(1);
  expect(saida).toContain("Proteção do raw/ em pelo menos um agente: desligada — para ligar: bun src/cli.ts instalar --alvo claude");
  expect(saida).toContain("Proteção do raw/ no Claude Code: encontrado, sem trava neste clone (opcional: bun src/cli.ts instalar --alvo claude");
  expect(saida).toContain(`--destino "${clone}"`);
  expect(saida).toContain("Resultado: faltam 1 trava(s)");
});

test("Dado repositório completo Quando rodo o doctor Então diz ligada em linguagem simples e devolve 0", async () => {
  await instalarTudo(); completar();
  expect(await comandoDoctor([clone])).toBe(0);
  const saida = consoleCapturado.saida.join("\n");
  expect(saida).toContain("Proteção do raw/ no Claude Code: ligada");
  expect(saida).toContain("Validação no fechamento da wiki: ligada");
  expect(saida).toContain("Checagem antes de aceitar a mudança: ligada");
  expect(saida).toContain("bun: presente"); expect(saida).toContain("git: presente");
  expect(saida).toContain("Resultado: tudo ligado");
  expect(saida).not.toContain("desligada");
});

test("Dado git ausente do PATH Quando diagnostico Então lista git como pré-requisito ausente e o doctor devolve 1", async () => {
  await instalarTudo(); completar();
  rmSync(join(bin, process.platform === "win32" ? "git.cmd" : "git"));
  const d = await diagnosticar(clone);
  expect(d.prerequisitos).toEqual([{ nome: "bun", presente: true }, { nome: "git", presente: false }]);
  expect(await comandoDoctor([clone])).toBe(1);
  expect(consoleCapturado.saida.join("\n")).toContain("git: ausente");
});

test("Dado o PATH escrito como Path Quando diagnostico Então ainda acha os pré-requisitos", async () => {
  const d = await diagnosticar(clone, { Path: bin });
  expect(d.prerequisitos).toEqual([{ nome: "bun", presente: true }, { nome: "git", presente: true }]);
  expect((await diagnosticar(clone, { OUTRA: "x" })).prerequisitos.every(p => !p.presente)).toBe(true);
});

test("Dado hook antigo apontando para o script removido Quando diagnostico Então está desligada e manda reinstalar", async () => {
  gravar(".claude/settings.json", JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Write|Edit|NotebookEdit", hooks: [{ type: "command", command: '"$CLAUDE_PROJECT_DIR"/hooks/proteger-raw.sh' }] }] } }));
  gravar(".github/copilot/settings.json", JSON.stringify({ hooks: { preToolUse: [{ type: "command", bash: "./hooks/proteger-raw.sh" }] } }));
  gravar(".codex/config.toml", '# <<< anvilore\n[[hooks.PreToolUse]]\nmatcher = "apply_patch|Edit|Write"\n[[hooks.PreToolUse.hooks]]\ncommand = "./hooks/proteger-raw.sh"\n# >>> anvilore\n');
  const t = await travas();
  for (const agente of ["Claude Code", "Copilot", "Codex"]) {
    expect(t[protecao(agente)]?.ligada).toBe(false);
    expect(t[protecao(agente)]?.detalhe).toContain("hook antigo");
    expect(t[protecao(agente)]?.comoLigar).toContain("instalar --alvo");
  }
});

test("Dado matcher sem a ferramenta de terminal Quando diagnostico Então a proteção está desligada", async () => {
  await instalarTudo();
  const arq = join(clone, ".claude/settings.json");
  writeFileSync(arq, readFileSync(arq, "utf8").replace("Write|Edit|NotebookEdit|Bash", "Write|Edit|NotebookEdit"));
  expect((await travas())[protecao("Claude Code")]?.ligada).toBe(false);
});

test("Dado configuração pessoal junto do hook Quando diagnostico Então reconhece o hook sem mexer no arquivo", async () => {
  await instalarTudo();
  const arq = join(clone, ".claude/settings.json");
  const config = JSON.parse(readFileSync(arq, "utf8")); config.pessoal = "meu"; config.hooks.PreToolUse.unshift({ matcher: "Bash", hooks: [] });
  writeFileSync(arq, JSON.stringify(config)); const antes = readFileSync(arq, "utf8");
  expect((await travas())[protecao("Claude Code")]?.ligada).toBe(true);
  expect(readFileSync(arq, "utf8")).toBe(antes);
});

test("Dado configuração ilegível ou em conflito Quando diagnostico Então desliga a trava explicando sem lançar erro", async () => {
  gravar(".claude/settings.json", "{ruim");
  gravar(".gemini/settings.json", '{"context":{"fileName":"GEMINI.md"},"hooks":"texto"}');
  mkdirSync(join(clone, ".github/copilot/settings.json"), { recursive: true });
  const t = await travas();
  expect(t[protecao("Claude Code")]).toMatchObject({ ligada: false });
  expect(t[protecao("Claude Code")]?.detalhe).toContain("não foi possível ler");
  expect(t[protecao("Gemini")]?.ligada).toBe(false);
  expect(t[protecao("Copilot")]?.ligada).toBe(false);
});

test("Dado fechar sem a chamada do validador Quando diagnostico Então a validação no fechamento está desligada", async () => {
  gravar("src/comandos/fechar.ts", "export {};\n");
  const t = (await travas())["Validação no fechamento da wiki"];
  expect(t?.ligada).toBe(false); expect(t?.comoLigar).toContain("fechar.ts");
  rmSync(join(clone, "src/comandos/fechar.ts"));
  expect((await travas())["Validação no fechamento da wiki"]?.ligada).toBe(false);
});

test("Dado CI ou pré-commit Quando diagnostico Então qualquer um dos dois liga a checagem antes de aceitar", async () => {
  const nome = "Checagem antes de aceitar a mudança";
  expect((await travas())[nome]?.ligada).toBe(false);
  expect((await travas())[nome]?.comoLigar).toContain("bun src/cli.ts checar-docs");
  gravar(".github/workflows/outro.yaml", "jobs:\n  t:\n    steps:\n      - run: echo\n");
  expect((await travas())[nome]?.ligada).toBe(false);
  gravar(".github/workflows/ci.yml", "jobs:\n  t:\n    steps:\n      - run: bun src/cli.ts checar-docs\n");
  expect((await travas())[nome]?.ligada).toBe(true);
  rmSync(join(clone, ".github"), { recursive: true });
  gravar(".git/hooks/pre-commit", "#!/bin/sh\nbun src/cli.ts validar wiki\n");
  expect((await travas())[nome]?.ligada).toBe(true);
});

test("Dado perfil da empresa Quando diagnostico Então ausente é opcional, válido liga e inválido desliga", async () => {
  const nome = "Perfil da empresa (anvilore.toml)";
  const ausente = (await travas())[nome];
  expect(ausente).toMatchObject({ ligada: false, opcional: true });
  gravar("anvilore.toml", 'areas = ["produto"]\n');
  expect((await travas())[nome]?.ligada).toBe(true);
  gravar("anvilore.toml", "chave = 1\n");
  const invalido = (await travas())[nome];
  expect(invalido).toMatchObject({ ligada: false }); expect(invalido?.opcional).toBeUndefined();
  expect(invalido?.detalhe).toContain("chave desconhecida");
});

test("Dado só o perfil opcional ausente Quando rodo o doctor Então não conta como falta", async () => {
  await instalarTudo(); completar();
  expect(await comandoDoctor([clone])).toBe(0);
  expect(consoleCapturado.saida.join("\n")).toContain("Perfil da empresa (anvilore.toml): não configurado (opcional)");
});

test("Dado --help ou argumentos demais Quando rodo o doctor Então imprime o uso e devolve 2", async () => {
  expect(await comandoDoctor(["--help"])).toBe(2);
  expect(await comandoDoctor([clone, "outro"])).toBe(2);
  expect(await comandoDoctor(["--desconhecido"])).toBe(2);
  expect(consoleCapturado.erros.join("\n")).toContain("Uso: anvilore doctor");
});

test("Dado pasta inexistente Quando rodo o doctor Então reprova nomeando a pasta em vez de relatar tudo desligado", async () => {
  const ausente = join(tmp, "nao existe");
  expect(await comandoDoctor([ausente])).toBe(1);
  expect(consoleCapturado.erros.join("\n")).toContain(ausente);
  expect(consoleCapturado.saida).toEqual([]);
});

test("Dado nenhum argumento Quando rodo o doctor Então usa ANVILORE_DESTINO ou o diretório atual", async () => {
  await instalarTudo(); completar();
  process.env.ANVILORE_DESTINO = clone;
  expect(await comandoDoctor([])).toBe(0);
  delete process.env.ANVILORE_DESTINO;
  const antes = process.cwd(); process.chdir(clone);
  try { expect(await comandoDoctor([])).toBe(0); } finally { process.chdir(antes); }
});

test.skipIf(process.platform === "win32")("Dado o Claude que dorme e deixa um filho segurando stdout, Quando roda doctor, Então termina em menos de 10 segundos", async () => {
  const claude = join(bin, "claude");
  writeFileSync(claude, "#!/bin/sh\n/bin/sleep 12\n", { mode: 0o755 });
  const processo = Bun.spawn([process.execPath, join(raizKit, "src/cli.ts"), "doctor", clone], {
    env: { ...process.env, PATH: bin, HOME: join(tmp, "lar"), USERPROFILE: join(tmp, "lar") },
    stdout: "pipe", stderr: "pipe",
  });
  const inicio = Date.now();
  const concluiu = await Promise.race([
    processo.exited.then(() => true),
    new Promise<false>(resolve => setTimeout(() => resolve(false), 9_000)),
  ]);
  if (!concluiu) processo.kill();
  expect(concluiu).toBe(true);
  expect(Date.now() - inicio).toBeLessThan(10_000);
}, 15_000);

test.skipIf(process.platform === "win32")("Dado --version do Claude que não responde e deixa stdout aberto, Quando diagnostico, Então aplica timeout sem esperar o pipe", async () => {
  writeFileSync(join(bin, "claude"), "#!/bin/sh\n/bin/sleep 12\n", { mode: 0o755 });
  const inicio = Date.now();
  const d = await diagnosticar(clone, { PATH: bin });
  const versao = d.travas.find(trava => trava.nome === VERSAO);
  expect(versao?.detalhe).toBe("consulta excedeu 3500 ms");
  expect(Date.now() - inicio).toBeLessThan(5_000);
}, 7_000);

test("Dado o CLI Quando executo doctor Então o subcomando está registrado", async () => {
  await instalarTudo(); completar();
  expect(await executar(["doctor", clone])).toBe(0);
});

test("Dado o processo real Quando rodo bun src/cli.ts doctor Então imprime o relatório e o código de saída", () => {
  const p = Bun.spawnSync([process.execPath, join(raizKit, "src/cli.ts"), "doctor", clone], { env: { ...process.env, PATH: `${bin}${process.platform === "win32" ? ";" : ":"}${ambiente.PATH ?? ambiente.Path ?? ""}` }, stdout: "pipe", stderr: "pipe" });
  expect(p.exitCode).toBe(1);
  expect(p.stdout.toString()).toContain("desligada — para ligar:");
});

function semCli(...nomes: string[]) {
  for (const nome of nomes) rmSync(join(bin, process.platform === "win32" ? `${nome}.cmd` : nome));
}

test("Dado clone só com Claude e a trava ligada Quando rodo o doctor Então os agentes ausentes são opcionais e a saída é 0", async () => {
  const r = await instalar({ alvos: ["claude"], destino: clone, simular: false });
  expect(r.codigo).toBe(0); completar(); semCli("codex", "gemini", "copilot");
  const t = await travas();
  for (const agente of ["Codex", "Gemini", "Copilot"]) expect(t[protecao(agente)]).toMatchObject({ ligada: false, opcional: true });
  expect(t[protecao("Claude Code")]?.ligada).toBe(true);
  expect(await comandoDoctor([clone])).toBe(0);
  const saida = consoleCapturado.saida.join("\n");
  expect(saida).toContain("Proteção do raw/ no Codex: não instalado (opcional)");
  expect(saida).toContain("Resultado: tudo ligado");
});

test("Dado agente presente só pela pasta de configuração Quando a trava falta Então é cobrada e o doctor devolve 1", async () => {
  await instalar({ alvos: ["claude"], destino: clone, simular: false }); completar(); semCli("codex", "gemini", "copilot");
  mkdirSync(join(clone, ".gemini"));
  const t = await travas();
  expect(t[protecao("Gemini")]).toMatchObject({ ligada: false }); expect(t[protecao("Gemini")]?.opcional).toBeUndefined();
  expect(t[protecao("Codex")]?.opcional).toBe(true);
  expect(await comandoDoctor([clone])).toBe(1);
  expect(consoleCapturado.saida.join("\n")).toContain("Proteção do raw/ no Gemini: desligada — para ligar:");
});

test("Dado agente com CLI no PATH e sem configuração no clone Quando diagnostico Então é só encontrado, sem trava, e não reprova (R70-H)", async () => {
  await instalar({ alvos: ["claude"], destino: clone, simular: false }); completar(); semCli("gemini", "copilot");
  expect((await travas())[protecao("Codex")]).toMatchObject({ ligada: false, opcional: true, semTrava: true });
  expect(await comandoDoctor([clone])).toBe(0);
  const saida = consoleCapturado.saida.join("\n");
  expect(saida).toContain("Proteção do raw/ no Codex: encontrado, sem trava neste clone (opcional: bun src/cli.ts instalar --alvo codex");
  expect(saida).toContain("Proteção do raw/ no Claude Code: ligada");
  expect(saida).toContain("Resultado: tudo ligado");
});

test("Dado nenhum agente instalado nem encontrado Quando rodo o doctor Então ainda sai 1 pedindo a instalação do Claude", async () => {
  completar(); semCli("claude", "codex", "gemini", "copilot");
  expect(await comandoDoctor([clone])).toBe(1);
  const saida = consoleCapturado.saida.join("\n");
  expect(saida).toContain("Proteção do raw/ no Claude Code: não instalado (opcional)");
  expect(saida).toContain("Proteção do raw/ em pelo menos um agente: desligada — para ligar: bun src/cli.ts instalar --alvo claude");
});

test("Dado um agente configurado e desligado ao lado de outro ligado Quando rodo o doctor Então sai 1 pelo desligado", async () => {
  await instalar({ alvos: ["claude"], destino: clone, simular: false }); completar();
  mkdirSync(join(clone, ".codex"));
  expect(await comandoDoctor([clone])).toBe(1);
  expect(consoleCapturado.saida.join("\n")).toContain("Proteção do raw/ no Codex: desligada");
});

// R66 parte 3 (RI6): o onFailure do hook do Claude pede a 2.1.295.
function claudeComVersao(texto: string) {
  const arq = join(bin, process.platform === "win32" ? "claude.cmd" : "claude");
  writeFileSync(arq, process.platform === "win32" ? `@echo ${texto}\r\n` : `#!/bin/sh\necho "${texto}"\n`, { mode: 0o755 });
}
const VERSAO = "Versão do Claude Code (o hook usa onFailure)";

test("Dado Claude Code anterior à 2.1.295 Quando rodo o doctor Então avisa para atualizar e devolve 1", async () => {
  await instalarTudo(); completar(); claudeComVersao("2.1.200 (Claude Code)");
  const t = (await travas())[VERSAO];
  expect(t).toMatchObject({ ligada: false }); expect(t?.comoLigar).toContain("atualize o Claude Code"); expect(t?.detalhe).toContain("2.1.200");
  expect(await comandoDoctor([clone])).toBe(1);
  expect(consoleCapturado.saida.join("\n")).toContain(`${VERSAO}: desligada — para ligar: atualize o Claude Code`);
});

test("Dado Claude Code na 2.1.295 ou mais novo Quando rodo o doctor Então a versão conta como ligada", async () => {
  await instalarTudo(); completar();
  for (const versao of ["2.1.295 (Claude Code)", "2.1.310 (Claude Code)", "2.2.0", "3.0.0 (Claude Code)"]) {
    claudeComVersao(versao);
    expect((await travas())[VERSAO]?.ligada).toBe(true);
  }
  expect(await comandoDoctor([clone])).toBe(0);
});

test("Dado versão ilegível ou Claude ausente Quando diagnostico Então avisa sem reprovar e não inventa a trava", async () => {
  await instalarTudo(); completar();
  expect((await travas())[VERSAO]).toMatchObject({ ligada: false, opcional: true });
  expect(await comandoDoctor([clone])).toBe(0);
  semCli("claude");
  expect((await travas())[VERSAO]).toBeUndefined();
});

// Revisão Codex da T10 (I1, I2): linha comentada ou etapa desativada não liga a trava.
test("Dado chamada ao validador só comentada no fechar Quando diagnostico Então a validação está desligada", async () => {
  const nome = "Validação no fechamento da wiki";
  gravar("src/comandos/fechar.ts", '// comandoValidar([raiz])\n   /* comandoValidar([raiz]) */\n');
  const t = (await travas())[nome];
  expect(t?.ligada).toBe(false); expect(t?.detalhe).toContain("só aparece em comentário");
  gravar("src/comandos/fechar.ts", '// comandoValidar([raiz])\n() => comandoValidar([raiz]) // valida\n');
  expect((await travas())[nome]?.ligada).toBe(true);
  gravar("src/comandos/fechar.ts", 'console.log("nada"); // comandoValidar([raiz])\n');
  expect((await travas())[nome]?.ligada).toBe(false);
});

test("Dado etapa de CI só comentada ou desativada Quando diagnostico Então a checagem está desligada", async () => {
  const nome = "Checagem antes de aceitar a mudança";
  const ci = (corpo: string) => gravar(".github/workflows/ci.yml", `jobs:\n  t:\n    steps:\n${corpo}`);
  ci("      # - run: bun src/cli.ts checar-docs\n      - run: echo ok\n");
  expect((await travas())[nome]?.ligada).toBe(false);
  ci("      - run: echo ok # bun src/cli.ts checar-docs\n");
  expect((await travas())[nome]?.ligada).toBe(false);
  ci("      - if: false\n        run: bun src/cli.ts checar-docs\n");
  expect((await travas())[nome]?.ligada).toBe(false);
  ci("      - if: ${{ false }}\n        run: bun src/cli.ts checar-docs\n");
  expect((await travas())[nome]?.ligada).toBe(false);
  gravar(".github/workflows/ci.yml", "jobs:\n  t:\n    if: false\n    steps:\n      - run: bun src/cli.ts checar-docs\n");
  expect((await travas())[nome]?.ligada).toBe(false);
  ci("      - run: bun src/cli.ts checar-docs\n");
  expect((await travas())[nome]?.ligada).toBe(true);
  ci("      - name: x\n        if: always()\n        run: |\n          echo a\n          bun src/cli.ts validar wiki\n");
  expect((await travas())[nome]?.ligada).toBe(true);
});

test("Dado YAML do workflow inválido ou pré-commit comentado Quando diagnostico Então não liga a trava e explica", async () => {
  const nome = "Checagem antes de aceitar a mudança";
  gravar(".github/workflows/ci.yml", "jobs: [\n");
  expect((await travas())[nome]?.ligada).toBe(false);
  rmSync(join(clone, ".github"), { recursive: true });
  gravar(".git/hooks/pre-commit", "#!/bin/sh\n# bun src/cli.ts validar wiki\n");
  expect((await travas())[nome]?.ligada).toBe(false);
  gravar(".git/hooks/pre-commit", "#!/bin/sh\nbun src/cli.ts validar wiki\n");
  expect((await travas())[nome]?.ligada).toBe(true);
});

test("Dado trava comentada Quando rodo o doctor Então não diz tudo ligado e devolve 1", async () => {
  await instalarTudo();
  gravar("src/comandos/fechar.ts", "// comandoValidar([raiz])\n");
  gravar(".github/workflows/ci.yml", "jobs:\n  t:\n    steps:\n      # - run: bun src/cli.ts checar-docs\n      - run: echo ok\n");
  expect(await comandoDoctor([clone])).toBe(1);
  const saida = consoleCapturado.saida.join("\n");
  expect(saida).not.toContain("tudo ligado"); expect(saida).toContain("Validação no fechamento da wiki: desligada");
  expect(saida).toContain("Checagem antes de aceitar a mudança: desligada");
});

// R74 I2: a versão do Claude só reprova quando o Claude está configurado no clone (pasta .claude/).
test("Dado Codex com trava, sem .claude/ e claude 2.1.0 só no PATH Quando rodo o doctor Então a versão é só um aviso opcional e sai 0", async () => {
  await instalar({ alvos: ["codex"], destino: clone, simular: false }); completar();
  claudeComVersao("2.1.0 (Claude Code)");
  const t = (await travas())[VERSAO];
  expect(t).toMatchObject({ ligada: false, opcional: true }); expect(t?.detalhe).toContain("2.1.0");
  expect(await comandoDoctor([clone])).toBe(0);
  const saida = consoleCapturado.saida.join("\n");
  expect(saida).toContain(`${VERSAO}: não configurado (opcional)`);
  expect(saida).toContain("Resultado: tudo ligado");
});

test("Dado Claude configurado no clone (.claude/) com a trava e versão 2.1.0 Quando rodo o doctor Então reprova e manda atualizar (alerta R66 mantido)", async () => {
  await instalar({ alvos: ["claude"], destino: clone, simular: false }); completar();
  claudeComVersao("2.1.0 (Claude Code)");
  expect((await travas())[VERSAO]).toMatchObject({ ligada: false });
  expect((await travas())[VERSAO]?.opcional).toBeUndefined();
  expect(await comandoDoctor([clone])).toBe(1);
  expect(consoleCapturado.saida.join("\n")).toContain("atualize o Claude Code");
});

test("Dado .claude/ vazia no clone e claude antigo Quando diagnostico Então conta como configurado e reprova", async () => {
  await instalar({ alvos: ["codex"], destino: clone, simular: false }); completar();
  mkdirSync(join(clone, ".claude"));
  claudeComVersao("2.0.9");
  expect((await travas())[VERSAO]?.opcional).toBeUndefined();
});
