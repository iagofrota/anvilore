import { appendFile } from "node:fs/promises";
import { posix } from "node:path";
import { estaEmRaw } from "../lib/caminhos";

export type Decisao = { acao: "liberar" | "bloquear"; motivo: string };
type Mapa = Record<string, unknown>;
type Token = { texto: string; operador: boolean };

const CHAVES = new Set(["file_path", "filepath", "notebook_path", "notebookpath", "absolute_path", "absolutepath", "path",
  // destino de ferramentas que movem, copiam ou exportam (o caminho de origem pode estar fora de raw/)
  "destination", "destinationpath", "destination_path", "dest", "new_path", "newpath", "old_path", "oldpath", "target_path", "targetpath", "output_path", "outputpath"]);
const TERMINAIS = new Set(["bash", "exec_command", "shell_command", "shell", "local_shell", "run_shell_command", "powershell", "run_in_terminal"]);
const LEITORES = new Set(["read", "read_file", "view", "read_notebook", "list_dir", "glob", "grep"]);
const MUDAM_DIRETORIO = new Set(["cd", "chdir", "pushd", "popd", "set-location", "sl"]);
const LEITURAS_TERMINAL = new Set([
  "cat", "rg", "grep", "ls", "head", "tail", "wc", "echo", "printf", "pwd", "stat", "file", "diff",
  "cut", "du", "sha256sum", "md5sum", "shasum", "basename", "dirname", "realpath", "readlink",
  "nl", "tac", "od", "strings", "test", "[", "true", "false",
  "get-content", "gc", "type", "dir", "get-childitem", "gci", "select-string", "sls", "get-item", "gi", "get-filehash",
]);
// Verbos que executam outro comando: o que importa é o comando de dentro (as opções de cada um estão em OPCOES_ENVOLVEDOR).
const ENVOLVEDORES = new Set(["busybox", "xargs", "parallel", "env", "nice", "nohup", "time", "sudo", "doas", "command", "builtin", "exec", "timeout", "stdbuf", "ionice", "setsid"]);
// Opções de cada envolvedor que levam argumento próprio, e quantos posicionais vêm antes do comando (timeout: a duração).
const OPCOES_ENVOLVEDOR: Record<string, { valor: string[]; posicionais?: number }> = {
  env: { valor: ["-u", "--unset", "-C", "--chdir", "-S", "--split-string"] },
  timeout: { valor: ["-s", "--signal", "-k", "--kill-after"], posicionais: 1 },
  nice: { valor: ["-n", "--adjustment"] },
  ionice: { valor: ["-c", "-n", "-p", "-P", "-u", "--class", "--classdata"] },
  sudo: { valor: ["-u", "-g", "-C", "-h", "-p", "-r", "-t", "-U", "-D", "-R", "-T", "--user", "--group", "--chdir"] },
  doas: { valor: ["-u", "-C"] },
  time: { valor: ["-o", "-f", "--output", "--format"] },
  stdbuf: { valor: ["-i", "-o", "-e"] },
  xargs: { valor: ["-I", "-n", "-P", "-L", "-d", "-E", "-s", "-a", "-l", "-i"] },
  parallel: { valor: ["-j", "-S", "-a", "-N", "-n", "-L", "-I"] },
  exec: { valor: ["-a"] },
};
const VERBOS_APAGAR = new Set(["rm", "rmdir", "rd", "del", "erase", "remove-item", "ri"]);
// Atribuição de variável antes do comando que não é só locale: pode apontar programa externo (GIT_*, PAGER, HOME, XDG_CONFIG_HOME...).
const ambienteInseguro = (atribuicao: string) => /^[A-Za-z_]\w*=/.test(atribuicao) && !/^(?:LC_\w+|LANG|LANGUAGE|TZ|TERM|NO_COLOR|COLUMNS|LINES)=/.test(atribuicao);
// O git aceita abreviação não ambígua de opção longa (`--outp` vale `--output`).
const prefixo = (arg: string, longa: string) => { const nome = arg.split("=")[0]!; return nome.length >= 4 && longa.startsWith(nome); };
// R66: se o comando cita raw/, qualquer segmento (pipe, `;`, laço, xargs, -exec) com um destes verbos bloqueia, mesmo que o
// caminho de raw/ chegue só pela pipeline. `cp` e `tee` ficam de fora: julgam-se pelo destino (copiar de raw/ para a wiki é legítimo).
const ESCRITA_GLOBAL = new Set([
  "rm", "rmdir", "mv", "ln", "touch", "truncate", "dd", "install", "rsync", "chmod", "chown", "chgrp", "shred", "unlink", "perl",
  "remove-item", "ri", "del", "erase", "rd", "move-item", "mi", "move", "rename-item", "rni", "ren", "set-itemproperty", "sp",
]);
// PowerShell/cmd: gravam no arquivo que recebem, então, como `cp` e `tee`, julgam-se pelo destino (copiar de raw/ para a wiki é a ingestão).
const DESTINO_JULGADO = new Set(["copy-item", "cpi", "copy", "out-file", "set-content", "sc", "add-content", "ac", "new-item", "ni", "clear-content", "clc"]);
const OPCOES_PS_COM_VALOR = new Set(["-path", "-literalpath", "-destination", "-filepath", "-value", "-name", "-itemtype", "-encoding", "-filter", "-include", "-exclude", "-width", "-stream", "-credential"]);
const PALAVRAS_DE_LACO = new Set(["do", "then", "else", "elif", "{", "!", "while", "until", "if"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "pwsh", "powershell", "cmd"]);
// Em git vale a lista de leitura (e de operações que não tocam arquivos de trabalho): o resto que cita raw/ bloqueia.
const GIT_LEITURA = new Set([
  "log", "show", "diff", "status", "blame", "grep", "ls-files", "ls-tree", "rev-parse", "cat-file", "describe", "shortlog",
  "reflog", "rev-list", "add", "commit", "branch", "tag",
]);
const FIND_ESCREVE = /^-(?:delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/;
// Comando w/W/e de sed no começo, depois de ; ou { e com endereço opcional, ou flag w de s///.
const SED_ESCREVE = /(?:^|[;{}\n])\s*(?:[0-9$]+(?:,[0-9$]+)?|\/[^/]*\/)?\s*[wWe]\s+\S|\/[gpiImMx0-9]*w\s*\S/;
const MENSAGEM = "Bloqueado: `raw/` é imutável para o agente. A camada de fontes é da pessoa que cura — acrescente o arquivo à mão e peça uma ingestão.";

function mapa(valor: unknown): valor is Mapa {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor);
}

function citaRaw(texto: string): boolean {
  return texto.split(/[\s"'`=<>;|&()[\]{}]+/).some(estaEmRaw);
}

// Caminho que cai em raw/: o próprio caminho, ou um relativo com o diretório de trabalho já dentro de raw/.
function escreveEmRaw(caminho: string, cwd: string): boolean {
  return estaEmRaw(caminho) || (estaEmRaw(cwd) && !/^(?:[a-z]:|[\\/])/i.test(caminho));
}

function caminhosDe(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.flatMap(caminhosDe);
  if (!mapa(valor)) return [];
  return Object.entries(valor).flatMap(([chave, conteudo]) => {
    if (CHAVES.has(chave.toLowerCase())) return typeof conteudo === "string" && conteudo.trim() ? [conteudo] : caminhosDe(conteudo);
    return caminhosDe(conteudo);
  });
}

// Reconhece palavras, aspas e operadores; não executa nem expande código de shell.
function tokenizar(comando: string): Token[] {
  const tokens: Token[] = [];
  let palavra = "", aspas = "";
  function guardar() {
    if (palavra) tokens.push({ texto: palavra, operador: false });
    palavra = "";
  }
  for (let i = 0; i < comando.length; i++) {
    const caractere = comando[i]!;
    const seguinte = comando[i + 1] ?? "";
    if (aspas) {
      if (caractere === aspas) aspas = "";
      else if (aspas === '"' && caractere === "\\" && /["\\$`]/.test(seguinte) && seguinte) palavra += comando[++i];
      else palavra += caractere;
    } else if (caractere === "'" || caractere === '"') {
      aspas = caractere;
    } else if (caractere === "\\" && seguinte && /[\s'";|&<>\\]/.test(seguinte)) {
      palavra += comando[++i];
    } else if (caractere === "`" || caractere === "(" || caractere === ")" || (caractere === "$" && /[({]/.test(seguinte) && seguinte)) {
      throw new Error("subshell ou expansão não interpretável");
    } else if (/[;|&<>\n]/.test(caractere)) {
      guardar();
      const operador = caractere === "\n" ? ";" : caractere + (seguinte === caractere ? comando[++i] : "");
      tokens.push({ texto: operador, operador: true });
    } else if (/\s/.test(caractere)) {
      guardar();
    } else {
      palavra += caractere;
    }
  }
  if (aspas) throw new Error("aspas sem fechamento no terminal");
  guardar();
  if (!tokens.length) throw new Error("comando de terminal vazio");
  return tokens;
}

function tokensDoComando(comando: unknown): Token[] {
  if (typeof comando === "string") return tokenizar(comando);
  if (!Array.isArray(comando) || !comando.length || !comando.every(item => typeof item === "string")) {
    throw new Error("comando de terminal ilegível");
  }
  const argv: string[] = comando;
  if (/^(?:bash|sh|zsh|powershell)(?:\.exe)?$/i.test(argv[0]!)) {
    const argumento = argv.findIndex(item => /^(?:-[a-z]*c|-command)$/i.test(item));
    const script = argv[argumento + 1];
    if (argumento >= 0 && script !== undefined) return tokenizar(script);
  }
  return argv.map(texto => ({ texto, operador: false }));
}

// Separa as opções globais do git (`-C dir`, `-c k=v`, `--git-dir=...`) do subcomando.
function analisarGit(args: string[]): { subcomando?: string; globais: string[] } {
  const globais: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-C" || args[i] === "-c") globais.push(args[i]!, args[++i] ?? "");
    else if (args[i]!.startsWith("-")) globais.push(args[i]!);
    else return { subcomando: args[i], globais };
  }
  return { globais };
}

// R64/R66: alvos que contêm raw/ sem citá-lo. `raiz` é o diretório de trabalho do payload (a raiz provável do projeto): o alvo é
// ancestral quando é a própria raiz ou um diretório que a contém. Caminho relativo é resolvido contra o cwd atual (que pode ter
// mudado com `cd`). Sem cwd absoluto, vale a heurística de `.`, `..` e `*`.
function ancestralDeRaw(alvo: string, cwd: string, raiz: string): boolean {
  const normal = (texto: string) => posix.normalize(texto.replaceAll("\\", "/").toLowerCase()).replace(/\/+$/, "");
  const absoluto = (texto: string) => /^(?:[a-z]:)?\//.test(texto);
  if (/^(?:[a-z]:)?[\\/]+$/i.test(alvo.trim())) return true;
  const atual = normal(cwd), base = normal(raiz);
  const bruto = alvo.replaceAll("\\", "/").replace(/(?<=.)\/+$/, "");
  const todos = /(?:^|\/)\*\*?$/.test(bruto);
  const limpo = normal(todos ? posix.dirname(bruto) : bruto);
  const resolvido = absoluto(limpo) ? limpo : absoluto(atual) ? posix.normalize(`${atual}/${limpo}`) : undefined;
  if (resolvido !== undefined && absoluto(base)) return base === resolvido || base.startsWith(`${resolvido}/`);
  if (!/^(?:\.\.\/)*(?:\.\.|\.)$/.test(limpo)) return false;
  const subdiretorio = atual !== "" && atual !== "." && !absoluto(atual) && !atual.startsWith("..");
  return !subdiretorio || limpo.startsWith("..");
}

// Diretórios que uma listagem recursiva (`Get-ChildItem -Recurse`, `ls -R`) percorre: os argumentos que não são opção nem valor de filtro.
function listagemRecursivaAncestral(verbo: string, args: string[], cwd: string, raiz: string): boolean {
  if (!["get-childitem", "gci", "ls", "dir"].includes(verbo)) return false;
  if (!args.some(arg => /^-r(?:ecurse)?$/i.test(arg) || (verbo === "ls" && /^-[A-Za-z]*R/.test(arg)))) return false;
  const caminhos: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (/^-(?:filter|include|exclude|depth|name|attributes|f|i|e|d|n)$/i.test(arg)) i++;
    else if (/^-path$/i.test(arg)) caminhos.push(args[++i] ?? "");
    else if (!arg.startsWith("-")) caminhos.push(arg);
  }
  return (caminhos.length ? caminhos : ["."]).some(alvo => ancestralDeRaw(alvo, cwd, raiz));
}

function apagaAncestral(verbo: string, args: string[], cwd: string, raiz: string): boolean {
  const verbosDoCmd = ["rd", "rmdir", "del", "erase"];
  const opcao = (arg: string) => arg.startsWith("-") || (verbosDoCmd.includes(verbo) && /^\/[a-z]$/i.test(arg));
  if (VERBOS_APAGAR.has(verbo)) {
    const recursivo = verbo === "rmdir" || verbo === "rd"
      || args.some(arg => /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(arg) || arg === "--recursive" || /^-recurse$/i.test(arg) || (verbosDoCmd.includes(verbo) && /^\/s$/i.test(arg)));
    return recursivo && args.filter(arg => !opcao(arg)).some(alvo => ancestralDeRaw(alvo, cwd, raiz));
  }
  if (verbo === "find") {
    let inicio = 0;
    while (inicio < args.length && /^(?:-[HLP]|-O\d|-D)$/.test(args[inicio]!)) inicio += args[inicio] === "-D" ? 2 : 1;
    const sem = args.slice(inicio);
    const fim = sem.findIndex(arg => /^[-!(]/.test(arg));
    const caminhos = fim < 0 ? sem : sem.slice(0, fim);
    if (!caminhos.length) caminhos.push(".");
    const apaga = args.some((arg, i) => arg === "-delete" || (/^-(?:exec|execdir|ok|okdir)$/.test(arg) && escritaDeShell(args.slice(i + 1))));
    return apaga && caminhos.some(alvo => ancestralDeRaw(alvo, cwd, raiz));
  }
  if (verbo === "git") return analisarGit(args).subcomando === "clean" && args.some(arg => /^-[a-zA-Z]*[xX]/.test(arg) && !arg.startsWith("--"));
  return false;
}

// Onde o cmdlet grava: -Destination (cópia) ou -FilePath/-Path/-LiteralPath/-Name (gravação); sem nome, o último (cópia) ou o primeiro posicional.
function destinosDoCmdlet(verbo: string, args: string[]): string[] {
  const nomeados = new Map<string, string>();
  const posicionais: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (/^-[A-Za-z]/.test(arg)) {
      if (OPCOES_PS_COM_VALOR.has(arg.toLowerCase())) nomeados.set(arg.toLowerCase(), args[++i] ?? "");
    } else if (!/^\/[A-Za-z]$/.test(arg)) posicionais.push(arg);
  }
  const copia = ["copy-item", "cpi", "copy"].includes(verbo);
  const destino = copia
    ? nomeados.get("-destination") ?? (posicionais.length > 1 || nomeados.has("-path") ? posicionais.at(-1) : undefined)
    : nomeados.get("-filepath") ?? nomeados.get("-path") ?? nomeados.get("-literalpath") ?? nomeados.get("-name") ?? posicionais[0];
  return destino === undefined ? [] : [destino];
}

function desembrulhar(verbo: string, args: string[]): string[] {
  const { valor, posicionais = 0 } = OPCOES_ENVOLVEDOR[verbo] ?? { valor: [] };
  let pular = posicionais;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (/^[A-Za-z_]\w*=/.test(arg)) continue;
    if (arg === "--") return args.slice(i + 1);
    if (arg.startsWith("-")) {
      if (valor.includes(arg)) i++;
      continue;
    }
    if (pular > 0) { pular--; continue; }
    return args.slice(i);
  }
  return [];
}

// `doPipe`: um segmento anterior do mesmo pipe citou raw/, então o caminho chega pela entrada padrão. Só um comando
// executado por envolvedor (xargs, parallel...) ou um shell lendo a entrada age sobre ele; `forcar` vale dentro do envolvedor.
type Contexto = { raiz: string; doPipe?: boolean; forcar?: boolean; ambienteDoEnvolvedor?: boolean };
function segmentoEscreve(palavras: string[], cwd: string, contexto: Contexto): boolean {
  const { raiz, doPipe = false, forcar = false, ambienteDoEnvolvedor = false } = contexto;
  const inicio = palavras.findIndex(palavra => !/^[A-Za-z_]\w*=/.test(palavra));
  if (inicio < 0) return false;
  const comando = palavras.slice(inicio);
  const args = comando.slice(1);
  const verbo = verboNormalizado(comando[0]!);
  if (ENVOLVEDORES.has(verbo)) {
    const resto = desembrulhar(verbo, args);
    // Opções do próprio envolvedor também podem apontar para raw/ (`env -C raw`, `xargs -a raw/lista`).
    if (args.slice(0, args.length - resto.length).some(arg => escreveEmRaw(arg, cwd) || citaRaw(arg) || arg.toLowerCase().includes("raw"))) return true;
    // Sem comando, só o xargs é inofensivo (repete a entrada); `parallel`, `sudo -s` e `env` lendo raw/ pelo pipe não são.
    if (!resto.length) return doPipe && verbo !== "xargs";
    const descartados = args.slice(0, args.length - resto.length);
    return segmentoEscreve(resto, cwd, { raiz, doPipe, forcar: forcar || doPipe, ambienteDoEnvolvedor: ambienteDoEnvolvedor || descartados.some(ambienteInseguro) });
  }
  if (doPipe && (SHELLS.has(verbo) || verbo === "source" || verbo === ".")) return true;
  if (SHELLS.has(verbo)) {
    const marca = args.findIndex(arg => /^-[a-zA-Z]*c$/.test(arg) || /^-command$/i.test(arg) || (verbo === "cmd" && /^\/[ck]$/i.test(arg)));
    // No cmd o script é tudo que vem depois de /c; nos demais, o argumento seguinte.
    const script = marca < 0 ? undefined : verbo === "cmd" ? args.slice(marca + 1).join(" ") : args[marca + 1];
    if (script !== undefined) {
      // Os argumentos depois do script chegam a ele como $0, $1, $@: se citam raw/, o script pode agir sobre eles.
      return terminalEscreve(script, cwd, raiz) || (verbo !== "cmd" && args.slice(marca + 2).some(arg => escreveEmRaw(arg, cwd) || citaRaw(arg)));
    }
  }
  if (apagaAncestral(verbo, args, cwd, raiz)) return true;
  if (DESTINO_JULGADO.has(verbo)) return destinosDoCmdlet(verbo, args).some(destino => escreveEmRaw(destino, cwd) || citaRaw(destino));
  if (verbo === "cp") {
    const alvos = args.flatMap((arg, i) => {
      if (arg.startsWith("--target-directory=")) return [arg.slice(19)];
      if (arg === "--target-directory" || /^-[a-zA-Z]*t$/.test(arg)) return [args[i + 1] ?? ""];
      const agrupado = /^-[a-zA-Z]*?t(.+)$/.exec(arg);
      return agrupado ? [agrupado[1]!] : [];
    });
    return (alvos.length ? alvos : [args.at(-1) ?? ""]).some(alvo => escreveEmRaw(alvo, cwd));
  }
  if (!forcar && !estaEmRaw(comando[0]!) && !args.some(palavra => escreveEmRaw(palavra, cwd) || citaRaw(palavra))) return false;
  if (verbo === "rg") return args.some(arg => arg === "--pre" || arg.startsWith("--pre="));
  // Interpretadores com script próprio escrevem onde quiserem: citando raw/, só passa sed sem -i e sem comando w/e.
  if (verbo === "perl") return true;
  if (verbo === "sed") return args.some(arg => /^--in-place(?:=|$)/.test(arg) || /^-[a-zA-Z]*[iI]/.test(arg) || SED_ESCREVE.test(arg));
  if (verbo === "git") {
    const { subcomando, globais } = analisarGit(args);
    // Programa externo por variável, configuração ou caminho de executáveis: a leitura deixa de ser só leitura.
    if (palavras.slice(0, inicio).some(ambienteInseguro) || ambienteDoEnvolvedor) return true;
    if (globais.some(opcao => opcao === "-c" || /^--(?:config-env|exec-path)(?:=|$)/.test(opcao))) return true;
    if (subcomando === undefined) return false;
    return !GIT_LEITURA.has(subcomando)
      || args.some(arg => prefixo(arg, "--output") || (subcomando === "reflog" && /^(?:expire|delete)$/.test(arg))
        || (subcomando === "grep" && (!arg.startsWith("--") && /^-[A-Za-z0-9]*O/.test(arg)) || prefixo(arg, "--open-files-in-pager")));
  }
  if (verbo === "find") return args.some(arg => FIND_ESCREVE.test(arg));
  return !LEITURAS_TERMINAL.has(verbo);
}

function verboNormalizado(palavra: string): string {
  return palavra.replace(/^\\/, "").split(/[\\/]/).pop()!.toLowerCase().replace(/\.exe$/, "");
}

function escritaDeShell(palavras: string[]): boolean {
  let comando = palavras;
  for (;;) {
    const inicio = comando.findIndex(palavra => !/^[A-Za-z_]\w*=/.test(palavra) && !PALAVRAS_DE_LACO.has(palavra));
    if (inicio < 0) return false;
    comando = comando.slice(inicio);
    const verbo = verboNormalizado(comando[0]!);
    if (!ENVOLVEDORES.has(verbo)) {
      const args = comando.slice(1);
      if (ESCRITA_GLOBAL.has(verbo)) return true;
      if (verbo === "sed") return args.some(arg => /^--in-place(?:=|$)/.test(arg) || /^-[a-zA-Z]*[iI]/.test(arg));
      if (/^python[0-9.]*$/.test(verbo)) return args.includes("-c");
      if (["node", "bun", "deno", "ruby", "php"].includes(verbo)) return args.some(arg => /^(?:-e|--eval|-r|-p|--print)$/.test(arg));
      return false;
    }
    const resto = desembrulhar(verbo, comando.slice(1));
    if (!resto.length) return false;
    comando = resto;
  }
}

function citaRawSegmento(palavras: string[], cwd: string): boolean {
  return palavras.slice(1).some(palavra => escreveEmRaw(palavra, cwd) || citaRaw(palavra));
}

function terminalEscreve(comando: unknown, cwdInicial: string, raiz: string = cwdInicial): boolean {
  let cwd = cwdInicial;
  let palavras: string[] = [];
  let doPipe = false;
  let listagemAncestral = false;
  const segmentos: string[][] = [];
  let anterior: string | undefined;
  const tokens = tokensDoComando(comando);
  function fechar(): boolean {
    const verbo = palavras[0]?.toLowerCase();
    if (verbo !== undefined && MUDAM_DIRETORIO.has(verbo)) {
      const alvos = palavras.slice(1).filter(palavra => !palavra.startsWith("-") || palavra === "-");
      const alvo = verbo === "popd" ? "-" : (alvos[0] ?? "").replaceAll("\\", "/");
      const antes = cwd;
      if (alvo === "-") {
        if (anterior !== undefined) cwd = anterior;
      } else cwd = /^(?:[a-z]:|\/)/i.test(alvo) || !cwd ? posix.normalize(alvo || ".") : posix.normalize(`${cwd.replaceAll("\\", "/")}/${alvo}`);
      anterior = antes;
      palavras = [];
      return false;
    }
    const escreve = segmentoEscreve(palavras, cwd, { raiz, doPipe }) || (listagemAncestral && escritaDeShell(palavras));
    segmentos.push(palavras);
    palavras = [];
    return escreve;
  }
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (!token.operador) {
      palavras.push(token.texto);
      continue;
    }
    if (/^>{1,2}$/.test(token.texto)) {
      let alvo = tokens[i + 1];
      if (alvo?.operador && /^[|&]$/.test(alvo.texto)) alvo = tokens[i + 2];
      if (alvo !== undefined && !alvo.operador && escreveEmRaw(alvo.texto, cwd)) return true;
    } else if ([";", "|", "||", "&&", "&"].includes(token.texto)) {
      const citou = citaRawSegmento(palavras, cwd);
      const recursiva = palavras.length > 0 && listagemRecursivaAncestral(verboNormalizado(palavras[0]!), palavras.slice(1), cwd, raiz);
      if (fechar()) return true;
      doPipe = token.texto === "|" && (doPipe || citou);
      listagemAncestral = token.texto === "|" && (listagemAncestral || recursiva);
    }
  }
  if (fechar()) return true;
  const cita = segmentos.some(segmento => segmento.some(citaRaw));
  return cita && segmentos.some(escritaDeShell);
}

function textoDoComando(comando: unknown): string {
  return typeof comando === "string" ? comando : JSON.stringify(comando) ?? "";
}

function decidirTerminal(comando: unknown, cwd: string): Decisao {
  const motivo = `terminal: ${textoDoComando(comando)}`;
  try {
    return { acao: terminalEscreve(comando, cwd) ? "bloquear" : "liberar", motivo };
  } catch (erro) {
    // Comando que não dá para ler só falha fechado quando cita raw/; sem isso, todo $(...) seria recusado.
    const cita = citaRaw(textoDoComando(comando));
    return { acao: cita ? "bloquear" : "liberar", motivo: `${motivo} (${(erro as Error).message})` };
  }
}

export function decidir(payload: string): Decisao {
  try {
    const dados: unknown = JSON.parse(payload);
    if (!mapa(dados)) throw new Error("payload deve ser um objeto JSON");
    const nome = String(dados.tool_name ?? dados.toolName ?? "").toLowerCase();
    let entrada = dados.tool_input ?? dados.toolInput ?? dados.toolArgs ?? dados.tool_args ?? dados.arguments ?? {};
    if (typeof entrada === "string" && ("toolArgs" in dados || "tool_args" in dados || "arguments" in dados)) entrada = JSON.parse(entrada);
    if (!mapa(entrada)) throw new Error("argumentos da ferramenta ilegíveis");
    const cwd = String(entrada.workdir ?? entrada.cwd ?? entrada.directory ?? entrada.dir_path ?? dados.cwd ?? "");
    if (LEITORES.has(nome)) return { acao: "liberar", motivo: "ferramenta de leitura" };
    // Os caminhos vêm dos argumentos já decodificados (toolArgs do Copilot é texto) e do payload; o caminho em raw/ bloqueia
    // mesmo que a ferramenta também tenha um comando.
    const caminhos = [...new Set(caminhosDe([dados, entrada]))];
    const alvo = caminhos.find(caminho => escreveEmRaw(caminho, cwd));
    if (alvo !== undefined) return { acao: "bloquear", motivo: `caminho dentro de raw/: ${alvo}` };
    if (TERMINAIS.has(nome) || "command" in entrada || "cmd" in entrada) return decidirTerminal(entrada.command ?? entrada.cmd, cwd);
    if (caminhos.length) return { acao: "liberar", motivo: caminhos.join(" ") };
    return citaRaw(payload)
      ? { acao: "bloquear", motivo: "payload sem caminho isolável que cita raw/ (falha fechado)" }
      : { acao: "liberar", motivo: "payload sem caminho isolável, sem citação a raw/" };
  } catch (erro) {
    return { acao: "bloquear", motivo: `falha fechada: ${erro instanceof Error ? erro.message : String(erro)}` };
  }
}

export async function executarProtecao(payload: string): Promise<number> {
  const decisao = decidir(payload);
  const log = process.env.ANVILORE_LOG_HOOK;
  if (log && !estaEmRaw(log)) {
    try {
      const motivo = decisao.motivo.replace(/[\r\n\t]/g, " ");
      await appendFile(log, `${Math.floor(Date.now() / 1000)}\t${decisao.acao === "bloquear" ? "BLOQUEADO" : "PASSOU"}\t${motivo}\n`);
    } catch { /* O rastro observa; sua falha não muda a decisão. */ }
  }
  if (decisao.acao === "liberar") return 0;
  console.error(MENSAGEM);
  console.error(`Motivo: ${decisao.motivo}`);
  return 2;
}

// A forma de Codex e Gemini termina em `; exit $LASTEXITCODE`: no sh e no PowerShell isso é outro comando; no cmd chega aqui como
// argumentos (`proteger-raw;`, `exit`, `$LASTEXITCODE`) e é ignorado. Qualquer outro argumento continua sendo erro de uso.
function argumentosValidos(args: string[]): boolean {
  const [primeiro, ...resto] = args;
  const sufixo = (itens: string[]) => itens.length === 2 && itens[0] === "exit" && itens[1] === "$LASTEXITCODE";
  if (primeiro === "proteger-raw") return resto.length === 0 || (resto[0] === ";" && sufixo(resto.slice(1)));
  return primeiro === "proteger-raw;" && sufixo(resto);
}

export async function comandoHook(args: string[]): Promise<number> {
  if (!argumentosValidos(args)) {
    console.error("Uso: anvilore hook proteger-raw (payload JSON na entrada padrão)");
    return 2;
  }
  try {
    return await executarProtecao(await Bun.stdin.text());
  } catch {
    console.error(MENSAGEM);
    console.error("Motivo: não foi possível ler a entrada padrão (falha fechada)");
    return 2;
  }
}

// Este módulo é obra derivada de `wiki-wonka`
// (https://github.com/cooperacode/wiki-wonka) (Coopera Code, licença MIT),
// traduzido para português do Brasil e adaptado. Aviso de copyright original
// em `LICENSE`.
