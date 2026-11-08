import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { iniciarServidorUi, podeEncerrarPorInatividade } from "../src/ui/servidor/servidor";
import { PonteClaudeCode } from "../src/lib/ponte-claude-code";

class PonteFalsa extends PonteClaudeCode {
  override async disponibilidade() {
    return { ok: true as const, binario: "claude", versao: "fake" };
  }
}

test("Dado servidor com autoEncerrar ativo, Quando passa o tempo limite sem batimento, Então encerra o servidor automaticamente", async () => {
  const raiz = await mkdtemp(join(tmpdir(), "anvilore-inatividade-"));
  try {
    const app = await iniciarServidorUi(raiz, {
      portaInicial: 0,
      token: "token-inatividade-1",
      abrirNavegador: false,
      ponte: new PonteFalsa(),
      autoEncerrar: true,
      inatividadeMs: 60,
      intervaloChecagemMs: 15,
    });

    expect(app.servidor.pendingRequests).toBeDefined();

    // Aguarda o tempo limite passar
    await new Promise(r => setTimeout(r, 120));

    // O servidor deve ter sido interrompido
    let erroAoConectar = false;
    try {
      await fetch(`http://127.0.0.1:${app.porta}/api/inicio?token=token-inatividade-1`, {
        signal: AbortSignal.timeout(500),
      });
    } catch {
      erroAoConectar = true;
    }
    expect(erroAoConectar).toBe(true);
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test("Dado servidor com autoEncerrar ativo, Quando recebe batimento periódico na rota /api/batimento, Então mantém o servidor rodando", async () => {
  const raiz = await mkdtemp(join(tmpdir(), "anvilore-inatividade-"));
  try {
    const app = await iniciarServidorUi(raiz, {
      portaInicial: 0,
      token: "token-inatividade-2",
      abrirNavegador: false,
      ponte: new PonteFalsa(),
      autoEncerrar: true,
      inatividadeMs: 100,
      intervaloChecagemMs: 20,
    });

    // Envia batimentos a cada 40ms por 3 vezes (total ~120ms, acima dos 100ms)
    for (let i = 0; i < 3; i++) {
      await new Promise(r => setTimeout(r, 40));
      const res = await fetch(`http://127.0.0.1:${app.porta}/api/batimento?token=token-inatividade-2`, {
        method: "POST",
      });
      expect(res.status).toBe(200);
      const dados = await res.json() as { ok: boolean };
      expect(dados.ok).toBe(true);
    }

    // Servidor continua respondendo normalmente
    const inicio = await fetch(`http://127.0.0.1:${app.porta}/api/inicio?token=token-inatividade-2`);
    expect(inicio.status).toBe(200);

    await app.encerrar();
    app.servidor.stop(true);
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test("Dado requisição lenta em andamento em /api/*, Quando o período de inatividade expira sem batimento, Então o servidor aguarda a conclusão da requisição antes de encerrar", async () => {
  const raiz = await mkdtemp(join(tmpdir(), "anvilore-req-voo-"));
  try {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(raiz, "wiki"), { recursive: true });
    await writeFile(join(raiz, "SCHEMA.md"), "# Schema\n");
    await writeFile(join(raiz, "wiki/inicio.md"), "---\ntitle: Inicio\n---\n# Inicio\n");

    const app = await iniciarServidorUi(raiz, {
      portaInicial: 0,
      token: "token-voo-1",
      abrirNavegador: false,
      ponte: new PonteFalsa(),
      autoEncerrar: true,
      inatividadeMs: 50,
      intervaloChecagemMs: 15,
    });

    // Inicia a requisição lenta POST /api/validar
    const requisicaoLenta = fetch(`http://127.0.0.1:${app.porta}/api/validar?token=token-voo-1`, {
      method: "POST",
      headers: { origin: `http://127.0.0.1:${app.porta}` },
    });

    // Aguarda a resposta (que dura tempo suficiente para ultrapassar os 50ms de inatividade)
    const resposta = await requisicaoLenta;
    expect(resposta.status).toBe(200);
    const corpo = await resposta.json() as { codigo: number; saida: string };
    expect(typeof corpo.codigo).toBe("number");
    expect(typeof corpo.saida).toBe("string");

    // Agora que a requisição terminou, aguarda mais um intervalo de inatividade
    await new Promise(r => setTimeout(r, 90));

    // Agora sim o servidor deve estar encerrado
    let conexaoRecusada = false;
    try {
      await fetch(`http://127.0.0.1:${app.porta}/api/inicio?token=token-voo-1`, {
        signal: AbortSignal.timeout(300),
      });
    } catch {
      conexaoRecusada = true;
    }
    expect(conexaoRecusada).toBe(true);
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test("Dado watchdog de inatividade avaliando condições de parada, Quando requisições em voo ou novo batimento ocorrem durante a checagem, Então recusa o encerramento evitando corrida (P3-C)", () => {
  const agora = 100_000;
  const inatividadeMs = 60_000;

  // Cenário 1: Tudo inativo e tempo expirado -> pode encerrar
  expect(podeEncerrarPorInatividade({
    requisicoesEmVoo: 0,
    ultimoBatimento: agora - 70_000,
    inatividadeMs,
    agora,
  })).toBe(true);

  // Cenário 2: Chegou requisição durante o await -> não pode encerrar
  expect(podeEncerrarPorInatividade({
    requisicoesEmVoo: 1,
    ultimoBatimento: agora - 70_000,
    inatividadeMs,
    agora,
  })).toBe(false);

  // Cenário 3: Chegou batimento recente durante o await -> não pode encerrar
  expect(podeEncerrarPorInatividade({
    requisicoesEmVoo: 0,
    ultimoBatimento: agora - 10_000,
    inatividadeMs,
    agora,
  })).toBe(false);

  // Cenário 4: Ingestão ocupada ou com conversa rodando -> não pode encerrar
  expect(podeEncerrarPorInatividade({
    requisicoesEmVoo: 0,
    ultimoBatimento: agora - 70_000,
    inatividadeMs,
    ocupada: true,
    agora,
  })).toBe(false);

  expect(podeEncerrarPorInatividade({
    requisicoesEmVoo: 0,
    ultimoBatimento: agora - 70_000,
    inatividadeMs,
    conversasRodando: true,
    agora,
  })).toBe(false);
});

test("Dado upload lento em /api/fontes sem batimento, Quando o período de inatividade expira antes do fim do envio, Então o servidor não é encerrado durante a requisição (P2-2)", async () => {
  const raiz = await mkdtemp(join(tmpdir(), "anvilore-fontes-lento-"));
  try {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(raiz, "wiki"), { recursive: true });
    await writeFile(join(raiz, "SCHEMA.md"), "# Schema\n");
    await writeFile(join(raiz, "AGENTS.md"), "# Agentes\n");

    const app = await iniciarServidorUi(raiz, {
      portaInicial: 0,
      token: "token-fontes-1",
      abrirNavegador: false,
      ponte: new PonteFalsa(),
      autoEncerrar: true,
      inatividadeMs: 60,
      intervaloChecagemMs: 15,
    });

    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode("--boundary\r\nContent-Disposition: form-data; name=\"area\"\r\n\r\ngeral\r\n"));
        await new Promise(r => setTimeout(r, 100));
        controller.enqueue(new TextEncoder().encode("--boundary--\r\n"));
        controller.close();
      },
    });

    const resposta = await fetch(`http://127.0.0.1:${app.porta}/api/fontes?token=token-fontes-1`, {
      method: "POST",
      headers: {
        origin: `http://127.0.0.1:${app.porta}`,
        "content-type": "multipart/form-data; boundary=boundary",
      },
      body: stream,
      duplex: "half",
    } as any);

    expect(resposta.status).toBeGreaterThanOrEqual(200);

    await app.encerrar();
    app.servidor.stop(true);
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});
