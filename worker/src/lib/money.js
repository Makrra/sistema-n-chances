// Dinheiro é armazenado em centavos (INTEGER) no D1. A API sempre fala
// reais decimais em JSON (compatível com o formato que o front-end já usa).
export function toCentavos(reais) {
  const n = Number(reais);
  if (Number.isNaN(n)) return 0;
  return Math.round(n * 100);
}

export function fromCentavos(centavos) {
  if (centavos == null) return null;
  return Math.round(centavos) / 100;
}
