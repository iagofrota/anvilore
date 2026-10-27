import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { aprovarPaginas } from "../../comandos/aprovar";
import { caminhoDaCopia, listarFilaRascunhos } from "../../lib/ui-fila";
import { caminhoWiki } from "../../lib/wiki-repo";

type Servidor = ReturnType<typeof Bun.serve>;
type OpcoesServidor = { portaInicial?: number; token?: string; abrirNavegador?: boolean; abrir?: (url: string) => void };

function localHost(request: Request): boolean {
  const host = request.headers.get("host");
  if (!host) return false;
  try { return ["127.0.0.1", "localhost"].includes(new URL(`http://${host}`).hostname.toLowerCase()); }
  catch { return false; }
}

function json(dados: unknown, status = 200): Response {
  return Response.json(dados, { status, headers: { "cache-control": "no-store" } });
}

function tokenValido(url: URL, token: string): boolean {
  const fornecido = url.searchParams.get("token") ?? "";
  const esperado = Buffer.from(token);
  const recebido = Buffer.from(fornecido);
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}

async function validar(raiz: string, wiki: string): Promise<{ codigo: number; saida: string }> {
  const cli = resolve(import.meta.dir, "../../cli.ts");
  const processo = Bun.spawn([process.execPath, cli, "validar", wiki], {
    cwd: raiz,
    env: { ...process.env, ANVILORE_WIKI: wiki },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, codigo] = await Promise.all([new Response(processo.stdout).text(), new Response(processo.stderr).text(), processo.exited]);
  return { codigo, saida: `${stdout}${stderr}`.trim() };
}

function abrirNavegador(url: string): void {
  const comando = process.platform === "win32" ? ["cmd", "/c", "start", "", url]
    : process.platform === "darwin" ? ["open", url]
      : ["xdg-open", url];
  try { Bun.spawn(comando, { stdin: "ignore", stdout: "ignore", stderr: "ignore" }); } catch { /* UI permanece acessível pela URL mostrada */ }
}

export async function iniciarServidorUi(raiz: string, opcoes: OpcoesServidor = {}) {
  const wiki = caminhoWiki(raiz);
  const token = opcoes.token ?? randomBytes(32).toString("base64url");
  const portaInicial = opcoes.portaInicial ?? 4173;
  let servidor: Servidor | undefined;
  let ultimoErro: unknown;

  for (let porta = portaInicial; porta <= 65535; porta++) {
    try {
      servidor = Bun.serve({
        hostname: "127.0.0.1",
        port: porta,
        fetch: async (request) => {
          if (!localHost(request)) return new Response("Acesso recusado", { status: 403 });
          const url = new URL(request.url);
          if (url.pathname === "/favicon.ico" && request.method === "GET") return new Response(null, { status: 204 });
          if (!tokenValido(url, token)) return new Response("Acesso recusado", { status: 403 });
          if (url.pathname === "/api/rascunhos" && request.method === "GET") {
            const fila = await listarFilaRascunhos(raiz);
            return json(await Promise.all(fila.map(async item => {
              const copia = caminhoDaCopia(raiz, item.caminho);
              let anterior: string | undefined;
              if (copia) { try { anterior = await readFile(copia, "utf8"); } catch { /* cópia removida durante a leitura */ } }
              return { ...item, anterior };
            })));
          }
          if (url.pathname === "/api/aprovar" && request.method === "POST") {
            let corpo: { caminho?: unknown };
            try { corpo = await request.json() as { caminho?: unknown }; } catch { return json({ codigo: 2, mensagens: ["Pedido inválido."] }, 400); }
            if (typeof corpo.caminho !== "string") return json({ codigo: 2, mensagens: ["Página inválida."] }, 400);
            const fila = await listarFilaRascunhos(raiz);
            const item = fila.find(rascunho => rascunho.caminho === corpo.caminho && rascunho.aprovavel);
            if (!item) return json({ codigo: 1, mensagens: ["Aprovação recusada: página ausente da fila ou inválida."] }, 409);
            const resultado = await aprovarPaginas(raiz, [join(wiki, item.caminho)]);
            return json(resultado, resultado.codigo === 0 ? 200 : 409);
          }
          if (url.pathname === "/api/validar" && request.method === "POST") return json(await validar(raiz, wiki));
          if (request.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/assets/"))) {
            const raizPublica = resolve(import.meta.dir, "../public");
            const caminho = url.pathname === "/" ? join(raizPublica, "index.html") : resolve(raizPublica, `.${url.pathname}`);
            const caminhoRelativo = relative(raizPublica, caminho);
            if (caminhoRelativo === ".." || caminhoRelativo.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(caminhoRelativo)) return new Response("Não encontrado", { status: 404 });
            try {
              const arquivo = await readFile(caminho);
              const tipo = caminho.endsWith(".html") ? "text/html; charset=utf-8" : caminho.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8";
              const conteudo = tipo.startsWith("text/html") ? arquivo.toString().replaceAll("__ANVILORE_TOKEN__", token) : arquivo;
              return new Response(conteudo, { headers: { "content-type": tipo, "cache-control": "no-store", "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'" } });
            } catch { return new Response("Interface ainda não compilada. Execute bun run build:ui.", { status: 503 }); }
          }
          return new Response("Não encontrado", { status: 404 });
        },
      });
      break;
    } catch (erro) {
      const code = (erro as NodeJS.ErrnoException).code;
      if (code !== "EADDRINUSE") throw erro;
      ultimoErro = erro;
    }
  }
  if (!servidor) throw new Error(`Não há porta livre para a interface: ${(ultimoErro as Error | undefined)?.message ?? "sem portas disponíveis"}`);

  const url = `http://127.0.0.1:${servidor.port}/?token=${encodeURIComponent(token)}`;
  if (opcoes.abrirNavegador !== false) (opcoes.abrir ?? abrirNavegador)(url);
  return { servidor, porta: servidor.port, token, url };
}
