// Simula o processo morto no meio da etapa (queda de energia, janela fechada): sai sem rodar limpeza nenhuma.
import { migrarRastreio, puxar } from "../../src/lib/migracao";

const [pasta, modo] = process.argv.slice(2);
const morrer = (etapa: string) => { if (etapa === (modo === "puxar" ? "puxar" : "conferir")) process.exit(9); };
await (modo === "puxar" ? puxar(pasta!, { aoEntrarNaEtapa: morrer }) : migrarRastreio(pasta!, { aoEntrarNaEtapa: morrer }));
process.exit(0);
