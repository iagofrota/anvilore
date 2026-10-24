#!/usr/bin/env bash
# B8-B11 — criterios que valem para o porte inteiro, nao para um script so:
#   B8  rodape de atribuicao ao wiki-wonka nos scripts restantes
#   B9  nenhum conteudo pessoal nos scripts nem nos testes
#   B10 runtime preservado nos scripts restantes: 1 bash + 0 Python 3
#   B11 os dois scripts do nivel 04 NAO foram portados
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

falhas=0
ok()    { echo "  ok: $*"; }
falha() { echo "  FALHA: $*"; falhas=$((falhas+1)); }

BASH_PORTADOS=(
  scripts/fechar-wiki.sh
)
PY_PORTADOS=(
)
PORTADOS=("${BASH_PORTADOS[@]}" "${PY_PORTADOS[@]}")
TESTES_NOVOS=(
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
    ok "todos os scripts restantes citam '$elemento'"
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

# O modulo TypeScript derivado de wiki-wonka carrega a mesma atribuicao, no fim.
TS_DERIVADOS=(src/comandos/listar-lacunas.ts)
for s in "${TS_DERIVADOS[@]}"; do
  for elemento in "${ELEMENTOS[@]}"; do
    if grep -qF -- "$elemento" "$s"; then
      ok "$(basename "$s"): cita '$elemento'"
    else
      falha "$(basename "$s"): sem '$elemento'"
    fi
  done
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
#     posicao e valem para TODO arquivo varrido.
#   GENERICOS   — sao ao mesmo tempo nome de area do vault privado E palavra
#     comum da lingua. Casar "pessoal" em qualquer posicao acusaria uma frase
#     como "wiki pessoal" no README. So contam em POSICAO de caminho
#     (`wiki/<area>/`) ou de campo (`area: <area>`), que e como um nome de
#     area de verdade apareceria num script. E so valem para o que DERIVA do
#     vault: os scripts em PORTADOS e os modulos em TS_DERIVADOS. O resto do
#     codigo e dos testes em TypeScript e escrito para o produto, que usa
#     `pessoal` como area padrao e exemplo legitimo (`area: pessoal`).
#
# Cada termo tem a ultima letra escrita como classe de um caractere so
# (`exempl[o]` casa a palavra inteira exatamente como a grafia direta casaria):
# ESTE arquivo
# tambem entra na varredura, e um scanner que lista os termos por extenso se
# acusa sozinho. Alarme que sempre toca nao e alarme.
DISTINTIVOS='side-projec[t]|terapi[a]|garmi[n]|planeja[i]|ank[i]|iag[o]|qualidade-softwar[e]|engenharia-softwar[e]|notio[n]|inventario-vitoria[s]|/home[/]|raw/meeting[s]'
GENERICOS='(wiki/|area: *|\[\[)(trabalh[o]|pessoa[l]|ingle[s]|glob[o])'
sujos=0; nao_rastreados=0
# O codigo portado para TypeScript e seus testes entram pela glob: um porte novo
# nao precisa lembrar de se registrar aqui.
TS_PORTADOS=(src/lib/*.ts src/comandos/*.ts src/cli.ts tests/*.test.ts)
DERIVADOS_DO_VAULT=("${PORTADOS[@]}" "${TS_DERIVADOS[@]}")

# Regex que vale para um arquivo: DISTINTIVOS sempre; GENERICOS so no que deriva do vault.
regex_para() {
  local f="$1" d
  for d in "${DERIVADOS_DO_VAULT[@]}"; do
    [ "$f" = "$d" ] && { printf '%s' "$DISTINTIVOS|$GENERICOS"; return; }
  done
  printf '%s' "$DISTINTIVOS"
}

for f in "${PORTADOS[@]}" "${TESTES_NOVOS[@]}" "${TS_PORTADOS[@]}"; do
  if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    conteudo="$(git show ":$f" 2>/dev/null)"
  else
    conteudo="$(cat "$f")"; nao_rastreados=$((nao_rastreados+1))
  fi
  achado="$(printf '%s' "$conteudo" | grep -inE "$(regex_para "$f")" || true)"
  if [ -n "$achado" ]; then
    falha "conteudo do vault privado em $f: $(printf '%s' "$achado" | head -3 | tr '\n' ' ')"
    sujos=$((sujos+1))
  fi
done
[ "$sujos" -eq 0 ] && ok "varredura: nada do vault privado nos scripts restantes, nos testes novos e em src/ e tests/*.test.ts"

# PROVA DE DENTES da varredura: uma varredura que nunca acusa nada pode estar
# acusando nada porque o regex esta quebrado. Arquivos-isca sinteticos, montados
# em pedacos pelo mesmo motivo do regex acima (por extenso, este arquivo se
# acusaria sozinho): um nome distintivo TEM de ser pego em qualquer arquivo; um
# nome de area em posicao de campo TEM de ser pego no que deriva do vault e
# NAO no resto do codigo TypeScript.
isca="$(mktemp)"
area_isca="pesso""al"
distintivo_isca="an""ki"

printf 'nota sobre %s\n' "$distintivo_isca" > "$isca"
if grep -qinE "$(regex_para src/cli.ts)" "$isca" && grep -qinE "$(regex_para "${PORTADOS[0]}")" "$isca"; then
  ok "a varredura pega um nome distintivo em qualquer arquivo (tem dentes)"
else
  falha "a varredura nao pegou o nome distintivo — o regex nao mede nada"
fi

printf 'type: concept\narea: %s\n' "$area_isca" > "$isca"
if grep -qinE "$(regex_para "${PORTADOS[0]}")" "$isca" && grep -qinE "$(regex_para "${TS_DERIVADOS[0]}")" "$isca"; then
  ok "a varredura pega uma area do vault nos scripts e nos modulos derivados (tem dentes)"
else
  falha "a varredura nao pegou a area do vault no que deriva do vault"
fi
if grep -qinE "$(regex_para src/cli.ts)" "$isca" || grep -qinE "$(regex_para tests/lib-frontmatter.test.ts)" "$isca"; then
  falha "a varredura acusou 'area: $area_isca' em codigo TypeScript do produto (falso positivo)"
else
  ok "a varredura tolera 'area: $area_isca' como exemplo no codigo TypeScript do produto"
fi

printf -- 'type: concept\narea: exemplo\n' > "$isca"
if grep -qinE "$(regex_para "${PORTADOS[0]}")" "$isca" || grep -qinE "$(regex_para "${TS_DERIVADOS[0]}")" "$isca"; then
  falha "a varredura acusou uma area neutra (falso positivo)"
else
  ok "a varredura nao acusa area neutra"
fi
rm -f "$isca"
[ "$nao_rastreados" -gt 0 ] && echo "  nota: $nao_rastreados arquivo(s) ainda nao rastreado(s) — varridos na arvore de trabalho"

# Os testes que movem e fatiam arquivos (migrar-areas, fatiar-log) agora sao .test.ts e usam
# mkdtemp de node:os; a trava de diretorio temporario mora neles.

# ============================================================================
# B10 — runtime preservado: 1 bash, 0 Python 3
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
[ "${#BASH_PORTADOS[@]}" -eq 1 ] && ok "1 script bash" || falha "${#BASH_PORTADOS[@]} scripts bash (esperado 1)"
[ "${#PY_PORTADOS[@]}" -eq 0 ]   && ok "nenhum script Python 3" || falha "${#PY_PORTADOS[@]} scripts Python 3 (esperado 0)"

# Os scripts restantes existem e sao executaveis.
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
