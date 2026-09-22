#!/usr/bin/env bash
# D1-D11 — o instalador multi-agente.
#
# ISOLAMENTO DE DESTINO, ANTES DE QUALQUER OUTRA COISA
#
#   Este e o unico teste do repositorio que exercita um programa cujo trabalho e
#   ESCREVER na maquina de quem roda. Escrever no lugar errado uma vez so ja e
#   dano que nenhum teste verde depois compensa. Entao:
#
#     - todo destino e um diretorio temporario, criado e destruido aqui;
#     - toda invocacao do instalador roda com HOME apontando para um diretorio
#       falso e vazio, e o fim do teste PROVA que ele continua vazio;
#     - nenhuma invocacao usa o proprio repositorio como destino.
#
#   A prova de que HOME ficou intocado nao e opcional nem decorativa: sem ela,
#   "o instalador nao mexe na sua configuracao" seria uma afirmacao sobre o
#   codigo, e o que se quer e uma afirmacao sobre o disco.
#
# E AS DUAS DISCIPLINAS DE SEMPRE
#
#   GRUPO DE CONTROLE — toda asercao "preservou o que ja estava la" exige, na
#   MESMA execucao, que o que o instalador acrescenta tenha sido escrito. Sem
#   isso, "preservou" e indistinguivel de "nao fez nada".
#
#   PROVA POR MUTACAO — "--simular nao escreve" so significa alguma coisa se a
#   mesma chamada sem --simular escrever. O hash do disco prova os dois lados.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
REPO="$PWD"

falhas=0
ok()    { echo "  ok: $*"; }
falha() { echo "  FALHA: $*"; falhas=$((falhas+1)); }

TMP="$(mktemp -d)"
LAR_FALSO="$TMP/lar-falso"
mkdir -p "$LAR_FALSO"
trap 'rm -rf "$TMP"' EXIT

# instalador <destino> [args...] -> roda o instalador isolado; ecoa a saida
instalador() {
  local destino="$1"; shift
  HOME="$LAR_FALSO" bash "$destino/instalar.sh" --destino "$destino" "$@" 2>&1
}

# captura <dir> -> "caminho hash" de cada arquivo e link, ordenado. E ISTO que
# decide se o disco mudou — nunca o texto que o instalador imprime.
captura() {
  ( cd "$1" && find . -path ./.git -prune -o \( -type f -o -type l \) -print \
    | sort | while IFS= read -r f; do
        if [ -L "$f" ]; then
          printf '%s LINK:%s\n' "$f" "$(readlink "$f")"
        else
          printf '%s %s\n' "$f" "$(sha256sum "$f" | cut -d' ' -f1)"
        fi
      done )
}

# clone_de_teste <dir> -> um clone do repositorio, com historico, fora daqui
clone_de_teste() {
  mkdir -p "$1"
  tar -c --exclude=.git -C "$REPO" . | tar -x -C "$1"
  git -C "$1" init -q
  git -C "$1" add -A >/dev/null 2>&1
  git -C "$1" -c user.email=teste@exemplo -c user.name=teste commit -qm fixture
}

INSTALADOR="$REPO/instalar.sh"
[ -f "$INSTALADOR" ] || { falha "instalar.sh nao existe"; exit 1; }
[ -x "$INSTALADOR" ] && ok "instalar.sh e executavel" || falha "instalar.sh sem bit de execucao"
bash -n "$INSTALADOR" && ok "instalar.sh: sintaxe bash ok" || falha "instalar.sh: erro de sintaxe"

# ============================================================================
# ISOLAMENTO — as travas, antes de deixar o instalador escrever qualquer coisa
# ============================================================================
saida="$(HOME="$LAR_FALSO" bash "$INSTALADOR" --destino "$LAR_FALSO" 2>&1)"; c=$?
[ "$c" -ne 0 ] && ok "recusa instalar no proprio \$HOME (saida $c)" \
               || falha "INSTALOU NO \$HOME — isto e achado bloqueante"
printf '%s' "$saida" | grep -qi 'recusad' && ok "a recusa de \$HOME explica o motivo" \
                                          || falha "recusou \$HOME em silencio"

vazio="$TMP/nao-e-clone"; mkdir -p "$vazio"
HOME="$LAR_FALSO" bash "$INSTALADOR" --destino "$vazio" >/dev/null 2>&1
[ $? -ne 0 ] && ok "recusa destino que nao e um clone do anvilore" \
             || falha "aceitou um destino que nao e clone do anvilore"
[ -z "$(ls -A "$vazio")" ] && ok "o destino recusado ficou vazio (nada escrito)" \
                           || falha "escreveu num destino que dizia recusar"

# O destino tambem entra por variavel de ambiente, nao so por flag.
alvo_env="$TMP/por-ambiente"; clone_de_teste "$alvo_env"
HOME="$LAR_FALSO" ANVILORE_DESTINO="$alvo_env" bash "$alvo_env/instalar.sh" --alvo claude >/dev/null 2>&1
[ -e "$alvo_env/.claude/settings.json" ] && ok "ANVILORE_DESTINO e respeitado" \
                                         || falha "ANVILORE_DESTINO foi ignorado"

# ============================================================================
# D9 — alvo declarado Linux, sem promessa de Windows/macOS
# ============================================================================
ajuda="$(bash "$INSTALADOR" --help 2>&1)"
printf '%s' "$ajuda" | grep -qi 'linux' && ok "D9: --help declara Linux" \
                                        || falha "D9: --help nao menciona Linux"
achado="$(printf '%s' "$ajuda" | grep -inE 'windows|macos|mac os|darwin|powershell' \
          | grep -viE 'nao ha suporte|não há suporte|sem suporte|nem a macos|nem macos' || true)"
if [ -z "$achado" ]; then
  ok "D9: --help nao promete Windows/macOS"
else
  falha "D9: --help fala de outro sistema: $(printf '%s' "$achado" | head -2 | tr '\n' ' ')"
fi

# ============================================================================
# D6 — esqueleto da wiki
# ============================================================================
alvo="$TMP/d6"; clone_de_teste "$alvo"
rm -rf "$alvo/wiki"                       # alguem apagou o esqueleto antes de instalar
instalador "$alvo" --alvo claude >/dev/null

# Esta comparacao e, de quebra, a prova de que a lista que o instalador le de
# `wiki/.gitignore` concorda com o que o git versiona: se as duas divergirem, o
# conjunto recriado diverge junto e este teste fica vermelho.
esperado="$(git -C "$REPO" ls-files -- wiki/ | sort)"
obtido="$(cd "$alvo" && find wiki -type f | sort)"
if [ "$esperado" = "$obtido" ]; then
  ok "D6: o esqueleto recriado e exatamente o que a Onda 1 versiona"
else
  falha "D6: esqueleto diverge — so no versionado: $(comm -23 <(echo "$esperado") <(echo "$obtido") | tr '\n' ' ')"
fi

difere=0
while IFS= read -r rel; do
  a="$(git -C "$REPO" show "HEAD:$rel" | sha256sum | cut -d' ' -f1)"
  b="$(sha256sum "$alvo/$rel" | cut -d' ' -f1)"
  [ "$a" = "$b" ] || { falha "D6: conteudo diferente do versionado: $rel"; difere=1; }
done <<< "$esperado"
[ "$difere" -eq 0 ] && ok "D6: cada peca do esqueleto bate byte a byte com a versionada"

# Conteudo real de quem usa: sobrevive, e o esqueleto nao duplica.
pagina="$alvo/wiki/exemplo/concepts/pagina-de-quem-usa.md"
printf -- '---\ntype: concept\nslug: pagina-de-quem-usa\n---\n\nConteudo real.\n' > "$pagina"
hash_pagina="$(sha256sum "$pagina" | cut -d' ' -f1)"
antes_wiki="$(captura "$alvo/wiki")"
instalador "$alvo" --alvo claude >/dev/null
depois_wiki="$(captura "$alvo/wiki")"
[ "$(sha256sum "$pagina" | cut -d' ' -f1)" = "$hash_pagina" ] \
  && ok "D6: a pagina de quem usa ficou intacta" \
  || falha "D6: a pagina de quem usa foi alterada"
[ "$antes_wiki" = "$depois_wiki" ] && ok "D6: reinstalar nao duplicou nem mexeu na wiki" \
                                   || falha "D6: a wiki mudou ao reinstalar"

# ============================================================================
# D1 — idempotencia, medida no disco
# ============================================================================
alvo="$TMP/d1"; clone_de_teste "$alvo"
instalador "$alvo" --alvo claude >/dev/null
primeira="$(captura "$alvo")"
saida="$(instalador "$alvo" --alvo claude)"
segunda="$(captura "$alvo")"
[ "$primeira" = "$segunda" ] && ok "D1: a segunda execucao nao mudou um byte" \
                             || falha "D1: a segunda execucao mudou o disco: $(diff <(echo "$primeira") <(echo "$segunda") | head -4 | tr '\n' ' ')"
if printf '%s' "$saida" | grep -qiE 'nada a fazer'; then
  ok "D1: o instalador diz explicitamente que nao havia nada a fazer"
else
  falha "D1: a segunda execucao nao disse que nada havia a fazer: $(printf '%s' "$saida" | tail -2 | tr '\n' ' ')"
fi

# ============================================================================
# D2 — modo relatorio, com a mutacao que lhe da sentido
# ============================================================================
alvo="$TMP/d2"; clone_de_teste "$alvo"
antes="$(captura "$alvo")"
saida="$(instalador "$alvo" --alvo claude --simular)"
depois="$(captura "$alvo")"
[ "$antes" = "$depois" ] && ok "D2: --simular nao criou, alterou nem removeu nada" \
                         || falha "D2: --simular mexeu no disco"
printf '%s' "$saida" | grep -qiE 'simula' && ok "D2: a saida se identifica como simulacao" \
                                          || falha "D2: a saida nao se identifica como simulacao"

# MUTACAO: sem --simular, o MESMO alvo TEM de mudar. Se nao mudasse, o teste
# acima estaria medindo uma instalacao que nao faria nada de todo jeito.
instalador "$alvo" --alvo claude >/dev/null
sem_simular="$(captura "$alvo")"
[ "$antes" != "$sem_simular" ] && ok "D2: --simular tem dentes — sem ele o disco muda" \
                               || falha "D2: --simular nao mede nada — sem ele o disco tambem nao muda"

# ============================================================================
# D3 / D7 — CLI ausente do PATH
# ============================================================================
# PATH de teste: um shim de `claude` e NADA de codex/gemini/copilot.
#
# Por que nao basta `PATH=$BIN:/usr/bin:/bin`: numa maquina que instalou esses
# tres agentes por pacote global, eles ESTAO em `/usr/bin`, e o cenario "a CLI
# nao existe" deixaria de existir sem ninguem perceber. Entao o PATH de teste e
# montado do zero, com ligacoes so para as ferramentas de que o instalador
# depende. A asercao logo abaixo e o que impede este teste de virar decoracao:
# se um dos tres reaparecer no PATH, o cenario e declarado invalido em vez de
# passar verde.
BIN="$TMP/bin"; mkdir -p "$BIN"
printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/claude"; chmod +x "$BIN/claude"
for ferramenta in bash env python3 git sed cat cp mkdir rm ln readlink dirname basename head grep mktemp; do
  caminho="$(command -v "$ferramenta" 2>/dev/null)" \
    && ln -sf "$caminho" "$BIN/$ferramenta" \
    || falha "D3: ferramenta de sistema ausente, o PATH de teste fica incompleto: $ferramenta"
done
CAMINHO_DE_TESTE="$BIN"

vazou=0
for ausente in codex gemini copilot; do
  if PATH="$CAMINHO_DE_TESTE" command -v "$ausente" >/dev/null 2>&1; then
    falha "D3: '$ausente' vazou para o PATH de teste — o cenario nao vale"
    vazou=1
  fi
done
[ "$vazou" -eq 0 ] && ok "D3: o PATH de teste tem 'claude' e nao tem os outros tres"
PATH="$CAMINHO_DE_TESTE" command -v claude >/dev/null 2>&1 \
  && ok "D3 (controle): 'claude' E encontravel no mesmo PATH" \
  || falha "D3 (controle): nem 'claude' e encontravel — o PATH de teste esta quebrado"

alvo="$TMP/d3"; clone_de_teste "$alvo"
saida="$(HOME="$LAR_FALSO" PATH="$CAMINHO_DE_TESTE" bash "$alvo/instalar.sh" --destino "$alvo" --alvo claude,codex 2>&1)"
c=$?
# Se o PATH enxuto tiver deixado de fora alguma ferramenta de que o instalador
# precisa, ele falharia por um motivo que nao e o do teste — e o verde seria
# mentira. Esta asercao separa "a CLI do alvo falta" de "o ambiente quebrou".
printf '%s' "$saida" | grep -qiE 'not found|comando não encontrado|command not found' \
  && falha "D3: o PATH de teste quebrou o instalador: $(printf '%s' "$saida" | grep -iE 'not found' | head -2 | tr '\n' ' ')" \
  || ok "D3: o instalador rodou sem ferramenta de sistema faltando"
[ "$c" -eq 0 ] && ok "D3: sucesso parcial termina com exit 0" \
               || falha "D3: abortou com exit $c so porque um alvo falta"
[ -e "$alvo/.claude/settings.json" ] && ok "D3: o alvo presente foi instalado" \
                                     || falha "D3: o alvo presente nao foi instalado"
[ -e "$alvo/.codex/config.toml" ] && falha "D3: instalou o alvo cuja CLI nao existe" \
                                  || ok "D3: o alvo ausente nao foi instalado"
printf '%s' "$saida" | grep -qiE 'ausente' && ok "D3: o alvo ausente foi relatado como ausente" \
                                           || falha "D3: o alvo ausente nao foi relatado"

alvo="$TMP/d7"; clone_de_teste "$alvo"
saida="$(HOME="$LAR_FALSO" PATH="$CAMINHO_DE_TESTE" bash "$alvo/instalar.sh" --destino "$alvo" --alvo todos 2>&1)"
c=$?
[ "$c" -eq 0 ] && ok "D7: --alvo todos com CLIs faltando termina com exit 0" \
               || falha "D7: --alvo todos abortou com exit $c"
[ -e "$alvo/.claude/settings.json" ] && ok "D7: o presente foi instalado" \
                                     || falha "D7: o presente nao foi instalado"
faltou=0
for ausente in .codex .gemini ".github/copilot"; do
  [ -e "$alvo/$ausente" ] && { falha "D7: instalou alvo ausente ($ausente)"; faltou=1; }
done
[ "$faltou" -eq 0 ] && ok "D7: nenhum alvo ausente foi instalado"
for nome in codex gemini copilot; do
  printf '%s' "$saida" | grep -qE "$nome" || falha "D7: '$nome' nao aparece no relato"
done
ok "D7: os tres ausentes aparecem no relato"

# ============================================================================
# D4 — configuracao previa de quem usa, COM grupo de controle
# ============================================================================
alvo="$TMP/d4"; clone_de_teste "$alvo"
mkdir -p "$alvo/.claude"
cat > "$alvo/.claude/settings.json" <<'JSON'
{
  "preferenciaArbitraria": "escolha de quem usa",
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [ { "type": "command", "command": "./outro-hook.sh" } ] }
    ]
  }
}
JSON
instalador "$alvo" --alvo claude >/dev/null

le_json() { python3 -c "$1" "$alvo/.claude/settings.json"; }
if le_json 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if d.get("preferenciaArbitraria")=="escolha de quem usa" else 1)'; then
  ok "D4: a chave previa de quem usa sobreviveu"
else
  falha "D4: a chave previa de quem usa foi perdida"
fi
if le_json 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if any(g.get("matcher")=="Bash" for g in d["hooks"]["PreToolUse"]) else 1)'; then
  ok "D4: o hook de outra origem sobreviveu"
else
  falha "D4: o hook de outra origem foi apagado"
fi
# GRUPO DE CONTROLE: a mesma execucao tem de provar que o hook NOVO entrou.
if le_json 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if any("proteger-raw" in json.dumps(g) for g in d["hooks"]["PreToolUse"]) else 1)'; then
  ok "D4 (controle): o hook do anvilore foi mesmo escrito"
else
  falha "D4 (controle): o hook do anvilore nao entrou — a fusao nao fez nada"
fi

# D4, o outro desfecho legitimo: quando fundir e impossivel, AVISA e RECUSA —
# e a prova de que nao escreveu e o hash, nao a mensagem.
alvo="$TMP/d4-conflito"; clone_de_teste "$alvo"
mkdir -p "$alvo/.gemini"
printf '{"context": {"fileName": "GEMINI.md"}}\n' > "$alvo/.gemini/settings.json"
hash_antes="$(sha256sum "$alvo/.gemini/settings.json" | cut -d' ' -f1)"
saida="$(instalador "$alvo" --alvo gemini)"; c=$?
hash_depois="$(sha256sum "$alvo/.gemini/settings.json" | cut -d' ' -f1)"
[ "$hash_antes" = "$hash_depois" ] && ok "D4: no conflito, o arquivo de quem usa ficou intacto" \
                                   || falha "D4: SOBRESCREVEU a configuracao de quem usa"
[ "$c" -ne 0 ] && ok "D4: o conflito termina com saida ≠0 (saida $c)" \
               || falha "D4: o conflito passou como sucesso"
printf '%s' "$saida" | grep -qiE 'recusad|ERRO' && ok "D4: o conflito e dito explicitamente" \
                                                || falha "D4: recusou em silencio"

# ============================================================================
# D8 — cada forma instalada REFERENCIA o script, nenhuma o reimplementa
# ============================================================================
alvo="$TMP/d8"; clone_de_teste "$alvo"
instalador "$alvo" --alvo todos >/dev/null
declare -A FORMAS=(
  [claude]=".claude/settings.json"
  [codex]=".codex/config.toml"
  [gemini]=".gemini/settings.json"
  [copilot]=".github/copilot/settings.json"
)
for provedor in "${!FORMAS[@]}"; do
  arquivo="$alvo/${FORMAS[$provedor]}"
  if [ ! -f "$arquivo" ]; then
    falha "D8: $provedor nao instalou ${FORMAS[$provedor]}"
    continue
  fi
  grep -qF 'hooks/proteger-raw.sh' "$arquivo" \
    && ok "D8: $provedor referencia hooks/proteger-raw.sh por caminho" \
    || falha "D8: $provedor nao referencia hooks/proteger-raw.sh"
  if grep -qF 'escreve_em_raw' "$arquivo" || grep -qF 'Bloqueado:' "$arquivo"; then
    falha "D8: $provedor reimplementa a decisao em vez de referencia-la"
  else
    ok "D8: $provedor nao reimplementa a decisao"
  fi
done
# A decisao continua morando num arquivo so, inclusive depois de instalar.
donos="$(grep -rl 'escreve_em_raw' --exclude-dir=tests --exclude-dir=.git "$alvo" | sort)"
[ "$donos" = "$alvo/hooks/proteger-raw.sh" ] \
  && ok "D8: depois da instalacao, a decisao ainda mora em um arquivo so" \
  || falha "D8: a decisao aparece em mais de um arquivo: $(echo "$donos" | tr '\n' ' ')"

# ============================================================================
# D10 — a neutralidade de provedor sobrevive a instalacao
# ============================================================================
# As skills instaladas para claude/codex/copilot sao LINKS para os arquivos
# versionados, entao a leitura abaixo atravessa o link e cai no texto real.
PROVEDORES='claude|anthropic|codex|openai|gemini|google|copilot|github'
instaladas=(
  "$alvo/.claude/skills/ingest/SKILL.md"
  "$alvo/.claude/skills/query/SKILL.md"
  "$alvo/.claude/skills/lint/SKILL.md"
  "$alvo/.agents/skills/ingest/SKILL.md"
  "$alvo/.agents/skills/query/SKILL.md"
  "$alvo/.agents/skills/lint/SKILL.md"
  "$alvo/.github/agents/ingest.agent.md"
  "$alvo/.github/agents/query.agent.md"
  "$alvo/.github/agents/lint.agent.md"
  "$alvo/.gemini/commands/ingest.toml"
  "$alvo/.gemini/commands/query.toml"
  "$alvo/.gemini/commands/lint.toml"
)
sujas=0
for arquivo in "${instaladas[@]}"; do
  if [ ! -e "$arquivo" ]; then
    falha "D10: skill instalada ausente: ${arquivo#"$alvo"/}"
    sujas=$((sujas+1)); continue
  fi
  # O rodape de atribuicao fica de fora: cita a URL do projeto de origem, que a
  # licenca MIT exige preservar, e nao e instrucao de trabalho.
  corpo="$(awk '/^_Esta skill é obra derivada/{exit} {print}' "$arquivo")"
  achado="$(printf '%s' "$corpo" | grep -inE "$PROVEDORES" || true)"
  if [ -n "$achado" ]; then
    falha "D10: provedor citado em ${arquivo#"$alvo"/}: $(printf '%s' "$achado" | head -2 | tr '\n' ' ')"
    sujas=$((sujas+1))
  fi
done
[ "$sujas" -eq 0 ] && ok "D10: nenhuma skill instalada cita provedor de agente"
# PROVA DE DENTES: a varredura tem de pegar uma isca plantada.
printf 'Rode isto no %s Code.\n' "Clau""de" | grep -qiE "$PROVEDORES" \
  && ok "D10: a varredura de provedor pega uma isca plantada" \
  || falha "D10: a varredura de provedor nao pegou a isca — nao mede nada"

# As skills sao LINK, nao copia: editar a skill do repositorio muda a instalada.
if [ -L "$alvo/.claude/skills/lint" ]; then
  ok "D10: a skill instalada e um link para a versionada (uma fonte so)"
else
  falha "D10: a skill instalada e copia — vai envelhecer em silencio"
fi

# ============================================================================
# DESTINO != FONTE — o link tem de RESOLVER, nao so ser criado
# ============================================================================
# `--help` promete escolher "em qual clone do anvilore instalar", entao fonte !=
# destino e cenario suportado, nao hipotese. Todo o resto desta suite instala
# "para si mesmo" (destino == fonte), e nesse caso um alvo de link calculado a
# partir do destino acerta por coincidencia: as duas arvores sao a mesma.
#
# A asercao aqui NAO e "o instalador saiu 0" nem "o link existe". Link orfao
# existe, tem nome bonito no relato ("liga: ...") e nao aponta para arquivo
# nenhum. A asercao e que `readlink -f` chegue num arquivo que EXISTE e cujo
# conteudo e o da FONTE.
fonte="$TMP/fonte"; clone_de_teste "$fonte"
destino="$TMP/destino"; clone_de_teste "$destino"

# Duas divergencias plantadas, cada uma para um modo de falha diferente:
#
#   skills/nova  — so existe na FONTE. E o caso do clone-destino mais velho:
#                  um alvo relativo ao destino nao resolve para nada.
#   skills/lint  — existe nas DUAS, com conteudos diferentes. E o caso pior,
#                  porque um alvo errado aqui resolve para um arquivo de
#                  verdade, so que o arquivo errado — e nada fica vermelho.
mkdir -p "$fonte/skills/nova"
printf -- '---\nname: nova\ndescription: "skill que so a fonte tem"\n---\n\nMARCA-DA-FONTE\n' \
  > "$fonte/skills/nova/SKILL.md"
printf -- '\nMARCA-DA-FONTE\n' >> "$fonte/skills/lint/SKILL.md"
printf -- '\nMARCA-DO-DESTINO\n' >> "$destino/skills/lint/SKILL.md"

saida="$(HOME="$LAR_FALSO" bash "$fonte/instalar.sh" --destino "$destino" --alvo claude,codex,copilot 2>&1)"; c=$?
[ "$c" -eq 0 ] && ok "fonte != destino: a instalacao termina com exit 0" \
               || falha "fonte != destino: a instalacao saiu $c: $(printf '%s' "$saida" | tail -3 | tr '\n' ' ')"

# GRUPO DE CONTROLE: o destino tem de ter sido tocado. Sem isto, "os links
# resolvem" seria indistinguivel de "nao instalou nada e nao ha link para
# quebrar".
[ -e "$destino/.claude/settings.json" ] && ok "fonte != destino (controle): o destino foi mesmo instalado" \
                                        || falha "fonte != destino (controle): nada foi instalado no destino"

# Os tres alvos que instalam skill por link simbolico. Para cada um: o caminho
# instalado, e o arquivo de skill que se espera alcancar atraves dele.
LIGADOS=(
  ".claude/skills/nova/SKILL.md"
  ".claude/skills/lint/SKILL.md"
  ".agents/skills/nova/SKILL.md"
  ".agents/skills/lint/SKILL.md"
  ".github/agents/nova.agent.md"
  ".github/agents/lint.agent.md"
)
orfaos=0
errados=0
for rel in "${LIGADOS[@]}"; do
  caminho="$destino/$rel"
  if [ ! -e "$caminho" ]; then
    falha "fonte != destino: link orfao, nao resolve para arquivo nenhum: $rel -> $(readlink "${caminho%/SKILL.md}" 2>/dev/null || readlink "$caminho" 2>/dev/null)"
    orfaos=$((orfaos+1)); continue
  fi
  if ! grep -qF 'MARCA-DA-FONTE' "$caminho"; then
    falha "fonte != destino: o link resolve, mas para o arquivo ERRADO (nao e o da fonte): $rel"
    errados=$((errados+1)); continue
  fi
  if grep -qF 'MARCA-DO-DESTINO' "$caminho"; then
    falha "fonte != destino: o link caiu na copia do destino: $rel"
    errados=$((errados+1))
  fi
done
[ "$orfaos" -eq 0 ]  && ok "fonte != destino: nenhum link ficou orfao (readlink -f chega num arquivo real)"
[ "$errados" -eq 0 ] && ok "fonte != destino: todo link resolve para o arquivo da FONTE, nao para a copia do destino"

# E a prova de que a varredura acima tem dentes: um link montado do jeito
# ANTIGO — relativo ao destino — TEM de ser pego por ela.
ln -s "../../skills/nova" "$destino/.claude/skills/nova-antiga"
if [ -e "$destino/.claude/skills/nova-antiga/SKILL.md" ]; then
  falha "fonte != destino: a verificacao nao tem dentes — o alvo antigo resolveu"
else
  ok "fonte != destino: a verificacao tem dentes — o alvo relativo ao destino NAO resolve"
fi
rm -f "$destino/.claude/skills/nova-antiga"

# Nada disso pode ter custado o caso comum: com destino == fonte, o alvo do
# link continua sendo exatamente o mesmo `../../skills/<nome>` de antes.
alvo="$TMP/mesma-arvore"; clone_de_teste "$alvo"
instalador "$alvo" --alvo claude,codex,copilot >/dev/null
esperados=0
[ "$(readlink "$alvo/.claude/skills/lint")" = "../../skills/lint" ] || esperados=1
[ "$(readlink "$alvo/.agents/skills/lint")" = "../../skills/lint" ] || esperados=1
[ "$(readlink "$alvo/.github/agents/lint.agent.md")" = "../../skills/lint/SKILL.md" ] || esperados=1
[ "$esperados" -eq 0 ] \
  && ok "destino == fonte: o alvo do link continua relativo e inalterado" \
  || falha "destino == fonte: o alvo do link mudou — $(readlink "$alvo/.claude/skills/lint")"

# ============================================================================
# D11 — nada pessoal, e nada do ferramental, nos arquivos novos
# ============================================================================
# Mesma tecnica estrutural da Onda 3: cada termo com a ultima letra escrita como
# classe de um caractere so, porque ESTE arquivo tambem entra na varredura e um
# scanner que lista os termos por extenso se acusa sozinho.
NOVOS=(
  instalar.sh
  scripts/fundir-json.py
  scripts/fundir-bloco.py
  tests/test-instalar.sh
  tests/test-fundir-json.sh
  tests/test-instalar-agente-real.sh
)
for f in "${NOVOS[@]}"; do
  [ -f "$REPO/$f" ] && ok "existe: $f" || falha "nao existe: $f"
done

DISTINTIVOS='side-projec[t]|terapi[a]|garmi[n]|planeja[i]|ank[i]|iag[o]|qualidade-softwar[e]|engenharia-softwar[e]|notio[n]|inventario-vitoria[s]|/home[/]|raw/meeting[s]'
GENERICOS='(wiki/|area: *|\[\[)(trabalh[o]|pessoa[l]|ingle[s]|glob[o])'
FERRAMENTAL='j-[0-9]{8}-[a-z0-9]{2}|\.worktree[s]/'

sujos=0
for f in "${NOVOS[@]}"; do
  [ -f "$REPO/$f" ] || continue
  achado="$(grep -inE "$DISTINTIVOS|$GENERICOS" "$REPO/$f" || true)"
  if [ -n "$achado" ]; then
    falha "D11: conteudo pessoal em $f: $(printf '%s' "$achado" | head -2 | tr '\n' ' ')"
    sujos=$((sujos+1))
  fi
done
[ "$sujos" -eq 0 ] && ok "D11: nada de assunto/caminho pessoal nos arquivos novos"

sujos=0
for f in "${NOVOS[@]}"; do
  [ -f "$REPO/$f" ] || continue
  achado="$(grep -inE "$FERRAMENTAL" "$REPO/$f" || true)"
  if [ -n "$achado" ]; then
    falha "D11: identificador de ferramental em $f: $(printf '%s' "$achado" | head -2 | tr '\n' ' ')"
    sujos=$((sujos+1))
  fi
done
[ "$sujos" -eq 0 ] && ok "D11: nenhum identificador de ferramental nos arquivos novos"

# PROVA DE DENTES das duas varreduras, com iscas sinteticas.
isca="$TMP/isca.txt"
printf 'Escrito em %s durante a jornada %s.\n' ".worktree""s/exemplo" "j-1970""0101-zz" > "$isca"
grep -qinE "$FERRAMENTAL" "$isca" && ok "D11: a varredura de ferramental tem dentes" \
                                  || falha "D11: a varredura de ferramental nao pegou a isca"
printf -- 'Rode bash tests/test-instalar.sh sobre wiki/exemplo/nota.md.\n' > "$isca"
grep -qinE "$FERRAMENTAL" "$isca" && falha "D11: a varredura de ferramental acusou caminho neutro" \
                                  || ok "D11: a varredura de ferramental nao acusa caminho neutro"
printf 'type: concept\narea: %s\n' "pesso""al" > "$isca"
grep -qinE "$DISTINTIVOS|$GENERICOS" "$isca" && ok "D11: a varredura pessoal tem dentes" \
                                             || falha "D11: a varredura pessoal nao pegou a isca"
printf -- 'type: concept\narea: exemplo\n' > "$isca"
grep -qinE "$DISTINTIVOS|$GENERICOS" "$isca" && falha "D11: a varredura pessoal acusou area neutra" \
                                             || ok "D11: a varredura pessoal nao acusa area neutra"

# ============================================================================
# A trava final: o \$HOME falso continua vazio depois de TUDO
# ============================================================================
restos="$(find "$LAR_FALSO" -mindepth 1 2>/dev/null)"
if [ -z "$restos" ]; then
  ok "ISOLAMENTO: o \$HOME de teste continua vazio depois de todas as execucoes"
else
  falha "ISOLAMENTO: o instalador escreveu no \$HOME: $(printf '%s' "$restos" | head -3 | tr '\n' ' ')"
fi

[ "$falhas" -eq 0 ] && echo "OK: instalar"
exit "$falhas"
