#!/usr/bin/env python3
"""Varre a wiki atrás dos cinco problemas estruturais e imprime um relatório.

`scripts/validar-wiki.sh` cobra **invariantes**: o que estiver errado reprova o
repositório. Esta varredura é outra coisa — ela levanta **dívida de
navegação**: página que ninguém alcança, página fora do índice, link que aponta
para o vazio, frontmatter pela metade, página que nunca foi escrita. Nada disso
é ilegal sob o `SCHEMA.md`; é só uma wiki ficando menos útil em silêncio.

É a metade determinística da skill `lint`. A outra metade — decidir o que fazer
com cada achado — é de quem cura, e está em `skills/lint/SKILL.md`.

Uso:
    python3 scripts/auditar-wiki.py [WIKI]

Saída: 0 quando não há nenhum achado, 1 quando há, 2 quando a wiki não existe.
Nunca escreve: o relatório vai para a saída padrão e mais nada acontece.

O levantamento dos callouts `[!gap]`/`[!contradiction]` **não** está aqui — ele
já tem dono, `scripts/listar-lacunas.py`, e a skill chama os dois.

Adaptações ao anvilore (a origem assumia um índice por assunto e uma camada de
páginas que este repositório não tem):
  - O índice é um só: `wiki/index.md`. Uma página está indexada quando o índice
    a referencia por `[[slug]]`, no layout plano ou no layout por área.
  - Os dois únicos callouts do `SCHEMA.md` são `[!gap]` e `[!contradiction]`.
    A origem tinha outros, e os passos que dependiam deles não têm o que
    varrer aqui.
  - Diretório reservado (`_meta/`, `log/`) guarda infra gerada, não página:
    fica de fora da varredura inteira. A lista tem dono em
    `scripts/lib-anvilore.sh`; ela aparece aqui porque um script Python não
    chama uma função bash.
"""
from __future__ import annotations

import argparse
import datetime
import re
import sys
from pathlib import Path

# Ver `scripts/lib-anvilore.sh` (`nome_reservado`): infra da wiki, não página.
DIRS_RESERVADOS = {"_meta", "log"}

# Arquivos de navegação: existem em toda wiki e não têm frontmatter de página.
BASENAMES_DE_NAVEGACAO = {"index.md", "log.md"}

NOME_DO_INDICE = "index.md"

# Menos que isto depois do frontmatter é uma página que nunca foi escrita.
MIN_LINHAS_DE_CORPO = 3

CAMPOS_COMUNS = ("title", "slug", "type", "tags")
CAMPOS_POR_TIPO = {
    "source": ("original_file", "date_ingested", "authors"),
    "concept": ("related_sources", "related_concepts"),
    "entity": ("related_sources", "related_concepts"),
}

WIKILINK_RE = re.compile(r"\[\[([^\]\n]+)\]\]")
CAMPO_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)\s*:")


def alvos_de(texto: str) -> list[str]:
    """Slugs referenciados por `[[...]]`, sem apelido (`|`) nem âncora (`#`)."""
    alvos = []
    for bruto in WIKILINK_RE.findall(texto):
        alvo = bruto.split("|")[0].split("#")[0].strip()
        if alvo:
            alvos.append(alvo)
    return alvos


def separar_frontmatter(texto: str) -> tuple[list[str] | None, list[str]]:
    """Devolve (linhas do frontmatter, linhas do corpo).

    Frontmatter é `None` quando o arquivo não abre com `---` ou quando o
    delimitador de fechamento nunca aparece — nos dois casos não há contrato a
    conferir, e o corpo inteiro conta como corpo.
    """
    linhas = texto.splitlines()
    if not linhas or linhas[0].strip() != "---":
        return None, linhas
    for i in range(1, len(linhas)):
        if linhas[i].strip() == "---":
            return linhas[1:i], linhas[i + 1:]
    return None, linhas


def campos_declarados(frontmatter: list[str]) -> dict[str, str]:
    campos: dict[str, str] = {}
    for linha in frontmatter:
        casou = CAMPO_RE.match(linha)
        if casou:
            campos.setdefault(casou.group(1), linha.split(":", 1)[1].strip())
    return campos


def e_pagina(caminho: Path, wiki: Path) -> bool:
    partes = caminho.relative_to(wiki).parts
    if any(parte in DIRS_RESERVADOS for parte in partes[:-1]):
        return False
    return caminho.name not in BASENAMES_DE_NAVEGACAO


class Pagina:
    def __init__(self, caminho: Path, wiki: Path) -> None:
        self.caminho = caminho
        self.rel = caminho.relative_to(wiki).as_posix()
        self.slug = caminho.stem
        self.texto = caminho.read_text(encoding="utf-8", errors="replace")
        self.frontmatter, corpo = separar_frontmatter(self.texto)
        self.campos = campos_declarados(self.frontmatter) if self.frontmatter is not None else {}
        self.linhas_de_corpo = sum(1 for linha in corpo if linha.strip())
        self.alvos = alvos_de(self.texto)


def campos_ausentes(pagina: Pagina) -> list[str]:
    exigidos = list(CAMPOS_COMUNS)
    tipo = pagina.campos.get("type", "")
    exigidos += list(CAMPOS_POR_TIPO.get(tipo, ()))
    return [campo for campo in exigidos if campo not in pagina.campos]


def auditar(wiki: Path) -> dict[str, list[str]]:
    paginas = [
        Pagina(caminho, wiki)
        for caminho in sorted(wiki.rglob("*.md"))
        if e_pagina(caminho, wiki)
    ]
    slugs = {pagina.slug for pagina in paginas}

    indice = wiki / NOME_DO_INDICE
    texto_do_indice = indice.read_text(encoding="utf-8", errors="replace") if indice.is_file() else ""
    indexados = set(alvos_de(texto_do_indice))

    # Quem aponta para quem. O índice fica de fora de propósito: uma página só
    # alcançável pelo índice é exatamente a definição de órfã.
    entradas: dict[str, int] = {}
    for pagina in paginas:
        for alvo in set(pagina.alvos):
            if alvo != pagina.slug:
                entradas[alvo] = entradas.get(alvo, 0) + 1

    orfas = [
        f"- {pagina.caminho} — listada no índice, sem wikilink de nenhuma outra página"
        for pagina in paginas
        if pagina.slug in indexados and entradas.get(pagina.slug, 0) == 0
    ]

    ausentes_do_indice = [
        f"- {pagina.caminho} — não aparece em {indice}"
        for pagina in paginas
        if pagina.slug not in indexados
    ]

    quebrados = []
    fontes_de_link: list[tuple[str, str]] = [(str(pagina.caminho), alvo) for pagina in paginas for alvo in pagina.alvos]
    fontes_de_link += [(str(indice), alvo) for alvo in alvos_de(texto_do_indice)]
    for origem, alvo in fontes_de_link:
        if alvo not in slugs:
            linha = f"- {origem} → [[{alvo}]] não corresponde a nenhuma página"
            if linha not in quebrados:
                quebrados.append(linha)

    incompletos = []
    for pagina in paginas:
        if pagina.frontmatter is None:
            incompletos.append(f"- {pagina.caminho} — sem frontmatter")
            continue
        faltando = campos_ausentes(pagina)
        if faltando:
            rotulo = "campo ausente" if len(faltando) == 1 else "campos ausentes"
            incompletos.append(f"- {pagina.caminho} — {rotulo}: {', '.join(faltando)}")

    esbocos = [
        f"- {pagina.caminho} — {pagina.linhas_de_corpo} linha(s) de corpo "
        f"(mínimo {MIN_LINHAS_DE_CORPO})"
        for pagina in paginas
        if pagina.frontmatter is not None and pagina.linhas_de_corpo < MIN_LINHAS_DE_CORPO
    ]

    return {
        "Páginas órfãs": orfas,
        "Entradas ausentes do índice": ausentes_do_indice,
        "Wikilinks quebrados": quebrados,
        "Frontmatter incompleto": incompletos,
        "Páginas vazias ou esboço": esbocos,
    }


def render(achados: dict[str, list[str]], wiki: Path, hoje: str) -> str:
    saida = [f"# Auditoria estrutural de {wiki} — {hoje}", ""]
    for titulo, itens in achados.items():
        saida.append(f"## {titulo} ({len(itens)})")
        saida.append("")
        saida += itens if itens else ["_nenhum._"]
        saida.append("")
    total = sum(len(itens) for itens in achados.values())
    saida.append(f"Total: {total} achado(s) estrutural(is).")
    saida.append(
        "A dívida declarada (`[!gap]`, `[!contradiction]`) tem outro dono: "
        "`python3 scripts/listar-lacunas.py <wiki> --consultar`."
    )
    return "\n".join(saida) + "\n"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Varre a wiki atrás de problemas estruturais.")
    p.add_argument("wiki", nargs="?", default="wiki", help="raiz da wiki (padrão: wiki)")
    args = p.parse_args(argv)

    wiki = Path(args.wiki)
    if not wiki.is_dir():
        print(f"erro: wiki não encontrada: {wiki}", file=sys.stderr)
        return 2

    achados = auditar(wiki)
    print(render(achados, wiki, datetime.date.today().isoformat()), end="")
    return 1 if any(achados.values()) else 0


if __name__ == "__main__":
    raise SystemExit(main())

# Este script é obra derivada de `wiki-wonka`
# (https://github.com/cooperacode/wiki-wonka) (Coopera Code, licença MIT),
# traduzido para português do Brasil e adaptado. Aviso de copyright original
# em `LICENSE`.
