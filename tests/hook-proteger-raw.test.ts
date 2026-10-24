import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { comandoHook, decidir, executarProtecao } from "../src/comandos/hook-proteger-raw";
import { capturarConsole } from "./apoio/console";

const raiz = resolve(import.meta.dir, "..");
const ambiente = { ...process.env };
let temporario: string;
let consoleCapturado: ReturnType<typeof capturarConsole>;
beforeEach(() => {
  temporario = mkdtempSync(join(tmpdir(), "hook-raw-"));
  consoleCapturado = capturarConsole();
  delete process.env.ANVILORE_LOG_HOOK;
});
afterEach(() => {
  consoleCapturado.restaurar();
  for (const chave of Object.keys(process.env)) if (!(chave in ambiente)) delete process.env[chave];
  Object.assign(process.env, ambiente);
  rmSync(temporario, { recursive: true, force: true });
});

function arquivo(caminho: string, chave = "file_path", entrada = "tool_input"): string {
  return JSON.stringify({ tool_name: "Write", [entrada]: { [chave]: caminho } });
}
function terminal(comando: unknown, nome = "Bash"): string {
  return JSON.stringify({ tool_name: nome, tool_input: { command: comando } });
}
function cli(payload: string, args = ["hook", "proteger-raw"], origem = raiz) {
  return Bun.spawnSync([process.execPath, join(origem, "src/cli.ts"), ...args], {
    stdin: Buffer.from(payload), stdout: "pipe", stderr: "pipe",
    env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(temporario, "cache") },
  });
}

for (const caminho of ["raw/exemplo/teste.md", "/projeto/raw/teste.md", "C:\\p\\raw\\a.md", "RAW/a.md", "raw./a.md", "raw /a.md", "raw:x"]) {
  test(`Dado caminho ${caminho} Quando decido Então bloqueia com controle fora de raw`, () => {
    expect(decidir(arquivo(caminho)).acao).toBe("bloquear");
    expect(decidir(arquivo("wiki/exemplo/teste.md")).acao).toBe("liberar");
  });
}
for (const caminho of ["rawdata/a.md", "wiki/raw-notas.md", "/p/wiki/rawdata/a.md", "wiki/a.md"]) {
  test(`Dado caminho ${caminho} Quando decido Então libera`, () => {
    expect(decidir(arquivo(caminho)).acao).toBe("liberar");
  });
}
for (const chave of ["file_path", "filePath", "filepath", "notebook_path", "notebookPath", "absolute_path", "absolutePath", "path", "PATH"]) {
  test(`Dado chave ${chave} em payload aninhado Quando decido Então encontra raw em qualquer profundidade`, () => {
    expect(decidir(JSON.stringify({ toolInput: { lista: [{ [chave]: "wiki/a.md" }, { mais: { [chave]: "raw/a.md" } }] } })).acao).toBe("bloquear");
    expect(decidir(arquivo("wiki/a.md", chave, "toolInput")).acao).toBe("liberar");
  });
}
for (const payload of ["{ruim", "", "null", '"texto"', "[]", '{"tool_input":{"file_path":"raw/x.md"']) {
  test(`Dado payload ilegível ou inválido ${JSON.stringify(payload)} Quando decido Então falha fechado`, () => {
    expect(decidir(payload).acao).toBe("bloquear");
  });
}
test("Dado chave de caminho nula ou vazia Quando decido Então ignora o valor e o controle em raw continua bloqueando", () => {
  expect(decidir(JSON.stringify({ tool_name: "Write", tool_input: { file_path: null } })).acao).toBe("liberar");
  expect(decidir(JSON.stringify({ tool_name: "Write", tool_input: { file_path: "" } })).acao).toBe("liberar");
  expect(decidir(JSON.stringify({ tool_name: "Write", tool_input: { file_path: ["raw/x.md"] } })).acao).toBe("bloquear");
  expect(decidir(JSON.stringify({ tool_name: "Write", tool_input: { file_path: 7, destino: "raw/x.md" } })).acao).toBe("bloquear");
});
test("Dado comando de terminal ilegível Quando cita raw Então falha fechado e sem raw libera", () => {
  expect(decidir(JSON.stringify({ tool_name: "Bash", tool_input: { command: null } })).acao).toBe("liberar");
  expect(decidir(JSON.stringify({ tool_name: "Bash", tool_input: { command: { x: "raw/a.md" } } })).acao).toBe("bloquear");
  expect(decidir(JSON.stringify({ tool_name: "Bash", tool_input: { command: [1, "raw/a.md"] } })).acao).toBe("bloquear");
  expect(decidir(JSON.stringify({ tool_name: "Bash", tool_input: { command: [] } })).acao).toBe("liberar");
  expect(decidir(JSON.stringify({ tool_name: "Bash", tool_input: { command: "" } })).acao).toBe("liberar");
});
test("Dado patch sem chave de caminho Quando cita raw Então bloqueia e o mesmo patch em wiki passa", () => {
  expect(decidir(JSON.stringify({ tool_name: "apply_patch", tool_input: { patch: "*** Update File: raw/exemplo/a.md" } })).acao).toBe("bloquear");
  expect(decidir(JSON.stringify({ tool_name: "apply_patch", tool_input: { patch: "*** Update File: wiki/exemplo/a.md" } })).acao).toBe("liberar");
});
test("Dado escrita em wiki cujo conteúdo cita raw Quando decido Então não confunde conteúdo com destino", () => {
  expect(decidir(JSON.stringify({ tool_name: "Write", tool_input: { file_path: "wiki/a.md", content: "raw/ é imutável" } })).acao).toBe("liberar");
});
test("Dado ferramenta de leitura de arquivo Quando aponta para raw Então permite ingerir a fonte", () => {
  expect(decidir(JSON.stringify({ tool_name: "read_file", tool_input: { path: "raw/a.md" } })).acao).toBe("liberar");
});
test("Dado terminal com diretório de trabalho raw Quando grava caminho relativo Então bloqueia e leitura passa", () => {
  expect(decidir(JSON.stringify({ tool_name: "exec_command", tool_input: { cmd: "touch a.md", workdir: "raw" } })).acao).toBe("bloquear");
  expect(decidir(JSON.stringify({ tool_name: "exec_command", tool_input: { cmd: "cat a.md", workdir: "raw" } })).acao).toBe("liberar");
});

const escritas: Array<[string, string]> = [
  ["redirecionamento", "echo x > raw/a.md"], ["acréscimo", "echo x >> raw/a.md"],
  ["tee", "cat wiki/a.md | tee raw/a.md"], ["mv", "mv wiki/a.md raw/a.md"],
  ["cp", "cp wiki/a.md raw/a.md"], ["rm", "rm -rf raw/"], ["rmdir", "rmdir raw/"],
  ["sed -i", "sed -i 's/a/b/' raw/a.md"], ["perl -i", "perl -pi -e 's/a/b/' raw/a.md"],
  ["truncate", "truncate -s 0 raw/a.md"], ["touch", "touch raw/a.md"],
  ["ln", "ln -s wiki/a.md raw/a.md"], ["chmod", "chmod 644 raw/a.md"],
  ["git mv", "git mv wiki/a.md raw/a.md"], ["git rm", "git rm raw/a.md"],
];
for (const [verbo, comando] of escritas) {
  test(`Dado terminal ${verbo} Quando escreve em raw Então bloqueia e em wiki libera`, () => {
    expect(decidir(terminal(comando)).acao).toBe("bloquear");
    expect(decidir(terminal(comando.replaceAll("raw/", "wiki/"))).acao).toBe("liberar");
  });
}
for (const comando of ["cat raw/a.md", "rg palavra raw/", "ls raw/", "head raw/a.md", "wc -l raw/a.md", "git log -- raw/a.md", "cp raw/a.md wiki/copia.md", "sed 's/a/b/' raw/a.md", "perl -pe 's/a/b/' raw/a.md"]) {
  test(`Dado leitura ${comando} Quando decido Então libera`, () => {
    expect(decidir(terminal(comando)).acao).toBe("liberar");
  });
}
for (const comando of ['echo x > "raw/a b.md"', 'touch r""aw/a.md', "cp -t raw/ wiki/a.md", "cp --target-directory=raw/ wiki/a.md", "mv raw/a.md wiki/a.md", "cat raw/a.md && rm raw/b.md", 'echo "raw/a.md', "desconhecido raw/a.md", "$(touch raw/a.md)", "echo x > C:\\p\\raw\\a.md"]) {
  test(`Dado comando complexo ${comando} Quando pode escrever em raw Então bloqueia`, () => {
    expect(decidir(terminal(comando)).acao).toBe("bloquear");
  });
}
for (const nome of ["Bash", "exec_command", "shell_command", "shell", "run_shell_command", "bash", "powershell", "run_in_terminal"]) {
  test(`Dado terminal ${nome} Quando recebo escrita e leitura Então distingue as ações`, () => {
    expect(decidir(terminal("rm raw/a.md", nome)).acao).toBe("bloquear");
    expect(decidir(terminal("cat raw/a.md", nome)).acao).toBe("liberar");
  });
}

for (const comando of ["tail -n 3 raw/a.md", "grep -r palavra raw/", "echo raw/a.md > /dev/null", "git status raw/", "git -C raw status", "git commit -m 'docs sobre raw/'", "git add raw/a.md", "find raw/ -name '*.md'", "cd raw && cat a.md", "cd wiki && touch a.md", "echo $(date)", 'echo "aberto', "stat raw/a.md", "diff raw/a.md wiki/a.md", "cat raw/a.md | wc -l", "ls raw/ 2>&1"]) {
  test(`Dado leitura ou comando sem escrita ${comando} Quando decido Então libera`, () => {
    expect(decidir(terminal(comando)).acao).toBe("liberar");
  });
}
for (const comando of ["git checkout -- raw/a.md", "git restore raw/a.md", "git clean -fd raw/", "git -C . rm raw/a.md", "git -c core.x=1 mv wiki/a.md raw/a.md", "find raw/ -delete", "find raw -exec rm {} \;", "find raw -fprint wiki/x raw", "cd raw && touch a.md", "cd raw; rm a.md", "pushd raw && rm a.md", "tee -a raw/a.md", "echo x >| raw/a.md", "echo x &> raw/a.md", "echo x 2> raw/erro.log", "cat a >> raw/a.md", "ln -s a raw/b", "git mv raw/a.md wiki/a.md"]) {
  test(`Dado comando de escrita ${comando} Quando decido Então bloqueia`, () => {
    expect(decidir(terminal(comando)).acao).toBe("bloquear");
  });
}
for (const [comando, nome] of [["Remove-Item raw\\a.md", "powershell"], ["Copy-Item x raw\\a.md", "powershell"], ["Set-Content raw\\a.md x", "powershell"], ["del raw\\a.md", "powershell"]] as const) {
  test(`Dado PowerShell ${comando} Quando escreve em raw Então bloqueia e leitura equivalente libera`, () => {
    expect(decidir(terminal(comando, nome)).acao).toBe("bloquear");
    expect(decidir(terminal("Get-Content raw\\a.md", nome)).acao).toBe("liberar");
    expect(decidir(terminal("type raw\\a.md", nome)).acao).toBe("liberar");
  });
}
test("Dado terminal do Gemini Quando o diretório é raw Então dir_path conta como cwd", () => {
  expect(decidir(JSON.stringify({ tool_name: "run_shell_command", tool_input: { command: "touch a.md", dir_path: "raw" } })).acao).toBe("bloquear");
  expect(decidir(JSON.stringify({ tool_name: "run_shell_command", tool_input: { command: "touch a.md", dir_path: "wiki" } })).acao).toBe("liberar");
});
test("Dado terminal do Codex Quando o cwd da sessão está em raw Então comando relativo bloqueia e absoluto fora de raw libera", () => {
  expect(decidir(JSON.stringify({ tool_name: "Bash", cwd: "/p/raw", tool_input: { command: "touch a.md" } })).acao).toBe("bloquear");
  expect(decidir(JSON.stringify({ tool_name: "Bash", cwd: "/p/raw", tool_input: { command: "touch /p/wiki/a.md" } })).acao).toBe("liberar");
  expect(decidir(JSON.stringify({ tool_name: "Bash", cwd: "/p", tool_input: { command: "touch a.md" } })).acao).toBe("liberar");
});
test("Dado toolArgs JSON do Copilot Quando recebo terminal Então decodifica antes de decidir", () => {
  expect(decidir(JSON.stringify({ toolName: "bash", toolArgs: JSON.stringify({ command: "rm raw/a.md" }) })).acao).toBe("bloquear");
  expect(decidir(JSON.stringify({ toolName: "bash", toolArgs: JSON.stringify({ command: "cat raw/a.md" }) })).acao).toBe("liberar");
  expect(decidir(JSON.stringify({ toolName: "bash", toolArgs: "ilegível raw/" })).acao).toBe("bloquear");
});
test("Dado cmd do Codex como string ou vetor Quando decido Então protege raw e permite leitura", () => {
  expect(decidir(JSON.stringify({ tool_name: "exec_command", tool_input: { cmd: "touch raw/a" } })).acao).toBe("bloquear");
  expect(decidir(terminal(["bash", "-lc", "rm raw/a"], "shell")).acao).toBe("bloquear");
  expect(decidir(terminal(["cat", "raw/a"], "shell")).acao).toBe("liberar");
});

test("Dado o subcomando hook Quando recebe stdin Então mantém códigos 0 e 2 e a mensagem antiga", () => {
  const bloqueado = cli(arquivo("raw/exemplo/teste.md"));
  expect(bloqueado.exitCode).toBe(2);
  expect(bloqueado.stderr.toString()).toContain("Bloqueado: `raw/` é imutável para o agente. A camada de fontes é da pessoa que cura — acrescente o arquivo à mão e peça uma ingestão.");
  expect(bloqueado.stderr.toString()).toContain("Motivo:");
  const livre = cli(arquivo("wiki/a.md"));
  expect(livre.exitCode).toBe(0); expect(livre.stdout.toString()).toBe(""); expect(livre.stderr.toString()).toBe("");
  for (const args of [["hook"], ["hook", "--help"], ["hook", "outro"], ["hook", "proteger-raw", "extra"]]) {
    const r = cli("", args); expect(r.exitCode).toBe(2); expect(r.stderr.toString()).toContain("Uso:");
  }
});
test("Dado rastro opcional Quando executo Então é inerte por padrão e distingue PASSOU de BLOQUEADO", async () => {
  const dados = join(temporario, "dados"); mkdirSync(dados);
  expect(await executarProtecao(arquivo("raw/a.md"))).toBe(2);
  expect(readdirSync(dados)).toEqual([]);
  const log = join(dados, "rastro.log"); process.env.ANVILORE_LOG_HOOK = log;
  expect(await executarProtecao(arquivo("raw/a.md"))).toBe(2);
  expect(await executarProtecao(arquivo("wiki/a.md"))).toBe(0);
  const linhas = readFileSync(log, "utf8").trim().split("\n");
  expect(linhas).toHaveLength(2); expect(linhas[0]).toMatch(/^\d+\tBLOQUEADO\t.*raw\/a.md/); expect(linhas[1]).toContain("PASSOU\twiki/a.md");
  expect(readdirSync(dados)).toEqual(["rastro.log"]);
  process.env.ANVILORE_LOG_HOOK = join(temporario, "inexistente/rastro.log");
  expect(await executarProtecao(arquivo("raw/a.md"))).toBe(2);
  expect(await executarProtecao(arquivo("wiki/a.md"))).toBe(0);
  expect(consoleCapturado.erros.join("\n")).toContain("imutável");
});
test("Dado rastro apontando para raw Quando executo Então não escreve na camada protegida", async () => {
  const dir = join(temporario, "raw"); mkdirSync(dir);
  process.env.ANVILORE_LOG_HOOK = join(dir, "log.md");
  expect(await executarProtecao(arquivo("wiki/a.md"))).toBe(0);
  expect(readdirSync(dir)).toEqual([]);
});
test("Dado mutante que desativa a decisão Quando comparo Então raw deixa de bloquear e o original fica intacto", () => {
  const copia = join(temporario, "copia"); mkdirSync(copia); cpSync(join(raiz, "src"), join(copia, "src"), { recursive: true });
  const modulo = join(copia, "src/comandos/hook-proteger-raw.ts");
  const original = readFileSync(join(raiz, "src/comandos/hook-proteger-raw.ts"), "utf8");
  const mutado = original.replace('export function decidir(payload: string): Decisao {', 'export function decidir(payload: string): Decisao { return { acao: "liberar", motivo: "mutante" };');
  expect(mutado).not.toBe(original); writeFileSync(modulo, mutado);
  expect(cli(arquivo("raw/a.md"), ["hook", "proteger-raw"], copia).exitCode).toBe(0);
  expect(cli(arquivo("wiki/a.md"), ["hook", "proteger-raw"], copia).exitCode).toBe(0);
  expect(readFileSync(join(raiz, "src/comandos/hook-proteger-raw.ts"), "utf8")).toBe(original);
});

test("Dado barra invertida antes de espaço Quando o comando escreve em raw Então o tokenizador a trata como escape e bloqueia", () => {
  expect(decidir(terminal("rm raw/a\\ b.md")).acao).toBe("bloquear");
  expect(decidir(terminal("rm wiki/a\\ b.md")).acao).toBe("liberar");
});
test("Dado git sem subcomando Quando cita raw Então não é escrita", () => {
  expect(decidir(terminal("git -C raw")).acao).toBe("liberar");
});
test("Dado cd para fora de raw depois de cd raw Quando escreve Então só o trecho dentro de raw bloqueia", () => {
  expect(decidir(terminal("cd raw; cd ..; touch a.md")).acao).toBe("liberar");
  expect(decidir(terminal("cd raw && cd sub && touch a.md")).acao).toBe("bloquear");
});
test("Dado variável de ambiente antes do comando Quando lê ou escreve raw Então decide pelo verbo", () => {
  expect(decidir(terminal("LC_ALL=C cat raw/a.md")).acao).toBe("liberar");
  expect(decidir(terminal("LC_ALL=C rm raw/a.md")).acao).toBe("bloquear");
  expect(decidir(terminal("LC_ALL=C")).acao).toBe("liberar");
});

function comEntrada(texto: string | Error) {
  const espiao = spyOn(Bun.stdin, "text").mockImplementation(() => texto instanceof Error ? Promise.reject(texto) : Promise.resolve(texto));
  return { restaurar: () => espiao.mockRestore() };
}
test("Dado o comando hook em processo Quando a entrada bloqueia libera ou não pode ser lida Então devolve 2, 0 e 2", async () => {
  let entrada = comEntrada(arquivo("raw/a.md"));
  try { expect(await comandoHook(["proteger-raw"])).toBe(2); } finally { entrada.restaurar(); }
  entrada = comEntrada(arquivo("wiki/a.md"));
  try { expect(await comandoHook(["proteger-raw"])).toBe(0); } finally { entrada.restaurar(); }
  entrada = comEntrada(new Error("sem entrada"));
  try { expect(await comandoHook(["proteger-raw"])).toBe(2); } finally { entrada.restaurar(); }
  expect(consoleCapturado.erros.join("\n")).toContain("falha fechada");
  expect(await comandoHook(["outro"])).toBe(2);
});
