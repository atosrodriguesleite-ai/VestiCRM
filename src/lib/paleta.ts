/**
 * PALETA DA LOJA — cartela pronta e leitura do código da cor.
 *
 * Fica separado da tela porque é regra, não desenho: a mesma cartela vale
 * para a biblioteca de cores do catálogo, para a identidade visual e para
 * qualquer lugar que venha a pedir uma cor.
 */

/** Cartela de moda: tons que aparecem de verdade em coleção. */
export const CARTELA: { grupo: string; tons: [string, string][] }[] = [
  {
    grupo: "Neutros",
    tons: [
      ["Preto", "#211E1D"],
      ["Grafite", "#4A4A4A"],
      ["Cinza", "#9AA0A6"],
      ["Branco", "#FAF6EF"],
      ["Off-white", "#F5F0E4"],
      ["Bege", "#D8C9A8"],
      ["Nude", "#D9B99B"],
      ["Caramelo", "#A9682B"],
      ["Marrom", "#5C3A21"],
    ],
  },
  {
    grupo: "Quentes",
    tons: [
      ["Vermelho", "#B3252B"],
      ["Vinho", "#6E2536"],
      ["Terracota", "#BC5836"],
      ["Laranja", "#D97435"],
      ["Mostarda", "#C99A2E"],
      ["Amarelo", "#E5B93C"],
      ["Coral", "#E3705E"],
      ["Rosa", "#E8A0BF"],
      ["Pink", "#C94F7C"],
    ],
  },
  {
    grupo: "Frios",
    tons: [
      ["Azul-marinho", "#22314F"],
      ["Azul", "#3B5F8A"],
      ["Azul-claro", "#9CC0DE"],
      ["Verde-militar", "#4A5D3A"],
      ["Verde", "#3E7A5E"],
      ["Menta", "#A8D5C2"],
      ["Lilás", "#B49BD6"],
      ["Roxo", "#6B4A8F"],
      ["Turquesa", "#3E9E9E"],
    ],
  },
];

export const HEX = /^#[0-9a-fA-F]{6}$/;

/** Normaliza o que a pessoa digitar: "a1b2c3", "#A1B2C3", com espaços. */
export function normalizarHex(entrada: string): string | null {
  const limpo = entrada.trim().replace(/\s/g, "");
  const comCerquilha = limpo.startsWith("#") ? limpo : `#${limpo}`;
  // atalho de 3 dígitos (#f0a) vira o de 6 (#ff00aa)
  if (/^#[0-9a-fA-F]{3}$/.test(comCerquilha)) {
    const [, r, g, b] = comCerquilha;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return HEX.test(comCerquilha) ? comCerquilha.toUpperCase() : null;
}

