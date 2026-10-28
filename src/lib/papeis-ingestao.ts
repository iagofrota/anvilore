import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// Os dois papéis da ingestão. O prompt de cada um mora em skills/ingest/<papel>.md e é a
// fonte única: a skill no terminal e a interface (`claude -p --append-system-prompt-file`)
// leem o mesmo arquivo, e os agentes do Claude Code são gerados dele.
export type Papel = "leitor" | "escritor";
export type Rota = "padrao" | "grande" | "dividir";

const fonteDoKit = resolve(import.meta.dir, "../..");

// O leitor nunca escreve; o escritor edita, mas não roda comando: índice, log, validação e
// aprovação finais são da ferramenta. `raw/` fica de fora pelo hook proteger-raw.
export const FERRAMENTAS: Record<Papel, readonly string[]> = {
  leitor: ["Read", "Grep", "Glob"],
  escritor: ["Read", "Grep", "Glob", "Edit", "Write"],
};

// Até 400 000 bytes a fonte cabe na janela padrão com folga (limite do R70). O teto da janela
// grande vem da wiki-wonka (scripts/ingest-rota.py, medido em 2026-10-10): ~1,6 byte por token
// e 80% de 1 milhão de tokens menos 60 mil de sobrecarga do escritor dão ~1 184 000 bytes;
// arredondado para baixo. Acima disso, nenhuma janela comporta: a pessoa decide como dividir.
export const LIMITE_GRANDE_BYTES = 400_000;
export const LIMITE_DIVIDIR_BYTES = 1_150_000;

// O modelo de janela grande que o agente gerado pede. É o que a wiki-wonka mediu aceito num
// arquivo de agente; o parâmetro `model` do Agent tool recusou o mesmo valor.
const MODELO_GRANDE = "sonnet[1m]";

export function rotaDaIngestao(bytes: number): Rota {
  if (bytes <= LIMITE_GRANDE_BYTES) return "padrao";
  if (bytes <= LIMITE_DIVIDIR_BYTES) return "grande";
  return "dividir";
}

export function nomeDoAgente(papel: Papel, rota: Exclude<Rota, "dividir">): string {
  return `anvilore-${papel}${rota === "grande" ? "-grande" : ""}`;
}

const DESCRICAO: Record<Papel, string> = {
  leitor: "Leitor da ingestão do Anvilore: lê a fonte em raw/ e a wiki e devolve o relatório JSON; não escreve nada. Usado pela skill ingest.",
  escritor: "Escritor da ingestão do Anvilore: escreve na wiki só o que a pessoa aprovou; sem comandos e nunca em raw/. Usado pela skill ingest.",
};

// O instalador só regrava o arquivo de agente que traz esta marca: o resto é da pessoa.
export const MARCA_DE_GERADO = "Gerado por `anvilore instalar`";

export function definicaoDoAgente(papel: Papel, rota: Exclude<Rota, "dividir">, corpo: string): string {
  const linhas = [
    "---",
    `name: ${nomeDoAgente(papel, rota)}`,
    `description: ${JSON.stringify(DESCRICAO[papel])}`,
    `tools: ${FERRAMENTAS[papel].join(", ")}`,
    ...(rota === "grande" ? [`model: ${MODELO_GRANDE}`] : []),
    "---",
    "",
    `<!-- ${MARCA_DE_GERADO} a partir de \`skills/ingest/${papel}.md\`. Não edite aqui: mude o prompt e instale de novo. -->`,
    "",
  ];
  return linhas.join("\n") + corpo;
}

export type ArquivoGerado = { rel: string; conteudo: string };

export async function agentesDaIngestao(raizFonte: string = fonteDoKit): Promise<ArquivoGerado[]> {
  const corpos: Record<Papel, string> = {
    leitor: await readFile(join(raizFonte, "skills/ingest/leitor.md"), "utf8"),
    escritor: await readFile(join(raizFonte, "skills/ingest/escritor.md"), "utf8"),
  };
  const arquivos: ArquivoGerado[] = [];
  for (const rota of ["padrao", "grande"] as const) {
    for (const papel of ["leitor", "escritor"] as const) {
      arquivos.push({ rel: `.claude/agents/${nomeDoAgente(papel, rota)}.md`, conteudo: definicaoDoAgente(papel, rota, corpos[papel]) });
    }
  }
  return arquivos;
}

// Um texto por agente ausente ou diferente do que a instalação gravaria hoje.
export async function conferirAgentesDaIngestao(destino: string, raizFonte: string = fonteDoKit): Promise<string[]> {
  const problemas: string[] = [];
  for (const agente of await agentesDaIngestao(raizFonte)) {
    let atual: string;
    try {
      atual = await readFile(join(destino, agente.rel), "utf8");
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code !== "ENOENT") throw erro;
      problemas.push(`${agente.rel} não existe`);
      continue;
    }
    if (atual !== agente.conteudo) problemas.push(`${agente.rel} desatualizado`);
  }
  return problemas;
}
