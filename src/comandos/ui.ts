import { iniciarServidorUi } from "../ui/servidor/servidor";

type AppUi = Awaited<ReturnType<typeof iniciarServidorUi>>;

export async function esperarEncerramento(
  servidor: AppUi["servidor"],
  registrar: (sinal: "SIGINT" | "SIGTERM", callback: () => void) => void = (sinal, callback) => process.once(sinal, callback),
): Promise<void> {
  await new Promise<void>(resolver => {
    const encerrar = () => { servidor.stop(true); resolver(); };
    registrar("SIGINT", encerrar);
    registrar("SIGTERM", encerrar);
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
  catch (erro) { console.error(`Não foi possível abrir a Revisão: ${(erro as Error).message}`); return 1; }
  console.log(`Revisão aberta em ${app.url}`);
  await esperar(app.servidor);
  return 0;
}
