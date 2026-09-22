#!/usr/bin/env bash
# C7-C10 — criterios que valem para o porte desta onda inteiro, nao para um
# arquivo so:
#   C7  a decisao do hook mora num script-fonte unico; a forma de um provedor
#       o referencia por caminho; as demais formas estao documentadas
#   C8  o texto de instrucoes da skill nao cita provedor de agente nenhum
#   C9  rodape de atribuicao ao wiki-wonka nos arquivos portados
#   C10 nenhum conteudo pessoal, e nenhum conceito que este repositorio nao tem
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

falhas=0
ok()    { echo "  ok: $*"; }
falha() { echo "  FALHA: $*"; falhas=$((falhas+1)); }

SKILL=skills/lint/SKILL.md
HOOK=hooks/proteger-raw.sh
FORMA=hooks/hooks.json
DOC=hooks/README.md
VARREDURA=scripts/auditar-wiki.py

NOVOS=(
  "$SKILL" "$HOOK" "$FORMA" "$DOC" "$VARREDURA"
  tests/test-auditar-wiki.sh
  tests/test-proteger-raw.sh
  tests/test-porte-onda-3.sh
)

for f in "${NOVOS[@]}"; do
  [ -f "$f" ] && ok "existe: $f" || falha "nao existe: $f"
done

# ============================================================================
# C7 — uma fonte de decisao, uma forma que a referencia, as demais documentadas
# ============================================================================
# A decisao ("este caminho e uma escrita em raw/?") vive numa funcao com nome
# proprio. Contar os arquivos que a contem e o que transforma "sem duplicacao"
# de promessa em medida. `tests/` fica de fora: o teste de mutacao precisa
# nomear a funcao para desativa-la.
donos="$(grep -rl 'escreve_em_raw' --exclude-dir=tests --exclude-dir=.git . | sort)"
if [ "$donos" = "./$HOOK" ]; then
  ok "a decisao mora em um arquivo so: $HOOK"
else
  falha "a decisao aparece em mais de um arquivo: $(echo "$donos" | tr '\n' ' ')"
fi

if python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$FORMA" 2>/dev/null; then
  ok "$FORMA e JSON valido"
else
  falha "$FORMA nao e JSON valido"
fi

if grep -qF 'hooks/proteger-raw.sh' "$FORMA"; then
  ok "a forma de provedor referencia o script-fonte por caminho"
else
  falha "a forma de provedor nao referencia hooks/proteger-raw.sh"
fi

# Referenciar por caminho, nao copiar o conteudo: a forma nao pode conter a
# decisao nem o texto da mensagem de bloqueio.
if grep -qF 'escreve_em_raw' "$FORMA" || grep -qF 'Bloqueado:' "$FORMA"; then
  falha "$FORMA reimplementa a logica em vez de referenciar o script"
else
  ok "a forma de provedor nao reimplementa a logica"
fi

# As demais formas precisam do NOME do formato de configuracao que cada
# provedor consome — documentado, nao necessariamente instalado.
declare -A FORMATOS=(
  [Codex]='config.toml'
  [Gemini]='.gemini/settings.json'
  [Copilot]='settings.json'
)
for provedor in "${!FORMATOS[@]}"; do
  if grep -qF "$provedor" "$DOC" && grep -qF "${FORMATOS[$provedor]}" "$DOC"; then
    ok "$DOC documenta a forma de $provedor (${FORMATOS[$provedor]})"
  else
    falha "$DOC nao documenta a forma de $provedor com o formato ${FORMATOS[$provedor]}"
  fi
done

# ============================================================================
# C8 — nenhum provedor de agente citado no texto de instrucoes da skill
# ============================================================================
# O rodape de atribuicao fica de fora da varredura: ele cita a URL do projeto
# de origem, que a licenca MIT exige preservar, e nao e instrucao de trabalho.
corpo_skill="$(awk '/^_Esta skill é obra derivada/{exit} {print}' "$SKILL")"
PROVEDORES='claude|anthropic|codex|openai|gemini|google|copilot|github'
achado="$(printf '%s' "$corpo_skill" | grep -inE "$PROVEDORES" || true)"
if [ -z "$achado" ]; then
  ok "C8: o texto de instrucoes da skill nao cita provedor de agente"
else
  falha "C8: provedor citado na skill: $(printf '%s' "$achado" | head -3 | tr '\n' ' ')"
fi

# PROVA DE DENTES: a varredura acima tem de pegar uma isca plantada.
if printf 'Rode isto no %s Code.\n' "Clau""de" | grep -qiE "$PROVEDORES"; then
  ok "C8: a varredura de provedor pega uma isca plantada"
else
  falha "C8: a varredura de provedor nao pegou a isca — nao mede nada"
fi

# A skill tem de citar os scripts REAIS deste repositorio, nao os da origem.
for script in "$VARREDURA" scripts/listar-lacunas.py scripts/validar-wiki.sh; do
  grep -qF "$script" "$SKILL" && ok "a skill cita $script" || falha "a skill nao cita $script"
done
for alheio in wiki-validate.sh wiki-log-index.sh daily-lint.sh; do
  grep -qF "$alheio" "$SKILL" && falha "a skill cita script da origem: $alheio" \
                              || ok "a skill nao cita $alheio"
done

# Frontmatter da skill, no mesmo formato das duas ja portadas.
[ "$(sed -n '2p' "$SKILL")" = "name: lint" ] && ok "frontmatter da skill declara name: lint" \
                                             || falha "frontmatter da skill nao declara 'name: lint' na linha 2"

# ============================================================================
# C9 — rodape de atribuicao, no mesmo formato de skills/ingest/SKILL.md
# ============================================================================
ELEMENTOS=(
  'https://github.com/cooperacode/wiki-wonka'
  'Coopera Code'
  'licença MIT'
  'LICENSE'
)
COM_RODAPE=("$SKILL" "$HOOK" "$DOC" "$VARREDURA")
for elemento in "${ELEMENTOS[@]}"; do
  if ! grep -qF -- "$elemento" skills/ingest/SKILL.md; then
    falha "skills/ingest/SKILL.md nao traz '$elemento' — a referencia do formato mudou"
    continue
  fi
  sem_rodape="$(grep -LF -- "$elemento" "${COM_RODAPE[@]}")"
  if [ -z "$sem_rodape" ]; then
    ok "todos os arquivos portados citam '$elemento'"
  else
    falha "arquivos sem '$elemento': $(echo "$sem_rodape" | tr '\n' ' ')"
  fi
done
for f in "${COM_RODAPE[@]}"; do
  tail -6 "$f" | grep -qF 'cooperacode/wiki-wonka' && ok "$(basename "$(dirname "$f")")/$(basename "$f"): rodape nas ultimas linhas" \
                                                   || falha "$f: atribuicao nao esta no rodape"
done

# ============================================================================
# C10a — nada do vault privado nem do ferramental nos arquivos novos
# ============================================================================
# Varredura sobre os BLOBS DO COMMIT, nao sobre a arvore em disco: e o conteudo
# versionado que vaza. Arquivo ainda nao rastreado cai para a arvore, com aviso.
# Cada termo tem a ultima letra escrita como classe de um caractere so — ESTE
# arquivo tambem entra na varredura, e um scanner que lista os termos por
# extenso se acusa sozinho. Alarme que sempre toca nao e alarme.
DISTINTIVOS='side-projec[t]|terapi[a]|garmi[n]|planeja[i]|ank[i]|iag[o]|qualidade-softwar[e]|engenharia-softwar[e]|notio[n]|inventario-vitoria[s]|/home[/]|raw/meeting[s]'
GENERICOS='(wiki/|area: *|\[\[)(trabalh[o]|pessoa[l]|ingle[s]|glob[o])'
sujos=0; nao_rastreados=0
for f in "${NOVOS[@]}"; do
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
[ "$sujos" -eq 0 ] && ok "C10a: nada do vault privado nos arquivos novos"

# O ferramental de coordenacao que produziu este porte nao e parte do produto e
# nao entra em arquivo versionado. A varredura procura as FORMAS estruturais
# desses identificadores — id de jornada e diretorio de worktree —, nunca os
# nomes proprios por tras deles: um scanner que enumera nomes publica
# exatamente o que veio impedir que vazasse, e nenhuma ofuscacao resolve isso,
# porque quem le o arquivo nao e um grep. Ultima letra como classe de um
# caractere so pelo motivo de sempre: ESTE arquivo tambem entra na varredura.
FERRAMENTAL='j-[0-9]{8}-[a-z0-9]{2}|\.worktree[s]/'
sujos=0
for f in "${NOVOS[@]}"; do
  achado="$(grep -inE "$FERRAMENTAL" "$f" || true)"
  if [ -n "$achado" ]; then
    falha "identificador do ferramental em $f: $(printf '%s' "$achado" | head -2 | tr '\n' ' ')"
    sujos=$((sujos+1))
  fi
done
[ "$sujos" -eq 0 ] && ok "C10a: nenhum identificador do ferramental nos arquivos novos"

# PROVA DE DENTES, com isca sintetica: id de jornada e caminho de worktree em
# forma valida, sem ser de jornada nenhuma que exista.
isca="$(mktemp)"
printf 'Escrito em %s durante a jornada %s.\n' ".worktree""s/exemplo" "j-1970""0101-zz" > "$isca"
grep -qinE "$FERRAMENTAL" "$isca" && ok "C10a: a varredura de ferramental tem dentes" \
                                  || falha "C10a: a varredura de ferramental nao pegou a isca"
# Controle: caminho e nome comuns do repositorio nao podem acusar.
printf -- 'Rode bash tests/test-porte-onda-3.sh sobre wiki/exemplo/nota.md.\n' > "$isca"
grep -qinE "$FERRAMENTAL" "$isca" && falha "C10a: a varredura de ferramental acusou caminho neutro (falso positivo)" \
                                  || ok "C10a: a varredura de ferramental nao acusa caminho neutro"

area_isca="pesso""al"
printf 'type: concept\narea: %s\n' "$area_isca" > "$isca"
grep -qinE "$DISTINTIVOS|$GENERICOS" "$isca" && ok "C10a: a varredura pega uma isca plantada" \
                                             || falha "C10a: a varredura nao pegou a isca"
printf -- 'type: concept\narea: exemplo\n' > "$isca"
grep -qinE "$DISTINTIVOS|$GENERICOS" "$isca" && falha "C10a: a varredura acusou area neutra (falso positivo)" \
                                             || ok "C10a: a varredura nao acusa area neutra"
rm -f "$isca"
[ "$nao_rastreados" -gt 0 ] && echo "  nota: $nao_rastreados arquivo(s) ainda nao rastreado(s) — varridos na arvore de trabalho"

# ============================================================================
# C10b — nenhum conceito que este repositorio nao tem
# ============================================================================
# A camada de memorias da origem, os callouts que o SCHEMA.md nao define, e o
# indice por area: tres coisas que a skill de origem assume e que aqui nao
# existem. Mesma tecnica de ultima-letra-em-classe, pelo mesmo motivo.
AUSENTES='memorie[s]|\[!outdate[d]\]|\[!deprecate[d]\]|outdate[d]|deprecate[d]'
INDICE_POR_AREA='wiki/[^/]+/inde[x]\.md'
sujos=0
for f in "${NOVOS[@]}"; do
  achado="$(grep -inE "$AUSENTES" "$f" || true)"
  if [ -n "$achado" ]; then
    falha "conceito inexistente neste repositorio em $f: $(printf '%s' "$achado" | head -2 | tr '\n' ' ')"
    sujos=$((sujos+1))
  fi
  achado="$(grep -inE "$INDICE_POR_AREA" "$f" || true)"
  if [ -n "$achado" ]; then
    falha "indice por area em $f: $(printf '%s' "$achado" | head -2 | tr '\n' ' ')"
    sujos=$((sujos+1))
  fi
done
[ "$sujos" -eq 0 ] && ok "C10b: nenhum conceito ausente deste repositorio nos arquivos novos"

# PROVA DE DENTES das duas varreduras de C10b.
isca="$(mktemp)"
printf 'Leia %s e o callout [!%s].\n' "wiki/alfa/inde""x.md" "outdate""d" > "$isca"
grep -qinE "$AUSENTES" "$isca"       && ok "C10b: a varredura de conceito ausente tem dentes" \
                                     || falha "C10b: a varredura de conceito ausente nao pegou a isca"
grep -qinE "$INDICE_POR_AREA" "$isca" && ok "C10b: a varredura de indice por area tem dentes" \
                                      || falha "C10b: a varredura de indice por area nao pegou a isca"
printf -- 'Leia wiki/index.md e o callout [!gap].\n' > "$isca"
grep -qinE "$AUSENTES|$INDICE_POR_AREA" "$isca" && falha "C10b: as varreduras acusaram o indice unico (falso positivo)" \
                                                 || ok "C10b: o indice unico wiki/index.md nao e acusado"
rm -f "$isca"

# ============================================================================
# Runtime e sintaxe dos arquivos novos
# ============================================================================
[ "$(head -1 "$HOOK")" = "#!/usr/bin/env bash" ] && ok "$HOOK: shebang bash" || falha "$HOOK: shebang '$(head -1 "$HOOK")'"
[ "$(head -1 "$VARREDURA")" = "#!/usr/bin/env python3" ] && ok "$VARREDURA: shebang python3" || falha "$VARREDURA: shebang '$(head -1 "$VARREDURA")'"
bash -n "$HOOK" 2>/dev/null && ok "$HOOK: sintaxe bash ok" || falha "$HOOK: erro de sintaxe bash"
python3 -m py_compile "$VARREDURA" 2>/dev/null && ok "$VARREDURA: compila em Python 3" || falha "$VARREDURA: erro de sintaxe Python"
rm -rf scripts/__pycache__

# Os hooks moram em hooks/ na raiz, versionado — nao num diretorio de provedor.
[ -d hooks ] && ok "os hooks moram em hooks/ na raiz" || falha "diretorio hooks/ nao existe na raiz"
for proibido in .claude/hooks .codex/hooks .gemini/hooks; do
  [ -e "$proibido" ] && falha "hook instalado em diretorio de provedor: $proibido" \
                     || ok "ausente (correto): $proibido"
done

[ "$falhas" -eq 0 ] && echo "OK: porte-onda-3"
exit "$falhas"
