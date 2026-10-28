function doisDigitos(n: number): string {
  return String(n).padStart(2, "0");
}

// Hora local em ISO 8601 com segundos e offset explícito, o formato que `generated.at` exige.
export function isoComOffset(data: Date): string {
  const offset = -data.getTimezoneOffset();
  const sinal = offset >= 0 ? "+" : "-";
  const absoluto = Math.abs(offset);
  return `${data.getFullYear()}-${doisDigitos(data.getMonth() + 1)}-${doisDigitos(data.getDate())}` +
    `T${doisDigitos(data.getHours())}:${doisDigitos(data.getMinutes())}:${doisDigitos(data.getSeconds())}` +
    `${sinal}${doisDigitos(Math.floor(absoluto / 60))}:${doisDigitos(absoluto % 60)}`;
}
