import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Servidor SÓ DE TESTE do confianca.json: escuta apenas em 127.0.0.1 e é usado pelos testes dos instaladores (build de teste
// com a URL de loopback embutida; veja --aceitar-url-de-teste em scripts/embutir-instalador.ts). Nunca é usado numa release.
// Uso: bun scripts/servir-confianca-teste.ts <pasta>
//   <pasta>/confianca.json  o que /confianca.json devolve, lido a cada requisição (o teste o reescreve)
//   <pasta>/status          (opcional) código HTTP a devolver no lugar do 200; 3xx devolve um redirecionamento
//   <pasta>/modo            (opcional) "infinito": /confianca.json devolve espaços sem parar (sem content-length, ~800 KB/s);
//                           <pasta>/enviados guarda os bytes já enviados, para provar que o cliente abortou no limite de 64 KiB
//   <pasta>/porta           escrito ao subir: a porta escolhida
//   <pasta>/requisicoes.log uma linha JSON por requisição: { rota, cacheControl, pragma }
const pasta = process.argv[2];
if (!pasta) { console.error("uso: bun scripts/servir-confianca-teste.ts <pasta>"); process.exit(2); }

const servidor = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(req) {
    const rota = new URL(req.url).pathname;
    appendFileSync(join(pasta, "requisicoes.log"), `${JSON.stringify({ rota, cacheControl: req.headers.get("cache-control"), pragma: req.headers.get("pragma") })}\n`);
    if (rota === "/outro.json") return new Response(readFileSync(join(pasta, "confianca.json")));
    if (rota !== "/confianca.json") return new Response("não achei", { status: 404 });
    if (existsSync(join(pasta, "modo")) && readFileSync(join(pasta, "modo"), "utf8").trim() === "infinito") {
      let enviados = 0;
      const bloco = new Uint8Array(4096).fill(32);
      const corpo = new ReadableStream<Uint8Array>({
        async pull(controle) { await Bun.sleep(5); enviados += bloco.length; writeFileSync(join(pasta, "enviados"), String(enviados)); controle.enqueue(bloco); },
      });
      return new Response(corpo, { headers: { "content-type": "application/json" } });
    }
    const status = existsSync(join(pasta, "status")) ? Number(readFileSync(join(pasta, "status"), "utf8").trim()) : 200;
    if (status >= 300 && status < 400) return new Response(null, { status, headers: { location: "/outro.json" } });
    if (status !== 200) return new Response("erro", { status });
    return new Response(readFileSync(join(pasta, "confianca.json")), { headers: { "content-type": "application/json" } });
  },
});
writeFileSync(join(pasta, "porta"), String(servidor.port));
