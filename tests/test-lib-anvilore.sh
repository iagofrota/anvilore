#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
source scripts/lib-anvilore.sh

falhas=0
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cat > "$tmp/pagina.md" <<'EOF'
---
title: "Uma página"
slug: uma-pagina
type: concept
related_sources: [fonte-a, fonte-b]
---

Corpo.
EOF

printf 'Sem frontmatter.\n' > "$tmp/solta.md"

checar() {
  if [ "$2" = "$3" ]; then echo "  ok: $1"; else
    echo "  FALHA: $1 — esperado '$3', veio '$2'"; falhas=$((falhas+1)); fi
}

checar "extrair_campo title"  "$(extrair_campo "$tmp/pagina.md" title)"  '"Uma página"'
checar "extrair_campo type"   "$(extrair_campo "$tmp/pagina.md" type)"   'concept'
checar "campo inexistente"    "$(extrair_campo "$tmp/pagina.md" ausente)" ''
checar "slug_de"              "$(slug_de "$tmp/pagina.md")"              'pagina'

tem_frontmatter "$tmp/pagina.md" && echo "  ok: tem_frontmatter positivo" \
  || { echo "  FALHA: tem_frontmatter negou pagina valida"; falhas=$((falhas+1)); }
tem_frontmatter "$tmp/solta.md" && { echo "  FALHA: tem_frontmatter aceitou arquivo sem frontmatter"; falhas=$((falhas+1)); } \
  || echo "  ok: tem_frontmatter negativo"

# area_do_diretorio: deriva a area a partir de onde a pagina mora, relativa a raiz.
# Determinismo puro — mesma entrada, mesma saida — logo mora na lib com teste.
checar "area_do_diretorio: pagina em area"        "$(area_do_diretorio "$tmp" "$tmp/exemplo/concepts/x.md")"     'exemplo'
checar "area_do_diretorio: pagina solta na raiz"  "$(area_do_diretorio "$tmp" "$tmp/x.md")"                      ''
checar "area_do_diretorio: reservado _meta"       "$(area_do_diretorio "$tmp" "$tmp/_meta/i.md")"                ''
checar "area_do_diretorio: reservado log"         "$(area_do_diretorio "$tmp" "$tmp/log/2026-09-05.md")"         ''
checar "area_do_diretorio: raiz com barra final"  "$(area_do_diretorio "$tmp/" "$tmp/exemplo/sources/y.md")"     'exemplo'

# em_dir_reservado: 0 quando a pagina mora num diretorio reservado (_meta, log),
# que o SCHEMA descreve como infra (indices/log), nao como pagina de wiki.
em_dir_reservado "$tmp" "$tmp/_meta/lacunas.md" \
  && echo "  ok: em_dir_reservado _meta" || { echo "  FALHA: nao reconheceu _meta"; falhas=$((falhas+1)); }
em_dir_reservado "$tmp" "$tmp/log/2026-09-05.md" \
  && echo "  ok: em_dir_reservado log" || { echo "  FALHA: nao reconheceu log"; falhas=$((falhas+1)); }
em_dir_reservado "$tmp" "$tmp/exemplo/concepts/x.md" \
  && { echo "  FALHA: tratou area comum como reservada"; falhas=$((falhas+1)); } || echo "  ok: area comum nao e reservada"
em_dir_reservado "$tmp" "$tmp/solta.md" \
  && { echo "  FALHA: tratou pagina solta como reservada"; falhas=$((falhas+1)); } || echo "  ok: pagina solta nao e reservada"

[ "$falhas" -eq 0 ] && echo "OK: lib-anvilore"
exit "$falhas"
