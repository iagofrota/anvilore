import type { Vault } from "./vault";
import { paginaAtualizada, paginaGerada } from "./paginas";

export async function semearConversa(vault: Vault, id: string, nome: string, situacao: "pronta" | "erro" = "pronta"): Promise<void> {
  const fonte = `raw/pessoal/${nome}`;
  const agora = "2026-01-02T00:00:00.000Z";
  await vault.escrever(fonte, `# ${nome}\n\nFonte temporária do teste.\n`);
  await vault.escrever(`.anvilore/ui/conversas/${id}.json`, JSON.stringify({
    versao: 1, id, criadaEm: agora, atualizadaEm: agora, area: "pessoal", fonte, nome, bytes: 32,
    passo: situacao === "erro" ? "leitura" : "fonte", situacao, ...(situacao === "erro" ? { erro: "Falha de teste preservada." } : {}), atividade: [], avisos: [], recusas: [],
  }));
}

export async function semearFila(vault: Vault): Promise<void> {
  await vault.escrever("wiki/pessoal/concepts/nova.md", paginaGerada("nova", "Página nova de revisão."));
  await vault.escrever("wiki/pessoal/concepts/atualizada.md", paginaAtualizada("atualizada", "Página atualizada de revisão."));
  await vault.escrever("wiki/pessoal/concepts/invalida.md", "---\ntype: concept\nslug: invalida\ntitle: Inválida\ngenerated: ontem\n---\nTexto.\n");
}
