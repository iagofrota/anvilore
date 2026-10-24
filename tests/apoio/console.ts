import { spyOn } from "bun:test";

export function capturarConsole() {
  const saida: string[] = [];
  const erros: string[] = [];
  const avisos: string[] = [];
  const spies = [
    spyOn(console, "log").mockImplementation((...args) => { saida.push(args.join(" ")); }),
    spyOn(console, "error").mockImplementation((...args) => { erros.push(args.join(" ")); }),
    spyOn(console, "warn").mockImplementation((...args) => { avisos.push(args.join(" ")); }),
  ];
  return { saida, erros, avisos, restaurar: () => { for (const spy of spies) spy.mockRestore(); } };
}
