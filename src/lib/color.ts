/** Utilitários de cor para o tema do catálogo personalizável. */

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function toHex(n: number): string {
  return Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, "0");
}

/** Mistura duas cores: weight=0 → a, weight=1 → b. */
export function mixHex(a: string, b: string, weight: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return (
    "#" +
    toHex(ar + (br - ar) * weight) +
    toHex(ag + (bg - ag) * weight) +
    toHex(ab + (bb - ab) * weight)
  );
}

/** Texto legível (claro/escuro) sobre uma cor de fundo. */
export function readableOn(bg: string): string {
  const [r, g, b] = hexToRgb(bg);
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  return luma > 150 ? "#1a1523" : "#ffffff";
}
