import { join, resolve } from "node:path";

const raiz = resolve(import.meta.dir, "..");
const CASOS = [
  ["escrita comum", JSON.stringify({ tool_name: "Write", tool_input: { file_path: "wiki/exemplo/teste.md", content: "texto" } })],
  ["terminal", JSON.stringify({ tool_name: "Bash", tool_input: { command: "rg palavra wiki/ && ls raw/" } })],
] as const;

export function estatisticas(amostras: number[]) {
  const ordenadas = [...amostras].sort((a, b) => a - b);
  const meio = Math.floor(ordenadas.length / 2);
  return {
    execucoes: ordenadas.length,
    medianaMs: ordenadas.length % 2 ? ordenadas[meio]! : (ordenadas[meio - 1]! + ordenadas[meio]!) / 2,
    p95Ms: ordenadas[Math.ceil(ordenadas.length * 0.95) - 1]!,
    minimoMs: ordenadas[0]!,
    maximoMs: ordenadas.at(-1)!,
  };
}

// Mede o processo inteiro, como o agente o dispara a cada gravação: partida do Bun mais a decisão.
export async function medirLatencia(execucoes = 20, cli = join(raiz, "src/cli.ts")): Promise<number> {
  let falhou = false;
  for (const [nome, payload] of CASOS) {
    const amostras: number[] = [];
    for (let i = 1; i <= execucoes; i++) {
      const inicio = performance.now();
      const p = Bun.spawnSync([process.execPath, cli, "hook", "proteger-raw"], { stdin: Buffer.from(payload), stdout: "pipe", stderr: "pipe" });
      amostras.push(performance.now() - inicio);
      if (p.exitCode !== 0) {
        console.error(`FALHA: execução ${i} (${nome}) saiu ${p.exitCode}: ${p.stderr.toString().trim()}`);
        falhou = true;
        break;
      }
    }
    if (amostras.length === execucoes) {
      const e = estatisticas(amostras);
      const arredondar = (n: number) => Math.round(n * 10) / 10;
      console.log(`latência hook proteger-raw, ${nome} (${process.platform}): ${e.execucoes} execuções; mediana ${arredondar(e.medianaMs)} ms; p95 ${arredondar(e.p95Ms)} ms; mín ${arredondar(e.minimoMs)} ms; máx ${arredondar(e.maximoMs)} ms; primeira ${arredondar(amostras[0]!)} ms`);
    }
  }
  return falhou ? 1 : 0;
}

export async function rodarMedicao(args: string[]): Promise<number> {
  const execucoes = args[0] === undefined ? 20 : Number(args[0]);
  if (!Number.isInteger(execucoes) || execucoes < 1) {
    console.error("Uso: bun scripts/medir-latencia-hook.ts [execuções (inteiro >= 1; padrão 20)]");
    return 2;
  }
  return medirLatencia(execucoes);
}

if (import.meta.main) process.exit(await rodarMedicao(process.argv.slice(2)));
