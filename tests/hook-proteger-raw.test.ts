import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
for (const comando of [
  "cp wiki/a.md raw/a.md -v", "cp wiki/a.md raw/a.md --force",
  "cp -S .bak wiki/a.md raw/a.md -v", "cp -- wiki/a.md raw/a.md",
  "cp wiki/a.md raw/a.md --suffix .bak", "cp wiki/a.md raw/a.md -vS .bak",
]) {
  test(`Dado cp com opções e operandos Quando avalio ${comando} Então bloqueia raw e permite a ingestão`, () => {
    expect(cli(terminal(comando)).exitCode).toBe(2);
    for (const leitura of ["cp raw/a.md wiki/a.md -v", "cp -v raw/a.md wiki/a.md", "cp raw/a.md wiki/ --preserve=mode"]) {
      expect(cli(terminal(leitura)).exitCode).toBe(0);
    }
  });
}
for (const opcao of ["-S", "-vS", "--suffix"]) {
  test(`Dado cp com ${opcao} após o destino Quando o sufixo cita raw Então ignora o valor da opção`, () => {
    expect(cli(terminal(`cp raw/a.md wiki/a.md ${opcao} raw/sufixo`)).exitCode).toBe(0);
  });
}
for (const comando of ["cp --target-dir=raw wiki/a.md", "cp --target raw wiki/a.md", "cp --t=raw wiki/a.md", "cp wiki/a.md raw/a.md --su .bak"]) {
  test(`Dado opção longa GNU abreviada Quando avalio ${comando} Então bloqueia a escrita em raw`, () => {
    expect(cli(terminal(comando)).exitCode).toBe(2);
    expect(cli(terminal("cp --target-dir=wiki raw/a.md")).exitCode).toBe(0);
  });
}
test("Dado sufixo GNU abreviado Quando seu valor cita raw Então continua sendo sufixo da cópia para wiki", () => {
  expect(cli(terminal("cp raw/a.md wiki/a.md --su raw/sufixo")).exitCode).toBe(0);
});
for (const [opcao, comando] of [
  ["env --split-string", "env --s='rm -rf .'"],
  ["env --unset", "find . | env --u LANG rm"],
  ["env --chdir", "find . | env --c . rm"],
  ["xargs --max-args", "find . | xargs --max-a 1 rm"],
  ["xargs --max-procs", "find . | xargs --max-p 1 rm"],
  ["xargs --max-lines", "find . | xargs --max-l 1 rm"],
  ["xargs --max-chars", "find . | xargs --max-c 1000 rm"],
  ["xargs --delimiter", "find . | xargs --d , rm"],
  ["xargs --arg-file", "xargs --a wiki/lista rm -rf ."],
  ["xargs --replace", "find . | xargs --r={} rm {}"],
  ["xargs --eof", "find . | xargs --eo=FIM rm"],
  ["timeout --signal", "find . | timeout --s TERM 10 rm"],
  ["timeout --kill-after", "find . | timeout --k 1 10 rm"],
  ["nice --adjustment", "find . | nice --a 1 rm"],
  ["time --output", "find . | /usr/bin/time --o wiki/tempo rm"],
  ["time --format", "find . | /usr/bin/time --f %e rm"],
  ["ionice --class", "find . | ionice --class 3 rm"],
  ["ionice --classdata", "find . | ionice --classd 1 rm"],
  ["sudo --user", "find . | sudo --u root rm"],
  ["sudo --group", "find . | sudo --g root rm"],
  ["sudo --chdir", "find . | sudo --chd . rm"],
  ["stdbuf --input", "find . | stdbuf --i 0 rm"],
  ["stdbuf --output", "find . | stdbuf --o L rm"],
  ["stdbuf --error", "find . | stdbuf --e 0 rm"],
  ["rm --recursive", "rm --rec ."],
  ["grep --recursive", "grep --rec -l x . | xargs rm"],
  ["grep --dereference-recursive", "grep --der -l x . | xargs rm"],
  ["grep --regexp", "grep --rec -l --reg=x . | xargs rm"],
  ["grep --file", "grep --rec -l --file wiki/padroes . | xargs rm"],
  ["sed --in-place", "sed --i 's/a/b/' raw/a.md"],
  ["git --output", "git diff --outp=raw/a.patch"],
  ["git --open-files-in-pager", "git grep --op=rm x raw/"],
]) {
  test(`Dado prefixo GNU de ${opcao} Quando alcança escrita protegida Então bloqueia`, () => {
    expect(cli(terminal(comando)).exitCode).toBe(2);
  });
}
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
for (const comando of ["find wiki -name '*.bak' | xargs rm", "ls wiki/*.bak | xargs rm -f", "find raw -name '*.md' | xargs wc -l", "cat raw/lista | xargs -n 1 cat", "cat raw/a.md | sort | uniq", "cat raw/a.md | tee wiki/copia.md", "time cat raw/a.md", "nice rg palavra raw/", "cat raw/lista | xargs -n 1", "cat raw/a | head -3 | wc -l", "find raw -name '*.md' | head", "cat raw/lista && cat wiki/lista"]) {
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
  for (const comando of ["git grep -nO'rm -f' x -- raw/", "git grep -iO rm x raw/", "git grep -A1O rm x -- raw/", "FOO=1 git log -- raw/a.md", "env HOME=/tmp git log raw/", "XDG_CONFIG_HOME=/tmp git log -- raw/"]) expect(decidir(terminal(comando)).acao).toBe("bloquear");
  for (const comando of ["LC_ALL=C git log -- raw/a.md", "TZ=UTC git log -- raw/", "env LANG=C git grep -n x -- raw/"]) expect(decidir(terminal(comando)).acao).toBe("liberar");
});
test("Dado apply_patch do Codex Quando uma página da wiki ganha original_file com raw Então bloqueia (limite documentado: falso positivo)", () => {
  const patch = "*** Begin Patch\n*** Update File: wiki/a.md\n+original_file: raw/a.pdf\n*** End Patch";
  expect(decidir(JSON.stringify({ tool_name: "apply_patch", tool_input: { command: patch } })).acao).toBe("bloquear");
  const semRaw = "*** Begin Patch\n*** Update File: wiki/a.md\n+texto novo\n*** End Patch";
  expect(decidir(JSON.stringify({ tool_name: "apply_patch", tool_input: { command: semRaw } })).acao).toBe("liberar");
});

// R65: no cmd o sufixo `; exit $LASTEXITCODE` chega ao bun como argumentos; o subcomando o ignora, mas só ele.
test("Dado o sufixo de saída que o cmd repassa como argumentos Quando chamo o hook Então decide normalmente e outros argumentos continuam recusados", () => {
  expect(cli(arquivo("raw/a.md"), ["hook", "proteger-raw;", "exit", "$LASTEXITCODE"]).exitCode).toBe(2);
  expect(cli(arquivo("wiki/a.md"), ["hook", "proteger-raw;", "exit", "$LASTEXITCODE"]).exitCode).toBe(0);
  expect(cli(arquivo("wiki/a.md"), ["hook", "proteger-raw", ";", "exit", "$LASTEXITCODE"]).exitCode).toBe(0);
  expect(cli(arquivo("raw/a.md"), ["hook", "proteger-raw", ";", "exit", "$LASTEXITCODE"]).exitCode).toBe(2);
  for (const args of [["hook", "proteger-raw", "exit"], ["hook", "proteger-raw;x"], ["hook", "proteger-raw", "; rm"], ["hook", "proteger-raw;", "rm", "raw/a"]]) {
    expect(cli(arquivo("wiki/a.md"), args).exitCode).toBe(2);
  }
});

// R66 parte 1 — comando que cita raw e tem verbo de escrita em QUALQUER segmento bloqueia (laços, pipeline do PowerShell).
for (const comando of ["find raw -type f | while read f; do rm \"$f\"; done", "ls raw | while read f; do mv \"raw/$f\" /tmp/; done", "find raw -name '*.tmp' | while read -r f; do shred \"$f\"; done", "for f in $(cat raw/lista); do rm $f; done", "cat raw/lista | while read f; do touch \"$f\"; done", "until false; do cat raw/a; rm b; done", "cat raw/a.md; rm wiki/x.md", "cat raw/a.md && chmod 600 wiki/x.md", "rg x raw/ ; truncate -s0 wiki/x.md", "if cat raw/a.md; then rm wiki/y; fi", "! cat raw/a.md || ln -s a wiki/b", "cat raw/a.md | sed -i s/a/b/ wiki/x.md", "cat raw/a.md | python3 -c 'import sys'", "ls raw | node -e 'process.exit()'", "cat raw/a.md | install -m 600 /dev/stdin wiki/x", "cat raw/a.md | dd of=wiki/x", "cat raw/a.md | rsync -a wiki/ /tmp/", "rm wiki/a.md; cat raw/b.md"]) {
  test(`Dado verbo de escrita em outro segmento ${comando} Quando o comando cita raw Então bloqueia`, () => {
    expect(decidir(terminal(comando)).acao).toBe("bloquear");
  });
}
for (const comando of ["Get-ChildItem raw\\*.bak | Remove-Item", "ls raw | rm", "gci raw | Move-Item -Destination wiki", "gci raw -Recurse | Rename-Item -NewName x", "gci raw | del", "gci raw | erase", "gci raw | ren -NewName x"]) {
  test(`Dado cmdlet de escrita do PowerShell ${comando} Quando o comando cita raw Então bloqueia`, () => {
    expect(decidir(terminal(comando, "powershell")).acao).toBe("bloquear");
  });
}
for (const comando of ["rg x raw/ > /tmp/saida", "cat raw/a.md | wc -l", "cat raw/a.md | tee wiki/copia.md", "cp raw/a.md wiki/a.md", "cat raw/a.md | grep x | head -3", "rm wiki/a.md; cat wiki/b.md", "find wiki -name '*.bak' | while read f; do rm \"$f\"; done", "for f in wiki/*; do cat \"$f\"; done", "Get-Content raw\\a.md | Select-String x", "gci raw | Select-Object Name", "Get-ChildItem wiki | Remove-Item", "git log -- raw/a.md; ls wiki", "sed -n 1,3p raw/a.md | cat", "python3 ler.py wiki/a.md", "cat raw/a.md; env"]) {
  test(`Dado leitura de raw sem verbo de escrita ou escrita sem raw ${comando} Quando decido Então libera (controle)`, () => {
    expect(decidir(terminal(comando, comando.includes("\\") || /Get-|gci|dir /.test(comando) ? "powershell" : "Bash")).acao).toBe("liberar");
  });
}

// R66 parte 2 — opções por envolvedor (RI1).
for (const comando of ["env -i bash -c 'rm raw/a'", "env -i rm raw/a", "env -u FOO rm raw/a", "env -- rm raw/a", "env -0 rm raw/a", "timeout 10 rm -rf .", "timeout -s KILL 5 find . -delete", "timeout --signal=KILL 5 rm raw/a", "timeout -k 3 10 rm raw/a", "nice -n 5 rm raw/a", "nice -5 rm raw/a", "ionice -c3 rm raw/a", "sudo -u root rm -rf .", "sudo -E rm raw/a", "sudo -g wheel -u root rm raw/a", "nohup rm raw/a", "time rm raw/a", "time -p rm raw/a", "command rm raw/a", "exec rm raw/a", "\\rm raw/a", "stdbuf -oL rm raw/a", "stdbuf -o L rm raw/a", "xargs -n 1 rm raw/a", "cat raw/lista | xargs -I{} -P 4 rm {}", "setsid rm raw/a", "doas -u root rm raw/a", "env FOO=1 -i rm raw/a"]) {
  test(`Dado envolvedor com as próprias opções ${comando} Quando o comando de dentro escreve Então bloqueia`, () => {
    expect(decidir(terminal(comando)).acao).toBe("bloquear");
  });
}
for (const comando of ["env -i cat raw/a.md", "env -u FOO cat raw/a.md", "timeout 10 cat raw/a.md", "timeout -s KILL 5 rg x raw/", "nice -n 5 rg x raw/", "ionice -c3 cat raw/a.md", "sudo -u root cat raw/a.md", "time -p cat raw/a.md", "command cat raw/a.md", "stdbuf -oL cat raw/a.md", "doas -u root ls raw/", "timeout 10 rm -f wiki/a.md", "env -i rm wiki/a.md"]) {
  test(`Dado envolvedor com leitura ${comando} Quando decido Então libera (controle)`, () => {
    expect(decidir(terminal(comando)).acao).toBe("liberar");
  });
}

// R66 parte 2 — ancestral resolvido contra o cwd (RI2), edição em massa por find/exec e pipeline recursiva do PowerShell (RI5).
test("Dado cwd absoluto Quando o alvo relativo sobe até a raiz do projeto Então bloqueia e irmãos e filhos passam", () => {
  const proj = "/srv/equipe/proj";
  for (const comando of ["rm -rf ../proj", "cd .. && rm -rf proj", "rm -rf ../", "rm -rf ../*", "rm -rf ./*", "rm -rf *", "cd wiki && rm -rf ..", "cd .. && rm -rf ./proj/", "rm -rf -- */", "rm -rf ./*/", "rm -rf /srv", "rm -rf /srv/equipe", "find .. -name proj -exec rm -rf {} +"]) {
    expect(decidir(comCwd(comando, proj)).acao).toBe("bloquear");
  }
  for (const comando of ["rm -rf ../outro", "rm -rf wiki/*", "rm -rf wiki/sources", "cd wiki && rm -rf .", "cd wiki && rm -rf ./*", "rm -rf /srv/outra/pasta", "cd .. && rm -rf outro", "find wiki -exec sed -i s/a/b/ {} +"]) {
    expect(decidir(comCwd(comando, proj)).acao).toBe("liberar");
  }
});
test("Dado find com -exec de escrita Quando o diretório é ancestral de raw Então bloqueia e leitura passa", () => {
  for (const comando of ["find . -name '*.md' -exec sed -i 's/a/b/' {} +", "find . -type f -exec chmod 600 {} +", "find . -execdir mv {} /tmp/ \\;", "find . -ok rm {} \\;", "find . -exec python3 -c 'x' {} +", "find . -exec sudo rm {} +"]) {
    expect(decidir(terminal(comando)).acao).toBe("bloquear");
  }
  for (const comando of ["find . -exec cat {} +", "find . -exec grep -l x {} +", "find wiki -exec sed -i s/a/b/ {} +", "find . -exec sed -n 1p {} +"]) {
    expect(decidir(terminal(comando)).acao).toBe("liberar");
  }
});
test("Dado Get-ChildItem recursivo no diretório do projeto Quando a pipeline escreve ou remove Então bloqueia", () => {
  for (const comando of ["Get-ChildItem -Recurse | Remove-Item", "gci -r -Filter *.tmp | Remove-Item -Force", "Get-ChildItem . -Recurse | Move-Item -Destination x", "ls -Recurse | rm", "dir -Recurse | Rename-Item -NewName y", "Get-ChildItem -Recurse | Select-Object -First 1 | Remove-Item", "Get-ChildItem -Path * -Recurse | Remove-Item -Force"]) {
    expect(decidir(terminal(comando, "powershell")).acao).toBe("bloquear");
  }
  for (const comando of ["Get-ChildItem wiki -Recurse | Remove-Item", "gci . -Recurse | Select-Object Name", "Get-ChildItem | Remove-Item", "gci -Recurse | Measure-Object", "gci wiki | Remove-Item"]) {
    expect(decidir(terminal(comando, "powershell")).acao).toBe("liberar");
  }
});
test("Dado pasta de uma letra na raiz Quando apaga recursivamente Então /p não é lido como opção do cmd", () => {
  expect(decidir(comCwd("rm -rf /p/proj", "/p/proj")).acao).toBe("bloquear");
  expect(decidir(comCwd("rm -rf /p", "/p/proj")).acao).toBe("bloquear");
  expect(decidir(comCwd("rd /s /q /p", "/p/proj")).acao).toBe("liberar");
  expect(decidir(comCwd("rd /s /q C:\\p", "C:\\p\\proj")).acao).toBe("bloquear");
});
test("Dado cmd /c, busybox e source de stdin Quando escondem apagamento amplo Então bloqueia e os leitores passam", () => {
  for (const comando of ["cmd /c rd /s /q .", "cmd /c \"rd /s /q .\"", "cmd /k del /s /q *", "busybox rm -rf .", "busybox rm raw/a", "cat raw/a.md | source /dev/stdin", "cat raw/a.md | . /dev/stdin"]) {
    expect(decidir(terminal(comando)).acao).toBe("bloquear");
  }
  for (const comando of ["cmd /c dir", "cmd /c type raw\\a.md", "busybox cat raw/a.md", "source wiki/env.sh"]) {
    expect(decidir(terminal(comando)).acao).toBe("liberar");
  }
});

// Rodada 3 (R68) — C2: sed -i agrupado com opção maiúscula.
for (const comando of ["sed -Ei 's/a/b/' raw/a.md", "sed -Ei.bak 's/a/b/' raw/a.md", "sed -rEi 's/a/b/' raw/a.md", "sed -E -i 's/a/b/' raw/a.md", "sed -Ie 's/a/b/' raw/a.md", "sed -nEi 's/a/b/p' raw/a.md", "rg -l foo raw | xargs sed -Ei 's/a/b/'", "cat raw/lista | xargs sed -rEi s/a/b/", "sed -EI 's/a/b/' raw/a.md", "perl -pi.bak -e 's/a/b/' raw/a.md"]) {
  test(`Dado sed in-place com opções agrupadas ${comando} Quando cita raw Então bloqueia`, () => {
    expect(decidir(terminal(comando)).acao).toBe("bloquear");
  });
}
for (const comando of ["sed -E -n 's/a/b/p' raw/a.md", "sed -En 's/a/b/p' raw/a.md", "sed -E 's/i/x/' raw/a.md", "sed --expression='s/a/b/' raw/a.md", "sed -Ei 's/a/b/' wiki/a.md"]) {
  test(`Dado sed sem in-place ${comando} Quando decido Então libera (controle)`, () => {
    expect(decidir(terminal(comando)).acao).toBe("liberar");
  });
}

// Rodada 3 — I1: cmdlets de cópia e gravação do PowerShell e `copy` do cmd são julgados pelo destino, como cp e tee.
for (const [nome, apelido, valor] of [
  ["ErrorAction", "ea", "Stop"], ["WarningAction", "wa", "Continue"],
  ["InformationAction", "infa", "Continue"], ["ProgressAction", "proga", "Continue"],
  ["ErrorVariable", "ev", "erros"], ["WarningVariable", "wv", "avisos"],
  ["InformationVariable", "iv", "informacoes"], ["OutVariable", "ov", "saida"],
  ["OutBuffer", "ob", "1"], ["PipelineVariable", "pv", "item"],
]) {
  test(`Dado parâmetro comum PowerShell ${nome} Quando acompanha uma cópia Então não esconde o destino`, () => {
    for (const parametro of [nome, apelido]) {
      expect(cli(terminal(`Copy-Item wiki/a.md raw/a.md -${parametro} ${valor}`, "powershell")).exitCode).toBe(2);
      expect(cli(terminal(`Copy-Item -${parametro} ${valor} raw/a.md wiki/a.md`, "powershell")).exitCode).toBe(0);
    }
  });
}
for (const comando of [
  "Copy-Item wiki/a.md raw/a.md -ea 0", "Copy-Item -ErrorAction Stop wiki/a.md raw/a.md",
  "Move-Item wiki/a.md raw/a.md -OutVariable x", "Copy-Item wiki/a.md raw/a.md -Desconhecido Valor",
  "Copy-Item -Path wiki/a.md raw/a.md -Desconhecido Valor", "Copy-Item -LiteralPath wiki/a.md raw/a.md -Desconhecido Valor",
  "Set-Content raw/a.md x -ErrorAction Stop",
]) {
  test(`Dado parâmetros após o destino Quando avalio ${comando} Então bloqueia a escrita em raw`, () => {
    expect(cli(terminal(comando, "powershell")).exitCode).toBe(2);
  });
}
test("Dado parâmetro desconhecido após a origem Quando seu valor cita raw Então a cópia falha fechada", () => {
  expect(cli(terminal("Copy-Item raw/a.md wiki/a.md -Desconhecido raw/valor outro", "powershell")).exitCode).toBe(2);
});
test("Dado prefixos de caminho e switches PowerShell Quando copio fontes para wiki Então a ingestão continua permitida", () => {
  for (const comando of [
    "Copy-Item raw/a.md wiki/a.md -ErrorAction Stop", "Copy-Item -ea Stop raw/a.md wiki/a.md",
    "Copy-Item raw/a.md wiki/a.md -Force -Verbose -Debug -WhatIf -Confirm",
    "Copy-Item -Pa raw/a.md -Dest wiki/a.md -ea Stop",
    "Get-Content raw/a.md | Out-File -File wiki/a.md -ea Stop",
    "Set-Content -Path wiki/a.md -Va texto -WarningAction Continue",
  ]) expect(cli(terminal(comando, "powershell")).exitCode).toBe(0);
});
for (const verbo of ["Copy-Item", "cpi", "copy", "cp", "Move-Item", "mi", "move"]) {
  test(`Dado ${verbo} sem destino Quando o diretório atual é raw Então bloqueia a escrita implícita`, () => {
    expect(cli(terminal(`cd raw; ${verbo} ../wiki/a.md`, "powershell")).exitCode).toBe(2);
    expect(cli(terminal(`Set-Location raw; ${verbo} ..\\wiki\\a.md`, "powershell")).exitCode).toBe(2);
    expect(cli(terminal(`cd wiki; Copy-Item ../raw/a.md`, "powershell")).exitCode).toBe(0);
    expect(cli(terminal("Copy-Item raw/a.md", "powershell")).exitCode).toBe(0);
  });
}
for (const verbo of ["copy", "move"]) {
  test(`Dado cmd com ${verbo} sem destino Quando muda para raw Então bloqueia a escrita implícita`, () => {
    expect(cli(terminal(`cmd /c "cd raw && ${verbo} ..\\wiki\\a.md"`)).exitCode).toBe(2);
  });
}
test("Dado cópia com origem nomeada ou em argv Quando o destino é omitido Então usa o diretório atual", () => {
  for (const origem of ["-Path ../wiki/a.md", "-LiteralPath ../wiki/a.md"]) {
    expect(cli(terminal(`cd raw; Copy-Item ${origem}`, "powershell")).exitCode).toBe(2);
  }
  expect(cli(terminal(["powershell.exe", "-Command", "cd raw; cp ../wiki/a.md"])).exitCode).toBe(2);
});
for (const comando of ["Copy-Item raw\\a.md wiki\\a.md", "Copy-Item -Path raw\\a.md -Destination wiki\\sources\\", "cpi raw\\a.pdf $env:TEMP\\a.pdf", "Copy-Item -Recurse raw\\x wiki\\x", "Get-Content raw\\a.md | Out-File wiki\\a.md", "Get-Content raw\\a.md | Out-File -FilePath wiki\\a.md -Encoding utf8", "Get-Content raw\\a.md | Set-Content wiki\\a.md", "Get-Content raw\\a.md | Add-Content -Path wiki\\a.md", "copy raw\\a.md wiki\\a.md", "cmd /c copy raw\\a.md wiki\\a.md", "New-Item -ItemType Directory wiki\\sources; Copy-Item raw\\a.md wiki\\sources\\", "dir raw | ni wiki\\x", "Get-Content raw\\a.md; Clear-Content wiki\\b.md", "Get-Content raw\\a.md; sc wiki\\x y", "Get-Content raw\\a.md; ac wiki\\x y"]) {
  test(`Dado cópia de raw para a wiki no PowerShell ${comando} Quando decido Então libera`, () => {
    expect(decidir(terminal(comando, "powershell")).acao).toBe("liberar");
  });
}
for (const comando of ["Copy-Item wiki\\a.md raw\\a.md", "Copy-Item -Path wiki\\a.md -Destination raw\\", "Copy-Item -Destination raw\\a.md -Path wiki\\a.md", "cpi a raw\\", "copy wiki\\a.md raw\\a.md", "cmd /c copy wiki\\a.md raw\\a.md", "Get-Content wiki\\a.md | Out-File raw\\a.md", "Get-Content wiki\\a | Out-File -FilePath raw\\a.md", "Set-Content raw\\a.md x", "Set-Content -Path raw\\a.md -Value x", "Add-Content -LiteralPath raw\\a.md x", "ac raw\\a.md x", "sc raw\\a x", "New-Item raw\\x", "ni raw\\x -ItemType File", "New-Item -Path raw -Name x -ItemType File", "Clear-Content raw\\a.md", "Copy-Item raw\\a.md raw\\b.md"]) {
  test(`Dado gravação em raw no PowerShell ${comando} Quando decido Então bloqueia`, () => {
    expect(decidir(terminal(comando, "powershell")).acao).toBe("bloquear");
  });
}

// Rodada 3 — C1: cmdlet de escrita dentro do bloco de script de ForEach-Object / % / -Process.
for (const comando of ["Get-ChildItem raw -Filter *.tmp | ForEach-Object { Remove-Item $_.FullName }", "gci raw\\*.bak | % { rm $_ }", "gci raw | %{Remove-Item $_}", "gci raw | ForEach-Object -Process { Remove-Item -LiteralPath $_.FullName }", "gci raw | ForEach-Object { Move-Item $_.FullName wiki }", "gci raw | ForEach-Object { Set-Content -Path $_.FullName -Value x }", "gci raw | % { Out-File $_.FullName }", "gci raw | % { Rename-Item $_.FullName x }", "gci raw | % { if ($true) { Remove-Item $_ } }", "gci raw | Where-Object { $true } | ForEach-Object { del $_ }", "gci raw | % { Write-Host $_; Remove-Item $_ }", "gci raw | foreach { Remove-Item $_ }"]) {
  test(`Dado bloco de script do PowerShell ${comando} Quando age sobre itens de raw Então bloqueia`, () => {
    expect(decidir(terminal(comando, "powershell")).acao).toBe("bloquear");
  });
}
test("Dado argv do Codex com powershell.exe -Command e bloco Quando remove itens de raw Então bloqueia", () => {
  const payload = JSON.stringify({ tool_name: "shell", tool_input: { command: ["powershell.exe", "-Command", "gci raw | % { Remove-Item $_ }"] } });
  expect(decidir(payload).acao).toBe("bloquear");
  expect(decidir(JSON.stringify({ tool_name: "shell", tool_input: { command: ["powershell.exe", "-Command", "gci raw | % { $_.Name }"] } })).acao).toBe("liberar");
});
test("Dado listagem recursiva do projeto Quando o bloco do ForEach-Object remove Então bloqueia (forma R64)", () => {
  for (const comando of ["Get-ChildItem -Recurse -Filter *.tmp | ForEach-Object { Remove-Item $_.FullName }", "gci -r | % { rm $_ }", "Get-ChildItem . -Recurse | ForEach-Object { Move-Item $_.FullName x }"]) {
    expect(decidir(terminal(comando, "powershell")).acao).toBe("bloquear");
  }
  expect(decidir(terminal("Get-ChildItem wiki -Recurse | ForEach-Object { Remove-Item $_.FullName }", "powershell")).acao).toBe("liberar");
});
for (const comando of ["gci raw | % { $_.Name }", "gci raw | ForEach-Object { Get-Content $_.FullName }", "gci raw | ForEach-Object { Copy-Item $_.FullName wiki\\ }", "gci raw | % { $_.Length }", "gci raw | Where-Object { $_.Length -gt 10 }", "gci raw | % { Set-Content -Path wiki\\x -Value $_.Name }", "gci wiki | % { Remove-Item $_.FullName }", "find raw -name x | wc -l"]) {
  test(`Dado bloco de script que só lê ou grava fora de raw ${comando} Quando decido Então libera (controle)`, () => {
    expect(decidir(terminal(comando, "powershell")).acao).toBe("liberar");
  });
}

// Revisão automática: o sed (GNU) aceita qualquer prefixo único de --in-place.
test("Dado sed com abreviação de --in-place Quando cita raw Então bloqueia nos dois caminhos e as outras longas passam", () => {
  for (const comando of ["sed --in 's/a/b/' raw/a.md", "sed --in-pl=.bak 's/a/b/' raw/a.md", "sed --i 's/a/b/' raw/a.md", "sed --in-place=.x 's/a/b/' raw/a.md", "rg -l x raw | xargs sed --in-place 's/a/b/'", "cat raw/lista | xargs sed --in-pla s/a/b/"]) {
    expect(decidir(terminal(comando)).acao).toBe("bloquear");
  }
  for (const comando of ["sed --quiet -e 'p' raw/a.md", "sed --expression='s/a/b/' raw/a.md", "sed --regexp-extended 's/a/b/' raw/a.md"]) {
    expect(decidir(terminal(comando)).acao).toBe("liberar");
  }
});

// Revisão automática (rodada 3): destino que vem da pipeline, parâmetros abreviados do PowerShell e links.
test("Dado cmdlet de gravação sem destino explícito Quando a pipeline traz itens de raw Então bloqueia", () => {
  for (const comando of ["gci raw | Clear-Content", "gci raw | clc", "gci raw | Set-Content -Value x", "gci raw | Add-Content -Value x", "Get-ChildItem raw\\*.md | Clear-Content -Force"]) {
    expect(decidir(terminal(comando, "powershell")).acao).toBe("bloquear");
  }
  expect(decidir(terminal("gci wiki | Clear-Content", "powershell")).acao).toBe("liberar");
  expect(decidir(terminal("Get-Content raw\\a.md | Set-Content wiki\\a.md", "powershell")).acao).toBe("liberar");
  expect(decidir(terminal("gci -Recurse | Clear-Content", "powershell")).acao).toBe("bloquear");
});
test("Dado parâmetros abreviados, com dois-pontos ou em lista Quando o destino é raw Então bloqueia e a wiki libera", () => {
  for (const comando of ["Set-Content -Path:raw\\a.md x", "Set-Content -Pa raw\\a.md -Value x", "Set-Content -PSPath raw\\a.md x", "Copy-Item wiki\\a -Dest raw\\", "Copy-Item wiki\\a -Destination:raw\\", "Copy-Item -Path wiki\\a -De raw\\", "Out-File -File raw\\a.md", "Add-Content -LiteralPath wiki\\a.md,raw\\b.md x", "Out-File -FilePath:raw\\a.md", "New-Item -Pa raw\\x", "ni -Path:raw\\x"]) {
    expect(decidir(terminal(comando, "powershell")).acao).toBe("bloquear");
  }
  for (const comando of ["Copy-Item raw\\a -Dest wiki\\", "Set-Content -Path:wiki\\a.md x", "Out-File -File wiki\\a.md", "Add-Content -LiteralPath wiki\\a.md,wiki\\b.md x"]) {
    expect(decidir(terminal(comando, "powershell")).acao).toBe("liberar");
  }
});
test("Dado New-Item de link Quando mira raw Então bloqueia e diretório comum na wiki libera", () => {
  for (const comando of ["New-Item -ItemType SymbolicLink -Path wiki\\x -Target raw\\a", "ni -Type Junction -Path wiki\\x -Value raw", "New-Item -ItemType HardLink -Path wiki\\x -Value raw\\a.md", "New-Item -ItemType Sym -Path wiki\\x -Target raw"]) {
    expect(decidir(terminal(comando, "powershell")).acao).toBe("bloquear");
  }
  expect(decidir(terminal("New-Item -ItemType Directory -Path wiki\\x", "powershell")).acao).toBe("liberar");
});

// Rodada 3 — I2: find e grep -r sobre a raiz do projeto alimentando escrita (como gci -Recurse e ls -R).
test("Dado find ou grep recursivo sobre a raiz Quando a pipeline escreve Então bloqueia e diretórios da wiki passam", () => {
  const proj = "/srv/equipe/proj";
  for (const comando of ["find . -name '*.tmp' | xargs rm", "find . -type f | xargs rm -f", "grep -rl foo . | xargs sed -i 's/foo/bar/'", "grep -Rl foo | xargs sed -i s/foo/bar/", "grep -rl foo --include=*.md . | xargs sed -Ei s/a/b/", "find . | xargs --max-args 1 rm", "find .. -name proj | xargs rm -rf", "find . -name x | while read f; do rm \"$f\"; done", "grep --recursive -l foo . | xargs rm"]) {
    expect(decidir(comCwd(comando, proj)).acao).toBe("bloquear");
    expect(decidir(terminal(comando)).acao).toBe("bloquear");
  }
  for (const comando of ["find wiki -name '*.tmp' | xargs rm", "find . -name '*.md' | xargs wc -l", "grep -rl foo wiki | xargs sed -i s/a/b/", "find . -name x | head", "grep -rn foo . | wc -l", "find wiki -type f | while read f; do rm \"$f\"; done", "cd wiki && find . -name '*.tmp' | xargs rm"]) {
    expect(decidir(comCwd(comando, proj)).acao).toBe("liberar");
  }
});

// Rodada 3 — I3: projeto direto na raiz do sistema (contêiner: /workspace; Windows: C:\proj).
test("Dado projeto na raiz do sistema Quando o alvo sobe para a raiz Então o ancestral é resolvido", () => {
  for (const comando of ["cd .. && rm -rf workspace", "rm -rf ..", "find .. -name '*.tmp' -delete", "rm -rf ../workspace", "rm -rf /workspace", "rm -rf /*", "cd / && rm -rf workspace", "cd / && rm -rf *", "rm -rf /"]) {
    expect(decidir(comCwd(comando, "/workspace")).acao).toBe("bloquear");
  }
  for (const comando of ["cd .. && rm -rf outro", "rm -rf ../outro", "rm -rf wiki/x", "cd / && rm -rf outro"]) {
    expect(decidir(comCwd(comando, "/workspace")).acao).toBe("liberar");
  }
  for (const comando of ["cd .. && rm -rf proj", "rm -rf ..", "Remove-Item -Recurse -Force C:\\proj", "Remove-Item -Recurse -Force ..\\proj", "cd C:\\ ; Remove-Item -Recurse -Force proj", "rd /s /q C:\\proj"]) {
    expect(decidir(JSON.stringify({ tool_name: "powershell", cwd: "C:\\proj", tool_input: { command: comando } })).acao).toBe("bloquear");
  }
  expect(decidir(JSON.stringify({ tool_name: "powershell", cwd: "C:\\proj", tool_input: { command: "cd .. ; Remove-Item -Recurse -Force outro" } })).acao).toBe("liberar");
});

// Rodada 3 — Menores: script de sh -c dentro de find -exec, env -S, leitores de PDF.
test("Dado find -exec sh -c ou env -S Quando o script apaga amplo Então bloqueia", () => {
  for (const comando of ["find . -name '*.tmp' -exec sh -c 'rm \"$1\"' _ {} \\;", "find . -exec bash -c 'rm -f \"$0\"' {} +", "env -S 'rm -rf .'", "env --split-string='rm -rf .'", "env -S 'rm -rf .' FOO=1"]) {
    expect(decidir(comCwd(comando, "/srv/equipe/proj")).acao).toBe("bloquear");
  }
  expect(decidir(comCwd("find . -name '*.tmp' -exec sh -c 'cat \"$1\"' _ {} \\;", "/srv/equipe/proj")).acao).toBe("liberar");
  expect(decidir(comCwd("env -S 'cat wiki/a.md'", "/srv/equipe/proj")).acao).toBe("liberar");
});
test("Dado leitores de PDF Quando leem raw Então liberam", () => {
  for (const comando of ["pdftotext raw/a.pdf /tmp/a.txt", "pdftotext raw/a.pdf -", "pdfinfo raw/a.pdf", "pdftotext -layout raw/a.pdf wiki/a.txt"]) {
    expect(decidir(terminal(comando)).acao).toBe("liberar");
  }
  expect(decidir(terminal("pdftotext wiki/a.pdf raw/a.txt")).acao).toBe("bloquear");
});

// Revisão automática (rodada 3): custo linear em blocos aninhados e corpo do bloco além do primeiro comando.
test("Dado muitos blocos aninhados Quando decido Então termina depressa (sem recursão exponencial)", () => {
  const comando = `cat raw/a.md | % ${"{ ".repeat(300)}Write-Host $_${" }".repeat(300)}`;
  const inicio = performance.now();
  expect(decidir(terminal(comando, "powershell")).acao).toBeDefined();
  expect(performance.now() - inicio).toBeLessThan(2000);
  const profundo = `gci raw | % ${"{ ".repeat(300)}Remove-Item $_${" }".repeat(300)}`;
  expect(decidir(terminal(profundo, "powershell")).acao).toBe("bloquear");
});
test("Dado bloco alimentado por raw Quando um comando depois de ; grava em caminho do item Então bloqueia", () => {
  for (const comando of ["gci raw | % { Write-Host $_; Set-Content $_.FullName x }", "gci raw | % { Write-Host $_; Add-Content -Path $_.FullName -Value x }", "gci raw | ForEach-Object { \"x\" > $_.FullName }", "gci raw | % { $a = 1; Clear-Content $_ }", "gci raw | % { Write-Host $_ ; Out-File -FilePath $_.FullName }"]) {
    expect(decidir(terminal(comando, "powershell")).acao).toBe("bloquear");
  }
  for (const comando of ["gci raw | % { Write-Host $_; Set-Content wiki\\a.md $_.Name }", "gci wiki | % { Write-Host $_; Set-Content $_.FullName x }", "gci raw | % { Write-Host $_; $_.Name }"]) {
    expect(decidir(terminal(comando, "powershell")).acao).toBe("liberar");
  }
});

// Barra invertida no PowerShell/cmd é separador de caminho: `raw\\ -Force` não pode virar uma palavra só.
test("Dado PowerShell com caminho terminado em barra invertida e opções depois Quando o destino é raw Então bloqueia", () => {
  for (const comando of ["Copy-Item wiki\\a.md raw\\ -Force", "Remove-Item raw\\ -Recurse", "Copy-Item wiki\\a.md raw\\ ; Write-Host ok", "Remove-Item \"raw\\\" -Recurse", "Move-Item raw\\a.md wiki\\ -Force"]) {
    expect(decidir(terminal(comando, "powershell")).acao).toBe("bloquear");
  }
  expect(decidir(terminal("Copy-Item raw\\a.md wiki\\ -Force", "powershell")).acao).toBe("liberar");
  expect(decidir(terminal("rm raw/a\\ b.md")).acao).toBe("bloquear");
  expect(decidir(terminal("rm wiki/a\\ b.md")).acao).toBe("liberar");
  expect(decidir(JSON.stringify({ tool_name: "shell", tool_input: { command: ["powershell.exe", "-Command", "Copy-Item wiki\\a.md raw\\ -Force"] } })).acao).toBe("bloquear");
  expect(decidir(terminal("cmd /c copy wiki\\a.md raw\\ /y")).acao).toBe("bloquear");
});
test("Dado script de sh -c ilegível ou envolvedor sem comando em comando que cita raw Quando decido Então não quebra", () => {
  expect(decidir(terminal("cat raw/a.md; find . -exec sh -c 'echo \"' _ {} \;")).acao).toBeDefined();
  expect(decidir(terminal("cat raw/a.md; time")).acao).toBe("liberar");
  expect(decidir(terminal("cat raw/a.md; nice -n 5")).acao).toBe("liberar");
});

// Revisão automática (pós rodada 3): pdftotext sem saída grava ao lado da entrada; opções com valor; xargs -i/-l; env -S colado.
test("Dado pdftotext sem arquivo de saída Quando a entrada está em raw Então bloqueia porque grava raw/a.txt", () => {
  for (const comando of ["pdftotext raw/a.pdf", "pdftotext -layout raw/a.pdf", "pdftotext -f 1 -l 3 raw/a.pdf", "pdftotext wiki/a.pdf raw/a.txt", "pdftotext -f 1 wiki/a.pdf raw/a.txt", "pdftotext -opw senha wiki/a.pdf raw/a.txt"]) {
    expect(decidir(terminal(comando)).acao).toBe("bloquear");
  }
  for (const comando of ["pdftotext raw/a.pdf -", "pdftotext raw/a.pdf wiki/a.txt", "pdftotext -f 1 -l 3 raw/a.pdf wiki/a.txt", "pdftotext -opw raw wiki/a.pdf wiki/a.txt", "pdftotext -layout -nopgbrk raw/a.pdf -", "pdftotext wiki/a.pdf"]) {
    expect(decidir(terminal(comando)).acao).toBe("liberar");
  }
});
test("Dado xargs -i, -l ou --replace sem valor Quando o comando vem depois Então é aberto e bloqueia", () => {
  for (const comando of ["cat raw/lista | xargs -i rm {}", "cat raw/lista | xargs -l rm", "cat raw/lista | xargs --replace rm {}", "cat raw/lista | xargs --eof rm", "cat raw/lista | xargs -i{} rm {}"]) {
    expect(decidir(terminal(comando)).acao).toBe("bloquear");
  }
  expect(decidir(terminal("cat raw/lista | xargs -i cat {}")).acao).toBe("liberar");
});
test("Dado env -S com valor colado ou abreviado Quando o texto apaga amplo Então bloqueia", () => {
  for (const comando of ["env -Srm -rf .", "env --s 'rm -rf .'", "env --split='rm -rf .'", "env --split-string 'rm -rf .'"]) {
    expect(decidir(comCwd(comando, "/srv/equipe/proj")).acao).toBe("bloquear");
  }
  expect(decidir(comCwd("env -Scat wiki/a.md", "/srv/equipe/proj")).acao).toBe("liberar");
});

// Rodada 4 (R72) — C3: parâmetro do PowerShell terminado em `:` com o valor no token seguinte (`-Path: raw\a.md`).
test("Dado parâmetro com dois-pontos e o valor separado Quando o destino é raw Então bloqueia nos quatro cmdlets e nas abreviações", () => {
  for (const comando of ["Set-Content -Path: raw\\\\a.md -Value x", "Out-File -FilePath: raw\\\\a.md", "Copy-Item wiki\\\\a.md -Destination: raw\\\\a.md", "Add-Content -LiteralPath: raw\\\\a.md -Value x", "Set-Content -Pa: raw\\\\a.md -Value x", "Copy-Item wiki\\\\a.md -Dest: raw\\\\", "Out-File -File: raw\\\\a.md", "New-Item -Path: raw\\\\x", "Set-Content -Path: raw\\\\a.md,wiki\\\\b.md x", "Set-Content -PSPath: raw\\\\a.md x"]) {
    expect(decidir(terminal(comando, "powershell")).acao).toBe("bloquear");
  }
});
test("Dado o mesmo parâmetro com dois-pontos separado Quando o destino é a wiki Então libera, inclusive a ingestão raw para wiki", () => {
  for (const comando of ["Set-Content -Path: wiki\\\\a.md -Value x", "Out-File -FilePath: wiki\\\\a.md", "Copy-Item wiki\\\\a.md -Destination: wiki\\\\b.md", "Add-Content -LiteralPath: wiki\\\\a.md -Value x", "Copy-Item -Path: raw\\\\a.md -Destination: wiki\\\\a.md", "Copy-Item -Path: raw\\\\a.md -Dest: wiki\\\\", "Set-Content -Path: wiki\\\\a.md -Value: x"]) {
    expect(decidir(terminal(comando, "powershell")).acao).toBe("liberar");
  }
});
test("Dado dois-pontos colado ao valor e dois-pontos sem valor no fim Quando decido Então as duas formas continuam coerentes", () => {
  expect(decidir(terminal("Set-Content -Path:raw\\\\a.md x", "powershell")).acao).toBe("bloquear");
  expect(decidir(terminal("Set-Content -Path:wiki\\\\a.md x", "powershell")).acao).toBe("liberar");
  expect(decidir(terminal("Set-Content wiki\\\\a.md -Path:", "powershell")).acao).toBe("liberar");
});

// Rodada 4 (R72) — M1: o env trata `\_` como separador no valor de -S.
test("Dado env -S com \\_ no lugar do espaço Quando o comando escreve em raw Então bloqueia e a leitura libera", () => {
  for (const comando of ["env -S 'rm\\_raw/a.md'", "env -S 'touch\\_raw/a.md'", "env --split-string='rm\\_raw/a.md'", "env -Srm\\_raw/a.md", "env -S 'rm\\_-rf\\_.'"]) {
    expect(decidir(comCwd(comando, "/srv/equipe/proj")).acao).toBe("bloquear");
  }
  expect(decidir(comCwd("env -S 'cat\\_raw/a.md'", "/srv/equipe/proj")).acao).toBe("liberar");
  expect(decidir(comCwd("env -S 'cat\\_wiki/a.md'", "/srv/equipe/proj")).acao).toBe("liberar");
});

// B1 (revisão 1 do PR #21): o destino vale pelo caminho real. Um caminho escrito dentro de wiki/ que, por link, cai em raw/
// é bloqueado; arquivo que ainda não existe é julgado pelo diretório pai existente mais próximo (ou pelo alvo do link pendente).
const linkDeDiretorio = process.platform === "win32" ? "junction" : "dir";
function projeto(): string {
  const base = join(temporario, "projeto");
  mkdirSync(join(base, "raw"), { recursive: true }); mkdirSync(join(base, "wiki"), { recursive: true });
  return base;
}

test("Dado área da wiki que é link para raw/ Quando escrevo um arquivo novo nela Então bloqueia pelo caminho real", () => {
  const base = projeto();
  symlinkSync(join(base, "raw"), join(base, "wiki/pessoal"), linkDeDiretorio);
  const decisao = decidir(arquivo(join(base, "wiki/pessoal/sources/x.md")));
  expect(decisao.acao).toBe("bloquear");
  expect(decisao.motivo).toContain("pelo caminho real");
  expect(decidir(arquivo(join(base, "wiki/outra/sources/x.md"))).acao).toBe("liberar");
});

test("Dado caminho relativo e cwd do projeto Quando a área é link para raw/ Então bloqueia também", () => {
  const base = projeto();
  symlinkSync(join(base, "raw"), join(base, "wiki/pessoal"), linkDeDiretorio);
  const payload = JSON.stringify({ tool_name: "Edit", cwd: base, tool_input: { file_path: "wiki/pessoal/a.md" } });
  expect(decidir(payload).acao).toBe("bloquear");
  const livre = JSON.stringify({ tool_name: "Edit", cwd: base, tool_input: { file_path: "wiki/a.md" } });
  expect(decidir(livre).acao).toBe("liberar");
});

test.skipIf(process.platform === "win32")("Dado página da wiki que é link para arquivo de raw/ Quando edito Então bloqueia", () => {
  const base = projeto();
  writeFileSync(join(base, "raw/a.md"), "evidência");
  symlinkSync(join(base, "raw/a.md"), join(base, "wiki/a.md"));
  expect(decidir(arquivo(join(base, "wiki/a.md"))).acao).toBe("bloquear");
});

test.skipIf(process.platform === "win32")("Dado link pendente na wiki que aponta para raw/ Quando escrevo nele Então bloqueia: a escrita criaria o arquivo em raw/", () => {
  const base = projeto();
  symlinkSync(join(base, "raw/novo.md"), join(base, "wiki/n.md"));
  expect(decidir(arquivo(join(base, "wiki/n.md"))).acao).toBe("bloquear");
});

test("Dado raw/ que é link para outro disco Quando escrevo no disco pelo caminho real Então bloqueia; a wiki continua liberada", () => {
  const base = projeto();
  const disco = join(temporario, "disco", "raw");
  mkdirSync(disco, { recursive: true });
  rmSync(join(base, "raw"), { recursive: true });
  symlinkSync(disco, join(base, "raw"), linkDeDiretorio);
  expect(decidir(arquivo(join(base, "raw/a.md"))).acao).toBe("bloquear");
  expect(decidir(arquivo(join(base, "wiki/a.md"))).acao).toBe("liberar");
});

test("Dado raw/ que é link para pasta de outro nome Quando a wiki aponta para ela Então bloqueia pelo raw/ real do projeto", () => {
  const base = projeto();
  const evidencias = join(temporario, "evidencias");
  mkdirSync(evidencias);
  rmSync(join(base, "raw"), { recursive: true });
  symlinkSync(evidencias, join(base, "raw"), linkDeDiretorio);
  symlinkSync(evidencias, join(base, "wiki/pessoal"), linkDeDiretorio);
  expect(decidir(arquivo(join(base, "wiki/pessoal/a.md"))).acao).toBe("bloquear");
  expect(decidir(JSON.stringify({ tool_name: "Write", cwd: base, tool_input: { file_path: join(evidencias, "b.md") } })).acao).toBe("bloquear");
  expect(decidir(arquivo(join(base, "wiki/a.md"))).acao).toBe("liberar");
});

test("Dado área da wiki que é link para raw/ Quando o terminal redireciona para ela Então bloqueia pelo caminho real", () => {
  const base = projeto();
  symlinkSync(join(base, "raw"), join(base, "wiki/pessoal"), linkDeDiretorio);
  const comando = (texto: string) => JSON.stringify({ tool_name: "Bash", cwd: base, tool_input: { command: texto } });
  expect(decidir(comando("echo x > wiki/pessoal/a.md")).acao).toBe("bloquear");
  expect(decidir(comando("cp notas.md wiki/pessoal/a.md")).acao).toBe("bloquear");
  expect(decidir(comando("echo x > wiki/a.md")).acao).toBe("liberar");
});

// Revisão de segurança 2.
test.skipIf(process.platform === "win32")("Dado .. depois de área que é link para dentro de raw/ Quando escrevo Então bloqueia", () => {
  const base = projeto();
  mkdirSync(join(base, "raw/sub"));
  symlinkSync(join(base, "raw/sub"), join(base, "wiki/pessoal"), "dir");
  expect(decidir(arquivo(`${base}/wiki/pessoal/../a.md`)).acao).toBe("bloquear");
  const comando = JSON.stringify({ tool_name: "Bash", cwd: base, tool_input: { command: "echo x > wiki/pessoal/../a.md" } });
  expect(decidir(comando).acao).toBe("bloquear");
});

test.skipIf(process.platform === "win32")("Dado destino de terminal que não se resolve (links em ciclo) Quando decido Então falha fechado", () => {
  const base = projeto();
  symlinkSync(join(base, "wiki/b.md"), join(base, "wiki/a.md"));
  symlinkSync(join(base, "wiki/a.md"), join(base, "wiki/b.md"));
  const comando = JSON.stringify({ tool_name: "Bash", cwd: base, tool_input: { command: "echo x > wiki/a.md" } });
  expect(decidir(comando).acao).toBe("bloquear");
});

test("Dado palavra longa demais para ser caminho Quando o comando não escreve em raw/ Então libera", () => {
  const base = projeto();
  const comando = JSON.stringify({ tool_name: "Bash", cwd: base, tool_input: { command: `git commit -m "${"x".repeat(400)}"` } });
  expect(decidir(comando).acao).toBe("liberar");
});

test("Dado cwd com um raw/ próprio mais perto Quando escrevo na pasta para onde aponta o raw/ do projeto de cima Então bloqueia: vale todo raw/ do caminho", () => {
  const base = projeto();
  const evidencias = join(temporario, "evidencias");
  mkdirSync(evidencias);
  rmSync(join(base, "raw"), { recursive: true });
  symlinkSync(evidencias, join(base, "raw"), linkDeDiretorio);
  mkdirSync(join(base, "sub/raw"), { recursive: true });
  const payload = JSON.stringify({ tool_name: "Write", cwd: join(base, "sub"), tool_input: { file_path: join(evidencias, "b.md") } });
  expect(decidir(payload).acao).toBe("bloquear");
});

test.skipIf(process.platform === "win32")("Dado Edit com link/../arquivo e link para dentro de raw/ Quando decido Então bloqueia", () => {
  const base = projeto();
  mkdirSync(join(base, "raw/sub"));
  symlinkSync(join(base, "raw/sub"), join(base, "wiki/link"), "dir");
  const payload = JSON.stringify({ tool_name: "Edit", cwd: base, tool_input: { file_path: "wiki/link/../x.md" } });
  expect(decidir(payload).acao).toBe("bloquear");
});

test.skipIf(process.platform !== "win32")("Dado Windows Quando o caminho tem link/../arquivo Então o .. é lexical, como no próprio Windows", () => {
  const base = projeto();
  mkdirSync(join(base, "raw/sub"));
  symlinkSync(join(base, "raw/sub"), join(base, "wiki/link"), "junction");
  expect(decidir(arquivo(`${base}\\wiki\\link\\..\\x.md`)).acao).toBe("liberar");
  expect(decidir(arquivo(`${base}\\wiki\\link\\x.md`)).acao).toBe("bloquear");
});
