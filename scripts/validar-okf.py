#!/usr/bin/env python3
"""Valida os campos de proveniencia OKF no frontmatter das paginas da wiki.

Chamado por scripts/validar-wiki.sh. Exit 0 = PASS (ou nenhum campo OKF),
exit 1 = FAIL. Imprime linhas FAIL: para campos malformados e linhas METRIC:
para as metricas.

Regras:
- Reprova SOMENTE quando um campo esta PRESENTE e malformado.
- NUNCA reprova pela ausencia de campos OKF — o perfil e opcional.
- Metricas (nunca reprovam): paginas vencidas, paginas modificadas depois da
  ultima verificacao.
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import re

import yaml

ATOR_RE = re.compile(r'^(human:[a-z0-9_-]+|process:[a-z0-9_-]+|[a-z0-9_-]+/[a-z0-9._-]+)$', re.I)
ISO8601_OFFSET_RE = re.compile(r'^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$')

# sources[].resource aceita tres formas (ver o perfil OKF no SCHEMA.md): URL,
# caminho do vault, ou descritor de escopo que nao resolve para arquivo nenhum
# ("todas as sessoes de 2026"). So a segunda tem existencia a checar — dai a
# necessidade de discrimina-las.
URI_SCHEME_RE = re.compile(r'^[a-zA-Z][a-zA-Z0-9+.\-]*:')
EXT_ARQUIVO_RE = re.compile(r'\.[A-Za-z][A-Za-z0-9]{0,7}$')

EXTERNO = 'externo'
CAMINHO_LOCAL = 'caminho-local'
DESCRITOR_ESCOPO = 'descritor-escopo'


def extrair_frontmatter(texto: str) -> dict[str, Any] | None:
    """Extrai o frontmatter YAML do markdown."""
    if not texto.startswith('---'):
        return None
    linhas = texto.split('\n')
    fim = None
    for i, linha in enumerate(linhas[1:], start=1):
        if linha.strip() == '---':
            fim = i
            break
    if fim is None:
        return None
    try:
        return yaml.safe_load('\n'.join(linhas[1:fim]))
    except yaml.YAMLError:
        return None


def validar_ator(valor: str, campo: str, caminho: str) -> str | None:
    """Devolve mensagem de erro se o ator estiver fora da convencao."""
    if not ATOR_RE.match(valor):
        return f"FAIL: {campo} fora da convencao de atores: {caminho} (valor: {valor})"
    return None


def validar_timestamp_com_offset(valor: str, campo: str, caminho: str) -> str | None:
    """Devolve mensagem de erro se o timestamp nao tiver offset explicito."""
    if not ISO8601_OFFSET_RE.match(valor):
        return f"FAIL: {campo} sem offset explicito: {caminho} (valor: {valor})"
    return None


def classificar_recurso(resource: str) -> str:
    """Classifica um sources[].resource numa das tres formas do SCHEMA.

    A regra, em ordem:

    1. EXTERNO — carrega um esquema de URI (``https://``, ``ftp://``, ``mailto:``).
       Nunca resolvido: o validador e offline e nao persegue rede.
    2. CAMINHO_LOCAL — tem **forma de caminho**: contem ``/`` (segmento de
       diretorio) ou termina em extensao de arquivo (``.md``, ``.pdf``). E o que
       tem de existir em disco. ``raw/`` e ``wiki/`` sao consequencia desta regra,
       nao uma lista consultada — que e o ponto: o typo que a regra existe para
       pegar (``rw/``, ``raws/``) e justamente o que erra o prefixo.
    3. DESCRITOR_ESCOPO — qualquer outra coisa: um valor sem barra e sem extensao
       ("todas as sessoes de 2026", "slack", "2026"). Nao ha caminho ali a checar.

    Espaco em branco **nao** entra na decisao. Ja entrou uma vez, e foi um defeito:
    usar o espaco como sinal rebaixava a descritor caminhos que de fato existem no
    vault (arquivos sob raw/ com espaco no nome), deixando-os sem checagem. A forma
    do caminho decide, nao a presenca de espaco.
    """
    if URI_SCHEME_RE.match(resource):
        return EXTERNO
    if '/' in resource or EXT_ARQUIVO_RE.search(resource):
        return CAMINHO_LOCAL
    return DESCRITOR_ESCOPO


def validar_recurso(resource: str, raiz_wiki: Path, caminho: str) -> str | None:
    """Devolve erro se o resource for caminho local que escapa a raiz ou nao existe."""
    if classificar_recurso(resource) != CAMINHO_LOCAL:
        return None
    # Caminhos do vault sao relativos a raiz do repositorio (pai do vault), onde
    # raw/ e wiki/ vivem lado a lado.
    raiz_repo = raiz_wiki.parent.resolve()
    candidato = (raiz_repo / resource).resolve()
    # Um caminho absoluto sobrepoe a raiz no operador / do pathlib, e ../ sobe acima
    # dela: nos dois casos a checagem sairia do repositorio e passaria a depender do
    # host. Um caminho do vault que nao resolve dentro da raiz nao e caminho do vault.
    if not candidato.is_relative_to(raiz_repo):
        return f"FAIL: sources[].resource fora da raiz do repositorio: {caminho} (caminho: {resource})"
    if not candidato.exists():
        return f"FAIL: sources[].resource inexistente: {caminho} (caminho: {resource})"
    return None


def ler_iso8601(ts: str) -> datetime | None:
    """Converte timestamp ISO 8601 com offset em datetime."""
    try:
        return datetime.fromisoformat(ts)
    except ValueError:
        return None


def validar_pagina(fm: dict[str, Any], caminho: str, raiz_wiki: Path) -> tuple[list[str], dict[str, Any]]:
    """Valida os campos OKF do frontmatter. Devolve (erros, metricas)."""
    erros: list[str] = []
    metricas: dict[str, Any] = {'vencida': False, 'modificada_apos_verificacao': False}

    sources = fm.get('sources')
    if sources is not None:
        if not isinstance(sources, list):
            erros.append(f"FAIL: sources deve ser lista: {caminho}")
        else:
            for i, src in enumerate(sources):
                if not isinstance(src, dict):
                    erros.append(f"FAIL: sources[{i}] deve ser mapping: {caminho}")
                    continue
                if 'resource' not in src:
                    erros.append(f"FAIL: sources[{i}] sem resource: {caminho}")
                else:
                    err = validar_recurso(src['resource'], raiz_wiki, caminho)
                    if err:
                        erros.append(err)
                if 'author' in src:
                    err = validar_ator(src['author'], f'sources[{i}].author', caminho)
                    if err:
                        erros.append(err)
                if 'last_modified' in src:
                    err = validar_timestamp_com_offset(str(src['last_modified']), f'sources[{i}].last_modified', caminho)
                    if err:
                        erros.append(err)

    generated = fm.get('generated')
    gerado_em: datetime | None = None
    if generated is not None:
        if isinstance(generated, dict):
            # Formato OKF: valida
            if 'by' not in generated:
                erros.append(f"FAIL: generated sem by: {caminho}")
            else:
                err = validar_ator(generated['by'], 'generated.by', caminho)
                if err:
                    erros.append(err)
            if 'at' in generated:
                err = validar_timestamp_com_offset(str(generated['at']), 'generated.at', caminho)
                if err:
                    erros.append(err)
                else:
                    gerado_em = ler_iso8601(str(generated['at']))
        # senao: formato legado (string de data) — ignora, nao e OKF

    verified = fm.get('verified')
    ultima_verificacao: datetime | None = None
    if verified is not None:
        if isinstance(verified, dict):
            verified = [verified]
        if isinstance(verified, list):
            for i, v in enumerate(verified):
                if not isinstance(v, dict):
                    erros.append(f"FAIL: verified[{i}] deve ser mapping: {caminho}")
                    continue
                if 'by' not in v:
                    erros.append(f"FAIL: verified[{i}] sem by: {caminho}")
                else:
                    err = validar_ator(v['by'], f'verified[{i}].by', caminho)
                    if err:
                        erros.append(err)
                if 'at' in v:
                    err = validar_timestamp_com_offset(str(v['at']), f'verified[{i}].at', caminho)
                    if err:
                        erros.append(err)
                    else:
                        vat = ler_iso8601(str(v['at']))
                        if vat and (ultima_verificacao is None or vat > ultima_verificacao):
                            ultima_verificacao = vat
        else:
            erros.append(f"FAIL: verified deve ser mapping ou lista: {caminho}")

    stale_after = fm.get('stale_after')
    if stale_after is not None:
        err = validar_timestamp_com_offset(str(stale_after), 'stale_after', caminho)
        if err:
            erros.append(err)
        else:
            venc = ler_iso8601(str(stale_after))
            if venc:
                agora = datetime.now(timezone.utc)
                if agora >= venc:
                    metricas['vencida'] = True

    if gerado_em and ultima_verificacao:
        if gerado_em > ultima_verificacao:
            metricas['modificada_apos_verificacao'] = True

    return erros, metricas


def main() -> int:
    parser = argparse.ArgumentParser(description='Valida os campos de proveniencia OKF do frontmatter')
    parser.add_argument('wiki', nargs='?', default='wiki', help='Caminho do diretorio da wiki')
    args = parser.parse_args()

    raiz_wiki = Path(args.wiki)
    if not raiz_wiki.is_dir():
        print(f"FAIL: diretorio da wiki nao encontrado: {args.wiki}", file=sys.stderr)
        return 1

    todos_erros: list[str] = []
    vencidas = 0
    modificadas_apos_verificacao = 0

    for caminho_md in raiz_wiki.rglob('*.md'):
        rel = caminho_md.relative_to(raiz_wiki)

        texto = caminho_md.read_text(encoding='utf-8')
        fm = extrair_frontmatter(texto)
        if fm is None:
            continue

        erros, metricas = validar_pagina(fm, str(rel), raiz_wiki)
        todos_erros.extend(erros)
        if metricas['vencida']:
            vencidas += 1
        if metricas['modificada_apos_verificacao']:
            modificadas_apos_verificacao += 1

    for err in todos_erros:
        print(err)

    print(f"METRIC: okf_stale={vencidas}")
    print(f"METRIC: okf_modified_after_verified={modificadas_apos_verificacao}")

    return 1 if todos_erros else 0


if __name__ == '__main__':
    sys.exit(main())
