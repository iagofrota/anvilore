import { iniciarServidorUi } from "../ui/servidor/servidor";

type AppUi = Awaited<ReturnType<typeof iniciarServidorUi>>;

export async function esperarEncerramento(
  servidor: AppUi["servidor"],
  registrar: (sinal: "SIGINT" | "SIGTERM", callback: () => void) => void = (sinal, callback) => process.once(sinal, callback),
  encerrar: () => Promise<void> = async () => {},
): Promise<void> {
  await new Promise<void>(resolver => {
    let sinalRecebido = false;
    const aoEncerrar = () => {
      if (sinalRecebido) return;
      sinalRecebido = true;
      servidor.stop(true);
      void encerrar().catch(erro => console.error(`Falha ao encerrar a ingestão: ${(erro as Error).message}`)).finally(resolver);
    };
    registrar("SIGINT", aoEncerrar);
    registrar("SIGTERM", aoEncerrar);
  });
}

export async function comandoUi(
  args: string[],
  iniciar = iniciarServidorUi,
  esperar = esperarEncerramento,
): Promise<number> {
  if (args.length) {
    console.error("Uso: anvilore ui");
    return 2;
  }
  const raiz = process.env.ANVILORE_DESTINO ?? process.cwd();
  let app: AppUi;
  try { app = await iniciar(raiz); }
  catch (erro) { console.error(`Não foi possível abrir a interface: ${(erro as Error).message}`); return 1; }
  console.log(`Interface do Anvilore aberta em ${app.url}`);
  await esperar(app.servidor, undefined, app.encerrar);
  return 0;
}
