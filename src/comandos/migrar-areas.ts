import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rmdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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

async function limparDiretoriosVazios(wiki: string): Promise<void> {
  for (const entrada of await readdir(wiki, { withFileTypes: true })) {
    if (!entrada.isDirectory() || entrada.name.startsWith(".") || nomeReservado(entrada.name)) continue;
    try {
      await rmdir(join(wiki, entrada.name));
    } catch {
      // diretório não vazio: fica
    }
  }
}

export async function migrarAreas(wiki: string, opcoes: { simular?: boolean } = {}): Promise<ResultadoDaMigracao> {
  const simular = opcoes.simular === true;
  const caminhoDoMapa = join(wiki, "_meta", "migration-routing.md");
  if (!ehArquivo(caminhoDoMapa)) throw new ErroDeMigracao(`mapa de roteamento ausente: ${caminhoDoMapa}`);

  const texto = await readFile(caminhoDoMapa, "utf8");
  const resultado: ResultadoDaMigracao = {
    movidas: [],
    jaMigradas: [],
    ausentes: [],
    conflitos: [],
    avisos: [],
    relato: [],
  };
  if (!texto.includes("ROUTING-START")) {
    resultado.avisos.push(`o mapa não tem os marcadores ROUTING-START e ROUTING-END: ${caminhoDoMapa}`);
  }

  const raiz = resolve(wiki);
  for (const { pagina, area } of lerMapa(texto)) {
    const origem = join(raiz, `${pagina}.md`);
    const destino = join(raiz, area, `${pagina}.md`);
    const rotulo = `${pagina} → ${area}/${pagina}`;

    if (!ehArquivo(origem)) {
      if (ehArquivo(destino)) {
        if (!simular) await injetarArea(destino, area);
        resultado.relato.push(`ja migrada: ${rotulo}`);
        resultado.jaMigradas.push(pagina);
      } else {
        resultado.relato.push(`ausente (nem na origem nem no destino): ${pagina}`);
        resultado.ausentes.push(pagina);
      }
      continue;
    }
    // Nunca sobrescreve: origem e destino ao mesmo tempo é decisão de gente.
    if (existsSync(destino)) {
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
    await injetarArea(destino, area);
    resultado.relato.push(`movida: ${rotulo}`);
    resultado.movidas.push(pagina);
  }

  if (!simular) await limparDiretoriosVazios(wiki);
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
    const resumo = `${r.movidas.length} ${simular ? "moveria(m)" : "movida(s)"}, ${r.jaMigradas.length} ja migrada(s), ${r.ausentes.length} ausente(s)${conflitos}`;
    console.log(`${simular ? "MIGRACAO (simulacao)" : "MIGRACAO"}: ${resumo}`);
    return r.conflitos.length > 0 ? 1 : 0;
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
