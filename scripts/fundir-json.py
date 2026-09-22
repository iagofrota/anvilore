#!/usr/bin/env python3
"""fundir-json.py — funde um fragmento de configuração num arquivo JSON alvo.

Existe porque "instalar uma configuração sem destruir a que já estava lá" é um
procedimento determinístico: mesma entrada, mesma saída, sempre. Deixar isso a
cargo de quem chama — um `cat >>` aqui, um `jq` ali — é como se perde a
configuração de quem clonou o repositório, uma vez só e sem volta.

A fusão tem três regras, e a terceira é a que importa:

  dicionário + dicionário  ->  funde chave a chave, descendo
  lista + lista            ->  acrescenta só o que ainda não está lá
                               (igualdade profunda: rodar de novo não duplica)
  escalar ≠ escalar        ->  RECUSA a fusão inteira e explica no stderr

A terceira regra é o contrato de não-surpresa: o instalador nunca troca um
valor que a pessoa escolheu por um valor dele em silêncio. Ou funde
preservando, ou para e avisa — nunca sobrescreve calado.

Protocolo de saída (stdout, uma palavra):

  INALTERADO  o alvo já contém o fragmento; nada foi escrito
  MUDOU       o alvo passou a conter o fragmento (ou passaria, com --simular)

Códigos de saída:
  0  fundido ou já estava fundido
  2  uso incorreto, ou JSON inválido na entrada
  3  conflito de valor escalar — nada foi escrito

Com `--simular`, calcula tudo e imprime o mesmo veredito, sem tocar no disco.

Alvo declarado: Linux. Sem promessa de outros sistemas.
"""
from __future__ import annotations

import json
import sys

USO = "uso: fundir-json.py [--simular] <alvo.json> <fragmento.json>"


class Conflito(Exception):
    """Um escalar do alvo diverge do escalar que o fragmento quer pôr ali."""

    def __init__(self, caminho: str, atual: object, novo: object) -> None:
        super().__init__(caminho)
        self.caminho = caminho
        self.atual = atual
        self.novo = novo


def fundir(alvo: object, fragmento: object, caminho: str = "") -> object:
    """Devolve a fusão de `fragmento` sobre `alvo`. Não muta nenhum dos dois."""
    if isinstance(alvo, dict) and isinstance(fragmento, dict):
        saida = dict(alvo)
        for chave, valor in fragmento.items():
            onde = f"{caminho}.{chave}" if caminho else chave
            if chave in saida:
                saida[chave] = fundir(saida[chave], valor, onde)
            else:
                saida[chave] = valor
        return saida

    if isinstance(alvo, list) and isinstance(fragmento, list):
        saida = list(alvo)
        for item in fragmento:
            # Igualdade profunda, não identidade: é o que faz a segunda execução
            # reconhecer o que a primeira escreveu e não empilhar uma cópia.
            if item not in saida:
                saida.append(item)
        return saida

    if alvo == fragmento:
        return alvo

    # Tipos incompatíveis ou escalares divergentes. Quem decide o que fazer é a
    # pessoa, não o instalador.
    raise Conflito(caminho or "(raiz)", alvo, fragmento)


def ler_json(caminho: str, ausente_vale_vazio: bool) -> object:
    try:
        with open(caminho, encoding="utf-8") as fluxo:
            return json.load(fluxo)
    except FileNotFoundError:
        if ausente_vale_vazio:
            return {}
        sys.stderr.write(f"fundir-json: arquivo não encontrado: {caminho}\n")
        sys.exit(2)
    except json.JSONDecodeError as erro:
        sys.stderr.write(f"fundir-json: JSON inválido em {caminho}: {erro}\n")
        sys.exit(2)


def serializar(dado: object) -> str:
    return json.dumps(dado, indent=2, ensure_ascii=False) + "\n"


def main(argv: list[str]) -> int:
    simular = False
    posicionais = []
    for arg in argv:
        if arg == "--simular":
            simular = True
        elif arg.startswith("-"):
            sys.stderr.write(f"fundir-json: opção desconhecida: {arg}\n{USO}\n")
            return 2
        else:
            posicionais.append(arg)

    if len(posicionais) != 2:
        sys.stderr.write(USO + "\n")
        return 2

    destino, origem = posicionais
    alvo = ler_json(destino, ausente_vale_vazio=True)
    fragmento = ler_json(origem, ausente_vale_vazio=False)

    try:
        fundido = fundir(alvo, fragmento)
    except Conflito as conflito:
        sys.stderr.write(
            f"fundir-json: RECUSADO — {destino} já define "
            f"'{conflito.caminho}' como {conflito.atual!r}, e a instalação "
            f"quer {conflito.novo!r}. Nada foi escrito: resolva à mão e rode "
            f"de novo.\n"
        )
        return 3

    texto_novo = serializar(fundido)
    try:
        with open(destino, encoding="utf-8") as fluxo:
            texto_atual = fluxo.read()
    except FileNotFoundError:
        texto_atual = None

    # Comparar o TEXTO final, não só a estrutura: um alvo já equivalente mas
    # escrito com outra indentação seria reescrito a cada execução, e "nada
    # mudou" deixaria de ser verdade sobre o disco — que é onde D1/D2 medem.
    if texto_atual == texto_novo:
        print("INALTERADO")
        return 0

    if not simular:
        with open(destino, "w", encoding="utf-8") as fluxo:
            fluxo.write(texto_novo)
    print("MUDOU")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
