#!/usr/bin/env bash
# sincronizar-indice.sh — reescreve a contagem do header de cada
# `wiki/<area>/index.md` a partir do disco. Exit 0 = em dia (ou sincronizado);
# 1 = algo defasado (com --checar) ou header malformado.
#
# Uso: bash scripts/sincronizar-indice.sh [raiz-da-wiki] [--checar]
#   --checar   nao escreve; sai 1 se algum header estiver defasado.
#              (alias aceito: --check)
#
# Regua, aplicada por area:
#   paginas   = todos os .md da area, menos index.md e overview.md (sao meta)
#   fontes    = sources/*.md   entidades = entities/*.md   conceitos = concepts/*.md
#
# So toca nos trechos "N paginas|fontes|entidades|conceitos" e na data da
# LINHA 3. Qualquer outra prosa do header e preservada — o header e do curador,
# o script so mantem os numeros honestos.
#
# Adaptacoes ao anvilore (a origem tinha uma lista fixa de areas numa lib):
#   - As areas sao DESCOBERTAS no disco. A lista de nomes que nao sao area
#     (`_meta`, `log`, e os diretorios de tipo do layout plano) tem um dono so:
#     `scripts/lib-anvilore.sh`. Aqui se pergunta a ela.
#   - `wiki/<area>/index.md` e OPCIONAL no anvilore (o indice do kit e
#     `wiki/index.md`). Area sem index nao e erro: e uma area que nao usa
#     header de contagem.
#   - Line 3 que nao contem nenhum campo de contagem nem a data e prosa livre:
#     fica intocada. Ja um header PARCIAL (tem um campo e falta outro) reprova
#     — isso e defeito, nao estilo, e falhar calado seria o erro que este
#     repositorio existe para desencorajar.
set -uo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib-anvilore.sh
source "$AQUI/lib-anvilore.sh"

WIKI="wiki"; CHECAR=0
for arg in "$@"; do
  case "$arg" in
    --checar|--check) CHECAR=1 ;;
    -*)               echo "FAIL: flag desconhecida: $arg"; exit 1 ;;
    *)                WIKI="${arg%/}" ;;
  esac
done

if [ ! -d "$WIKI" ]; then
  echo "FAIL: raiz da wiki nao encontrada: $WIKI"; exit 1
fi

falhou=0
erro() { echo "FAIL: $*"; falhou=1; }
HOJE="$(date +%F)"

# plural <n> <singular> <plural>
plural() { [ "$1" -eq 1 ] && printf '%s' "$2" || printf '%s' "$3"; }

# conta <diretorio> -> numero de .md abaixo dele (0 se nao existir)
conta() { find "$1" -name '*.md' -type f 2>/dev/null | wc -l | tr -d ' '; }

# trocar_campo <linha> <valor> <singular> <plural>
# Ecoa a linha com o campo atualizado; retorna 1 se o campo nao existe nela.
trocar_campo() {
  local linha="$1" valor="$2" sing="$3" plu="$4" palavra
  palavra="$(plural "$valor" "$sing" "$plu")"
  printf '%s' "$linha" | grep -qE "[0-9]+ ($plu|$sing)" || return 1
  printf '%s' "$linha" | sed -E "s/[0-9]+ ($plu|$sing)/$valor $palavra/"
}

CAMPOS=("página:páginas" "fonte:fontes" "entidade:entidades" "conceito:conceitos")

# tem_header_de_contagem <linha> -> 0 se a linha 3 se parece com um header
# gerado (tem ao menos um campo de contagem ou a data de atualizacao).
tem_header_de_contagem() {
  local linha="$1" campo sing plu
  printf '%s' "$linha" | grep -qE 'Última atualização: [0-9]{4}-[0-9]{2}-[0-9]{2}' && return 0
  for campo in "${CAMPOS[@]}"; do
    sing="${campo%%:*}"; plu="${campo##*:}"
    printf '%s' "$linha" | grep -qE "[0-9]+ ($plu|$sing)" && return 0
  done
  return 1
}

sincronizadas=0
for dir in "$WIKI"/*/; do
  [ -d "$dir" ] || continue
  area="$(basename "$dir")"
  # Nao e area: infra da wiki (_meta, log) nem diretorio de tipo do layout
  # plano (sources, concepts, entities). A lib e dona dessas listas.
  nome_reservado "$area" && continue
  nome_tipo_diretorio "$area" && continue

  idx="$WIKI/$area/index.md"
  [ -f "$idx" ] || continue   # index de area e opcional

  hdr="$(sed -n '3p' "$idx")"
  tem_header_de_contagem "$hdr" || continue

  s="$(conta "$WIKI/$area/sources")"
  e="$(conta "$WIKI/$area/entities")"
  c="$(conta "$WIKI/$area/concepts")"
  p="$(find "$WIKI/$area" -name '*.md' -type f 2>/dev/null \
        | grep -vcE '/(index|overview)\.md$')"

  novo="$hdr"; quebrado=0
  for i in "${!CAMPOS[@]}"; do
    sing="${CAMPOS[$i]%%:*}"; plu="${CAMPOS[$i]##*:}"
    case "$i" in 0) val="$p" ;; 1) val="$s" ;; 2) val="$e" ;; 3) val="$c" ;; esac
    if ! novo="$(trocar_campo "$novo" "$val" "$sing" "$plu")"; then
      erro "header ($area) nao tem o campo '$plu': $hdr"; quebrado=1; break
    fi
  done
  [ "$quebrado" -eq 1 ] && continue

  if printf '%s' "$novo" | grep -qE 'Última atualização: [0-9]{4}-[0-9]{2}-[0-9]{2}'; then
    novo="$(printf '%s' "$novo" \
      | sed -E "s/Última atualização: [0-9]{4}-[0-9]{2}-[0-9]{2}/Última atualização: $HOJE/")"
  else
    erro "header ($area) nao tem 'Última atualização: AAAA-MM-DD': $hdr"; continue
  fi

  [ "$novo" = "$hdr" ] && continue

  if [ "$CHECAR" -eq 1 ]; then
    erro "header ($area) defasado: $hdr"
  else
    tmp="$(mktemp)"
    awk -v n="$novo" 'NR==3{print n; next} {print}' "$idx" > "$tmp" && cat "$tmp" > "$idx"
    rm -f "$tmp"
    echo "SYNC ($area): $novo"
    sincronizadas=$((sincronizadas+1))
  fi
done

if [ "$falhou" -eq 0 ]; then
  echo "INDICE: OK ($sincronizadas header(s) reescrito(s))"
  exit 0
fi
exit 1

# Este script e obra derivada de `wiki-wonka`
# (https://github.com/cooperacode/wiki-wonka) (Coopera Code, licença MIT),
# traduzido para português do Brasil e adaptado. Aviso de copyright original
# em `LICENSE`.
