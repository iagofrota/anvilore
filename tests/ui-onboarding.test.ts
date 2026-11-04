import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  concluirOnboarding,
  estadoOnboarding,
  inicializarAreasOnboarding,
  inspecionarPasta,
  validarPastaVault,
} from "../src/lib/ui-onboarding";

let raiz: string;

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "anvilore-test-onboarding-"));
});

afterEach(() => {
  rmSync(raiz, { recursive: true, force: true });
});

test("Dado um vault sem wiki configurada Quando leio o estado do onboarding Então precisa de onboarding e aponta a etapa inicial", async () => {
  // Vault vazio ou só com exemplo
  mkdirSync(join(raiz, "wiki/exemplo"), { recursive: true });
  mkdirSync(join(raiz, "raw/exemplo"), { recursive: true });

  const estado = await estadoOnboarding(raiz);
  expect(estado.precisaOnboarding).toBe(true);
  expect(estado.concluido).toBe(false);
  expect(estado.pasta).toBe(raiz);
});

test("Dado um vault com wiki já pronta Quando leio o estado do onboarding Então informa que o onboarding não é necessário", async () => {
  mkdirSync(join(raiz, "wiki/pessoal/concepts"), { recursive: true });
  writeFileSync(join(raiz, "wiki/pessoal/index.md"), "# Pessoal\n");

  const estado = await estadoOnboarding(raiz);
  expect(estado.precisaOnboarding).toBe(false);
});

test("Dado o onboarding marcado como concluído em .anvilore Quando leio o estado Então não precisa de onboarding", async () => {
  mkdirSync(join(raiz, ".anvilore"), { recursive: true });
  writeFileSync(
    join(raiz, ".anvilore/onboarding.json"),
    JSON.stringify({ concluido: true, concluidoEm: "2026-11-01T12:00:00Z" }),
  );

  const estado = await estadoOnboarding(raiz);
  expect(estado.precisaOnboarding).toBe(false);
  expect(estado.concluido).toBe(true);
});

test("Dado um vault que já possui identidade registrada Quando leio o estado Então não precisa de onboarding", async () => {
  mkdirSync(join(raiz, ".anvilore"), { recursive: true });
  writeFileSync(join(raiz, ".anvilore/identidade"), "human:revisor\n");

  const estado = await estadoOnboarding(raiz);
  expect(estado.precisaOnboarding).toBe(false);
});

test("Dado uma pasta válida de vault Quando inspeciono a pasta Então relata o estado de wiki, raw, contratos e bun", async () => {
  mkdirSync(join(raiz, "wiki/exemplo"), { recursive: true });
  mkdirSync(join(raiz, "raw/exemplo"), { recursive: true });
  writeFileSync(join(raiz, "raw/exemplo/fonte.md"), "exemplo");
  writeFileSync(join(raiz, "SCHEMA.md"), "# Schema\n");
  writeFileSync(join(raiz, "AGENTS.md"), "# Agents\n");

  const inspecao = await inspecionarPasta(raiz);
  expect(inspecao.wiki.existe).toBe(true);
  expect(inspecao.wiki.detalhe).toContain("exemplo");
  expect(inspecao.raw.existe).toBe(true);
  expect(inspecao.contratos.existe).toBe(true);
  expect(inspecao.bun.existe).toBe(true);
});

test("Dado uma pasta que não existe Quando valido a pasta Então recusa com erro descritivo", async () => {
  const pastaInexistente = join(raiz, "pasta-que-nao-existe");
  expect(() => validarPastaVault(pastaInexistente)).toThrow(/não existe/i);
});

test("Dado uma pasta existente com conteúdo alheio sem kit Anvilore Quando valido a pasta Então recusa para não sobrescrever", async () => {
  const pastaAlheia = join(raiz, "pasta-alheia");
  mkdirSync(pastaAlheia, { recursive: true });
  writeFileSync(join(pastaAlheia, "documento-importante.docx"), "bytes");

  expect(() => validarPastaVault(pastaAlheia)).toThrow(/não pertencem/i);
});

test("Dado uma pasta vazia Quando valido a pasta Então aceita", async () => {
  const pastaVazia = join(raiz, "pasta-vazia");
  mkdirSync(pastaVazia, { recursive: true });

  expect(validarPastaVault(pastaVazia)).toBe(pastaVazia);
});

test("Dado uma lista de áreas válidas Quando inicializo áreas pelo onboarding Então executa o init real de forma idempotente e garante identidade automática sem campo de id", async () => {
  writeFileSync(join(raiz, "SCHEMA.md"), "# Schema\n");
  writeFileSync(join(raiz, "AGENTS.md"), "# Agents\n");

  const resultado = await inicializarAreasOnboarding(raiz, ["pessoal", "projetos"]);
  expect(resultado.criadas).toContain("pessoal");
  expect(resultado.criadas).toContain("projetos");
  expect(existsSync(join(raiz, "wiki/pessoal/sources"))).toBe(true);
  expect(existsSync(join(raiz, "wiki/projetos/concepts"))).toBe(true);

  // Identidade foi criada automaticamente em .anvilore/identidade
  expect(existsSync(join(raiz, ".anvilore/identidade"))).toBe(true);
  const idConteudo = readFileSync(join(raiz, ".anvilore/identidade"), "utf8").trim();
  expect(idConteudo).toMatch(/^human:[a-z0-9_-]+$/);

  // Idempotente: chamar de novo não lança erro
  const resultado2 = await inicializarAreasOnboarding(raiz, ["pessoal", "projetos"]);
  expect(resultado2.jaExistiam).toContain("pessoal");
  expect(resultado2.jaExistiam).toContain("projetos");
});

test("Dado a opção de remover o exemplo marcada Quando crio as áreas Então remove wiki/exemplo e atualiza o índice", async () => {
  mkdirSync(join(raiz, "wiki/exemplo"), { recursive: true });
  writeFileSync(join(raiz, "wiki/exemplo/index.md"), "# Exemplo\n");
  writeFileSync(join(raiz, "wiki/index.md"), "# Índice\n\n- [[exemplo/index|Exemplo]]\n");
  writeFileSync(join(raiz, "SCHEMA.md"), "# Schema\n");
  writeFileSync(join(raiz, "AGENTS.md"), "# Agents\n");

  await inicializarAreasOnboarding(raiz, ["pessoal"], { removerExemplo: true });
  expect(existsSync(join(raiz, "wiki/exemplo"))).toBe(false);
  const indice = readFileSync(join(raiz, "wiki/index.md"), "utf8");
  expect(indice).not.toContain("exemplo");
});

test("Dado caminho vazio, com caracteres de controle ou apontando para arquivo Quando valido a pasta Então recusa com erro", () => {
  expect(() => validarPastaVault("")).toThrow(/vazio/i);
  expect(() => validarPastaVault("\u0000")).toThrow(/inválidos/i);
  const arquivo = join(raiz, "arquivo.txt");
  writeFileSync(arquivo, "texto");
  expect(() => validarPastaVault(arquivo)).toThrow(/não é um diretório/i);
});

test("Dado pasta com variações de contratos e pastas vazias Quando inspeciono Então detalha adequadamente", async () => {
  const pasta = join(raiz, "variacoes");
  mkdirSync(join(pasta, "wiki"), { recursive: true });
  mkdirSync(join(pasta, "raw"), { recursive: true });
  writeFileSync(join(pasta, "SCHEMA.md"), "# Schema\n");

  const insp1 = await inspecionarPasta(pasta);
  expect(insp1.wiki.detalhe).toContain("pasta criada, sem áreas");
  expect(insp1.raw.detalhe).toContain("pasta criada, sem fontes");
  expect(insp1.contratos.detalhe).toContain("apenas SCHEMA.md");

  rmSync(join(pasta, "SCHEMA.md"));
  writeFileSync(join(pasta, "AGENTS.md"), "# Agents\n");
  const insp2 = await inspecionarPasta(pasta);
  expect(insp2.contratos.detalhe).toContain("apenas AGENTS.md");

  rmSync(join(pasta, "AGENTS.md"));
  const insp3 = await inspecionarPasta(pasta);
  expect(insp3.contratos.detalhe).toContain("contratos ausentes");
});

test("Dado a conclusão do onboarding Quando gravo o término Então salva em .anvilore/onboarding.json fora do git", async () => {
  await concluirOnboarding(raiz);
  expect(existsSync(join(raiz, ".anvilore/onboarding.json"))).toBe(true);
  const conteudo = JSON.parse(readFileSync(join(raiz, ".anvilore/onboarding.json"), "utf8")) as Record<string, unknown>;
  expect(conteudo.concluido).toBe(true);
  expect(typeof conteudo.concluidoEm).toBe("string");
});
