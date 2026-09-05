#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

falhas=0
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/wiki"

# página válida, porém com dívida registrada
cat > "$tmp/wiki/valida.md" <<'EOF'
---
title: "Válida"
slug: valida
type: concept
tags: [teste]
---

> [!gap]
> Falta a definição de X.
EOF

saida="$(bash scripts/validar-wiki.sh "$tmp/wiki")"; codigo=$?
echo "$saida" | grep -q "VALIDACAO: PASS" \
  && echo "  ok: passa com divida" || { echo "  FALHA: divida reprovou"; falhas=$((falhas+1)); }
[ "$codigo" -eq 0 ] \
  && echo "  ok: codigo 0 com divida" || { echo "  FALHA: divida alterou codigo de saida"; falhas=$((falhas+1)); }
echo "$saida" | grep -q "1 gaps" \
  && echo "  ok: contou o gap" || { echo "  FALHA: nao contou o gap"; falhas=$((falhas+1)); }

# index.md e log.md nao seguem o schema e devem ser ignorados
printf '# Índice\n' > "$tmp/wiki/index.md"
printf '# Log\n' > "$tmp/wiki/log.md"
saida="$(bash scripts/validar-wiki.sh "$tmp/wiki")"
echo "$saida" | grep -q "VALIDACAO: PASS" \
  && echo "  ok: ignora index.md e log.md" || { echo "  FALHA: cobrou schema de index/log"; falhas=$((falhas+1)); }

# página que viola invariante: sem frontmatter
printf 'Sem nada.\n' > "$tmp/wiki/quebrada.md"
saida="$(bash scripts/validar-wiki.sh "$tmp/wiki")"; codigo=$?
echo "$saida" | grep -q "VALIDACAO: FAIL" \
  && echo "  ok: reprova sem frontmatter" || { echo "  FALHA: aceitou pagina sem frontmatter"; falhas=$((falhas+1)); }
[ "$codigo" -eq 1 ] \
  && echo "  ok: codigo 1 em FAIL" || { echo "  FALHA: codigo de saida errado em FAIL"; falhas=$((falhas+1)); }

# invariantes de type e slug — os outros dois motivos de reprovacao
rm -f "$tmp/wiki/quebrada.md"
cat > "$tmp/wiki/tipo-errado.md" <<'EOF'
---
title: "Tipo errado"
slug: tipo-errado
type: memory
tags: [teste]
---
EOF
saida="$(bash scripts/validar-wiki.sh "$tmp/wiki")"
echo "$saida" | grep -q "type invalido" \
  && echo "  ok: reprova type fora do schema" || { echo "  FALHA: aceitou type invalido"; falhas=$((falhas+1)); }
rm -f "$tmp/wiki/tipo-errado.md"

cat > "$tmp/wiki/slug-errado.md" <<'EOF'
---
title: "Slug errado"
slug: outro-nome-qualquer
type: concept
tags: [teste]
---
EOF
saida="$(bash scripts/validar-wiki.sh "$tmp/wiki")"
echo "$saida" | grep -q "nao bate com o nome do arquivo" \
  && echo "  ok: reprova slug divergente" || { echo "  FALHA: aceitou slug divergente"; falhas=$((falhas+1)); }
rm -f "$tmp/wiki/slug-errado.md"

# diretorio inexistente e diretorio sem pagina nenhuma nao podem dar PASS:
# a tese do repositorio e que medicao nao erra em silencio
saida="$(bash scripts/validar-wiki.sh "$tmp/nao-existe" 2>/dev/null)"; codigo=$?
echo "$saida" | grep -q "VALIDACAO: FAIL" \
  && echo "  ok: reprova diretorio inexistente" || { echo "  FALHA: caminho errado deu PASS"; falhas=$((falhas+1)); }
[ "$codigo" -eq 1 ] \
  && echo "  ok: codigo 1 em diretorio inexistente" || { echo "  FALHA: codigo de saida errado"; falhas=$((falhas+1)); }

mkdir -p "$tmp/vazio"
saida="$(bash scripts/validar-wiki.sh "$tmp/vazio")"; codigo=$?
echo "$saida" | grep -q "VALIDACAO: FAIL" \
  && echo "  ok: reprova diretorio sem pagina" || { echo "  FALHA: diretorio vazio deu PASS"; falhas=$((falhas+1)); }
[ "$codigo" -eq 1 ] \
  && echo "  ok: codigo 1 em diretorio sem pagina" || { echo "  FALHA: codigo de saida errado"; falhas=$((falhas+1)); }

# ...mas uma wiki recem-criada, que so tem index.md e log.md, continua valida
mkdir -p "$tmp/nova"
printf '# Indice\n' > "$tmp/nova/index.md"
printf '# Log\n' > "$tmp/nova/log.md"
saida="$(bash scripts/validar-wiki.sh "$tmp/nova")"
echo "$saida" | grep -q "VALIDACAO: PASS" \
  && echo "  ok: wiki recem-criada passa" || { echo "  FALHA: wiki nova reprovada"; falhas=$((falhas+1)); }

# --- Areas ---
# uma pagina cuja area do frontmatter bate com o diretorio da area passa
mkdir -p "$tmp/aw/exemplo/concepts"
printf '# Indice\n' > "$tmp/aw/index.md"
cat > "$tmp/aw/exemplo/concepts/certa.md" <<'EOF'
---
title: "Certa"
slug: certa
type: concept
area: exemplo
tags: [teste]
---
EOF
saida="$(bash scripts/validar-wiki.sh "$tmp/aw")"; codigo=$?
echo "$saida" | grep -q "VALIDACAO: PASS" \
  && echo "  ok: area coerente com o diretorio passa" || { echo "  FALHA: area coerente reprovou"; falhas=$((falhas+1)); }
[ "$codigo" -eq 0 ] \
  && echo "  ok: codigo 0 com area coerente" || { echo "  FALHA: codigo!=0 com area coerente"; falhas=$((falhas+1)); }

# uma pagina cuja area diverge do diretorio reprova, e a mensagem nomeia
# o arquivo e as duas areas em conflito (para corrigir sem abrir o validador)
cat > "$tmp/aw/exemplo/concepts/divergente.md" <<'EOF'
---
title: "Divergente"
slug: divergente
type: concept
area: outra
tags: [teste]
---
EOF
saida="$(bash scripts/validar-wiki.sh "$tmp/aw")"; codigo=$?
echo "$saida" | grep -q "VALIDACAO: FAIL" \
  && echo "  ok: area divergente reprova" || { echo "  FALHA: area divergente passou"; falhas=$((falhas+1)); }
[ "$codigo" -ne 0 ] \
  && echo "  ok: codigo!=0 em area divergente" || { echo "  FALHA: codigo 0 em divergencia"; falhas=$((falhas+1)); }
msg="$(echo "$saida" | grep 'divergente.md')"
{ echo "$msg" | grep -q 'exemplo' && echo "$msg" | grep -q 'outra' && echo "$msg" | grep -q 'divergente.md'; } \
  && echo "  ok: mensagem nomeia o arquivo e as duas areas" \
  || { echo "  FALHA: mensagem nao nomeia arquivo+areas ('$msg')"; falhas=$((falhas+1)); }
rm -f "$tmp/aw/exemplo/concepts/divergente.md"

# uma wiki plana: pagina com campo area mas solta na raiz nao dispara divergencia
# (e o cenario de quem move as paginas das areas de volta para a raiz)
cat > "$tmp/aw/solta-com-area.md" <<'EOF'
---
title: "Solta com area"
slug: solta-com-area
type: concept
area: exemplo
tags: [teste]
---
EOF
saida="$(bash scripts/validar-wiki.sh "$tmp/aw")"
echo "$saida" | grep -q "VALIDACAO: PASS" \
  && echo "  ok: campo area em pagina solta nao reprova (wiki plana)" \
  || { echo "  FALHA: pagina plana com campo area reprovou"; falhas=$((falhas+1)); }
rm -f "$tmp/aw/solta-com-area.md"

# determinismo: duas execucoes byte-identicas em stdout, stderr e codigo
o1="$(bash scripts/validar-wiki.sh "$tmp/aw" 2>"$tmp/e1")"; c1=$?
o2="$(bash scripts/validar-wiki.sh "$tmp/aw" 2>"$tmp/e2")"; c2=$?
{ [ "$o1" = "$o2" ] && [ "$c1" = "$c2" ] && diff -q "$tmp/e1" "$tmp/e2" >/dev/null; } \
  && echo "  ok: saida deterministica em duas execucoes" \
  || { echo "  FALHA: saida divergiu entre execucoes"; falhas=$((falhas+1)); }

# A9: diretorios reservados (_meta, log) aceitam o markdown que o SCHEMA diz que
# eles guardam — sem cobrar frontmatter/type/slug como se fosse pagina de wiki.
mkdir -p "$tmp/aw/_meta" "$tmp/aw/log"
printf '# Lacunas\n\nqualquer conteudo comum\n' > "$tmp/aw/_meta/lacunas.md"
printf '# 2026-09-05\n\nlog do dia\n'          > "$tmp/aw/log/2026-09-05.md"
saida="$(bash scripts/validar-wiki.sh "$tmp/aw")"; codigo=$?
echo "$saida" | grep -q "VALIDACAO: PASS" \
  && echo "  ok: reservados com markdown comum passam" || { echo "  FALHA: reservado reprovou (markdown comum)"; falhas=$((falhas+1)); }
[ "$codigo" -eq 0 ] \
  && echo "  ok: codigo 0 com reservados (comum)" || { echo "  FALHA: codigo!=0 com reservados (comum)"; falhas=$((falhas+1)); }
# a isencao nao depende de ter ou nao frontmatter: com frontmatter e type: index
# (que reprovaria numa pagina de wiki) tambem passa
cat > "$tmp/aw/_meta/lacunas.md" <<'EOF'
---
title: "Indice de lacunas"
type: index
---
EOF
cat > "$tmp/aw/log/2026-09-05.md" <<'EOF'
---
title: "Log 2026-09-05"
type: index
---
EOF
saida="$(bash scripts/validar-wiki.sh "$tmp/aw")"; codigo=$?
echo "$saida" | grep -q "VALIDACAO: PASS" \
  && echo "  ok: reservados com frontmatter/type index passam" || { echo "  FALHA: reservado reprovou (frontmatter)"; falhas=$((falhas+1)); }
[ "$codigo" -eq 0 ] \
  && echo "  ok: codigo 0 com reservados (frontmatter)" || { echo "  FALHA: codigo!=0 com reservados (frontmatter)"; falhas=$((falhas+1)); }
rm -rf "$tmp/aw/_meta" "$tmp/aw/log"

# a wiki versionada no proprio repositorio valida, informa a divida e sai com 0
saida="$(bash scripts/validar-wiki.sh wiki)"; codigo=$?
echo "$saida" | grep -q "VALIDACAO: PASS" \
  && echo "  ok: wiki do repositorio valida" || { echo "  FALHA: wiki do repositorio reprovou"; falhas=$((falhas+1)); }
echo "$saida" | grep -q "Divida:" \
  && echo "  ok: informa a divida de conhecimento" || { echo "  FALHA: nao informou a divida"; falhas=$((falhas+1)); }
[ "$codigo" -eq 0 ] \
  && echo "  ok: codigo 0 na wiki do repositorio" || { echo "  FALHA: codigo!=0 na wiki do repositorio"; falhas=$((falhas+1)); }

[ "$falhas" -eq 0 ] && echo "OK: validar-wiki"
exit "$falhas"
