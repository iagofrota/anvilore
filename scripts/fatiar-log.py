#!/usr/bin/env python3
"""Fatia `<WIKI>/log.md` em um arquivo por dia sob `<WIKI>/log/`.

**Migração one-shot.** Roda uma única vez numa wiki; fica no repositório depois
disso como registro de como a migração foi feita. Não apaga nem sobrescreve
nada: se um arquivo de destino já existir, aborta antes de escrever a primeira
linha. Isso não é um defeito — uma migração que se repete é uma migração que
pode corromper o que já migrou. O critério de idempotência aqui é a RECUSA, não
a saída repetida.

Uso:
    python3 scripts/fatiar-log.py [WIKI]

Adaptação ao anvilore: a origem abortava com "conteúdo antes da primeira
entrada". O `wiki/log.md` que vem no clone do anvilore abre com `# Log` e uma
linha de prosa, então abortar ali tornaria o script inútil justamente na wiki
para a qual ele foi portado. Aqui o preâmbulo anterior à primeira entrada é
tolerado — e **relatado em voz alta**, com a contagem de linhas, porque
conteúdo que não vai para lugar nenhum não pode sair de cena calado. Esse
cabeçalho é regenerado por `scripts/indexar-log.sh` depois da migração.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

HEADER_NOVO = re.compile(r"^## \[(\d{4}-\d{2}-\d{2})\] .+$")
HEADER_ANTIGO = re.compile(r"^## (\d{4}-\d{2}-\d{2}) — (.+)$")

Entrada = tuple[str, str, list[str]]  # (data, header normalizado, linhas do corpo)


def parse(texto: str) -> tuple[list[Entrada], int]:
    """Fatia o log em entradas, na ordem em que aparecem no arquivo.

    Devolve (entradas, linhas de preâmbulo descartadas).

    Consciente de code fence: dentro de um bloco ``` uma linha `## ` é
    conteúdo, não header. Header em formato antigo (`## DATA — Título`) vira
    `## [DATA] note | Título` — `note` porque essas entradas não declaram tipo.
    """
    entradas: list[Entrada] = []
    dentro_de_fence = False
    preambulo = 0
    for numero, linha in enumerate(texto.split("\n"), start=1):
        if linha.startswith("```"):
            dentro_de_fence = not dentro_de_fence
        elif not dentro_de_fence and linha.startswith("## "):
            if HEADER_NOVO.match(linha):
                entradas.append((linha[4:14], linha, []))
                continue
            antigo = HEADER_ANTIGO.match(linha)
            if antigo:
                header = f"## [{antigo.group(1)}] note | {antigo.group(2)}"
                entradas.append((antigo.group(1), header, []))
                continue
            sys.exit(f"ERRO: header sem data parseável na linha {numero}: {linha}")
        if not entradas:
            if linha.strip():
                preambulo += 1
            continue
        entradas[-1][2].append(linha)
    return entradas, preambulo


def render(data: str, entradas: list[Entrada]) -> str:
    """Monta o arquivo do dia. Corpo preservado linha a linha, sem sobra em branco no fim."""
    blocos = []
    for _, header, corpo in entradas:
        aparado = list(corpo)
        while aparado and not aparado[-1].strip():
            aparado.pop()
        blocos.append("\n".join([header] + aparado))
    cabecalho = f"---\ntype: log-day\ndate: {data}\n---\n\n# Log — {data}\n\n"
    return cabecalho + "\n\n".join(blocos) + "\n"


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    wiki = Path(args[0]) if args else Path("wiki")
    origem = wiki / "log.md"
    if not origem.is_file():
        sys.exit(f"ERRO: {origem} não existe")

    entradas, preambulo = parse(origem.read_text(encoding="utf-8"))
    if not entradas:
        sys.exit(f"ERRO: nenhuma entrada encontrada em {origem}")

    por_data: dict[str, list[Entrada]] = {}
    for entrada in entradas:
        por_data.setdefault(entrada[0], []).append(entrada)

    agrupadas = sum(len(v) for v in por_data.values())
    if agrupadas != len(entradas):
        sys.exit(f"ERRO: lidas {len(entradas)} entradas, agrupadas {agrupadas}")

    destino_dir = wiki / "log"
    destinos = {d: destino_dir / f"log-{d}.md" for d in por_data}
    existentes = sorted(str(p) for p in destinos.values() if p.exists())
    if existentes:
        sys.exit(
            "ERRO: destino já existe, nada foi escrito (migração one-shot): "
            + ", ".join(existentes)
        )

    destino_dir.mkdir(parents=True, exist_ok=True)
    for data, grupo in por_data.items():
        destinos[data].write_text(render(data, grupo), encoding="utf-8")

    print(f"OK: {len(entradas)} entradas → {len(por_data)} arquivos em {destino_dir}")
    if preambulo:
        print(
            f"AVISO: {preambulo} linha(s) de preâmbulo antes da primeira entrada não "
            f"foram para nenhum arquivo de dia. {origem} continua intacto; o cabeçalho "
            "de log.md é regenerado por scripts/indexar-log.sh."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

# Este script é obra derivada de `wiki-wonka`
# (https://github.com/cooperacode/wiki-wonka) (Coopera Code, licença MIT),
# traduzido para português do Brasil e adaptado. Aviso de copyright original
# em `LICENSE`.
