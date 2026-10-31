#!/usr/bin/env bash
# Prova DEB/RPM em sistemas descartáveis; nunca instala no host.
# agentop run --rm -- bash scripts/provar-pacotes-linux.sh [ubuntu|fedora|ambas]
set -euo pipefail
raiz="$(cd "$(dirname "$0")/.." && pwd)"
distro="${1:-ambas}"
case "$distro" in ubuntu|fedora|ambas) ;; *) echo "Uso: $0 [ubuntu|fedora|ambas]" >&2; exit 2 ;; esac
command -v docker >/dev/null || { echo 'FALHA: Docker é obrigatório; nenhuma prova será pulada.' >&2; exit 1; }
mkdir -p "$raiz/.anvilore"
tmp="$(mktemp -d "$raiz/.anvilore/provas-pacotes.XXXXXX")"
servidor=""
limpar() {
  local cid
  for cid in "$tmp"/cid-*; do
    [ -f "$cid" ] && docker rm -f "$(cat "$cid")" >/dev/null 2>&1 || true
  done
  if [ -n "$servidor" ]; then kill "$servidor" 2>/dev/null || true; wait "$servidor" 2>/dev/null || true; fi
  rm -rf "$tmp"
}
trap limpar EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p "$tmp/runtime/dist" "$tmp/confianca"
versao="$(bun -e 'console.log((await Bun.file(process.argv[1]).json()).version)' "$raiz/package.json")"
tag="v$versao"
echo "== Origem real, tag $tag e chave descartável"
ssh-keygen -q -t ed25519 -N '' -C descartavel -f "$tmp/chave"
git clone -q --no-local "$raiz" "$tmp/runtime/origem"
git -C "$tmp/runtime/origem" tag -d "$tag" >/dev/null 2>&1 || true
git -C "$tmp/runtime/origem" -c user.name=Teste -c user.email=teste@localhost -c gpg.format=ssh -c "user.signingkey=$tmp/chave" tag -s "$tag" -m "$tag"
printf 'teste@localhost namespaces="git" %s\n' "$(cut -d' ' -f1,2 "$tmp/chave.pub")" > "$tmp/assinantes"
printf '%s\n' "$versao" > "$tmp/base-minima"
printf '{"formato":1,"chaves":["%s"],"versaoMinima":"0.0.0"}\n' "$(ssh-keygen -lf "$tmp/chave.pub" | cut -d' ' -f2)" > "$tmp/confianca/confianca.json"
bun "$raiz/scripts/servir-confianca-teste.ts" "$tmp/confianca" &
servidor=$!
for _ in $(seq 1 100); do [ -s "$tmp/confianca/porta" ] && break; sleep 0.1; done
[ -s "$tmp/confianca/porta" ] || { echo 'FALHA: servidor de confiança não subiu' >&2; exit 1; }
url_confianca="http://127.0.0.1:$(cat "$tmp/confianca/porta")/confianca.json"

echo '== Build explicitamente de teste; os quatro campos serão conferidos antes do nfpm'
bun "$raiz/scripts/embutir-instalador.ts" --assinantes "$tmp/assinantes" --base-minima "$tmp/base-minima" --url-confianca "$url_confianca" --aceitar-url-de-teste --saida "$tmp/instalar.sh"
bun "$raiz/scripts/empacotar-linux.ts" --teste --instalar-sh "$tmp/instalar.sh" --assinantes "$tmp/assinantes" --base-minima "$tmp/base-minima" --url-confianca "$url_confianca" --saida "$tmp/runtime/dist" --versao "$versao"
# Bun real pré-fornecido: só a chamada ui será interceptada. Instalar/init/doctor continuam reais.
cp -L "$(command -v bun)" "$tmp/runtime/bun-real"
cp "$raiz/scripts/provar-pacote-linux-container.sh" "$tmp/runtime/provar-pacote-linux-container.sh"
chmod -R a+rX "$tmp/runtime"
for sistema in ubuntu fedora; do
  [ "$distro" = ambas ] || [ "$distro" = "$sistema" ] || continue
  case "$sistema" in ubuntu) imagem=ubuntu:24.04 ;; fedora) imagem=fedora:44 ;; esac
  echo "== Runtime $sistema ($imagem): pacote, dois usuários, segundo clique, remoção"
  docker run --init --rm --cidfile "$tmp/cid-$sistema" --network=host --memory=2g \
    --mount "type=bind,src=$tmp/runtime,dst=/prova,readonly" \
    "$imagem" bash /prova/provar-pacote-linux-container.sh "$sistema"
done
echo 'OK: todas as provas solicitadas passaram; nenhuma instalação no host.'
