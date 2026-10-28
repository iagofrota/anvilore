import { expect, test } from "bun:test";
import { avisoDoFechamento, passosDoPainel, podeLerDeNovo, tamanhoLegivel, textoDeSeguir } from "../ui/web/ingestao";

const estados = (passo: string, situacao: string) => passosDoPainel({ passo, situacao } as never).map(p => p.estado);

test("Dado nenhuma ingestão Quando desenho o painel Então são 7 passos e só o da fonte está ativo", () => {
  const passos = passosDoPainel(undefined);
  expect(passos.map(p => p.rotulo)).toEqual(["Fonte em raw/", "Leitura", "Takeaways", "Plano de páginas", "Escrita", "Índice, log e validação", "Sua revisão"]);
  expect(passos.map(p => p.estado)).toEqual(["atual", "falta", "falta", "falta", "falta", "falta", "falta"]);
});

test("Dado cada fase Quando desenho o painel Então o passo atual acompanha a fase e a parada marca Takeaways e Plano juntos", () => {
  expect(estados("fonte", "pronta")).toEqual(["feito", "atual", "falta", "falta", "falta", "falta", "falta"]);
  expect(estados("leitura", "rodando")).toEqual(["feito", "atual", "falta", "falta", "falta", "falta", "falta"]);
  expect(estados("parada", "esperando")).toEqual(["feito", "feito", "atual", "atual", "falta", "falta", "falta"]);
  expect(estados("escrita", "rodando")).toEqual(["feito", "feito", "feito", "feito", "atual", "falta", "falta"]);
  expect(estados("fechamento", "rodando")).toEqual(["feito", "feito", "feito", "feito", "feito", "atual", "falta"]);
  expect(estados("revisao", "concluida")).toEqual(["feito", "feito", "feito", "feito", "feito", "feito", "atual"]);
});

test("Dado uma fase que parou Quando desenho o painel Então o passo dela aparece parado", () => {
  expect(estados("leitura", "erro")).toEqual(["feito", "parou", "falta", "falta", "falta", "falta", "falta"]);
  expect(estados("escrita", "cancelada")).toEqual(["feito", "feito", "feito", "feito", "parou", "falta", "falta"]);
  expect(estados("revisao", "erro")).toEqual(["feito", "feito", "feito", "feito", "feito", "parou", "falta"]);
  expect(estados("leitura", "interrompida")[1]).toBe("parou");
});

test("Dado takeaways desmarcados Quando monto a resposta da pessoa Então ela diz o que fica de fora", () => {
  expect(textoDeSeguir([true, true, true], [true, true])).toBe("Pode seguir.");
  expect(textoDeSeguir([true, true, true, false, true], [true])).toBe("Pode seguir. Deixe de fora o takeaway 4.");
  expect(textoDeSeguir([false, true, false], [true, false, false])).toBe("Pode seguir. Deixe de fora os takeaways 1 e 3, e 2 páginas do plano.");
  expect(textoDeSeguir([true], [true, false])).toBe("Pode seguir. Deixe de fora 1 página do plano.");
  expect(textoDeSeguir([false, false, false, true], [true])).toBe("Pode seguir. Deixe de fora os takeaways 1, 2 e 3.");
});

test("Dado a saída do fechamento Quando resumo Então rascunhos esperando não viram erro", () => {
  expect(avisoDoFechamento({ codigo: 1, saida: "", rascunhos: 7, soRascunhos: true })).toEqual({ tipo: "rascunhos", texto: "7 rascunhos esperam você" });
  expect(avisoDoFechamento({ codigo: 1, saida: "", rascunhos: 1, soRascunhos: true })).toEqual({ tipo: "rascunhos", texto: "1 rascunho espera você" });
  expect(avisoDoFechamento({ codigo: 0, saida: "", rascunhos: 0, soRascunhos: false })).toEqual({ tipo: "ok", texto: "A validação passou" });
  expect(avisoDoFechamento({ codigo: 1, saida: "", rascunhos: 2, soRascunhos: false })).toEqual({ tipo: "erro", texto: "O fechamento encontrou problemas" });
});

test("Dado tamanhos de arquivo Quando mostro Então uso a unidade legível em português", () => {
  expect(tamanhoLegivel(900)).toBe("900 bytes");
  expect(tamanhoLegivel(12 * 1024)).toBe("12 KB");
  expect(tamanhoLegivel(1.5 * 1024 * 1024)).toBe("1,5 MB");
});

test("Dado a situação da conversa Quando decido se dá para ler de novo Então só fora de execução e antes da parada", () => {
  expect(podeLerDeNovo({ passo: "fonte", situacao: "pronta" } as never)).toBe(true);
  expect(podeLerDeNovo({ passo: "leitura", situacao: "erro" } as never)).toBe(true);
  expect(podeLerDeNovo({ passo: "leitura", situacao: "rodando" } as never)).toBe(false);
  expect(podeLerDeNovo({ passo: "parada", situacao: "esperando" } as never)).toBe(false);
});
