export function comRetentativaSqlite<T>(executar: () => T, aguardar: (ms: number) => void = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}): T {
  function tentar(tentativa: number): T {
    try { return executar(); }
    catch (erro) {
      const codigo = typeof erro === "object" && erro !== null && "code" in erro ? String((erro as { code: unknown }).code) : "";
      if (!codigo.includes("SQLITE_BUSY") && !codigo.includes("SQLITE_LOCKED") || tentativa >= 5) throw erro;
      aguardar(20 * (2 ** tentativa));
      return tentar(tentativa + 1);
    }
  }
  return tentar(0);
}
