#!/usr/bin/env python3
"""Confronta validar_recurso com o baseline versionado de vereditos.

Chamado por tests/test-resource-baseline.sh. Exit 0 = PASS, exit 1 = FAIL.

O baseline **nao e outra versao do codigo**. E `scripts/resource-baseline.tsv`:
uma tabela de vereditos escrita a mao, derivada da regra de classificacao (ver
classificar_recurso em scripts/validar-okf.py e o perfil OKF no SCHEMA.md). E por
isso que ele nao se anula depois do merge — a comparacao aqui e **codigo x dado**,
nao codigo x codigo. Um harness que carregasse validar_recurso de `origin/main` e
comparasse com a versao atual devolveria PASS para sempre depois do merge, porque
`origin/main` passaria a conter o proprio codigo novo.

Duas fases, ambas obrigatorias:

  **Fase 1 — regressao.** Cada valor da tabela passa por `validar_recurso` e o
  veredito observado tem de bater com o registrado. Divergencia `fail` -> `pass`
  e AFROUXADO (a invariante que esta unidade protege); `pass` -> `fail` e
  APERTADO. As duas reprovam: a tabela e o contrato registrado, e ela nao pode
  derivar em silencio em direcao nenhuma.

  **Fase 2 — canario de mutacao.** O mesmo detector roda sobre o validador com o
  defeito da rodada 1 de uma revisao anterior reintroduzido em memoria (espaco em
  branco decidindo antes da forma de caminho). Ele **tem de** acusar os quatro
  valores que de fato regrediram naquela rodada. Sem esta fase, uma tabela esvaziada, um
  detector quebrado ou um comparador invertido passariam calados — que e
  exatamente o modo de falha ("teste que nunca mais reprova") que esta unidade
  existe para fechar.

Uso:

    python3 scripts/resource-baseline-check.py [--validador CAMINHO] [--baseline CAMINHO]

`--validador` aponta o script para uma copia afrouxada de validar-okf.py e exige
que ele reprove nomeando os valores. Nao tem outro uso em producao.
"""
from __future__ import annotations

import argparse
import importlib.util
import re
import sys
import tempfile
from pathlib import Path
from types import ModuleType
from typing import NamedTuple

# Carregar o validador por importlib compilaria um .pyc em scripts/__pycache__ e sujaria
# a arvore de trabalho a cada execucao do teste. Um teste nao escreve no repositorio.
sys.dont_write_bytecode = True

BASELINE_PADRAO = Path(__file__).resolve().with_name('resource-baseline.tsv')
VALIDADOR_PADRAO = Path(__file__).resolve().with_name('validar-okf.py')

# Os quatro valores que a rodada 1 de uma revisao anterior afrouxou de fato —
# medidos, nao presumidos. Moram AQUI, no codigo, e nao na tabela de dados, de proposito:
# apagar uma linha da tabela para calar uma reprovacao exigiria tambem editar este
# arquivo, num segundo diff, mais alto.
CANARIOS = (
    'raw/meetings/notas de reuniao.md',
    'wiki/_meta/arquivo com espaco.md',
    'raw/2026 Q3/notas.md',
    'raw/notas do dia',
)

# O harness de /tmp de uma revisao anterior cobria 26 valores. A tabela versionada e um
# superconjunto dele; encolher abaixo disso e regressao de cobertura e reprova.
MIN_VALORES = 26

WHITESPACE_RE = re.compile(r'\s')

ATRIBUTOS_EXIGIDOS = ('validar_recurso', 'classificar_recurso', 'URI_SCHEME_RE',
                      'EXTERNO', 'DESCRITOR_ESCOPO')


class Entrada(NamedTuple):
    esperado: str
    valor: str
    origem: str
    linha: int


class BaselineInvalido(Exception):
    """A tabela de baseline nao esta no formato contratado."""


def carregar_baseline(caminho: Path) -> tuple[list[tuple[str, str]], list[Entrada]]:
    """Le a tabela versionada. Devolve (fixtures, entradas)."""
    fixtures: list[tuple[str, str]] = []
    entradas: list[Entrada] = []
    vistos: dict[str, int] = {}

    for n, bruta in enumerate(caminho.read_text(encoding='utf-8').splitlines(), start=1):
        if not bruta.strip() or bruta.lstrip().startswith('#'):
            continue
        campos = bruta.split('\t')
        if campos[0] == '@fixture':
            if len(campos) != 3 or campos[1] not in ('file', 'dir'):
                raise BaselineInvalido(
                    f'{caminho}:{n}: @fixture espera "@fixture<TAB>file|dir<TAB>caminho"')
            rel = campos[2]
            if rel.startswith('/') or '..' in Path(rel).parts:
                raise BaselineInvalido(
                    f'{caminho}:{n}: fixture tem de ser relativa e contida na raiz: {rel!r}')
            fixtures.append((campos[1], rel))
            continue
        if len(campos) != 3:
            raise BaselineInvalido(
                f'{caminho}:{n}: esperadas 3 colunas separadas por TAB, vieram {len(campos)}')
        esperado, valor, origem = campos
        if esperado not in ('pass', 'fail'):
            raise BaselineInvalido(
                f'{caminho}:{n}: coluna 1 tem de ser "pass" ou "fail", veio {esperado!r}')
        if not valor:
            raise BaselineInvalido(f'{caminho}:{n}: coluna 2 (valor) vazia')
        if not origem.strip():
            # Anti-carimbo: nenhuma linha entra ou muda sem o motivo escrito ao lado.
            raise BaselineInvalido(
                f'{caminho}:{n}: coluna 3 (origem) vazia — todo valor carrega o motivo de estar aqui')
        if valor in vistos:
            raise BaselineInvalido(
                f'{caminho}:{n}: valor duplicado (ja na linha {vistos[valor]}): {valor!r}')
        vistos[valor] = n
        entradas.append(Entrada(esperado, valor, origem.strip(), n))

    return fixtures, entradas


def validar_estrutura(entradas: list[Entrada], caminho: Path) -> list[str]:
    """Guardas de cobertura da propria tabela."""
    problemas: list[str] = []
    if len(entradas) < MIN_VALORES:
        problemas.append(
            f'ESTRUTURA: a tabela tem {len(entradas)} valores, abaixo do minimo {MIN_VALORES} '
            f'(cobertura do harness de uma revisao anterior). Encolher a tabela e regressao de cobertura.')
    por_valor = {e.valor: e for e in entradas}
    for canario in CANARIOS:
        entrada = por_valor.get(canario)
        if entrada is None:
            problemas.append(
                f'ESTRUTURA: canario ausente da tabela: {canario!r} — e um dos quatro valores '
                f'que regrediram de fato na rodada 1 e nao pode sair de {caminho.name}.')
        elif entrada.esperado != 'fail':
            problemas.append(
                f'ESTRUTURA: canario {canario!r} esta marcado "{entrada.esperado}" na linha '
                f'{entrada.linha}; o baseline o reprova.')
    return problemas


def montar_fixture(raiz: Path, fixtures: list[tuple[str, str]]) -> Path:
    """Cria a raiz de repositorio sintetica e devolve o vault dentro dela."""
    raiz_wiki = raiz / 'wiki'
    raiz_wiki.mkdir(parents=True, exist_ok=True)
    for tipo, rel in fixtures:
        alvo = raiz / rel
        if tipo == 'dir':
            alvo.mkdir(parents=True, exist_ok=True)
        else:
            alvo.parent.mkdir(parents=True, exist_ok=True)
            alvo.write_text('fixture\n', encoding='utf-8')
    return raiz_wiki


def carregar_validador(caminho: Path, nome: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(nome, caminho)
    if spec is None or spec.loader is None:
        raise BaselineInvalido(f'nao consegui carregar o validador: {caminho}')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    faltando = [a for a in ATRIBUTOS_EXIGIDOS if not hasattr(mod, a)]
    if faltando:
        raise BaselineInvalido(
            f'{caminho}: validador sem os atributos {faltando} — nao e um validar-okf.py')
    return mod


def veredito(mod: ModuleType, valor: str, raiz_wiki: Path) -> str:
    try:
        return 'fail' if mod.validar_recurso(valor, raiz_wiki, 'pagina.md') else 'pass'
    except Exception as exc:  # noqa: BLE001 — excecao e veredito, nao crash do harness
        return f'erro:{type(exc).__name__}'


def afrouxar_por_espaco(mod: ModuleType) -> None:
    """Reintroduz, em memoria, o defeito da rodada 1 de uma revisao anterior.

    Ordem daquela versao: esquema de URI, depois **espaco em branco**, depois a
    forma do caminho. Qualquer resource com espaco virava descritor e saia da
    checagem — inclusive sob raw/ e wiki/, que o validador anterior reprovava.
    """
    original = mod.classificar_recurso

    def classify(resource: str) -> str:
        if mod.URI_SCHEME_RE.match(resource):
            return mod.EXTERNO
        if WHITESPACE_RE.search(resource):
            return mod.DESCRITOR_ESCOPO
        return original(resource)

    mod.classificar_recurso = classify


def comparar(mod: ModuleType, entradas: list[Entrada], raiz_wiki: Path
             ) -> tuple[list[Entrada], list[Entrada], list[Entrada]]:
    """Devolve (afrouxados, apertados, erros) — divergencias contra a tabela."""
    afrouxados: list[Entrada] = []
    apertados: list[Entrada] = []
    erros: list[Entrada] = []
    for e in entradas:
        obtido = veredito(mod, e.valor, raiz_wiki)
        if obtido == e.esperado:
            continue
        alvo = (erros if obtido.startswith('erro:')
                else afrouxados if e.esperado == 'fail' else apertados)
        alvo.append(e._replace(origem=f'{e.origem} | obtido: {obtido}'))
    return afrouxados, apertados, erros


def main() -> int:
    parser = argparse.ArgumentParser(
        description='Confronta validar_recurso com o baseline versionado de vereditos')
    parser.add_argument('--validador', type=Path, default=VALIDADOR_PADRAO,
                        help='caminho do validar-okf.py a exercitar (default: o do repo)')
    parser.add_argument('--baseline', type=Path, default=BASELINE_PADRAO,
                        help='caminho da tabela de vereditos (default: scripts/resource-baseline.tsv)')
    args = parser.parse_args()

    try:
        fixtures, entradas = carregar_baseline(args.baseline)
    except (BaselineInvalido, OSError) as exc:
        print(f'FAIL: {exc}')
        return 1

    print(f'BASELINE:  {args.baseline} ({len(entradas)} valores, {len(fixtures)} fixtures)')
    print(f'VALIDADOR: {args.validador}')
    print()

    reprovou = False

    problemas = validar_estrutura(entradas, args.baseline)
    for p in problemas:
        print(p)
    if problemas:
        reprovou = True

    with tempfile.TemporaryDirectory(prefix='resource-baseline-') as tmp:
        # Dois niveis: a raiz do "repositorio" e filha do diretorio temporario, para
        # que um resource com ../.. tenha para onde escapar e o veredito nao dependa
        # da profundidade de TMPDIR.
        raiz = Path(tmp) / 'repo'
        raiz_wiki = montar_fixture(raiz, fixtures)

        try:
            atual = carregar_validador(args.validador, 'okf_atual')
            mutante = carregar_validador(args.validador, 'okf_mutante')
        except (BaselineInvalido, OSError, SyntaxError) as exc:
            print(f'FAIL: {exc}')
            return 1

        print('Fase 1 — vereditos do validador contra o baseline versionado')
        afrouxados, apertados, erros = comparar(atual, entradas, raiz_wiki)
        for e in afrouxados:
            print(f'  AFROUXADO: {e.valor!r} — baseline: fail  (linha {e.linha}: {e.origem})')
        for e in apertados:
            print(f'  APERTADO:  {e.valor!r} — baseline: pass  (linha {e.linha}: {e.origem})')
        for e in erros:
            print(f'  ERRO:      {e.valor!r} — baseline: {e.esperado}  (linha {e.linha}: {e.origem})')
        if afrouxados or apertados or erros:
            print(f'FASE1: FAIL — {len(afrouxados)} afrouxado(s), {len(apertados)} apertado(s), '
                  f'{len(erros)} com erro')
            reprovou = True
        else:
            print(f'FASE1: PASS — {len(entradas)}/{len(entradas)} vereditos batem com o baseline')
        print()

        print('Fase 2 — canario de mutacao (regra de espaco em branco da rodada 1)')
        afrouxar_por_espaco(mutante)
        mut_afrouxados, _, _ = comparar(mutante, entradas, raiz_wiki)
        detectados = {e.valor for e in mut_afrouxados}
        nao_detectados = [c for c in CANARIOS if c not in detectados]
        if nao_detectados:
            for c in nao_detectados:
                print(f'  CANARIO NAO DETECTADO: {c!r}')
            print(f'FASE2: FAIL — o detector nao acusou {len(nao_detectados)} dos {len(CANARIOS)} '
                  f'canarios; este harness nao estaria pegando a regressao que ja aconteceu')
            reprovou = True
        else:
            print(f'FASE2: PASS — o detector acusa {len(detectados)} valor(es) afrouxado(s) '
                  f'sob a mutacao, incluindo os {len(CANARIOS)} canarios')

    return 1 if reprovou else 0


if __name__ == '__main__':
    sys.exit(main())
