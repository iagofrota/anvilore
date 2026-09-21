#!/usr/bin/env bash
# B2 — indice dos callouts abertos ([!gap] / [!contradiction]) em wiki/_meta/.
#
# Anti-regressao: a asercao "o modo consulta nao toca em _meta/" so vale se ela
# detectar uma escrita. O teste muda a wiki, roda a consulta (hash tem de ficar
# igual) e ENTAO roda o modo normal (hash tem de mudar) — a mesma comparacao
# que falharia se o modo consulta escrevesse.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
SCRIPT="$PWD/scripts/listar-lacunas.py"

falhas=0
ok()    { echo "  ok: $*"; }
falha() { echo "  FALHA: $*"; falhas=$((falhas+1)); }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
W="$TMP/wiki"
mkdir -p "$W/alfa/concepts" "$W/alfa/sources" "$W/beta/concepts" "$W/_meta" "$W/log"

hash_de() { [ -f "$1" ] && sha256sum "$1" | cut -d' ' -f1 || echo "AUSENTE"; }
pagina() { # pagina <caminho> <slug> <tipo>
  printf -- '---\ntitle: "%s"\nslug: %s\ntype: %s\ntags: []\n---\n\nProsa inicial.\n\n' "$2" "$2" "$3" > "$1"
}

pagina "$W/alfa/concepts/a.md" a concept
cat >> "$W/alfa/concepts/a.md" <<'EOF'
> [!gap]
> Falta a definicao de X.
EOF

pagina "$W/alfa/sources/b.md" b source
cat >> "$W/alfa/sources/b.md" <<'EOF'
> [!gap] Nenhuma fonte cobre Y.
EOF

pagina "$W/beta/concepts/c.md" c concept
cat >> "$W/beta/concepts/c.md" <<'EOF'
> [!gap]
> Falta medir Z.

Mais prosa.

> [!contradiction]
> A fonte P afirma W; a fonte Q afirma o contrario.
EOF

# Mencao em prosa — NAO e callout: nao abre a linha com '>'.
pagina "$W/alfa/concepts/d.md" d concept
cat >> "$W/alfa/concepts/d.md" <<'EOF'
Quando o agente encontra uma lacuna ele escreve um [!gap] na pagina.
EOF

IDX="$W/_meta/lacunas.md"

# --- 1. modo indice: gera _meta/ com exatamente os 4 callouts reais ---------
if python3 "$SCRIPT" "$W" >/dev/null 2>&1; then ok "geracao do indice sai 0"; else falha "geracao do indice saiu != 0"; fi
if [ -f "$IDX" ]; then ok "indice gerado em _meta/lacunas.md"; else falha "indice nao foi gerado em $IDX"; fi

itens="$(grep -c '^- `' "$IDX" 2>/dev/null || echo 0)"
if [ "$itens" -eq 4 ]; then ok "indice lista 4 callouts"; else falha "indice listou $itens callouts (esperado 4)"; fi

# Caminho e linha corretos, conferidos contra o proprio arquivo (nao hardcoded).
conferir_endereco() { # conferir_endereco <relpath> <regex do callout>
  local rel="$1" re="$2" linha
  linha="$(grep -n -- "$re" "$W/$rel" | head -1 | cut -d: -f1)"
  if [ -z "$linha" ]; then falha "fixture sem o callout $re em $rel"; return; fi
  if grep -qF -- "\`$rel:$linha\`" "$IDX"; then
    ok "endereco correto: $rel:$linha"
  else
    falha "indice nao traz o endereco $rel:$linha"
  fi
}
conferir_endereco alfa/concepts/a.md '^> \[!gap\]'
conferir_endereco alfa/sources/b.md  '^> \[!gap\]'
conferir_endereco beta/concepts/c.md '^> \[!contradiction\]'

# A mencao em prosa nao entra.
if grep -q 'concepts/d\.md' "$IDX"; then
  falha "indice contou um [!gap] citado em prosa"
else
  ok "[!gap] citado em prosa nao entra no indice"
fi

# Os dois tipos entram por padrao (a origem so indexava 'gap').
grep -q 'contradiction' "$IDX" && ok "contradiction entra por padrao" || falha "contradiction fora do indice padrao"

# --- 2. modo consulta filtrando por tipo: so o tipo pedido, sem escrever ----
antes="$(hash_de "$IDX")"
saida="$(python3 "$SCRIPT" "$W" --consultar --tipos contradiction 2>/dev/null)"
depois="$(hash_de "$IDX")"

linhas="$(printf '%s\n' "$saida" | grep -c . || true)"
[ "$linhas" -eq 1 ] && ok "consulta por tipo devolve 1 resultado" || falha "consulta por tipo devolveu $linhas linhas: $saida"
printf '%s' "$saida" | grep -q 'beta/concepts/c\.md:' && ok "consulta devolve o endereco certo" || falha "consulta nao trouxe o endereco: $saida"
printf '%s' "$saida" | grep -q '\[gap\]' && falha "consulta por contradiction devolveu um gap" || ok "consulta nao vaza o outro tipo"
[ "$antes" = "$depois" ] && ok "consulta nao tocou em _meta/" || falha "consulta reescreveu _meta/lacunas.md"

# --- 3. PROVA DE DENTES ----------------------------------------------------
# Muda a wiki, roda a consulta (hash tem de continuar igual) e depois o modo
# normal (hash TEM de mudar). Sem esta segunda rodada, "o hash nao mudou"
# poderia significar so "nada mudou na wiki".
pagina "$W/beta/concepts/e.md" e concept
cat >> "$W/beta/concepts/e.md" <<'EOF'
> [!gap]
> Lacuna nova, aberta depois do primeiro indice.
EOF
antes="$(hash_de "$IDX")"
python3 "$SCRIPT" "$W" --consultar --tipos gap >/dev/null 2>&1
meio="$(hash_de "$IDX")"
python3 "$SCRIPT" "$W" >/dev/null 2>&1
depois="$(hash_de "$IDX")"
[ "$antes" = "$meio" ]    && ok "consulta continua sem escrever apos a wiki mudar" || falha "consulta escreveu"
[ "$meio" != "$depois" ]  && ok "modo normal MUDA o indice (a asercao tem dentes)" || falha "modo normal nao mudou o indice — asercao vazia"

# --- 4. --stdout nao escreve arquivo nenhum --------------------------------
rm -f "$IDX"
python3 "$SCRIPT" "$W" --stdout >/dev/null 2>&1
if [ -f "$IDX" ]; then falha "--stdout escreveu o indice"; else ok "--stdout nao escreve arquivo"; fi
python3 "$SCRIPT" "$W" >/dev/null 2>&1
if [ -f "$IDX" ]; then ok "modo normal recria o indice (dentes do passo 4)"; else falha "modo normal nao recriou o indice"; fi

# --- 5. area derivada igual a da lib (um dono so para a lista de nomes) ----
# A lista de diretorios que NAO sao area mora em scripts/lib-anvilore.sh. O
# script Python repete essa lista por forca do runtime; este teste cobra que as
# duas nao divirjam.
py_reservados="$(python3 -c "
import sys; sys.path.insert(0, 'scripts')
import importlib.util
spec = importlib.util.spec_from_file_location('m', 'scripts/listar-lacunas.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(' '.join(sorted(m.DIRS_RESERVADOS)), '|', ' '.join(sorted(m.DIRS_DE_TIPO)))
")"
sh_reservados="$(LC_ALL=C bash -c '
  source scripts/lib-anvilore.sh
  r=""; t=""
  for n in _meta log sources concepts entities; do
    nome_reservado "$n"      && r="$r $n"
    nome_tipo_diretorio "$n" && t="$t $n"
  done
  echo "$(echo $r | tr " " "\n" | LC_ALL=C sort | tr "\n" " " | sed "s/ $//") | $(echo $t | tr " " "\n" | LC_ALL=C sort | tr "\n" " " | sed "s/ $//")"
')"
if [ "$py_reservados" = "$sh_reservados" ]; then
  ok "listas de diretorios batem entre lib-anvilore.sh e o script Python"
else
  falha "listas divergem: python='$py_reservados' shell='$sh_reservados'"
fi

# Pagina solta na raiz da wiki cai em '(raiz)', nao numa area inventada.
pagina "$W/solta.md" solta concept
cat >> "$W/solta.md" <<'EOF'
> [!gap]
> Lacuna de pagina solta.
EOF
python3 "$SCRIPT" "$W" >/dev/null 2>&1
grep -q '(raiz)' "$IDX" && ok "pagina solta cai em (raiz)" || falha "pagina solta nao foi para (raiz)"

[ "$falhas" -eq 0 ] && echo "OK: listar-lacunas"
exit "$falhas"
