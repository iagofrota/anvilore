#!/usr/bin/env bash
# Anvilore — instalador para Linux (x64 e arm64). É a base do macOS: o mesmo script, quando houver entradas no manifesto.
#
# Uso (o endereço da release fica no README):
#   curl -fsSL <endereço do instalar.sh da release> | bash
#   bash instalar.sh            (o .deb/.rpm e o atalho "Anvilore" chamam este mesmo arquivo)
#
# O que faz (PLANO §2): confere o sistema, instala o que falta (git, Bun, rg), baixa o kit da última release na
# pasta ~/Anvilore, CONFERE A ASSINATURA DA TAG com a chave embutida neste script, liga os agentes que a pessoa tem,
# grava o estado da atualização e roda o `doctor`. Rodar de novo numa pasta que já é instalação só confere e atualiza.
#
# Variáveis de ambiente (todas opcionais):
#   ANVILORE_SEM_PERGUNTAS=1   não pergunta nada; usa as respostas padrão (CI). Sem terminal, vale automaticamente.
#   ANVILORE_ORIGEM=<repo>     clona deste repositório (caminho local ou URL) em vez do GitHub oficial (CI e QA).
#   ANVILORE_VERSAO=<tag>      instala esta tag em vez da última release publicada.
#   ANVILORE_PASTA=<pasta>     onde instalar (padrão: ~/Anvilore).
#   ANVILORE_INSTALAR_CLAUDE=sim|nao   responde de antemão se instala o Claude Code quando não há agente nenhum.
#   ANVILORE_ESPERAR_ENTER=1   espera Enter antes de terminar (janela com Terminal=true, para a pessoa ler o resumo).
#
# Segurança: o manifesto de dependências (instalador/dependencias.json), a chave pública (seguranca/assinantes) e a base mínima
# (instalador/base-minima) vêm EMBUTIDOS neste arquivo pela release (scripts/embutir-instalador.ts). Sem chave embutida válida
# o script recusa instalar. Numa pasta já instalada, a versão dela é lida do package.json SEM executar nada da pasta e, se for
# menor que a base mínima (ou não puder ser lida), o script recusa antes de tocar em qualquer coisa. Nenhum segredo é pedido,
# lido ou gravado; o login dos agentes é da pessoa.
#
# Estado das chaves fora do GitHub: antes de aceitar a tag (instalação nova) e antes de delegar ao atualizador da pasta
# (reinstalação), o instalador consulta a lista de chaves que o dono publica no site dele (a URL também vem EMBUTIDA, nunca
# de variável de ambiente) e só vale a interseção dela com as chaves embutidas. Sem conseguir consultar, ele para.
#
# `curl | bash` ocupa a entrada padrão: tudo mora em funções, o script só roda na última linha, e as respostas
# vêm de /dev/tty.

# Os comandos filhos recebem o caminho da pasta por argumento ($1), por isso as aspas simples em `bash -c`.
# shellcheck disable=SC2016
set -o pipefail

REPO_OFICIAL="https://github.com/iagofrota/anvilore.git"
URL_ULTIMA="https://github.com/iagofrota/anvilore/releases/latest"
URL_API="https://api.github.com/repos/iagofrota/anvilore/releases/latest"
URL_CLAUDE="https://claude.ai/install.sh"
AREAS_PADRAO="pessoal,profissional,projetos-paralelos,saude"

# >>> ANVILORE:MANIFESTO (preenchido na release por scripts/embutir-instalador.ts; não edite)
manifesto_embutido() {
  :
}
# <<< ANVILORE:MANIFESTO
# >>> ANVILORE:ASSINANTES (preenchido na release por scripts/embutir-instalador.ts; não edite)
assinantes_embutidas() {
  :
}
# <<< ANVILORE:ASSINANTES
# >>> ANVILORE:BASE_MINIMA (preenchido na release por scripts/embutir-instalador.ts; não edite)
base_minima_embutida() {
  :
}
# <<< ANVILORE:BASE_MINIMA
# >>> ANVILORE:URL_CONFIANCA (preenchido na release por scripts/embutir-instalador.ts; não edite)
url_confianca_embutida() {
  :
}
# <<< ANVILORE:URL_CONFIANCA

# ---------------------------------------------------------------------------------------------------------------
# Registro e mensagens
# ---------------------------------------------------------------------------------------------------------------

LOG=""
TMP_DIR=""
CLONE_TMP=""
HOOKS_VAZIO=""
TEM_TTY=0
PLATAFORMA=""
PASTA=""
TAG=""
BUN_GERENCIADO=0
AUTO_COMMIT=1
INSTALACAO_NOVA=1
RG_FALTA=0
AVISOS=""
ULTIMA_SAIDA=""
MOTIVO=""
VERIFICADO_COMMIT=""

agora() { date '+%Y-%m-%dT%H:%M:%S%z'; }
registrar() { [ -n "$LOG" ] && printf '%s %s\n' "$(agora)" "$*" >>"$LOG" 2>/dev/null; return 0; }
registrar_bloco() { [ -n "$LOG" ] && printf '%s\n' "$1" | sed 's/^/    | /' >>"$LOG" 2>/dev/null; return 0; }
dizer() { printf '%s\n' "$*"; registrar "$*"; }
avisar() { printf 'Aviso: %s\n' "$*"; registrar "AVISO: $*"; AVISOS="${AVISOS}${AVISOS:+
}$*"; }

iniciar_registro() {
  TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/anvilore-instalar.XXXXXX") || { echo "Erro: não consegui criar uma pasta temporária." >&2; exit 1; }
  LOG="$TMP_DIR/instalacao.log"
  : >"$LOG"
  registrar "início: instalar.sh (uid $(id -u), $(uname -s) $(uname -m))"
}

# Quando a pasta da instalação existe, o registro passa a morar em .anvilore/instalacao.log (PLANO §2 passo 12).
mover_registro() {
  local destino="$1/.anvilore/instalacao.log"
  mkdir -p "$1/.anvilore" || return 0
  ( umask 077; cat "$LOG" >>"$destino" ) 2>/dev/null || return 0
  rm -f "$LOG"
  LOG="$destino"
}

limpar() {
  [ -n "$CLONE_TMP" ] && [ -d "$CLONE_TMP" ] && rm -rf "$CLONE_TMP"
  [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ] && [ "$LOG" != "$TMP_DIR/instalacao.log" ] && rm -rf "$TMP_DIR"
  return 0
}

detectar_tty() {
  if ( exec </dev/tty ) 2>/dev/null; then TEM_TTY=1; else TEM_TTY=0; fi
}
sem_perguntas() { [ "${ANVILORE_SEM_PERGUNTAS:-}" = "1" ] || [ "$TEM_TTY" != "1" ]; }

esperar_enter() {
  if [ "${ANVILORE_ESPERAR_ENTER:-}" = "1" ] && [ "$TEM_TTY" = "1" ] && [ "${ANVILORE_SEM_PERGUNTAS:-}" != "1" ]; then
    printf '\nPressione Enter para fechar esta janela. ' >/dev/tty
    IFS= read -r _ </dev/tty
  fi
  return 0
}

terminar() {
  local codigo="$1"
  if [ "$codigo" -ne 0 ] && [ -n "$LOG" ]; then printf 'Os detalhes estão em %s\n' "$LOG" >&2; fi
  esperar_enter
  exit "$codigo"
}
falhar() { printf 'Erro: %s\n' "$*" >&2; registrar "ERRO: $*"; terminar 1; }

# perguntar "texto" s|n → 0 se sim. Sem terminal (ou com ANVILORE_SEM_PERGUNTAS=1) vale a resposta padrão.
perguntar() {
  local texto="$1" padrao="${2:-s}" dica resposta
  if sem_perguntas; then
    registrar "pergunta sem terminal (resposta padrão '$padrao'): $texto"
    [ "$padrao" = "s" ]; return
  fi
  if [ "$padrao" = "s" ]; then dica="[S/n]"; else dica="[s/N]"; fi
  printf '%s %s ' "$texto" "$dica" >/dev/tty
  IFS= read -r resposta </dev/tty || resposta=""
  registrar "pergunta: $texto → '${resposta}'"
  case "$(printf '%s' "$resposta" | tr '[:upper:]' '[:lower:]')" in
    s|sim|y|yes) return 0 ;;
    n|nao|não|no) return 1 ;;
    *) [ "$padrao" = "s" ] ;;
  esac
}

# perguntar_texto "texto" "padrão" → resposta em RESPOSTA
RESPOSTA=""
perguntar_texto() {
  local texto="$1" padrao="$2"
  RESPOSTA="$padrao"
  sem_perguntas && return 0
  printf '%s [%s] ' "$texto" "$padrao" >/dev/tty
  IFS= read -r RESPOSTA </dev/tty || RESPOSTA=""
  [ -n "$RESPOSTA" ] || RESPOSTA="$padrao"
  registrar "pergunta: $texto → '$RESPOSTA'"
}

# ---------------------------------------------------------------------------------------------------------------
# Manifesto embutido (JSON em uma entrada por linha; lido com awk porque jq e python podem não existir)
# ---------------------------------------------------------------------------------------------------------------

# manifesto_campo <dependência> <plataforma|-> <campo>   ("-" + "versao" = versão da dependência)
manifesto_campo() {
  manifesto_embutido | awk -v dep="$1" -v plat="$2" -v campo="$3" '
    /^    "[a-z0-9]+": [{]$/ { atual = $0; sub(/^    "/, "", atual); sub(/".*/, "", atual); next }
    atual == dep && plat == "-" && campo == "versao" && /^      "versao": "/ {
      v = $0; sub(/^      "versao": "/, "", v); sub(/".*/, "", v); print v; exit
    }
    atual == dep && plat != "-" && index($0, "        \"" plat "\": {") == 1 {
      chave = "\"" campo "\": \""
      i = index($0, chave)
      if (i == 0) exit
      resto = substr($0, i + length(chave)); sub(/".*/, "", resto); print resto; exit
    }'
}

chave_embutida_valida() {
  assinantes_embutidas | grep -Eq '^[^#[:space:]][^[:space:]]*[[:space:]]+.*namespaces="[^"]*git[^"]*".*(ssh-(ed25519|rsa)|ecdsa-sha2-|sk-ssh|sk-ecdsa)'
}

conferir_embutidos() {
  if [ -z "$(manifesto_campo bun - versao)" ]; then
    falhar "este instalar.sh não traz o manifesto de dependências embutido. Use o instalar.sh da release (e não o do repositório)."
  fi
  if ! chave_embutida_valida; then
    falhar "este instalar.sh não traz a chave de assinatura do Anvilore, então não tenho como conferir que o kit é o do Iago. Recusei instalar. Use o instalar.sh da release."
  fi
  if ! semver_simples "$(base_minima_embutida)"; then
    falhar "este instalar.sh não traz a base mínima (a primeira versão assinada), então não tenho como saber se uma pasta antiga é segura. Recusei instalar. Use o instalar.sh da release."
  fi
  if ! url_confianca_valida "$(url_confianca_embutida)"; then
    falhar "este instalar.sh não traz o endereço da lista atual de chaves (ou ele é inseguro), então não tenho como conferir se a chave de assinatura ainda vale. Recusei instalar. Use o instalar.sh da release."
  fi
}

# ---------------------------------------------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------------------------------------------

tem() { command -v "$1" >/dev/null 2>&1; }

sha256_de() {
  if tem sha256sum; then sha256sum "$1" | awk '{print $1}'
  elif tem shasum; then shasum -a 256 "$1" | awk '{print $1}'
  else return 1; fi
}

# Só a parte numérica (1.4.1-canary.3+abc → 1.4.1).
so_numeros() { printf '%s' "$1" | sed 's/[-+].*//'; }

# 0 se $1 >= $2 (comparação de versões com sort -V).
versao_maior_ou_igual() {
  [ "$(printf '%s\n%s\n' "$(so_numeros "$2")" "$(so_numeros "$1")" | sort -V | head -n1)" = "$(so_numeros "$2")" ]
}

# Roda o comando, anexa a saída ao registro e guarda em ULTIMA_SAIDA. Devolve o código do comando.
rodar() {
  ULTIMA_SAIDA=$("$@" 2>&1)
  local codigo=$?
  registrar "executei: $* (saída $codigo)"
  registrar_bloco "$ULTIMA_SAIDA"
  return $codigo
}

# ---------------------------------------------------------------------------------------------------------------
# Passo 1 — sistema
# ---------------------------------------------------------------------------------------------------------------

passo_sistema() {
  local so arquitetura
  so=$(uname -s) arquitetura=$(uname -m)
  case "$so" in
    Linux) ;;
    Darwin) falhar "o instalador ainda não cobre o macOS (só Linux x64 e arm64). A versão para Mac vem depois." ;;
    *) falhar "sistema não suportado: $so. Este instalador cobre Linux x64 e arm64." ;;
  esac
  case "$arquitetura" in
    x86_64|amd64) PLATAFORMA="linux-x64" ;;
    aarch64|arm64) PLATAFORMA="linux-arm64" ;;
    *) falhar "arquitetura não suportada: $arquitetura. Este instalador cobre Linux x64 e arm64." ;;
  esac
  registrar "plataforma: $PLATAFORMA"
}

# ---------------------------------------------------------------------------------------------------------------
# Download de dependência com conferência do SHA-256 do manifesto
# ---------------------------------------------------------------------------------------------------------------

# baixar_dependencia <dependência> <destino do executável>
# 0 = instalado; 1 = sem entrada no manifesto ou download falhou; 2 = SHA-256 não confere (arquivo apagado).
baixar_dependencia() {
  local dep="$1" destino="$2" arquivo url esperado formato executavel pasta obtido
  arquivo=$(manifesto_campo "$dep" "$PLATAFORMA" arquivo)
  url=$(manifesto_campo "$dep" "$PLATAFORMA" url)
  esperado=$(manifesto_campo "$dep" "$PLATAFORMA" sha256)
  formato=$(manifesto_campo "$dep" "$PLATAFORMA" formato)
  executavel=$(manifesto_campo "$dep" "$PLATAFORMA" executavel)
  if [ -z "$url" ] || [ -z "$esperado" ] || [ -z "$arquivo" ]; then
    registrar "$dep: sem entrada para $PLATAFORMA no manifesto"
    return 1
  fi
  pasta="$TMP_DIR/$dep"
  rm -rf "$pasta"; mkdir -p "$pasta/extraido" || return 1
  if ! rodar curl -fL --proto '=https,file' --proto-redir '=https' --retry 2 --silent --show-error -o "$pasta/$arquivo" "$url"; then
    rm -rf "$pasta"; return 1
  fi
  obtido=$(sha256_de "$pasta/$arquivo") || { registrar "$dep: sem sha256sum nem shasum"; rm -rf "$pasta"; return 1; }
  if [ "$obtido" != "$esperado" ]; then
    registrar "$dep: SHA-256 não confere (esperado $esperado, obtido $obtido); arquivo apagado"
    rm -rf "$pasta"; return 2
  fi
  case "$formato" in
    zip) rodar unzip -q -o "$pasta/$arquivo" -d "$pasta/extraido" || { rm -rf "$pasta"; return 1; } ;;
    tar.gz) rodar tar -xzf "$pasta/$arquivo" -C "$pasta/extraido" || { rm -rf "$pasta"; return 1; } ;;
    *) registrar "$dep: formato $formato não suportado neste sistema"; rm -rf "$pasta"; return 1 ;;
  esac
  if [ ! -f "$pasta/extraido/$executavel" ]; then
    registrar "$dep: $executavel não está dentro de $arquivo"
    rm -rf "$pasta"; return 1
  fi
  mkdir -p "$(dirname "$destino")" || { rm -rf "$pasta"; return 1; }
  # Copia para um nome vizinho e renomeia: trocar um executável em uso não dá "text file busy".
  if ! { cp "$pasta/extraido/$executavel" "$destino.novo" && chmod 755 "$destino.novo" && mv -f "$destino.novo" "$destino"; }; then
    rm -f "$destino.novo"; rm -rf "$pasta"; return 1
  fi
  rm -rf "$pasta"
  registrar "$dep: instalado em $destino (SHA-256 conferido)"
  return 0
}

# ---------------------------------------------------------------------------------------------------------------
# Passos 2 e 3 — git e Bun
# ---------------------------------------------------------------------------------------------------------------

versao_do_bun() { bun --version 2>/dev/null | head -n1; }

# Imprime o que falta no sistema (nomes de comando separados por espaço).
ferramentas_que_faltam() {
  local falta="" precisa_unzip="$1"
  tem git || falta="$falta git"
  tem curl || falta="$falta curl"
  tem ssh-keygen || falta="$falta ssh-keygen"
  if [ "$precisa_unzip" = "1" ] && ! tem unzip; then falta="$falta unzip"; fi
  printf '%s' "${falta# }"
}

instalar_pacotes() {
  local faltam="$1" gerenciador pacotes="" ferramenta comando sudo_cmd=""
  if tem apt-get; then gerenciador=apt
  elif tem dnf; then gerenciador=dnf
  elif tem pacman; then gerenciador=pacman
  elif tem zypper; then gerenciador=zypper
  else
    falhar "faltam: $faltam, e não achei apt, dnf, pacman nem zypper para instalar. Instale esses programas pelo gerenciador da sua distribuição e rode de novo."
  fi
  for ferramenta in $faltam; do
    case "$ferramenta:$gerenciador" in
      ssh-keygen:apt) pacotes="$pacotes openssh-client" ;;
      ssh-keygen:dnf|ssh-keygen:zypper) pacotes="$pacotes openssh-clients" ;;
      ssh-keygen:pacman) pacotes="$pacotes openssh" ;;
      *) pacotes="$pacotes $ferramenta" ;;
    esac
  done
  pacotes="${pacotes# }"
  if [ "$(id -u)" -ne 0 ]; then
    tem sudo || falhar "faltam: $faltam. Instale ($pacotes) como administrador e rode de novo; não achei o sudo."
    if sem_perguntas; then sudo_cmd="sudo -n"; else sudo_cmd="sudo"; fi
  fi
  dizer "Faltam no seu computador: $faltam."
  if ! perguntar "Posso instalá-los pelo $gerenciador ($pacotes)? Vou usar o sudo e ele pode pedir sua senha." s; then
    falhar "sem $faltam não dá para instalar o Anvilore. Instale ($pacotes) e rode de novo."
  fi
  case "$gerenciador" in
    apt) comando="apt-get install -y" ;;
    dnf) comando="dnf install -y" ;;
    pacman) comando="pacman -S --noconfirm" ;;
    zypper) comando="zypper --non-interactive install" ;;
  esac
  # Sem terminal o sudo roda com -n (falha em vez de esperar senha); com terminal ele pede a senha por conta própria.
  # shellcheck disable=SC2086
  if [ -n "$sudo_cmd" ] && ! sem_perguntas; then
    $sudo_cmd $comando $pacotes
    local codigo=$?
    registrar "executei: $sudo_cmd $comando $pacotes (saída $codigo)"
    [ "$codigo" -eq 0 ] || falhar "não consegui instalar $pacotes. Instale-os e rode de novo."
  else
    # shellcheck disable=SC2086
    rodar $sudo_cmd $comando $pacotes || falhar "não consegui instalar $pacotes. Instale-os e rode de novo."
  fi
}

passo_git_e_bun() {
  local bun_versao precisa_baixar_bun=0 atual faltam
  PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"; export PATH
  bun_versao=$(manifesto_campo bun - versao)
  if tem bun; then
    atual=$(versao_do_bun)
    if [ -n "$atual" ] && versao_maior_ou_igual "$atual" "$bun_versao"; then
      registrar "bun: usando o que existe ($atual em $(command -v bun))"
    else
      dizer "Seu Bun é ${atual:-de versão desconhecida}; o Anvilore pede $bun_versao ou mais novo."
      perguntar "Instalo o Bun $bun_versao em ~/.bun/bin?" s || falhar "o Anvilore precisa do Bun $bun_versao ou mais novo. Atualize com 'bun upgrade' e rode de novo."
      precisa_baixar_bun=1
    fi
  else
    precisa_baixar_bun=1
  fi

  faltam=$(ferramentas_que_faltam "$precisa_baixar_bun")
  [ -n "$faltam" ] && instalar_pacotes "$faltam"
  faltam=$(ferramentas_que_faltam "$precisa_baixar_bun")
  [ -z "$faltam" ] || falhar "ainda faltam: $faltam. Instale e rode de novo."

  if [ "$precisa_baixar_bun" = "1" ]; then
    dizer "Instalando o Bun $bun_versao..."
    baixar_dependencia bun "$HOME/.bun/bin/bun"
    case $? in
      0) ;;
      2) falhar "o download do Bun não confere com o SHA-256 do manifesto; apaguei o arquivo e parei por segurança." ;;
      *) falhar "não consegui baixar o Bun $bun_versao para $PLATAFORMA (rede fora do ar ou sem entrada no manifesto)." ;;
    esac
    hash -r 2>/dev/null
    atual=$(versao_do_bun)
    if [ -z "$atual" ] || ! versao_maior_ou_igual "$atual" "$bun_versao"; then falhar "o Bun baixado não roda neste computador ($PLATAFORMA)."; fi
    BUN_GERENCIADO=1
    # Os hooks chamam `bun` pelo PATH; ~/.local/bin entra no PATH de quem abre uma sessão nova.
    if [ ! -e "$HOME/.local/bin/bun" ] && mkdir -p "$HOME/.local/bin" 2>/dev/null; then
      ln -s "$HOME/.bun/bin/bun" "$HOME/.local/bin/bun" 2>/dev/null && registrar "bun: atalho em ~/.local/bin/bun"
    fi
  fi
}

# ---------------------------------------------------------------------------------------------------------------
# Passo 4 — rg (sem ele a instalação continua)
# ---------------------------------------------------------------------------------------------------------------

passo_rg() {
  if tem rg; then registrar "rg: usando o do sistema ($(command -v rg))"; return 0; fi
  dizer "Instalando o rg (busca rápida das páginas)..."
  baixar_dependencia rg "$HOME/.local/bin/rg"
  case $? in
    0) hash -r 2>/dev/null; tem rg && return 0 ;;
    2) avisar "o download do rg não confere com o SHA-256 do manifesto; apaguei o arquivo e segui sem ele." ;;
    *) avisar "não consegui instalar o rg." ;;
  esac
  RG_FALTA=1
  avisar "sem o rg, a busca da skill query fica indisponível. Instale o ripgrep (rg) e rode este instalador de novo."
}

# ---------------------------------------------------------------------------------------------------------------
# Passos 5 e 6 — pasta, download do kit e assinatura da tag
# ---------------------------------------------------------------------------------------------------------------

# Pasta instalada = a estrutura do kit (.git, AGENTS.md, src/cli.ts, skills/). O mesmo critério do instalar.ps1. Não exige o
# estado da atualização (uma pasta de antes do atualizador, como a v0.2.0, não o tem e PRECISA cair no teste da base mínima,
# com a mensagem certa, em vez de ser tratada como "outra coisa") nem o conteúdo do package.json (a versão é lida depois,
# pela base mínima, e package.json ausente ou ilegível é um motivo de recusa, não de pasta desconhecida).
eh_instalacao() {
  [ -d "$1/.git" ] && [ -f "$1/AGENTS.md" ] && [ -f "$1/src/cli.ts" ] && [ -d "$1/skills" ]
}

# nova | instalacao | outra
classificar_pasta() {
  if [ ! -e "$1" ]; then echo nova; return; fi
  if [ -d "$1" ] && [ -z "$(ls -A "$1" 2>/dev/null)" ]; then echo nova; return; fi
  if [ -d "$1" ] && eh_instalacao "$1"; then echo instalacao; return; fi
  echo outra
}

passo_pasta() {
  local tentativas=0 situacao
  PASTA="${ANVILORE_PASTA:-$HOME/Anvilore}"
  case "$PASTA" in /*) ;; *) PASTA="$PWD/$PASTA" ;; esac
  while :; do
    situacao=$(classificar_pasta "$PASTA")
    [ "$situacao" != "outra" ] && break
    dizer "A pasta $PASTA já existe e não é uma instalação do Anvilore."
    tentativas=$((tentativas + 1))
    if sem_perguntas || [ "$tentativas" -ge 3 ]; then
      falhar "escolha outra pasta (ANVILORE_PASTA=<pasta>) ou apague/renomeie $PASTA. Não mexi em nada."
    fi
    perguntar_texto "Em qual pasta instalo?" "$HOME/Anvilore-2"
    PASTA="$RESPOSTA"
    case "$PASTA" in /*) ;; *) PASTA="$PWD/$PASTA" ;; esac
  done
  registrar "pasta: $PASTA ($situacao)"
  SITUACAO_PASTA="$situacao"
}

resolver_tag() {
  local local_url
  if [ -n "${ANVILORE_VERSAO:-}" ]; then TAG="v${ANVILORE_VERSAO#v}"
  elif [ -n "${ANVILORE_ORIGEM:-}" ]; then
    TAG=$(git_rede ls-remote --tags --refs "$ANVILORE_ORIGEM" 2>/dev/null | sed 's#.*refs/tags/##' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -n1)
  else
    local_url=$(curl -fsSI --proto '=https' --max-time 30 -o /dev/null -w '%{redirect_url}' "$URL_ULTIMA" 2>/dev/null)
    TAG="${local_url##*/tag/}"
    case "$local_url" in */releases/tag/*) ;; *) TAG="" ;; esac
    if [ -z "$TAG" ]; then
      TAG=$(curl -fsS --proto '=https' --max-time 30 "$URL_API" 2>/dev/null | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)
    fi
  fi
  if ! printf '%s' "$TAG" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$'; then
    registrar "tag resolvida inválida: '$TAG'"
    falhar "não consegui descobrir qual é a última versão do Anvilore (sem rede, ou ainda não há release publicada). Tente de novo mais tarde."
  fi
  registrar "tag: $TAG"
}

# git do staging: enquanto a assinatura não passa, nenhum hook roda (core.hooksPath aponta para uma pasta vazia, vença
# o que a configuração global da pessoa disser). Filtros de checkout nem chegam a rodar: o clone é --no-checkout.
git_staging() {
  git -c "core.hooksPath=$HOOKS_VAZIO" "$@"
}

# Protocolos que o git de rede pode usar: só o da URL de origem (https na oficial; nos testes, caminho local ou ssh).
# Qualquer outro (ext::, fd::, git://, http://) fica de fora, mesmo que a configuração global o libere.
protocolos_da_origem() {
  case "${ANVILORE_ORIGEM:-}" in
    "") echo https ;;
    file://* | /* | ./* | ../*) echo file ;;
    ssh://*) echo ssh ;;
    *) echo https ;;
  esac
}

# git que fala com a rede ANTES de a assinatura passar (ls-remote e clone). Vale o que o instalador decide, não a
# configuração global da pessoa: GIT_ALLOW_PROTOCOL vence qualquer protocol.<nome>.allow (inclusive um
# protocol.ext.allow=always, que o transporte `ext::` usaria para rodar um programa), o credential.helper é zerado
# e nenhum programa de senha ou terminal é chamado. Subshell: nada disso vaza para o resto da instalação.
# A config global continua valendo (proxy em http.proxy, por exemplo).
git_rede() (
  export GIT_ALLOW_PROTOCOL
  GIT_ALLOW_PROTOCOL=$(protocolos_da_origem)
  export GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=
  git_staging -c credential.helper= -c core.askPass= "$@"
)

# ---------------------------------------------------------------------------------------------------------------
# Estado das chaves: a lista que o dono publica fora do GitHub (confianca.json)
# ---------------------------------------------------------------------------------------------------------------

# 0 se $1 é uma URL https, ou http só em loopback (127.0.0.1: build de teste; o embutir só a aceita com a flag de teste).
url_confianca_valida() {
  [[ "$1" =~ ^https://[A-Za-z0-9._~:/-]+$ ]] || [[ "$1" =~ ^http://127\.0\.0\.1(:[0-9]+)?/[A-Za-z0-9._~/-]*$ ]]
}

# 0 se $1 é a fingerprint SHA256 do ssh-keygen.
fingerprint_valida() { [[ "$1" =~ ^SHA256:[A-Za-z0-9+/]{43}$ ]]; }

# Fingerprint (a do `ssh-keygen -lf`) da chave de uma linha allowed_signers: principal [opções] tipo chave-base64 [comentário].
fingerprint_da_linha() {
  local chave arquivo="$TMP_DIR/chave-da-linha.pub" fp
  case "$1" in "" | "#"*) return 1 ;; esac
  chave=$(printf '%s\n' "$1" | awk '{ for (i = 2; i < NF; i++) if ($i ~ /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp[0-9]+|sk-ssh-ed25519@openssh[.]com|sk-ecdsa-sha2-nistp256@openssh[.]com)$/) { print $i " " $(i + 1); exit } }')
  [ -n "$chave" ] || return 1
  printf '%s\n' "$chave" >"$arquivo"
  fp=$(ssh-keygen -lf "$arquivo" 2>/dev/null | awk 'NR == 1 { print $2 }')
  fingerprint_valida "$fp" && printf '%s' "$fp"
}

# Consulta a lista do site e a valida com rigor (campo extra, tipo errado, formato diferente de 1, chaves vazia ou repetida e
# versaoMinima com pré-release recusam). Preenche CONFIANCA_CHAVES (uma fingerprint por linha) e CONFIANCA_MINIMA.
# Só https (loopback http no build de teste), sem seguir redirecionamento, sem cache, 15 s e 64 KiB. Sem cache local nem
# fallback: qualquer falha devolve 1 e MOTIVO diz o que fazer.
consultar_confianca() {
  local url proto arquivo codigo plano fp ws=' *' chave_re formato_re minima_re item_re n k
  url=$(url_confianca_embutida)
  url_confianca_valida "$url" || { MOTIVO="o endereço da lista de chaves embutido neste instalador não é seguro."; return 1; }
  case "$url" in https://*) proto=https ;; *) proto=http ;; esac
  MOTIVO="não consegui conferir a lista atual de chaves em $url; nada mudou; tente de novo mais tarde."
  arquivo="$TMP_DIR/confianca.json"
  rm -f "$arquivo"
  codigo=$(curl -q --silent --show-error --proto "=$proto" --max-redirs 0 --max-time 15 --max-filesize 65536 \
    -H 'Cache-Control: no-cache' -H 'Pragma: no-cache' -o "$arquivo" -w '%{http_code}' -- "$url" 2>>"${LOG:-/dev/null}") || { registrar "consulta da lista de chaves falhou (curl)"; return 1; }
  [ "$codigo" = "200" ] || { registrar "consulta da lista de chaves: HTTP $codigo"; return 1; }
  [ "$(wc -c <"$arquivo" | tr -d ' ')" -le 65536 ] || { registrar "consulta da lista de chaves: resposta maior que 64 KiB"; return 1; }
  # Quebras de linha e tabulações viram espaço: dentro de uma string da lista elas não são válidas, então a conta só aceita o que o
  # JSON aceitaria.
  plano=$(tr '\r\n\t' '   ' <"$arquivo")
  chave_re='"SHA256:[A-Za-z0-9+/]{43}"'
  formato_re="\"formato\"${ws}:${ws}1"
  minima_re="\"versaoMinima\"${ws}:${ws}\"(0|[1-9][0-9]{0,8})\\.(0|[1-9][0-9]{0,8})\\.(0|[1-9][0-9]{0,8})\""
  item_re="(${formato_re}|\"chaves\"${ws}:${ws}\\[${ws}${chave_re}(${ws},${ws}${chave_re})*${ws}\\]|${minima_re})"
  if ! [[ "$plano" =~ ^${ws}\{${ws}${item_re}${ws},${ws}${item_re}${ws},${ws}${item_re}${ws}\}${ws}$ ]]; then registrar "consulta da lista de chaves: formato inválido"; return 1; fi
  for k in formato chaves versaoMinima; do
    n=$(printf '%s' "$plano" | grep -o "\"$k\" *:" | wc -l | tr -d ' ')
    [ "$n" = "1" ] || { registrar "consulta da lista de chaves: campo $k ausente ou repetido"; return 1; }
  done
  CONFIANCA_MINIMA=$(printf '%s' "$plano" | grep -oE '"versaoMinima" *: *"[0-9.]+"' | sed 's/.*"\([0-9.]*\)"$/\1/')
  CONFIANCA_CHAVES=$(printf '%s' "$plano" | grep -oE 'SHA256:[A-Za-z0-9+/]{43}')
  semver_simples "$CONFIANCA_MINIMA" || return 1
  printf '%s\n' "$CONFIANCA_CHAVES" | awk 'seen[$0]++ { exit 1 }' || { registrar "consulta da lista de chaves: chaves repetidas"; return 1; }
  for fp in $CONFIANCA_CHAVES; do fingerprint_valida "$fp" || return 1; done
  MOTIVO=""
  return 0
}

# Com a lista consultada, grava em $1 só as linhas das chaves embutidas cuja fingerprint está nela (a INTERSEÇÃO: o site nunca
# acrescenta uma chave). Devolve 1 (e MOTIVO) se não sobra nenhuma.
filtrar_assinantes_pela_lista() {
  local destino="$1" linha fp
  assinantes_embutidas | while IFS= read -r linha || [ -n "$linha" ]; do
    fp=$(fingerprint_da_linha "$linha") || continue
    printf '%s\n' "$CONFIANCA_CHAVES" | grep -Fxq -- "$fp" && printf '%s\n' "$linha"
  done >"$destino"
  if [ ! -s "$destino" ]; then
    MOTIVO="a lista atual de chaves do site não inclui a chave de assinatura deste instalador; nada foi instalado nem mudado. Baixe o instalador mais recente pelo canal oficial."
    return 1
  fi
}

# 0 se a tag $1 (vX.Y.Z[-pré]) é igual ou mais nova que a versão mínima da lista (uma pré-release é anterior à versão final).
tag_atende_versao_minima() {
  local candidata="${1#v}" numeros
  numeros="${candidata%%[-+]*}"
  semver_simples "$numeros" || return 1
  semver_maior_ou_igual "$numeros" "$CONFIANCA_MINIMA" || return 1
  if [ "$candidata" != "$numeros" ] && semver_maior_ou_igual "$CONFIANCA_MINIMA" "$numeros"; then return 1; fi
  return 0
}

# Consulta a lista e prepara $TMP_DIR/assinantes (a interseção) para o verify-tag ou para a opção --assinantes-do-instalador.
# $1 = a tag candidata (instalação nova) ou vazio (reinstalação: quem escolhe a candidata é o atualizador, que consulta de novo).
conferir_estado_das_chaves() {
  local tag="$1"
  dizer "Conferindo a lista atual de chaves de assinatura..."
  consultar_confianca || falhar "$MOTIVO"
  filtrar_assinantes_pela_lista "$TMP_DIR/assinantes" || falhar "$MOTIVO"
  if [ -n "$tag" ] && ! tag_atende_versao_minima "$tag"; then
    falhar "a lista atual do site exige a versão $CONFIANCA_MINIMA ou mais nova e a $tag é mais antiga; nada foi instalado. Baixe o instalador mais recente pelo canal oficial."
  fi
  registrar "lista de chaves conferida: $(printf '%s\n' "$CONFIANCA_CHAVES" | wc -l | tr -d ' ') chave(s); versão mínima $CONFIANCA_MINIMA"
}

# Confere a assinatura da tag no clone $1 com a chave embutida. MOTIVO diz por que recusou.
verificar_assinatura() {
  local dir="$1" tag="$2" assinantes id tipo conteudo objeto tipo_alvo nome commit_ref cabeca
  # A interseção entre a chave embutida e a lista do site (conferir_estado_das_chaves): nunca a chave embutida sozinha.
  assinantes="$TMP_DIR/assinantes"
  [ -s "$assinantes" ] || { MOTIVO="a lista atual de chaves não foi conferida."; return 1; }
  id=$(git_staging -C "$dir" rev-parse --verify -q "refs/tags/$tag") || { MOTIVO="a tag $tag não existe no repositório baixado."; return 1; }
  tipo=$(git_staging -C "$dir" cat-file -t "$id" 2>/dev/null)
  [ "$tipo" = "tag" ] || { MOTIVO="$tag não é uma tag anotada e assinada (tipo: ${tipo:-desconhecido})."; return 1; }
  # O `verify-tag` escolhe o verificador pelo tipo da assinatura que está na tag (OpenPGP e x509 passariam pelo gpg do
  # usuário, com o chaveiro dele). Só vale assinatura SSH conferida contra a chave embutida: exige o bloco SSH e
  # desliga os programas de gpg/x509 e fixa o verificador SSH em `ssh-keygen`: um `gpg.ssh.program` do ~/.gitconfig
  # (ou de qualquer config global) poderia aprovar uma assinatura de chave que não é a embutida.
  if ! git_staging -C "$dir" cat-file tag "$id" 2>/dev/null | grep -q '^-----BEGIN SSH SIGNATURE-----$'; then
    MOTIVO="a tag $tag não tem assinatura SSH."; return 1
  fi
  if ! rodar git_staging -C "$dir" -c gpg.format=ssh -c gpg.ssh.program=ssh-keygen \
      -c gpg.program=false -c gpg.openpgp.program=false -c gpg.x509.program=false \
      -c "gpg.ssh.allowedSignersFile=$assinantes" verify-tag "$id"; then
    MOTIVO="a assinatura da tag $tag não é do Iago (ou não existe)."; return 1
  fi
  # `verify-tag` prova a assinatura do objeto, não que o nome assinado é o da ref: confere o conteúdo assinado.
  conteudo=$(git_staging -C "$dir" cat-file tag "$id" 2>/dev/null | awk 'NF == 0 { exit } { print }')
  objeto=$(printf '%s\n' "$conteudo" | sed -n 's/^object //p' | head -n1)
  tipo_alvo=$(printf '%s\n' "$conteudo" | sed -n 's/^type //p' | head -n1)
  nome=$(printf '%s\n' "$conteudo" | sed -n 's/^tag //p' | head -n1)
  [ "$nome" = "$tag" ] || { MOTIVO="a tag assinada se chama '$nome', não '$tag'."; return 1; }
  [ "$tipo_alvo" = "commit" ] || { MOTIVO="a tag assinada não aponta direto para um commit."; return 1; }
  commit_ref=$(git_staging -C "$dir" rev-parse "refs/tags/$tag^{commit}" 2>/dev/null)
  cabeca=$(git_staging -C "$dir" rev-parse HEAD 2>/dev/null)
  if [ -z "$objeto" ] || [ "$objeto" != "$commit_ref" ] || [ "$objeto" != "$cabeca" ]; then MOTIVO="o código baixado não é o commit que o Iago assinou."; return 1; fi
  VERIFICADO_COMMIT="$objeto"
  return 0
}

# O arquivo instalacao-em-andamento marca que a primeira instalação ainda não terminou (some no passo do estado): se
# a rodada cair no meio, a seguinte a termina como instalação NOVA (cria as áreas padrão e liga o commit automático).
# Grava o estado mínimo DENTRO do clone ainda temporário ($1): quando a pasta aparece no lugar final, ela já é uma
# instalação reconhecível (uma rodada interrompida depois disso é retomada, não recusada como "outra coisa").
gravar_estado_inicial() {
  local dir="$1" arquivo="$1/.anvilore/atualizacao.json"
  mkdir -p "$dir/.anvilore" || falhar "não consegui criar $dir/.anvilore."
  printf 'bun=%s\n' "$BUN_GERENCIADO" >"$dir/.anvilore/instalacao-em-andamento"
  ( umask 077; printf '{\n  "versao": 1,\n  "modo": "automatico",\n  "canal": "estavel",\n  "estado": "ocioso",\n  "versaoInstalada": "%s"\n}\n' "${TAG#v}" >"$arquivo.tmp" && mv -f "$arquivo.tmp" "$arquivo" ) || falhar "não consegui gravar o estado da atualização."
}

passo_baixar_kit() {
  local origem pai
  resolver_tag
  conferir_estado_das_chaves "$TAG"
  origem="${ANVILORE_ORIGEM:-$REPO_OFICIAL}"
  pai=$(dirname "$PASTA")
  mkdir -p "$pai" || falhar "não consegui criar $pai."
  # Pasta de passagem NOVA (mkdir sem -p falha se o caminho existe): nunca apaga nem reaproveita algo que já estava lá. Só depois de
  # criada ela vira CLONE_TMP, que é o que a limpeza de saída apaga.
  local tmp="$pai/.anvilore-baixando.$$.$RANDOM"
  mkdir "$tmp" || falhar "não consegui criar uma pasta temporária nova em $pai."
  CLONE_TMP="$tmp"
  dizer "Baixando o Anvilore $TAG..."
  HOOKS_VAZIO="$TMP_DIR/sem-hooks"
  mkdir -p "$HOOKS_VAZIO" || falhar "não consegui criar uma pasta temporária."
  # --no-checkout: o conteúdo da candidata não é gravado (e nenhum filtro do git, como o do git-lfs, roda sobre ele)
  # antes de a assinatura passar.
  if ! rodar git_rede -c advice.detachedHead=false clone --quiet --no-checkout --branch "$TAG" -- "$origem" "$CLONE_TMP"; then
    falhar "não consegui baixar o Anvilore $TAG de $origem."
  fi
  dizer "Conferindo a assinatura da versão..."
  if ! verificar_assinatura "$CLONE_TMP" "$TAG"; then
    rm -rf "$CLONE_TMP"; CLONE_TMP=""
    falhar "assinatura inválida: $MOTIVO Apaguei o que baixei, não liguei nenhum agente e não instalei nada."
  fi
  # Só agora, com o commit autenticado (VERIFICADO_COMMIT), grava os arquivos.
  if ! rodar git -C "$CLONE_TMP" checkout --quiet --force --detach "$VERIFICADO_COMMIT"; then
    rm -rf "$CLONE_TMP"; CLONE_TMP=""
    falhar "não consegui gravar os arquivos do Anvilore $TAG. Apaguei o que baixei."
  fi
  gravar_estado_inicial "$CLONE_TMP"
  [ -d "$PASTA" ] && rmdir "$PASTA" 2>/dev/null
  mv "$CLONE_TMP" "$PASTA" || falhar "não consegui colocar o kit em $PASTA."
  CLONE_TMP=""
  mover_registro "$PASTA"
  dizer "Versão $TAG conferida (assinatura do Iago) e instalada em $PASTA."
}

# ---------------------------------------------------------------------------------------------------------------
# Passo 7 — agentes
# ---------------------------------------------------------------------------------------------------------------

AGENTES_CONHECIDOS="claude codex gemini copilot"
AGENTES_ACHADOS=""

procurar_agentes() {
  local agente achados=""
  for agente in $AGENTES_CONHECIDOS; do tem "$agente" && achados="$achados $agente"; done
  AGENTES_ACHADOS="${achados# }"
}

passo_agentes() {
  local quer=1
  procurar_agentes
  [ -n "$AGENTES_ACHADOS" ] && { registrar "agentes no PATH: $AGENTES_ACHADOS"; return 0; }
  dizer "Não achei nenhum agente (Claude Code, Codex, Gemini ou Copilot) neste computador."
  case "${ANVILORE_INSTALAR_CLAUDE:-}" in
    sim|s|1) quer=0 ;;
    nao|não|n|0) quer=1 ;;
    *)
      if sem_perguntas; then quer=1
      else perguntar "Quer que eu instale o Claude Code agora, pelo instalador oficial? (O login você faz depois, no próprio Claude Code.)" s && quer=0
      fi ;;
  esac
  if [ "$quer" -ne 0 ]; then registrar "Claude Code: não instalado (resposta da pessoa ou modo sem perguntas)"; return 0; fi
  dizer "Instalando o Claude Code..."
  if rodar curl -fsSL --proto '=https' -o "$TMP_DIR/claude-instalar.sh" "$URL_CLAUDE" && rodar bash "$TMP_DIR/claude-instalar.sh"; then
    hash -r 2>/dev/null
    procurar_agentes
  fi
  if [ -z "$AGENTES_ACHADOS" ]; then
    avisar "não consegui instalar o Claude Code. Instale um agente e rode este instalador de novo: ele só completa o que falta."
  fi
}

# ---------------------------------------------------------------------------------------------------------------
# Passo 8 — dependências do kit e configuração dos agentes
# ---------------------------------------------------------------------------------------------------------------

INSTALADOS=""

passo_configurar() {
  local agente codigo
  dizer "Preparando o kit (dependências e configuração dos agentes)..."
  rodar bash -c 'cd "$1" && bun install --frozen-lockfile' _ "$PASTA" || falhar "o 'bun install' do kit falhou (rede ou proxy?). Rode o instalador de novo quando a rede voltar."
  local extra=""
  [ "$AUTO_COMMIT" = "1" ] && extra="--auto-commit"
  # shellcheck disable=SC2086
  rodar bash -c 'cd "$1" && ANVILORE_DESTINO="$1" bun src/cli.ts instalar --destino "$1" $2' _ "$PASTA" "$extra"
  codigo=$?
  INSTALADOS=$(printf '%s\n' "$ULTIMA_SAIDA" | sed -n 's/^instalados: //p' | head -n1 | tr -d ',')
  if [ "$codigo" -ne 0 ]; then
    printf '%s\n' "$ULTIMA_SAIDA" | grep -E '^(ERRO|recusado)' | head -n5
    falhar "a configuração dos agentes terminou com erro (código $codigo). Corrija o que está acima e rode o instalador de novo."
  fi
  for agente in $AGENTES_ACHADOS; do
    case " $INSTALADOS " in
      *" $agente "*) ;;
      *) falhar "achei o $agente, mas ele não ficou configurado. Rode o instalador de novo." ;;
    esac
  done
  # Sem onboarding na interface ainda: a instalação NOVA cria as áreas padrão (dá para mudar depois). Numa instalação que
  # já existe as áreas são da pessoa: não recria a que ela apagou. Falha aqui não impede o resto.
  [ "$INSTALACAO_NOVA" = "1" ] || return 0
  if ! rodar bash -c 'cd "$1" && ANVILORE_DESTINO="$1" bun src/cli.ts init --areas "$2"' _ "$PASTA" "$AREAS_PADRAO"; then
    avisar "não consegui criar as áreas padrão da wiki; você pode escolher as áreas depois."
  fi
}

# ---------------------------------------------------------------------------------------------------------------
# Passo 9 — estado da atualização
# ---------------------------------------------------------------------------------------------------------------

passo_estado() {
  local script="$TMP_DIR/estado.ts"
  cat >"$script" <<'ANVILORE_FIM_ESTADO'
import { readFileSync, renameSync, writeFileSync } from "node:fs";
const [arquivo, alvos, bunGerenciado, autoCommit] = process.argv.slice(2);
let atual: Record<string, unknown> = {};
try { atual = JSON.parse(readFileSync(arquivo!, "utf8")); } catch {}
// Preserva o que a pessoa ou o atualizador já decidiram (modo, canal, estado, versão); só acrescenta o que o instalador sabe.
const novo = {
  versao: 1, modo: "automatico", canal: "estavel", estado: "ocioso", ...atual,
  alvos: alvos ? alvos.split(",") : [],
  autoCommit: autoCommit === "1",
  bunGerenciado: bunGerenciado === "1" || atual.bunGerenciado === true,
};
writeFileSync(`${arquivo}.tmp`, `${JSON.stringify(novo, null, 2)}\n`, { mode: 0o600 });
renameSync(`${arquivo}.tmp`, arquivo!);
ANVILORE_FIM_ESTADO
  local alvos
  alvos=$(printf '%s' "$INSTALADOS" | tr ' ' ',')
  rodar bun "$script" "$PASTA/.anvilore/atualizacao.json" "$alvos" "$BUN_GERENCIADO" "$AUTO_COMMIT" || falhar "não consegui gravar o estado da atualização."
  rm -f "$PASTA/.anvilore/instalacao-em-andamento"
}

# ---------------------------------------------------------------------------------------------------------------
# Passo 10 — atalho "Anvilore" (NÃO é desta fatia: a U6 preenche)
# ---------------------------------------------------------------------------------------------------------------

# Ponto de chamada do atalho. Contrato para a U6:
#   - recebe a pasta da instalação ($1);
#   - grava ~/.local/share/applications/anvilore.desktop (mesmo nome do pacote .deb/.rpm: o do usuário tem precedência
#     e a entrada não duplica) apontando para o `anvilore-abrir`;
#   - devolve 0 se o atalho existe ao final, 1 se não criou. Nunca derruba a instalação: quem chama só muda o texto
#     da última linha do resumo ("abra o atalho Anvilore" ou "abra o seu agente na pasta").
# Por enquanto não faz nada.
criar_atalho() {
  registrar "atalho: ponto de chamada ainda vazio (fatia U6); nada foi criado em $1"
  return 1
}

# ---------------------------------------------------------------------------------------------------------------
# Instalação já existente: vira "atualizar"
# ---------------------------------------------------------------------------------------------------------------

# ---------------------------------------------------------------------------------------------------------------
# Base mínima: a pasta instalada é lida (sem executar nada dela) ANTES de qualquer outro passo sobre ela
# ---------------------------------------------------------------------------------------------------------------

# 0 se $1 é uma versão X.Y.Z (sem v, pré-release, metadado de build nem zero à esquerda; até 9 dígitos por número).
# `[[ =~ ]]` compara a string inteira: um valor com quebra de linha no meio não passa.
semver_simples() {
  [[ "$1" =~ ^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$ ]]
}

# 0 se $1 >= $2 (as duas já validadas por semver_simples); a conta é por número, não por texto (0.10.0 > 0.9.0).
semver_maior_ou_igual() {
  local -a a b
  IFS=. read -r -a a <<<"$1"
  IFS=. read -r -a b <<<"$2"
  local i
  for i in 0 1 2; do
    [ "${a[$i]}" -gt "${b[$i]}" ] && return 0
    [ "${a[$i]}" -lt "${b[$i]}" ] && return 1
  done
  return 0
}

# Imprime a versão do package.json da pasta ($1) se ela for um X.Y.Z; senão, nada. SÓ LÊ O ARQUIVO COMO TEXTO: o Bun roda um
# trecho do próprio instalador, com a pasta de trabalho na pasta temporária (o bunfig.toml da pasta instalada não é carregado)
# e nada é importado, instalado nem executado a partir da pasta. A pasta nem sequer é a pasta atual do processo.
versao_da_pasta() {
  local saida
  saida=$(cd "$TMP_DIR" 2>/dev/null && ANV_PACOTE="$1/package.json" bun --no-install -e '
    try {
      const texto = new TextDecoder("utf-8", { fatal: true }).decode(require("node:fs").readFileSync(process.env.ANV_PACOTE));
      const pacote = JSON.parse(texto);
      const v = pacote !== null && typeof pacote === "object" && !Array.isArray(pacote) ? pacote.version : undefined;
      if (typeof v === "string") process.stdout.write(v + "#");
    } catch {}
  ' 2>/dev/null)
  # O "#" no fim impede que o $(...) engula uma quebra de linha final da versão (que então não passaria no semver_simples).
  case "$saida" in *"#") saida="${saida%"#"}" ;; *) return 0 ;; esac
  semver_simples "$saida" && printf '%s' "$saida"
  return 0
}

MSG_PASTA_NOVA="Instale o Anvilore numa pasta nova e peça ao seu agente para trazer a sua wiki para lá de forma conferida, fazendo antes uma cópia de segurança dela."

passo_conferir_base_minima() {
  local base versao
  base=$(base_minima_embutida)
  versao=$(versao_da_pasta "$PASTA")
  registrar "base mínima: $base ; versão da pasta: ${versao:-não reconhecida}"
  if [ -z "$versao" ]; then
    falhar "Não reconheço a versão do Anvilore na pasta $PASTA (o package.json está ausente, ilegível ou não é uma versão publicada). Por segurança, não executei nada dela e nada foi mudado. $MSG_PASTA_NOVA"
  fi
  if ! semver_maior_ou_igual "$versao" "$base"; then
    falhar "A pasta $PASTA tem o Anvilore na versão $versao, anterior à primeira versão assinada ($base). Por segurança, não executei nada dela e nada foi mudado. $MSG_PASTA_NOVA"
  fi
}

passo_atualizar_existente() {
  local primeira assinantes codigo versao_instalada
  # A lista atual de chaves vem ANTES de qualquer execução da pasta (a base mínima já foi conferida no passo anterior).
  conferir_estado_das_chaves ""
  # A versão mínima da lista vale também para o que já está instalado: uma pasta abaixo dela não tem o código executado por aqui
  # (o atualizador dela, o `instalar`, o `doctor`). A versão é lida do package.json como texto, como na base mínima.
  versao_instalada=$(versao_da_pasta "$PASTA")
  if [ -z "$versao_instalada" ] || ! semver_maior_ou_igual "$versao_instalada" "$CONFIANCA_MINIMA"; then
    falhar "A pasta $PASTA tem o Anvilore na versão ${versao_instalada:-desconhecida}, e a lista atual do site exige a versão $CONFIANCA_MINIMA ou mais nova. Por segurança, não executei nada dela e nada foi mudado. $MSG_PASTA_NOVA"
  fi
  mover_registro "$PASTA"
  dizer "Já existe uma instalação em $PASTA: vou conferir e atualizar, sem sobrescrever nada seu."
  INSTALACAO_NOVA=0
  if [ -f "$PASTA/.anvilore/instalacao-em-andamento" ]; then
    INSTALACAO_NOVA=1
    grep -q '^bun=1$' "$PASTA/.anvilore/instalacao-em-andamento" && BUN_GERENCIADO=1
    registrar "instalação anterior não terminou: retomando como instalação nova"
  elif [ -f "$PASTA/.anvilore/atualizacao.json" ]; then
    grep -Eq '"bunGerenciado": *true' "$PASTA/.anvilore/atualizacao.json" && BUN_GERENCIADO=1
    # Escolha da pessoa (ou do atualizador): só mantém o commit automático se o estado diz que está ligado.
    grep -Eq '"autoCommit": *true' "$PASTA/.anvilore/atualizacao.json" || AUTO_COMMIT=0
  fi
  # O atualizador da pasta confere a tag com o seguranca/assinantes que a pasta já tem, e uma instalação que ficou para trás
  # na troca de chave não conhece a chave nova. Entrega a ela as chaves embutidas deste instalador pela opção
  # --assinantes-do-instalador (só nesta chamada; não grava nada na pasta e não passa por variável de ambiente, que um
  # `atualizar` manual ou agendado herdaria sem querer): com elas o atualizador confere a tag só contra o que este script traz,
  # reduzido às chaves que a lista atual do site ainda autoriza.
  assinantes="$TMP_DIR/assinantes-reinstalacao"
  cp "$TMP_DIR/assinantes" "$assinantes" || falhar "não consegui preparar as chaves de assinatura para conferir a atualização."
  if rodar bash -c 'cd "$1" && ANVILORE_DESTINO="$1" bun src/cli.ts atualizar --assinantes-do-instalador "$2"' _ "$PASTA" "$assinantes"; then
    dizer "Atualização: $(printf '%s\n' "$ULTIMA_SAIDA" | tail -n1)"
  else
    codigo=$?
    # Código 2 = uso inválido: o atualizador da pasta é de uma versão que não conhece a opção. Não esconde o erro nem segue
    # como se tivesse conferido (nada foi mudado).
    if [ "$codigo" -eq 2 ]; then
      falhar "O atualizador dessa pasta é de uma versão anterior à primeira versão assinada e não sabe receber as chaves do instalador; nada foi mudado. $MSG_PASTA_NOVA"
    fi
    primeira=$(printf '%s\n' "$ULTIMA_SAIDA" | head -n1)
    avisar "não atualizei agora (${primeira:-sem detalhes}). Segui com a versão instalada."
  fi
  TAG=$(git -C "$PASTA" describe --tags --exact-match HEAD 2>/dev/null || echo "")
}

# ---------------------------------------------------------------------------------------------------------------
# Passos 11 e 12 — prova final e resumo
# ---------------------------------------------------------------------------------------------------------------

passo_final() {
  local codigo parcial=0 resumo_agentes proximo atalho=1 linha1
  rodar bash -c 'cd "$1" && ANVILORE_DESTINO="$1" bun src/cli.ts doctor "$1"' _ "$PASTA"
  codigo=$?
  [ -z "$AGENTES_ACHADOS" ] && parcial=1
  if [ "$codigo" -ne 0 ] && [ "$parcial" -eq 0 ]; then
    printf '%s\n' "$ULTIMA_SAIDA"
    falhar "a conferência final (doctor) achou um problema, mostrado acima. O kit está em $PASTA; corrija e rode o instalador de novo."
  fi
  criar_atalho "$PASTA" && atalho=0
  resumo_agentes="${INSTALADOS:-nenhum agente}"
  if [ "$parcial" -eq 1 ]; then
    linha1="Instalação parcial: o kit ${TAG:+$TAG }está pronto, mas não há agente com a proteção ligada."
    proximo="Instale um agente (por exemplo o Claude Code) e rode este instalador de novo: ele só completa o que falta."
  else
    linha1="Pronto: Anvilore ${TAG:+$TAG }instalado (agentes: $resumo_agentes)."
    if [ "$atalho" -eq 0 ]; then proximo="Próximo passo: abra o atalho Anvilore no menu de aplicativos."
    else proximo="Próximo passo: abra o Claude Code (ou o seu agente) na pasta Anvilore."; fi
  fi
  [ "$RG_FALTA" -eq 1 ] && linha1="$linha1 (sem rg: a busca da skill query fica indisponível)"
  printf '\n%s\nOnde está: %s\n%s Feche e abra o terminal e o agente para o PATH novo valer.\n' "$linha1" "$PASTA" "$proximo"
  registrar "resumo: $linha1 | $PASTA | $proximo"
  registrar "fim: $([ "$parcial" -eq 1 ] && echo parcial || echo completo)"
}

ajuda() {
  sed -n '2,23p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'
}

principal() {
  case "${1:-}" in
    -h|--help|--ajuda) ajuda; return 0 ;;
    "") ;;
    *) printf 'Opção desconhecida: %s (use --ajuda)\n' "$1" >&2; return 2 ;;
  esac
  iniciar_registro
  trap limpar EXIT
  detectar_tty
  conferir_embutidos
  dizer "Anvilore — instalador"
  passo_sistema
  passo_git_e_bun
  passo_rg
  passo_pasta
  if [ "$SITUACAO_PASTA" = "instalacao" ]; then passo_conferir_base_minima; passo_atualizar_existente; else passo_baixar_kit; fi
  passo_agentes
  passo_configurar
  passo_estado
  passo_final
  terminar 0
}

if [ "${ANVILORE_INSTALAR_CARREGAR:-}" != "1" ]; then
  principal "$@" </dev/null
fi
