/**
 * Número digitado do jeito brasileiro — regra pura, roda no navegador.
 *
 * O perigo real (revisão 17/08/2026): "1.500" no campo de valor segurado
 * virava 1.5 no parseFloat — a carga de R$ 1.500 saía segurada por R$ 1,50 e
 * ninguém percebia. A vírgula é decimal ("4,95"); o ponto pode ser decimal
 * ("4.95") OU milhar ("1.500") — e a diferença importa em dinheiro.
 */
export function numeroBR(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  let normalizado: string;
  if (t.includes(",")) {
    // com vírgula, todo ponto é milhar: "1.500,50" → 1500.50
    normalizado = t.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    // só pontos em grupos de 3: milhar brasileiro ("1.500" → 1500)
    normalizado = t.replace(/\./g, "");
  } else {
    normalizado = t; // "4.95" (decimal com ponto) segue como está
  }
  const n = parseFloat(normalizado);
  return Number.isFinite(n) ? n : null;
}
