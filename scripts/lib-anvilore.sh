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

# Dono unico da lista de diretorios reservados. Um diretorio reservado guarda
# infra da wiki — indices gerados (_meta) e o log fatiado por dia (log) —, nao
# paginas tematicas. Todo lugar que precise decidir se um nome de diretorio de
# topo e reservado pergunta AQUI, para que acrescentar ou renomear um reservado
# seja uma edicao unica em vez de "lembrar de N pontos".
# 0 se o nome dado for de um diretorio reservado.
nome_reservado() {
  case "$1" in
    _meta|log) return 0 ;;
    *) return 1 ;;
  esac
}

# Imprime a area de uma pagina, derivada de onde ela mora relativa a raiz da wiki.
# Vazio quando a pagina esta solta na raiz (wiki plana) ou num diretorio
# reservado (ver nome_reservado) — esses nao sao areas tematicas.
area_do_diretorio() {
  local raiz="${1%/}" arquivo="$2" rel topo
  rel="${arquivo#"$raiz"/}"
  case "$rel" in
    */*) ;;          # ha barra: pagina aninhada, o topo pode ser uma area
    *) return 0 ;;   # sem barra: pagina solta na raiz, sem area
  esac
  topo="${rel%%/*}"
  nome_reservado "$topo" && return 0
  printf '%s\n' "$topo"
}

# 0 se a pagina mora num diretorio reservado (ver nome_reservado). O SCHEMA
# descreve esses diretorios como infra — indices gerados e log fatiado por dia —,
# nao como pagina de wiki, entao o validador nao lhes cobra frontmatter/type/slug.
em_dir_reservado() {
  local raiz="${1%/}" arquivo="$2" rel topo
  rel="${arquivo#"$raiz"/}"
  case "$rel" in
    */*) ;;
    *) return 1 ;;   # sem barra: solta na raiz, nao e reservada
  esac
  topo="${rel%%/*}"
  nome_reservado "$topo"
}
