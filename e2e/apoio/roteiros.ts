import { FONTE, relatorioValido } from "../../tests/apoio/ingestao-exemplo";
import { init, resultado, resultadoDeFerramenta, SESSAO, usoDeFerramenta } from "../../tests/apoio/eventos-claude";
import type { RoteiroDoFalso } from "../../tests/apoio/claude-falso";
import { CONTEUDO_ATUALIZADO, CONTEUDO_FONTE_WIKI, CONTEUDO_LINK_QUEBRADO, paginaGerada } from "./paginas";

export function roteiroPadrao(): RoteiroDoFalso {
  const escritor = [
    { linha: init() },
    { linha: usoDeFerramenta("w-source", "Write", { file_path: "{{ROOT}}/wiki/pessoal/sources/llm-wiki.md" }) },
    { escrever: { caminho: "wiki/pessoal/sources/llm-wiki.md", conteudo: CONTEUDO_FONTE_WIKI } },
    { linha: resultadoDeFerramenta("w-source", "Gravado") },
    { linha: usoDeFerramenta("w-concept", "Write", { file_path: "{{ROOT}}/wiki/pessoal/concepts/segundo-cerebro.md" }) },
    { escrever: { caminho: "wiki/pessoal/concepts/segundo-cerebro.md", conteudo: CONTEUDO_ATUALIZADO } },
    { linha: resultadoDeFerramenta("w-concept", "Gravado") },
    { linha: resultado() },
  ] satisfies NonNullable<RoteiroDoFalso["escritor"]>;
  return {
    auth: { saida: JSON.stringify({ loggedIn: true }) },
    leitor: [{ linha: init() }, { linha: resultado({ structured_output: relatorioValido({ fonte: "{{FONTE_ATUAL}}" }) }) }],
    escritor,
  };
}

export function roteiroDeLeituraInvalida(): RoteiroDoFalso {
  const relatorio = relatorioValido({ fonte: "{{FONTE_ATUAL}}", takeaways: [{ texto: "Não confere.", citacao: { trecho: "Trecho que não existe na fonte.", secao: "Desconhecida" }, certeza: "comprovado" }] });
  return { auth: { saida: JSON.stringify({ loggedIn: true }) }, leitor: [{ linha: init() }, { linha: resultado({ structured_output: relatorio }) }] };
}

export function roteiroComEscritorParado(nome: string): RoteiroDoFalso {
  const base = roteiroPadrao();
  return {
    ...base,
    escritor: [
      { linha: init() },
      { linha: usoDeFerramenta("w-parcial", "Write", { file_path: "{{ROOT}}/wiki/pessoal/concepts/parcial.md" }) },
      { escrever: { caminho: "wiki/pessoal/concepts/parcial.md", conteudo: paginaGerada("parcial", "Escrita antes do cancelamento.") } },
      { linha: resultadoDeFerramenta("w-parcial", "Gravado") },
      { esperarArquivo: { caminho: `.anvilore/e2e/${nome}.liberar`, pronto: `.anvilore/e2e/${nome}.pronto`, sessao: SESSAO } },
      { linha: resultado() },
    ],
  };
}

export function roteiroComLeitorParado(nome: string): RoteiroDoFalso {
  const base = roteiroPadrao();
  return {
    ...base,
    leitor: [
      { linha: init() },
      { esperarArquivo: { caminho: `.anvilore/e2e/${nome}.liberar`, pronto: `.anvilore/e2e/${nome}.pronto`, sessao: SESSAO } },
      { linha: resultado({ structured_output: relatorioValido({ fonte: "{{FONTE_ATUAL}}" }) }) },
    ],
  };
}

export function roteiroComRecusaRaw(): RoteiroDoFalso {
  return {
    ...roteiroPadrao(),
    escritor: [
      { linha: init() },
      { linha: usoDeFerramenta("raw-write", "Write", { file_path: "{{ROOT}}/raw/pessoal/llm-wiki.md" }) },
      { linha: resultadoDeFerramenta("raw-write", "Bloqueado: raw/ é imutável", true) },
      { linha: resultado({ permission_denials: [{ tool_name: "Write", tool_use_id: "raw-write", tool_input: { file_path: "{{ROOT}}/raw/pessoal/llm-wiki.md" } }] }) },
    ],
  };
}

export function roteiroSemLogin(): RoteiroDoFalso {
  return { auth: { saida: JSON.stringify({ loggedIn: false }), codigo: 1 } };
}

export function roteiroComFechamentoComErro(): RoteiroDoFalso {
  return {
    auth: { saida: JSON.stringify({ loggedIn: true }) },
    leitor: [{ linha: init() }, { linha: resultado({ structured_output: relatorioValido({ fonte: "{{FONTE_ATUAL}}", paginas: [
      { caminho: "pessoal/sources/llm-wiki.md", tipo: "source", acao: "criar", motivo: "Fonte" },
      { caminho: "pessoal/concepts/problema.md", tipo: "concept", acao: "criar", motivo: "Página com link inválido" },
    ] }) }) }],
    escritor: [
      { linha: init() },
      { linha: usoDeFerramenta("w-problema", "Write", { file_path: "{{ROOT}}/wiki/pessoal/concepts/problema.md" }) },
      { escrever: { caminho: "wiki/pessoal/concepts/problema.md", conteudo: CONTEUDO_LINK_QUEBRADO } },
      { linha: resultadoDeFerramenta("w-problema", "Gravado") },
      { linha: resultado() },
    ],
  };
}

export const fonteDoTeste = FONTE;
