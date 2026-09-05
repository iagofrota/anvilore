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

# Imprime a area de uma pagina, derivada de onde ela mora relativa a raiz da wiki.
# Vazio quando a pagina esta solta na raiz (wiki plana) ou num diretorio
# reservado (_meta, log) — esses nao sao areas tematicas.
area_do_diretorio() {
  local raiz="${1%/}" arquivo="$2" rel topo
  rel="${arquivo#"$raiz"/}"
  case "$rel" in
    */*) ;;          # nao ha barra: pagina solta na raiz, sem area
    *) return 0 ;;
  esac
  topo="${rel%%/*}"
  case "$topo" in
    _meta|log) return 0 ;;
  esac
  printf '%s\n' "$topo"
}
