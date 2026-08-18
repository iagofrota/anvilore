#!/usr/bin/env bash
# Valida a wiki. Invariante violada reprova; divida de conhecimento so e contada.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
source scripts/lib-anvilore.sh

DIR="${1:-wiki}"
TIPOS_VALIDOS="source concept entity"

erros=0; gaps=0; contradicoes=0

while IFS= read -r arquivo; do
  nome="$(basename "$arquivo")"
  if [ "$nome" = "index.md" ] || [ "$nome" = "log.md" ]; then continue; fi

  if ! tem_frontmatter "$arquivo"; then
    echo "ERRO: sem frontmatter: $arquivo"; erros=$((erros+1)); continue
  fi

  tipo="$(extrair_campo "$arquivo" type)"
  if ! echo "$TIPOS_VALIDOS" | grep -qw "$tipo"; then
    echo "ERRO: type invalido ('$tipo'): $arquivo"; erros=$((erros+1))
  fi

  slug="$(extrair_campo "$arquivo" slug)"
  if [ "$slug" != "$(slug_de "$arquivo")" ]; then
    echo "ERRO: slug '$slug' nao bate com o nome do arquivo: $arquivo"; erros=$((erros+1))
  fi

  gaps=$((gaps + $(grep -c '\[!gap\]' "$arquivo" || true)))
  contradicoes=$((contradicoes + $(grep -c '\[!contradiction\]' "$arquivo" || true)))
done < <(find "$DIR" -name '*.md' -type f | sort)

echo "Divida: $gaps gaps, $contradicoes contradicoes"
echo "Registrar uma contradicao nao e criar uma contradicao — e torna-la visivel."

if [ "$erros" -gt 0 ]; then
  echo "VALIDACAO: FAIL ($erros violacoes de invariante)"; exit 1
fi
echo "VALIDACAO: PASS"
exit 0
