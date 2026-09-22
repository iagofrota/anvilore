#!/usr/bin/env bash
# C1-C5 — a varredura estrutural que a skill de lint roda.
#
# Cada criterio e exercitado em PAR: o estado defeituoso tem de aparecer na
# secao certa, e o estado corrigido tem de SAIR dela. Asercao que so observa o
# defeito nao distingue "a varredura detectou" de "a varredura lista tudo".
#
# As fixtures vivem inteiras em diretorio temporario: nenhuma toca o `wiki/`
# versionado deste repositorio (o passo final prova isso por hash).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
SCRIPT="$PWD/scripts/auditar-wiki.py"

falhas=0
ok()    { echo "  ok: $*"; }
falha() { echo "  FALHA: $*"; falhas=$((falhas+1)); }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
W="$TMP/wiki"
SAIDA="$TMP/saida.txt"

roda() { python3 "$SCRIPT" "$W" > "$SAIDA" 2>"$TMP/err.txt"; echo $?; }

# secao <titulo> -> ecoa so as linhas daquela secao do ultimo relatorio.
# Extrair por secao (em vez de grep no relatorio inteiro) e o que impede um
# caminho listado como "frontmatter incompleto" de satisfazer uma asercao sobre
# "paginas orfas".
secao() {
  awk -v t="$1" '
    $0 ~ "^## " t { dentro=1; next }
    /^## / { dentro=0 }
    dentro
  ' "$SAIDA"
}

na_secao()  { secao "$1" | grep -qF -- "$2"; }

# pagina <caminho-relativo-a-W> <tipo> <corpo...>
pagina() {
  local rel="$1" tipo="$2"; shift 2
  local slug; slug="$(basename "$rel" .md)"
  mkdir -p "$(dirname "$W/$rel")"
  {
    echo '---'
    echo "title: \"$slug\""
    echo "slug: $slug"
    echo "type: $tipo"
    echo 'tags: []'
    case "$tipo" in
      source) echo 'original_file: raw/exemplo/f.md'; echo 'date_ingested: 2026-01-01'; echo 'authors: []' ;;
      *)      echo 'related_sources: []'; echo 'related_concepts: []' ;;
    esac
    echo '---'
    echo
    printf '%s\n' "$@"
  } > "$W/$rel"
}

indice() {
  mkdir -p "$W"
  { echo '# Índice'; echo; echo '## Área: exemplo'; echo; echo '### Conceitos'; echo
    for slug in "$@"; do echo "- [[$slug]] — resumo"; done
  } > "$W/index.md"
  echo '# Log' > "$W/log.md"
}

CORPO=("linha um do corpo" "linha dois do corpo" "linha tres do corpo")

# ============================================================================
# Estado base: duas paginas completas, ambas no indice, sem link entre si.
# ============================================================================
pagina exemplo/concepts/alfa.md concept "${CORPO[@]}"
pagina exemplo/concepts/beta.md concept "${CORPO[@]}"
indice alfa beta

# ============================================================================
# C1 — paginas orfas
# ============================================================================
roda >/dev/null
if na_secao "Páginas órfãs" "exemplo/concepts/alfa.md"; then
  ok "C1: pagina sem wikilink de entrada aparece como orfa"
else
  falha "C1: alfa.md nao apareceu na secao de orfas"
fi

# Controle: beta passa a linkar alfa. Alfa sai da lista; beta continua nela —
# se a secao esvaziasse inteira, a asercao nao mediria nada.
printf '\nVeja tambem [[alfa]].\n' >> "$W/exemplo/concepts/beta.md"
roda >/dev/null
if na_secao "Páginas órfãs" "exemplo/concepts/alfa.md"; then
  falha "C1: alfa.md continuou orfa depois de receber wikilink"
else
  ok "C1: wikilink de entrada tira a pagina da lista de orfas"
fi
if na_secao "Páginas órfãs" "exemplo/concepts/beta.md"; then
  ok "C1: beta.md continua orfa (a secao nao esvaziou por acidente)"
else
  falha "C1: beta.md sumiu da lista de orfas sem receber wikilink"
fi

# ============================================================================
# C2 — entradas ausentes do indice
# ============================================================================
pagina exemplo/concepts/gama.md concept "${CORPO[@]}"
roda >/dev/null
if na_secao "Entradas ausentes do índice" "exemplo/concepts/gama.md"; then
  ok "C2: pagina fora do indice aparece como entrada ausente"
else
  falha "C2: gama.md nao apareceu na secao de entradas ausentes"
fi
if na_secao "Entradas ausentes do índice" "exemplo/concepts/alfa.md"; then
  falha "C2: alfa.md (que esta no indice) apareceu como ausente"
else
  ok "C2: pagina indexada nao aparece como ausente"
fi

indice alfa beta gama
roda >/dev/null
if na_secao "Entradas ausentes do índice" "exemplo/concepts/gama.md"; then
  falha "C2: gama.md continuou ausente depois de entrar no indice"
else
  ok "C2: entrada no indice tira a pagina da lista de ausentes"
fi

# ============================================================================
# C3 — wikilinks quebrados
# ============================================================================
pagina exemplo/concepts/delta.md concept "Aponta para [[pagina-que-nao-existe]]." "${CORPO[@]}"
indice alfa beta gama delta
roda >/dev/null
linha_c3="$(secao "Wikilinks quebrados" | grep -F 'exemplo/concepts/delta.md' || true)"
if [ -n "$linha_c3" ]; then
  ok "C3: a pagina de origem aparece na secao de wikilinks quebrados"
else
  falha "C3: delta.md nao apareceu na secao de wikilinks quebrados"
fi
if printf '%s' "$linha_c3" | grep -qF 'pagina-que-nao-existe'; then
  ok "C3: o slug alvo e nomeado na mesma linha da origem"
else
  falha "C3: o slug alvo nao foi nomeado junto da origem: $linha_c3"
fi

pagina exemplo/concepts/pagina-que-nao-existe.md concept "${CORPO[@]}"
roda >/dev/null
if secao "Wikilinks quebrados" | grep -qF 'pagina-que-nao-existe'; then
  falha "C3: o link continuou quebrado depois de a pagina alvo existir"
else
  ok "C3: criar a pagina alvo tira o par da lista de quebrados"
fi

# ============================================================================
# C4 — frontmatter incompleto
# ============================================================================
mkdir -p "$W/exemplo/concepts"
cat > "$W/exemplo/concepts/epsilon.md" <<'EOF'
---
title: "epsilon"
type: concept
tags: []
related_sources: []
related_concepts: []
---

linha um do corpo
linha dois do corpo
linha tres do corpo
EOF
roda >/dev/null
linha_c4="$(secao "Frontmatter incompleto" | grep -F 'exemplo/concepts/epsilon.md' || true)"
if [ -n "$linha_c4" ]; then
  ok "C4: pagina com campo obrigatorio ausente aparece na secao"
else
  falha "C4: epsilon.md nao apareceu na secao de frontmatter incompleto"
fi
if printf '%s' "$linha_c4" | grep -qF 'slug'; then
  ok "C4: o campo ausente e nomeado"
else
  falha "C4: o campo ausente nao foi nomeado: $linha_c4"
fi

# Controle: acrescenta o campo; a pagina sai da lista.
python3 - "$W/exemplo/concepts/epsilon.md" <<'EOF'
import sys
p = sys.argv[1]
t = open(p, encoding="utf-8").read()
open(p, "w", encoding="utf-8").write(t.replace("type: concept", "slug: epsilon\ntype: concept", 1))
EOF
roda >/dev/null
if na_secao "Frontmatter incompleto" "exemplo/concepts/epsilon.md"; then
  falha "C4: epsilon.md continuou incompleta depois de ganhar o campo slug"
else
  ok "C4: acrescentar o campo tira a pagina da lista"
fi

# ============================================================================
# C5 — paginas vazias ou esboco
# ============================================================================
pagina exemplo/concepts/zeta.md concept "uma linha so de corpo"
roda >/dev/null
if na_secao "Páginas vazias ou esboço" "exemplo/concepts/zeta.md"; then
  ok "C5: pagina com corpo de 1 linha aparece como esboco"
else
  falha "C5: zeta.md nao apareceu na secao de vazias/esboco"
fi
if na_secao "Páginas vazias ou esboço" "exemplo/concepts/alfa.md"; then
  falha "C5: alfa.md (corpo de 3 linhas) apareceu como esboco"
else
  ok "C5: pagina com 3 linhas de corpo nao e esboco"
fi

pagina exemplo/concepts/zeta.md concept "${CORPO[@]}"
roda >/dev/null
if na_secao "Páginas vazias ou esboço" "exemplo/concepts/zeta.md"; then
  falha "C5: zeta.md continuou esboco depois de ganhar corpo"
else
  ok "C5: completar o corpo tira a pagina da lista"
fi

# ============================================================================
# Wiki sem problema nenhum: saida 0 e as cinco secoes zeradas
# ============================================================================
L="$TMP/limpa"
W_ANTERIOR="$W"; W="$L"
pagina concepts/um.md   concept "Liga para [[dois]]." "${CORPO[@]}"
pagina concepts/dois.md concept "Liga para [[um]]."   "${CORPO[@]}"
indice um dois
codigo="$(roda)"
[ "$codigo" -eq 0 ] && ok "wiki sem problema sai 0" || falha "wiki sem problema saiu $codigo (saida: $(cat "$SAIDA"))"
for titulo in "Páginas órfãs" "Entradas ausentes do índice" "Wikilinks quebrados" "Frontmatter incompleto" "Páginas vazias ou esboço"; do
  corpo="$(secao "$titulo" | grep -c '^- ' || true)"
  [ "$corpo" -eq 0 ] && ok "wiki limpa: '$titulo' vazia" || falha "wiki limpa: '$titulo' listou $corpo item(ns)"
done
W="$W_ANTERIOR"

# Saida != 0 quando ha problema — a asercao acima so tem dentes se o codigo
# distinguir os dois estados.
codigo="$(roda)"
[ "$codigo" -ne 0 ] && ok "wiki com problema sai != 0" || falha "wiki com problema saiu 0"

# ============================================================================
# A varredura e somente leitura: nao escreve na wiki versionada nem na fixture
# ============================================================================
antes="$(find wiki -type f -exec sha256sum {} + | sort | sha256sum)"
python3 "$SCRIPT" wiki >/dev/null 2>&1
depois="$(find wiki -type f -exec sha256sum {} + | sort | sha256sum)"
[ "$antes" = "$depois" ] && ok "rodar sobre a wiki do repositorio nao escreve nada" \
                         || falha "a varredura escreveu na wiki do repositorio"

# Nao basta nao escrever: tem de rodar. Uma wiki que nao produz relatorio
# nenhum tornaria a asercao acima verdadeira por vacuidade.
relatorio_do_repo="$(python3 "$SCRIPT" wiki 2>/dev/null)"
if printf '%s' "$relatorio_do_repo" | grep -q '^## Páginas órfãs'; then
  ok "a varredura produz relatorio sobre a wiki do repositorio"
else
  falha "a varredura nao produziu relatorio sobre a wiki do repositorio"
fi

# Wiki inexistente nao e wiki limpa.
python3 "$SCRIPT" "$TMP/nao-existe" >/dev/null 2>&1
[ $? -ne 0 ] && ok "diretorio inexistente sai != 0" || falha "diretorio inexistente saiu 0"

[ "$falhas" -eq 0 ] && echo "OK: auditar-wiki"
exit "$falhas"
