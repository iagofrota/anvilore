#!/usr/bin/env python3
"""Rejunta parágrafos quebrados à mão (~95-105 colunas) de volta a uma linha só
por parágrafo, item de lista ou blockquote.

Causa do problema: markdown com quebra de linha manual (`\\n` simples, sem os
dois espaços do hard-break do CommonMark) renderiza errado em editores
configurados para quebra de linha estrita, que tratam QUALQUER `\\n` dentro de
um parágrafo como quebra visual. O conteúdo nunca esteve errado — é Markdown
que só um dos dois renderizadores lê "certo".

Preserva intacto: frontmatter YAML, code fences (``` / ~~~), linhas de tabela,
headings, horizontal rules e linhas em branco. Junta apenas: (a) parágrafos de
prosa simples, (b) o texto de um item de lista através de linhas de
continuação sem marcador, (c) o texto de um blockquote/callout através de
linhas de continuação — o que inclui os callouts `[!gap]` e `[!contradiction]`
do `SCHEMA.md`.

Uso:
    python3 scripts/rejuntar-linhas.py <arquivo-ou-diretório> [--simular] [--diff]

--simular: não escreve nada, só relata quais arquivos mudariam.
           (alias aceito: --dry-run)
--diff:    com --simular, imprime o diff unificado de cada arquivo que mudaria.
"""

import argparse
import difflib
import re
import sys
from pathlib import Path

FENCE_RE = re.compile(r"^\s*(```|~~~)")
ITEM_DE_LISTA_RE = re.compile(r"^(\s*(?:[-*+]|\d+\.)\s+)")
BLOCKQUOTE_RE = re.compile(r"^(\s*>+\s?)")
HEADING_RE = re.compile(r"^\s{0,3}#{1,6}(\s|$)")
REGUA_RE = re.compile(r"^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$")
LINHA_DE_TABELA_RE = re.compile(r"^\s*\|.*\|\s*$")
SEPARADOR_DE_TABELA_RE = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$")
EM_BRANCO_RE = re.compile(r"^\s*$")
LINHA_DE_ROTULO_RE = re.compile(r"^[A-ZÀ-Ý][\wÀ-ÿ ]{1,45}:\s\S")
FIM_DE_CONTINUACAO_RE = re.compile(r"[\-–—,:;]\s*$")


def _parece_corte_de_quebra(linha: str) -> bool:
    if linha.count("(") > linha.count(")"):
        return True
    return bool(FIM_DE_CONTINUACAO_RE.search(linha.rstrip()))


def rejuntar(linhas):
    saida = []
    buf = []
    tipo_buf = None  # None | 'para' | 'lista' | 'citacao'

    def descarregar():
        nonlocal buf, tipo_buf
        if not buf:
            tipo_buf = None
            return
        if tipo_buf == "para":
            saida.append(" ".join(l.strip() for l in buf))
        elif tipo_buf == "lista":
            prefixo = ITEM_DE_LISTA_RE.match(buf[0]).group(1)
            resto = buf[0][len(prefixo):].strip()
            cont = " ".join(l.strip() for l in buf[1:])
            saida.append(prefixo + (resto + " " + cont).strip() if cont else prefixo + resto)
        elif tipo_buf == "citacao":
            def sem_prefixo(l):
                casou = BLOCKQUOTE_RE.match(l)
                return l[casou.end():].strip() if casou else l.strip()

            prefixo = BLOCKQUOTE_RE.match(buf[0]).group(1)
            resto = sem_prefixo(buf[0])
            cont = " ".join(sem_prefixo(l) for l in buf[1:])
            saida.append(prefixo + (resto + " " + cont).strip() if cont else prefixo + resto)
        buf = []
        tipo_buf = None

    i = 0
    n = len(linhas)
    em_frontmatter = False
    em_codigo = False
    em_tabela = False

    if n > 0 and linhas[0].rstrip("\n") == "---":
        em_frontmatter = True
        saida.append(linhas[0].rstrip("\n"))
        i = 1

    while i < n:
        linha = linhas[i].rstrip("\n")

        if em_frontmatter:
            saida.append(linha)
            if linha == "---":
                em_frontmatter = False
            i += 1
            continue

        if FENCE_RE.match(linha):
            descarregar()
            saida.append(linha)
            em_codigo = not em_codigo
            i += 1
            continue

        if em_codigo:
            saida.append(linha)
            i += 1
            continue

        if EM_BRANCO_RE.match(linha):
            descarregar()
            saida.append(linha)
            em_tabela = False
            i += 1
            continue

        if LINHA_DE_TABELA_RE.match(linha) or SEPARADOR_DE_TABELA_RE.match(linha) or em_tabela:
            descarregar()
            saida.append(linha)
            em_tabela = True
            i += 1
            continue

        if HEADING_RE.match(linha) or REGUA_RE.match(linha):
            descarregar()
            saida.append(linha)
            i += 1
            continue

        if ITEM_DE_LISTA_RE.match(linha):
            descarregar()
            tipo_buf = "lista"
            buf = [linha]
            i += 1
            continue

        if BLOCKQUOTE_RE.match(linha):
            if tipo_buf == "citacao":
                buf.append(linha)
            else:
                descarregar()
                tipo_buf = "citacao"
                buf = [linha]
            i += 1
            continue

        # "Rótulo: valor" empilhado sem linha em branco (ex.: o bloco de resumo
        # de uma entrada de log) é um campo próprio, não continuação de
        # parágrafo — nunca funde com a linha anterior. Só aceita continuação
        # se a própria linha parecer cortada no meio (parêntese aberto sem
        # fechar, ou terminando em vírgula/hífen/travessão/dois-pontos).
        if tipo_buf in (None, "para") and LINHA_DE_ROTULO_RE.match(linha):
            descarregar()
            if _parece_corte_de_quebra(linha):
                tipo_buf = "para"
                buf = [linha]
            else:
                saida.append(linha)
            i += 1
            continue

        # prosa simples: continua o bloco corrente ou abre um novo parágrafo
        if tipo_buf is None:
            tipo_buf = "para"
            buf = [linha]
        else:
            buf.append(linha)
        i += 1

    descarregar()
    return saida


def processar(caminho: Path, simular: bool, mostrar_diff: bool) -> bool:
    original = caminho.read_text(encoding="utf-8")
    novas = rejuntar(original.splitlines(keepends=True))
    termina_com_quebra = original.endswith("\n")
    novo_texto = "\n".join(novas) + ("\n" if termina_com_quebra else "")

    if novo_texto == original:
        return False

    if simular:
        if mostrar_diff:
            sys.stdout.writelines(
                difflib.unified_diff(
                    original.splitlines(keepends=True),
                    novo_texto.splitlines(keepends=True),
                    fromfile=str(caminho),
                    tofile=str(caminho) + " (rejuntado)",
                )
            )
        return True

    caminho.write_text(novo_texto, encoding="utf-8")
    return True


def main() -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("alvo", help="arquivo .md ou diretório")
    p.add_argument("--simular", "--dry-run", action="store_true", help="não escreve, só relata")
    p.add_argument("--diff", action="store_true", help="com --simular, imprime o diff de cada arquivo afetado")
    args = p.parse_args()

    alvo = Path(args.alvo)
    if not alvo.exists():
        print(f"erro: alvo não encontrado: {alvo}", file=sys.stderr)
        return 2
    arquivos = [alvo] if alvo.is_file() else sorted(alvo.rglob("*.md"))

    mudados = [f for f in arquivos if processar(f, args.simular, args.diff)]

    verbo = "mudariam" if args.simular else "mudaram"
    print(f"\n{len(mudados)}/{len(arquivos)} arquivos {verbo}.", file=sys.stderr)
    if mudados and not args.diff:
        for f in mudados:
            print(f"  {f}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

# Este script é obra derivada de `wiki-wonka`
# (https://github.com/cooperacode/wiki-wonka) (Coopera Code, licença MIT),
# traduzido para português do Brasil e adaptado. Aviso de copyright original
# em `LICENSE`.
