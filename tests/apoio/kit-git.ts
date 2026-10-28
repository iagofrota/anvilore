import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pecasDoModelo } from "../../src/lib/modelos";

// Fixture git de verdade para a migração do U1: uma origem bare com a versão N (que ainda rastreia os arquivos da
// pessoa, como o kit hoje) e, quando pedido, a N+1 (que os tira do rastreio). A pessoa trabalha num clone da N.

const raizDoKit = resolve(import.meta.dir, "../..");

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

// O .gitignore da N é o de hoje (do próprio kit); o da N+1 ignora tudo o que é da pessoa.
export const GITIGNORE_N1 = "raw/\n/wiki/\n/SCHEMA.md\n.anvilore/\nanvilore.toml\n";

export async function montarOrigem(tmp: string): Promise<{ origem: string; dev: string }> {
  const origem = join(tmp, "origem.git");
  const dev = join(tmp, "dev");
  gitOk(tmp, "init", "-q", "--bare", origem);
  gitOk(tmp, "clone", "-q", origem, dev);
  cpSync(join(raizDoKit, ".gitignore"), join(dev, ".gitignore"));
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
  return destino;
}
