#!/usr/bin/env bash
# scripts/fundir-json.py — a peca determinista por tras de "instalar sem
# destruir o que ja estava la".
#
# Tres disciplinas que este teste nao abre mao:
#
#   GRUPO DE CONTROLE — toda bateria que afirma "a chave de quem usa
#   sobreviveu" exige, na MESMA execucao, que a chave NOVA tenha sido escrita.
#   Sem isso, "preservou" e indistinguivel de "nao escreveu nada".
#
#   PROVA POR MUTACAO — `--simular` so significa alguma coisa se a MESMA
#   chamada sem ele mudar o disco. O hash do alvo prova os dois lados.
#
#   O DISCO DECIDE — nenhuma asercao de "nao escreveu" se apoia no texto que o
#   script imprime. Hash antes, hash depois.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
FUNDIR="$PWD/scripts/fundir-json.py"

falhas=0
ok()    { echo "  ok: $*"; }
falha() { echo "  FALHA: $*"; falhas=$((falhas+1)); }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# hash <arquivo> -> sha256 do conteudo, ou AUSENTE
hash() { [ -f "$1" ] && sha256sum "$1" | cut -d' ' -f1 || echo AUSENTE; }

[ -f "$FUNDIR" ] || { falha "scripts/fundir-json.py nao existe"; exit 1; }
python3 -m py_compile "$FUNDIR" 2>/dev/null && ok "compila em Python 3" \
                                            || falha "erro de sintaxe Python"
rm -rf scripts/__pycache__

# ============================================================================
# Alvo ausente: a primeira instalacao cria o arquivo
# ============================================================================
alvo="$TMP/a.json"
printf '{"hooks":{"PreToolUse":[{"matcher":"Write"}]}}' > "$TMP/frag.json"
veredito="$(python3 "$FUNDIR" "$alvo" "$TMP/frag.json")"
[ "$veredito" = "MUDOU" ] && ok "alvo ausente: veredito MUDOU" \
                          || falha "alvo ausente: veredito '$veredito'"
[ -f "$alvo" ] && ok "alvo ausente: o arquivo foi criado" \
               || falha "alvo ausente: o arquivo nao foi criado"

# ============================================================================
# IDEMPOTENCIA — a segunda execucao nao muda um byte
# ============================================================================
antes="$(hash "$alvo")"
veredito="$(python3 "$FUNDIR" "$alvo" "$TMP/frag.json")"
depois="$(hash "$alvo")"
[ "$veredito" = "INALTERADO" ] && ok "segunda execucao: veredito INALTERADO" \
                               || falha "segunda execucao: veredito '$veredito'"
[ "$antes" = "$depois" ] && ok "segunda execucao: o disco nao mudou" \
                         || falha "segunda execucao: o disco mudou"

# A lista de hooks nao pode ter crescido: acrescentar-se-ia uma copia por
# execucao, e o bloqueio passaria a rodar N vezes.
quantos="$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["hooks"]["PreToolUse"]))' "$alvo")"
[ "$quantos" = "1" ] && ok "a lista nao duplicou (1 entrada)" \
                     || falha "a lista duplicou ($quantos entradas)"

# ============================================================================
# D4 — configuracao previa de quem usa sobrevive, COM grupo de controle
# ============================================================================
alvo="$TMP/b.json"
cat > "$alvo" <<'JSON'
{
  "preferenciaArbitraria": "valor de quem usa",
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "origem": "outro lugar" }
    ]
  }
}
JSON
python3 "$FUNDIR" "$alvo" "$TMP/frag.json" >/dev/null

# (a) o que ja estava la sobreviveu...
if python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if d.get("preferenciaArbitraria")=="valor de quem usa" else 1)' "$alvo"; then
  ok "D4: a chave previa de quem usa sobreviveu"
else
  falha "D4: a chave previa de quem usa foi perdida"
fi
if python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if any(h.get("origem")=="outro lugar" for h in d["hooks"]["PreToolUse"]) else 1)' "$alvo"; then
  ok "D4: o hook de outra origem sobreviveu na lista"
else
  falha "D4: o hook de outra origem sumiu da lista"
fi

# (b) ...E o que o instalador acrescenta esta la. GRUPO DE CONTROLE: sem esta
# metade, "nada mudou" passaria por "fundiu direito".
if python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if any(h.get("matcher")=="Write" for h in d["hooks"]["PreToolUse"]) else 1)' "$alvo"; then
  ok "D4 (controle): o hook novo foi mesmo escrito"
else
  falha "D4 (controle): o hook novo nao foi escrito — a fusao nao fez nada"
fi

# ============================================================================
# D4 — escalar divergente: RECUSA explicita, e nada escrito
# ============================================================================
alvo="$TMP/c.json"
printf '{"modelo":"o que a pessoa escolheu"}\n' > "$alvo"
printf '{"modelo":"o que o instalador queria"}' > "$TMP/conflito.json"
antes="$(hash "$alvo")"
python3 "$FUNDIR" "$alvo" "$TMP/conflito.json" >"$TMP/saida.txt" 2>"$TMP/err.txt"
c=$?
depois="$(hash "$alvo")"
[ "$c" -eq 3 ] && ok "conflito de escalar: recusa com saida 3" \
               || falha "conflito de escalar: saida $c (esperado 3)"
[ "$antes" = "$depois" ] && ok "conflito de escalar: o disco nao mudou" \
                         || falha "conflito de escalar: o instalador sobrescreveu"
if grep -qiE 'recusad|nada foi escrito' "$TMP/err.txt"; then
  ok "conflito de escalar: o motivo vai para o stderr"
else
  falha "conflito de escalar: recusou em silencio: $(head -1 "$TMP/err.txt")"
fi

# ============================================================================
# --simular — e a PROVA POR MUTACAO que lhe da sentido
# ============================================================================
alvo="$TMP/d.json"
printf '{"preexistente":1}\n' > "$alvo"
antes="$(hash "$alvo")"
veredito="$(python3 "$FUNDIR" --simular "$alvo" "$TMP/frag.json")"
depois="$(hash "$alvo")"
[ "$antes" = "$depois" ] && ok "--simular: o disco nao mudou" \
                         || falha "--simular: o disco mudou"
[ "$veredito" = "MUDOU" ] && ok "--simular: relata MUDOU sem escrever" \
                          || falha "--simular: veredito '$veredito'"

# MUTACAO: a MESMA chamada sem --simular TEM de mudar o disco. Se nao mudasse,
# o teste acima nao estaria medindo o modo simulado — estaria medindo uma
# fusao que nunca faria nada de todo jeito.
python3 "$FUNDIR" "$alvo" "$TMP/frag.json" >/dev/null
sem_simular="$(hash "$alvo")"
[ "$antes" != "$sem_simular" ] && ok "--simular tem dentes: sem ele, o disco muda" \
                               || falha "--simular nao mede nada: sem ele o disco tambem nao muda"

# ============================================================================
# Entrada invalida nao passa batido
# ============================================================================
printf '{quebrado' > "$TMP/ruim.json"
python3 "$FUNDIR" "$TMP/e.json" "$TMP/ruim.json" >/dev/null 2>&1
[ $? -eq 2 ] && ok "fragmento com JSON invalido: saida 2" \
             || falha "fragmento com JSON invalido nao foi recusado"
python3 "$FUNDIR" "$TMP/e.json" "$TMP/nao-existe.json" >/dev/null 2>&1
[ $? -eq 2 ] && ok "fragmento ausente: saida 2" \
             || falha "fragmento ausente nao foi recusado"

[ "$falhas" -eq 0 ] && echo "OK: fundir-json"
exit "$falhas"
