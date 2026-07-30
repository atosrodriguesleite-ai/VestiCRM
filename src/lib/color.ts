/** Utilitários de cor para o tema do catálogo personalizável. */

/**
 * BOLINHA DE COR DO CATÁLOGO.
 *
 * A cor cadastrada pela loja em "Suas cores" tem que valer SEMPRE — e valia
 * só quando o nome batia letra por letra. A lojista cadastrou "Café" e a
 * variação veio da Nuvemshop como "cafe": não casava, e a peça aparecia com
 * a bolinha cinza de "cor desconhecida". Acento, maiúscula e espaço sobrando
 * não podem separar a mesma cor.
 */

/** Cinza neutro de "não sei que cor é essa". */
export const COR_NEUTRA = "#C9BEB0";

/** chave de comparação: sem acento, sem maiúscula, sem espaço sobrando */
export const chaveDeCor = (nome: string | null | undefined) =>
  (nome ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();

/** Cores que o sistema já conhece de fábrica (a loja pode sobrescrever). */
export const CORES_PADRAO: Record<string, string> = {
  preto: "#211E1D", branco: "#FAF6EF", "off-white": "#F5F0E4",
  vinho: "#6E2536", caramelo: "#B07636", terracota: "#BC5836",
  rosa: "#E8A0BF", nude: "#D9B99B", azul: "#3B5F8A", verde: "#3E7A5E",
  amarelo: "#E5B93C", lilas: "#B49BD6", bege: "#D8C9A8",
  laranja: "#D97435", vermelho: "#B33939", cinza: "#8C8C8C", marrom: "#4B3621",
  cafe: "#6F4E37", "off white": "#F5F0E4",
};

/**
 * Monta o resolvedor da bolinha: cor da LOJA primeiro, depois as de fábrica,
 * e só então o cinza neutro.
 */
export function makeSwatch(custom: { name: string; hex: string }[]) {
  const daLoja = new Map(custom.map((c) => [chaveDeCor(c.name), c.hex]));
  return (color: string) => {
    const k = chaveDeCor(color);
    return daLoja.get(k) ?? CORES_PADRAO[k] ?? COR_NEUTRA;
  };
}

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
