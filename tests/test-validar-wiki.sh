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

# invariantes de type e slug — os outros dois motivos de reprovacao
rm -f "$tmp/wiki/quebrada.md"
cat > "$tmp/wiki/tipo-errado.md" <<'EOF'
---
title: "Tipo errado"
slug: tipo-errado
type: memory
tags: [teste]
---
EOF
saida="$(bash scripts/validar-wiki.sh "$tmp/wiki")"
echo "$saida" | grep -q "type invalido" \
  && echo "  ok: reprova type fora do schema" || { echo "  FALHA: aceitou type invalido"; falhas=$((falhas+1)); }
rm -f "$tmp/wiki/tipo-errado.md"

cat > "$tmp/wiki/slug-errado.md" <<'EOF'
---
title: "Slug errado"
slug: outro-nome-qualquer
type: concept
tags: [teste]
---
EOF
saida="$(bash scripts/validar-wiki.sh "$tmp/wiki")"
echo "$saida" | grep -q "nao bate com o nome do arquivo" \
  && echo "  ok: reprova slug divergente" || { echo "  FALHA: aceitou slug divergente"; falhas=$((falhas+1)); }
rm -f "$tmp/wiki/slug-errado.md"

# diretorio inexistente e diretorio sem pagina nenhuma nao podem dar PASS:
# a tese do repositorio e que medicao nao erra em silencio
saida="$(bash scripts/validar-wiki.sh "$tmp/nao-existe" 2>/dev/null)"; codigo=$?
echo "$saida" | grep -q "VALIDACAO: FAIL" \
  && echo "  ok: reprova diretorio inexistente" || { echo "  FALHA: caminho errado deu PASS"; falhas=$((falhas+1)); }
[ "$codigo" -eq 1 ] \
  && echo "  ok: codigo 1 em diretorio inexistente" || { echo "  FALHA: codigo de saida errado"; falhas=$((falhas+1)); }

mkdir -p "$tmp/vazio"
saida="$(bash scripts/validar-wiki.sh "$tmp/vazio")"; codigo=$?
echo "$saida" | grep -q "VALIDACAO: FAIL" \
  && echo "  ok: reprova diretorio sem pagina" || { echo "  FALHA: diretorio vazio deu PASS"; falhas=$((falhas+1)); }
[ "$codigo" -eq 1 ] \
  && echo "  ok: codigo 1 em diretorio sem pagina" || { echo "  FALHA: codigo de saida errado"; falhas=$((falhas+1)); }

# ...mas uma wiki recem-criada, que so tem index.md e log.md, continua valida
mkdir -p "$tmp/nova"
printf '# Indice\n' > "$tmp/nova/index.md"
printf '# Log\n' > "$tmp/nova/log.md"
saida="$(bash scripts/validar-wiki.sh "$tmp/nova")"
echo "$saida" | grep -q "VALIDACAO: PASS" \
  && echo "  ok: wiki recem-criada passa" || { echo "  FALHA: wiki nova reprovada"; falhas=$((falhas+1)); }

[ "$falhas" -eq 0 ] && echo "OK: validar-wiki"
exit "$falhas"
