#!/usr/bin/env bash
# B3 — regeneracao de wiki/log.md a partir de wiki/log/log-*.md.
#
# Criterio forte: duas execucoes seguidas, sem tocar em nada, produzem saida
# BYTE-IDENTICA. Empate de contagem resolvido alfabeticamente e o que torna
# isso verdade — sem isso a ordem do `for (t in cnt)` do awk varia.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
SCRIPT="$PWD/scripts/indexar-log.sh"

falhas=0
ok()    { echo "  ok: $*"; }
falha() { echo "  FALHA: $*"; falhas=$((falhas+1)); }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
W="$TMP/wiki"
mkdir -p "$W/log" "$W/_meta"

hash_de() { [ -f "$1" ] && sha256sum "$1" | cut -d' ' -f1 || echo "AUSENTE"; }

cat > "$W/log/log-2026-09-01.md" <<'EOF'
---
type: log-day
date: 2026-09-01
---

# Log — 2026-09-01

## [2026-09-01] ingest | Primeira fonte

Paginas tocadas: 3

## [2026-09-01] nota | Observacao solta

Uma nota.
EOF

cat > "$W/log/log-2026-09-02.md" <<'EOF'
---
type: log-day
date: 2026-09-02
---

# Log — 2026-09-02

## [2026-09-02] ingest | Segunda fonte

Paginas tocadas: 1

```markdown
## [2026-09-02] ingest | Isto esta dentro de um fence e NAO conta
```
EOF

cat > "$W/log/log-2026-10-05.md" <<'EOF'
---
type: log-day
date: 2026-10-05
---

# Log — 2026-10-05

## [2026-10-05] revisao | Passada de revisao
EOF

LOG="$W/log.md"

# --- 1. gera o indice -------------------------------------------------------
if bash "$SCRIPT" "$W" >/dev/null 2>&1; then ok "indexacao sai 0"; else falha "indexacao saiu != 0"; fi
[ -f "$LOG" ] && ok "wiki/log.md gerado" || falha "wiki/log.md nao foi gerado"

primeira="$(cat "$LOG" 2>/dev/null)"

# --- 2. idempotencia forte: byte a byte -------------------------------------
cp "$LOG" "$TMP/captura-1.md"
bash "$SCRIPT" "$W" >/dev/null 2>&1
cp "$LOG" "$TMP/captura-2.md"
if diff -q "$TMP/captura-1.md" "$TMP/captura-2.md" >/dev/null; then
  ok "duas execucoes produzem saida byte-identica"
else
  falha "saida divergiu entre execucoes:"; diff "$TMP/captura-1.md" "$TMP/captura-2.md" | sed 's/^/    /'
fi

# --- 3. conteudo: 3 dias, 4 entradas, fence ignorado ------------------------
printf '%s' "$primeira" | grep -q '4 entradas em 3 dias' \
  && ok "cabecalho conta 4 entradas em 3 dias" \
  || falha "cabecalho errado: $(printf '%s' "$primeira" | grep entradas | head -1)"

for d in 2026-09-01 2026-09-02 2026-10-05; do
  printf '%s' "$primeira" | grep -q "\[\[log-$d\]\]" && ok "indice lista log-$d" || falha "indice nao lista log-$d"
done

# O `## [..]` dentro do fence do dia 02 nao pode ter sido contado: aquele dia
# tem 1 entrada, nao 2.
if printf '%s' "$primeira" | grep -q '\[\[log-2026-09-02\]\] — 1 '; then
  ok "header dentro de code fence nao e contado"
else
  falha "header dentro de fence contou: $(printf '%s' "$primeira" | grep 'log-2026-09-02')"
fi

# Agrupamento por mes, com o mes mais recente primeiro.
if [ "$(printf '%s' "$primeira" | grep -c '^## 2026-')" -eq 2 ]; then
  ok "duas secoes de mes"
else
  falha "secoes de mes: $(printf '%s' "$primeira" | grep -c '^## 2026-')"
fi
if [ "$(printf '%s' "$primeira" | grep '^## 2026-' | head -1)" = "## 2026-10 — 1 entradas" ]; then
  ok "mes mais recente primeiro"
else
  falha "ordem dos meses errada: $(printf '%s' "$primeira" | grep '^## 2026-' | head -1)"
fi

# --- 4. --stdout nao escreve ------------------------------------------------
antes="$(hash_de "$LOG")"
bash "$SCRIPT" "$W" --stdout >/dev/null 2>&1
depois="$(hash_de "$LOG")"
[ "$antes" = "$depois" ] && ok "--stdout nao escreve wiki/log.md" || falha "--stdout escreveu wiki/log.md"

# --- 5. log/ sem arquivo de dia: log.md PRESERVADO, nao zerado --------------
# Desvio consciente da origem (que saia 1). No anvilore `wiki/log.md` e um
# arquivo versionado do esqueleto; regenerar a partir de um `log/` vazio
# apagaria o que veio no clone. Preservar e dizer por que e o correto aqui.
V="$TMP/vazia"
mkdir -p "$V/log"
printf '# Log\n\nRegistro do que foi ingerido, com data e fonte.\n' > "$V/log.md"
antes="$(hash_de "$V/log.md")"
bash "$SCRIPT" "$V" >/dev/null 2>&1; codigo=$?
depois="$(hash_de "$V/log.md")"
[ "$codigo" -eq 0 ]      && ok "log/ vazio nao reprova"                || falha "log/ vazio saiu $codigo"
[ "$antes" = "$depois" ] && ok "log/ vazio preserva o log.md do clone" || falha "log/ vazio reescreveu log.md"

# --- 6. PROVA DE DENTES: a mesma comparacao DETECTA a escrita ---------------
cat > "$V/log/log-2026-11-01.md" <<'EOF'
## [2026-11-01] nota | Primeira entrada de verdade
EOF
bash "$SCRIPT" "$V" >/dev/null 2>&1
escrito="$(hash_de "$V/log.md")"
if [ "$escrito" != "$depois" ]; then
  ok "com arquivo de dia o hash MUDA (a asercao de preservacao tem dentes)"
else
  falha "hash nao mudou nem com arquivo de dia — a asercao e vazia"
fi

# --- 7. a wiki versionada do repositorio continua intacta -------------------
antes="$(hash_de wiki/log.md)"
bash "$SCRIPT" wiki >/dev/null 2>&1; codigo=$?
depois="$(hash_de wiki/log.md)"
[ "$codigo" -eq 0 ]      && ok "wiki do repositorio nao reprova"  || falha "wiki do repositorio saiu $codigo"
[ "$antes" = "$depois" ] && ok "wiki/log.md do repositorio intacto" || falha "wiki/log.md do repositorio foi reescrito"

[ "$falhas" -eq 0 ] && echo "OK: indexar-log"
exit "$falhas"
