/**
 * ENQUADRAMENTO DA FOTO DO PRODUTO (RN-107).
 *
 * Pedido do dono (03/11/2026): "quando a pessoa vai subir a foto do produto,
 * poder centralizar ou recortar para ficar certinho". Hoje o card do
 * catálogo é um quadro 3:4 que corta a foto às CEGAS (pelo topo, centrado),
 * e o PDF corta pelo centro: a foto deitada perde os lados e a peça some; a
 * foto com muito chão deixa a peça miúda.
 *
 * A decisão: ENQUADRAR, não recortar. A loja escolhe a janela 3:4 em cima da
 * foto e o sistema guarda só QUATRO números — a posição e o tamanho da
 * janela em FRAÇÕES da foto (0..1). A foto fica inteira no banco (a ficha da
 * peça e a galeria de fotos para a cliente, RN-071, continuam mostrando tudo),
 * nada dobra de peso (dívida nº 1) e dá para reenquadrar sem subir a foto de
 * novo. O card do catálogo obedece por CSS; o PDF obedece pelo sharp — a
 * MESMA janela nos dois (dinheiro e foto não divergem entre telas, a régua
 * da RN-094).
 *
 * Este arquivo é PURO: a tela, a porta e o PDF importam a mesma régua.
 */

import { z } from "zod";

/** a janela: x/y = canto superior esquerdo, w/h = tamanho — frações da foto */
export type Enquadramento = { x: number; y: number; w: number; h: number };

/**
 * O que as portas aceitam no campo `enquadramento` de uma foto: a janela,
 * `null` (tirar) ou ausente (preservar). A janela é conferida pela MESMA
 * régua da leitura (`lerEnquadramento`): número fora de 0..1 ou janela que
 * sai da foto é recusado com 400, nunca gravado torto.
 */
export const enquadramentoSchema = z
  .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
  .refine((e) => lerEnquadramento(e) !== null, { message: "Enquadramento inválido" })
  .nullable()
  .optional();

/** a proporção do card do catálogo: largura ÷ altura (3:4) */
export const PROPORCAO_DO_CARD = 3 / 4;

/** a janela nunca fica menor que isto da largura da foto (zoom máximo) */
export const JANELA_MINIMA = 0.2;

const fracao = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

/**
 * Lê o que veio do banco ou do navegador. Valor torto (não é objeto, número
 * fora de 0..1, janela que sai da foto ou janela sem tamanho) vira `null` =
 * sem enquadramento — o card cai no corte de sempre, nunca quebra.
 */
export function lerEnquadramento(bruto: unknown): Enquadramento | null {
  if (!bruto || typeof bruto !== "object") return null;
  const { x, y, w, h } = bruto as Record<string, unknown>;
  if (!fracao(x) || !fracao(y) || !fracao(w) || !fracao(h)) return null;
  if (w <= 0.001 || h <= 0.001) return null;
  if (x + w > 1.0001 || y + h > 1.0001) return null;
  return { x, y, w, h };
}

/** arredonda as frações (4 casas bastam: 1/10.000 de uma foto de 4.000 px é meio pixel) */
function arredondar(e: Enquadramento): Enquadramento {
  const r = (v: number) => Math.round(v * 10000) / 10000;
  return { x: r(e.x), y: r(e.y), w: r(e.w), h: r(e.h) };
}

/**
 * A altura da janela (fração) que faz a janela ter a proporção do card EM
 * PIXELS: w·W / (h·H) = 3/4.
 */
function alturaDaJanela(w: number, largura: number, altura: number): number {
  return (w * largura) / (altura * PROPORCAO_DO_CARD);
}

/**
 * Os limites da largura da janela numa foto: a maior (a foto inteira na
 * largura, ou a que faz a altura caber — foto deitada é limitada pela
 * largura; foto em pé, pela altura) e a menor (o zoom máximo). UMA conta,
 * usada por `encaixar` e pelo controle de zoom do editor.
 */
export function limitesDaLargura(largura: number, altura: number): { minW: number; maxW: number } {
  if (!(largura > 0) || !(altura > 0)) return { minW: 1, maxW: 1 };
  const maxW = Math.min(1, (altura * PROPORCAO_DO_CARD) / largura);
  return { minW: Math.min(JANELA_MINIMA, maxW), maxW };
}

/**
 * Encaixa uma janela na foto: tamanho entre o mínimo e o que cabe, com a
 * proporção do card, e posição dentro da foto. É a única função que escreve
 * uma janela — mover e dar zoom passam por aqui, então a janela gravada
 * nunca sai da foto nem perde a proporção.
 */
export function encaixar(
  { x, y, w }: { x: number; y: number; w: number },
  largura: number,
  altura: number
): Enquadramento {
  if (!(largura > 0) || !(altura > 0)) return { x: 0, y: 0, w: 1, h: 1 };
  const { minW, maxW } = limitesDaLargura(largura, altura);
  const wOk = Math.min(maxW, Math.max(minW, Number.isFinite(w) ? w : maxW));
  const hOk = Math.min(1, alturaDaJanela(wOk, largura, altura));
  const xOk = Math.min(1 - wOk, Math.max(0, Number.isFinite(x) ? x : 0));
  const yOk = Math.min(1 - hOk, Math.max(0, Number.isFinite(y) ? y : 0));
  return arredondar({ x: xOk, y: yOk, w: wOk, h: hOk });
}

/**
 * A janela de PARTIDA do editor: a maior janela 3:4 que cabe, ancorada no
 * topo e centrada na largura — exatamente o que o card mostra hoje sem
 * enquadramento (`object-cover object-top`). Assim "ajustar" começa do que
 * a loja já vê, e não de um lugar surpresa.
 */
export function enquadramentoInicial(largura: number, altura: number): Enquadramento {
  const base = encaixar({ x: 0, y: 0, w: 1 }, largura, altura);
  return encaixar({ x: (1 - base.w) / 2, y: 0, w: base.w }, largura, altura);
}

/** move a janela (deltas em frações da foto), sem sair da foto */
export function mover(e: Enquadramento, dx: number, dy: number, largura: number, altura: number): Enquadramento {
  return encaixar({ x: e.x + dx, y: e.y + dy, w: e.w }, largura, altura);
}

/**
 * Dá zoom mantendo o CENTRO da janela: `fator` < 1 aproxima (janela menor),
 * > 1 afasta. O centro fica no lugar porque é o que a pessoa está olhando.
 */
export function comZoom(e: Enquadramento, fator: number, largura: number, altura: number): Enquadramento {
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  const w = e.w * fator;
  const h = alturaDaJanela(w, largura, altura);
  return encaixar({ x: cx - w / 2, y: cy - h / 2, w }, largura, altura);
}

/** a janela em PIXELS da foto (para o sharp), inteira e dentro da foto */
export function janelaEmPixels(
  e: Enquadramento,
  largura: number,
  altura: number
): { left: number; top: number; width: number; height: number } {
  const left = Math.min(largura - 1, Math.max(0, Math.round(e.x * largura)));
  const top = Math.min(altura - 1, Math.max(0, Math.round(e.y * altura)));
  const width = Math.max(1, Math.min(largura - left, Math.round(e.w * largura)));
  const height = Math.max(1, Math.min(altura - top, Math.round(e.h * altura)));
  return { left, top, width, height };
}

/**
 * O estilo que mostra SÓ a janela dentro de um quadro 3:4 (o card): a imagem
 * é ampliada para a LARGURA da janela ocupar o quadro inteiro e deslocada
 * para o canto da janela. A altura fica `auto` DE PROPÓSITO: a imagem segue
 * a proporção natural dela, então uma janela que não seja exatamente 3:4
 * (gravada por um cliente antigo, ou torta) nunca DEFORMA a foto — no pior
 * caso mostra um pouco mais ou menos de altura, como o PDF, que recorta a
 * janela e cobre o quadro pelo topo (achado da revisão: a altura esticada
 * em separado espremia a modelo). Quem usa põe o quadro com `position:
 * relative`, `overflow: hidden` e a proporção do card.
 */
export function estiloDaJanela(e: Enquadramento): {
  position: "absolute";
  left: string;
  top: string;
  width: string;
  height: "auto";
  maxWidth: "none";
} {
  const pct = (v: number) => `${Math.round(v * 10000) / 100}%`;
  return {
    position: "absolute",
    left: pct(-e.x / e.w),
    top: pct(-e.y / e.h),
    width: pct(1 / e.w),
    height: "auto",
    maxWidth: "none",
  };
}

/** duas janelas iguais (na precisão gravada)? — a tela só manda o que mudou */
export function mesmoEnquadramento(a: Enquadramento | null | undefined, b: Enquadramento | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  const r = arredondar(a);
  const s = arredondar(b);
  return r.x === s.x && r.y === s.y && r.w === s.w && r.h === s.h;
}
