#!/usr/bin/env bash
# migrar-areas.sh — move paginas para suas areas conforme um mapa de roteamento
# e injeta o campo `area:` no frontmatter.
#
# Uso: bash scripts/migrar-areas.sh [WIKI] [--simular]
#   --simular   nada e movido nem escrito; so relata o que aconteceria.
#               (alias aceito: --dry-run)
#
# O mapa mora em `<WIKI>/_meta/migration-routing.md` e e uma tabela markdown
# entre os marcadores ROUTING-START / ROUTING-END:
#
#   <!-- ROUTING-START -->
#   | page | area |
#   |---|---|
#   | nome-da-pagina        | area-alvo  |
#   | sources/outra-pagina  | outra-area |
#   <!-- ROUTING-END -->
#
# O mapa e do dono da wiki e NAO vem versionado: roteamento e conteudo, nao
# metodo.
#
# Adaptacoes ao anvilore:
#   - A limpeza de diretorios vazios nao consulta uma lista fixa de nomes: ela
#     tenta `rmdir` em cada diretorio de topo que NAO seja reservado. `rmdir`
#     so remove diretorio vazio, e `nome_reservado` (em lib-anvilore.sh) e o
#     dono unico da lista de reservados — `_meta/` e `log/` sobrevivem mesmo
#     vazios, porque sao esqueleto.
#   - Uma pagina que ja esta no destino (migracao repetida) nao e erro: o
#     script confere o `area:` dela e nunca duplica o campo.
set -uo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib-anvilore.sh
source "$AQUI/lib-anvilore.sh"

WIKI="wiki"; SIMULAR=0
for arg in "$@"; do
  case "$arg" in
    --simular|--dry-run) SIMULAR=1 ;;
    -*)                  echo "FAIL: flag desconhecida: $arg" >&2; exit 1 ;;
    *)                   WIKI="${arg%/}" ;;
  esac
done

MAPA="$WIKI/_meta/migration-routing.md"
if [ ! -f "$MAPA" ]; then
  echo "FAIL: mapa de roteamento ausente: $MAPA" >&2
  exit 1
fi

# Injeta `area: <area>` logo apos a linha `type:`. Nao duplica se ja existir.
injetar_area() {
  local arquivo="$1" area="$2"
  grep -q '^area: ' "$arquivo" && return 0
  local tmp; tmp="$(mktemp)"
  awk -v a="$area" 'BEGIN{feito=0} /^type: / && !feito {print; print "area: " a; feito=1; next} {print}' \
    "$arquivo" > "$tmp" && cat "$tmp" > "$arquivo"
  rm -f "$tmp"
}

movidas=0; ja_estavam=0; ausentes=0

while IFS='|' read -r _ pagina area _; do
  pagina="$(echo "$pagina" | xargs)"; area="$(echo "$area" | xargs)"
  [ -n "$pagina" ] && [ -n "$area" ] || continue

  origem="$WIKI/$pagina.md"
  destino="$WIKI/$area/$pagina.md"

  if [ ! -f "$origem" ]; then
    if [ -f "$destino" ]; then
      # Ja migrada numa execucao anterior: so garante o campo, sem duplicar.
      [ "$SIMULAR" -eq 1 ] || injetar_area "$destino" "$area"
      echo "ja migrada: $pagina → $area/$pagina"
      ja_estavam=$((ja_estavam+1))
    else
      echo "ausente (nem na origem nem no destino): $pagina"
      ausentes=$((ausentes+1))
    fi
    continue
  fi

  if [ "$SIMULAR" -eq 1 ]; then
    echo "moveria: $pagina → $area/$pagina"
    movidas=$((movidas+1))
    continue
  fi

  mkdir -p "$(dirname "$destino")"
  git -C "$WIKI" mv "$origem" "$destino" 2>/dev/null \
    || mv "$origem" "$destino"
  injetar_area "$destino" "$area"
  echo "movida: $pagina → $area/$pagina"
  movidas=$((movidas+1))
done < <(
  # A linha separadora da tabela (`|---|---|`) casa com o padrao de slug, que
  # tambem aceita hifen — por isso ela e excluida explicitamente antes, e nao
  # por acidente do regex. Sem isso ela vira uma "pagina" chamada `---`.
  sed -n '/ROUTING-START/,/ROUTING-END/p' "$MAPA" \
    | grep -vE '^\|[ :|-]*$' \
    | grep -E '^\| *([a-z0-9-]+/)*[a-z0-9-]+ *\|' \
    | grep -vE '^\| *page *\|'
)

# Limpa diretorios de topo que ficaram vazios. `rmdir` recusa diretorio nao
# vazio, entao isto e seguro; os reservados sao poupados por principio, nao
# por sorte — um `_meta/` vazio continua sendo esqueleto da wiki.
if [ "$SIMULAR" -eq 0 ]; then
  for d in "$WIKI"/*/; do
    [ -d "$d" ] || continue
    nome="$(basename "$d")"
    nome_reservado "$nome" && continue
    rmdir "$d" 2>/dev/null || true
  done
fi

if [ "$SIMULAR" -eq 1 ]; then
  echo "MIGRACAO (simulacao): $movidas moveria(m), $ja_estavam ja migrada(s), $ausentes ausente(s)"
else
  echo "MIGRACAO: $movidas movida(s), $ja_estavam ja migrada(s), $ausentes ausente(s)"
fi
exit 0

# Este script é obra derivada de `wiki-wonka`
# (https://github.com/cooperacode/wiki-wonka) (Coopera Code, licença MIT),
# traduzido para português do Brasil e adaptado. Aviso de copyright original
# em `LICENSE`.
