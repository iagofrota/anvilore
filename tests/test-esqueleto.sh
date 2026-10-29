#!/usr/bin/env bash
# Verifica o esqueleto de areas versionado em modelos/, a fronteira do .gitignore, o
# indice coerente com as paginas do esqueleto, e o README honesto sobre o esqueleto.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
source scripts/lib-anvilore.sh

falhas=0

# A7 — o esqueleto de areas vem versionado em modelos/ (o kit nao rastreia mais wiki/,
# raw/ nem SCHEMA.md: sao de quem usa, e o `instalar` copia o esqueleto de modelos/).
for d in modelos/wiki/exemplo/sources modelos/wiki/exemplo/entities modelos/wiki/exemplo/concepts modelos/wiki/_meta modelos/wiki/log; do
  if git ls-files --error-unmatch "$d/.gitkeep" >/dev/null 2>&1; then
    echo "  ok: versionado $d/.gitkeep"
  else
    echo "  FALHA: $d/.gitkeep nao esta versionado"; falhas=$((falhas+1))
  fi
done
if git ls-files --error-unmatch modelos/wiki/exemplo/concepts/area-tematica.md >/dev/null 2>&1; then
  echo "  ok: pagina de exemplo versionada em modelos/"
else
  echo "  FALHA: pagina de exemplo nao esta versionada em modelos/"; falhas=$((falhas+1))
fi

# A7 — tudo em wiki/, raw/ e SCHEMA.md e ignorado pelo kit (fica com quem usa).
# check-ignore --no-index tem dentes aqui mesmo num clone antigo que ainda os tenha.
for alvo in wiki/index.md wiki/exemplo/concepts/pagina-de-conteudo-do-usuario.md raw/fonte.md SCHEMA.md; do
  if git check-ignore -q --no-index "$alvo"; then
    echo "  ok: ignorado $alvo"
  else
    echo "  FALHA: git nao ignora $alvo"; falhas=$((falhas+1))
  fi
done
if [ -z "$(git ls-files -- wiki raw SCHEMA.md)" ]; then
  echo "  ok: nada de quem usa e rastreado pelo kit"
else
  echo "  FALHA: o kit ainda rastreia arquivos de quem usa"; falhas=$((falhas+1))
fi

# A10 — toda pagina do esqueleto (fora index/log e fora dos reservados) esta
# listada no indice do esqueleto. Uma pagina fora do indice faz o kit se contradizer:
# a skill de consulta declara a wiki vazia enquanto ela nao esta.
while IFS= read -r pag; do
  rel="${pag#modelos/}"
  case "$rel" in
    wiki/index.md|wiki/log.md) continue ;;
  esac
  # A lista de reservados tem um dono so — a lib —, e este teste pergunta a ela.
  em_dir_reservado wiki "$rel" && continue
  slug="$(basename "$pag" .md)"
  if grep -q "\[\[$slug\]\]" modelos/wiki/index.md || grep -qF "$slug" modelos/wiki/index.md; then
    echo "  ok: indexada $rel"
  else
    echo "  FALHA: pagina do esqueleto fora do indice: $rel"; falhas=$((falhas+1))
  fi
done < <(git ls-files -- modelos/wiki/ | grep -E '\.md$')

# A11 — o README nao afirma nada falso sobre o esqueleto que vem no clone.
# As crases sao literais do texto do README, nao expansao de comando (SC2016).
# shellcheck disable=SC2016
if grep -qE 'clonar é plano|só `wiki/index\.md`|sem `wiki/<área>/`' README.md; then
  echo "  FALHA: README ainda afirma que o clone e plano/sem areas"; falhas=$((falhas+1))
else
  echo "  ok: README nao afirma clone plano"
fi
if grep -q 'wiki/exemplo' README.md; then
  echo "  ok: README descreve a area de exemplo do clone"
else
  echo "  FALHA: README nao menciona o esqueleto de areas presente no clone"; falhas=$((falhas+1))
fi

[ "$falhas" -eq 0 ] && echo "OK: esqueleto"
exit "$falhas"
