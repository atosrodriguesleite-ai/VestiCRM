/**
 * O TEMA DO CATÁLOGO — as cores derivadas, num lugar só (RN-094).
 *
 * A loja escolhe TRÊS cores (principal, secundária e fundo) em Personalizar
 * catálogo; a vitrine deriva delas o texto, as linhas, o fundo das fotos e o
 * cinza dos detalhes. Essa derivação morava dentro do componente da vitrine.
 *
 * O catálogo em PDF tem que sair com as MESMAS cores — ele é o print do
 * catálogo, não uma revista com identidade própria (pedido do dono,
 * 23/10/2026). Então a conta mora aqui e os dois a importam: trocar a cor da
 * loja muda a tela e o papel juntos.
 */

import { mixHex, readableOn } from "@/lib/color";

export type CoresDaLoja = {
  /** `Company.catalogPrimary` — a cor da marca (topo, preços, destaques) */
  primary: string;
  /** `Company.catalogSecondary` */
  secondary: string;
  /** `Company.catalogBg` — o fundo da página */
  bg: string;
};

export type TemaDoCatalogo = CoresDaLoja & {
  /** texto principal, legível sobre o fundo */
  ink: string;
  /** linhas e bordas finas */
  line: string;
  /** fundo da área de foto do card */
  soft: string;
  /** texto secundário (nome da peça, "/ peça", rodapé) */
  muted: string;
  /** a principal puxada para o escuro */
  dark: string;
};

export function temaDoCatalogo(cores: CoresDaLoja): TemaDoCatalogo {
  return {
    primary: cores.primary,
    secondary: cores.secondary,
    bg: cores.bg,
    ink: readableOn(cores.bg),
    line: mixHex(cores.secondary, cores.primary, 0.06),
    soft: mixHex(cores.secondary, cores.bg, 0.55),
    muted: mixHex(cores.primary, cores.bg, 0.38),
    dark: mixHex(cores.primary, "#000000", 0.45),
  };
}
