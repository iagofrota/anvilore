#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

falhas=0
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/wiki"

# página válida, porém com dívida registrada
cat > "$tmp/wiki/valida.md" <<'EOF'
---
title: "Válida"
slug: valida
type: concept
tags: [teste]
---

> [!gap]
> Falta a definição de X.
EOF

saida="$(bash scripts/validar-wiki.sh "$tmp/wiki")"; codigo=$?
echo "$saida" | grep -q "VALIDACAO: PASS" \
  && echo "  ok: passa com divida" || { echo "  FALHA: divida reprovou"; falhas=$((falhas+1)); }
[ "$codigo" -eq 0 ] \
  && echo "  ok: codigo 0 com divida" || { echo "  FALHA: divida alterou codigo de saida"; falhas=$((falhas+1)); }
echo "$saida" | grep -q "1 gaps" \
  && echo "  ok: contou o gap" || { echo "  FALHA: nao contou o gap"; falhas=$((falhas+1)); }

# index.md e log.md nao seguem o schema e devem ser ignorados
printf '# Índice\n' > "$tmp/wiki/index.md"
printf '# Log\n' > "$tmp/wiki/log.md"
saida="$(bash scripts/validar-wiki.sh "$tmp/wiki")"
echo "$saida" | grep -q "VALIDACAO: PASS" \
  && echo "  ok: ignora index.md e log.md" || { echo "  FALHA: cobrou schema de index/log"; falhas=$((falhas+1)); }

# página que viola invariante: sem frontmatter
printf 'Sem nada.\n' > "$tmp/wiki/quebrada.md"
saida="$(bash scripts/validar-wiki.sh "$tmp/wiki")"; codigo=$?
echo "$saida" | grep -q "VALIDACAO: FAIL" \
  && echo "  ok: reprova sem frontmatter" || { echo "  FALHA: aceitou pagina sem frontmatter"; falhas=$((falhas+1)); }
[ "$codigo" -eq 1 ] \
  && echo "  ok: codigo 1 em FAIL" || { echo "  FALHA: codigo de saida errado em FAIL"; falhas=$((falhas+1)); }

[ "$falhas" -eq 0 ] && echo "OK: validar-wiki"
exit "$falhas"
