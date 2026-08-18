#!/usr/bin/env bash
# Valida a wiki. Invariante violada reprova; divida de conhecimento so e contada.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
source scripts/lib-anvilore.sh

DIR="${1:-wiki}"
TIPOS_VALIDOS="source concept entity"

# Uma wiki que nao existe nao e uma wiki limpa. Sem esta checagem, um caminho
# errado no comando faz o `find` falhar no stderr, o laco nunca roda e a saida
# e "VALIDACAO: PASS" — o erro silencioso que este repositorio inteiro existe
# para desencorajar.
if [ ! -d "$DIR" ]; then
  echo "ERRO: diretorio nao encontrado: $DIR"
  echo "VALIDACAO: FAIL"
  exit 1
fi

erros=0; gaps=0; contradicoes=0; paginas=0

while IFS= read -r arquivo; do
  paginas=$((paginas+1))
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

# Conta index.md e log.md de proposito: uma wiki recem-criada so tem esses dois
# e e valida. Zero arquivo, porem, significa diretorio errado ou wiki sumida.
if [ "$paginas" -eq 0 ]; then
  echo "ERRO: nenhuma pagina .md encontrada em: $DIR"
  echo "VALIDACAO: FAIL"
  exit 1
fi

echo "Divida: $gaps gaps, $contradicoes contradicoes"
echo "Registrar uma contradicao nao e criar uma contradicao — e torna-la visivel."

if [ "$erros" -gt 0 ]; then
  echo "VALIDACAO: FAIL ($erros violacoes de invariante)"; exit 1
fi
echo "VALIDACAO: PASS"
exit 0
