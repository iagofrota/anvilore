#!/usr/bin/env python3
"""Extrai os callouts abertos da wiki e gera o índice em `_meta/lacunas.md`.

Um `> [!gap]` é uma lacuna de conhecimento que quem cura declarou e ainda não
fechou; um `> [!contradiction]` é um desacordo entre fontes que ninguém
resolveu. Espalhados por dezenas de páginas eles são invisíveis; reunidos num
índice viram a pauta da próxima ingestão.

Uso:
    python3 scripts/listar-lacunas.py [WIKI] [--stdout] [--tipos gap,contradiction]

Modo consulta (`--consultar`, `--area`, `--buscar`, `--limite`): em vez de
reescrever o índice, devolve uma linha `caminho.md:linha [tipo] texto` por
callout que casa — e **não toca em `_meta/`**:

    python3 scripts/listar-lacunas.py wiki --consultar --tipos contradiction
    python3 scripts/listar-lacunas.py wiki --area exemplo --limite 5
    python3 scripts/listar-lacunas.py wiki --buscar "definição"

Adaptações ao anvilore (a origem indexava só `gap` e assumia que todo primeiro
componente de caminho era uma área):
  - Os dois tipos do `SCHEMA.md` entram por padrão. Uma contradição aberta é
    dívida de conhecimento tanto quanto uma lacuna.
  - O primeiro componente do caminho só é área se não for um diretório
    reservado (`_meta`, `log`) nem um diretório de tipo do layout plano
    (`sources`, `concepts`, `entities`). Numa wiki plana a página cai em
    `(raiz)` em vez de inventar uma área chamada "concepts".
  - O frontmatter gerado não declara `type:` — o vocabulário de `type` do
    `SCHEMA.md` é `source|concept|entity`, e um índice gerado não é nenhum dos
    três. `_meta/` é diretório reservado, então o validador não o cobra.
"""
from __future__ import annotations

import argparse
import datetime
import re
import sys
import unicodedata
from pathlib import Path

DIR_META = "_meta"
SAIDA = "lacunas.md"
TIPOS_PADRAO = ["gap", "contradiction"]

# Estas duas listas têm um dono: `scripts/lib-anvilore.sh` (`nome_reservado` e
# `nome_tipo_diretorio`). Elas aparecem aqui porque um script Python não pode
# chamar uma função bash, não porque haja duas fontes de verdade —
# `tests/test-listar-lacunas.sh` cobra que as duas não divirjam.
DIRS_RESERVADOS = {"_meta", "log"}
DIRS_DE_TIPO = {"sources", "concepts", "entities"}

SEM_AREA = "(raiz)"

# `> [!gap]` ou `> [!gap] texto na mesma linha`. Exige o `>` no início da linha:
# um `[!gap]` citado no meio da prosa é menção, não callout aberto.
CALLOUT_RE = re.compile(r"^>\s*\[!(?P<tipo>[a-z]+)\]\s?(?P<resto>.*)$")
CITACAO_RE = re.compile(r"^>\s?(?P<resto>.*)$")


def extrair_callouts(texto: str, tipos: list[str]) -> list[tuple[int, str, str]]:
    """Devolve (linha, tipo, texto) de cada callout dos tipos pedidos.

    O corpo continua nas linhas `>` seguintes até a citação acabar ou outro
    callout começar; as linhas são unidas num parágrafo só.
    """
    achados: list[tuple[int, str, str]] = []
    linhas = texto.splitlines()
    i = 0
    while i < len(linhas):
        casou = CALLOUT_RE.match(linhas[i])
        if not casou:
            i += 1
            continue

        inicio, tipo = i + 1, casou.group("tipo")
        corpo = [casou.group("resto").strip()]
        i += 1
        while i < len(linhas) and not CALLOUT_RE.match(linhas[i]):
            cont = CITACAO_RE.match(linhas[i])
            if not cont:
                break
            corpo.append(cont.group("resto").strip())
            i += 1

        if tipo in tipos:
            paragrafo = " ".join(parte for parte in corpo if parte)
            achados.append((inicio, tipo, re.sub(r"\s+", " ", paragrafo).strip()))
    return achados


def dobrar(texto: str) -> str:
    """Minúsculas sem acento — `definicao` tem que achar `definição`."""
    decomposto = unicodedata.normalize("NFD", texto.lower())
    return "".join(c for c in decomposto if unicodedata.category(c) != "Mn")


def area_de(pagina: Path, wiki: Path) -> str:
    """Área da página = primeiro componente do caminho, quando ele é uma área.

    Diretório reservado e diretório de tipo do layout plano não são áreas: a
    página cai em `(raiz)`. Ver `scripts/lib-anvilore.sh`.
    """
    partes = pagina.relative_to(wiki).parts
    if len(partes) < 2:
        return SEM_AREA
    topo = partes[0]
    if topo in DIRS_RESERVADOS or topo in DIRS_DE_TIPO:
        return SEM_AREA
    return topo


def coletar(wiki: Path, tipos: list[str]) -> dict[str, list[tuple[str, int, str, str, str]]]:
    """Mapeia área -> [(slug, linha, tipo, texto, caminho relativo)]."""
    por_area: dict[str, list[tuple[str, int, str, str, str]]] = {}
    for pagina in sorted(wiki.rglob("*.md")):
        if DIR_META in pagina.relative_to(wiki).parts:
            continue
        callouts = extrair_callouts(pagina.read_text(encoding="utf-8", errors="replace"), tipos)
        if not callouts:
            continue
        area = area_de(pagina, wiki)
        rel = pagina.relative_to(wiki).as_posix()
        for linha, tipo, texto in callouts:
            por_area.setdefault(area, []).append((pagina.stem, linha, tipo, texto, rel))
    return por_area


def consultar(por_area: dict, area: str | None, buscar: str | None, limite: int | None) -> list[str]:
    """Filtra e devolve uma linha endereçada por resultado.

    Formato `caminho.md:linha [tipo] texto` — o endereço vem primeiro porque é
    o que serve para abrir a página no ponto certo, sem ler o índice inteiro.
    """
    agulha = dobrar(buscar) if buscar else None
    achados = []
    for area_da_pagina in sorted(por_area):
        if area and area_da_pagina != area:
            continue
        itens = sorted(por_area[area_da_pagina], key=lambda i: (i[4], i[1]))
        for _slug, linha, tipo, texto, rel in itens:
            if agulha and agulha not in dobrar(texto):
                continue
            achados.append(f"{rel}:{linha} [{tipo}] {texto}")
    return achados[:limite] if limite else achados


def render(por_area: dict, hoje: str) -> str:
    total = sum(len(itens) for itens in por_area.values())
    paginas = len({rel for itens in por_area.values() for *_, rel in itens})

    saida = [
        "---",
        'title: "Lacunas abertas"',
        "slug: lacunas",
        "generated_by: scripts/listar-lacunas.py",
        f"generated_at: {hoje}",
        "---",
        "",
        "# Lacunas abertas",
        "",
        f"_{total} callout(s) aberto(s) em {paginas} página(s). "
        "Gerado por `scripts/listar-lacunas.py` — não edite à mão._",
        "",
        "Cada item é uma dívida de conhecimento que quem cura declarou e ainda "
        "não fechou. Fechar um item = atualizar a página e remover o callout de lá.",
        "",
    ]

    for area in sorted(por_area):
        itens = por_area[area]
        saida += [f"## {area} ({len(itens)})", ""]
        for slug in sorted({slug for slug, *_ in itens}):
            saida.append(f"### [[{slug}]]")
            saida.append("")
            for _slug, linha, tipo, texto, rel in sorted(
                (i for i in itens if i[0] == slug), key=lambda i: (i[4], i[1])
            ):
                saida.append(f"- `{rel}:{linha}` `{tipo}` — {texto}")
            saida.append("")
    return "\n".join(saida).rstrip() + "\n"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Indexa os callouts abertos da wiki.")
    p.add_argument("wiki", nargs="?", default="wiki", help="raiz da wiki (padrão: wiki)")
    p.add_argument("--stdout", action="store_true", help="imprime em vez de escrever o arquivo")
    p.add_argument(
        "--tipos",
        "--types",
        default=",".join(TIPOS_PADRAO),
        help="tipos de callout, separados por vírgula (padrão: gap,contradiction)",
    )
    p.add_argument("--consultar", action="store_true", help="consulta: não escreve o índice")
    p.add_argument("--area", help="consulta: só os callouts desta área")
    p.add_argument("--buscar", "--find", help="consulta: só os callouts cujo texto contém o termo")
    p.add_argument("--limite", "--limit", type=int, help="consulta: no máximo N resultados")
    args = p.parse_args(argv)

    wiki = Path(args.wiki)
    if not wiki.is_dir():
        print(f"erro: wiki não encontrada: {wiki}", file=sys.stderr)
        return 2

    tipos = [t.strip() for t in args.tipos.split(",") if t.strip()]
    hoje = datetime.date.today().isoformat()
    por_area = coletar(wiki, tipos)

    # Modo consulta: devolve endereços, não reescreve o índice.
    if args.consultar or args.area or args.buscar or args.limite:
        achados = consultar(por_area, args.area, args.buscar, args.limite)
        if not achados:
            print("nenhum callout casou com a consulta", file=sys.stderr)
            return 0
        print("\n".join(achados))
        return 0

    relatorio = render(por_area, hoje)

    if args.stdout:
        print(relatorio, end="")
        return 0

    total = sum(len(itens) for itens in por_area.values())
    paginas = len({rel for itens in por_area.values() for *_, rel in itens})
    destino = wiki / DIR_META / SAIDA
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(relatorio, encoding="utf-8")
    print(f"{destino}: {total} callout(s) em {paginas} página(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

# Este script é obra derivada de `wiki-wonka`
# (https://github.com/cooperacode/wiki-wonka) (Coopera Code, licença MIT),
# traduzido para português do Brasil e adaptado. Aviso de copyright original
# em `LICENSE`.
