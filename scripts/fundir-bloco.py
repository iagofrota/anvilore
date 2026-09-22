#!/usr/bin/env python3
"""fundir-bloco.py — mantém um bloco delimitado dentro de um arquivo de texto.

Irmão de `fundir-json.py`, para os formatos em que fundir estrutura não é uma
opção: TOML (a biblioteca padrão do Python lê, mas não escreve) e markdown.

A técnica é a mesma de qualquer arquivo de configuração compartilhado entre uma
pessoa e uma ferramenta: a ferramenta é dona de um trecho **delimitado por
marcadores**, e de nada mais. Tudo fora dos marcadores é de quem usa e nunca é
tocado — nem lido para decidir. Rodar de novo reescreve o trecho no lugar em que
ele já estava, então o arquivo converge em vez de crescer.

  <comentário> <<< <marcador>
  ...conteúdo gerado...
  <comentário> >>> <marcador>

Protocolo de saída (stdout, uma palavra): INALTERADO | MUDOU
Códigos de saída: 0 ok · 2 uso incorreto ou arquivo ilegível

Com `--simular`, calcula tudo e imprime o mesmo veredito, sem tocar no disco.

Alvo declarado: Linux. Sem promessa de outros sistemas.
"""
from __future__ import annotations

import sys

USO = (
    "uso: fundir-bloco.py [--simular] [--comentario <prefixo>] "
    "<alvo> <fragmento> <marcador>"
)


def montar_bloco(corpo: str, marcador: str, comentario: str) -> str:
    corpo = corpo.rstrip("\n")
    return (
        f"{comentario} <<< {marcador}\n"
        f"{corpo}\n"
        f"{comentario} >>> {marcador}\n"
    )


def substituir_ou_acrescentar(
    texto: str, bloco: str, marcador: str, comentario: str
) -> str:
    """Põe `bloco` no lugar do bloco de mesmo marcador, ou no fim se não houver."""
    abertura = f"{comentario} <<< {marcador}"
    fechamento = f"{comentario} >>> {marcador}"
    linhas = texto.splitlines(keepends=True)

    inicio = fim = None
    for indice, linha in enumerate(linhas):
        despida = linha.strip()
        if despida == abertura and inicio is None:
            inicio = indice
        elif despida == fechamento and inicio is not None:
            fim = indice
            break

    if inicio is not None and fim is not None:
        return "".join(linhas[:inicio]) + bloco + "".join(linhas[fim + 1 :])

    # Sem bloco anterior: acrescenta no fim, separado por uma linha em branco do
    # que já estava lá — a não ser que o arquivo esteja vazio.
    if texto and not texto.endswith("\n"):
        texto += "\n"
    separador = "\n" if texto else ""
    return texto + separador + bloco


def main(argv: list[str]) -> int:
    simular = False
    comentario = "#"
    posicionais: list[str] = []

    resto = list(argv)
    while resto:
        arg = resto.pop(0)
        if arg == "--simular":
            simular = True
        elif arg == "--comentario":
            if not resto:
                sys.stderr.write(USO + "\n")
                return 2
            comentario = resto.pop(0)
        elif arg.startswith("--"):
            sys.stderr.write(f"fundir-bloco: opção desconhecida: {arg}\n{USO}\n")
            return 2
        else:
            posicionais.append(arg)

    if len(posicionais) != 3:
        sys.stderr.write(USO + "\n")
        return 2

    destino, origem, marcador = posicionais

    try:
        with open(origem, encoding="utf-8") as fluxo:
            corpo = fluxo.read()
    except OSError as erro:
        sys.stderr.write(f"fundir-bloco: não consegui ler {origem}: {erro}\n")
        return 2

    try:
        with open(destino, encoding="utf-8") as fluxo:
            texto_atual = fluxo.read()
    except FileNotFoundError:
        texto_atual = ""
    except OSError as erro:
        sys.stderr.write(f"fundir-bloco: não consegui ler {destino}: {erro}\n")
        return 2

    bloco = montar_bloco(corpo, marcador, comentario)
    texto_novo = substituir_ou_acrescentar(texto_atual, bloco, marcador, comentario)

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
