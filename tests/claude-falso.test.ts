import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const FALSO = resolve(import.meta.dir, "apoio/claude-falso.ts");
let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "anvilore-falso-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

function conversa(nome: string, fonte: string, segundos: number) {
  const arquivo = join(tmp, ".anvilore/ui/conversas", nome);
  mkdirSync(join(tmp, ".anvilore/ui/conversas"), { recursive: true });
  writeFileSync(arquivo, JSON.stringify({ fonte }));
  utimesSync(arquivo, segundos, segundos);
}

async function executar(roteiro: unknown): Promise<string> {
  const arquivo = join(tmp, "roteiro.json");
  writeFileSync(arquivo, JSON.stringify(roteiro));
  const processo = Bun.spawn([process.execPath, FALSO, "-p", "x"], { cwd: tmp, env: { PATH: process.env.PATH, CLAUDE_FALSO_ROTEIRO: arquivo }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const saida = await new Response(processo.stdout).text();
  await processo.exited;
  return saida;
}

test("Dado duas conversas salvas Quando o falso expande {{FONTE_ATUAL}} Então usa a mais recente, não a primeira da pasta", async () => {
  conversa("a-antiga.json", "raw/pessoal/antiga.md", 1_700_000_000);
  conversa("z-recente.json", "raw/pessoal/recente.md", 1_800_000_000);
  expect(JSON.parse(await executar({ leitor: [{ linha: { fonte: "{{FONTE_ATUAL}}" } }] }))).toEqual({ fonte: "raw/pessoal/recente.md" });
});

test("Dado nenhuma conversa persistida Quando o falso expande {{FONTE_ATUAL}} Então o marcador vira texto vazio", async () => {
  expect(JSON.parse(await executar({ leitor: [{ linha: { fonte: "{{FONTE_ATUAL}}" } }] }))).toEqual({ fonte: "" });
});
