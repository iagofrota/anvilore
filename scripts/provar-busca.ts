import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { argumentosDoCmd } from "./provar-forma-instalada";

const raiz = resolve(import.meta.dir, "..");

// A skill é a fonte: não corrigir aspas, regex nem Unicode antes de executar.
export function comandosDaSkill(texto = readFileSync(join(raiz, "skills/query/SKILL.md"), "utf8")) {
  const comandos = texto.split(/\r?\n/).map(l => l.trim());
  const termo = comandos.find(l => l.startsWith('rg ') && l.includes('"<termo-chave>"'));
  const lacunas = comandos.find(l => l.startsWith("rg ") && l.includes("[!gap"));
  if (!termo || !lacunas) throw new Error("comandos da skill query ausentes; revisar a prova explicitamente");
  return { termo, lacunas };
}

export function prepararWiki() {
  const tmp = mkdtempSync(join(tmpdir(), "anvilore-busca-"));
  const cwd = join(tmp, "wiki com espaço");
  try {
    mkdirSync(join(cwd, "wiki/exemplo/concepts"), { recursive: true });
    // rg só respeita .gitignore num repositório Git. Não usar a configuração real da pessoa.
    const git = Bun.spawnSync(["git", "-c", "init.templateDir=", "init", "--quiet", cwd], { stdout: "pipe", stderr: "pipe" });
    if (git.exitCode !== 0) throw new Error(`git init temporário: ${git.stderr.toString()}`);
    writeFileSync(join(cwd, "wiki/.gitignore"), readFileSync(join(raiz, "wiki/.gitignore")));
    writeFileSync(join(cwd, "wiki/index.md"), "# Índice de teste\n");
    const paginas = ["wiki/exemplo/concepts/governança-nfc.md", "wiki/exemplo/concepts/tributação-nfd.md".normalize("NFD")];
    for (const [i, pagina] of paginas.entries()) {
      const texto = "# Diagnostico\nbusca-diagnostico\ngovernança e tributação\n> [!gap] confirmar\n> [!contradiction] conferir\n";
      writeFileSync(join(cwd, pagina), texto.normalize(i === 0 ? "NFC" : "NFD"));
    }
    return { tmp, cwd, paginas };
  } catch (erro) {
    rmSync(tmp, { recursive: true, force: true });
    throw erro;
  }
}

// Extrair o número da linha, em vez de tentar abrir literalmente "arquivo:linha:texto".
export function abrirCitacao(cwd: string, arquivo: string, linha: number): string {
  return readFileSync(resolve(cwd, arquivo.replace(/[\\/]/g, sep)), "utf8").split(/\r?\n/)[linha - 1] ?? "";
}

function resolverShell(nome: string) {
  const gitBash = join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe");
  const exe = nome === "bash" && process.platform === "win32" && existsSync(gitBash) ? gitBash
    : nome === "cmd" ? (process.env.ComSpec ?? Bun.which("cmd")) : Bun.which(nome);
  if (!exe) return undefined;
  const args = (comando: string) => nome === "bash" ? ["-c", comando]
    : nome === "cmd" ? argumentosDoCmd(comando).args
    : ["-NoProfile", "-NonInteractive", "-Command", comando];
  return { exe, args, verbatim: nome === "cmd" };
}

type Ocorrencia = { arquivo: string; linha: number; conteudo: string; aberturaDireta: boolean; aberturaBarras: boolean };
type Obtido = { codigo: number; stdout: string; stderr: string; utf8: boolean; stdoutHex: string; ocorrencias: Ocorrencia[] };
type Caso = { cenario: string; comando: string; esperado: { codigo: number; ocorrencias: number }; obtido: Obtido; confere: boolean };
type Shell = { nome: string; exe?: string; erro?: string; ambiente?: string; rg?: { origem: string; versao: string }; casos: Caso[] };

// Fase 1: divergência funcional é MEDIÇÃO, não é sucesso da busca. Falha de infraestrutura sai 1.
// O esperado funcional para Unicode é achar ambas as páginas equivalentes; rg pode não normalizar.
export function provarBusca(apenas?: string[]) {
  const comandos = comandosDaSkill();
  const wiki = prepararWiki();
  const shells: Shell[] = [];
  let codigo = 0;
  try {
    for (const nome of apenas ?? ["bash", "pwsh", ...(process.platform === "win32" ? ["powershell", "cmd"] : [])]) {
      const resultado: Shell = { nome, casos: [] };
      shells.push(resultado);
      const shell = resolverShell(nome);
      if (!shell) { resultado.erro = "shell indisponível"; codigo = 1; continue; }
      resultado.exe = shell.exe;
      const rodar = (comando: string): Obtido => {
        const r = Bun.spawnSync([shell.exe, ...shell.args(comando)], {
          cwd: wiki.cwd, env: process.env, stdout: "pipe", stderr: "pipe", stdin: "ignore",
          windowsVerbatimArguments: shell.verbatim, timeout: 30_000,
        });
        let utf8 = true;
        try { new TextDecoder("utf-8", { fatal: true }).decode(r.stdout); } catch { utf8 = false; }
        const stdout = r.stdout.toString();
        const ocorrencias: Ocorrencia[] = [];
        for (const linha of stdout.split(/\r?\n/)) {
          const m = /^(.+?):(\d+):(.*)$/.exec(linha);
          if (!m) continue;
          const arquivo = m[1]!, numero = Number(m[2]), conteudo = m[3]!;
          let aberturaDireta = false, aberturaBarras = false;
          try { aberturaDireta = readFileSync(resolve(wiki.cwd, arquivo), "utf8").split(/\r?\n/)[numero - 1] === conteudo; } catch { /* medido abaixo */ }
          try { aberturaBarras = [arquivo.replaceAll("\\", "/"), arquivo.replaceAll("/", "\\")].every(p => abrirCitacao(wiki.cwd, p, numero) === conteudo); } catch { /* medido abaixo */ }
          ocorrencias.push({ arquivo, linha: numero, conteudo, aberturaDireta, aberturaBarras });
        }
        return { codigo: r.exitCode, stdout, stderr: r.stderr.toString(), utf8, stdoutHex: r.stdout.toString("hex"), ocorrencias };
      };
      const origem = rodar(nome === "bash" ? "command -v rg" : nome === "cmd" ? "where rg" : "(Get-Command rg -ErrorAction Stop).Source");
      const versao = rodar("rg --version");
      resultado.rg = { origem: origem.stdout.trim(), versao: versao.stdout.trim() };
      const ambiente = rodar(nome === "bash" ? "locale" : nome === "cmd" ? "chcp" : "[Console]::OutputEncoding.WebName; [Console]::OutputEncoding.CodePage; $OutputEncoding.WebName; (Get-Culture).Name; $PSVersionTable.PSVersion.ToString()");
      resultado.ambiente = JSON.stringify({ codigo: ambiente.codigo, stdout: ambiente.stdout, stderr: ambiente.stderr, utf8: ambiente.utf8 });
      // Não instalar rg em silêncio se faltar no runner. As falhas literais também entram no log.
      if (origem.codigo !== 0 || versao.codigo !== 0 || !versao.stdout.includes("ripgrep")) {
        resultado.erro = `rg indisponível: origem=${origem.codigo}, versão=${versao.codigo}; ${origem.stderr} ${versao.stderr}`;
        codigo = 1;
      }
      const buscar = (termo: string) => comandos.termo.replace("<termo-chave>", termo);
      const casos: Array<[string, string, number, number]> = [
        ["termo ASCII com --no-ignore", buscar("busca-diagnostico"), 0, 2],
        ["lacunas (literal da skill)", comandos.lacunas, 0, 4],
        ...["governança", "tributação"].flatMap(termo => (["NFC", "NFD"] as const).map(forma =>
          [`${termo} (consulta ${forma})`, buscar(termo.normalize(forma)), 0, 2] as [string, string, number, number])),
        ["termo ASCII sem --no-ignore", buscar("busca-diagnostico").replace("--no-ignore ", ""), 1, 0],
      ];
      for (const [cenario, comando, esperadoCodigo, esperadoOcorrencias] of casos) {
        const obtido = rodar(comando);
        const confere = obtido.codigo === esperadoCodigo && obtido.ocorrencias.length === esperadoOcorrencias
          && obtido.utf8 && obtido.ocorrencias.every(o => o.aberturaDireta && o.aberturaBarras)
          && (esperadoOcorrencias !== 0 || obtido.stdout === "");
        resultado.casos.push({ cenario, comando, esperado: { codigo: esperadoCodigo, ocorrencias: esperadoOcorrencias }, obtido, confere });
      }
    }
    return { codigo, sistema: process.platform, contexto: process.env.ANVILORE_RG_PROVA_CONTEXTO ?? "PATH original", temporario: wiki.tmp, shells };
  } finally { rmSync(wiki.tmp, { recursive: true, force: true }); }
}

export function imprimirProva(resultado: ReturnType<typeof provarBusca>) {
  console.log(`CONTEXTO: ${resultado.contexto}`);
  const linhas = ["| Sistema | Shell | Cenário | Obtido (saída / ocorrências) | Esperado | Resultado |", "|---|---|---|---|---|---|"];
  for (const shell of resultado.shells) {
    console.log(`BUSCA_AMBIENTE ${JSON.stringify({ sistema: resultado.sistema, contexto: resultado.contexto, ...shell, casos: undefined })}`);
    if (shell.erro) console.log(`FALHA infraestrutura: ${shell.nome}: ${shell.erro}`);
    for (const caso of shell.casos) {
      const estado = caso.confere ? "ok" : "DIVERGE (diagnóstico)";
      linhas.push(`| ${resultado.sistema} | ${shell.nome} | ${caso.cenario} | ${caso.obtido.codigo} / ${caso.obtido.ocorrencias.length} | ${caso.esperado.codigo} / ${caso.esperado.ocorrencias} | ${estado} |`);
      console.log(`BUSCA_CASO ${JSON.stringify({ sistema: resultado.sistema, contexto: resultado.contexto, shell: shell.nome, ...caso })}`);
    }
  }
  const quadro = linhas.join("\n");
  console.log(quadro);
  console.log("DIVERGE registra uma diferença funcional, sem corrigi-la nesta fase. Unicode esperado: duas páginas canonicamente equivalentes. Infraestrutura ausente reprova (saída 1).");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### Diagnóstico da busca — ${resultado.contexto}\n\n${quadro}\n\nAs linhas BUSCA_AMBIENTE/BUSCA_CASO no log contêm origem, versão, locale/codepage, comandos literais, bytes UTF-8, stderr e abertura das citações. DIVERGE é medição da Fase 1, sem correção.\n`);
}

if (import.meta.main) {
  const resultado = provarBusca();
  imprimirProva(resultado);
  process.exit(resultado.codigo);
}
