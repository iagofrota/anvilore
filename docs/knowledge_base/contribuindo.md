---
generated: 2026-10-24
---

# Contribuindo

Como rodar, testar e entregar uma mudança no Anvilore. Quem só **mantém uma wiki** não precisa
desta página.

## Rodar e testar

```bash
bun install
bun run checar
```

- `bun install` instala só dependências de desenvolvimento (`package.json`). O `bun.lock` é
  versionado, e o CI usa `bun install --frozen-lockfile`.
- `bun run checar` roda `tsc --noEmit` e `bun test --coverage` (script `checar` em
  `package.json`). A cobertura mínima é 80% no geral (`bunfig.toml`). A meta de 95% em validação e
  proteção de `raw/`, declarada pelo dono do projeto, ainda não tem trava por arquivo (veja
  [governanca.md](governanca.md)).
- O Bun usado no CI vem do campo `packageManager` de `package.json`.
- Para conferir esta pasta: `bun src/cli.ts checar-docs`. Para simular a trava de release:
  `bun src/cli.ts checar-release 0.1.0`.
- Os testes antigos em bash continuam em `tests/test-*.sh`, para o código que ainda é bash. Rode
  cada um com `bash tests/test-validar-wiki.sh`, por exemplo. Só valem em Linux.

O CI roda `bun run checar` e `checar-docs` em Ubuntu, Windows e macOS a cada push e pull request
(`.github/workflows/ci.yml`). Uma mudança que passa só no seu sistema não está pronta.

## Testes primeiro, com cenários em gherkin

- Escreva o teste antes do código e veja-o falhar.
- O nome do teste é o cenário: `Dado ... Quando ... Então ...`. Não há cucumber nem biblioteca de
  gherkin. Exemplo real: `tests/checar-docs.test.ts`.
- Todo módulo de `src/` é importado por `tests/cobertura.test.ts` para entrar na cobertura. Por
  isso importar um módulo não pode ter efeito colateral: o `import.meta.main` em `src/cli.ts` é o
  modelo.
- Uma peça portada de bash ou Python não pode se comportar diferente da original: mesmos códigos
  de saída e mesmas mensagens que os testes antigos conferem.
- Nunca pule uma checagem em silêncio. Dependência ausente, YAML inválido ou diretório
  inexistente reprova ou avisa; não vira "PASS".

## Adicionar um subcomando

1. Escreva o teste em `tests/`.
2. Crie o módulo em `src/comandos/`, exportando a função do comando.
3. Registre-o na tabela de `src/cli.ts`.
4. Se ele deve rodar no CI, acrescente a etapa em `.github/workflows/ci.yml`.

## CHANGELOG a cada mudança

Toda mudança acrescenta uma linha em `[Unreleased]` do `CHANGELOG.md`, no momento em que é feita, em
linguagem simples (quem lê é o gestor, não só o programador). O formato é o Keep a Changelog, com
Versionamento Semântico.

## Knowledge base junto com o código

- Mudou um comportamento: atualize a página correspondente no mesmo momento.
- Cada página cita os arquivos que sustentam o que diz. Para apontar uma linha, escreva "linha N"
  no texto, fora das crases, porque o `checar-docs` confere que o arquivo existe, e um arquivo com
  o número da linha colado ao nome não existe.
- Link relativo (`[texto](pagina.md)`) resolve a partir da página. Menção entre crases resolve a
  partir da raiz do repositório e só conta quando parece caminho: sem espaço, sem `*`, `<` ou `>`,
  que não seja URL, e que contenha `/` ou termine em extensão de arquivo conhecida. A âncora
  (`#...`) é descartada, e blocos de código cercados são ignorados. Veja o código em
  `src/comandos/checar-docs.ts`.
- Um agente pode redigir a página, com `generated: AAAA-MM-DD` no cabeçalho. **Só uma pessoa
  acrescenta `verified: AAAA-MM-DD`**, depois de ler a página e conferir os arquivos citados.
  Agente nenhum deve pôr esse campo.
- Páginas sobre código que ainda vai ser substituído não se escrevem. Elas nascem quando o código
  novo é integrado.

## Como a release é travada

1. A seção `## [x.y.z]` do `CHANGELOG.md` precisa existir e ter pelo menos um item entregue.
2. Toda página de `docs/knowledge_base/` precisa de `verified: AAAA-MM-DD`.
3. `bun src/cli.ts checar-release x.y.z` confere os dois pontos
   (`src/comandos/checar-release.ts`). O CI o roda só quando a tag de versão é criada
   (`.github/workflows/ci.yml`, última etapa).

A trava roda depois que a tag existe, então ela sinaliza mas não impede. Rode `checar-release`
localmente **antes** de criar a tag.

Hoje `checar-release 0.1.0` reprova, porque a seção `[0.1.0]` ainda não existe e nenhuma página
desta pasta foi revisada por pessoa. Isso é o comportamento esperado, e não deve ser contornado
acrescentando `verified` sem revisão.

**Publicar exige aprovação explícita do dono do projeto, a cada vez:** criar tag, publicar pacote,
abrir release no GitHub e enviar mudança de workflow. Preparar a release é trabalho do
contribuidor; publicá-la, não.
