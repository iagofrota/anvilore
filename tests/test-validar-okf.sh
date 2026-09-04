#!/usr/bin/env bash
# Testa o perfil de proveniencia OKF, exercido pelo validador do anvilore.
#
# Cenarios (gherkin):
#
#   Cenario: perfil completo bem-formado passa (A1)
#     Dado uma pagina com sources/generated/verified/stale_after bem-formados
#     Quando rodo scripts/validar-wiki.sh
#     Entao a saida contem VALIDACAO: PASS e o codigo de saida e 0
#
#   Cenario: ausencia do perfil nunca reprova (A2)
#     Dado uma pagina sem nenhum campo OKF
#     Quando rodo o validador
#     Entao VALIDACAO: PASS — o perfil e opcional
#
#   Cenario: campo malformado reprova nomeando arquivo E campo (A3)
#     Dado uma pagina com um dos quatro campos malformado
#     Quando rodo o validador
#     Entao codigo 1, e a mensagem cita o nome do arquivo e o nome do campo
#
#   Cenario: classificacao de sources[].resource, com espaco fora da decisao (A4)
#     Dado um caminho inexistente, um descritor de escopo, um caminho com espaco
#       que existe e um caminho com espaco que nao existe
#     Entao o inexistente reprova, o descritor nao e checado, e o espaco nao
#       altera a classificacao em nenhum dos dois casos
#
#   Cenario: pagina vencida e reportada como metrica, nao como falha (A5)
#     Dado stale_after ja no passado
#     Entao codigo 0 e a metrica okf_stale a acusa. Vencer nao e falhar.
#
#   Cenario: PyYAML ausente pula o perfil com explicacao, sem reprovar (A10)
#     Dado um host com python3 mas sem PyYAML
#     Quando rodo scripts/validar-wiki.sh
#     Entao a validacao segue seu curso (VALIDACAO: PASS, codigo 0) e uma linha
#       diz por que o perfil OKF foi pulado (cita PyYAML). Nao pode dar FAIL sem
#       explicacao.
#
#   Cenario: frontmatter com YAML invalido nao e pulado calado (A11)
#     Dado uma pagina cujo frontmatter tem YAML sintaticamente invalido
#     Quando rodo o validador
#     Entao ele nao passa a pagina em silencio: reprova (codigo 1) e a mensagem
#       nomeia o arquivo que nao conseguiu ler.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

falhas=0
# TMPROOT = raiz do "repositorio" da fixture; WIKI = o vault dentro dela. Um
# sources[].resource local resolve contra o pai do vault (onde raw/ e wiki/ vivem
# lado a lado), entao a fixture precisa de um pai controlado para criar alvos reais.
TMPROOT="$(mktemp -d)"; trap 'rm -rf "$TMPROOT"' EXIT
WIKI="$TMPROOT/wiki"

# escreve uma pagina source valida no nivel base (frontmatter/type/slug), com o
# bloco OKF fornecido appendado ao frontmatter.
pagina() { # <slug> <bloco-okf-no-frontmatter>
  local slug="$1" okf="$2"
  rm -rf "$WIKI"; mkdir -p "$WIKI"
  { printf -- '---\ntitle: "T"\nslug: %s\ntype: source\n' "$slug"
    printf '%s\n' "$okf"
    printf -- '---\n\nCorpo.\n'
  } > "$WIKI/$slug.md"
}
rodar() { bash scripts/validar-wiki.sh "$WIKI" 2>&1; }

# --- A1: perfil completo bem-formado passa ---
pagina okf-completo 'sources:
  - id: fonte-teste
    resource: https://example.com/fonte
    author: human:autor
    last_modified: 2026-09-03T10:00:00-03:00
generated:
  by: process:anvilore-ingest
  at: 2026-09-03T10:30:00-03:00
verified:
  - by: human:revisor
    at: 2026-09-03T11:00:00-03:00
stale_after: 2099-09-03T00:00:00-03:00'
saida="$(rodar)"; codigo=$?
echo "$saida" | grep -q "VALIDACAO: PASS" \
  && echo "  ok: A1 perfil completo passa" || { echo "  FALHA: A1 perfil completo reprovou"; falhas=$((falhas+1)); }
[ "$codigo" -eq 0 ] \
  && echo "  ok: A1 codigo 0" || { echo "  FALHA: A1 codigo != 0"; falhas=$((falhas+1)); }

# --- A2: ausencia do perfil nunca reprova ---
pagina sem-okf ''
saida="$(rodar)"; codigo=$?
echo "$saida" | grep -q "VALIDACAO: PASS" \
  && echo "  ok: A2 pagina sem OKF passa" || { echo "  FALHA: A2 ausencia reprovou"; falhas=$((falhas+1)); }
[ "$codigo" -eq 0 ] \
  && echo "  ok: A2 codigo 0 sem OKF" || { echo "  FALHA: A2 codigo != 0"; falhas=$((falhas+1)); }

# --- A3: cada um dos quatro campos malformado nomeia arquivo E campo ---
checar_malformado() { # <slug> <bloco-okf> <trecho-do-campo>
  local slug="$1" okf="$2" campo="$3"
  pagina "$slug" "$okf"
  local saida codigo
  saida="$(rodar)"; codigo=$?
  [ "$codigo" -eq 1 ] \
    && echo "  ok: A3 $campo reprova (codigo 1)" || { echo "  FALHA: A3 $campo nao deu codigo 1"; falhas=$((falhas+1)); }
  echo "$saida" | grep -q "$campo" \
    && echo "  ok: A3 mensagem cita o campo '$campo'" || { echo "  FALHA: A3 mensagem nao cita '$campo'"; falhas=$((falhas+1)); }
  echo "$saida" | grep -q "$slug.md" \
    && echo "  ok: A3 mensagem cita o arquivo $slug.md" || { echo "  FALHA: A3 mensagem nao cita $slug.md"; falhas=$((falhas+1)); }
}
checar_malformado okf-sources 'sources:
  - author: human:autor' 'sources'
checar_malformado okf-generated 'generated:
  by: nao-e-ator-valido' 'generated'
checar_malformado okf-verified 'verified:
  - at: 2026-09-03T11:00:00-03:00' 'verified'
checar_malformado okf-stale 'stale_after: 2027-09-03' 'stale_after'

# --- A4: classificacao de sources[].resource; espaco nao entra na decisao ---
# 1. caminho inexistente reprova
pagina okf-a4-inexistente 'sources:
  - resource: raw/nao/existe.md'
saida="$(rodar)"; codigo=$?
{ [ "$codigo" -eq 1 ] && echo "$saida" | grep -q "raw/nao/existe.md"; } \
  && echo "  ok: A4 caminho inexistente reprova nomeando o caminho" || { echo "  FALHA: A4 caminho inexistente nao reprovou"; falhas=$((falhas+1)); }

# 2. descritor de escopo nao e checado
pagina okf-a4-descritor 'sources:
  - resource: todas as sessoes de 2026'
saida="$(rodar)"; codigo=$?
[ "$codigo" -eq 0 ] \
  && echo "  ok: A4 descritor de escopo nao e checado" || { echo "  FALHA: A4 descritor reprovou"; falhas=$((falhas+1)); }

# 3. caminho COM ESPACO que EXISTE passa
pagina okf-a4-espaco-existe 'sources:
  - resource: raw/notas do dia.md'
mkdir -p "$TMPROOT/raw"; printf 'bruto\n' > "$TMPROOT/raw/notas do dia.md"
saida="$(rodar)"; codigo=$?
[ "$codigo" -eq 0 ] \
  && echo "  ok: A4 caminho com espaco que existe passa" || { echo "  FALHA: A4 espaco existente reprovou (espaco vazou para a decisao?)"; falhas=$((falhas+1)); }
rm -rf "$TMPROOT/raw"

# 4. caminho COM ESPACO que NAO existe reprova
pagina okf-a4-espaco-nao 'sources:
  - resource: raw/reuniao sem arquivo.md'
saida="$(rodar)"; codigo=$?
{ [ "$codigo" -eq 1 ] && echo "$saida" | grep -q "raw/reuniao sem arquivo.md"; } \
  && echo "  ok: A4 caminho com espaco inexistente reprova" || { echo "  FALHA: A4 espaco inexistente nao reprovou"; falhas=$((falhas+1)); }

# --- A5: pagina vencida vira metrica, nao falha ---
pagina okf-vencida 'stale_after: 2000-01-01T00:00:00-03:00'
saida="$(rodar)"; codigo=$?
[ "$codigo" -eq 0 ] \
  && echo "  ok: A5 pagina vencida nao reprova (codigo 0)" || { echo "  FALHA: A5 vencimento reprovou"; falhas=$((falhas+1)); }
echo "$saida" | grep -q "okf_stale=1" \
  && echo "  ok: A5 vencimento reportado como metrica" || { echo "  FALHA: A5 metrica okf_stale nao acusou"; falhas=$((falhas+1)); }

# --- A10: PyYAML ausente pula o perfil OKF com explicacao, sem reprovar ---
# Simula a ausencia com um modulo yaml de fachada que estoura no import,
# injetado via PYTHONPATH: bloqueia so o `import yaml`, o resto do stdlib
# segue intacto. O perfil e opcional, entao a validacao nao pode reprovar por
# nao conseguir checa-lo — mas tem de dizer por que pulou.
FAKEYAML="$TMPROOT/fakeyaml"; mkdir -p "$FAKEYAML"
printf 'raise ImportError("PyYAML bloqueado para o teste A10")\n' > "$FAKEYAML/yaml.py"
pagina okf-sem-pyyaml 'sources:
  - resource: https://example.com/x'
saida="$(PYTHONPATH="$FAKEYAML" bash scripts/validar-wiki.sh "$WIKI" 2>&1)"; codigo=$?
[ "$codigo" -eq 0 ] \
  && echo "  ok: A10 sem PyYAML nao reprova (codigo 0)" || { echo "  FALHA: A10 sem PyYAML reprovou (codigo $codigo)"; falhas=$((falhas+1)); }
echo "$saida" | grep -q "VALIDACAO: PASS" \
  && echo "  ok: A10 validacao segue seu curso e passa" || { echo "  FALHA: A10 nao deu VALIDACAO: PASS"; falhas=$((falhas+1)); }
echo "$saida" | grep -qi "PyYAML" \
  && echo "  ok: A10 explica por que pulou (cita PyYAML)" || { echo "  FALHA: A10 pulou sem explicar"; falhas=$((falhas+1)); }

# --- A11: frontmatter com YAML invalido nao e pulado calado; nomeia o arquivo ---
# `sources: [nao-fecha` e uma sequencia de fluxo aberta — YAML sintaticamente
# invalido. As checagens base de validar-wiki.sh (type/slug) passam, entao quem
# tem de acusar e o validador OKF: pular calado deixaria a pagina PASS sem
# checagem nenhuma do perfil.
pagina okf-yaml-quebrado 'sources: [nao-fecha'
saida="$(rodar)"; codigo=$?
[ "$codigo" -eq 1 ] \
  && echo "  ok: A11 YAML invalido reprova (codigo 1)" || { echo "  FALHA: A11 YAML invalido nao reprovou (codigo $codigo)"; falhas=$((falhas+1)); }
echo "$saida" | grep -q "okf-yaml-quebrado.md" \
  && echo "  ok: A11 mensagem nomeia o arquivo" || { echo "  FALHA: A11 nao nomeou o arquivo"; falhas=$((falhas+1)); }

[ "$falhas" -eq 0 ] && echo "OK: validar-okf"
exit "$falhas"
