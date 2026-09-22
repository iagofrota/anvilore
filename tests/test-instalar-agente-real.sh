#!/usr/bin/env bash
# D5 — prova por EXECUCAO de um agente de verdade, nao por leitura do arquivo
# instalado.
#
# Este teste fica FORA da suite automatica de proposito: ele abre uma sessao
# real de agente, o que custa rede, credencial e tempo, e nao pode ser exigido
# de quem so quer rodar os testes do repositorio. Roda quando pedido:
#
#   ANVILORE_TESTE_AGENTE_REAL=1 bash tests/test-instalar-agente-real.sh
#
# Sem a variavel, ele diz SKIP e sai 0 — anunciando o que NAO verificou, em vez
# de deixar a impressao de que verificou.
#
# O QUE ELE PROVA, E POR QUE ASSIM
#
#   A skill instalada foi lida    — a pergunta pede algo que SO esta no texto da
#                                   skill deste repositorio (os nomes dos
#                                   scripts que ela manda rodar). Perguntar "a
#                                   skill existe?" nao serviria: o agente tem
#                                   skills globais, e uma homonima passaria por
#                                   esta.
#   O hook instalado bloqueou     — a prova e o RASTRO DO PROPRIO HOOK: uma
#                                   linha de log dizendo que ele foi invocado
#                                   com o caminho de `raw/` e devolveu
#                                   BLOQUEADO. `raw/` continuar vazio entra
#                                   como asercao adicional, nunca como a
#                                   asercao principal — ver abaixo.
#   GRUPO DE CONTROLE             — na MESMA sessao, uma escrita equivalente em
#                                   `wiki/` TEM de funcionar, E de aparecer no
#                                   log como PASSOU. Sem ela, "bloqueou raw/" e
#                                   indistinguivel de "o agente nao conseguiu
#                                   escrever nada" e de "o log carimba tudo
#                                   como bloqueado".
#
# O CONFUNDIDOR QUE ESTE TESTE PRECISOU NEUTRALIZAR
#
#   `raw/` vazio no fim e AMBIGUO entre dois desfechos muito diferentes:
#
#     (1) o agente chamou a ferramenta de escrita e o hook instalado barrou;
#     (2) o agente leu `AGENTS.md`/`CLAUDE.md`, viu em prosa que `raw/` e
#         imutavel, e se recusou sozinho — sem nunca chamar a ferramenta, sem o
#         hook ter rodado uma vez.
#
#   No desfecho (2) o teste ficaria VERDE sem ter exercitado nada do que alega
#   provar, e qual dos dois acontece nao esta sob controle de quem testa. Foi
#   observado de verdade: em duas execucoes seguidas, uma de cada tipo.
#
#   Duas correcoes, e as duas entram:
#
#     NEUTRALIZAR — a sonda de escrita roda num destino de onde o contrato em
#     prosa foi REMOVIDO depois da instalacao. Sem texto que proiba, o agente
#     nao tem motivo textual para se autocensurar, e a unica coisa entre ele e
#     `raw/` e o hook. (O contrato so sai depois da instalacao porque o
#     instalador exige `AGENTS.md` para reconhecer um clone — e porque a sonda
#     de leitura de skill, que vem antes, nao tem nada com isso.)
#
#     ASSENTAR A ASERCAO NO RASTRO — `hooks/proteger-raw.sh` registra cada
#     invocacao em `ANVILORE_LOG_HOOK` quando essa variavel aponta para um
#     arquivo. A asercao passa a ser sobre o que o hook FEZ, nao sobre a
#     ausencia de um arquivo no disco. Ausencia e compativel com o hook nunca
#     ter sido chamado; uma linha de log nao e.
#
# O destino continua sendo um diretorio temporario. A instalacao roda com HOME
# falso; so a sessao do agente usa o HOME real, porque e de la que sai a
# credencial dele — e essa sessao nao escreve em configuracao nenhuma.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
REPO="$PWD"

if [ "${ANVILORE_TESTE_AGENTE_REAL:-0}" != "1" ]; then
  echo "  SKIP: D5 (execucao de agente real) nao foi pedido."
  echo "  SKIP: para rodar: ANVILORE_TESTE_AGENTE_REAL=1 bash tests/test-instalar-agente-real.sh"
  echo "SKIP: instalar-agente-real"
  exit 0
fi

falhas=0
ok()      { echo "  ok: $*"; }
falha()   { echo "  FALHA: $*"; falhas=$((falhas+1)); }
relatar() { echo "  nota: $*"; }

command -v claude >/dev/null 2>&1 || { echo "  SKIP: a CLI nao esta no PATH"; exit 0; }

TMP="$(mktemp -d)"
LAR_FALSO="$TMP/lar-falso"; mkdir -p "$LAR_FALSO"
trap 'rm -rf "$TMP"' EXIT

ALVO="$TMP/clone"
mkdir -p "$ALVO"
tar -c --exclude=.git -C "$REPO" . | tar -x -C "$ALVO"
git -C "$ALVO" init -q
git -C "$ALVO" add -A >/dev/null 2>&1
git -C "$ALVO" -c user.email=teste@exemplo -c user.name=teste commit -qm fixture

HOME="$LAR_FALSO" bash "$ALVO/instalar.sh" --destino "$ALVO" --alvo claude >/dev/null 2>&1
CONFIG="$ALVO/.claude/settings.json"
[ -f "$CONFIG" ] || { falha "a instalacao nao produziu a configuracao do agente"; exit 1; }

# ============================================================================
# A affordance de verificacao funciona — antes de servir de asercao
# ============================================================================
# Sem esta conferencia, um log vazio la embaixo seria ambiguo entre "o hook
# nunca foi invocado" (o que o teste quer detectar) e "o registro nunca
# funcionou" (defeito do instrumento). Instrumento que nao foi conferido nao
# mede; so decora.
SONDA="$TMP/sonda.log"
printf '{"tool_name":"Write","tool_input":{"file_path":"raw/sonda.md"}}' \
  | ANVILORE_LOG_HOOK="$SONDA" bash "$ALVO/hooks/proteger-raw.sh" >/dev/null 2>&1
printf '{"tool_name":"Write","tool_input":{"file_path":"wiki/sonda.md"}}' \
  | ANVILORE_LOG_HOOK="$SONDA" bash "$ALVO/hooks/proteger-raw.sh" >/dev/null 2>&1
if grep -qE 'BLOQUEADO.*raw/sonda\.md' "$SONDA" 2>/dev/null \
   && grep -qE 'PASSOU.*wiki/sonda\.md' "$SONDA" 2>/dev/null; then
  ok "D5 (instrumento): o rastro do hook registra os dois veredictos e os distingue"
else
  falha "D5 (instrumento): o rastro do hook nao funciona — nenhuma asercao abaixo mediria nada"
fi

# E o contrario: sem a variavel, o hook nao escreve rastro nenhum. Medido pelo
# tamanho do arquivo de sonda, nao afirmado em prosa.
antes_sonda="$(wc -c < "$SONDA")"
printf '{"tool_name":"Write","tool_input":{"file_path":"raw/sonda.md"}}' \
  | bash "$ALVO/hooks/proteger-raw.sh" >/dev/null 2>&1
depois_sonda="$(wc -c < "$SONDA")"
[ "$antes_sonda" = "$depois_sonda" ] \
  && ok "D5 (instrumento): sem ANVILORE_LOG_HOOK o hook nao escreve rastro" \
  || falha "D5 (instrumento): o hook escreveu rastro sem a variavel pedir"

# ============================================================================
# A skill instalada e encontrada E LIDA
# ============================================================================
# Os tres scripts abaixo sao citados no texto da skill `lint` DESTE repositorio.
# Uma skill homonima de outra origem nao teria como nomear os tres.
resposta="$(cd "$ALVO" && timeout 300 claude -p \
  "Leia a skill 'lint' disponivel neste projeto e responda SO com os nomes dos arquivos de script que ela manda rodar." \
  --settings "$CONFIG" 2>&1)"

citados=0
for script in auditar-wiki listar-lacunas validar-wiki; do
  printf '%s' "$resposta" | grep -qF "$script" && citados=$((citados+1))
done
if [ "$citados" -ge 2 ]; then
  ok "D5: o agente encontrou e LEU a skill instalada ($citados/3 scripts citados)"
else
  falha "D5: o agente nao leu a skill instalada ($citados/3): $(printf '%s' "$resposta" | tail -3 | tr '\n' ' ')"
fi

# ============================================================================
# O hook instalado bloqueia raw/ — com o confundidor removido
# ============================================================================
# O contrato em prosa sai AGORA, depois da instalacao e depois da sonda de
# leitura de skill: e ele que da ao agente um motivo textual para recusar sem
# tentar, e e exatamente esse motivo que nao pode existir enquanto se mede o
# hook. Remover e do proprio destino temporario; o repositorio nao e tocado.
rm -f "$ALVO/AGENTS.md" "$ALVO/CLAUDE.md"
if [ -e "$ALVO/AGENTS.md" ] || [ -e "$ALVO/CLAUDE.md" ]; then
  falha "D5: o contrato em prosa continua no destino — o confundidor nao foi removido"
else
  ok "D5: o contrato em prosa saiu do destino — o que sobrou entre o agente e raw/ e o hook"
fi

LOG="$TMP/hook.log"
export ANVILORE_LOG_HOOK="$LOG"

resposta="$(cd "$ALVO" && timeout 300 claude -p \
  "Faca as duas coisas, em ordem: (1) crie o arquivo raw/teste-do-hook.md com o texto 'x'; (2) crie o arquivo wiki/exemplo/concepts/teste-do-hook.md com o texto 'x'. Diga o que aconteceu em cada uma." \
  --settings "$CONFIG" --allowedTools "Write" 2>&1)"

# A ASERCAO PRINCIPAL: o rastro do proprio hook. "Foi invocado com o caminho de
# raw/ e devolveu BLOQUEADO" e uma afirmacao sobre o que o hook fez; "raw/ esta
# vazio" e uma afirmacao sobre o que nao aconteceu, e nao distingue quem a
# causou.
if grep -qE 'BLOQUEADO.*raw/teste-do-hook\.md' "$LOG" 2>/dev/null; then
  ok "D5: o hook instalado FOI INVOCADO com o caminho de raw/ e devolveu BLOQUEADO"
  relatar "rastro: $(grep -E 'BLOQUEADO.*raw/teste-do-hook' "$LOG" | head -1)"
else
  falha "D5: o rastro nao mostra o hook bloqueando raw/ — rastro: $(tr '\n' '|' < "$LOG" 2>/dev/null | head -c 300)"
fi

# GRUPO DE CONTROLE no proprio rastro: o hook tambem foi invocado para a escrita
# em wiki/ e ali devolveu PASSOU. Sem isto, "registrou BLOQUEADO" seria
# indistinguivel de "o registro carimba BLOQUEADO em tudo".
if grep -qE 'PASSOU.*wiki/exemplo/concepts/teste-do-hook\.md' "$LOG" 2>/dev/null; then
  ok "D5 (controle): o mesmo hook, na mesma sessao, devolveu PASSOU para wiki/"
else
  falha "D5 (controle): o rastro nao mostra PASSOU para wiki/ — o veredito nao e especifico de raw/"
fi

# Asercoes sobre o disco, agora como consequencia e nao como a prova.
[ -e "$ALVO/raw/teste-do-hook.md" ] \
  && falha "D5: o agente ESCREVEU em raw/ — o hook instalado nao impediu de fato" \
  || ok "D5: raw/ continua sem o arquivo — o bloqueio teve efeito no disco"

[ -e "$ALVO/wiki/exemplo/concepts/teste-do-hook.md" ] \
  && ok "D5 (controle): a escrita equivalente em wiki/ funcionou" \
  || falha "D5 (controle): a escrita em wiki/ tambem falhou — o bloqueio nao e especifico de raw/"

# O texto da resposta e CORROBORACAO, nao asercao: a redacao do agente nao esta
# sob controle deste teste, e transformar a escolha de palavra dele em criterio
# de aprovacao foi justamente um dos jeitos de este teste medir a coisa errada.
if printf '%s' "$resposta" | grep -qiE 'imut|bloque|recus|impedi'; then
  relatar "a resposta do agente corrobora o bloqueio"
else
  relatar "a resposta do agente nao nomeou o bloqueio (nao e falha: o rastro ja o provou): $(printf '%s' "$resposta" | tail -2 | tr '\n' ' ')"
fi

[ "$falhas" -eq 0 ] && echo "OK: instalar-agente-real"
exit "$falhas"
