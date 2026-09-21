#!/usr/bin/env bash
# B6 — move paginas para areas conforme um mapa de roteamento e injeta `area:`.
#
# O mapa e SINTETICO e vive num diretorio temporario. Nenhum mapa de roteamento
# real entra no repositorio, e este teste nunca toca no wiki/ versionado: ele
# MOVE arquivos.
#
# Anti-regressao: a asercao "a simulacao nao moveu nada" e provada por mutacao
# — a mesma verificacao roda depois SEM simulacao, onde ela TEM de acusar o
# movimento.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
SCRIPT="$PWD/scripts/migrar-areas.sh"

falhas=0
ok()    { echo "  ok: $*"; }
falha() { echo "  FALHA: $*"; falhas=$((falhas+1)); }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
W="$TMP/wiki"
mkdir -p "$W/_meta" "$W/log" "$W/sources"

pagina() { # pagina <caminho> <slug> <tipo>
  printf -- '---\ntitle: "%s"\nslug: %s\ntype: %s\ntags: []\n---\n\nCorpo da pagina %s.\n' \
    "$2" "$2" "$3" "$2" > "$1"
}
pagina "$W/pagina-um.md"          pagina-um   concept
pagina "$W/sources/pagina-dois.md" pagina-dois source

cat > "$W/_meta/migration-routing.md" <<'EOF'
# Roteamento de migracao (fixture sintetica)

<!-- ROUTING-START -->
| page | area |
|---|---|
| pagina-um | alfa |
| sources/pagina-dois | beta |
<!-- ROUTING-END -->
EOF

# --- 1. simulacao: nada se move, os 2 movimentos sao relatados -------------
saida="$(bash "$SCRIPT" "$W" --simular 2>&1)"; codigo=$?
[ "$codigo" -eq 0 ] && ok "simulacao sai 0" || falha "simulacao saiu $codigo: $saida"
[ -f "$W/pagina-um.md" ]           && ok "pagina-um nao se moveu na simulacao"   || falha "pagina-um se moveu na simulacao"
[ -f "$W/sources/pagina-dois.md" ] && ok "pagina-dois nao se moveu na simulacao" || falha "pagina-dois se moveu na simulacao"
[ ! -d "$W/alfa" ] && ok "diretorio de area nao foi criado na simulacao" || falha "simulacao criou $W/alfa"

relatados="$(printf '%s\n' "$saida" | grep -c '^moveria: ')"
[ "$relatados" -eq 2 ] && ok "simulacao relata os 2 movimentos" || falha "simulacao relatou $relatados movimentos: $saida"
printf '%s' "$saida" | grep -q 'pagina-um → alfa'          && ok "relata pagina-um → alfa"   || falha "nao relatou pagina-um → alfa"
printf '%s' "$saida" | grep -q 'sources/pagina-dois → beta' && ok "relata pagina-dois → beta" || falha "nao relatou pagina-dois → beta"

# --- 2. PROVA DE DENTES + execucao real ------------------------------------
# As mesmas verificacoes do passo 1 rodam agora sem simulacao. Se elas nao
# mudarem de resultado, elas nao verificavam nada.
saida="$(bash "$SCRIPT" "$W" 2>&1)"; codigo=$?
[ "$codigo" -eq 0 ] && ok "execucao real sai 0" || falha "execucao real saiu $codigo: $saida"

if [ ! -f "$W/pagina-um.md" ] && [ -f "$W/alfa/pagina-um.md" ]; then
  ok "pagina-um movida para alfa/ (a verificacao da simulacao tem dentes)"
else
  falha "pagina-um nao foi movida"
fi
if [ ! -f "$W/sources/pagina-dois.md" ] && [ -f "$W/beta/sources/pagina-dois.md" ]; then
  ok "pagina-dois movida para beta/sources/"
else
  falha "pagina-dois nao foi movida"
fi

# --- 3. `area:` injetado logo apos `type:`, sem duplicar -------------------
conferir_area() { # conferir_area <arquivo> <area>
  local f="$1" a="$2" n linha_type linha_area
  n="$(grep -c '^area: ' "$f")"
  if [ "$n" -ne 1 ]; then falha "$f tem $n campos 'area:' (esperado 1)"; return; fi
  grep -qx "area: $a" "$f" || { falha "$f nao declara 'area: $a'"; return; }
  linha_type="$(grep -n '^type: ' "$f" | head -1 | cut -d: -f1)"
  linha_area="$(grep -n '^area: ' "$f" | head -1 | cut -d: -f1)"
  if [ "$linha_area" -eq $((linha_type + 1)) ]; then
    ok "$(basename "$f"): 'area: $a' logo apos 'type:'"
  else
    falha "$(basename "$f"): 'area:' na linha $linha_area, 'type:' na $linha_type"
  fi
}
conferir_area "$W/alfa/pagina-um.md" alfa
conferir_area "$W/beta/sources/pagina-dois.md" beta

grep -q 'Corpo da pagina pagina-um' "$W/alfa/pagina-um.md" \
  && ok "corpo da pagina preservado na migracao" || falha "corpo da pagina perdido"

# --- 4. terceira execucao sobre o novo estado: nao duplica `area:` ---------
bash "$SCRIPT" "$W" >/dev/null 2>&1; codigo=$?
[ "$codigo" -eq 0 ] && ok "terceira execucao sai 0" || falha "terceira execucao saiu $codigo"
for f in "$W/alfa/pagina-um.md" "$W/beta/sources/pagina-dois.md"; do
  n="$(grep -c '^area: ' "$f")"
  [ "$n" -eq 1 ] && ok "$(basename "$f"): continua com 1 campo 'area:'" || falha "$(basename "$f"): $n campos 'area:' apos a terceira execucao"
done

# --- 5. diretorio de tipo do layout plano, agora vazio, e removido --------
[ ! -d "$W/sources" ] && ok "sources/ vazio removido" || falha "sources/ vazio nao foi removido"

# --- 6. diretorio reservado vazio NAO e removido --------------------------
# log/ esta vazio neste teste. Se o script o apagasse, o esqueleto do clone
# perderia um diretorio que o SCHEMA declara reservado.
[ -d "$W/log" ] && ok "log/ reservado preservado mesmo vazio" || falha "script apagou o diretorio reservado log/"
[ -d "$W/_meta" ] && ok "_meta/ reservado preservado" || falha "script apagou o diretorio reservado _meta/"

# --- 7. pagina listada no mapa mas ausente do disco: avisa e segue --------
cat > "$W/_meta/migration-routing.md" <<'EOF'
<!-- ROUTING-START -->
| page | area |
|---|---|
| nunca-existiu | gama |
<!-- ROUTING-END -->
EOF
saida="$(bash "$SCRIPT" "$W" 2>&1)"; codigo=$?
[ "$codigo" -eq 0 ] && ok "pagina ausente nao derruba a migracao" || falha "pagina ausente derrubou a migracao ($codigo)"
printf '%s' "$saida" | grep -qi 'ausente' && ok "pagina ausente e relatada" || falha "pagina ausente passou calada: $saida"

# --- 8. mapa inexistente reprova em voz alta ------------------------------
rm -f "$W/_meta/migration-routing.md"
if bash "$SCRIPT" "$W" >/dev/null 2>&1; then
  falha "mapa ausente saiu 0"
else
  ok "mapa ausente reprova"
fi

[ "$falhas" -eq 0 ] && echo "OK: migrar-areas"
exit "$falhas"
