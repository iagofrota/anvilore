#!/usr/bin/env bash
# fechar-wiki.sh — ritual de fechamento de uma sessao na wiki.
# Roda o ritual inteiro numa chamada e cobra o que nao e derivavel.
# Exit 0 = fechado; 1 = falta algo.
#
# Uso: bash scripts/fechar-wiki.sh [raiz-da-wiki]
#   ANVILORE_PULAR_GATE_LOG=1   pula o gate do log do dia (escape explicito).
#
# Passos, nesta ordem — PARA no primeiro que falhar:
#   1. sincronizar-indice.sh   contagem do header a partir do disco
#   2. indexar-log.sh          reconstroi <WIKI>/log.md
#   3. validar-wiki.sh         validacao estrutural
#   4. gate do log do dia      pagina curada alterada hoje exige entrada no log
#
# Parar no primeiro que falha nao e economia: e nao deixar o passo seguinte
# reescrever um arquivo derivado a partir de um estado que ja se sabe errado.
#
# Adaptacao ao anvilore, no passo 4: a origem descobria "o que mudou hoje" pelo
# git (working tree + commits do dia). Aqui isso seria um gate sem dentes — no
# anvilore o conteudo de `wiki/` fica FORA do git de proposito (ver
# `wiki/.gitignore`: o repositorio carrega o metodo, o conteudo e de quem usa),
# entao `git status` nunca veria uma pagina curada mudar. O gate usa mtime:
# pagina `.md` modificada depois da meia-noite de hoje. Ignora o que o proprio
# ritual deriva (`index.md`, `log.md`) e os diretorios reservados (`_meta/`,
# `log/`), cuja lista pertence a `scripts/lib-anvilore.sh`.
set -uo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib-anvilore.sh
source "$AQUI/lib-anvilore.sh"

WIKI_ARG="${1:-wiki}"
if [ ! -d "$WIKI_ARG" ]; then
  echo "FECHAMENTO: FAIL — raiz da wiki nao encontrada: $WIKI_ARG"
  exit 1
fi
# Absoluto: `validar-wiki.sh` faz `cd` para a raiz do repositorio antes de
# usar o caminho, entao um caminho relativo ao diretorio de quem chamou
# apontaria para o lugar errado la dentro.
WIKI="$(cd "$WIKI_ARG" && pwd)"
HOJE="$(date +%F)"

passo() { echo; echo "── $* ──"; }

passo "1/4 sincronizar-indice"
bash "$AQUI/sincronizar-indice.sh" "$WIKI" \
  || { echo "FECHAMENTO: FAIL no passo sincronizar-indice"; exit 1; }

passo "2/4 indexar-log"
bash "$AQUI/indexar-log.sh" "$WIKI" \
  || { echo "FECHAMENTO: FAIL no passo indexar-log"; exit 1; }

passo "3/4 validar-wiki"
bash "$AQUI/validar-wiki.sh" "$WIKI" \
  || { echo "FECHAMENTO: FAIL no passo validar-wiki"; exit 1; }

passo "4/4 gate do log do dia"
if [ "${ANVILORE_PULAR_GATE_LOG:-0}" = "1" ]; then
  echo "gate pulado por ANVILORE_PULAR_GATE_LOG=1"
  echo "FECHAMENTO: OK"; exit 0
fi

# Paginas curadas tocadas hoje, por mtime. Devolve caminhos relativos a $WIKI.
curadas() {
  local arquivo rel base
  while IFS= read -r arquivo; do
    rel="${arquivo#"$WIKI"/}"
    base="$(basename "$rel")"
    [ "$base" = "index.md" ] && continue
    [ "$base" = "log.md" ] && continue
    em_dir_reservado "$WIKI" "$arquivo" && continue
    printf '%s\n' "$rel"
  done < <(find "$WIKI" -name '*.md' -type f -newermt "$HOJE 00:00:00" 2>/dev/null | sort)
}

tocadas="$(curadas)"
if [ -z "$tocadas" ]; then
  echo "nenhuma pagina curada alterada hoje — nada a cobrar"
  echo "FECHAMENTO: OK"; exit 0
fi

log_dia="$WIKI/log/log-$HOJE.md"
if [ -f "$log_dia" ] && grep -q "^## \[$HOJE\]" "$log_dia"; then
  echo "log do dia presente: $log_dia"
  echo "FECHAMENTO: OK"; exit 0
fi

echo "FAIL: paginas curadas alteradas hoje sem entrada em log/log-$HOJE.md:"
echo "$tocadas" | sed 's/^/  - /'
echo
echo "Escreva a entrada no formato '## [$HOJE] <tipo> | <o que mudou>' e rode de novo."
echo "(ou ANVILORE_PULAR_GATE_LOG=1 para pular conscientemente)"
echo "FECHAMENTO: FAIL"
exit 1

# Este script é obra derivada de `wiki-wonka`
# (https://github.com/cooperacode/wiki-wonka) (Coopera Code, licença MIT),
# traduzido para português do Brasil e adaptado. Aviso de copyright original
# em `LICENSE`.
