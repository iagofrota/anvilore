import { atualizar } from "../../src/lib/atualizacao";
import { gitReal, respostaDaLista } from "./kit-atualizavel";

// Roda `atualizar aplicar` num processo separado e se mata com SIGKILL ao entrar no instalar: queda real no meio
// da atualização, com a trava e o estado "aplicando" deixados no disco. Uso: bun atualizar-e-morrer.ts <raiz> <tag> <fingerprint>.
const [raiz, tag, fingerprint] = process.argv.slice(2);
if (!raiz || !tag || !fingerprint) throw new Error("uso: atualizar-e-morrer.ts <raiz> <tag> <fingerprint>");
const git = gitReal(raiz);
await atualizar("aplicar", {
  raiz,
  executar: (args: string[]) => args[0] === "fetch" ? { codigo: 0, saida: "" } : git(args),
  releases: async () => [{ tag_name: tag, draft: false, prerelease: false }],
  instalarDependencias: async () => 0,
  versaoBun: async () => "1.4.1",
  buscarConfianca: async () => respostaDaLista({ formato: 1, chaves: [fingerprint], versaoMinima: "0.0.0" }),
  instalar: async () => { process.kill(process.pid, "SIGKILL"); return 0; },
});
