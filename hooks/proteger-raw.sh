#!/usr/bin/env bash
# proteger-raw.sh — recusa qualquer escrita do agente em `raw/`.
#
# O `AGENTS.md` diz que `raw/` é imutável para o agente. Dito em prosa, isso é
# uma promessa que depende de o agente lembrar. Este script é a mesma regra com
# dentes: ele lê, na entrada padrão, o payload JSON que o provedor entrega antes
# de executar uma ferramenta de escrita, e sai com código ≠0 quando o caminho
# alvo está dentro de `raw/`.
#
# Este é o ÚNICO lugar onde a decisão mora. As formas de configuração em
# `hooks/` apontam para cá por caminho; nenhuma reimplementa a regra. Ver
# `hooks/README.md`.
#
# Códigos de saída:
#   0  o caminho não é uma escrita em `raw/` — siga
#   2  bloqueado; o motivo vai para o stderr, que é o canal que o provedor
#      devolve ao agente
#
# Alvo declarado: Linux. Sem promessa de outros sistemas.
set -uo pipefail

MENSAGEM='Bloqueado: `raw/` é imutável para o agente. A camada de fontes é da pessoa que cura — acrescente o arquivo à mão e peça uma ingestão.'

# A decisão, e só ela. `raw/` no início do caminho ou como componente próprio;
# `rawdata/` e `wiki/raw-notas.md` não são a camada de fontes, e casar por
# substring solta transformaria o bloqueio numa recusa aproximada.
escreve_em_raw() {
  case "$1" in
    raw/*|*/raw/*) return 0 ;;
    *)             return 1 ;;
  esac
}

# Extrai o caminho alvo do payload. Ecoa o caminho e sai 0 quando conseguiu
# interpretar o JSON (mesmo que não haja caminho nenhum lá dentro); sai ≠0
# quando não há como interpretar — e aí quem chama decide fechado, não aberto.
#
# A busca é recursiva e aceita mais de uma grafia de chave de propósito: a
# decisão é sobre o caminho, não sobre o formato de payload de um provedor.
# Vários caminhos no mesmo payload saem um por linha; basta um estar em `raw/`.
FILTRO_JQ='
  [ .. | objects | to_entries[]
    | select(.key | ascii_downcase | test("^(file_?path|notebook_?path|absolute_?path|path)$"))
    | .value ]
  | map(select(type == "string")) | .[]
'

LEITOR_PY='
import json, sys
CHAVES = {"file_path", "filepath", "notebook_path", "notebookpath",
          "absolute_path", "absolutepath", "path"}
def anda(no):
    if isinstance(no, dict):
        for chave, valor in no.items():
            if chave.lower() in CHAVES and isinstance(valor, str):
                print(valor)
            anda(valor)
    elif isinstance(no, list):
        for item in no:
            anda(item)
anda(json.load(sys.stdin))
'

extrair_caminhos() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$1" | jq -r "$FILTRO_JQ" 2>/dev/null && return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    printf '%s' "$1" | python3 -c "$LEITOR_PY" 2>/dev/null && return 0
  fi
  return 1
}

# ----------------------------------------------------------------------------
# Rastro de verificação — inerte por padrão
# ----------------------------------------------------------------------------
# Um hook que bloqueou e um hook que nunca foi chamado deixam o MESMO disco: o
# arquivo simplesmente não aparece em `raw/`. Sem rastro, "`raw/` continuou
# vazio" não distingue "o hook barrou" de "o agente leu o contrato em prosa e se
# recusou antes de chamar a ferramenta" — e um teste que afirma o primeiro a
# partir do segundo está medindo outra coisa.
#
# Quando `ANVILORE_LOG_HOOK` aponta para um arquivo, cada invocação deixa uma
# linha `<epoch>\t<veredito>\t<alvo>`. Sem a variável, nada é escrito: isto é
# affordance de verificação para quem testa, não instrumentação de produção.
# Falha ao escrever o rastro NUNCA altera o veredito — o log observa a decisão,
# não participa dela.
registrar() {
  [ -n "${ANVILORE_LOG_HOOK:-}" ] || return 0
  printf '%s\t%s\t%s\n' "$(date +%s)" "$1" "$2" >> "$ANVILORE_LOG_HOOK" 2>/dev/null || true
}

bloquear() {
  registrar BLOQUEADO "$1"
  printf '%s\n' "$MENSAGEM" >&2
  printf 'Motivo: %s\n' "$1" >&2
  exit 2
}

liberar() {
  registrar PASSOU "$1"
  exit 0
}

PAYLOAD="$(cat)"

if CAMINHOS="$(extrair_caminhos "$PAYLOAD")" && [ -n "$CAMINHOS" ]; then
  while IFS= read -r alvo; do
    [ -n "$alvo" ] || continue
    escreve_em_raw "$alvo" && bloquear "caminho dentro de raw/: $alvo"
  done <<< "$CAMINHOS"
  liberar "$(printf '%s' "$CAMINHOS" | tr '\n' ' ')"
fi

# Chegou aqui por um de três caminhos: não há leitor de JSON na máquina; o
# payload não é JSON válido; ou o payload é JSON válido mas nenhuma das chaves
# reconhecidas aparece nele — é o caso da forma documentada do Codex CLI
# (`apply_patch`), que leva o caminho alvo dentro do corpo do patch e não numa
# chave própria. Os três têm o mesmo desfecho: sem caminho isolado, a decisão
# passa a ser sobre o texto inteiro — grosseira, e podendo recusar demais. É o
# lado certo de errar: um hook de proteção que falha ABERTO não protege nada, e
# falharia em silêncio, que é exatamente o defeito que este repositório existe
# para desencorajar. "Não achei caminho" nunca vira "pode passar".
if printf '%s' "$PAYLOAD" | grep -qF 'raw/'; then
  bloquear 'payload sem caminho isolável que cita raw/ (falha fechado)'
fi
liberar 'payload sem caminho isolável, sem citação a raw/'

# Este script é obra derivada de `wiki-wonka`
# (https://github.com/cooperacode/wiki-wonka) (Coopera Code, licença MIT),
# traduzido para português do Brasil e adaptado. Aviso de copyright original
# em `LICENSE`.
