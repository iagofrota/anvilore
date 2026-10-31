import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Plataforma = "linux" | "darwin" | "win32";

export function comandoFallback(plataforma: string, termo: string): string {
  if (plataforma === "linux" || plataforma === "darwin") {
    return `grep -rn --exclude-dir=.git -i "${termo.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}" wiki/`;
  }
  if (plataforma === "win32") {
    const padrao = termo.replaceAll("'", "''");
    return `Get-ChildItem -Path wiki -Recurse -File -Filter *.md | Select-String -Encoding UTF8 -Pattern '${padrao}' | ForEach-Object { "{0}:{1}:{2}" -f $_.Path, $_.LineNumber, $_.Line }`;
  }
  throw new Error(`plataforma não suportada: ${plataforma}`);
}

export type ResultadoFallback = { codigo: number; comando: string; executavel: string; saida: string };

export function provarBuscaFallback(plataforma = process.platform): ResultadoFallback {
  const os = plataforma as Plataforma;
  const comando = comandoFallback(os, "governança");
  const executavel = Bun.which(os === "win32" ? "powershell.exe" : "grep");
  if (!executavel) return { codigo: 1, comando, executavel: "", saida: `FALHA: ferramenta nativa ausente (${os}).` };

  const temporario = mkdtempSync(join(tmpdir(), "anvilore busca fallback "));
  try {
    const wiki = join(temporario, "wiki", "concepts");
    mkdirSync(wiki, { recursive: true });
    mkdirSync(join(temporario, "wiki", ".git", "hooks"), { recursive: true });
    writeFileSync(join(temporario, ".gitignore"), "wiki/\n", "utf8");
    writeFileSync(join(wiki, "página com espaço.md"), "primeira linha\nA governança funciona.\n", "utf8");
    writeFileSync(join(temporario, "wiki", ".git", "hooks", "pre-commit.sample"), "governança no metadado git\n", "utf8");

    const r = os === "win32"
      ? Bun.spawnSync([executavel, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Set-Location -LiteralPath '${temporario.replaceAll("'", "''")}'; ${comando}`], { cwd: temporario, stdout: "pipe", stderr: "pipe" })
      : Bun.spawnSync([executavel, "-rn", "--exclude-dir=.git", "-i", "governança", "wiki/"], { cwd: temporario, stdout: "pipe", stderr: "pipe" });
    const stdout = Buffer.from(r.stdout).toString("utf8").replaceAll("\r\n", "\n").trimEnd();
    const stderr = Buffer.from(r.stderr).toString("utf8").trim();
    const linhas = stdout.split("\n");
    const ok = r.exitCode === 0 && linhas.length === 1 && linhas[0]!.includes("página com espaço.md")
      && linhas[0]!.endsWith(":2:A governança funciona.");
    return {
      codigo: ok ? 0 : 1,
      comando,
      executavel,
      saida: [stdout, stderr && `stderr: ${stderr}`, !ok && `FALHA: exit=${r.exitCode}; esperado arquivo:linha:texto com acento.`].filter(Boolean).join("\n"),
    };
  } finally {
    rmSync(temporario, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const resultado = provarBuscaFallback();
  console.log(`FALLBACK_OS=${process.platform}`);
  console.log(`FALLBACK_EXECUTAVEL=${resultado.executavel || "ausente"}`);
  console.log(`FALLBACK_COMANDO=${resultado.comando}`);
  console.log(resultado.saida || "FALHA: saída vazia.");
  if (resultado.codigo !== 0) process.exitCode = resultado.codigo;
}
