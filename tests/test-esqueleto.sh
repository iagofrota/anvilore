#!/usr/bin/env bash
# Verifica o esqueleto de areas versionado e a fronteira do .gitignore:
# o metodo entra no git, o conteudo de quem usa fica de fora.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

falhas=0

# A7 — o esqueleto de areas vem versionado no clone.
for d in wiki/exemplo/sources wiki/exemplo/entities wiki/exemplo/concepts wiki/_meta wiki/log; do
  if git ls-files --error-unmatch "$d/.gitkeep" >/dev/null 2>&1; then
    echo "  ok: versionado $d/.gitkeep"
  else
    echo "  FALHA: $d/.gitkeep nao esta versionado"; falhas=$((falhas+1))
  fi
done

# A7 — conteudo novo dentro de uma area e ignorado pelo git (fica com quem usa).
nova="wiki/exemplo/concepts/pagina-de-conteudo-do-usuario.md"
if git check-ignore -q "$nova"; then
  echo "  ok: conteudo novo em area e ignorado"
else
  echo "  FALHA: git nao ignora conteudo novo em area ($nova)"; falhas=$((falhas+1))
fi

# ...mas a pagina de exemplo do esqueleto NAO e ignorada — ela e o metodo.
if git check-ignore -q wiki/exemplo/concepts/area-tematica.md; then
  echo "  FALHA: a pagina de exemplo foi ignorada pelo git"; falhas=$((falhas+1))
else
  echo "  ok: pagina de exemplo versionada (nao ignorada)"
fi

[ "$falhas" -eq 0 ] && echo "OK: esqueleto"
exit "$falhas"
