#!/usr/bin/env bash
# Testa o harness de baseline versionado de sources[].resource.
#
# Cenarios (gherkin):
#
#   Cenario: nenhuma checagem existente foi afrouxada (A6, fase de regressao)
#     Dado o baseline versionado em scripts/resource-baseline.tsv
#     Quando validar_recurso e exercitada sobre cada valor da tabela
#     Entao nenhum valor "fail" devolve "pass" e nenhum "pass" devolve "fail"
#     E a fase de mutacao acusa os canarios
#
#   Cenario: o harness reprova um classificador quebrado de proposito (A6)
#     Dado uma copia do validador com o defeito do espaco em branco reinjetado
#     Quando o harness roda sobre ela
#     Entao ele reprova (codigo 1) e nomeia valores afrouxados
#     (um harness que passa COM a mutacao aplicada nao testa nada)
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

falhas=0

# --- Fase de regressao + canario sobre o validador do repo ---
saida="$(python3 scripts/resource-baseline-check.py 2>&1)"; codigo=$?
[ "$codigo" -eq 0 ] \
  && echo "  ok: harness passa sobre o validador do repo" || { echo "  FALHA: harness reprovou o validador do repo"; falhas=$((falhas+1)); }
echo "$saida" | grep -q "FASE1: PASS" \
  && echo "  ok: fase 1 (regressao) bate a tabela" || { echo "  FALHA: fase 1 nao bateu a tabela"; falhas=$((falhas+1)); }
echo "$saida" | grep -q "FASE2: PASS" \
  && echo "  ok: fase 2 (mutacao) acusa os canarios" || { echo "  FALHA: fase 2 nao acusou os canarios"; falhas=$((falhas+1)); }

# --- Harness tem de reprovar um classificador quebrado de proposito ---
# Injeta o defeito da regra do espaco em branco (espaco decidindo antes da forma
# do caminho) numa COPIA do validador, em disco, e aponta o harness para ela.
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
afrouxado="$tmp/validar-okf-afrouxado.py"
python3 - scripts/validar-okf.py "$afrouxado" <<'PY'
import sys
origem, destino = sys.argv[1], sys.argv[2]
texto = open(origem, encoding='utf-8').read()
ancora = "    if URI_SCHEME_RE.match(resource):\n        return EXTERNO\n"
if ancora not in texto:
    sys.exit("ancora de injecao nao encontrada em classificar_recurso")
injecao = ancora + "    import re as _re\n    if _re.search(r'\\s', resource):\n        return DESCRITOR_ESCOPO\n"
open(destino, 'w', encoding='utf-8').write(texto.replace(ancora, injecao, 1))
PY

saida="$(python3 scripts/resource-baseline-check.py --validador "$afrouxado" 2>&1)"; codigo=$?
[ "$codigo" -eq 1 ] \
  && echo "  ok: harness reprova o classificador afrouxado" || { echo "  FALHA: harness passou COM a mutacao aplicada — nao testa nada"; falhas=$((falhas+1)); }
echo "$saida" | grep -q "AFROUXADO" \
  && echo "  ok: harness nomeia os valores afrouxados" || { echo "  FALHA: harness nao nomeou valor afrouxado"; falhas=$((falhas+1)); }

[ "$falhas" -eq 0 ] && echo "OK: resource-baseline"
exit "$falhas"
