#!/usr/bin/env bash
# Entrada interna do ensaio: só pode rodar como root dentro do contêiner descartável.
set -Eeuo pipefail
falhou() {
  local codigo=$?
  trap - ERR
  find /tmp /home -name instalacao.log -type f -exec cat {} \; 2>/dev/null || true
  exit "$codigo"
}
trap falhou ERR
[ -f /.dockerenv ] && [ "$(id -u)" -eq 0 ] && [ -r /prova/bun-real ] || {
  echo 'FALHA: execute scripts/provar-pacotes-linux.sh para criar um contêiner descartável.' >&2; exit 1;
}
sistema="${1:?ubuntu ou fedora}"
echo "ssh-keygen antes do pacote: $(command -v ssh-keygen || echo ausente)"
case "$sistema" in
  ubuntu)
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y --no-install-recommends /prova/dist/anvilore.deb desktop-file-utils
    dpkg-deb -I /prova/dist/anvilore.deb
    dpkg-deb -c /prova/dist/anvilore.deb
    test "$(dpkg-deb -f /prova/dist/anvilore.deb Package)" = anvilore
    test "$(dpkg-deb -f /prova/dist/anvilore.deb Architecture)" = all
    depends="$(dpkg-deb -f /prova/dist/anvilore.deb Depends)"
    [[ "$depends" == *openssh-client* ]]
    [[ "$(dpkg-query -S /usr/bin/ssh-keygen)" == openssh-client:* ]]
    [[ "$(dpkg-deb -f /prova/dist/anvilore.deb Recommends)" == *ripgrep* ]]
    ;;
  fedora)
    dnf install -y --setopt=install_weak_deps=False /prova/dist/anvilore.rpm desktop-file-utils shadow-utils util-linux diffutils
    rpm -qip /prova/dist/anvilore.rpm
    rpm -qlvp /prova/dist/anvilore.rpm
    test "$(rpm -qp --qf '%{NAME}' /prova/dist/anvilore.rpm)" = anvilore
    test "$(rpm -qp --qf '%{ARCH}' /prova/dist/anvilore.rpm)" = noarch
    depends="$(rpm -qp --requires /prova/dist/anvilore.rpm)"
    grep -qx openssh <<< "$depends"
    test "$(rpm -qf --qf '%{NAME}' /usr/bin/ssh-keygen)" = openssh
    rpm -qp --recommends /prova/dist/anvilore.rpm | grep -qx ripgrep
    ;;
  *) exit 2 ;;
esac
for dep in git unzip curl ca-certificates; do [[ "$depends" == *"$dep"* ]]; done
test ! -e /root/Anvilore
for arquivo in /usr/lib/anvilore/anvilore-abrir /usr/lib/anvilore/instalar.sh; do
  test "$(stat -c %a "$arquivo")" = 755
  test "$(stat -c %u:%g "$arquivo")" = 0:0
done
for arquivo in /usr/share/applications/anvilore.desktop /usr/share/icons/hicolor/scalable/apps/anvilore.svg; do
  test "$(stat -c %a "$arquivo")" = 644
  test "$(stat -c %u:%g "$arquivo")" = 0:0
done
test "$(readlink /usr/bin/anvilore-abrir)" = /usr/lib/anvilore/anvilore-abrir
desktop-file-validate /usr/share/applications/anvilore.desktop
grep -qx 'Terminal=true' /usr/share/applications/anvilore.desktop

mkdir -p /opt/prova-bin
cp /prova/bun-real /opt/prova-bin/bun-real
chmod 755 /opt/prova-bin/bun-real
cat > /opt/prova-bin/bun <<'BUN'
#!/bin/sh
if [ "${1:-}" = src/cli.ts ] && [ "${2:-}" = ui ]; then
  printf 'UI_OK\n' >> "$HOME/ui-chamadas.log"
  echo 'UI_OK (somente ui interceptada; demais comandos usam Bun real)'
  exit 0
fi
exec /opt/prova-bin/bun-real "$@"
BUN
printf '#!/bin/sh\necho "2.1.312 (Claude Code)"\n' > /opt/prova-bin/claude
chmod 755 /opt/prova-bin/bun /opt/prova-bin/claude
como_usuario() {
  local usuario="$1"; shift
  runuser -u "$usuario" -- env -i HOME="/home/$usuario" USER="$usuario" LANG=C.UTF-8 \
    PATH=/opt/prova-bin:/usr/local/bin:/usr/bin:/bin ANVILORE_SEM_PERGUNTAS=1 \
    ANVILORE_ORIGEM=/prova/origem GIT_CONFIG_NOSYSTEM=1 "$@"
}
for usuario in pessoa1 pessoa2; do
  useradd -m "$usuario"
  como_usuario "$usuario" git config --global user.name 'Teste pacote'
  como_usuario "$usuario" git config --global user.email teste@localhost
  # Origem montada é do uid do host; somente este repositório descartável é confiado.
  como_usuario "$usuario" git config --global --add safe.directory /prova/origem
  como_usuario "$usuario" git config --global --add safe.directory /prova/origem/.git
  como_usuario "$usuario" git ls-remote --tags --refs /prova/origem
  echo "== Primeiro clique como $usuario (sem sudo, uid=$(id -u "$usuario"))"
  como_usuario "$usuario" test ! -e "/home/$usuario/Anvilore"
  # Timeout é FALHA, não prova de UI. A chamada interceptada termina com 0.
  como_usuario "$usuario" timeout 240 anvilore-abrir
  pasta="/home/$usuario/Anvilore"
  test -f "$pasta/src/cli.ts"
  test -d "$pasta/wiki/.git"
  test "$(stat -c %U "$pasta")" = "$usuario"
  test ! -e "/home/$usuario/.local/share/applications/anvilore.desktop"
  test ! -e "/home/$usuario/Desktop/Anvilore.desktop"
  test "$(wc -l < "/home/$usuario/ui-chamadas.log")" -eq 1
  como_usuario "$usuario" bash -c 'cd "$HOME/Anvilore" && bun src/cli.ts doctor "$PWD"'
  log="$pasta/.anvilore/instalacao.log"
  test "$(grep -c 'início: instalar.sh' "$log")" -eq 1
  antes="$(sha256sum "$log")"
  head_antes="$(git -c "safe.directory=$pasta" -C "$pasta" rev-parse HEAD)"
  como_usuario "$usuario" timeout 30 anvilore-abrir
  test "$(sha256sum "$log")" = "$antes"
  test "$(git -c "safe.directory=$pasta" -C "$pasta" rev-parse HEAD)" = "$head_antes"
  test "$(wc -l < "/home/$usuario/ui-chamadas.log")" -eq 2
  como_usuario "$usuario" bash -c 'printf "fonte pessoal\n" > "$HOME/Anvilore/raw/prova.txt"; printf "wiki pessoal\n" > "$HOME/Anvilore/wiki/prova.md"'
  echo "OK $sistema/$usuario: primeiro clique, doctor0, segundo clique sem reinstalar, entrada única."
done
# Compare todo o kit e os dados dos dois usuários, inclusive conteúdo e permissões, após remoção.
find /home/pessoa1/Anvilore /home/pessoa2/Anvilore -printf '%p %m %u:%g %l\n' | sort > /tmp/arvore-antes
find /home/pessoa1/Anvilore /home/pessoa2/Anvilore -type f -exec sha256sum {} + | sort > /tmp/hashes-antes
case "$sistema" in ubuntu) apt-get remove -y anvilore ;; fedora) dnf remove -y anvilore ;; esac
test ! -e /usr/share/applications/anvilore.desktop
test ! -L /usr/bin/anvilore-abrir
test ! -e /usr/lib/anvilore/instalar.sh
test ! -e /usr/lib/anvilore/anvilore-abrir
test ! -e /usr/share/icons/hicolor/scalable/apps/anvilore.svg
find /home/pessoa1/Anvilore /home/pessoa2/Anvilore -printf '%p %m %u:%g %l\n' | sort > /tmp/arvore-depois
find /home/pessoa1/Anvilore /home/pessoa2/Anvilore -type f -exec sha256sum {} + | sort > /tmp/hashes-depois
diff -u /tmp/arvore-antes /tmp/arvore-depois
diff -u /tmp/hashes-antes /tmp/hashes-depois
echo "OK $sistema: instalação pelo gerenciador, metadados/permissões, dois usuários, quatro cliques e remoção preservando todo o kit."
