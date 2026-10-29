#!/usr/bin/env bash
# Prova, num HOME vazio, que o instalar.sh instala o kit do zero em Linux (PLANO §8, cenários 1, 17 e 35), com o
# manifesto REAL: baixa o Bun e o rg dos releases oficiais e confere o SHA-256 de cada um.
#
# Roda no job "instalar-linux" do CI (.github/workflows/instalar-linux.yml) e pode rodar à mão:
#   agentop run --rm -- bash scripts/provar-instalar-linux.sh
#
# O que é de mentira: o repositório de origem (o commit atual, com tag assinada por uma chave descartável gerada aqui)
# e o agente (um `claude` que só responde). Nenhum segredo, nenhuma chave real, nada fora da pasta temporária.
set -euo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
home="$tmp/home"; falso="$tmp/falso"
mkdir -p "$home" "$falso"

versao="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$raiz/package.json")"
tag="v$versao"

echo "== origem de teste com a tag $tag assinada por chave descartável"
ssh-keygen -q -t ed25519 -N '' -C descartavel -f "$tmp/chave"
git clone -q --no-local "$raiz" "$tmp/origem"
git -C "$tmp/origem" tag -d "$tag" >/dev/null 2>&1 || true
git -C "$tmp/origem" -c user.name=Teste -c user.email=teste@localhost -c gpg.format=ssh -c "user.signingkey=$tmp/chave" tag -s "$tag" -m "$tag"
printf 'teste@localhost namespaces="git" %s\n' "$(cut -d' ' -f1,2 "$tmp/chave.pub")" > "$tmp/assinantes"

echo "== instalar.sh com o manifesto real e a chave descartável embutidos"
bun "$raiz/scripts/embutir-instalador.ts" --assinantes "$tmp/assinantes" --saida "$tmp/instalar.sh"
bun "$raiz/scripts/embutir-instalador.ts" --conferir "$tmp/instalar.sh" --assinantes "$tmp/assinantes"

printf '#!/bin/sh\necho "2.1.312 (Claude Code)"\n' > "$falso/claude"
chmod +x "$falso/claude"

# PATH só com as ferramentas do sistema que o instalador usa: sem Bun, sem rg e sem outros agentes. Assim ele precisa
# baixar o Bun e o rg dos releases oficiais (e conferir o hash de cada um) e acha só o `claude` de mentira.
for ferramenta in git curl unzip tar gzip ssh-keygen sha256sum sort sed awk grep head tail tr cat cp mv rm mkdir rmdir ls id date uname \
    mktemp dirname basename chmod ln env bash sh readlink wc touch cut tee sleep find xargs diff; do
  caminho="$(command -v "$ferramenta" || true)"
  [ -n "$caminho" ] && ln -sf "$caminho" "$falso/$ferramenta"
done
PATH_BASE="$falso"
rodar() {
  env -i HOME="$home" TMPDIR="$tmp" LANG=C.UTF-8 PATH="$PATH_BASE" \
    ANVILORE_SEM_PERGUNTAS=1 ANVILORE_ORIGEM="$tmp/origem" \
    GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 "$@"
}

echo "== instalação do zero (silenciosa)"
rodar bash "$tmp/instalar.sh"

pasta="$home/Anvilore"
bun_novo="$home/.bun/bin/bun"
conferir() { if ! "$@"; then echo "FALHA: $*" >&2; exit 1; fi; }
conferir test -x "$bun_novo"
conferir test -f "$pasta/src/cli.ts"
conferir grep -q '"bunGerenciado": true' "$pasta/.anvilore/atualizacao.json"
conferir grep -q '"alvos": \[' "$pasta/.anvilore/atualizacao.json"
conferir grep -q 'auto_commit = true' "$pasta/anvilore.toml"
conferir test -d "$pasta/wiki/.git"
conferir test -s "$pasta/.anvilore/instalacao.log"
conferir test -x "$home/.local/bin/rg"
conferir test "$("$home/.local/bin/rg" --version | head -n1 | cut -d' ' -f1)" = ripgrep
conferir grep -q '"alvos": \[$' "$pasta/.anvilore/atualizacao.json"
conferir grep -q '"claude"' "$pasta/.anvilore/atualizacao.json"
conferir test "$("$bun_novo" --version)" = "$(sed -n 's/^  "packageManager": "bun@\(.*\)",$/\1/p' "$raiz/package.json")"

echo "== doctor e o hook que recusa escrita em raw/"
rodar env PATH="$home/.bun/bin:$home/.local/bin:$PATH_BASE" bash -c "cd '$pasta' && bun src/cli.ts doctor '$pasta'"
set +e
printf '{"tool_name":"Write","tool_input":{"file_path":"%s/raw/nota.md"}}' "$pasta" \
  | rodar env PATH="$home/.bun/bin:$home/.local/bin:$PATH_BASE" bash -c "cd '$pasta' && bun src/cli.ts hook proteger-raw" >/dev/null 2>&1
codigo=$?
set -e
if [ "$codigo" -ne 2 ]; then echo "FALHA: o hook devolveu $codigo em vez de 2" >&2; exit 1; fi

echo "== segunda rodada: não sobrescreve nada e só confere"
mkdir -p "$pasta/raw" && printf 'minha nota\n' > "$pasta/raw/nota.md"
antes="$(sha256sum "$pasta/raw/nota.md" | cut -d' ' -f1)"
saida="$(rodar bash "$tmp/instalar.sh")"
printf '%s\n' "$saida"
printf '%s' "$saida" | grep -q 'Já existe uma instalação'
[ "$(sha256sum "$pasta/raw/nota.md" | cut -d' ' -f1)" = "$antes" ]
[ "$(grep -c 'início: instalar.sh' "$pasta/.anvilore/instalacao.log")" -eq 2 ]

echo "OK: instalação do zero e reexecução provadas em $(uname -m)."
