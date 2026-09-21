#!/usr/bin/env bash
# indexar-log.sh — regenera <WIKI>/log.md a partir de <WIKI>/log/log-*.md.
# Idempotente no sentido forte: duas execucoes produzem saida byte-identica.
#
# Uso: bash scripts/indexar-log.sh [WIKI] [--stdout]
#   --stdout   imprime em vez de escrever <WIKI>/log.md.
#
# Adaptacao ao anvilore: quando `<WIKI>/log/` nao tem nenhum `log-*.md`, a
# origem saia 1 com erro. Aqui o `wiki/log.md` e um arquivo VERSIONADO do
# esqueleto (o clone traz o cabecalho do log ja escrito) e `wiki/log/` vem
# vazio de proposito. Regenerar a partir do nada apagaria o que veio no clone,
# entao o script preserva o arquivo, diz em voz alta que nao havia o que
# indexar, e sai 0 — isso nao e um erro, e uma wiki que ainda nao fatiou o log.
set -uo pipefail

WIKI="wiki"; STDOUT=0
for arg in "$@"; do
  case "$arg" in
    --stdout) STDOUT=1 ;;
    -*)       echo "FAIL: flag desconhecida: $arg" >&2; exit 1 ;;
    *)        WIKI="${arg%/}" ;;
  esac
done

DIR_LOG="$WIKI/log"
mapfile -t arquivos < <(find "$DIR_LOG" -maxdepth 1 -name 'log-*.md' -type f 2>/dev/null | sort -r)
if [ "${#arquivos[@]}" -eq 0 ]; then
  echo "LOG: nada a indexar — $DIR_LOG sem arquivo log-*.md; $WIKI/log.md preservado"
  exit 0
fi

# "<n> · <tipo> ×<n>, <tipo> ×<n>" para um arquivo de dia.
# Consciente de code fence; tipos ordenados por contagem desc, empate resolvido
# alfabeticamente — empate deterministico e o que torna o indice idempotente.
linha_do_dia() {
  awk '
    /^```/ { f = !f; next }
    !f && /^## \[/ {
      n++
      t = $0
      sub(/^## \[[0-9-]+\] /, "", t)
      sub(/ *\|.*$/, "", t)
      gsub(/^[ \t]+|[ \t]+$/, "", t)
      cnt[t]++
    }
    END {
      printf "%d", n + 0
      k = 0
      for (t in cnt) chaves[++k] = t
      for (i = 1; i <= k; i++)
        for (j = i + 1; j <= k; j++)
          if (cnt[chaves[j]] > cnt[chaves[i]] || (cnt[chaves[j]] == cnt[chaves[i]] && chaves[j] < chaves[i])) {
            tmp = chaves[i]; chaves[i] = chaves[j]; chaves[j] = tmp
          }
      for (i = 1; i <= k; i++) printf "%s%s ×%d", (i == 1 ? " · " : ", "), chaves[i], cnt[chaves[i]]
      printf "\n"
    }
  ' "$1"
}

datas=(); linhas=(); contagens=(); total=0
for f in "${arquivos[@]}"; do
  d="$(basename "$f" .md)"; d="${d#log-}"
  linha="$(linha_do_dia "$f")"
  c="${linha%% *}"
  datas+=("$d"); linhas+=("$linha"); contagens+=("$c")
  total=$((total + c))
done

render() {
  printf -- '---\ntype: log-index\n---\n\n# Log\n\n'
  printf '_%d entradas em %d dias. Gerado por `scripts/indexar-log.sh` — não edite à mão._\n' \
    "$total" "${#arquivos[@]}"
  local atual="" m mt i j
  for i in "${!datas[@]}"; do
    m="${datas[$i]:0:7}"
    if [ "$m" != "$atual" ]; then
      atual="$m"; mt=0
      for j in "${!datas[@]}"; do
        [ "${datas[$j]:0:7}" = "$m" ] && mt=$((mt + contagens[j]))
      done
      printf '\n## %s — %d entradas\n' "$m" "$mt"
    fi
    printf -- '- [[log-%s]] — %s\n' "${datas[$i]}" "${linhas[$i]}"
  done
}

if [ "$STDOUT" -eq 1 ]; then
  render
else
  render > "$WIKI/log.md"
  echo "LOG: $total entradas em ${#arquivos[@]} dias → $WIKI/log.md"
fi

# Este script é obra derivada de `wiki-wonka`
# (https://github.com/cooperacode/wiki-wonka) (Coopera Code, licença MIT),
# traduzido para português do Brasil e adaptado. Aviso de copyright original
# em `LICENSE`.
