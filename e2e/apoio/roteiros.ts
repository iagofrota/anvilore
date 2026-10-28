import { FONTE, relatorioValido } from "../../tests/apoio/ingestao-exemplo";
import { init, resultado, resultadoDeFerramenta, SESSAO, usoDeFerramenta } from "../../tests/apoio/eventos-claude";
import type { RoteiroDoFalso } from "../../tests/apoio/claude-falso";
import { CONTEUDO_ATUALIZADO, CONTEUDO_FONTE_WIKI } from "./paginas";

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
    leitor: [{ linha: init() }, { linha: resultado({ structured_output: relatorioValido() }) }],
    escritor,
  };
}

export function roteiroDeLeituraInvalida(): RoteiroDoFalso {
  const relatorio = relatorioValido({ takeaways: [{ texto: "Não confere.", citacao: { trecho: "Trecho que não existe na fonte.", secao: "Desconhecida" }, certeza: "comprovado" }] });
  return { auth: { saida: JSON.stringify({ loggedIn: true }) }, leitor: [{ linha: init() }, { linha: resultado({ structured_output: relatorio }) }] };
}

export function roteiroComEscritorParado(nome: string): RoteiroDoFalso {
  const base = roteiroPadrao();
  return {
    ...base,
    escritor: [{ linha: init() }, { esperarArquivo: { caminho: `.anvilore/e2e/${nome}.liberar`, pronto: `.anvilore/e2e/${nome}.pronto`, sessao: SESSAO } }],
  };
}

export function roteiroComLeitorParado(nome: string): RoteiroDoFalso {
  const base = roteiroPadrao();
  return {
    ...base,
    leitor: [{ linha: init() }, { esperarArquivo: { caminho: `.anvilore/e2e/${nome}.liberar`, pronto: `.anvilore/e2e/${nome}.pronto`, sessao: SESSAO } }],
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

export const fonteDoTeste = FONTE;
