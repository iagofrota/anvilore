#!/usr/bin/env bash
# B7 — ritual de fechamento: sincronizar -> indexar log -> validar -> gate do
# log do dia, PARANDO no primeiro passo que falhar.
#
# "Parou no passo N" nao e provado pela mensagem: e provado pelo SIDE-EFFECT
# AUSENTE do passo seguinte. Quando o passo 1 falha, o passo 2 (que reescreve
# wiki/log.md) nao pode ter rodado — e o hash do log.md que diz isso.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
RAIZ="$PWD"
SCRIPT="$RAIZ/scripts/fechar-wiki.sh"

falhas=0
ok()    { echo "  ok: $*"; }
falha() { echo "  FALHA: $*"; falhas=$((falhas+1)); }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
HOJE="$(date +%F)"

hash_de() { [ -f "$1" ] && sha256sum "$1" | cut -d' ' -f1 || echo "AUSENTE"; }

# montar_wiki <destino> — wiki sintetica integra, com log do dia.
montar_wiki() {
  local w="$1"
  rm -rf "$w"
  mkdir -p "$w/alfa/concepts" "$w/alfa/sources" "$w/_meta" "$w/log"
  printf -- '---\ntitle: "Conceito"\nslug: conceito\ntype: concept\narea: alfa\ntags: []\n---\n\nCorpo.\n' \
    > "$w/alfa/concepts/conceito.md"
  printf -- '---\ntitle: "Fonte"\nslug: fonte\ntype: source\narea: alfa\ntags: []\n---\n\nCorpo.\n' \
    > "$w/alfa/sources/fonte.md"
  printf '# Indice\n\nPaginas desta wiki.\n' > "$w/index.md"
  printf '# Log\n' > "$w/log.md"
  printf -- '---\ntype: log-day\ndate: %s\n---\n\n# Log — %s\n\n## [%s] ingest | Fechamento do dia\n\nCorpo.\n' \
    "$HOJE" "$HOJE" "$HOJE" > "$w/log/log-$HOJE.md"
}

# ============================================================================
# 1. wiki integra com log do dia: os 4 passos rodam e o ritual fecha com 0
# ============================================================================
W="$TMP/integra"; montar_wiki "$W"
saida="$(bash "$SCRIPT" "$W" 2>&1)"; codigo=$?
[ "$codigo" -eq 0 ] && ok "wiki integra fecha com exit 0" || falha "wiki integra saiu $codigo:
$(printf '%s' "$saida" | sed 's/^/    /')"
for n in 1 2 3 4; do
  printf '%s' "$saida" | grep -q "$n/4" && ok "passo $n/4 anunciado" || falha "passo $n/4 nao rodou"
done
printf '%s' "$saida" | grep -q 'FECHAMENTO: OK' && ok "fechamento anuncia OK" || falha "fechamento nao anunciou OK"

# ============================================================================
# 2. passo 1 quebrado (header de contagem parcial) -> para em 1, passo 2 nao roda
# ============================================================================
W="$TMP/passo1"; montar_wiki "$W"
printf '# Indice — alfa\n\n_2 páginas — Última atualização: 2020-01-01_\n' > "$W/alfa/index.md"
log_antes="$(hash_de "$W/log.md")"
saida="$(bash "$SCRIPT" "$W" 2>&1)"; codigo=$?
log_depois="$(hash_de "$W/log.md")"

[ "$codigo" -ne 0 ] && ok "passo 1 quebrado reprova" || falha "passo 1 quebrado saiu 0"
printf '%s' "$saida" | grep -q 'sincronizar-indice' && ok "nomeia o passo que falhou (sincronizar-indice)" || falha "nao nomeou o passo: $saida"
printf '%s' "$saida" | grep -q '2/4' && falha "o passo 2 foi anunciado mesmo com o 1 falhando" || ok "passo 2 nao foi anunciado"
[ "$log_antes" = "$log_depois" ] && ok "SIDE-EFFECT AUSENTE: wiki/log.md nao foi regenerado" || falha "o passo 2 rodou mesmo com o passo 1 falhando"

# --- PROVA DE DENTES do side-effect ----------------------------------------
# A mesma comparacao de hash TEM de acusar o passo 2 quando ele roda. Conserta
# o passo 1 e roda de novo: o log.md TEM de mudar.
rm -f "$W/alfa/index.md"
bash "$SCRIPT" "$W" >/dev/null 2>&1
log_final="$(hash_de "$W/log.md")"
[ "$log_final" != "$log_depois" ] && ok "com o passo 1 consertado o log.md MUDA (side-effect tem dentes)" \
  || falha "log.md nao mudou nem com o passo 2 rodando — a asercao e vazia"

# ============================================================================
# 3. passo 3 quebrado (type invalido) -> para em 3, passo 4 nao e anunciado
# ============================================================================
W="$TMP/passo3"; montar_wiki "$W"
printf -- '---\ntitle: "Torta"\nslug: torta\ntype: inventado\narea: alfa\ntags: []\n---\n\nCorpo.\n' \
  > "$W/alfa/concepts/torta.md"
saida="$(bash "$SCRIPT" "$W" 2>&1)"; codigo=$?
[ "$codigo" -ne 0 ] && ok "validacao quebrada reprova" || falha "validacao quebrada saiu 0"
printf '%s' "$saida" | grep -q '3/4' && ok "passo 3 foi anunciado"        || falha "passo 3 nao foi anunciado"
printf '%s' "$saida" | grep -q '4/4' && falha "passo 4 rodou apos o 3 falhar" || ok "passo 4 nao foi anunciado"
printf '%s' "$saida" | grep -q 'validar-wiki' && ok "nomeia o passo que falhou (validar-wiki)" || falha "nao nomeou validar-wiki: $saida"

# ============================================================================
# 4. gate do log do dia: pagina curada mexida hoje SEM entrada no log reprova
# ============================================================================
W="$TMP/semlog"; montar_wiki "$W"
rm -f "$W/log/log-$HOJE.md"
printf -- '---\ntype: log-day\ndate: 2020-01-01\n---\n\n# Log — 2020-01-01\n\n## [2020-01-01] nota | Antiga\n' \
  > "$W/log/log-2020-01-01.md"
saida="$(bash "$SCRIPT" "$W" 2>&1)"; codigo=$?
[ "$codigo" -ne 0 ] && ok "gate do log reprova sem entrada do dia" || falha "gate do log passou sem entrada do dia"
printf '%s' "$saida" | grep -q "log-$HOJE.md" && ok "gate diz qual arquivo de log falta" || falha "gate nao disse o arquivo: $saida"
printf '%s' "$saida" | grep -q 'conceito.md' && ok "gate lista a pagina curada alterada" || falha "gate nao listou a pagina alterada"

# O gate ignora o que ele mesmo deriva: index.md, log.md e os reservados.
printf '%s' "$saida" | grep -qE '^  - (index|log)\.md$' && falha "gate cobrou um arquivo derivado" || ok "gate ignora index.md/log.md"
printf '%s' "$saida" | grep -qE '^  - (_meta|log)/' && falha "gate cobrou diretorio reservado" || ok "gate ignora _meta/ e log/"

# --- PROVA DE DENTES do gate ------------------------------------------------
# Escrever a entrada do dia TEM de destravar. Se nao destravasse, o gate nao
# estaria medindo a entrada do log e sim qualquer outra coisa.
printf -- '---\ntype: log-day\ndate: %s\n---\n\n# Log — %s\n\n## [%s] ingest | Entrada escrita agora\n' \
  "$HOJE" "$HOJE" "$HOJE" > "$W/log/log-$HOJE.md"
bash "$SCRIPT" "$W" >/dev/null 2>&1; codigo=$?
[ "$codigo" -eq 0 ] && ok "com a entrada do dia o gate destrava (gate tem dentes)" || falha "gate nao destravou nem com a entrada do dia ($codigo)"

# ============================================================================
# 5. escape explicito pula o gate, e so o gate
# ============================================================================
W="$TMP/escape"; montar_wiki "$W"
rm -f "$W/log/log-$HOJE.md"
printf -- '## [2020-01-01] nota | Antiga\n' > "$W/log/log-2020-01-01.md"
if ANVILORE_PULAR_GATE_LOG=1 bash "$SCRIPT" "$W" >/dev/null 2>&1; then
  ok "ANVILORE_PULAR_GATE_LOG=1 pula o gate"
else
  falha "escape explicito nao pulou o gate"
fi
# ...mas nao pula a validacao.
printf -- '---\ntitle: "Torta"\nslug: torta\ntype: inventado\ntags: []\n---\n' > "$W/alfa/concepts/torta.md"
if ANVILORE_PULAR_GATE_LOG=1 bash "$SCRIPT" "$W" >/dev/null 2>&1; then
  falha "o escape do gate tambem pulou a validacao"
else
  ok "o escape do gate nao pula a validacao"
fi

# ============================================================================
# 6. a wiki versionada do repositorio atravessa os 3 primeiros passos
# ============================================================================
saida="$(ANVILORE_PULAR_GATE_LOG=1 bash "$SCRIPT" "$RAIZ/wiki" 2>&1)"; codigo=$?
[ "$codigo" -eq 0 ] && ok "wiki do repositorio fecha (clone limpo verde)" || falha "wiki do repositorio reprovou:
$(printf '%s' "$saida" | sed 's/^/    /')"
if [ -n "$(cd "$RAIZ" && git status --porcelain -- wiki/)" ]; then
  falha "o ritual sujou a wiki versionada: $(cd "$RAIZ" && git status --porcelain -- wiki/)"
else
  ok "o ritual nao sujou a wiki versionada"
fi

[ "$falhas" -eq 0 ] && echo "OK: fechar-wiki"
exit "$falhas"
