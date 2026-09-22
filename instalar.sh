#!/usr/bin/env bash
# instalar.sh — deixa um clone do anvilore configurado para o agente que você usa.
#
# O repositório já carrega o método: o contrato (`AGENTS.md`), as três skills
# (`skills/*/SKILL.md`), a decisão do hook (`hooks/proteger-raw.sh`) e o
# esqueleto da wiki. O que falta, depois do `git clone`, é pôr cada peça no
# lugar em que o SEU agente procura por ela. É só isso que este script faz.
#
# Ele não gera conteúdo novo: liga, funde e aponta para o que já está
# versionado. Duas consequências que valem mais do que parecem:
#
#   UMA FONTE SÓ — a skill instalada é um LINK para `skills/<nome>/`, não uma
#   cópia. Editar a skill no repositório muda a skill que o agente lê, no mesmo
#   instante, sem reinstalar. Cópia envelhece em silêncio; link não tem como.
#
#   NUNCA SOBRESCREVE CALADO — configuração que já existia no destino é fundida,
#   preservada. Quando a fusão é impossível (dois valores diferentes para a
#   mesma chave), o script PARA e explica, em vez de trocar o seu valor pelo
#   dele. Ver `scripts/fundir-json.py`.
#
# Alvo declarado: **Linux**. Este script não promete e não tenta Windows nem
# macOS — os caminhos, os links simbólicos e o `PATH` aqui assumem Linux.
#
# Onde cada agente procura as peças, com a fonte de cada convenção, está na
# tabela de `--help` e em `hooks/README.md`.
set -uo pipefail

RAIZ_FONTE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Dono único da lista de alvos. Acrescentar um agente é acrescentar um nome aqui
# e uma função `instalar_<nome>` abaixo — não é sair lembrando de N pontos.
ALVOS_CONHECIDOS=(claude codex gemini copilot)

MODO_SIMULACAO=0
DESTINO="${ANVILORE_DESTINO:-}"
ALVOS_PEDIDOS=""

MUDANCAS=0
AVISOS=0
ERROS=0
AUSENTES=()
INSTALADOS=()

# ============================================================================
# Uso
# ============================================================================
uso() {
  cat <<'FIM'
instalar.sh — configura um clone do anvilore para o agente que você usa.

USO
  bash instalar.sh [--alvo <lista>] [--destino <dir>] [--simular] [--help]

OPÇÕES
  --alvo <lista>    Quais agentes configurar, separados por vírgula:
                    claude, codex, gemini, copilot — ou `todos` (padrão).
                    Alvo cuja CLI não estiver no PATH é relatado e pulado;
                    os demais são instalados, e a execução termina com sucesso.

  --destino <dir>   Em qual clone do anvilore instalar. Padrão: o diretório
                    deste script. Também pode vir da variável de ambiente
                    ANVILORE_DESTINO. O script escreve EXCLUSIVAMENTE dentro
                    deste diretório — nunca em $HOME, nunca na configuração
                    global da sua máquina.

                    Quando o destino NÃO é o diretório deste script, as skills
                    instaladas por link (claude, codex, copilot) apontam para a
                    árvore DESTE clone — a fonte —, e não para a cópia do
                    destino, que pode estar mais velha ou nem ter a skill.

                    Duas coisas continuam sendo resolvidas pelo diretório de
                    trabalho do agente, ou seja, caem no DESTINO e não na fonte:
                    o caminho `./hooks/proteger-raw.sh` nas configurações de
                    hook, e o `skills/<nome>/SKILL.md` citado no comando do
                    gemini. Para o gemini, portanto, fonte ≠ destino só funciona
                    quando o destino já tem a skill.

  --simular         Só relata o que faria. Não cria, não altera e não remove
                    nenhum arquivo.

  --help            Esta ajuda.

O QUE É INSTALADO, POR AGENTE

  Todos      o esqueleto da wiki (`wiki/`), se ainda não existir. Conteúdo que
             já estiver lá nunca é sobrescrito nem duplicado.

  claude     skills -> .claude/skills/<nome>  (link para skills/<nome>)
             hooks  -> .claude/settings.json  (a forma de hooks/hooks.json)
             contrato: já encontra `CLAUDE.md`, que aponta para `AGENTS.md`.

  codex      skills -> .agents/skills/<nome>  (link para skills/<nome>)
             hooks  -> .codex/config.toml     ([[hooks.PreToolUse]])
             contrato: lê `AGENTS.md` da raiz por conta própria.

  gemini     skills -> .gemini/commands/<nome>.toml (comando que aponta para
                       skills/<nome>/SKILL.md)
             hooks  -> .gemini/settings.json  (hooks.BeforeTool)
             contrato: `AGENTS.md` NÃO é lido por padrão — a instalação
             acrescenta `context.fileName` para que ele passe a ser.

  copilot    skills -> .github/agents/<nome>.agent.md (link para o SKILL.md)
             hooks  -> .github/copilot/settings.json (hooks.preToolUse)
             contrato: lê `AGENTS.md` por conta própria.

SISTEMA
  Linux. Não há suporte a Windows nem a macOS, e não há intenção de haver.

EXEMPLOS
  bash instalar.sh --simular                    # o que aconteceria, sem tocar no disco
  bash instalar.sh --alvo claude                # só o Claude Code
  bash instalar.sh --alvo claude,codex          # dois agentes
  bash instalar.sh --alvo todos                 # todos os que existirem no PATH
FIM
}

# ============================================================================
# Relato
# ============================================================================
relatar()  { printf '  %s\n' "$*"; }
titulo()   { printf '\n%s\n' "$*"; }
mudanca()  { MUDANCAS=$((MUDANCAS+1)); relatar "$*"; }
aviso()    { AVISOS=$((AVISOS+1)); relatar "AVISO: $*"; }
erro()     { ERROS=$((ERROS+1)); relatar "ERRO: $*"; }

# Caminho curto, relativo ao destino — o relato fala do clone, não da máquina.
curto() { printf '%s' "${1#"$DESTINO"/}"; }

# ============================================================================
# Ações primitivas. Todas respeitam --simular e todas contam mudanças, para que
# "não havia nada a fazer" (D1) e "nada foi escrito" (D2) sejam medidos no mesmo
# lugar em vez de afirmados em prosa.
# ============================================================================

garantir_diretorio() {
  local alvo="$1"
  [ -d "$alvo" ] && return 0
  mudanca "cria diretório: $(curto "$alvo")/"
  [ "$MODO_SIMULACAO" -eq 1 ] || mkdir -p "$alvo"
}

# garantir_link <destino-do-link> <caminho-relativo-apontado>
# Idempotente pelo conteúdo do link, não pela existência do arquivo.
garantir_link() {
  local link="$1" aponta="$2"
  if [ -L "$link" ] && [ "$(readlink "$link")" = "$aponta" ]; then
    relatar "inalterado: $(curto "$link")"
    return 0
  fi
  # Arquivo de verdade no lugar do link: é de quem usa. Não é nosso para
  # remover, e trocá-lo por um link seria exatamente a sobrescrita silenciosa
  # que este instalador existe para não cometer.
  if [ -e "$link" ] && [ ! -L "$link" ]; then
    aviso "$(curto "$link") já existe e não foi criado por este instalador — preservado, nada escrito"
    return 0
  fi
  mudanca "liga: $(curto "$link") -> $aponta"
  [ "$MODO_SIMULACAO" -eq 1 ] || { rm -f "$link"; ln -s "$aponta" "$link"; }
}

# caminho_relativo <diretório-de-partida> <caminho-de-chegada>
# O caminho de chegada visto de dentro do diretório de partida. Puramente
# lexical: não resolve link simbólico e não exige que a chegada já exista —
# `realpath --relative-to` faz as duas coisas, e aqui o alvo pode ser uma skill
# que só existe na árvore-fonte.
caminho_relativo() {
  python3 -c 'import os, sys; print(os.path.relpath(sys.argv[2], sys.argv[1]))' "$1" "$2"
}

# garantir_link_para_fonte <caminho-do-link> <caminho-relativo-dentro-da-fonte>
#
# O alvo do link é calculado a partir de `RAIZ_FONTE`, nunca do destino. Fonte e
# destino são a mesma árvore no caso comum — instalar "para si mesmo" —, e aí
# isto dá exatamente o mesmo `../../skills/<nome>` de sempre. Mas `--destino`
# existe justamente para o caso em que não são: instalando de um clone para
# outro, `../../skills/<nome>` apontaria para a cópia do DESTINO, que pode estar
# mais velha, ou nem existir — e o link ficaria órfão sem ninguém reclamar.
#
# O link continua RELATIVO, e não absoluto, de propósito: no caso comum ele
# sobrevive a mover ou renomear o clone inteiro, coisa que um caminho absoluto
# não faria. O preço é que, com fonte ≠ destino, mover qualquer uma das duas
# árvores quebra o link — e é o preço certo, porque a instalação é entre dois
# caminhos que quem roda escolheu e conhece.
garantir_link_para_fonte() {
  local link="$1" rel_na_fonte="$2"
  garantir_link "$link" "$(caminho_relativo "$(dirname "$link")" "$RAIZ_FONTE/$rel_na_fonte")"
}

# garantir_json <arquivo> <fragmento-json>
# A fusão determinista mora em scripts/fundir-json.py; aqui só se decide quando
# chamá-la e o que fazer com o veredito.
garantir_json() {
  local arquivo="$1" fragmento="$2"
  local tmp veredito codigo
  tmp="$(mktemp)"
  printf '%s\n' "$fragmento" > "$tmp"

  local opcoes=()
  [ "$MODO_SIMULACAO" -eq 1 ] && opcoes+=(--simular)

  veredito="$(python3 "$RAIZ_FONTE/scripts/fundir-json.py" "${opcoes[@]}" "$arquivo" "$tmp" 2>"$tmp.err")"
  codigo=$?
  case "$codigo" in
    0) if [ "$veredito" = "MUDOU" ]; then
         mudanca "funde: $(curto "$arquivo")"
       else
         relatar "inalterado: $(curto "$arquivo")"
       fi ;;
    3) erro "$(curto "$arquivo"): $(head -1 "$tmp.err")" ;;
    *) erro "$(curto "$arquivo"): falha ao fundir ($(head -1 "$tmp.err"))" ;;
  esac
  rm -f "$tmp" "$tmp.err"
}

# garantir_bloco <arquivo> <marcador> <conteúdo> [prefixo-de-comentário]
garantir_bloco() {
  local arquivo="$1" marcador="$2" conteudo="$3" comentario="${4:-#}"
  local tmp veredito codigo
  tmp="$(mktemp)"
  printf '%s\n' "$conteudo" > "$tmp"

  local opcoes=(--comentario "$comentario")
  [ "$MODO_SIMULACAO" -eq 1 ] && opcoes+=(--simular)

  veredito="$(python3 "$RAIZ_FONTE/scripts/fundir-bloco.py" "${opcoes[@]}" "$arquivo" "$tmp" "$marcador" 2>"$tmp.err")"
  codigo=$?
  if [ "$codigo" -ne 0 ]; then
    erro "$(curto "$arquivo"): falha ao escrever o bloco ($(head -1 "$tmp.err"))"
  elif [ "$veredito" = "MUDOU" ]; then
    mudanca "bloco: $(curto "$arquivo")"
  else
    relatar "inalterado: $(curto "$arquivo")"
  fi
  rm -f "$tmp" "$tmp.err"
}

# ============================================================================
# As peças que vêm do repositório
# ============================================================================

# Nomes das skills versionadas. Derivados do disco: acrescentar uma skill nova
# não exige editar este script.
nomes_de_skill() {
  local caminho
  for caminho in "$RAIZ_FONTE"/skills/*/SKILL.md; do
    [ -f "$caminho" ] || continue
    basename "$(dirname "$caminho")"
  done
}

# Descrição do frontmatter de uma skill, já escapada como string de TOML/JSON.
descricao_de_skill() {
  python3 - "$1" <<'PY'
import json, sys
descricao = ""
with open(sys.argv[1], encoding="utf-8") as fluxo:
    if fluxo.readline().strip() == "---":
        for linha in fluxo:
            if linha.strip() == "---":
                break
            if linha.startswith("description:"):
                descricao = linha.split(":", 1)[1].strip().strip('"')
print(json.dumps(descricao, ensure_ascii=False))
PY
}

# ============================================================================
# D6 — o esqueleto da wiki
# ============================================================================
# Põe uma peça do esqueleto num arquivo de trabalho. Procura primeiro na árvore
# do repositório-fonte e, se ela não a tiver mais, no último commit — porque o
# caso que este passo existe para resolver é justamente o de quem apagou
# `wiki/`, e nesse caso a árvore não tem mais de onde copiar. Sai ≠0 quando a
# peça não existe em lugar nenhum: inventar conteúdo de esqueleto seria pior do
# que não instalar.
extrair_peca_do_esqueleto() {
  local rel="$1" saida="$2"
  [ -f "$RAIZ_FONTE/$rel" ] && { cp "$RAIZ_FONTE/$rel" "$saida"; return 0; }
  git -C "$RAIZ_FONTE" show "HEAD:$rel" > "$saida" 2>/dev/null && return 0
  return 1
}

# A lista do esqueleto tem um dono só, e não é este script: `wiki/.gitignore`,
# que já se declara "a fronteira da wiki — o esqueleto versionado entra; o
# conteúdo que quem usa escrever fica de fora". As linhas de reinclusão (`!`)
# são exatamente essa lista, então é de lá que ela é lida.
#
# Entradas terminadas em `/` são diretórios: cada um chega ao disco junto do
# arquivo que mora dentro dele, então não precisam de linha própria aqui.
# `tests/test-instalar.sh` confere que esta leitura concorda, item a item, com
# o que o git versiona — divergência vira teste vermelho, não surpresa.
lista_do_esqueleto() {
  local fronteira="$1"
  printf 'wiki/.gitignore\n'
  sed -n 's/^!//p' "$fronteira" | while IFS= read -r item; do
    case "$item" in
      ''|*/|.gitignore) continue ;;
      *) printf 'wiki/%s\n' "$item" ;;
    esac
  done
}

instalar_esqueleto() {
  titulo "wiki/ — esqueleto"
  local temporario rel
  temporario="$(mktemp -d)"

  if ! extrair_peca_do_esqueleto "wiki/.gitignore" "$temporario/fronteira"; then
    erro "o repositório-fonte não tem wiki/.gitignore — sem ele não há lista de esqueleto"
    rm -rf "$temporario"
    return 1
  fi

  # `< <(...)` e não `| while`: o laço precisa rodar neste shell para que as
  # mudanças que ele conta cheguem ao resumo.
  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    if [ -e "$DESTINO/$rel" ]; then
      relatar "inalterado: $rel"
      continue
    fi
    if ! extrair_peca_do_esqueleto "$rel" "$temporario/peca"; then
      erro "o repositório-fonte não tem '$rel' nem na árvore nem no último commit"
      continue
    fi
    mudanca "cria: $rel"
    [ "$MODO_SIMULACAO" -eq 1 ] && continue
    mkdir -p "$(dirname "$DESTINO/$rel")"
    cp "$temporario/peca" "$DESTINO/$rel"
  done < <(lista_do_esqueleto "$temporario/fronteira")

  rm -rf "$temporario"
}

# ============================================================================
# Os alvos
# ============================================================================
# Cada função abaixo põe as mesmas três peças (skills, hook, contrato) nos
# lugares em que AQUELE agente as procura. A fonte de cada convenção está em
# comentário, porque formato sem referência é palpite — e o próximo a mexer
# não tem como saber se pode confiar nele.

# Claude Code — skills em `.claude/skills/<nome>/SKILL.md`, hooks no
# `settings.json` do projeto. A forma do hook já está versionada em
# `hooks/hooks.json` e é usada COMO ESTÁ, não reescrita aqui.
instalar_claude() {
  garantir_diretorio "$DESTINO/.claude/skills"
  local nome
  for nome in $(nomes_de_skill); do
    garantir_link_para_fonte "$DESTINO/.claude/skills/$nome" "skills/$nome"
  done
  garantir_json "$DESTINO/.claude/settings.json" "$(cat "$RAIZ_FONTE/hooks/hooks.json")"
  relatar "contrato: CLAUDE.md já aponta para AGENTS.md — nada a instalar"
}

# Codex CLI — skills em `.agents/skills/<nome>/SKILL.md`
#   https://learn.chatgpt.com/docs/build-skills  (acesso em 2026-09-22)
# Hooks em `.codex/config.toml`, `[[hooks.PreToolUse]]`; o matcher de edição de
# arquivo aceita `apply_patch`, `Edit` e `Write`
#   https://learn.chatgpt.com/docs/hooks  (acesso em 2026-09-22)
# `AGENTS.md` da raiz é lido automaticamente, sem configuração
#   https://learn.chatgpt.com/docs/agent-configuration/agents-md  (acesso em 2026-09-22)
instalar_codex() {
  garantir_diretorio "$DESTINO/.agents/skills"
  local nome
  for nome in $(nomes_de_skill); do
    garantir_link_para_fonte "$DESTINO/.agents/skills/$nome" "skills/$nome"
  done
  garantir_diretorio "$DESTINO/.codex"
  garantir_bloco "$DESTINO/.codex/config.toml" "anvilore" "$(cat <<'TOML'
# Recusa escrita do agente em raw/. A decisão mora em hooks/proteger-raw.sh;
# esta forma só aponta para lá.
[[hooks.PreToolUse]]
matcher = "apply_patch|Edit|Write"

[[hooks.PreToolUse.hooks]]
type = "command"
command = "./hooks/proteger-raw.sh"
TOML
)"
  relatar "contrato: AGENTS.md é lido da raiz automaticamente — nada a instalar"
}

# Gemini CLI — não tem "skill"; o equivalente por projeto é o comando
# customizado em `.gemini/commands/<nome>.toml`
#   https://geminicli.com/docs/cli/custom-commands/  (acesso em 2026-09-22)
# Hooks em `.gemini/settings.json`, evento `BeforeTool`, `matcher` como regex
# sobre o nome da ferramenta; `write_file` e `replace` são as ferramentas de
# escrita
#   https://geminicli.com/docs/hooks/reference/    (acesso em 2026-09-22)
#   https://geminicli.com/docs/reference/tools/    (acesso em 2026-09-22)
# `AGENTS.md` NÃO é lido por padrão (só `GEMINI.md`); passa a ser quando
# `context.fileName` o inclui
#   https://geminicli.com/docs/cli/gemini-md/      (acesso em 2026-09-22)
instalar_gemini() {
  garantir_diretorio "$DESTINO/.gemini/commands"
  local nome descricao
  for nome in $(nomes_de_skill); do
    descricao="$(descricao_de_skill "$RAIZ_FONTE/skills/$nome/SKILL.md")"
    # O comando APONTA para a skill em vez de copiar o texto dela: a instrução
    # continua com um dono só, e continua sem citar agente nenhum (D10).
    garantir_bloco "$DESTINO/.gemini/commands/$nome.toml" "anvilore" "$(cat <<TOML
description = $descricao
prompt = """
Siga as instruções de \`skills/$nome/SKILL.md\`, neste repositório, do começo ao
fim, sem pular passos. O contrato que limita o que você pode fazer está em
\`AGENTS.md\`; leia-o antes de tocar em qualquer arquivo.
"""
TOML
)"
  done
  garantir_json "$DESTINO/.gemini/settings.json" "$(cat <<'JSON'
{
  "context": { "fileName": ["AGENTS.md", "GEMINI.md"] },
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "write_file|replace",
        "hooks": [
          { "name": "proteger-raw", "type": "command", "command": "./hooks/proteger-raw.sh" }
        ]
      }
    ]
  }
}
JSON
)"
  relatar "contrato: context.fileName passa a incluir AGENTS.md"
}

# GitHub Copilot CLI — o equivalente mais próximo de skill por projeto é o
# agente customizado em `.github/agents/<nome>.agent.md`, um markdown com
# frontmatter `name` + `description` — que é exatamente o frontmatter que os
# SKILL.md deste repositório já têm, então o arquivo instalado é um LINK para o
# SKILL.md, não uma cópia
#   https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli
#   (acesso em 2026-09-22)
# Hooks: o bloco `hooks` no topo de `.github/copilot/settings.json`; o evento
# antes da ferramenta chama-se `preToolUse`, e a entrada é
# `{ "type": "command", "bash": ... }` — NÃO existe evento `toolCall` nem campo
# `phase`
#   https://docs.github.com/en/copilot/reference/hooks-reference  (acesso em 2026-09-22)
# `AGENTS.md` está entre os arquivos de instrução que ele lê
#   https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions
#   (acesso em 2026-09-22)
instalar_copilot() {
  garantir_diretorio "$DESTINO/.github/agents"
  local nome
  for nome in $(nomes_de_skill); do
    garantir_link_para_fonte "$DESTINO/.github/agents/$nome.agent.md" "skills/$nome/SKILL.md"
  done
  garantir_diretorio "$DESTINO/.github/copilot"
  # Sem `matcher`: este evento não tem um. O script decide pelo caminho e sai 0
  # quando ele não é de `raw/`, então rodar em toda ferramenta é inofensivo.
  garantir_json "$DESTINO/.github/copilot/settings.json" "$(cat <<'JSON'
{
  "hooks": {
    "preToolUse": [
      { "type": "command", "bash": "./hooks/proteger-raw.sh" }
    ]
  }
}
JSON
)"
  relatar "contrato: AGENTS.md está entre os arquivos de instrução lidos — nada a instalar"
}

# ============================================================================
# Linha de comando
# ============================================================================
while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h) uso; exit 0 ;;
    --simular) MODO_SIMULACAO=1; shift ;;
    --alvo)    ALVOS_PEDIDOS="${2:-}"; shift 2 || { echo "--alvo exige um valor" >&2; exit 1; } ;;
    --alvo=*)  ALVOS_PEDIDOS="${1#--alvo=}"; shift ;;
    --destino) DESTINO="${2:-}"; shift 2 || { echo "--destino exige um valor" >&2; exit 1; } ;;
    --destino=*) DESTINO="${1#--destino=}"; shift ;;
    *) echo "opção desconhecida: $1" >&2; echo "tente: bash instalar.sh --help" >&2; exit 1 ;;
  esac
done

[ -n "$DESTINO" ] || DESTINO="$RAIZ_FONTE"
[ -n "$ALVOS_PEDIDOS" ] || ALVOS_PEDIDOS="todos"

if ! DESTINO="$(cd "$DESTINO" 2>/dev/null && pwd)"; then
  echo "destino não existe ou não é um diretório: ${DESTINO}" >&2
  exit 1
fi

# Duas travas de segurança, e nenhuma é cerimônia. Este script escreve na
# máquina de quem clona; escrever no lugar errado uma vez só já é dano que
# nenhum "desculpe" desfaz.
if [ "$DESTINO" = "${HOME:-}" ]; then
  echo "recusado: o destino é o seu \$HOME. Este instalador configura um clone do" >&2
  echo "anvilore, não a configuração global da sua máquina." >&2
  exit 1
fi
for exigido in AGENTS.md skills hooks/proteger-raw.sh; do
  if [ ! -e "$DESTINO/$exigido" ]; then
    echo "recusado: $DESTINO não parece um clone do anvilore (falta '$exigido')." >&2
    echo "Use --destino para apontar o clone que você quer configurar." >&2
    exit 1
  fi
done

# Expansão dos alvos pedidos.
if [ "$ALVOS_PEDIDOS" = "todos" ]; then
  ALVOS=("${ALVOS_CONHECIDOS[@]}")
else
  IFS=',' read -r -a ALVOS <<< "$ALVOS_PEDIDOS"
fi
for alvo in "${ALVOS[@]}"; do
  conhecido=0
  for candidato in "${ALVOS_CONHECIDOS[@]}"; do
    [ "$alvo" = "$candidato" ] && conhecido=1
  done
  if [ "$conhecido" -eq 0 ]; then
    echo "alvo desconhecido: '$alvo'. Conhecidos: ${ALVOS_CONHECIDOS[*]}, todos" >&2
    exit 1
  fi
done

# ============================================================================
# Execução
# ============================================================================
echo "anvilore — instalação"
echo "  destino: $DESTINO"
echo "  alvos:   ${ALVOS[*]}"
[ "$MODO_SIMULACAO" -eq 1 ] && echo "  modo:    SIMULAÇÃO (nada será escrito)"

instalar_esqueleto

for alvo in "${ALVOS[@]}"; do
  titulo "$alvo"
  if ! command -v "$alvo" >/dev/null 2>&1; then
    relatar "CLI ausente do PATH — alvo pulado (isto não é uma falha)"
    AUSENTES+=("$alvo")
    continue
  fi
  "instalar_$alvo"
  INSTALADOS+=("$alvo")
done

# ============================================================================
# Fecho — "não havia nada a fazer" é dito, não deixado ao silêncio (D1)
# ============================================================================
titulo "resumo"
[ ${#INSTALADOS[@]} -gt 0 ] && relatar "instalados: ${INSTALADOS[*]}"
[ ${#AUSENTES[@]} -gt 0 ]   && relatar "ausentes do PATH, pulados: ${AUSENTES[*]}"
[ "$AVISOS" -gt 0 ]         && relatar "avisos: $AVISOS (nada foi sobrescrito)"

if [ "$ERROS" -gt 0 ]; then
  relatar "ERROS: $ERROS — a instalação parou onde não podia decidir sozinha."
  exit 4
fi

if [ "$MODO_SIMULACAO" -eq 1 ]; then
  if [ "$MUDANCAS" -eq 0 ]; then
    relatar "SIMULAÇÃO: nada a fazer — tudo já está instalado. Nenhum arquivo foi escrito."
  else
    relatar "SIMULAÇÃO: $MUDANCAS mudança(s) seriam aplicadas. Nenhum arquivo foi escrito."
  fi
  exit 0
fi

if [ "$MUDANCAS" -eq 0 ]; then
  relatar "nada a fazer — tudo já estava instalado."
else
  relatar "$MUDANCAS mudança(s) aplicada(s)."
fi
exit 0
