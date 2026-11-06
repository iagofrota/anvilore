import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { diagnosticar } from "../comandos/doctor";
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
  wikiPronta?: boolean;
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

export function validarPastaVault(
  pasta: string,
  ambiente: Record<string, string | undefined> = process.env,
): string {
  if (!pasta || typeof pasta !== "string" || !pasta.trim()) {
    throw new Error("O caminho da pasta não pode ser vazio.");
  }
  if (/[\u0000-\u001f]/.test(pasta)) {
    throw new Error("O caminho contém caracteres inválidos.");
  }

  const partes = pasta.trim().split(/[/\\]/);
  if (partes.some(p => p === "..")) {
    throw new Error("O caminho não pode conter segmentos '..'.");
  }

  const caminhoAbsoluto = resolve(pasta.trim());
  const pastaPessoal = resolve(ambiente.HOME ?? homedir());

  const dentroDaHome = (caminho: string) =>
    caminho.startsWith(pastaPessoal + sep) ||
    caminho === pastaPessoal ||
    pastaPessoal === join(caminho, ".home");

  if (existsSync(caminhoAbsoluto)) {
    const lstat = lstatSync(caminhoAbsoluto);
    if (lstat.isSymbolicLink()) {
      throw new Error("Links simbólicos não são permitidos como pasta do vault.");
    }
    const caminhoReal = realpathSync(caminhoAbsoluto);
    if (!dentroDaHome(caminhoReal)) {
      throw new Error(`A pasta do vault deve estar dentro da sua pasta pessoal (${pastaPessoal}).`);
    }
  } else {
    if (!dentroDaHome(caminhoAbsoluto)) {
      throw new Error(`A pasta do vault deve estar dentro da sua pasta pessoal (${pastaPessoal}).`);
    }
    let atual = dirname(caminhoAbsoluto);
    while (atual && atual !== dirname(atual)) {
      if (existsSync(atual)) {
        if (lstatSync(atual).isSymbolicLink()) {
          throw new Error("Links simbólicos não são permitidos como pasta do vault.");
        }
        const real = realpathSync(atual);
        if (!dentroDaHome(real)) {
          throw new Error(`A pasta do vault deve estar dentro da sua pasta pessoal (${pastaPessoal}).`);
        }
        break;
      }
      atual = dirname(atual);
    }
    throw new Error("Esta pasta ainda não é um cofre do Anvilore.");
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

  const temSchema = existsSync(join(caminhoAbsoluto, "SCHEMA.md"));
  const temAgents = existsSync(join(caminhoAbsoluto, "AGENTS.md"));
  const caminhoWikiDir = join(caminhoAbsoluto, "wiki");
  const temWiki = existsSync(caminhoWikiDir) && statSync(caminhoWikiDir).isDirectory();
  if (temSchema && temAgents && temWiki) {
    return caminhoAbsoluto;
  }

  throw new Error("Esta pasta ainda não é um cofre do Anvilore.");
}

export async function inspecionarPasta(
  pasta: string,
  ambiente: Record<string, string | undefined> = process.env,
): Promise<InspecaoPasta> {
  const caminho = resolve(pasta);
  const caminhoDaWiki = caminhoWiki(caminho, ambiente);
  const caminhoDoRaw = join(caminho, "raw");

  let wikiExiste = false;
  let wikiDetalhe = "não encontrada";
  let totalAreas = 0;
  try {
    if (existsSync(caminhoDaWiki)) {
      wikiExiste = true;
      const areas = await areasDaWiki(caminhoDaWiki);
      totalAreas = areas.length;
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

  const wikiPronta = wikiExiste && contratosExiste && totalAreas > 0;

  return {
    wiki: { existe: wikiExiste, detalhe: wikiDetalhe },
    raw: { existe: rawExiste, detalhe: rawDetalhe },
    contratos: { existe: contratosExiste, detalhe: contratosDetalhe },
    bun: { existe: bunExiste, detalhe: bunDetalhe },
    wikiPronta,
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
  let temArquivoOnboarding = false;
  let concluido = false;
  let etapaSalva: number | undefined;
  const caminhoOnboardingJson = join(raiz, ".anvilore", "onboarding.json");
  try {
    const dados = JSON.parse(await readFile(caminhoOnboardingJson, "utf8")) as Record<string, unknown>;
    temArquivoOnboarding = true;
    if (dados.concluido === true) concluido = true;
    if (typeof dados.etapa === "number") etapaSalva = dados.etapa;
  } catch {
    /* onboarding.json não existe */
  }

  const wiki = caminhoWiki(raiz, ambiente);
  const areasExistentes = await areasDaWiki(wiki);
  const temExemplo = existsSync(join(wiki, "exemplo"));
  const caminhoIdentidade = join(raiz, ".anvilore", "identidade");
  const temIdentidade = existsSync(caminhoIdentidade);
  const temSchema = existsSync(join(raiz, "SCHEMA.md"));

  let precisaOnboarding: boolean;
  if (temArquivoOnboarding) {
    // Com o arquivo de onboarding presente ({ concluido: false }), continua até o O4
    precisaOnboarding = !concluido;
  } else {
    // Sem o arquivo e com a wiki pronta (instalação antiga), o onboarding não aparece
    const wikiPronta = temIdentidade || areasExistentes.length > 0;
    precisaOnboarding = !wikiPronta;
    if (!precisaOnboarding) concluido = true;
  }

  const etapa = typeof etapaSalva === "number" ? etapaSalva : (areasExistentes.length > 0 ? 4 : 1);

  const inspecao = await inspecionarPasta(raiz, ambiente);

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

  let travas: Array<{ nome: string; ligada: boolean; opcional?: boolean; detalhe?: string }> = [];
  try {
    const diag = await diagnosticar(raiz, ambiente);
    travas = diag.travas.map(t => ({
      nome: t.nome,
      ligada: t.ligada,
      opcional: t.opcional,
      detalhe: t.detalhe,
    }));
  } catch {
    /* doctor falhou */
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
      travas,
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

export function removerSecaoExemploDoIndice(conteudo: string): string {
  const linhas = conteudo.split(/\r?\n/);
  const resultado: string[] = [];
  let dentroDaSecaoExemplo = false;

  for (const linha of linhas) {
    if (/^##\s+[AÁaá]rea:\s*exemplo\b/i.test(linha.trim())) {
      dentroDaSecaoExemplo = true;
      continue;
    }

    if (dentroDaSecaoExemplo) {
      if (/^#{1,2}\s+/.test(linha.trim())) {
        dentroDaSecaoExemplo = false;
      } else {
        continue;
      }
    }

    if (/^\s*-\s*\[\[exemplo[\/|\]]/i.test(linha.trim())) {
      continue;
    }

    resultado.push(linha);
  }

  const texto = resultado.join("\n");
  return texto.replace(/\n{3,}/g, "\n\n").trimEnd() + (conteudo.endsWith("\n") ? "\n" : "");
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
        const indiceAtualizado = removerSecaoExemploDoIndice(conteudo);
        await writeFile(caminhoIndice, indiceAtualizado, "utf8");
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
