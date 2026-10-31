# Assinaturas públicas dos instaladores

Na preparação final de cada release, a máquina do mantenedor assina os bytes dos
scripts de produção no namespace SSH `file`. Os arquivos públicos resultantes
instalar.sh.sig e instalar.ps1.sig entram nesta pasta e no commit antes da tag.
Nenhuma chave privada entra no repositório ou no CI.

O build dos scripts lê os modelos, o manifesto, a chave pública, a base mínima e
a URL de confiança. Ele não lê estas assinaturas; adicioná-las ao commit não muda
os bytes assinados. Mudança posterior nos scripts ou nas entradas do build exige
novas assinaturas na preparação final.

`scripts/verificar-tag-release.ts` lê os arquivos do commit autenticado da tag,
regenera os scripts e verifica as duas
assinaturas com as chaves da versão anterior aprovadas na lista atual do site.
Assinatura ausente, inválida ou de uma chave desconhecida reprova o gate. A branch
normal usa chaves descartáveis em `tests/release-tag.test.ts`; não precisa das
assinaturas reais antecipadamente. O procedimento está em
[release.md](../../docs/knowledge_base/release.md).
