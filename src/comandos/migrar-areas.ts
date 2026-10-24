import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rmdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { normalizarFimDeLinha } from "../lib/caminhos";
import { nomeReservado } from "../lib/reservados";

// Move páginas para as áreas conforme um mapa de roteamento e injeta `area:` no frontmatter.
//
// O mapa mora em `<WIKI>/_meta/migration-routing.md`, numa tabela markdown entre ROUTING-START e
// ROUTING-END, e é do dono da wiki: roteamento é conteúdo, não método.
//
//   | page                  | area       |
//   | nome-da-pagina        | area-alvo  |
//   | sources/outra-pagina  | outra-area |
//
// Página que já está no destino (migração repetida) não é erro: só se garante o `area:`, sem duplicar.
// A limpeza tenta remover cada diretório de topo que não seja reservado; só remove diretório vazio, e
// `nomeReservado` é o dono único da lista (`_meta/` e `log/` sobrevivem vazios, são esqueleto).

export class ErroDeMigracao extends Error {}

export type ResultadoDaMigracao = {
  movidas: string[];
  jaMigradas: string[];
  ausentes: string[];
  conflitos: string[];
  falhas: string[];
  avisos: string[];
  relato: string[];
};

// Cabeçalho `| page | area |` e página chamada `page` ficam de fora; a linha separadora (`|---|---|`)
// também casaria o padrão de slug, por isso é excluída antes, e não por acidente do regex.
const SEPARADORA = /^\|[ :|-]*$/;
const LINHA_DE_PAGINA = /^\| *([a-z0-9-]+\/)*[a-z0-9-]+ *\|/;
const CABECALHO = /^\| *page *\|/;

function linhasDoMapa(texto: string): string[] {
  const linhas: string[] = [];
  let dentro = false;
  for (const linha of normalizarFimDeLinha(texto).split("\n")) {
    if (!dentro) {
      if (!linha.includes("ROUTING-START")) continue;
      dentro = true;
      linhas.push(linha);
    } else {
      linhas.push(linha);
      if (linha.includes("ROUTING-END")) dentro = false;
    }
  }
  return linhas;
}

// A área é caminho relativo à wiki: segmento vazio, `.`/`..`, barra invertida ou `:` a fariam escapar dela.
function areaValida(area: string): boolean {
  if (/[\\:]/.test(area)) return false;
  return area.split("/").every((segmento) => segmento !== "" && segmento !== "." && segmento !== "..");
}

function lerMapa(texto: string): { pagina: string; area: string }[] {
  const entradas: { pagina: string; area: string }[] = [];
  for (const linha of linhasDoMapa(texto)) {
    if (SEPARADORA.test(linha) || !LINHA_DE_PAGINA.test(linha) || CABECALHO.test(linha)) continue;
    const campos = linha.split("|");
    const pagina = campos[1]!.trim();
    const area = (campos[2] ?? "").trim();
    if (pagina === "" || area === "") continue;
    if (!areaValida(area)) throw new ErroDeMigracao(`área inválida no mapa: ${area} (página ${pagina})`);
    entradas.push({ pagina, area });
  }
  return entradas;
}

// Injeta `area: <area>` logo após a primeira linha `type: `. Não duplica se já existir um `area: `.
async function injetarArea(arquivo: string, area: string): Promise<void> {
  const linhas = (await readFile(arquivo, "utf8")).split("\n");
  if (linhas.some((linha) => linha.startsWith("area: "))) return;
  const i = linhas.findIndex((linha) => linha.startsWith("type: "));
  if (i === -1) return;
  const fim = linhas[i]!.endsWith("\r") ? "\r" : "";
  linhas.splice(i + 1, 0, `area: ${area}${fim}`);
  await writeFile(arquivo, linhas.join("\n"));
}

function ehArquivo(caminho: string): boolean {
  try {
    return statSync(caminho).isFile();
  } catch {
    return false;
  }
}

function ehLinkQuebrado(caminho: string): boolean {
  try {
    return lstatSync(caminho).isSymbolicLink() && !existsSync(caminho);
  } catch {
    return false;
  }
}

function dentroDe(raizReal: string, caminhoReal: string): boolean {
  const rel = relative(raizReal, caminhoReal);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// Página (origem ou destino) que é symlink para fora da wiki: injetar `area:` nela escreveria fora da wiki.
function garantirDentroDaWiki(raizReal: string, caminho: string, pagina: string): void {
  if (!dentroDe(raizReal, realpathSync(caminho))) {
    throw new ErroDeMigracao(`${pagina} é link simbólico para fora da wiki: ${caminho}`);
  }
}

// Segue os segmentos que já existem: um link no caminho da área que aponte para fora da wiki (ou para lugar
// nenhum) levaria a página para fora dela. O que ainda não existe será criado como diretório comum.
function areaSaiDaWiki(raiz: string, area: string): boolean {
  const raizReal = realpathSync(raiz);
  let atual = raiz;
  for (const segmento of area.split("/")) {
    atual = join(atual, segmento);
    try {
      lstatSync(atual);
    } catch {
      return false;
    }
    try {
      if (!dentroDe(raizReal, realpathSync(atual))) return true;
    } catch {
      return true;
    }
  }
  return false;
}

// `git mv` quando a pasta é um repositório e a página é versionada; qualquer falha (fora de repositório,
// página não versionada, git ausente) cai para o rename.
async function moverArquivo(wiki: string, origem: string, destino: string): Promise<void> {
  try {
    const git = Bun.spawn(["git", "-C", wiki, "mv", origem, destino], { stdout: "ignore", stderr: "ignore" });
    if ((await git.exited) === 0) return;
  } catch {
    // git indisponível: segue para o rename
  }
  await rename(origem, destino);
}

async function limparDiretoriosVazios(wiki: string, avisos: string[]): Promise<void> {
  for (const entrada of await readdir(wiki, { withFileTypes: true })) {
    if (entrada.name.startsWith(".")) continue;
    if (entrada.isSymbolicLink()) {
      if (ehLinkQuebrado(join(wiki, entrada.name))) avisos.push(`link quebrado: ${join(wiki, entrada.name)}`);
      continue;
    }
    if (!entrada.isDirectory() || nomeReservado(entrada.name)) continue;
    try {
      await rmdir(join(wiki, entrada.name));
    } catch {
      // diretório não vazio: fica
    }
  }
}

export async function migrarAreas(wiki: string, opcoes: { simular?: boolean } = {}): Promise<ResultadoDaMigracao> {
  const simular = opcoes.simular === true;
  // Caminho vazio resolveria para o diretório atual; o original lia `/_meta/...` e reprovava.
  if (wiki === "") throw new ErroDeMigracao(`mapa de roteamento ausente: /_meta/migration-routing.md`);
  const raiz = resolve(wiki);
  const caminhoDoMapa = join(wiki, "_meta", "migration-routing.md");
  if (!ehArquivo(caminhoDoMapa)) throw new ErroDeMigracao(`mapa de roteamento ausente: ${caminhoDoMapa}`);

  const texto = await readFile(caminhoDoMapa, "utf8");
  const resultado: ResultadoDaMigracao = {
    movidas: [],
    jaMigradas: [],
    ausentes: [],
    conflitos: [],
    falhas: [],
    avisos: [],
    relato: [],
  };
  if (!texto.includes("ROUTING-START")) {
    resultado.avisos.push(`o mapa não tem os marcadores ROUTING-START e ROUTING-END: ${caminhoDoMapa}`);
  }

  const entradas = lerMapa(texto);
  for (const { pagina, area } of entradas) {
    if (areaSaiDaWiki(raiz, area)) {
      throw new ErroDeMigracao(`área sai da wiki por link simbólico: ${area} (página ${pagina})`);
    }
  }

  const raizReal = realpathSync(raiz);
  for (const { pagina, area } of entradas) {
    const origem = join(raiz, `${pagina}.md`);
    const destino = join(raiz, area, `${pagina}.md`);
    const rotulo = `${pagina} → ${area}/${pagina}`;

    try {
      if (!ehArquivo(origem)) {
        for (const caminho of [origem, destino]) {
          if (ehLinkQuebrado(caminho)) resultado.avisos.push(`link quebrado: ${caminho}`);
        }
        if (ehArquivo(destino)) {
          garantirDentroDaWiki(raizReal, destino, pagina);
          if (!simular) await injetarArea(destino, area);
          resultado.relato.push(`ja migrada: ${rotulo}`);
          resultado.jaMigradas.push(pagina);
        } else {
          resultado.relato.push(`ausente (nem na origem nem no destino): ${pagina}`);
          resultado.ausentes.push(pagina);
        }
        continue;
      }
      garantirDentroDaWiki(raizReal, origem, pagina);
      // Nunca sobrescreve: origem e destino ao mesmo tempo é decisão de gente (link quebrado também ocupa o nome).
      if (existsSync(destino) || ehLinkQuebrado(destino)) {
        resultado.relato.push(`conflito (origem e destino existem, nada foi movido): ${rotulo}`);
        resultado.conflitos.push(pagina);
        continue;
      }
      if (simular) {
        resultado.relato.push(`moveria: ${rotulo}`);
        resultado.movidas.push(pagina);
        continue;
      }
      await mkdir(dirname(destino), { recursive: true });
      await moverArquivo(raiz, origem, destino);
      resultado.movidas.push(pagina);
      await injetarArea(destino, area);
      resultado.relato.push(`movida: ${rotulo}`);
    } catch (erro) {
      // Para na primeira falha: o que já foi movido fica relatado, e o resto do mapa não é tocado.
      resultado.falhas.push(`${pagina}: ${(erro as Error).message}`);
      break;
    }
  }

  if (!simular && resultado.falhas.length === 0) await limparDiretoriosVazios(raiz, resultado.avisos);
  return resultado;
}

export async function comandoMigrarAreas(args: string[]): Promise<number> {
  let wiki = "wiki";
  let simular = false;
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      console.error("Uso: anvilore migrar-areas [WIKI] [--simular]");
      return 2;
    }
    if (arg === "--simular" || arg === "--dry-run") simular = true;
    else if (arg.startsWith("-")) {
      console.error(`FAIL: flag desconhecida: ${arg}`);
      return 1;
    } else wiki = arg.replace(/\/$/, "");
  }

  try {
    const r = await migrarAreas(wiki, { simular });
    for (const aviso of r.avisos) console.error(`AVISO: ${aviso}`);
    for (const linha of r.relato) console.log(linha);
    const conflitos = r.conflitos.length > 0 ? `, ${r.conflitos.length} conflito(s)` : "";
    const falhas = r.falhas.length > 0 ? `, ${r.falhas.length} falha(s)` : "";
    const resumo = `${r.movidas.length} ${simular ? "moveria(m)" : "movida(s)"}, ${r.jaMigradas.length} ja migrada(s), ${r.ausentes.length} ausente(s)${conflitos}${falhas}`;
    console.log(`${simular ? "MIGRACAO (simulacao)" : "MIGRACAO"}: ${resumo}`);
    for (const falha of r.falhas) {
      console.error(`FAIL: ${falha}; já movidas: ${r.movidas.join(", ") || "nenhuma"}`);
    }
    return r.conflitos.length > 0 || r.falhas.length > 0 ? 1 : 0;
  } catch (erro) {
    if (!(erro instanceof ErroDeMigracao)) throw erro;
    console.error(`FAIL: ${erro.message}`);
    return 1;
  }
}

// Este módulo é obra derivada de `wiki-wonka`
// (https://github.com/cooperacode/wiki-wonka) (Coopera Code, licença MIT),
// traduzido para português do Brasil e adaptado. Aviso de copyright original
// em `LICENSE`.
