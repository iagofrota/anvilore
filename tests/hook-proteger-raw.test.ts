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
for (const comando of ["cat raw/a.md", "rg palavra raw/", "ls raw/", "head raw/a.md", "wc -l raw/a.md", "git log -- raw/a.md", "cp raw/a.md wiki/copia.md", "sed 's/a/b/' raw/a.md"]) {
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

for (const comando of ["sort -o raw/a.md wiki/b.md", "uniq wiki/a.md raw/b.md", "tree -o raw/a.txt wiki", "xxd wiki/a.bin raw/a.hex", "rg --pre ./apaga.sh palavra raw/", "perl -e 'unlink q(raw/a)' raw/", "perl script.pl raw/a.md", "perl -pe 's/a/b/' raw/a.md", "sed -n 'w raw/saida' wiki/a.md", "sed 's/a/b/w raw/saida' wiki/a.md", "sed -n '/x/w raw/o' wiki/a.md", "sed -e '1e rm raw/a' wiki/a.md", "cp -rt raw/ wiki/a.md", "cp -t raw/ wiki/a.md", "cp -traw/ wiki/a.md", "cp -rtraw/ wiki/a.md"]) {
  test(`Dado verbo com opção de saída ou execução ${comando} Quando cita raw Então bloqueia`, () => {
    expect(decidir(terminal(comando)).acao).toBe("bloquear");
  });
}
for (const comando of ["sed -n 's/novo/velho/p' raw/a.md", "sed -n '1,3p' raw/a.md", "rg palavra raw/", "cp -r raw/a.md wiki/copia.md", "cp -rt wiki/ raw/a.md"]) {
  test(`Dado leitura com sed rg ou cp ${comando} Quando decido Então libera`, () => {
    expect(decidir(terminal(comando)).acao).toBe("liberar");
  });
}

// Rodada de correção 1 (revisão Opus): grupo A — caminho que chega por pipe e cd com opção.
for (const comando of ["find raw -name '*.bak' | xargs rm", "ls raw/*.bak | xargs rm -f", "printf 'raw/a\\n' | xargs rm", "find raw -type f -print0 | xargs -0 rm", "xargs -0 rm < raw/lista", "find raw -exec rm {} +", "find raw -execdir rm {} \\;", "find raw -ok rm {} \\;", "ls raw | parallel rm", "cat raw/lista | xargs -n 1 rm", "cat raw/lista | head -3 | xargs rm", "echo rm raw/a | sh", "echo rm raw/a | bash", "cat raw/lista | nohup xargs rm", "cat raw/lista | xargs -I {} mv {} wiki/", "cat raw/lista | env FOO=1 xargs rm", "cat raw/lista | sudo xargs rm", "cat raw/lista | xargs sed -i s/a/b/", "cat raw/lista | xargs -I{} rm {}", "cat raw/lista | time xargs rm", "cat raw/lista | xargs -- rm"]) {
  test(`Dado pipe que traz caminho de raw ${comando} Quando um verbo de escrita age sobre ele Então bloqueia`, () => {
    expect(decidir(terminal(comando)).acao).toBe("bloquear");
  });
}
for (const comando of ["find wiki -name '*.bak' | xargs rm", "ls wiki/*.bak | xargs rm -f", "find raw -name '*.md' | xargs wc -l", "cat raw/lista | xargs -n 1 cat", "cat raw/a.md | sort | uniq", "cat raw/a.md | tee wiki/copia.md", "time cat raw/a.md", "nice rg palavra raw/", "cat raw/lista | xargs -n 1", "cat raw/a | head -3 | wc -l", "find raw -name '*.md' | head", "cat raw/lista && xargs rm < wiki/lista"]) {
  test(`Dado leitura em pipe ou em wrapper ${comando} Quando decido Então libera (controle)`, () => {
    expect(decidir(terminal(comando)).acao).toBe("liberar");
  });
}
for (const comando of ["cd -P raw && rm a", "cd -- raw && rm a", "cd -L raw; touch a", "cd -P -- raw && rm a", "pushd -- raw && rm a"]) {
  test(`Dado cd com opção ${comando} Quando o comando seguinte escreve Então o diretório continua raw e bloqueia`, () => {
    expect(decidir(terminal(comando)).acao).toBe("bloquear");
  });
}
test("Dado cd com opção para fora de raw Quando escreve Então libera e cd - não inventa diretório", () => {
  expect(decidir(terminal("cd -P wiki && touch a")).acao).toBe("liberar");
  expect(decidir(terminal("cd - && touch a")).acao).toBe("liberar");
});
test("Dado less ou more com opção de saída Quando cita raw Então bloqueia e a leitura simples libera", () => {
  expect(decidir(terminal("less -o raw/log wiki/a.md")).acao).toBe("bloquear");
  expect(decidir(terminal("less raw/a.md")).acao).toBe("bloquear");
  expect(decidir(terminal("cat raw/a.md | head")).acao).toBe("liberar");
});

// Grupo B — rota do payload: command + caminho (I1), toolArgs do Copilot (I2), destino em outra chave (M3).
test("Dado ferramenta de editor com command e path Quando o path cai em raw Então bloqueia mesmo com command inofensivo", () => {
  expect(decidir(JSON.stringify({ tool_name: "str_replace_editor", tool_input: { command: "create", path: "raw/a.md", file_text: "x" } })).acao).toBe("bloquear");
  expect(decidir(JSON.stringify({ tool_name: "str_replace_editor", tool_input: { command: "create", path: "wiki/a.md", file_text: "cita raw/a.md" } })).acao).toBe("liberar");
  expect(decidir(JSON.stringify({ tool_name: "Edit", tool_input: { command: null, file_path: "raw/a.md" } })).acao).toBe("bloquear");
  expect(decidir(JSON.stringify({ tool_name: "Edit", tool_input: { command: null, file_path: "wiki/a.md" } })).acao).toBe("liberar");
});
test("Dado terminal com caminho de arquivo no payload Quando um dos dois cai em raw Então bloqueia", () => {
  expect(decidir(JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls", file_path: "raw/a.md" } })).acao).toBe("bloquear");
  expect(decidir(JSON.stringify({ tool_name: "Bash", tool_input: { command: "rm raw/a", file_path: "wiki/a.md" } })).acao).toBe("bloquear");
  expect(decidir(JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls", file_path: "wiki/a.md" } })).acao).toBe("liberar");
});
test("Dado toolArgs do Copilot em texto Quando a página da wiki cita raw no conteúdo Então libera e o caminho em raw bloqueia", () => {
  const copilot = (nome: string, args: unknown) => JSON.stringify({ toolName: nome, toolArgs: JSON.stringify(args) });
  expect(decidir(copilot("create", { path: "wiki/a.md", file_text: "original_file: raw/a.pdf" })).acao).toBe("liberar");
  expect(decidir(copilot("edit", { path: "wiki/a.md", old_str: "x", new_str: "resource: raw/a.pdf" })).acao).toBe("liberar");
  expect(decidir(copilot("create", { path: "raw/a.md", file_text: "x" })).acao).toBe("bloquear");
  expect(decidir(copilot("edit", { path: "C:\\p\\raw\\a.md", old_str: "x", new_str: "y" })).acao).toBe("bloquear");
});
test("Dado ferramenta com caminho fora de raw e destino em outra chave Quando o destino cai em raw Então bloqueia", () => {
  for (const chave of ["destination", "destinationPath", "dest", "new_path", "newPath", "old_path", "target_path", "output_path"]) {
    expect(decidir(JSON.stringify({ tool_name: "mcp_mover", tool_input: { path: "wiki/a", [chave]: "raw/a" } })).acao).toBe("bloquear");
    expect(decidir(JSON.stringify({ tool_name: "mcp_mover", tool_input: { path: "wiki/a", [chave]: "wiki/b" } })).acao).toBe("liberar");
  }
});

// Grupo C — git: só os subcomandos de leitura passam quando citam raw (I3).
for (const comando of ["git clone https://x/y.git raw/y", "git -C raw init", "git worktree add raw/x", "git submodule add https://x/y raw/s", "git archive -o raw/a.tar HEAD", "git format-patch -o raw/ HEAD~1", "git diff --output=raw/a.patch", "git log --output raw/log.txt", "git show --output=raw/s.txt HEAD", "git stash push raw/a.md", "git apply raw/a.patch", "git mv wiki/a raw/a", "git reflog expire --all raw", "git switch raw/x", "git cherry-pick raw", "git -c alias.x='!rm' x raw/a", "git init raw", "git checkout raw/a.md", "git clean -fd raw", "git restore raw/a.md"]) {
  test(`Dado git que não é leitura ${comando} Quando cita raw Então bloqueia`, () => {
    expect(decidir(terminal(comando)).acao).toBe("bloquear");
  });
}
for (const comando of ["git commit -m 'ingere raw/a'", "git add raw/a", "git status raw/", "git log -- raw/a.md", "git show HEAD:raw/a.md", "git diff raw/", "git blame raw/a.md", "git grep palavra -- raw/", "git ls-files raw", "git ls-tree HEAD raw/", "git -C raw status", "git rev-parse raw", "git cat-file -p HEAD:raw/a", "git describe --tags raw", "git shortlog -- raw/", "git reflog show raw", "git branch raw/x", "git tag raw-v1", "git rev-list HEAD -- raw/", "git -C . log -- raw/a.md", "git"]) {
  test(`Dado git de leitura ${comando} Quando cita raw Então libera`, () => {
    expect(decidir(terminal(comando)).acao).toBe("liberar");
  });
}

// Grupo D — R64: apagar um ancestral de raw/ ou rodar git clean -x destrói raw/ sem citá-lo.
const comCwd = (comando: string, cwd: string) => JSON.stringify({ tool_name: "Bash", cwd, tool_input: { command: comando } });
for (const comando of ["git clean -fdx", "git clean -fdX", "git clean -xdf", "git clean -fd -x", "git -C . clean -fdx", "sudo git clean -fdx", "rm -rf .", "rm -rf ./", "rm -rf ..", "rm -rf ../..", "rm -rf *", "rm -rf ./*", "rm -r .", "rm -Rf .", "rm --recursive -f .", "rm -fr ../*", "rmdir .", "sudo rm -rf .", "find . -name '*.md' -delete", "find . -exec rm {} +", "find .. -delete", "find ./ -type f -exec rm -rf {} \\;", "find * -delete", "Remove-Item -Recurse -Force .", "rd /s /q .", "rm -rf /", "cd wiki && rm -rf .."]) {
  test(`Dado comando que apaga ancestral de raw ${comando} Quando não cita raw Então bloqueia`, () => {
    expect(decidir(terminal(comando)).acao).toBe("bloquear");
  });
}
test("Dado cwd absoluto Quando apaga a raiz do projeto ou um ancestral Então bloqueia e outros diretórios passam", () => {
  const raiz = "/srv/equipe/proj";
  for (const alvo of [raiz, `${raiz}/`, "/srv/equipe", "/srv", "/"]) expect(decidir(comCwd(`rm -rf ${alvo}`, raiz)).acao).toBe("bloquear");
  expect(decidir(comCwd(`rm -rf ${raiz}/wiki`, raiz)).acao).toBe("liberar");
  expect(decidir(comCwd("rm -rf /srv/equipe/outro", raiz)).acao).toBe("liberar");
  expect(decidir(comCwd("rm -rf /tmp/x", raiz)).acao).toBe("liberar");
  expect(decidir(comCwd(`find ${raiz} -delete`, `${raiz}/wiki`)).acao).toBe("bloquear");
  expect(decidir(comCwd("rm -rf C:\\proj", "C:\\proj")).acao).toBe("bloquear");
  // o cwd absoluto pode ser a raiz do projeto: apagá-lo bloqueia, mesmo que seja uma subpasta.
  expect(decidir(comCwd("rm -rf /srv/equipe/proj/wiki", "/srv/equipe/proj/wiki")).acao).toBe("bloquear");
  expect(decidir(comCwd("rm -rf /srv/equipe/proj/wiki/tmp", "/srv/equipe/proj/wiki")).acao).toBe("liberar");
});
for (const comando of ["rm -rf wiki/tmp", "rm -f *.tmp", "rm -rf node_modules", "rm a.md", "rm -r wiki/x", "find wiki -name '*.tmp' -delete", "find . -name '*.md'", "find . -exec cat {} +", "git clean -fd", "git clean -n", "rm -rf $TMP/*", "rm -rf /tmp/x", "cd wiki && rm -rf .", "cd wiki && rm -rf ./*", "cd -- wiki/sub && rm -r *", "rmdir wiki/vazio", "Remove-Item -Force wiki/a.md", "rm -rf wiki/.", "ls -R ."]) {
  test(`Dado limpeza restrita ${comando} Quando não cita raw Então libera (controle)`, () => {
    expect(decidir(terminal(comando)).acao).toBe("liberar");
  });
}

// Grupo E — argumentos do próprio envolvedor e cd -.
for (const comando of ["env -C raw rm a", "env --chdir=raw rm a", "env -S 'rm raw/a'", "xargs -a raw/lista rm", "sudo -D raw rm a", "nice -n 5 -C raw rm a", "timeout -k raw 5 rm a"]) {
  test(`Dado envolvedor cujas opções citam raw ${comando} Quando executa escrita Então bloqueia`, () => {
    expect(decidir(terminal(comando)).acao).toBe("bloquear");
  });
}
test("Dado envolvedor sem comando Quando recebe pipe com raw Então só o xargs, que repete a entrada, libera", () => {
  expect(decidir(terminal("cat raw/cmds | parallel")).acao).toBe("bloquear");
  expect(decidir(terminal("cat raw/cmds | sudo -s")).acao).toBe("bloquear");
  expect(decidir(terminal("cat raw/cmds | env")).acao).toBe("bloquear");
  expect(decidir(terminal("cat raw/cmds | xargs")).acao).toBe("liberar");
  expect(decidir(terminal("cat wiki/cmds | parallel")).acao).toBe("liberar");
  expect(decidir(terminal("env")).acao).toBe("liberar");
});
test("Dado cd - e popd Quando voltam a raw Então o diretório anterior é seguido", () => {
  expect(decidir(terminal("cd raw && cd ../wiki && cd - && rm a")).acao).toBe("bloquear");
  expect(decidir(terminal("cd raw && cd ../wiki && popd && touch a")).acao).toBe("bloquear");
  expect(decidir(terminal("cd wiki && cd raw && cd - && touch a")).acao).toBe("liberar");
  expect(decidir(terminal("cd raw && cd - && touch a")).acao).toBe("liberar");
});

// Grupo F — git com opção que executa programa ou muda configuração (revisão de segurança automática).
for (const comando of ["git grep -O'rm -f' x -- raw/", "git grep --open-files-in-pager=rm x raw/", "git -c core.pager='rm raw/a' log -- raw/", "git -c diff.external=rm diff raw/", "git --config-env=core.pager=X log raw/", "GIT_EXTERNAL_DIFF=rm git diff raw/", "PAGER=rm git log -- raw/", "GIT_CONFIG_COUNT=1 git log raw/", "git --exec-path=/tmp log raw/"]) {
  test(`Dado git de leitura com programa externo ${comando} Quando cita raw Então bloqueia`, () => {
    expect(decidir(terminal(comando)).acao).toBe("bloquear");
  });
}
test("Dado git de leitura com opção comum e variável inofensiva Quando cita raw Então continua liberando", () => {
  expect(decidir(terminal("git -C . log --oneline -- raw/a.md")).acao).toBe("liberar");
  expect(decidir(terminal("LC_ALL=C git log -- raw/a.md")).acao).toBe("liberar");
  expect(decidir(terminal("git grep -n palavra -- raw/")).acao).toBe("liberar");
});

// Grupo G — find sem caminho ou com -H/-L/-P, e script de `sh -c` lido por inteiro.
for (const comando of ["find -delete", "find -H . -delete", "find -L .. -exec rm {} +", "find -P * -delete", "find -D tree -O3 -H . -delete", "bash -c 'rm -rf .'", "sh -c \"find . -delete\"", "bash -lc 'git clean -fdx'", "sudo bash -c 'rm -rf ..'", "bash -c 'echo ok; rm -rf *'"]) {
  test(`Dado apagamento amplo escondido ${comando} Quando não cita raw Então bloqueia`, () => {
    expect(decidir(terminal(comando)).acao).toBe("bloquear");
  });
}
for (const comando of ["bash -c 'cat raw/a.md'", "sh -c 'ls wiki'", "bash -c 'rm wiki/a.md'", "find wiki -delete", "find -name '*.md'", "bash script.sh"]) {
  test(`Dado shell com script inofensivo ${comando} Quando decido Então libera (controle)`, () => {
    expect(decidir(terminal(comando)).acao).toBe("liberar");
  });
}

test("Dado opção colada do envolvedor com raw Quando executa escrita Então bloqueia (env -Craw, sudo -Draw)", () => {
  for (const comando of ["env -Craw rm a", "sudo -Draw rm a", "env --chdir=RAW rm a", "xargs -araw/lista rm"]) expect(decidir(terminal(comando)).acao).toBe("bloquear");
  expect(decidir(terminal("env -Cwiki rm a")).acao).toBe("liberar");
});

// Grupo H — revisão automática: argumentos posicionais de sh -c, abreviação de opção do git e GIT_* passado por envolvedor.
test("Dado sh -c com argumentos posicionais Quando eles citam raw Então bloqueia mesmo que o script não cite", () => {
  for (const comando of ["bash -c 'rm $1' _ raw/a", "sh -c 'rm \"$@\"' sh raw/a raw/b", "bash -lc 'touch $0' raw/a"]) expect(decidir(terminal(comando)).acao).toBe("bloquear");
  expect(decidir(terminal("bash -c 'rm $1' _ wiki/a")).acao).toBe("liberar");
});
test("Dado opção abreviada do git Quando aponta saída ou pager Então bloqueia e a leitura comum libera", () => {
  for (const comando of ["git diff --outp=raw/a.patch", "git log --outpu raw/x", "git grep --open=rm x raw/", "git grep --open-files x -- raw/"]) expect(decidir(terminal(comando)).acao).toBe("bloquear");
  expect(decidir(terminal("git log --oneline --stat -- raw/a.md")).acao).toBe("liberar");
});
test("Dado GIT_ passado por envolvedor Quando o comando é git de leitura citando raw Então bloqueia", () => {
  for (const comando of ["env GIT_EXTERNAL_DIFF=rm git diff raw/", "sudo PAGER=rm git log raw/", "env -i PAGER=rm git log raw/"]) expect(decidir(terminal(comando)).acao).toBe("bloquear");
  expect(decidir(terminal("env LC_ALL=C git log -- raw/a.md")).acao).toBe("liberar");
});

test("Dado git grep com -O agrupado ou variável qualquer antes do git Quando cita raw Então bloqueia e só locale libera", () => {
  for (const comando of ["git grep -nO'rm -f' x -- raw/", "git grep -iO rm x raw/", "FOO=1 git log -- raw/a.md", "env HOME=/tmp git log raw/", "XDG_CONFIG_HOME=/tmp git log -- raw/"]) expect(decidir(terminal(comando)).acao).toBe("bloquear");
  for (const comando of ["LC_ALL=C git log -- raw/a.md", "TZ=UTC git log -- raw/", "env LANG=C git grep -n x -- raw/"]) expect(decidir(terminal(comando)).acao).toBe("liberar");
});
test("Dado apply_patch do Codex Quando uma página da wiki ganha original_file com raw Então bloqueia (limite documentado: falso positivo)", () => {
  const patch = "*** Begin Patch\n*** Update File: wiki/a.md\n+original_file: raw/a.pdf\n*** End Patch";
  expect(decidir(JSON.stringify({ tool_name: "apply_patch", tool_input: { command: patch } })).acao).toBe("bloquear");
  const semRaw = "*** Begin Patch\n*** Update File: wiki/a.md\n+texto novo\n*** End Patch";
  expect(decidir(JSON.stringify({ tool_name: "apply_patch", tool_input: { command: semRaw } })).acao).toBe("liberar");
});
