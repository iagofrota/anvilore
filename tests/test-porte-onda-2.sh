#!/usr/bin/env bash
# B8-B11 — criterios que valem para o porte inteiro, nao para um script so:
#   B8  rodape de atribuicao ao wiki-wonka nos 7 scripts
#   B9  nenhum conteudo pessoal nos scripts nem nos testes
#   B10 runtime preservado: 4 bash + 3 Python 3
#   B11 os dois scripts do nivel 04 NAO foram portados
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

falhas=0
ok()    { echo "  ok: $*"; }
falha() { echo "  FALHA: $*"; falhas=$((falhas+1)); }

BASH_PORTADOS=(
  scripts/sincronizar-indice.sh
  scripts/indexar-log.sh
  scripts/migrar-areas.sh
  scripts/fechar-wiki.sh
)
PY_PORTADOS=(
  scripts/listar-lacunas.py
  scripts/fatiar-log.py
  scripts/rejuntar-linhas.py
)
PORTADOS=("${BASH_PORTADOS[@]}" "${PY_PORTADOS[@]}")
TESTES_NOVOS=(
  tests/test-sincronizar-indice.sh
  tests/test-listar-lacunas.sh
  tests/test-indexar-log.sh
  tests/test-fatiar-log.sh
  tests/test-rejuntar-linhas.sh
  tests/test-migrar-areas.sh
  tests/test-fechar-wiki.sh
  tests/test-porte-onda-2.sh
)

# ============================================================================
# B8 — rodape de atribuicao, no mesmo formato das skills
# ============================================================================
# A citacao e a mesma de skills/ingest/SKILL.md: URL do projeto de origem,
# titular, licenca e o ponteiro para LICENSE. O teste nao compara uma string
# inteira (o texto e prosa, e prosa muda) — cobra os quatro elementos que a
# licenca MIT exige que sobrevivam.
ELEMENTOS=(
  'https://github.com/cooperacode/wiki-wonka'
  'Coopera Code'
  'licença MIT'
  'LICENSE'
)
for elemento in "${ELEMENTOS[@]}"; do
  if grep -qF -- "$elemento" skills/ingest/SKILL.md; then
    ok "elemento de atribuicao presente na skill de referencia: $elemento"
  else
    falha "skills/ingest/SKILL.md nao traz '$elemento' — a referencia do formato mudou"
  fi
done

for elemento in "${ELEMENTOS[@]}"; do
  sem_rodape="$(grep -LF -- "$elemento" "${PORTADOS[@]}")"
  if [ -z "$sem_rodape" ]; then
    ok "todos os 7 scripts citam '$elemento'"
  else
    falha "scripts sem '$elemento': $(echo "$sem_rodape" | tr '\n' ' ')"
  fi
done

# O rodape e RODAPE: mora no fim do arquivo, nao perdido no meio.
for s in "${PORTADOS[@]}"; do
  if tail -6 "$s" | grep -qF 'cooperacode/wiki-wonka'; then
    ok "$(basename "$s"): rodape nas ultimas linhas"
  else
    falha "$(basename "$s"): atribuicao nao esta no rodape"
  fi
done

# ============================================================================
# B9 — nada do vault privado nos scripts nem nos testes novos
# ============================================================================
# Varredura sobre os BLOBS DO COMMIT, nao sobre a arvore em disco: e o
# conteudo versionado que vaza, e ele pode divergir do que esta no working
# tree. Arquivo ainda nao rastreado cai para o working tree, com aviso.
#
# Duas listas, porque os termos nao sao todos do mesmo tipo:
#
#   DISTINTIVOS — nao aparecem em prosa tecnica por acaso. Casam em qualquer
#     posicao.
#   GENERICOS   — sao ao mesmo tempo nome de area do vault privado E palavra
#     comum da lingua. Casar "pessoal" em qualquer posicao acusaria uma frase
#     como "wiki pessoal" no README. So contam em POSICAO de caminho
#     (`wiki/<area>/`) ou de campo (`area: <area>`), que e como um nome de
#     area de verdade apareceria num script.
#
# Cada termo tem a ultima letra escrita como classe de um caractere so
# (`exempl[o]` casa a palavra inteira exatamente como a grafia direta casaria):
# ESTE arquivo
# tambem entra na varredura, e um scanner que lista os termos por extenso se
# acusa sozinho. Alarme que sempre toca nao e alarme.
DISTINTIVOS='side-projec[t]|terapi[a]|garmi[n]|planeja[i]|ank[i]|iag[o]|qualidade-softwar[e]|engenharia-softwar[e]|notio[n]|inventario-vitoria[s]|/home[/]|raw/meeting[s]'
GENERICOS='(wiki/|area: *|\[\[)(trabalh[o]|pessoa[l]|ingle[s]|glob[o])'
sujos=0; nao_rastreados=0
for f in "${PORTADOS[@]}" "${TESTES_NOVOS[@]}"; do
  if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    conteudo="$(git show ":$f" 2>/dev/null)"
  else
    conteudo="$(cat "$f")"; nao_rastreados=$((nao_rastreados+1))
  fi
  achado="$(printf '%s' "$conteudo" | grep -inE "$DISTINTIVOS|$GENERICOS" || true)"
  if [ -n "$achado" ]; then
    falha "conteudo do vault privado em $f: $(printf '%s' "$achado" | head -3 | tr '\n' ' ')"
    sujos=$((sujos+1))
  fi
done
[ "$sujos" -eq 0 ] && ok "varredura: nada do vault privado nos 7 scripts e nos testes novos"

# PROVA DE DENTES da varredura: uma varredura que nunca acusa nada pode estar
# acusando nada porque o regex esta quebrado. Um arquivo-isca sintetico, com um
# nome de area do vault privado em posicao de campo, TEM de ser pego.
isca="$(mktemp)"
# O nome da area e montado em pedacos pelo mesmo motivo do regex acima: escrito
# por extenso, ele faria este arquivo acusar a si mesmo.
area_isca="pesso""al"
isca_conteudo="$(printf 'type: concept\narea: %s\n' "$area_isca")"
printf '%s\n' "$isca_conteudo" > "$isca"
if grep -qinE "$DISTINTIVOS|$GENERICOS" "$isca"; then
  ok "a varredura pega uma isca plantada (tem dentes)"
else
  falha "a varredura nao pegou a isca — o regex nao mede nada"
fi
printf -- 'type: concept\narea: exemplo\n' > "$isca"
if grep -qinE "$DISTINTIVOS|$GENERICOS" "$isca"; then
  falha "a varredura acusou uma area neutra (falso positivo)"
else
  ok "a varredura nao acusa area neutra"
fi
rm -f "$isca"
[ "$nao_rastreados" -gt 0 ] && echo "  nota: $nao_rastreados arquivo(s) ainda nao rastreado(s) — varridos na arvore de trabalho"

# Nenhuma fixture de teste escreve dentro do wiki/ versionado: os testes que
# movem e fatiam arquivos precisam viver em diretorio temporario.
for f in tests/test-fatiar-log.sh tests/test-migrar-areas.sh; do
  if grep -qE 'mktemp -d' "$f"; then
    ok "$(basename "$f"): opera em diretorio temporario"
  else
    falha "$(basename "$f"): nao usa mktemp -d — pode tocar o wiki/ real"
  fi
done

# ============================================================================
# B10 — runtime preservado: 4 bash, 3 Python 3
# ============================================================================
for s in "${BASH_PORTADOS[@]}"; do
  if [ "$(head -1 "$s")" = "#!/usr/bin/env bash" ]; then
    ok "$(basename "$s"): shebang bash"
  else
    falha "$(basename "$s"): shebang '$(head -1 "$s")' (esperado bash)"
  fi
done
for s in "${PY_PORTADOS[@]}"; do
  if [ "$(head -1 "$s")" = "#!/usr/bin/env python3" ]; then
    ok "$(basename "$s"): shebang python3"
  else
    falha "$(basename "$s"): shebang '$(head -1 "$s")' (esperado python3)"
  fi
done
[ "${#BASH_PORTADOS[@]}" -eq 4 ] && ok "4 scripts bash" || falha "${#BASH_PORTADOS[@]} scripts bash (esperado 4)"
[ "${#PY_PORTADOS[@]}" -eq 3 ]   && ok "3 scripts Python 3" || falha "${#PY_PORTADOS[@]} scripts Python 3 (esperado 3)"

# Os 7 existem e sao executaveis.
for s in "${PORTADOS[@]}"; do
  [ -f "$s" ] || { falha "$s nao existe"; continue; }
  [ -x "$s" ] && ok "$(basename "$s"): executavel" || falha "$(basename "$s"): sem bit de execucao"
done

# Sintaxe valida sem executar nada.
for s in "${BASH_PORTADOS[@]}"; do
  bash -n "$s" 2>/dev/null && ok "$(basename "$s"): sintaxe bash ok" || falha "$(basename "$s"): erro de sintaxe bash"
done
for s in "${PY_PORTADOS[@]}"; do
  python3 -m py_compile "$s" 2>/dev/null && ok "$(basename "$s"): compila em Python 3" || falha "$(basename "$s"): erro de sintaxe Python"
done
rm -rf scripts/__pycache__

# ============================================================================
# B11 — o que fica de fora desta onda (nivel 04)
# ============================================================================
# Termos escritos com a mesma tecnica do B9, e pelo mesmo motivo. O alvo e
# `scripts/`, que e onde um script portado moraria.
achado="$(grep -rniE 'busca.?l[eé]xic[a]|rust.?inde[x]|daily.?lin[t]|lint.?di[aá]ri[o]' scripts/ || true)"
if [ -z "$achado" ]; then
  ok "nenhum vestigio do escopo do nivel 04 em scripts/"
else
  falha "vestigio de escopo do nivel 04: $achado"
fi
for proibido in scripts/wiki-query.sh scripts/consultar-wiki.sh scripts/daily-lint.sh scripts/lint-diario.sh; do
  [ -e "$proibido" ] && falha "$proibido foi portado e nao deveria" || ok "ausente (correto): $proibido"
done

# O README ja explica por que o nivel 04 fica de fora — B11 se apoia nisso.
grep -q 'nível 04' README.md && ok "README explica o nivel 04" || falha "README nao explica o nivel 04"

[ "$falhas" -eq 0 ] && echo "OK: porte-onda-2"
exit "$falhas"
