#!/usr/bin/env bash
# B5 — rejunta paragrafo/item/blockquote quebrados a mao de volta a uma linha.
#
# Anti-regressao: a asercao "o modo simulacao nao escreve nada" e provada por
# mutacao — o mesmo par de hashes e usado numa rodada SEM simulacao, onde ele
# TEM de acusar a mudanca.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
SCRIPT="$PWD/scripts/rejuntar-linhas.py"

falhas=0
ok()    { echo "  ok: $*"; }
falha() { echo "  FALHA: $*"; falhas=$((falhas+1)); }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
P="$TMP/quebrada.md"

hash_de() { sha256sum "$1" | cut -d' ' -f1; }

cat > "$P" <<'EOF'
---
title: "Quebrada"
slug: quebrada
type: concept
tags: []
---

## Secao

Este e um paragrafo de prosa que foi quebrado manualmente em tres linhas
diferentes para caber em noventa e cinco colunas, o que o renderizador exibe
como tres quebras visuais em vez de um paragrafo continuo.

- Um item de lista que tambem foi quebrado manualmente em duas linhas
  seguidas, com a continuacao indentada.

> Um blockquote que foi quebrado manualmente em duas linhas e precisa voltar
> a ser uma linha so.

| coluna a | coluna b |
|---|---|
| valor um | valor dois |

```bash
echo "primeira linha do fence"
echo "segunda linha do fence"
```
EOF

cp "$P" "$TMP/original.md"
trecho_fence() { sed -n '/^```bash$/,/^```$/p' "$1"; }
trecho_tabela() { grep '^|' "$1"; }

# --- 1. simulacao: nao escreve, mas aponta o arquivo ------------------------
antes="$(hash_de "$P")"
saida="$(python3 "$SCRIPT" "$P" --simular 2>&1)"; codigo=$?
depois="$(hash_de "$P")"
[ "$codigo" -eq 0 ]      && ok "simulacao sai 0"                  || falha "simulacao saiu $codigo"
[ "$antes" = "$depois" ] && ok "simulacao nao escreveu"           || falha "simulacao escreveu no arquivo"
printf '%s' "$saida" | grep -q 'mudariam' && ok "relatorio diz quantos mudariam" || falha "relatorio nao usa 'mudariam': $saida"
printf '%s' "$saida" | grep -qF "quebrada.md" && ok "relatorio nomeia o arquivo" || falha "relatorio nao nomeia o arquivo: $saida"

# --- 2. simulacao + diff: imprime diff unificado, continua sem escrever -----
antes="$(hash_de "$P")"
dsaida="$(python3 "$SCRIPT" "$P" --simular --diff 2>/dev/null)"
depois="$(hash_de "$P")"
[ "$antes" = "$depois" ] && ok "--diff nao escreve" || falha "--diff escreveu no arquivo"
if printf '%s' "$dsaida" | grep -q '^@@' && printf '%s' "$dsaida" | grep -q '^---'; then
  ok "--diff imprime diff unificado"
else
  falha "--diff nao imprimiu diff unificado: $dsaida"
fi

# --- 3. execucao real: os tres blocos viram uma linha cada ------------------
python3 "$SCRIPT" "$P" >/dev/null 2>&1; codigo=$?
[ "$codigo" -eq 0 ] && ok "execucao real sai 0" || falha "execucao real saiu $codigo"

esperado_par='Este e um paragrafo de prosa que foi quebrado manualmente em tres linhas diferentes para caber em noventa e cinco colunas, o que o renderizador exibe como tres quebras visuais em vez de um paragrafo continuo.'
esperado_item='- Um item de lista que tambem foi quebrado manualmente em duas linhas seguidas, com a continuacao indentada.'
esperado_quote='> Um blockquote que foi quebrado manualmente em duas linhas e precisa voltar a ser uma linha so.'

grep -qxF -- "$esperado_par"   "$P" && ok "paragrafo rejuntado numa linha"  || falha "paragrafo nao rejuntado"
grep -qxF -- "$esperado_item"  "$P" && ok "item de lista rejuntado numa linha" || falha "item de lista nao rejuntado"
grep -qxF -- "$esperado_quote" "$P" && ok "blockquote rejuntado numa linha" || falha "blockquote nao rejuntado"

# --- 4. fence, tabela, frontmatter e headings intocados --------------------
if diff <(trecho_fence "$TMP/original.md") <(trecho_fence "$P") >/dev/null; then
  ok "code fence bit-a-bit intacto"
else
  falha "code fence foi alterado:"; diff <(trecho_fence "$TMP/original.md") <(trecho_fence "$P") | sed 's/^/    /'
fi
if diff <(trecho_tabela "$TMP/original.md") <(trecho_tabela "$P") >/dev/null; then
  ok "linhas de tabela bit-a-bit intactas"
else
  falha "tabela foi alterada:"; diff <(trecho_tabela "$TMP/original.md") <(trecho_tabela "$P") | sed 's/^/    /'
fi
if diff <(sed -n '1,6p' "$TMP/original.md") <(sed -n '1,6p' "$P") >/dev/null; then
  ok "frontmatter intacto"
else
  falha "frontmatter alterado"
fi
grep -qx '## Secao' "$P" && ok "heading intacto" || falha "heading alterado"

# --- 5. PROVA DE DENTES -----------------------------------------------------
# O par de hashes do passo 1 tem de acusar uma escrita. Restaura o original e
# roda SEM simulacao: o hash TEM de mudar.
cp "$TMP/original.md" "$P"
antes="$(hash_de "$P")"
python3 "$SCRIPT" "$P" >/dev/null 2>&1
depois="$(hash_de "$P")"
if [ "$antes" != "$depois" ]; then
  ok "sem --simular o hash MUDA (a asercao de nao-escrita tem dentes)"
else
  falha "sem --simular o hash nao mudou — a asercao de nao-escrita e vazia"
fi

# --- 6. idempotencia: rodar de novo num arquivo ja rejuntado nao muda nada --
antes="$(hash_de "$P")"
python3 "$SCRIPT" "$P" >/dev/null 2>&1
depois="$(hash_de "$P")"
[ "$antes" = "$depois" ] && ok "segunda passada nao muda nada" || falha "segunda passada alterou o arquivo"

# --- 7. diretorio como alvo: varre .md recursivamente ----------------------
D="$TMP/dir"; mkdir -p "$D/sub"
printf 'Uma linha so.\n' > "$D/limpa.md"
printf 'Linha uma que continua\nna linha dois.\n' > "$D/sub/suja.md"
saida="$(python3 "$SCRIPT" "$D" --simular 2>&1)"
printf '%s' "$saida" | grep -q '1/2 arquivos mudariam' \
  && ok "alvo diretorio conta 1 de 2 arquivos" || falha "contagem por diretorio errada: $saida"

[ "$falhas" -eq 0 ] && echo "OK: rejuntar-linhas"
exit "$falhas"
