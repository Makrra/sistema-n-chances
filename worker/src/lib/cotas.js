// Cotas são armazenadas em "meias-cotas" (INTEGER) no D1: 1 cota inteira = 2.
// Evita deriva de ponto flutuante nas somas repetidas (limite de cotas, rateio).
export function toCotasMeias(cotas) {
  const n = Number(cotas);
  if (Number.isNaN(n)) return 0;
  return Math.round(n * 2);
}

export function fromCotasMeias(meias) {
  return meias / 2;
}

// Réplica de calcularValorPorCotas (index.html): soma o preço das cotas
// inteiras com o preço da meia cota (que pode ser diferente da metade do
// valor da cota inteira).
export function valorPorCotasMeias(cotasMeias, valorInteiraCentavos, valorMeiaCentavos) {
  const inteiras = Math.floor(cotasMeias / 2);
  const temMeia = cotasMeias % 2 === 1;
  return inteiras * valorInteiraCentavos + (temMeia ? valorMeiaCentavos : 0);
}
