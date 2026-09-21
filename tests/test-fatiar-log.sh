#!/usr/bin/env bash
# B4 — fatiamento de um wiki/log.md monolitico em um arquivo por dia.
#
# Migracao ONE-SHOT: o criterio NAO e "roda duas vezes, saida igual". E "recusa
# a segunda execucao sem corromper a primeira". Abortar na segunda rodada e o
# comportamento correto, nao um defeito.
#
# Anti-regressao: a asercao "a segunda rodada nao sobrescreveu nada" e provada
# por mutacao — um marcador e injetado num arquivo ja fatiado; ele tem de
# sobreviver a rodada que aborta, e tem de SUMIR quando os destinos sao
# removidos e o script roda de verdade. So assim se sabe que a comparacao de
# hash enxerga uma escrita.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
SCRIPT="$PWD/scripts/fatiar-log.py"

falhas=0
ok()    { echo "  ok: $*"; }
falha() { echo "  FALHA: $*"; falhas=$((falhas+1)); }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
W="$TMP/wiki"          # NUNCA o wiki/ real do repositorio: este teste fatia.
mkdir -p "$W/log"

hashes() { for f in "$W"/log/log-*.md; do [ -f "$f" ] && sha256sum "$f"; done | sort; }

cat > "$W/log.md" <<'EOF'
# Log

Registro do que foi ingerido, com data e fonte.

## [2026-09-01] ingest | Fonte A

Paginas tocadas: alfa/sources/a (1 no total)

## [2026-09-02] nota | Nota B

Corpo da nota B, com uma linha so.

## [2026-09-02] ingest | Fonte C

Segunda entrada do mesmo dia.

## [2026-09-03] revisao | Revisao D

Corpo da revisao D.
EOF

# --- 1. primeira execucao: 3 arquivos, um por dia ---------------------------
saida="$(python3 "$SCRIPT" "$W" 2>&1)"; codigo=$?
[ "$codigo" -eq 0 ] && ok "primeira execucao sai 0" || falha "primeira execucao saiu $codigo: $saida"

n="$(find "$W/log" -name 'log-*.md' -type f | wc -l)"
[ "$n" -eq 3 ] && ok "3 arquivos de dia criados" || falha "criou $n arquivos (esperado 3)"

for d in 2026-09-01 2026-09-02 2026-09-03; do
  [ -f "$W/log/log-$d.md" ] && ok "log-$d.md existe" || falha "log-$d.md ausente"
done

# Conteudo integro: o dia 02 tem as DUAS entradas dele, com o corpo.
if grep -q 'Corpo da nota B' "$W/log/log-2026-09-02.md" \
   && grep -q 'Segunda entrada do mesmo dia' "$W/log/log-2026-09-02.md" \
   && [ "$(grep -c '^## \[2026-09-02\]' "$W/log/log-2026-09-02.md")" -eq 2 ]; then
  ok "as duas entradas do dia 02 chegaram inteiras no arquivo do dia"
else
  falha "entradas do dia 02 incompletas"
fi
grep -q 'Paginas tocadas: alfa/sources/a' "$W/log/log-2026-09-01.md" \
  && ok "corpo da entrada do dia 01 preservado" || falha "corpo do dia 01 perdido"

# Preambulo (titulo + prosa antes da primeira entrada) e relatado, nao engolido
# em silencio: quem roda precisa saber que aquelas linhas nao foram para lugar
# nenhum. O cabecalho de wiki/log.md e regenerado por indexar-log.sh.
printf '%s' "$saida" | grep -qi 'preambulo\|preâmbulo' \
  && ok "preambulo relatado em voz alta" || falha "preambulo sumiu sem aviso: $saida"

# log.md nao foi apagado nem alterado.
grep -q '## \[2026-09-01\]' "$W/log.md" && ok "log.md de origem intacto" || falha "log.md de origem foi alterado"

# --- 2. mutacao: marca um arquivo ja fatiado --------------------------------
echo "MARCADOR-DE-MUTACAO" >> "$W/log/log-2026-09-02.md"
antes="$(hashes)"

# --- 3. segunda execucao: ABORTA e nao toca em nada -------------------------
saida2="$(python3 "$SCRIPT" "$W" 2>&1)"; codigo2=$?
depois="$(hashes)"
[ "$codigo2" -ne 0 ] && ok "segunda execucao aborta (exit $codigo2)" || falha "segunda execucao saiu 0 — one-shot nao recusou"
printf '%s' "$saida2" | grep -q 'destino' && ok "aborto diz que o destino ja existe" || falha "mensagem de aborto nao explica: $saida2"
[ "$antes" = "$depois" ] && ok "nenhum arquivo ja fatiado foi tocado" || falha "a segunda execucao reescreveu arquivos"
grep -q 'MARCADOR-DE-MUTACAO' "$W/log/log-2026-09-02.md" \
  && ok "marcador de mutacao sobreviveu ao aborto" || falha "marcador foi sobrescrito"

# --- 4. PROVA DE DENTES -----------------------------------------------------
# A mesma comparacao de hash TEM de enxergar uma escrita. Removidos os
# destinos, o script escreve — o marcador some e o hash muda.
rm -f "$W"/log/log-*.md
python3 "$SCRIPT" "$W" >/dev/null 2>&1; codigo3=$?
final="$(hashes)"
[ "$codigo3" -eq 0 ] && ok "com destinos removidos volta a fatiar" || falha "nao fatiou mesmo com destino livre ($codigo3)"
[ "$final" != "$depois" ] && ok "o hash MUDA quando ha escrita (a asercao tem dentes)" || falha "hash nao mudou apos reescrita — asercao vazia"
grep -q 'MARCADOR-DE-MUTACAO' "$W/log/log-2026-09-02.md" \
  && falha "marcador sobreviveu a uma reescrita real" || ok "marcador sumiu na reescrita real"

# --- 5. formato antigo de header (## DATA — Titulo) -------------------------
V="$TMP/velha"
mkdir -p "$V"
printf -- '## 2026-08-01 — Entrada no formato antigo\n\nCorpo.\n' > "$V/log.md"
python3 "$SCRIPT" "$V" >/dev/null 2>&1
if [ -f "$V/log/log-2026-08-01.md" ] && grep -q '^## \[2026-08-01\] note | Entrada no formato antigo' "$V/log/log-2026-08-01.md"; then
  ok "header em formato antigo e normalizado"
else
  falha "header em formato antigo nao foi normalizado"
fi

# --- 6. log.md ausente reprova em voz alta ---------------------------------
if python3 "$SCRIPT" "$TMP/inexistente" >/dev/null 2>&1; then
  falha "wiki sem log.md saiu 0"
else
  ok "wiki sem log.md reprova"
fi

# --- 7. log.md sem entrada nenhuma reprova, sem criar log/ -----------------
Z="$TMP/zerada"; mkdir -p "$Z"
printf '# Log\n\nSo prosa, nenhuma entrada.\n' > "$Z/log.md"
python3 "$SCRIPT" "$Z" >/dev/null 2>&1; czero=$?
[ "$czero" -ne 0 ] && ok "log.md sem entradas reprova" || falha "log.md sem entradas saiu 0"
[ ! -d "$Z/log" ]  && ok "nada foi criado quando nao ha entrada" || falha "criou $Z/log sem ter entrada"

[ "$falhas" -eq 0 ] && echo "OK: fatiar-log"
exit "$falhas"
