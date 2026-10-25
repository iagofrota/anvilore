import { expect, test } from "bun:test";
import { fundirBloco } from "../src/lib/fundir-bloco";

test("Dado texto de quem usa Quando acrescento bloco Então preserva texto e converge", () => {
  const obtido = fundirBloco("modelo = 'meu'", "anvilore", "novo\n\n", "#");
  expect(obtido).toEqual({ resultado: "modelo = 'meu'\n\n# <<< anvilore\nnovo\n# >>> anvilore\n", veredito: "MUDOU" });
  expect(fundirBloco(obtido.resultado, "anvilore", "novo", "#")).toEqual({ ...obtido, veredito: "INALTERADO" });
});

test("Dado bloco entre preferências com CRLF Quando atualizo Então preserva bytes fora dos marcadores", () => {
  expect(fundirBloco("antes\r\n# <<< x\r\nantigo\r\n# >>> x\r\ndepois\r\n", "x", "novo", "#").resultado)
    .toBe("antes\r\n# <<< x\nnovo\n# >>> x\ndepois\r\n");
});

test("Dado texto vazio ou marcador incompleto Quando fundo Então acrescenta como o original", () => {
  expect(fundirBloco("", "x", "a", "//").resultado).toBe("// <<< x\na\n// >>> x\n");
  expect(fundirBloco("# <<< x\nmeu\n", "x", "novo", "#").resultado)
    .toBe("# <<< x\nmeu\n\n# <<< x\nnovo\n# >>> x\n");
});
