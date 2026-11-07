import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  concluirOnboarding,
  estadoOnboarding,
  inicializarAreasOnboarding,
  inspecionarPasta,
  removerSecaoExemploDoIndice,
  validarPastaVault,
} from "../src/lib/ui-onboarding";

let raiz: string;

beforeEach(() => {
  raiz = mkdtempSync(join(homedir(), "anvilore-test-onboarding-"));
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

test("Dado um vault com wiki já pronta antiga (sem onboarding.json) Quando leio o estado do onboarding Então informa que o onboarding não é necessário", async () => {
  mkdirSync(join(raiz, "wiki/pessoal/concepts"), { recursive: true });
  writeFileSync(join(raiz, "wiki/pessoal/index.md"), "# Pessoal\n");
  mkdirSync(join(raiz, ".anvilore"), { recursive: true });
  writeFileSync(join(raiz, ".anvilore/identidade"), "human:revisor\n");
  writeFileSync(join(raiz, "SCHEMA.md"), "# Schema\n");

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

test("Dado onboarding em andamento ({ concluido: false }) Quando áreas e identidade já foram criadas Então precisaOnboarding continua true até o O4", async () => {
  mkdirSync(join(raiz, "wiki/pessoal/concepts"), { recursive: true });
  writeFileSync(join(raiz, "wiki/pessoal/index.md"), "# Pessoal\n");
  mkdirSync(join(raiz, ".anvilore"), { recursive: true });
  writeFileSync(join(raiz, ".anvilore/identidade"), "human:revisor\n");
  writeFileSync(join(raiz, "SCHEMA.md"), "# Schema\n");
  writeFileSync(
    join(raiz, ".anvilore/onboarding.json"),
    JSON.stringify({ concluido: false }),
  );

  const estado = await estadoOnboarding(raiz);
  expect(estado.precisaOnboarding).toBe(true);
  expect(estado.concluido).toBe(false);
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

test("Dado uma pasta que não existe ainda no homedir Quando valido a pasta Então recusa pois não é cofre inicializado", () => {
  const pastaInexistente = join(raiz, "minha-nova-wiki");
  expect(() => validarPastaVault(pastaInexistente)).toThrow("Esta pasta ainda não é um cofre do Anvilore.");
  expect(existsSync(pastaInexistente)).toBe(false);
});

test("Dado uma pasta existente vazia Quando valido a pasta Então recusa pois não é cofre inicializado", () => {
  const pastaVazia = join(raiz, "pasta-vazia");
  mkdirSync(pastaVazia, { recursive: true });

  expect(() => validarPastaVault(pastaVazia)).toThrow("Esta pasta ainda não é um cofre do Anvilore.");
  expect(existsSync(join(pastaVazia, ".anvilore"))).toBe(false);
});

test("Dado um projeto React alheio com package.json Quando valido a pasta Então recusa com mensagem simples e nada é gravado", () => {
  const pastaReact = join(raiz, "meu-app-react");
  mkdirSync(pastaReact, { recursive: true });
  writeFileSync(join(pastaReact, "package.json"), JSON.stringify({ name: "meu-app-react" }));
  writeFileSync(join(pastaReact, "index.tsx"), "export default () => <div>App</div>;");

  expect(() => validarPastaVault(pastaReact)).toThrow(
    "Esta pasta ainda não é um cofre do Anvilore.",
  );
  expect(existsSync(join(pastaReact, "SCHEMA.md"))).toBe(false);
  expect(existsSync(join(pastaReact, "wiki"))).toBe(false);
  expect(existsSync(join(pastaReact, ".anvilore"))).toBe(false);
});

test("Dado pasta com SCHEMA.md e wiki/ mas sem AGENTS.md Quando valido a pasta Então recusa pois falta contrato do agente", () => {
  const pastaSemAgents = join(raiz, "sem-agents");
  mkdirSync(join(pastaSemAgents, "wiki"), { recursive: true });
  writeFileSync(join(pastaSemAgents, "SCHEMA.md"), "# Schema\n");

  expect(() => validarPastaVault(pastaSemAgents)).toThrow("Esta pasta ainda não é um cofre do Anvilore.");
});

test("Dado um vault Anvilore existente com SCHEMA.md, AGENTS.md e wiki/ Quando valido a pasta Então aceita", () => {
  const pastaVault = join(raiz, "meu-vault");
  mkdirSync(join(pastaVault, "wiki"), { recursive: true });
  writeFileSync(join(pastaVault, "SCHEMA.md"), "# Schema\n");
  writeFileSync(join(pastaVault, "AGENTS.md"), "# Agents\n");

  expect(validarPastaVault(pastaVault)).toBe(pastaVault);
});

test("Dado caminho com segmentos '..' Quando valido a pasta Então recusa", () => {
  const caminhoComDotDot = `${raiz}/sub/../outro`;
  expect(() => validarPastaVault(caminhoComDotDot)).toThrow(/segmentos '\.\.'/i);
});

test("Dado diretórios de sistema fora do homedir (/srv e /var/opt) Quando valido a pasta Então recusa", () => {
  expect(() => validarPastaVault("/srv")).toThrow(/pasta pessoal/i);
  expect(() => validarPastaVault("/var/opt")).toThrow(/pasta pessoal/i);
});

test("Dado um symlink Quando valido a pasta Então recusa", () => {
  const alvo = join(raiz, "alvo");
  mkdirSync(alvo, { recursive: true });
  const link = join(raiz, "link-para-alvo");
  try {
    symlinkSync(alvo, link, "dir");
    expect(() => validarPastaVault(link)).toThrow(/links simbólicos/i);
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code !== "EPERM") throw erro;
  }
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

test("Dado wiki/index.md apontando para raw Quando removo o exemplo Então recusa e preserva os bytes da fonte", async () => {
  const fonte = join(raiz, "raw/original.md");
  mkdirSync(join(raiz, "raw"), { recursive: true });
  const bytes = Buffer.from("# Fonte original\r\nconteúdo preservado\n");
  writeFileSync(fonte, bytes);
  mkdirSync(join(raiz, "wiki/exemplo"), { recursive: true });
  symlinkSync(fonte, join(raiz, "wiki/index.md"));
  writeFileSync(join(raiz, "SCHEMA.md"), "# Schema\n");
  writeFileSync(join(raiz, "AGENTS.md"), "# Agents\n");

  await expect(inicializarAreasOnboarding(raiz, ["pessoal"], { removerExemplo: true })).rejects.toThrow();
  expect(readFileSync(fonte)).toEqual(bytes);
});

test("Dado wiki/exemplo apontando para raw Quando removo o exemplo Então recusa e preserva a pasta bruta", async () => {
  const bruto = join(raiz, "raw/pasta");
  mkdirSync(bruto, { recursive: true });
  const fonte = join(bruto, "original.md");
  const bytes = Buffer.from("conteúdo bruto\r\n");
  writeFileSync(fonte, bytes);
  mkdirSync(join(raiz, "wiki"), { recursive: true });
  symlinkSync(bruto, join(raiz, "wiki/exemplo"), "dir");
  writeFileSync(join(raiz, "wiki/index.md"), "# Índice\n");
  writeFileSync(join(raiz, "SCHEMA.md"), "# Schema\n");
  writeFileSync(join(raiz, "AGENTS.md"), "# Agents\n");

  await expect(inicializarAreasOnboarding(raiz, ["pessoal"], { removerExemplo: true })).rejects.toThrow();
  expect(readFileSync(fonte)).toEqual(bytes);
  expect(existsSync(join(raiz, "wiki/exemplo"))).toBe(true);
});

test("Dado um índice com exemplo-cliente e exemplo Quando removo o exemplo Então apaga apenas a área exata", () => {
  const indice = `# Índice

## Área: exemplo-cliente

- [[exemplo-cliente/pagina]] — área cliente

## Área: exemplo

- [[exemplo/pagina]] — área de demonstração
`;

  const atualizado = removerSecaoExemploDoIndice(indice);
  expect(atualizado).toContain("## Área: exemplo-cliente");
  expect(atualizado).toContain("[[exemplo-cliente/pagina]]");
  expect(atualizado).not.toContain("## Área: exemplo\n");
  expect(atualizado).not.toContain("[[exemplo/pagina]]");
});

test("Dado índice com instruções e outras áreas Quando remove a seção de exemplo Então preserva prosa explicativa e remove apenas a seção de exemplo com subcabeçalhos", () => {
  const indiceOriginal = `# Índice

Páginas desta wiki. Mantido pelo agente.

Use o formato do exemplo abaixo:

## Área: exemplo

### Conceitos

- [[area-tematica]] — o que é uma área temática (página de exemplo do esqueleto)

## Área: projetos

- [[exemplos-de-arquitetura]] — modelos reais
`;

  const indiceLimpo = removerSecaoExemploDoIndice(indiceOriginal);
  expect(indiceLimpo).toContain("Use o formato do exemplo abaixo:");
  expect(indiceLimpo).not.toContain("## Área: exemplo");
  expect(indiceLimpo).not.toContain("### Conceitos");
  expect(indiceLimpo).not.toContain("[[area-tematica]]");
  expect(indiceLimpo).toContain("## Área: projetos");
  expect(indiceLimpo).toContain("[[exemplos-de-arquitetura]]");
});

test("Dado modelos/wiki/index.md real Quando inicializo com removerExemplo true Então preserva a prosa com 'exemplo abaixo' e remove a seção", async () => {
  const modeloIndice = readFileSync(join(import.meta.dir, "../modelos/wiki/index.md"), "utf8");
  mkdirSync(join(raiz, "wiki/exemplo"), { recursive: true });
  writeFileSync(join(raiz, "wiki/index.md"), modeloIndice);
  writeFileSync(join(raiz, "SCHEMA.md"), "# Schema\n");
  writeFileSync(join(raiz, "AGENTS.md"), "# Agents\n");

  await inicializarAreasOnboarding(raiz, ["pessoal"], { removerExemplo: true });
  const indice = readFileSync(join(raiz, "wiki/index.md"), "utf8");
  expect(indice).toContain("no formato do exemplo abaixo");
  expect(indice).not.toContain("## Área: exemplo");
  expect(indice).not.toContain("### Conceitos");
  expect(indice).not.toContain("[[area-tematica]]");
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

test("Dado onboarding.json apontando para raw Quando concluo o onboarding Então recusa e preserva os bytes brutos", async () => {
  mkdirSync(join(raiz, ".anvilore"), { recursive: true });
  mkdirSync(join(raiz, "raw"), { recursive: true });
  const fonte = join(raiz, "raw/original.json");
  const bytes = Buffer.from("{\r\n  \"fonte\": \"intacta\"\n}\n");
  writeFileSync(fonte, bytes);
  symlinkSync(fonte, join(raiz, ".anvilore/onboarding.json"));

  await expect(concluirOnboarding(raiz)).rejects.toThrow();
  expect(readFileSync(fonte)).toEqual(bytes);
});
