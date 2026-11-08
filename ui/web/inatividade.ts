export const MENSAGEM_DESCONEXAO = "Conexão com o Anvilore perdida. Tentando reconectar…";

export function criarControladorBatimento(opcoes: {
  enviar: () => Promise<void>;
  aoFalhar: () => void;
  aoRecuperar?: () => void;
  intervaloMs?: number;
  limiteFalhas?: number;
}): () => void {
  const intervaloMs = opcoes.intervaloMs ?? 20_000;
  const limiteFalhas = opcoes.limiteFalhas ?? 3;
  let timer: ReturnType<typeof setInterval> | undefined;
  let ativo = true;
  let falhasConsecutivas = 0;

  const disparar = async () => {
    if (!ativo) return;
    try {
      await opcoes.enviar();
      if (!ativo) return;
      if (falhasConsecutivas > 0) {
        falhasConsecutivas = 0;
        opcoes.aoRecuperar?.();
      }
    } catch {
      if (!ativo) return;
      falhasConsecutivas++;
      if (falhasConsecutivas >= limiteFalhas) {
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
