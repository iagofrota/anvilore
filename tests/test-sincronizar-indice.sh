#!/usr/bin/env bash
# B1 — sincronizacao da contagem do header de wiki/<area>/index.md.
#
# Anti-regressao (ver task-spec): a asercao "o modo de checagem nao escreve
# nada" so vale se ela DETECTAR uma escrita quando ela acontece. Por isso o
# teste roda o script SEM --checar sobre o mesmo estado defasado e exige que o
# hash MUDE. Asercao que nao pode falhar nao e asercao.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
SCRIPT="$PWD/scripts/sincronizar-indice.sh"

falhas=0
ok()    { echo "  ok: $*"; }
falha() { echo "  FALHA: $*"; falhas=$((falhas+1)); }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
HOJE="$(date +%F)"

hash_de() { sha256sum "$1" | cut -d' ' -f1; }

# --- fixture sintetica: area 'alfa' com 2 fontes, 1 entidade, 3 conceitos ----
W="$TMP/wiki"
mkdir -p "$W/alfa/sources" "$W/alfa/entities" "$W/alfa/concepts" "$W/_meta" "$W/log"
for n in um dois;      do echo "pagina" > "$W/alfa/sources/f-$n.md";  done
echo "pagina" > "$W/alfa/entities/e-um.md"   # uma so: exercita o singular
for n in um dois tres; do echo "pagina" > "$W/alfa/concepts/c-$n.md"; done

IDX="$W/alfa/index.md"
cat > "$IDX" <<'EOF'
# Indice — alfa

_1 página, 1 fonte, 1 entidade, 1 conceito — Última atualização: 2020-01-01 · + 3 sessoes de retro_

## Conceitos
EOF

# --- 1. sincroniza: contagem corrigida, data de hoje, prosa livre preservada -
if bash "$SCRIPT" "$W" >/dev/null 2>&1; then ok "sincronizacao sai 0"; else falha "sincronizacao saiu != 0"; fi
linha3="$(sed -n '3p' "$IDX")"

for esperado in "6 páginas" "2 fontes" "1 entidade" "3 conceitos" "Última atualização: $HOJE" "+ 3 sessoes de retro"; do
  if printf '%s' "$linha3" | grep -qF -- "$esperado"; then
    ok "header traz '$esperado'"
  else
    falha "header nao traz '$esperado' — linha 3: $linha3"
  fi
done

# Singular vira plural e plural nao vira singular: '1 entidade' continua no
# singular porque ha mesmo 1. Se o script pluralizasse cegamente, isto pegaria.
if printf '%s' "$linha3" | grep -qF "1 entidades"; then
  falha "pluralizou '1 entidade' indevidamente"
else
  ok "concordancia de numero respeitada"
fi

# --- 2. checagem sobre estado ja sincronizado: exit 0 e nada escrito ---------
antes="$(hash_de "$IDX")"
bash "$SCRIPT" "$W" --checar >/dev/null 2>&1; codigo=$?
depois="$(hash_de "$IDX")"
[ "$codigo" -eq 0 ]          && ok "checagem em dia sai 0"            || falha "checagem em dia saiu $codigo"
[ "$antes" = "$depois" ]     && ok "checagem em dia nao escreveu"     || falha "checagem em dia escreveu no index"

# --- 3. desatualiza e checa: exit != 0 e ainda assim nada escrito ------------
echo "pagina" > "$W/alfa/concepts/c-quatro.md"   # agora sao 7 paginas / 4 conceitos
antes="$(hash_de "$IDX")"
bash "$SCRIPT" "$W" --checar >/dev/null 2>&1; codigo=$?
depois="$(hash_de "$IDX")"
[ "$codigo" -ne 0 ]      && ok "checagem defasada sai != 0"       || falha "checagem defasada saiu 0"
[ "$antes" = "$depois" ] && ok "checagem defasada nao escreveu"   || falha "checagem defasada escreveu no index"

# --- 4. PROVA DE DENTES: o mesmo par de hashes DETECTA a escrita -------------
# Sem esta rodada, "o hash nao mudou" poderia significar "o script nem rodou".
bash "$SCRIPT" "$W" >/dev/null 2>&1
escrito="$(hash_de "$IDX")"
if [ "$escrito" != "$antes" ]; then
  ok "sem --checar o hash MUDA (a asercao de nao-escrita tem dentes)"
else
  falha "sem --checar o hash nao mudou — a asercao de nao-escrita e vazia"
fi
if sed -n '3p' "$IDX" | grep -qF "4 conceitos"; then
  ok "sincronizacao pegou a pagina nova"
else
  falha "sincronizacao nao pegou a pagina nova"
fi

# --- 5. area sem index.md: e opcional no anvilore, nao e erro ----------------
mkdir -p "$W/beta/concepts"; echo "pagina" > "$W/beta/concepts/x.md"
if bash "$SCRIPT" "$W" >/dev/null 2>&1; then
  ok "area sem index.md nao reprova (index de area e opcional)"
else
  falha "area sem index.md reprovou"
fi

# --- 6. index de area sem header de contagem: intocado ----------------------
mkdir -p "$W/gama/concepts"
cat > "$W/gama/index.md" <<'EOF'
# Indice — gama

Prosa livre de quem cura, sem header de contagem nenhum.
EOF
antes="$(hash_de "$W/gama/index.md")"
bash "$SCRIPT" "$W" >/dev/null 2>&1; codigo=$?
depois="$(hash_de "$W/gama/index.md")"
[ "$codigo" -eq 0 ]      && ok "index sem header de contagem nao reprova" || falha "index sem header de contagem reprovou ($codigo)"
[ "$antes" = "$depois" ] && ok "index sem header de contagem intocado"    || falha "index sem header de contagem foi reescrito"

# --- 7. header de contagem PARCIAL e defeito, nao estilo --------------------
mkdir -p "$W/delta/concepts"
cat > "$W/delta/index.md" <<'EOF'
# Indice — delta

_2 páginas — Última atualização: 2020-01-01_
EOF
if bash "$SCRIPT" "$W" >/dev/null 2>&1; then
  falha "header de contagem incompleto passou em silencio"
else
  ok "header de contagem incompleto reprova"
fi

# --- 8. diretorios reservados nao sao areas ---------------------------------
# _meta/ e log/ nao tem index de area; se o script os tomasse por area, o passo
# 7 acima ja teria reprovado por outro motivo. Aqui provamos direto.
saida="$(bash "$SCRIPT" "$W" 2>&1)"
if printf '%s' "$saida" | grep -qE '(_meta|log)'; then
  falha "script tratou diretorio reservado como area: $saida"
else
  ok "diretorios reservados ignorados"
fi

# --- 9. a wiki versionada do proprio repositorio continua verde -------------
if bash "$SCRIPT" wiki >/dev/null 2>&1; then
  ok "wiki do repositorio passa (clone limpo verde)"
else
  falha "wiki do repositorio reprovou na sincronizacao"
fi

[ "$falhas" -eq 0 ] && echo "OK: sincronizar-indice"
exit "$falhas"
