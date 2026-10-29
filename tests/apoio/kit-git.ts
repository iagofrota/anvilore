import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pecasDoModelo } from "../../src/lib/modelos";

// Fixture git de verdade para a migração do U1: uma origem bare com a versão N (que ainda rastreia os arquivos da
// pessoa, como o kit hoje) e, quando pedido, a N+1 (que os tira do rastreio). A pessoa trabalha num clone da N.


export function git(dir: string, ...args: string[]): { codigo: number; saida: string } {
  const p = Bun.spawnSync(["git", "-C", dir, "-c", "user.name=Teste", "-c", "user.email=t@e", "-c", "commit.gpgsign=false",
    "-c", "init.defaultBranch=main", "-c", "pull.rebase=false", "-c", "core.autocrlf=false", ...args], { stdout: "pipe", stderr: "pipe" });
  return { codigo: p.exitCode, saida: `${p.stdout.toString()}${p.stderr.toString()}` };
}

export function gitOk(dir: string, ...args: string[]): string {
  const r = git(dir, ...args);
  if (r.codigo !== 0) throw new Error(`git ${args.join(" ")}: ${r.saida}`);
  return r.saida.trim();
}

// O .gitignore da N é o que o kit tinha até rastrear os arquivos da pessoa; o da N+1 os ignora.
export const GITIGNORE_N = `raw/*
!raw/.gitkeep
!raw/exemplo/
/wiki/**
!/wiki/.gitignore
!/wiki/index.md
!/wiki/log.md
!/wiki/_meta/
!/wiki/_meta/.gitkeep
!/wiki/log/
!/wiki/log/.gitkeep
!/wiki/exemplo/
!/wiki/exemplo/sources/
!/wiki/exemplo/sources/.gitkeep
!/wiki/exemplo/entities/
!/wiki/exemplo/entities/.gitkeep
!/wiki/exemplo/concepts/
!/wiki/exemplo/concepts/.gitkeep
!/wiki/exemplo/concepts/area-tematica.md
.anvilore/
`;
// A N+1 é a versão deste repositório: usa o .gitignore real do kit.
export const GITIGNORE_N1 = readFileSync(join(import.meta.dir, "../../.gitignore"), "utf8");

export async function montarOrigem(tmp: string): Promise<{ origem: string; dev: string }> {
  const origem = join(tmp, "origem.git");
  const dev = join(tmp, "dev");
  gitOk(tmp, "init", "-q", "--bare", origem);
  gitOk(tmp, "clone", "-q", origem, dev);
  gitOk(dev, "config", "core.autocrlf", "false");
  writeFileSync(join(dev, ".gitignore"), GITIGNORE_N);
  writeFileSync(join(dev, "codigo.ts"), "export const versao = 'N';\n");
  for (const peca of await pecasDoModelo()) {
    mkdirSync(dirname(join(dev, peca.destino)), { recursive: true });
    writeFileSync(join(dev, peca.destino), readFileSync(peca.origem));
  }
  gitOk(dev, "add", "-A");
  gitOk(dev, "add", "-f", "wiki/exemplo"); // o .gitignore da wiki ignora exemplo/; o kit o rastreia mesmo assim
  gitOk(dev, "commit", "-qm", "versão N");
  gitOk(dev, "push", "-q", "origin", "main");
  return { origem, dev };
}

export function publicarN1(dev: string, rastreados: string[]): void {
  gitOk(dev, "rm", "-q", "-r", "--cached", "--", ...rastreados);
  writeFileSync(join(dev, ".gitignore"), GITIGNORE_N1);
  writeFileSync(join(dev, "codigo.ts"), "export const versao = 'N+1';\n");
  gitOk(dev, "add", "-A");
  gitOk(dev, "commit", "-qm", "versão N+1: dados fora do rastreio");
  gitOk(dev, "push", "-q", "origin", "main");
}

export function clonar(origem: string, destino: string): string {
  gitOk(dirname(destino), "clone", "-q", origem, destino);
  // Clone de verdade tem configuração estável; aqui o runner Windows traz autocrlf=true e o pull do --puxar (que roda
  // sem os -c da fixture) reescreveria fins de linha que o clone não converteu.
  gitOk(destino, "config", "core.autocrlf", "false");
  return destino;
}
