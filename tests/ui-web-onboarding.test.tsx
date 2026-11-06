import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { hashDaRota, lerRota } from "../ui/web/navegacao";
import {
  Onboarding,
  PainelDoOnboarding,
  criarAcoesDoOnboarding,
  type AcoesDoOnboarding,
  type ContextoAcoesDoOnboarding,
} from "../ui/web/onboarding";
import { achar, botao, expandir } from "./apoio/react-estatico";

test("Dado rota de onboarding Quando leio o hash Então mapeia para etapa 1 a 4", () => {
  expect(lerRota("#/onboarding")).toEqual({ tela: "onboarding", passo: 1 });
  expect(lerRota("#/onboarding/1")).toEqual({ tela: "onboarding", passo: 1 });
  expect(lerRota("#/onboarding/2")).toEqual({ tela: "onboarding", passo: 2 });
  expect(lerRota("#/onboarding/3")).toEqual({ tela: "onboarding", passo: 3 });
  expect(lerRota("#/onboarding/4")).toEqual({ tela: "onboarding", passo: 4 });
});

test("Dado objeto de rota de onboarding Quando calculo o hash Então gera o caminho com o passo", () => {
  expect(hashDaRota({ tela: "onboarding", passo: 1 })).toBe("#/onboarding/1");
  expect(hashDaRota({ tela: "onboarding", passo: 2 })).toBe("#/onboarding/2");
  expect(hashDaRota({ tela: "onboarding", passo: 3 })).toBe("#/onboarding/3");
  expect(hashDaRota({ tela: "onboarding", passo: 4 })).toBe("#/onboarding/4");
});

test("Dado etapa 1 do onboarding Quando renderizo Então exibe pasta do vault e inspeção", () => {
  const conteudo = renderToStaticMarkup(
    <Onboarding
      passo={1}
      tema="claro"
      alternarTema={() => {}}
      dados={{
        precisaOnboarding: true,
        concluido: false,
        etapa: 1,
        pasta: "/home/teste/vault",
        inspecao: {
          wiki: { existe: true, detalhe: "só a área de exemplo" },
          raw: { existe: true, detalhe: "1 fonte de exemplo" },
          contratos: { existe: true, detalhe: "os dois contratos" },
          bun: { existe: true, detalhe: "no PATH: validador e hook rodam" },
        },
        agente: {
          nome: "Claude Code",
          disponivel: true,
          versao: "2.1.311",
          travas: [],
        },
        areas: {
          padrao: ["pessoal", "profissional", "projetos-paralelos", "saude"],
          existentes: [],
          temExemplo: true,
        },
        primeiraIngestao: {
          exemploDisponivel: true,
          caminho: "raw/exemplo/llm-wiki.md",
        },
      }}
    />,
  );
  expect(conteudo).toContain("Abra a pasta da sua wiki");
  expect(conteudo).toContain("/home/teste/vault");
  expect(conteudo).toContain("wiki/");
  expect(conteudo).toContain("Continuar");
});

test("Dado etapa 2 do onboarding Quando renderizo Então exibe conexão do agente sem campo de chave de API", () => {
  const conteudo = renderToStaticMarkup(
    <Onboarding
      passo={2}
      tema="claro"
      alternarTema={() => {}}
      dados={{
        precisaOnboarding: true,
        concluido: false,
        etapa: 2,
        pasta: "/home/teste/vault",
        inspecao: {
          wiki: { existe: true, detalhe: "só a área de exemplo" },
          raw: { existe: true, detalhe: "1 fonte de exemplo" },
          contratos: { existe: true, detalhe: "os dois contratos" },
          bun: { existe: true, detalhe: "no PATH: validador e hook rodam" },
        },
        agente: {
          nome: "Claude Code",
          disponivel: true,
          versao: "2.1.311",
          travas: [
            { nome: "Hook que protege raw/", ligada: true },
            { nome: "Skills ingest, query e lint", ligada: true },
            { nome: "Validador", ligada: true },
            { nome: "Validação no CI", ligada: false, opcional: true },
          ],
        },
        areas: {
          padrao: ["pessoal", "profissional", "projetos-paralelos", "saude"],
          existentes: [],
          temExemplo: true,
        },
        primeiraIngestao: {
          exemploDisponivel: true,
          caminho: "raw/exemplo/llm-wiki.md",
        },
      }}
    />,
  );
  expect(conteudo).toContain("Conecte o seu agente");
  expect(conteudo).toContain("Claude Code");
  expect(conteudo).toContain("Hook que protege raw/");
  expect(conteudo).toContain("O Anvilore não pede nem guarda chave de API");
  expect(conteudo).not.toContain('type="password"');
  expect(conteudo).not.toContain("sk-ant-");
});

test("Dado etapa 3 do onboarding Quando renderizo Então exibe áreas e SEM campo de revisor id", () => {
  const conteudo = renderToStaticMarkup(
    <Onboarding
      passo={3}
      tema="claro"
      alternarTema={() => {}}
      dados={{
        precisaOnboarding: true,
        concluido: false,
        etapa: 3,
        pasta: "/home/teste/vault",
        inspecao: {
          wiki: { existe: true, detalhe: "só a área de exemplo" },
          raw: { existe: true, detalhe: "1 fonte de exemplo" },
          contratos: { existe: true, detalhe: "os dois contratos" },
          bun: { existe: true, detalhe: "no PATH: validador e hook rodam" },
        },
        agente: {
          nome: "Claude Code",
          disponivel: true,
          versao: "2.1.311",
          travas: [],
        },
        areas: {
          padrao: ["pessoal", "profissional", "projetos-paralelos", "saude"],
          existentes: [],
          temExemplo: true,
        },
        primeiraIngestao: {
          exemploDisponivel: true,
          caminho: "raw/exemplo/llm-wiki.md",
        },
      }}
    />,
  );
  expect(conteudo).toContain("Você e suas áreas");
  expect(conteudo).toContain("pessoal");
  expect(conteudo).toContain("profissional");
  expect(conteudo).toContain("Remover a área de exemplo");
  // SEM CAMPO DE ID!
  expect(conteudo).not.toContain("Seu identificador de revisor");
  expect(conteudo).not.toContain("human:iago");
});

test("Dado etapa 4 do onboarding Quando renderizo Então exibe primeira ingestão e pular por agora", () => {
  const conteudo = renderToStaticMarkup(
    <Onboarding
      passo={4}
      tema="claro"
      alternarTema={() => {}}
      dados={{
        precisaOnboarding: true,
        concluido: false,
        etapa: 4,
        pasta: "/home/teste/vault",
        inspecao: {
          wiki: { existe: true, detalhe: "só a área de exemplo" },
          raw: { existe: true, detalhe: "1 fonte de exemplo" },
          contratos: { existe: true, detalhe: "os dois contratos" },
          bun: { existe: true, detalhe: "no PATH: validador e hook rodam" },
        },
        agente: {
          nome: "Claude Code",
          disponivel: true,
          versao: "2.1.311",
          travas: [],
        },
        areas: {
          padrao: ["pessoal", "profissional", "projetos-paralelos", "saude"],
          existentes: [],
          temExemplo: true,
        },
        primeiraIngestao: {
          exemploDisponivel: true,
          caminho: "raw/exemplo/llm-wiki.md",
        },
      }}
    />,
  );
  expect(conteudo).toContain("Faça a primeira ingestão");
  expect(conteudo).toContain("LLM Wiki");
  expect(conteudo).toContain("Pular por agora");
});

test("Dado etapa 4 do onboarding com exemploDisponivel false Quando renderizo Então não exibe o cartão da fonte de exemplo", () => {
  const conteudo = renderToStaticMarkup(
    <Onboarding
      passo={4}
      tema="claro"
      alternarTema={() => {}}
      dados={{
        precisaOnboarding: true,
        concluido: false,
        etapa: 4,
        pasta: "/home/teste/vault",
        inspecao: {
          wiki: { existe: true, detalhe: "sem áreas" },
          raw: { existe: false, detalhe: "sem raw" },
          contratos: { existe: true, detalhe: "os dois contratos" },
          bun: { existe: true, detalhe: "no PATH" },
        },
        agente: {
          nome: "Claude Code",
          disponivel: true,
          versao: "2.1.311",
          travas: [],
        },
        areas: {
          padrao: ["pessoal"],
          existentes: [],
          temExemplo: false,
        },
        primeiraIngestao: {
          exemploDisponivel: false,
          caminho: "raw/exemplo/llm-wiki.md",
        },
      }}
    />,
  );
  expect(conteudo).toContain("Faça a primeira ingestão");
  expect(conteudo).not.toContain("LLM Wiki");
  expect(conteudo).not.toContain("raw/exemplo/llm-wiki.md");
});

test("Dado PainelDoOnboarding com estados de erro e carregamento Quando renderizo Então exibe mensagens de erro e desabilita botões", () => {
  const dadosBase = {
    precisaOnboarding: true,
    concluido: false,
    etapa: 1,
    pasta: "/caminho/invalido",
    inspecao: {
      wiki: { existe: false, detalhe: "não encontrada" },
      raw: { existe: false, detalhe: "não encontrada" },
      contratos: { existe: false, detalhe: "não encontrados" },
      bun: { existe: false, detalhe: "não encontrado" },
    },
    agente: {
      nome: "Claude Code",
      disponivel: false,
      versao: undefined,
      travas: [],
    },
    areas: {
      padrao: ["pessoal"],
      existentes: [],
      temExemplo: false,
    },
    primeiraIngestao: {
      exemploDisponivel: false,
      caminho: "raw/exemplo/llm-wiki.md",
    },
  };

  const acoesChamadas: string[] = [];
  const acoes: AcoesDoOnboarding = {
    aoMudarPasta: () => acoesChamadas.push("aoMudarPasta"),
    aoConfirmarPasta: () => acoesChamadas.push("aoConfirmarPasta"),
    aoTestarAgente: () => acoesChamadas.push("aoTestarAgente"),
    aoMudarNovaArea: () => acoesChamadas.push("aoMudarNovaArea"),
    aoAlternarArea: () => acoesChamadas.push("aoAlternarArea"),
    aoAdicionarArea: () => acoesChamadas.push("aoAdicionarArea"),
    aoAlternarRemoverExemplo: () => acoesChamadas.push("aoAlternarRemoverExemplo"),
    aoCriarAreas: () => acoesChamadas.push("aoCriarAreas"),
    aoConcluir: (destino) => acoesChamadas.push(`aoConcluir:${destino}`),
    aoNavegar: (p) => acoesChamadas.push(`aoNavegar:${p}`),
  };

  // Passo 1 com erro e carregamento
  const htmlP1 = renderToStaticMarkup(
    <PainelDoOnboarding
      passo={1}
      dados={dadosBase}
      pasta="/caminho/invalido"
      erroPasta="A pasta não existe"
      carregandoPasta={true}
      testandoAgente={false}
      resultadoTeste={null}
      sucessoTeste={null}
      areasSelecionadas={[]}
      novaArea=""
      removerExemplo={false}
      criandoAreas={false}
      erroAreas={null}
      concluindo={false}
      acoes={acoes}
    />,
  );
  expect(htmlP1).toContain("A pasta não existe");
  expect(htmlP1).toContain('disabled=""');

  // Passo 2 com teste falho do agente
  const htmlP2 = renderToStaticMarkup(
    <PainelDoOnboarding
      passo={2}
      dados={dadosBase}
      pasta="/caminho/invalido"
      erroPasta={null}
      carregandoPasta={false}
      testandoAgente={false}
      resultadoTeste="Claude Code não encontrado no PATH"
      sucessoTeste={false}
      areasSelecionadas={[]}
      novaArea=""
      removerExemplo={false}
      criandoAreas={false}
      erroAreas={null}
      concluindo={false}
      acoes={acoes}
    />,
  );
  expect(htmlP2).toContain("Claude Code não encontrado");
  expect(htmlP2).toContain("ausente");

  // Passo 3 com erro ao criar áreas
  const htmlP3 = renderToStaticMarkup(
    <PainelDoOnboarding
      passo={3}
      dados={dadosBase}
      pasta="/caminho/invalido"
      erroPasta={null}
      carregandoPasta={false}
      testandoAgente={false}
      resultadoTeste={null}
      sucessoTeste={null}
      areasSelecionadas={["trabalho"]}
      novaArea="estudos"
      removerExemplo={true}
      criandoAreas={true}
      erroAreas="Falha ao inicializar pastas"
      concluindo={false}
      acoes={acoes}
    />,
  );
  expect(htmlP3).toContain("Falha ao inicializar pastas");
  expect(htmlP3).toContain("Criando áreas");

  // Passo 4 com ação de concluir
  const htmlP4 = renderToStaticMarkup(
    <PainelDoOnboarding
      passo={4}
      dados={dadosBase}
      pasta="/caminho/invalido"
      erroPasta={null}
      carregandoPasta={false}
      testandoAgente={false}
      resultadoTeste={null}
      sucessoTeste={null}
      areasSelecionadas={[]}
      novaArea=""
      removerExemplo={false}
      criandoAreas={false}
      erroAreas={null}
      concluindo={true}
      acoes={acoes}
    />,
  );
  expect(htmlP4).toContain('disabled=""');

  // Invocar callbacks diretamente para assegurar contrato de tipos e funções
  acoes.aoMudarPasta("/nova");
  acoes.aoConfirmarPasta();
  acoes.aoTestarAgente();
  acoes.aoMudarNovaArea("financas");
  acoes.aoAlternarArea("pessoal");
  acoes.aoAdicionarArea();
  acoes.aoAlternarRemoverExemplo(true);
  acoes.aoCriarAreas();
  acoes.aoConcluir("upload");
  acoes.aoNavegar(2);

  expect(acoesChamadas).toEqual([
    "aoMudarPasta",
    "aoConfirmarPasta",
    "aoTestarAgente",
    "aoMudarNovaArea",
    "aoAlternarArea",
    "aoAdicionarArea",
    "aoAlternarRemoverExemplo",
    "aoCriarAreas",
    "aoConcluir:upload",
    "aoNavegar:2",
  ]);
});

test("Dado criarAcoesDoOnboarding Quando executo aoConfirmarPasta com sucesso ou erro Então trata carregamento e rotas", async () => {
  let carregando = false;
  let erro: string | null = null;
  let navegou = "";
  let atualizou = false;
  let pastaSalva = "";

  const mockApiSucesso = (async (rota: string, _metodo?: string, _corpo?: unknown) => {
    return { ok: true, pasta: "/meu/vault/confirmado" };
  }) as never;

  const ctx: ContextoAcoesDoOnboarding = {
    pasta: "/meu/vault",
    setPasta: p => { pastaSalva = p; },
    setCarregandoPasta: v => { carregando = v; },
    setErroPasta: v => { erro = v; },
    setTestandoAgente: () => {},
    setResultadoTeste: () => {},
    setSucessoTeste: () => {},
    areasSelecionadas: ["pessoal"],
    setAreasSelecionadas: () => {},
    novaArea: "",
    setNovaArea: () => {},
    removerExemplo: false,
    setRemoverExemplo: () => {},
    setCriandoAreas: () => {},
    setErroAreas: () => {},
    setConcluindo: () => {},
    aoAtualizar: async () => { atualizou = true; },
    navegar: h => { navegou = h; },
    chamarApi: mockApiSucesso,
  };

  const acoes = criarAcoesDoOnboarding(ctx);
  await acoes.aoConfirmarPasta();
  expect(carregando).toBe(false);
  expect(erro).toBeNull();
  expect(pastaSalva).toBe("/meu/vault/confirmado");
  expect(atualizou).toBe(true);
  expect(navegou).toBe("#/onboarding/2");

  // Caso com erro na API
  const mockApiErro = (async () => {
    throw new Error("Pasta inválida.");
  }) as never;

  const acoesErro = criarAcoesDoOnboarding({ ...ctx, chamarApi: mockApiErro });
  await acoesErro.aoConfirmarPasta();
  expect<unknown>(erro).toBe("Pasta inválida.");
});

test("Dado criarAcoesDoOnboarding Quando executo aoTestarAgente Então trata sucesso, retorno com erro e exceção", async () => {
  let testando = false;
  let sucesso: boolean | null = null;
  let resultado: string | null = null;

  const ctx: ContextoAcoesDoOnboarding = {
    pasta: "/vault",
    setPasta: () => {},
    setCarregandoPasta: () => {},
    setErroPasta: () => {},
    setTestandoAgente: v => { testando = v; },
    setResultadoTeste: v => { resultado = v; },
    setSucessoTeste: v => { sucesso = v; },
    areasSelecionadas: [],
    setAreasSelecionadas: () => {},
    novaArea: "",
    setNovaArea: () => {},
    removerExemplo: false,
    setRemoverExemplo: () => {},
    setCriandoAreas: () => {},
    setErroAreas: () => {},
    setConcluindo: () => {},
  };

  // Sucesso ok: true
  const acoesSucesso = criarAcoesDoOnboarding({
    ...ctx,
    chamarApi: (async () => ({ ok: true, mensagem: "Agente conectado." })) as never,
  });
  await acoesSucesso.aoTestarAgente();
  expect(testando).toBe(false);
  expect<unknown>(sucesso).toBe(true);
  expect<unknown>(resultado).toBe("Agente conectado.");

  // Resposta com ok: false
  const acoesFalha = criarAcoesDoOnboarding({
    ...ctx,
    chamarApi: (async () => ({ ok: false, mensagem: "Ausente no PATH." })) as never,
  });
  await acoesFalha.aoTestarAgente();
  expect<unknown>(sucesso).toBe(false);
  expect<unknown>(resultado).toBe("Ausente no PATH.");

  // Exceção na chamada
  const acoesExcecao = criarAcoesDoOnboarding({
    ...ctx,
    chamarApi: (async () => { throw new Error("Erro de rede"); }) as never,
  });
  await acoesExcecao.aoTestarAgente();
  expect<unknown>(sucesso).toBe(false);
  expect<unknown>(resultado).toBe("Erro de rede");
});

test("Dado criarAcoesDoOnboarding Quando manipulo áreas e exemplo Então adiciona, alterna e atualiza estados", () => {
  let nova = "";
  let areas = ["pessoal"];
  let exemplo = true;

  const ctx: ContextoAcoesDoOnboarding = {
    pasta: "/vault",
    setPasta: () => {},
    setCarregandoPasta: () => {},
    setErroPasta: () => {},
    setTestandoAgente: () => {},
    setResultadoTeste: () => {},
    setSucessoTeste: () => {},
    areasSelecionadas: areas,
    setAreasSelecionadas: (fn: any) => {
      areas = typeof fn === "function" ? fn(areas) : fn;
    },
    novaArea: "estudos",
    setNovaArea: v => { nova = v; },
    removerExemplo: exemplo,
    setRemoverExemplo: v => { exemplo = v; },
    setCriandoAreas: () => {},
    setErroAreas: () => {},
    setConcluindo: () => {},
  };

  const acoes = criarAcoesDoOnboarding(ctx);
  acoes.aoMudarNovaArea("cursos");
  expect(nova).toBe("cursos");

  // Alternar área existente (remove)
  acoes.aoAlternarArea("pessoal");
  expect(areas).toEqual([]);

  // Alternar área nova (adiciona)
  acoes.aoAlternarArea("trabalho");
  expect(areas).toEqual(["trabalho"]);

  // Adicionar área a partir de novaArea limpa
  acoes.aoAdicionarArea();
  expect(areas).toContain("estudos");
  expect(nova).toBe("");

  // Adicionar quando já existe ou vazia não duplica
  const acoesSemNova = criarAcoesDoOnboarding({ ...ctx, novaArea: "   ", areasSelecionadas: areas });
  acoesSemNova.aoAdicionarArea();
  expect(areas).toEqual(["trabalho", "estudos"]);

  acoes.aoAlternarRemoverExemplo(false);
  expect(exemplo).toBe(false);
});

test("Dado criarAcoesDoOnboarding Quando crio áreas Então valida seleção mínima e navega", async () => {
  let criando = false;
  let erroAreas: string | null = null;
  let navegou = "";
  let atualizou = false;
  let atualizouIngestao = false;

  const ctx: ContextoAcoesDoOnboarding = {
    pasta: "/vault",
    setPasta: () => {},
    setCarregandoPasta: () => {},
    setErroPasta: () => {},
    setTestandoAgente: () => {},
    setResultadoTeste: () => {},
    setSucessoTeste: () => {},
    areasSelecionadas: [],
    setAreasSelecionadas: () => {},
    novaArea: "",
    setNovaArea: () => {},
    removerExemplo: true,
    setRemoverExemplo: () => {},
    setCriandoAreas: v => { criando = v; },
    setErroAreas: v => { erroAreas = v; },
    setConcluindo: () => {},
    aoAtualizar: async () => { atualizou = true; },
    aoAtualizarIngestao: async () => { atualizouIngestao = true; },
    navegar: h => { navegou = h; },
  };

  // Sem seleção
  const acoesVazias = criarAcoesDoOnboarding(ctx);
  await acoesVazias.aoCriarAreas();
  expect<unknown>(erroAreas).toContain("pelo menos uma");

  // Com seleção e sucesso
  const acoesSucesso = criarAcoesDoOnboarding({
    ...ctx,
    areasSelecionadas: ["pessoal"],
    chamarApi: (async () => ({ ok: true })) as never,
  });
  await acoesSucesso.aoCriarAreas();
  expect(criando).toBe(false);
  expect(atualizou).toBe(true);
  expect(atualizouIngestao).toBe(true);
  expect(navegou).toBe("#/onboarding/4");

  // Com seleção e erro na API
  const acoesErro = criarAcoesDoOnboarding({
    ...ctx,
    areasSelecionadas: ["pessoal"],
    chamarApi: (async () => { throw new Error("Falha no init"); }) as never,
  });
  await acoesErro.aoCriarAreas();
  expect<unknown>(erroAreas).toBe("Falha no init");
});

test("Dado criarAcoesDoOnboarding Quando concluo ou navego Então persiste e direciona", async () => {
  let concluindo = false;
  let destinoNavegado = "";

  const ctx: ContextoAcoesDoOnboarding = {
    pasta: "/vault",
    setPasta: () => {},
    setCarregandoPasta: () => {},
    setErroPasta: () => {},
    setTestandoAgente: () => {},
    setResultadoTeste: () => {},
    setSucessoTeste: () => {},
    areasSelecionadas: [],
    setAreasSelecionadas: () => {},
    novaArea: "",
    setNovaArea: () => {},
    removerExemplo: false,
    setRemoverExemplo: () => {},
    setCriandoAreas: () => {},
    setErroAreas: () => {},
    setConcluindo: v => { concluindo = v; },
    navegar: h => { destinoNavegado = h; },
    chamarApi: (async () => ({ ok: true })) as never,
  };

  const acoes = criarAcoesDoOnboarding(ctx);
  await acoes.aoConcluir("#/inicio");
  expect(concluindo).toBe(false);
  expect(destinoNavegado).toBe("#/inicio");

  // Falha na API de concluir ainda navega para não prender o usuário
  const acoesFalha = criarAcoesDoOnboarding({
    ...ctx,
    chamarApi: (async () => { throw new Error("Erro api"); }) as never,
  });
  await acoesFalha.aoConcluir("#/chat");
  expect(destinoNavegado).toBe("#/chat");

  // Ingerir exemplo com sucesso
  let atualizouIngestao = false;
  const acoesIngerir = criarAcoesDoOnboarding({
    ...ctx,
    aoAtualizar: async () => { atualizouIngestao = true; },
    chamarApi: (async () => ({ ok: true, id: "conversa-xyz" })) as never,
  });
  await acoesIngerir.aoIngerirExemplo?.("pessoal");
  expect(concluindo).toBe(false);
  expect(atualizouIngestao).toBe(true);
  expect(destinoNavegado).toBe("#/chat/conversa-xyz");

  // Ingerir exemplo com falha na API exibe o erro
  let erroAreasIngestao: string | null = null;
  const acoesIngerirFalha = criarAcoesDoOnboarding({
    ...ctx,
    setErroAreas: e => { erroAreasIngestao = e; },
    chamarApi: (async () => { throw new Error("Erro ingestao"); }) as never,
  });
  await acoesIngerirFalha.aoIngerirExemplo?.("pessoal");
  expect<unknown>(erroAreasIngestao).toBe("Erro ingestao");

  acoes.aoNavegar(3);
  expect(destinoNavegado).toBe("#/onboarding/3");
});

test("Dado elementos interativos do PainelDoOnboarding Quando o usuário interage Então aciona os manipuladores correspondentes", () => {
  const dadosBase = {
    precisaOnboarding: true,
    concluido: false,
    etapa: 1,
    pasta: "/minha/pasta",
    inspecao: {
      wiki: { existe: true, detalhe: "ok" },
      raw: { existe: true, detalhe: "ok" },
      contratos: { existe: true, detalhe: "ok" },
      bun: { existe: true, detalhe: "ok" },
    },
    agente: {
      nome: "Claude Code",
      disponivel: true,
      versao: "1.0",
      travas: [{ nome: "Trava 1", ligada: true }],
    },
    areas: {
      padrao: ["pessoal"],
      existentes: [],
      temExemplo: true,
    },
    primeiraIngestao: {
      exemploDisponivel: true,
      caminho: "raw/exemplo/llm-wiki.md",
    },
  };

  const disparos: string[] = [];
  const acoes: AcoesDoOnboarding = {
    aoMudarPasta: p => disparos.push(`pasta:${p}`),
    aoConfirmarPasta: () => disparos.push("confirmarPasta"),
    aoTestarAgente: () => disparos.push("testarAgente"),
    aoMudarNovaArea: a => disparos.push(`novaArea:${a}`),
    aoAlternarArea: a => disparos.push(`alternarArea:${a}`),
    aoAdicionarArea: () => disparos.push("adicionarArea"),
    aoAlternarRemoverExemplo: r => disparos.push(`removerExemplo:${r}`),
    aoCriarAreas: () => disparos.push("criarAreas"),
    aoConcluir: d => disparos.push(`concluir:${d}`),
    aoIngerirExemplo: async a => { disparos.push(`ingerirExemplo:${a}`); },
    aoNavegar: p => disparos.push(`navegar:${p}`),
  };

  const clicar = (el: unknown) => { (((el as { props?: { onClick?: () => void } })?.props?.onClick))?.(); };
  const mudar = (el: unknown, val: unknown) => { (((el as { props?: { onChange?: (e: unknown) => void } })?.props?.onChange))?.(val); };
  const tecla = (el: unknown, e: unknown) => { (((el as { props?: { onKeyDown?: (k: unknown) => void } })?.props?.onKeyDown))?.(e); };

  // Passo 1: input de pasta e botão Continuar
  const arvP1 = expandir(
    <PainelDoOnboarding
      passo={1}
      dados={dadosBase}
      pasta="/minha/pasta"
      erroPasta={null}
      carregandoPasta={false}
      testandoAgente={false}
      resultadoTeste={null}
      sucessoTeste={null}
      areasSelecionadas={[]}
      novaArea=""
      removerExemplo={false}
      criandoAreas={false}
      erroAreas={null}
      concluindo={false}
      acoes={acoes}
    />,
  );
  const inputPasta = achar(arvP1, e => e.type === "input" && e.props.id === "vault")[0];
  mudar(inputPasta, { target: { value: "/nova/pasta" } });
  clicar(botao(arvP1, "Continuar →"));

  // Passo 2: botão testar, voltar e botão continuar
  const arvP2 = expandir(
    <PainelDoOnboarding
      passo={2}
      dados={dadosBase}
      pasta="/minha/pasta"
      erroPasta={null}
      carregandoPasta={false}
      testandoAgente={false}
      resultadoTeste={null}
      sucessoTeste={null}
      areasSelecionadas={[]}
      novaArea=""
      removerExemplo={false}
      criandoAreas={false}
      erroAreas={null}
      concluindo={false}
      acoes={acoes}
    />,
  );
  clicar(botao(arvP2, "← Voltar"));
  clicar(botao(arvP2, "Testar conexão"));
  clicar(botao(arvP2, "Continuar →"));

  // Passo 3: voltar, checkbox de área, input com onKeyDown Enter, botão adicionar, checkbox remover exemplo e botão criar áreas
  const arvP3 = expandir(
    <PainelDoOnboarding
      passo={3}
      dados={dadosBase}
      pasta="/minha/pasta"
      erroPasta={null}
      carregandoPasta={false}
      testandoAgente={false}
      resultadoTeste={null}
      sucessoTeste={null}
      areasSelecionadas={["pessoal", "customizada"]}
      novaArea="nova"
      removerExemplo={true}
      criandoAreas={false}
      erroAreas={null}
      concluindo={false}
      acoes={acoes}
    />,
  );
  clicar(botao(arvP3, "← Voltar"));
  const checkArea = achar(arvP3, e => e.type === "input" && e.props.type === "checkbox")[0];
  mudar(checkArea, undefined);

  const inputNova = achar(arvP3, e => e.type === "input" && e.props.placeholder === "nova-area")[0];
  mudar(inputNova, { target: { value: "leitura" } });

  let enterPrevenido = false;
  tecla(inputNova, { key: "Enter", preventDefault: () => { enterPrevenido = true; } });
  expect(enterPrevenido).toBe(true);

  let outroPrevenido = false;
  tecla(inputNova, { key: "Escape", preventDefault: () => { outroPrevenido = true; } });
  expect(outroPrevenido).toBe(false);

  clicar(botao(arvP3, "Adicionar"));

  const checkboxes = achar(arvP3, e => e.type === "input" && e.props.type === "checkbox");
  const checkExemplo = checkboxes[checkboxes.length - 1]; // o checkbox de remover exemplo
  mudar(checkExemplo, { target: { checked: false } });

  clicar(botao(arvP3, "Criar áreas →"));

  // Passo 4: voltar, botão ingerir fonte, botão ir ao chat e botão pular
  const arvP4 = expandir(
    <PainelDoOnboarding
      passo={4}
      dados={dadosBase}
      pasta="/minha/pasta"
      erroPasta={null}
      carregandoPasta={false}
      testandoAgente={false}
      resultadoTeste={null}
      sucessoTeste={null}
      areasSelecionadas={[]}
      novaArea=""
      removerExemplo={false}
      criandoAreas={false}
      erroAreas={null}
      concluindo={false}
      acoes={acoes}
    />,
  );
  clicar(botao(arvP4, "← Voltar"));
  clicar(botao(arvP4, "Ingerir em"));
  clicar(botao(arvP4, "Escolher um arquivo"));
  clicar(botao(arvP4, "Pular por agora"));

  expect(disparos).toContain("pasta:/nova/pasta");
  expect(disparos).toContain("confirmarPasta");
  expect(disparos).toContain("navegar:1");
  expect(disparos).toContain("testarAgente");
  expect(disparos).toContain("navegar:2");
  expect(disparos).toContain("navegar:3");
  expect(disparos).toContain("alternarArea:pessoal");
  expect(disparos).toContain("novaArea:leitura");
  expect(disparos).toContain("adicionarArea");
  expect(disparos).toContain("removerExemplo:false");
  expect(disparos).toContain("criarAreas");
  expect(disparos).toContain("ingerirExemplo:pessoal");
  expect(disparos).toContain("concluir:#/chat");
  expect(disparos).toContain("concluir:#/inicio");
});

test("Dado criarAcoesDoOnboarding sem função navegar customizada Quando chamo aoNavegar Então altera window.location.hash por padrão", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { location: { hash: "" } };
  try {
    const ctx: ContextoAcoesDoOnboarding = {
      pasta: "/vault",
      setPasta: () => {},
      setCarregandoPasta: () => {},
      setErroPasta: () => {},
      setTestandoAgente: () => {},
      setResultadoTeste: () => {},
      setSucessoTeste: () => {},
      areasSelecionadas: [],
      setAreasSelecionadas: () => {},
      novaArea: "",
      setNovaArea: () => {},
      removerExemplo: false,
      setRemoverExemplo: () => {},
      setCriandoAreas: () => {},
      setErroAreas: () => {},
      setConcluindo: () => {},
    };
    const acoes = criarAcoesDoOnboarding(ctx);
    acoes.aoNavegar(4);
    expect((globalThis as any).window.location.hash).toBe("#/onboarding/4");
  } finally {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

test("Dado PainelDoOnboarding com tema e alternarTema Quando renderizo Então exibe o botão de alternar tema", () => {
  let alternou = false;
  const painelClaro = (
    <PainelDoOnboarding
      passo={1}
      tema="claro"
      alternarTema={() => { alternou = true; }}
      dados={{
        precisaOnboarding: true,
        concluido: false,
        etapa: 1,
        pasta: "/vault",
        inspecao: {
          wiki: { existe: false, detalhe: "" },
          raw: { existe: false, detalhe: "" },
          contratos: { existe: false, detalhe: "" },
          bun: { existe: true, detalhe: "" },
        },
        agente: { nome: "Claude Code", disponivel: true, versao: "1.0", travas: [] },
        areas: { padrao: ["pessoal"], existentes: [], temExemplo: false },
        primeiraIngestao: { exemploDisponivel: false, caminho: "" },
      }}
      pasta="/vault"
      erroPasta={null}
      carregandoPasta={false}
      testandoAgente={false}
      resultadoTeste={null}
      sucessoTeste={null}
      areasSelecionadas={["pessoal"]}
      novaArea=""
      removerExemplo={false}
      criandoAreas={false}
      erroAreas={null}
      concluindo={false}
      acoes={{
        aoMudarPasta: () => {},
        aoConfirmarPasta: async () => {},
        aoTestarAgente: async () => {},
        aoMudarNovaArea: () => {},
        aoAlternarArea: () => {},
        aoAdicionarArea: () => {},
        aoAlternarRemoverExemplo: () => {},
        aoCriarAreas: async () => {},
        aoConcluir: async () => {},
        aoIngerirExemplo: async () => {},
        aoNavegar: () => {},
      }}
    />
  );
  const htmlClaro = renderToStaticMarkup(painelClaro);
  expect(htmlClaro).toContain("Alternar tema claro ou escuro");
  expect(htmlClaro).toContain("◐");

  const arvore = expandir(painelClaro);
  const botaoTema = achar(arvore, b => b.type === "button" && b.props["aria-label"] === "Alternar tema claro ou escuro")[0];
  expect(botaoTema).toBeDefined();
  (botaoTema!.props as { onClick: () => void }).onClick();
  expect(alternou).toBe(true);

  const painelEscuro = React.cloneElement(painelClaro, { tema: "escuro" });
  const htmlEscuro = renderToStaticMarkup(painelEscuro);
  expect(htmlEscuro).toContain("☼");
});

test("Dado aoConfirmarPasta com wiki pronta Quando confirmo Então navega para #/inicio", async () => {
  let navegouPara = "";
  let atualizou = false;
  let atualizouIngestao = false;

  const ctx: ContextoAcoesDoOnboarding = {
    pasta: "/vault/pronto",
    setPasta: () => {},
    setCarregandoPasta: () => {},
    setErroPasta: () => {},
    setTestandoAgente: () => {},
    setResultadoTeste: () => {},
    setSucessoTeste: () => {},
    areasSelecionadas: [],
    setAreasSelecionadas: () => {},
    novaArea: "",
    setNovaArea: () => {},
    removerExemplo: false,
    setRemoverExemplo: () => {},
    setCriandoAreas: () => {},
    setErroAreas: () => {},
    setConcluindo: () => {},
    aoAtualizar: async () => { atualizou = true; },
    aoAtualizarIngestao: async () => { atualizouIngestao = true; },
    navegar: destino => { navegouPara = destino; },
    chamarApi: (async () => ({
      ok: true,
      pasta: "/vault/pronto",
      inspecao: { wikiPronta: true },
      precisaOnboarding: false,
    })) as never,
  };

  const acoes = criarAcoesDoOnboarding(ctx);
  await acoes.aoConfirmarPasta();

  expect(atualizou).toBe(true);
  expect(atualizouIngestao).toBe(true);
  expect(navegouPara).toBe("#/inicio");
});

test("Dado aoConfirmarPasta com wiki nova Quando confirmo Então navega para #/onboarding/2", async () => {
  let navegouPara = "";

  const ctx: ContextoAcoesDoOnboarding = {
    pasta: "/vault/novo",
    setPasta: () => {},
    setCarregandoPasta: () => {},
    setErroPasta: () => {},
    setTestandoAgente: () => {},
    setResultadoTeste: () => {},
    setSucessoTeste: () => {},
    areasSelecionadas: [],
    setAreasSelecionadas: () => {},
    novaArea: "",
    setNovaArea: () => {},
    removerExemplo: false,
    setRemoverExemplo: () => {},
    setCriandoAreas: () => {},
    setErroAreas: () => {},
    setConcluindo: () => {},
    navegar: destino => { navegouPara = destino; },
    chamarApi: (async () => ({
      ok: true,
      pasta: "/vault/novo",
      inspecao: { wikiPronta: false },
      precisaOnboarding: true,
    })) as never,
  };

  const acoes = criarAcoesDoOnboarding(ctx);
  await acoes.aoConfirmarPasta();

  expect(navegouPara).toBe("#/onboarding/2");
});

test("Dado aoConfirmarPasta com wiki em onboarding não concluído e áreas já criadas Quando confirmo Então navega para #/onboarding/4 em vez de #/inicio", async () => {
  let navegouPara = "";

  const ctx: ContextoAcoesDoOnboarding = {
    pasta: "/vault/em-andamento",
    setPasta: () => {},
    setCarregandoPasta: () => {},
    setErroPasta: () => {},
    setTestandoAgente: () => {},
    setResultadoTeste: () => {},
    setSucessoTeste: () => {},
    areasSelecionadas: [],
    setAreasSelecionadas: () => {},
    novaArea: "",
    setNovaArea: () => {},
    removerExemplo: false,
    setRemoverExemplo: () => {},
    setCriandoAreas: () => {},
    setErroAreas: () => {},
    setConcluindo: () => {},
    navegar: destino => { navegouPara = destino; },
    chamarApi: (async () => ({
      ok: true,
      pasta: "/vault/em-andamento",
      inspecao: { wikiPronta: true },
      precisaOnboarding: true,
      concluido: false,
      etapa: 4,
    })) as never,
  };

  const acoes = criarAcoesDoOnboarding(ctx);
  await acoes.aoConfirmarPasta();

  expect(navegouPara).toBe("#/onboarding/4");
});

test("Dado PainelDoOnboarding nos passos 2, 3 e 4 Quando renderizo Então exibe detalhes das travas, contagem e microtextos", () => {
  const dadosBase = {
    precisaOnboarding: true,
    concluido: false,
    etapa: 2,
    pasta: "/vault",
    inspecao: {
      wiki: { existe: true, detalhe: "" },
      raw: { existe: true, detalhe: "" },
      contratos: { existe: true, detalhe: "" },
      bun: { existe: true, detalhe: "" },
    },
    agente: {
      nome: "Claude Code",
      disponivel: true,
      versao: "1.0",
      travas: [
        { nome: "Proteção do raw/", ligada: false, opcional: true, detalhe: "configuração opcional" },
        { nome: "Validador", ligada: true },
      ],
    },
    areas: { padrao: ["pessoal", "projetos"], existentes: [], temExemplo: true },
    primeiraIngestao: { exemploDisponivel: true, caminho: "raw/exemplo/llm-wiki.md" },
  };

  const acoesBase = {
    aoMudarPasta: () => {},
    aoConfirmarPasta: async () => {},
    aoTestarAgente: async () => {},
    aoMudarNovaArea: () => {},
    aoAlternarArea: () => {},
    aoAdicionarArea: () => {},
    aoAlternarRemoverExemplo: () => {},
    aoCriarAreas: async () => {},
    aoConcluir: async () => {},
    aoIngerirExemplo: async () => {},
    aoNavegar: () => {},
  };

  // Passo 2: exibe detalhe real da trava
  const htmlPasso2 = renderToStaticMarkup(
    <PainelDoOnboarding
      passo={2}
      dados={dadosBase}
      pasta="/vault"
      erroPasta={null}
      carregandoPasta={false}
      testandoAgente={false}
      resultadoTeste={null}
      sucessoTeste={null}
      areasSelecionadas={["pessoal", "projetos"]}
      novaArea=""
      removerExemplo={false}
      criandoAreas={false}
      erroAreas={null}
      concluindo={false}
      acoes={acoesBase}
    />
  );
  expect(htmlPasso2).toContain("configuração opcional");
  expect(htmlPasso2).toContain("Verifica se o Claude Code está conectado e se o AGENTS.md existe.");

  // Passo 3: exibe contagem de áreas e nota do rodapé
  const htmlPasso3 = renderToStaticMarkup(
    <PainelDoOnboarding
      passo={3}
      dados={dadosBase}
      pasta="/vault"
      erroPasta={null}
      carregandoPasta={false}
      testandoAgente={false}
      resultadoTeste={null}
      sucessoTeste={null}
      areasSelecionadas={["pessoal", "projetos"]}
      novaArea=""
      removerExemplo={false}
      criandoAreas={false}
      erroAreas={null}
      concluindo={false}
      acoes={acoesBase}
    />
  );
  expect(htmlPasso3).toContain("2 áreas selecionadas");
  expect(htmlPasso3).toContain("Repetir esta etapa não altera o que já existe.");

  // Passo 4: exibe microtexto de link e mensagem de erro se presente
  const htmlPasso4 = renderToStaticMarkup(
    <PainelDoOnboarding
      passo={4}
      dados={dadosBase}
      pasta="/vault"
      erroPasta={null}
      carregandoPasta={false}
      testandoAgente={false}
      resultadoTeste={null}
      sucessoTeste={null}
      areasSelecionadas={["pessoal"]}
      novaArea=""
      removerExemplo={false}
      criandoAreas={false}
      erroAreas="Erro na ingestão do exemplo"
      concluindo={false}
      acoes={acoesBase}
    />
  );
  expect(htmlPasso4).toContain("Tem um link? Salve o texto integral primeiro. Um resumo não serve como fonte.");
  expect(htmlPasso4).toContain("Erro na ingestão do exemplo");
});

