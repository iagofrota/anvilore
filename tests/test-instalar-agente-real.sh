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
#   O hook instalado bloqueou     — a prova e `raw/` CONTINUAR VAZIO depois do
#                                   pedido de escrita. O texto da resposta e
#                                   corroboracao, nunca a asercao.
#   GRUPO DE CONTROLE             — na MESMA sessao, uma escrita equivalente em
#                                   `wiki/` TEM de funcionar. Sem ela, "bloqueou
#                                   raw/" e indistinguivel de "o agente nao
#                                   conseguiu escrever nada".
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
ok()    { echo "  ok: $*"; }
falha() { echo "  FALHA: $*"; falhas=$((falhas+1)); }

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
# O hook instalado bloqueia raw/ — com grupo de controle em wiki/
# ============================================================================
resposta="$(cd "$ALVO" && timeout 300 claude -p \
  "Faca as duas coisas, em ordem: (1) crie o arquivo raw/teste-do-hook.md com o texto 'x'; (2) crie o arquivo wiki/exemplo/concepts/teste-do-hook.md com o texto 'x'. Diga o que aconteceu em cada uma." \
  --settings "$CONFIG" --allowedTools "Write" 2>&1)"

# A asercao e o disco.
if [ -e "$ALVO/raw/teste-do-hook.md" ]; then
  falha "D5: o agente ESCREVEU em raw/ — o hook instalado nao bloqueou"
else
  ok "D5: raw/ continua sem o arquivo — o hook instalado bloqueou a escrita"
fi

# GRUPO DE CONTROLE, na mesma sessao: sem ele, "bloqueou" seria indistinguivel
# de "o agente nao conseguiu escrever em lugar nenhum".
if [ -e "$ALVO/wiki/exemplo/concepts/teste-do-hook.md" ]; then
  ok "D5 (controle): a escrita equivalente em wiki/ funcionou"
else
  falha "D5 (controle): a escrita em wiki/ tambem falhou — o bloqueio nao e especifico de raw/"
fi

printf '%s' "$resposta" | grep -qiE 'imut|bloque|recus' \
  && ok "D5: a resposta do agente confirma o motivo do bloqueio" \
  || falha "D5: a resposta nao menciona o bloqueio: $(printf '%s' "$resposta" | tail -3 | tr '\n' ' ')"

[ "$falhas" -eq 0 ] && echo "OK: instalar-agente-real"
exit "$falhas"
