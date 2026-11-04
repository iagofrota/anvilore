import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { inicializar, type ResultadoInit } from "../comandos/init";
import { isoComOffset } from "./hora";
import { areasDaWiki } from "./ui-fonte";
import { caminhoWiki } from "./wiki-repo";

export type InspecaoItem = { existe: boolean; detalhe: string };
export type InspecaoPasta = {
  wiki: InspecaoItem;
  raw: InspecaoItem;
  contratos: InspecaoItem;
  bun: InspecaoItem;
};

export type StatusAgente = {
  nome: string;
  disponivel: boolean;
  versao?: string;
  travas: Array<{ nome: string; ligada: boolean; opcional?: boolean; detalhe?: string }>;
};

export type StatusAreas = {
  padrao: string[];
  existentes: string[];
  temExemplo: boolean;
};

export type StatusPrimeiraIngestao = {
  exemploDisponivel: boolean;
  caminho: string;
};

export type EstadoOnboarding = {
  precisaOnboarding: boolean;
  concluido: boolean;
  etapa: number;
  pasta: string;
  inspecao: InspecaoPasta;
  agente: StatusAgente;
  areas: StatusAreas;
  primeiraIngestao: StatusPrimeiraIngestao;
};

export function validarPastaVault(pasta: string): string {
  if (!pasta || typeof pasta !== "string" || !pasta.trim()) {
    throw new Error("O caminho da pasta não pode ser vazio.");
  }
  if (/[\u0000-\u001f]/.test(pasta)) {
    throw new Error("O caminho contém caracteres inválidos.");
  }
  const caminhoAbsoluto = resolve(pasta.trim());
  if (!existsSync(caminhoAbsoluto)) {
    throw new Error(`A pasta não existe: ${caminhoAbsoluto}`);
  }
  let info;
  try {
    info = statSync(caminhoAbsoluto);
  } catch {
    throw new Error(`Não foi possível acessar a pasta: ${caminhoAbsoluto}`);
  }
  if (!info.isDirectory()) {
    throw new Error(`O caminho não é um diretório: ${caminhoAbsoluto}`);
  }

  // Não sobrescrever pasta existente com conteúdo que não seja Anvilore
  const entradas = readdirSync(caminhoAbsoluto) as string[];
  if (entradas.length > 0) {
    const eAnvilore =
      entradas.includes("SCHEMA.md") ||
      entradas.includes("wiki") ||
      entradas.includes("raw") ||
      entradas.includes(".anvilore") ||
      entradas.includes("package.json");
    if (!eAnvilore) {
      throw new Error(
        "A pasta já existe e contém arquivos que não pertencem ao Anvilore. Escolha a pasta do kit ou uma pasta vazia.",
      );
    }
  }

  return caminhoAbsoluto;
}

export async function inspecionarPasta(pasta: string): Promise<InspecaoPasta> {
  const caminho = resolve(pasta);
  const caminhoDaWiki = join(caminho, "wiki");
  const caminhoDoRaw = join(caminho, "raw");

  let wikiExiste = false;
  let wikiDetalhe = "não encontrada";
  try {
    if (existsSync(caminhoDaWiki)) {
      wikiExiste = true;
      const areas = await areasDaWiki(caminhoDaWiki);
      if (areas.length > 0) {
        wikiDetalhe = `${areas.length} ${areas.length === 1 ? "área encontrada" : "áreas encontradas"}: ${areas.join(", ")}`;
      } else if (existsSync(join(caminhoDaWiki, "exemplo"))) {
        wikiDetalhe = "só a área de exemplo, por enquanto";
      } else {
        wikiDetalhe = "pasta criada, sem áreas";
      }
    }
  } catch {
    /* fallback */
  }

  let rawExiste = false;
  let rawDetalhe = "não encontrada";
  try {
    if (existsSync(caminhoDoRaw)) {
      rawExiste = true;
      let fontes = 0;
      const itens = await readdir(caminhoDoRaw, { recursive: true });
      fontes = itens.filter(i => /\.(md|txt|pdf)$/i.test(i)).length;
      if (fontes > 0) {
        rawDetalhe = `${fontes} ${fontes === 1 ? "fonte encontrada" : "fontes encontradas"}`;
      } else {
        rawDetalhe = "pasta criada, sem fontes";
      }
    }
  } catch {
    /* fallback */
  }

  const temSchema = existsSync(join(caminho, "SCHEMA.md"));
  const temAgents = existsSync(join(caminho, "AGENTS.md"));
  const contratosExiste = temSchema && temAgents;
  const contratosDetalhe = contratosExiste
    ? "os dois contratos (SCHEMA.md e AGENTS.md)"
    : temSchema
      ? "apenas SCHEMA.md encontrado"
      : temAgents
        ? "apenas AGENTS.md encontrado"
        : "contratos ausentes";

  const bunExiste = Bun.which("bun") !== null;
  const bunDetalhe = bunExiste ? "no PATH: validador e hook rodam" : "não encontrado no PATH";

  return {
    wiki: { existe: wikiExiste, detalhe: wikiDetalhe },
    raw: { existe: rawExiste, detalhe: rawDetalhe },
    contratos: { existe: contratosExiste, detalhe: contratosDetalhe },
    bun: { existe: bunExiste, detalhe: bunDetalhe },
  };
}

export async function inicializarIdentidade(
  raiz: string,
  ambiente: Record<string, string | undefined> = process.env,
): Promise<string> {
  const caminhoIdentidade = join(raiz, ".anvilore", "identidade");
  try {
    const existente = (await readFile(caminhoIdentidade, "utf8")).trim();
    if (existente && /^human:[a-z0-9_-]+$/i.test(existente)) return existente;
  } catch {
    /* arquivo não existe */
  }

  const opcoes = { stdout: "pipe" as const, stderr: "ignore" as const, env: ambiente };
  const wiki = caminhoWiki(raiz, ambiente);
  const gitWiki = Bun.spawnSync(["git", "-C", wiki, "config", "user.name"], opcoes);
  const usuario = gitWiki.exitCode === 0 && gitWiki.stdout.toString().trim()
    ? gitWiki.stdout.toString().trim()
    : Bun.spawnSync(["git", "-C", raiz, "config", "user.name"], opcoes).stdout.toString().trim();

  const slug = usuario
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const identidade = slug ? `human:${slug}` : "human:local";

  await mkdir(join(raiz, ".anvilore"), { recursive: true });
  await writeFile(caminhoIdentidade, `${identidade}\n`, "utf8");
  return identidade;
}

export async function estadoOnboarding(
  raiz: string,
  ambiente: Record<string, string | undefined> = process.env,
): Promise<EstadoOnboarding> {
  let concluido = false;
  let etapa = 1;
  const caminhoOnboardingJson = join(raiz, ".anvilore", "onboarding.json");
  try {
    const dados = JSON.parse(await readFile(caminhoOnboardingJson, "utf8")) as Record<string, unknown>;
    if (dados.concluido === true) concluido = true;
    if (typeof dados.etapa === "number") etapa = dados.etapa;
  } catch {
    /* onboarding.json não existe */
  }

  const wiki = caminhoWiki(raiz, ambiente);
  const areasExistentes = await areasDaWiki(wiki);
  const temExemplo = existsSync(join(wiki, "exemplo"));
  const caminhoIdentidade = join(raiz, ".anvilore", "identidade");
  const temIdentidade = existsSync(caminhoIdentidade);

  // Com wiki já pronta (áreas reais configuradas), identidade já existente ou concluído pelo arquivo de estado
  const precisaOnboarding = !concluido && !temIdentidade && areasExistentes.length === 0;

  const inspecao = await inspecionarPasta(raiz);

  // Status do agente
  const claudeExe = Bun.which("claude", { PATH: ambiente.PATH ?? process.env.PATH ?? "" });
  let claudeVersao: string | undefined;
  if (claudeExe) {
    try {
      const proc = Bun.spawnSync([claudeExe, "--version"], { stdout: "pipe", stderr: "ignore" });
      const achada = /(\d+\.\d+\.\d+)/.exec(proc.stdout.toString());
      if (achada) claudeVersao = achada[1];
    } catch {
      /* não foi possível ler versão */
    }
  }

  const caminhoExemploRaw = join(raiz, "raw", "exemplo", "llm-wiki.md");
  const exemploDisponivel = existsSync(caminhoExemploRaw);

  return {
    precisaOnboarding,
    concluido,
    etapa,
    pasta: resolve(raiz),
    inspecao,
    agente: {
      nome: "Claude Code",
      disponivel: claudeExe !== null,
      versao: claudeVersao,
      travas: [
        { nome: "Hook que protege raw/", ligada: existsSync(join(raiz, ".claude/settings.json")) || existsSync(join(raiz, "hooks/proteger-raw.sh")) },
        { nome: "Skills ingest, query e lint", ligada: existsSync(join(raiz, "skills/ingest/SKILL.md")) },
        { nome: "Validador", ligada: existsSync(join(raiz, "src/comandos/validar.ts")) || Bun.which("bun") !== null },
        { nome: "Validação no CI", ligada: false, opcional: true, detalhe: "opcional · desligada" },
      ],
    },
    areas: {
      padrao: ["pessoal", "profissional", "projetos-paralelos", "saude"],
      existentes: areasExistentes,
      temExemplo,
    },
    primeiraIngestao: {
      exemploDisponivel,
      caminho: "raw/exemplo/llm-wiki.md",
    },
  };
}

export async function inicializarAreasOnboarding(
  raiz: string,
  areas: string[],
  opcoes: { removerExemplo?: boolean } = {},
  ambiente: Record<string, string | undefined> = process.env,
): Promise<ResultadoInit> {
  const resultado = await inicializar({ raiz, areas });
  await inicializarIdentidade(raiz, ambiente);

  if (opcoes.removerExemplo) {
    const wiki = caminhoWiki(raiz, ambiente);
    const pastaExemplo = join(wiki, "exemplo");
    if (existsSync(pastaExemplo)) {
      await rm(pastaExemplo, { recursive: true, force: true });
    }
    const caminhoIndice = join(wiki, "index.md");
    if (existsSync(caminhoIndice)) {
      try {
        const conteudo = await readFile(caminhoIndice, "utf8");
        const linhasAtualizadas = conteudo
          .split("\n")
          .filter(linha => !/exemplo/i.test(linha))
          .join("\n");
        await writeFile(caminhoIndice, linhasAtualizadas, "utf8");
      } catch {
        /* se falhar leitura do índice, prossegue */
      }
    }
  }

  return resultado;
}

export async function concluirOnboarding(raiz: string): Promise<void> {
  const pastaAnvilore = join(raiz, ".anvilore");
  await mkdir(pastaAnvilore, { recursive: true });
  await writeFile(
    join(pastaAnvilore, "onboarding.json"),
    JSON.stringify({ concluido: true, concluidoEm: isoComOffset(new Date()), etapa: 4 }, null, 2),
    "utf8",
  );
}
