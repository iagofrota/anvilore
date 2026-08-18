#!/usr/bin/env bash
# Funções compartilhadas do anvilore. Só extrai e normaliza — não valida.

# Imprime o valor de um campo do frontmatter. Vazio se ausente.
extrair_campo() {
  local arquivo="$1" campo="$2"
  awk -v c="$campo" '
    NR == 1 && $0 != "---" { exit }
    NR > 1 && $0 == "---" { exit }
    $0 ~ "^" c ": " { sub("^" c ": ", ""); print; exit }
  ' "$arquivo"
}

# Imprime o slug derivado do nome do arquivo.
slug_de() {
  local base; base="$(basename "$1")"
  echo "${base%.md}"
}

# 0 se o arquivo abre com delimitador de frontmatter.
tem_frontmatter() {
  [ "$(head -1 "$1")" = "---" ]
}
