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

[ "$falhas" -eq 0 ] && echo "OK: lib-anvilore"
exit "$falhas"
