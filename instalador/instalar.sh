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
# Segurança: o manifesto de dependências (instalador/dependencias.json) e a chave pública (seguranca/assinantes) vêm
# EMBUTIDOS neste arquivo pela release (scripts/embutir-instalador.ts). Sem chave embutida válida o script recusa
# instalar. Nenhum segredo é pedido, lido ou gravado; o login dos agentes é da pessoa.
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

eh_instalacao() {
  [ -d "$1/.git" ] && [ -f "$1/AGENTS.md" ] && [ -f "$1/src/cli.ts" ] && [ -d "$1/skills" ] && [ -f "$1/.anvilore/atualizacao.json" ]
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
    TAG=$(git ls-remote --tags --refs "$ANVILORE_ORIGEM" 2>/dev/null | sed 's#.*refs/tags/##' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -n1)
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

# Confere a assinatura da tag no clone $1 com a chave embutida. MOTIVO diz por que recusou.
verificar_assinatura() {
  local dir="$1" tag="$2" assinantes id tipo conteudo objeto tipo_alvo nome commit_ref cabeca
  assinantes="$TMP_DIR/assinantes"
  assinantes_embutidas >"$assinantes"
  id=$(git_staging -C "$dir" rev-parse --verify -q "refs/tags/$tag") || { MOTIVO="a tag $tag não existe no repositório baixado."; return 1; }
  tipo=$(git_staging -C "$dir" cat-file -t "$id" 2>/dev/null)
  [ "$tipo" = "tag" ] || { MOTIVO="$tag não é uma tag anotada e assinada (tipo: ${tipo:-desconhecido})."; return 1; }
  # O `verify-tag` escolhe o verificador pelo tipo da assinatura que está na tag (OpenPGP e x509 passariam pelo gpg do
  # usuário, com o chaveiro dele). Só vale assinatura SSH conferida contra a chave embutida: exige o bloco SSH e
  # desliga os programas de gpg/x509.
  if ! git_staging -C "$dir" cat-file tag "$id" 2>/dev/null | grep -q '^-----BEGIN SSH SIGNATURE-----$'; then
    MOTIVO="a tag $tag não tem assinatura SSH."; return 1
  fi
  if ! rodar git_staging -C "$dir" -c gpg.format=ssh -c gpg.program=false -c gpg.openpgp.program=false -c gpg.x509.program=false \
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
  origem="${ANVILORE_ORIGEM:-$REPO_OFICIAL}"
  pai=$(dirname "$PASTA")
  mkdir -p "$pai" || falhar "não consegui criar $pai."
  CLONE_TMP="$pai/.anvilore-baixando.$$"
  rm -rf "$CLONE_TMP"
  dizer "Baixando o Anvilore $TAG..."
  HOOKS_VAZIO="$TMP_DIR/sem-hooks"
  mkdir -p "$HOOKS_VAZIO" || falhar "não consegui criar uma pasta temporária."
  # --no-checkout: o conteúdo da candidata não é gravado (e nenhum filtro do git, como o do git-lfs, roda sobre ele)
  # antes de a assinatura passar.
  if ! rodar git_staging -c advice.detachedHead=false clone --quiet --no-checkout --branch "$TAG" -- "$origem" "$CLONE_TMP"; then
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

passo_atualizar_existente() {
  local primeira
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
  if rodar bash -c 'cd "$1" && ANVILORE_DESTINO="$1" bun src/cli.ts atualizar' _ "$PASTA"; then
    dizer "Atualização: $(printf '%s\n' "$ULTIMA_SAIDA" | tail -n1)"
  else
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
  if [ "$SITUACAO_PASTA" = "instalacao" ]; then passo_atualizar_existente; else passo_baixar_kit; fi
  passo_agentes
  passo_configurar
  passo_estado
  passo_final
  terminar 0
}

if [ "${ANVILORE_INSTALAR_CARREGAR:-}" != "1" ]; then
  principal "$@" </dev/null
fi
