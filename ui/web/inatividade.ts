export const MENSAGEM_INATIVIDADE = "O Anvilore foi fechado por inatividade. Clique no ícone para abrir de novo.";

export function criarControladorBatimento(opcoes: {
  enviar: () => Promise<void>;
  aoFalhar: () => void;
  intervaloMs?: number;
}): () => void {
  const intervaloMs = opcoes.intervaloMs ?? 20_000;
  let timer: ReturnType<typeof setInterval> | undefined;
  let ativo = true;

  const disparar = async () => {
    if (!ativo) return;
    try {
      await opcoes.enviar();
    } catch {
      if (ativo) {
        opcoes.aoFalhar();
      }
    }
  };

  void disparar();
  timer = setInterval(disparar, intervaloMs);

  const onAtividade = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      void disparar();
    }
  };

  const onFocus = () => {
    void disparar();
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onAtividade);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("focus", onFocus);
  }

  return () => {
    ativo = false;
    if (timer) clearInterval(timer);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onAtividade);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", onFocus);
    }
  };
}
