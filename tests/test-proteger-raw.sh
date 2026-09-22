#!/usr/bin/env bash
# C6 — o hook que recusa escrita em `raw/`.
#
# Duas disciplinas que este teste nao abre mao:
#
#   GRUPO DE CONTROLE — toda bateria que afirma "bloqueou `raw/`" roda, na
#   MESMA execucao, a tentativa equivalente contra `wiki/` e exige que ela
#   passe. Sem isso, "bloqueou" e indistinguivel de "recusa tudo".
#
#   PROVA POR MUTACAO — a condicao de bloqueio e desativada numa COPIA do
#   script e a bateria e refeita: o caso de `raw/` TEM de deixar de ser
#   bloqueado. Se o teste continuasse verde com a condicao morta, ele nao
#   estaria medindo o bloqueio. O original e conferido por hash no fim, para
#   provar que a mutacao nunca o tocou.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
HOOK="$PWD/hooks/proteger-raw.sh"

falhas=0
ok()    { echo "  ok: $*"; }
falha() { echo "  FALHA: $*"; falhas=$((falhas+1)); }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

hash_original_antes="$(sha256sum "$HOOK" 2>/dev/null | cut -d' ' -f1)"

# payload <caminho> [chave]  -> JSON no formato que um provedor entrega no stdin
payload() {
  local caminho="$1" chave="${2:-tool_input}"
  printf '{"tool_name":"Write","%s":{"file_path":"%s"}}' "$chave" "$caminho"
}

# codigo <script> <payload> -> ecoa o codigo de saida, guarda o stderr
codigo() {
  printf '%s' "$2" | bash "$1" >/dev/null 2>"$TMP/err.txt"
  echo $?
}

[ -f "$HOOK" ] || { falha "hooks/proteger-raw.sh nao existe"; echo "FALHA: sem script, nada a testar"; exit 1; }
[ -x "$HOOK" ] && ok "hooks/proteger-raw.sh e executavel" || falha "hooks/proteger-raw.sh sem bit de execucao"

# ============================================================================
# Bateria principal, no script de verdade
# ============================================================================
c="$(codigo "$HOOK" "$(payload 'raw/exemplo/teste.md')")"
if [ "$c" -ne 0 ]; then
  ok "escrita em raw/ e bloqueada (saida $c)"
else
  falha "escrita em raw/ passou (saida 0)"
fi
if grep -qiE 'raw/' "$TMP/err.txt" && grep -qiE 'imut|bloque|recus' "$TMP/err.txt"; then
  ok "a mensagem de bloqueio explica que raw/ e imutavel: $(head -1 "$TMP/err.txt")"
else
  falha "mensagem de bloqueio nao explica o motivo: $(head -1 "$TMP/err.txt")"
fi

# GRUPO DE CONTROLE, na mesma execucao.
c="$(codigo "$HOOK" "$(payload 'wiki/exemplo/teste.md')")"
[ "$c" -eq 0 ] && ok "escrita em wiki/ nao e bloqueada (grupo de controle)" \
               || falha "escrita em wiki/ foi bloqueada (saida $c) — a recusa nao e especifica de raw/"

# Caminho absoluto: o mesmo arquivo, escrito de outro jeito, tem de ser o mesmo veredito.
c="$(codigo "$HOOK" "$(payload "$PWD/raw/exemplo/teste.md")")"
[ "$c" -ne 0 ] && ok "caminho absoluto sob raw/ tambem e bloqueado" \
               || falha "caminho absoluto sob raw/ passou"
c="$(codigo "$HOOK" "$(payload "$PWD/wiki/exemplo/teste.md")")"
[ "$c" -eq 0 ] && ok "caminho absoluto sob wiki/ nao e bloqueado" \
               || falha "caminho absoluto sob wiki/ foi bloqueado"

# Nome que so PARECE raw/: `rawdata/` nao e a camada de fontes.
c="$(codigo "$HOOK" "$(payload 'wiki/rawdata/teste.md')")"
[ "$c" -eq 0 ] && ok "diretorio 'rawdata/' nao e confundido com raw/" \
               || falha "'rawdata/' foi bloqueado — a condicao casa por substring"

# A chave do payload varia entre provedores: a decisao nao pode depender da grafia.
c="$(codigo "$HOOK" "$(payload 'raw/exemplo/teste.md' 'toolInput')")"
[ "$c" -ne 0 ] && ok "payload com a chave em outra grafia tambem e bloqueado" \
               || falha "payload com chave 'toolInput' passou — a extracao so entende uma grafia"

# Payload que o script nao consegue interpretar: recusa, nao passa batido.
# Falhar aberto num hook de protecao seria o erro silencioso que este
# repositorio existe para desencorajar.
c="$(printf '%s' '{"tool_input": {"file_path": "raw/x.md"' | bash "$HOOK" >/dev/null 2>&1; echo $?)"
[ "$c" -ne 0 ] && ok "payload malformado citando raw/ falha fechado" \
               || falha "payload malformado citando raw/ passou"

# JSON VALIDO, mas sem nenhuma chave de caminho reconhecida — a forma
# documentada do Codex CLI em `hooks/README.md` e exatamente esta: matcher
# `apply_patch`, com o caminho alvo embutido no corpo do patch. "Nao achei
# caminho" nao pode virar "pode passar": sem caminho para decidir, o caso cai na
# mesma varredura grosseira do payload inparseavel. Fechar so quando o JSON
# quebra e uma protecao que parece ativa e nao e.
patch_payload() {
  printf '{"tool_name":"apply_patch","tool_input":{"patch":"*** Update File: %s"}}' "$1"
}
c="$(codigo "$HOOK" "$(patch_payload 'raw/exemplo/teste.md')")"
[ "$c" -ne 0 ] && ok "payload sem chave de caminho reconhecida citando raw/ falha fechado (saida $c)" \
               || falha "payload sem chave de caminho reconhecida citando raw/ passou (saida 0)"

# GRUPO DE CONTROLE do caso acima, na mesma execucao: mesmo formato de payload,
# caminho fora de raw/. Sem ele, "bloqueou" seria indistinguivel de "passou a
# recusar todo payload que nao entende".
c="$(codigo "$HOOK" "$(patch_payload 'wiki/exemplo/teste.md')")"
[ "$c" -eq 0 ] && ok "payload sem chave de caminho reconhecida fora de raw/ passa (grupo de controle)" \
               || falha "payload sem chave de caminho reconhecida fora de raw/ foi bloqueado (saida $c)"

# ============================================================================
# PROVA POR MUTACAO — numa copia, nunca no original
# ============================================================================
MUTANTE="$TMP/mutante.sh"
# Desativa a decisao: a funcao passa a responder "nao e raw/" para tudo.
python3 - "$HOOK" "$MUTANTE" <<'EOF'
import re, sys
origem, destino = sys.argv[1], sys.argv[2]
texto = open(origem, encoding="utf-8").read()
# Neutraliza o corpo de `escreve_em_raw()` inserindo um retorno negativo logo
# depois da abertura da funcao.
mutado, n = re.subn(r"(escreve_em_raw\(\)\s*\{)", r"\1\n  return 1  # MUTACAO", texto, count=1)
if n != 1:
    sys.stderr.write("mutacao nao encontrou a funcao de decisao escreve_em_raw()\n")
    sys.exit(3)
open(destino, "w", encoding="utf-8").write(mutado)
EOF
if [ $? -ne 0 ]; then
  falha "nao foi possivel mutar o script — a decisao nao esta numa funcao chamada escreve_em_raw()"
else
  c="$(codigo "$MUTANTE" "$(payload 'raw/exemplo/teste.md')")"
  if [ "$c" -eq 0 ]; then
    ok "com a decisao desativada, raw/ DEIXA de ser bloqueado (o teste tem dentes)"
  else
    falha "com a decisao desativada, raw/ continuou bloqueado — o teste nao mede a condicao"
  fi
  c="$(codigo "$MUTANTE" "$(payload 'wiki/exemplo/teste.md')")"
  [ "$c" -eq 0 ] && ok "o mutante continua deixando wiki/ passar (mutacao isolada)" \
                 || falha "o mutante bloqueou wiki/ — a mutacao mudou mais do que a decisao"
fi

hash_original_depois="$(sha256sum "$HOOK" | cut -d' ' -f1)"
[ "$hash_original_antes" = "$hash_original_depois" ] \
  && ok "o script original ficou intocado pela mutacao" \
  || falha "o script original mudou durante o teste"

[ "$falhas" -eq 0 ] && echo "OK: proteger-raw"
exit "$falhas"
