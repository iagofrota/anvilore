#!/usr/bin/env bash
# Verifica o esqueleto de areas versionado, a fronteira do .gitignore, o indice
# coerente com as paginas versionadas, e o README honesto sobre o proprio clone.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
source scripts/lib-anvilore.sh

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
# check-ignore tem dentes aqui porque o caminho e nao-rastreado.
nova="wiki/exemplo/concepts/pagina-de-conteudo-do-usuario.md"
if git check-ignore -q "$nova"; then
  echo "  ok: conteudo novo em area e ignorado"
else
  echo "  FALHA: git nao ignora conteudo novo em area ($nova)"; falhas=$((falhas+1))
fi

# ...mas a pagina de exemplo do esqueleto e versionada. Instrumento correto para
# arquivo rastreado e ls-files --error-unmatch — check-ignore nunca reporta
# rastreado como ignorado, entao nao serviria como asercao.
if git ls-files --error-unmatch wiki/exemplo/concepts/area-tematica.md >/dev/null 2>&1; then
  echo "  ok: pagina de exemplo versionada"
else
  echo "  FALHA: pagina de exemplo nao esta versionada"; falhas=$((falhas+1))
fi

# A7 (visibilidade) — o esqueleto versionado tem de aparecer numa busca que
# respeita o .gitignore, SEM --no-ignore. O ripgrep nao reincluia um arquivo cujo
# diretorio-avo o `.gitignore` da raiz excluia com wiki/*, entao escondia a pagina
# que o git rastreia — e quem usa o kit nao a encontrava. (Requer rg; sem ele,
# nao ha o que checar.)
if command -v rg >/dev/null 2>&1; then
  if rg --files wiki/ | grep -qx 'wiki/exemplo/concepts/area-tematica.md'; then
    echo "  ok: rg --files enxerga a pagina de exemplo versionada"
  else
    echo "  FALHA: rg --files nao lista a pagina de exemplo (esqueleto invisivel a busca)"; falhas=$((falhas+1))
  fi
else
  echo "  skip: rg ausente — visibilidade nao checada"
fi

# A10 — toda pagina de wiki versionada (fora index/log e fora dos reservados) esta
# listada no indice. Uma pagina versionada fora do indice faz o kit se contradizer:
# a skill de consulta declara a wiki vazia enquanto ela nao esta.
while IFS= read -r pag; do
  case "$pag" in
    wiki/index.md|wiki/log.md) continue ;;
  esac
  # Diretorios reservados nao guardam pagina de wiki, entao nao se espera que
  # estejam no indice. A lista de reservados tem um dono so — a lib —, e este
  # teste pergunta a ela em vez de repetir 'wiki/_meta/*|wiki/log/*'.
  em_dir_reservado wiki "$pag" && continue
  slug="$(basename "$pag" .md)"
  if grep -q "\[\[$slug\]\]" wiki/index.md || grep -qF "$slug" wiki/index.md; then
    echo "  ok: indexada $pag"
  else
    echo "  FALHA: pagina versionada fora do indice: $pag"; falhas=$((falhas+1))
  fi
done < <(git ls-files -- wiki/ | grep -E '\.md$')

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
