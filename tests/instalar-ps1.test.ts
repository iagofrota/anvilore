// Contrato estático do instalador do Windows. O comportamento (PowerShell de verdade) é provado pelos testes Pester em
// tests/instalar-ps1/, que rodam no job `instalar-ps1` do CI (windows-latest, Windows PowerShell 5.1): o Bun não executa PowerShell.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { lerEmbutidos } from "../scripts/embutir-instalador";

const raiz = join(import.meta.dir, "..");
const caminho = join(raiz, "instalador/instalar.ps1");
const bytes = readFileSync(caminho);
const texto = bytes.toString("utf8");
const codigo = texto.split("\n").filter(l => !l.trimStart().startsWith("#")).join("\n");

describe("instalar.ps1: forma do arquivo", () => {
  test("Dado o instalador, Quando leio os bytes, Então é UTF-8 sem BOM", () => {
    expect([bytes[0], bytes[1], bytes[2]]).not.toEqual([0xef, 0xbb, 0xbf]);
  });

  test("Dado o instalador lido como ANSI pelo PowerShell 5.1, Quando procuro bytes que viram aspas tipográficas, Então não há nenhum", () => {
    // 0x84 e 0x91-0x94 em CP1252 são „ ‘ ’ “ ”, que o PowerShell trata como aspas: um travessão ou um Ó/Ô quebraria a leitura.
    const ruins = [...bytes].filter(b => b === 0x84 || (b >= 0x91 && b <= 0x94));
    expect(ruins).toHaveLength(0);
  });

  test("Dado o instalador, Quando procuro `exit`, Então não existe (num irm | iex fecharia o terminal)", () => {
    expect(codigo).not.toMatch(/^\s*exit\b/m);
  });

  test("Dado o instalador, Quando procuro bloco param no topo do arquivo ou -ExecutionPolicy, Então não há (GPO vence o parâmetro)", () => {
    expect(codigo).not.toMatch(/^param\s*\(/m);
    expect(codigo).not.toMatch(/-ExecutionPolicy/);
  });
});

describe("instalar.ps1: requisitos do passo a passo", () => {
  test.each([
    ["clone sem conversão de fim de linha", /core\.autocrlf=false/],
    ["saída em UTF-8", /OutputEncoding/],
    ["Constrained Language Mode cai para reg.exe", /LanguageMode[\s\S]*reg\.exe|reg\.exe[\s\S]*LanguageMode/],
    ["perguntas desligáveis", /ANVILORE_SEM_PERGUNTAS/],
    ["origem trocável", /ANVILORE_ORIGEM/],
    ["registro em .anvilore\\instalacao.log", /instalacao\.log/],
    ["confere a assinatura da tag", /verify-tag/],
    ["PortableGit em %LOCALAPPDATA%\\Anvilore\\git", /Anvilore\\git/],
    ["clone sem checkout (A1)", /--no-checkout/],
    ["hooks desligados no staging (A1)", /core\.hooksPath=/],
    ["verificador SSH fixo (A2)", /gpg\.ssh\.program=ssh-keygen/],
    ["só vale assinatura SSH", /BEGIN SSH SIGNATURE/],
    ["gpg e x509 desligados no verify-tag", /gpg\.openpgp\.program=false[\s\S]*gpg\.x509\.program=false/],
    ["versão fixa", /ANVILORE_VERSAO/],
    ["pasta escolhida", /ANVILORE_PASTA/],
    ["resposta antecipada sobre o Claude Code", /ANVILORE_INSTALAR_CLAUDE/],
    ["esperar Enter no fim", /ANVILORE_ESPERAR_ENTER/],
  ])("Dado o instalador, Quando procuro: %s, Então está lá", (_nome, padrao) => {
    expect(codigo).toMatch(padrao);
  });

  test("Dado o passo 10 (atalhos), Então é só um ponto de chamada para a U6: sem .lnk, sem WScript.Shell e sem abrir.ps1", () => {
    expect(codigo).toMatch(/function AnvCriarAtalho/);
    expect(codigo).not.toMatch(/WScript\.Shell|CreateShortcut|\.lnk/);
    expect(existsSync(join(raiz, "instalador/abrir.ps1"))).toBe(false);
  });

  test("Dado o instalador sem build de release, Então as regiões embutidas estão vazias: sem chave, nada é confiável", () => {
    expect(lerEmbutidos(texto, "ps1")).toEqual({ manifesto: "", assinantes: "", baseMinima: "", urlConfianca: "" });
    expect(texto).toMatch(/# >>> ANVILORE:MANIFESTO[^\n]*\n\$script:AnvManifestoEmbutido = @'\n'@\n# <<< ANVILORE:MANIFESTO/);
    expect(texto).toMatch(/# >>> ANVILORE:ASSINANTES[^\n]*\n\$script:AnvAssinantesEmbutido = @'\n'@\n# <<< ANVILORE:ASSINANTES/);
    expect(texto).toMatch(/# >>> ANVILORE:BASE_MINIMA[^\n]*\n\$script:AnvBaseMinimaEmbutida = @'\n'@\n# <<< ANVILORE:BASE_MINIMA/);
    expect(texto).toMatch(/# >>> ANVILORE:URL_CONFIANCA[^\n]*\n\$script:AnvUrlConfiancaEmbutida = @'\n'@\n# <<< ANVILORE:URL_CONFIANCA/);
  });
});

// Corpo de uma função do .ps1 (até a próxima `function` no início da linha).
const funcao = (nome: string) => new RegExp(`\\nfunction ${nome} \\{[\\s\\S]*?(?=\\nfunction |$)`).exec(codigo)?.[0] ?? "";

describe("instalar.ps1: transporte do git antes da assinatura (A5) e chaves da reinstalação (RR6)", () => {
  test("Dado a descoberta da tag e o clone, Quando leio o código, Então os dois passam pelo git de rede com a guarda (e nunca pelo AnvExecutar direto)", () => {
    for (const nome of ["AnvDescobrirTag", "AnvBaixarKit"]) {
      const corpo = funcao(nome);
      expect(corpo, nome).not.toBe("");
      expect(corpo, nome).toContain("AnvExecutarRede");
      expect(corpo, nome).not.toMatch(/AnvExecutar \$Git[^\n]*(ls-remote|AnvArgsClone)/);
    }
    expect(funcao("AnvDescobrirTag")).toContain("AnvArgsLsRemote");
  });

  test("Dado os argumentos de rede, Então zeram o helper de credencial e o askpass, e o ambiente restringe o protocolo", () => {
    expect(funcao("AnvArgsRede")).toMatch(/credential\.helper=/);
    expect(funcao("AnvArgsRede")).toMatch(/core\.askPass=/);
    expect(funcao("AnvAmbienteRede")).toMatch(/GIT_ALLOW_PROTOCOL/);
    expect(funcao("AnvAmbienteRede")).toMatch(/GIT_TERMINAL_PROMPT/);
    expect(funcao("AnvAmbienteRede")).toMatch(/GIT_ASKPASS/);
  });

  test("Dado o ambiente da chamada de rede, Quando ela termina, Então o valor anterior é devolvido (nada vaza para o resto da instalação)", () => {
    const corpo = funcao("AnvExecutarComAmbiente");
    expect(corpo).toMatch(/finally/);
    expect(corpo).toMatch(/Remove-Item/);
  });

  test("Dado uma pasta já instalada, Quando o instalador roda o atualizador dela, Então entrega as chaves embutidas pela opção --assinantes-do-instalador e não pelo ambiente (R1)", () => {
    const trecho = /\$jaInstalado\) \{[\s\S]*?\} else \{/.exec(codigo)?.[0] ?? "";
    expect(trecho).toMatch(/'atualizar'/);
    expect(trecho).toMatch(/'--assinantes-do-instalador'\s*,\s*\$assinReinstalacao/);
    expect(trecho).not.toContain("AnvExecutarComAmbiente");
    expect(codigo).not.toContain("ANVILORE_ASSINANTES_DO_INSTALADOR");
  });

  test("Dado o atualizador antigo da pasta que devolve 2 (uso) para a opção, Então o instalador para com mensagem simples e não segue como atualizado (R1)", () => {
    const trecho = /\$jaInstalado\) \{[\s\S]*?\} else \{/.exec(codigo)?.[0] ?? "";
    expect(trecho).toMatch(/\$at\.Codigo -eq 2/);
    expect(trecho).toMatch(/AnvParar 1 \(AnvMensagemBaseMinima[^\n]*'atualizador'/);
    const mensagem = funcao("AnvMensagemBaseMinima");
    expect(mensagem).toContain("anterior à primeira versão assinada e não sabe receber as chaves do instalador; nada foi mudado");
    expect(codigo).toContain("numa pasta nova");
    expect(trecho + mensagem).not.toContain("pelo comando de atualização dela");
  });

  test("Dado uma pasta já instalada, Quando o instalador decide reinstalar, Então lê e compara a versão com a base mínima ANTES de gravar o registro na pasta e de executar o atualizador (decisão 1)", () => {
    const trecho = /\$jaInstalado\) \{[\s\S]*?\} else \{/.exec(codigo)?.[0] ?? "";
    const verifica = trecho.indexOf("AnvVerificarBaseMinima");
    expect(verifica).toBeGreaterThan(-1);
    expect(trecho.indexOf("AnvBaseMinima")).toBeGreaterThan(-1);
    expect(trecho.indexOf("AnvMensagemBaseMinima")).toBeGreaterThan(verifica);
    expect(trecho).toMatch(/AnvParar 1 \(AnvMensagemBaseMinima/);
    // Nada que escreva ou execute na pasta vem antes da verificação.
    for (const antes of ["AnvDefinirLog", "AnvExecutar", "AnvEscrever \"Já existe"]) expect(trecho.indexOf(antes)).toBeGreaterThan(verifica);
  });

  test("Dado a leitura da versão da pasta, Então só lê o package.json como texto (nem Bun, nem Git, nem dot-source da pasta)", () => {
    const corpo = /function AnvLerVersaoDaPasta \{[\s\S]*?\n\}/.exec(codigo)?.[0] ?? "";
    expect(corpo).toContain("package.json");
    expect(corpo).toMatch(/ConvertFrom-Json/);
    expect(corpo).not.toMatch(/AnvExecutar|bun|git|Invoke-Expression|iex|& \$|\. \$/i);
  });

  test("Dado a pasta instalada, Então o critério é a estrutura do kit (.git, AGENTS.md, src\\cli.ts, skills) e não o estado nem o package.json", () => {
    const corpo = /function AnvEhInstalacao \{[\s\S]*?\n\}/.exec(codigo)?.[0] ?? "";
    for (const parte of [".git", "AGENTS.md", "src\\cli.ts", "skills"]) expect(corpo).toContain(parte);
    expect(corpo).not.toMatch(/atualizacao\.json|package\.json/);
  });

  test("Dado o instalador sem a base mínima embutida, Quando reinstala, Então para (código 3) como faz sem a chave", () => {
    const trecho = /\$jaInstalado\) \{[\s\S]*?\} else \{/.exec(codigo)?.[0] ?? "";
    expect(trecho).toMatch(/AnvParar 3 /);
    expect(codigo).toContain("AnvBaseMinimaEmbutida");
  });
});

describe("instalar.ps1: manifesto real", () => {
  const m = JSON.parse(readFileSync(join(raiz, "instalador/dependencias.json"), "utf8"));

  test("Dado o manifesto, Então traz PortableGit, Bun (com baseline) e rg para windows-x64", () => {
    for (const [nome, plataforma] of [["portablegit", "windows-x64"], ["bun", "windows-x64"], ["bun", "windows-x64-baseline"], ["rg", "windows-x64"]] as const) {
      const e = m.dependencias[nome].plataformas[plataforma];
      expect(e.url).toMatch(/^https:\/\//);
      expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("Dado o Bun do manifesto, Quando comparo com o packageManager do package.json, Então a versão é a mesma", () => {
    const pm = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8")).packageManager as string;
    expect(m.dependencias.bun.versao).toBe(pm.replace(/^bun@/, ""));
  });
});

describe("CI do instalador do Windows", () => {
  test("Dado o ci.yml, Então há um job no windows-latest que roda os testes unitários e a prova de ponta a ponta", () => {
    const ci = readFileSync(join(raiz, ".github/workflows/ci.yml"), "utf8");
    const job = /\n  instalar-ps1:[\s\S]*?(?=\n  [a-z0-9-]+:\n|$)/.exec(ci)?.[0] ?? "";
    expect(job).toContain("windows-latest");
    expect(job).toContain("tests/instalar-ps1/instalar.Tests.ps1");
    expect(job).toContain("tests/instalar-ps1/e2e.Tests.ps1");
  });
});

describe("instalar.ps1: estado das chaves no site (decisão 2 do parecer de release)", () => {
  test("Dado a consulta, Quando leio o código, Então não segue redirecionamento, não usa cache, tem tempo limite e não lê o ambiente", () => {
    const corpo = funcao("AnvLerConfiancaHttp");
    expect(corpo).not.toBe("");
    expect(corpo).toContain("[System.Net.HttpWebRequest][System.Net.WebRequest]::Create($Url)");
    expect(corpo).toContain("AllowAutoRedirect = $false");
    expect(corpo).toContain("Timeout = 15000");
    expect(corpo).toContain("ReadWriteTimeout = 15000");
    const consulta = funcao("AnvConsultarConfianca");
    expect(consulta).toContain("'Cache-Control' = 'no-cache'");
    expect(consulta).toContain("'Pragma' = 'no-cache'");
    expect(consulta).toContain("AnvLerConfiancaHttp");
    expect(codigo).toMatch(/\$script:AnvLimiteConfianca = 65536\b/);
    for (const nome of ["AnvUrlConfianca", "AnvConsultarConfianca", "AnvLerConfiancaHttp", "AnvConferirEstadoDasChaves", "AnvValidarConfianca"]) {
      expect(funcao(nome), nome).not.toMatch(/AnvVariavel|\$env:|GetEnvironmentVariable/);
    }
  });

  test("Dado o limite de 64 KiB, Quando leio a busca, Então os bytes são contados DURANTE a leitura do stream e o pedido é abortado (não há Invoke-WebRequest nem .Content)", () => {
    const busca = funcao("AnvLerConfiancaHttp");
    expect(busca).toContain("GetResponseStream()");
    expect(busca).toMatch(/\.Read\(\$bloco, 0, /);
    expect(busca).toContain("$script:AnvLimiteConfianca");
    // O aborto está no teste do limite sobre o que já foi lido (e não só no do tempo).
    expect(busca).toMatch(/\$memoria\.Length -gt \$script:AnvLimiteConfianca\) \{ \$req\.Abort\(\); throw 'resposta maior que o limite'/);
    expect(busca).toContain("maior que o limite");
    // Um Content-Length acima do limite também recusa antes de ler.
    expect(busca).toContain("ContentLength");
    // O tempo total (não só cada leitura) tem teto de 15 s.
    expect(busca).toContain("Stopwatch");
    expect(busca).toContain("$restante = 15000 - [int][Math]::Ceiling($relogio.Elapsed.TotalMilliseconds)");
    expect(busca).toContain("$fluxo.ReadTimeout = $restante");
    expect(busca).toContain("catch [System.IO.IOException] { $req.Abort(); throw 'tempo limite' }");
    expect(busca).toContain("if ($restante -le 0) { $req.Abort(); throw 'tempo limite' }");
    expect(busca).toContain("$memoria.Dispose()");
    for (const nome of ["AnvConsultarConfianca", "AnvLerConfiancaHttp"]) {
      expect(funcao(nome), nome).not.toContain("Invoke-WebRequest");
      expect(funcao(nome), nome).not.toContain("RawContentLength");
    }
  });

  test("Dado o documento, Quando leio AnvValidarConfianca, Então recusa nome repetido contando os nomes no texto bruto e recusa escape", () => {
    const corpo = funcao("AnvValidarConfianca");
    for (const nome of ["chaves", "formato", "versaoMinima"]) expect(corpo, nome).toContain(`"${nome}"`);
    expect(corpo).toMatch(/\[regex\]::Matches\(\$Texto/);
    expect(corpo).toMatch(/-ne 1/);
    expect(corpo).toContain(".Contains('\\')");
  });

  test("Dado a instalação nova, Quando leio AnvBaixarKit, Então a lista de chaves é consultada antes do clone e a verificação usa a interseção", () => {
    const corpo = funcao("AnvBaixarKit");
    expect(corpo.indexOf("AnvConferirEstadoDasChaves")).toBeGreaterThan(-1);
    expect(corpo.indexOf("AnvConferirEstadoDasChaves")).toBeLessThan(corpo.indexOf("AnvArgsClone"));
    expect(corpo).toMatch(/Set-Content -LiteralPath \$assinFile -Value \$estadoChaves\.Assinantes/);
  });

  test("Dado a reinstalação, Quando leio AnvPassos, Então a base mínima vem antes da lista, que vem antes de executar o atualizador da pasta", () => {
    const corpo = funcao("AnvPassos");
    const base = corpo.indexOf("AnvVerificarBaseMinima -Pasta"), lista = corpo.indexOf("AnvConferirEstadoDasChaves"), atualizar = corpo.indexOf("'atualizar', '--assinantes-do-instalador'");
    expect(base).toBeGreaterThan(-1);
    expect(lista).toBeGreaterThan(base);
    expect(atualizar).toBeGreaterThan(lista);
    expect(corpo).toMatch(/AnvVersaoDaPastaAtendeMinima -Versao \$verificacao\.Versao -Minima/);
    expect(corpo).toMatch(/Set-Content -LiteralPath \$assinReinstalacao -Value \$estadoChaves\.Assinantes/);
  });
});

describe("instalar.ps1: commit automático só na instalação nova (achado P2 do Codex)", () => {
  test("Dado AnvPassos, Quando leio a chamada do instalar, Então --auto-commit não é passado sempre: vem de AnvAutoCommitDaPasta", () => {
    const corpo = funcao("AnvPassos");
    expect(corpo).not.toMatch(/'--destino', \$pasta, '--auto-commit'/);
    expect(corpo).toMatch(/AnvAutoCommitDaPasta -Pasta \$pasta -JaInstalado \$jaInstalado/);
    expect(corpo).toMatch(/'--auto-commit'/);
  });

  test("Dado AnvAutoCommitDaPasta, Quando leio o código, Então só a reinstalação lê o autoCommit do atualizacao.json", () => {
    const corpo = funcao("AnvAutoCommitDaPasta");
    expect(corpo).not.toBe("");
    expect(corpo).toMatch(/atualizacao\.json/);
    expect(corpo).toMatch(/autoCommit/);
    expect(corpo).toMatch(/-not \$JaInstalado/);
    expect(corpo).toContain("ConvertFrom-Json");
    expect(corpo).toMatch(/autoCommit\s+-is\s+\[bool\]/);
  });
});

describe("instalar.ps1: pasta de passagem única, nunca a Anvilore.novo fixa (achado P1 do Codex)", () => {
  test("Dado AnvBaixarKit, Quando leio o código, Então não usa o nome fixo Anvilore.novo e cria uma pasta única ao lado do destino", () => {
    const corpo = funcao("AnvBaixarKit");
    expect(corpo).not.toMatch(/Anvilore\.novo/);
    expect(corpo).toMatch(/AnvCriarStaging -Pai \(Split-Path -Parent \$Pasta\)/);
  });

  test("Dado AnvBaixarKit, Quando leio a limpeza, Então ela vem de um finally que só apaga o que esta execução criou", () => {
    const corpo = funcao("AnvBaixarKit");
    expect(corpo).toMatch(/finally \{[^}]*Remove-Item -LiteralPath \$staging/);
    expect(corpo.indexOf("AnvCriarStaging")).toBeLessThan(corpo.indexOf("Remove-Item"));
  });

  test("Dado AnvCriarStaging, Quando leio o código, Então o nome tem sufixo aleatório, a criação falha se já existe e nada é apagado", () => {
    const corpo = funcao("AnvCriarStaging");
    expect(corpo).not.toBe("");
    expect(corpo).toMatch(/NewGuid/);
    expect(corpo).toMatch(/New-Item -ItemType Directory -Path \$candidato -ErrorAction Stop/);
    expect(corpo).not.toMatch(/New-Item[^\n]*-Force[^\n]*\$candidato/);
    expect(corpo).not.toContain("Remove-Item");
  });

  test("Dado o instalador inteiro, Quando procuro o nome fixo Anvilore.novo, Então só existe o prefixo com sufixo aleatório", () => {
    expect(codigo).not.toMatch(/Anvilore\.novo['"]/);
  });
});
