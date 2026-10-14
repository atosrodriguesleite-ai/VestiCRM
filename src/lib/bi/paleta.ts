import { brl } from "../format";

/**
 * A PALETA DO BI (RN-089) — pura, validada, e UMA para os gráficos vivos.
 *
 * A disciplina (dataviz): a cor faz um trabalho só por gráfico. Série de
 * tempo = UMA cor (o cobre da marca; série única não tem legenda, o título
 * diz o que é). Funil = rampa ORDINAL de um matiz, do claro ao escuro — e o
 * degrau mais claro tem que ficar ≥ 2:1 sobre a superfície; a rampa antiga
 * começava num ocre a 1,81:1 (reprovado pelo validador), então o funil usa
 * quatro degraus a partir do ocre médio (2,48:1). Barras de categoria = a
 * mesma cor em todas (colorir por valor gastaria a cor para repetir o que o
 * comprimento já diz). Vermelho/âmbar/verde são STATUS (prazo, sem
 * resposta) e nunca viram cor de série — "por que não fechou" deixou de ser
 * vermelho. Validado com `validate_palette.js --ordinal` sobre as DUAS
 * superfícies (clara #fffdf9, escura #241c13); o teste guarda o contraste
 * por conta própria. O tema escuro NÃO é a rampa clara invertida: é uma
 * rampa própria, selecionada e validada sobre a superfície escura (o
 * espresso da rampa clara sumia a 1,22:1 lá) — os degraus moram em tokens
 * CSS (`--gv-funil-N`) e o funil pinta por `corDoFunil`, que devolve o
 * token, para o tema trocar a cor sem o componente saber de tema.
 */

/** a cor da série (cobre da marca): 4,03:1 sobre #fffdf9 e 4,10:1 sobre #241c13 */
export const COR_DA_SERIE = "#c4622d";
/** a superfície dos cartões (o `--color-surface` do app) */
export const SUPERFICIE = "#fffdf9";
/** a superfície dos cartões no tema escuro (`.theme-dark --color-surface`) */
export const SUPERFICIE_ESCURA = "#241c13";
/**
 * A rampa ORDINAL da casa, clara → escura, 4 degraus (validada). É a dona:
 * `charts.tsx` (o funil de Relatórios/Inteligência) e o funil do BI leem
 * daqui — a rampa de 5 degraus que morava em `charts.tsx` começava no ocre
 * claro reprovado. Os mesmos quatro valores estão em `globals.css`
 * (`:root { --gv-funil-N }`); o teste confere que concordam.
 */
export const RAMPA_ORDINAL = ["#c99b5f", "#c4622d", "#8a4420", "#3a2a1e"] as const;
/**
 * A rampa do tema escuro: do creme ao cobre, escurecendo (validada sobre
 * #241c13 — degrau mais claro 10,9:1, o último 4,10:1). Em
 * `globals.css` (`.theme-dark { --gv-funil-N }`).
 */
export const RAMPA_ORDINAL_ESCURA = ["#ebcdb2", "#dfab80", "#d28655", "#c4622d"] as const;

/** o degrau (1..4) de RESERVA da etapa `i` de um funil com `n` etapas: o token inteiro mais perto, por baixo */
export function degrauDoFunil(i: number, n: number): number {
  const degraus = RAMPA_ORDINAL.length;
  if (n <= degraus) return Math.min(i, degraus - 1) + 1;
  return Math.min(Math.floor((i / Math.max(n - 1, 1)) * (degraus - 1)), degraus - 1) + 1;
}

/**
 * A cor da etapa `i` de um funil com `n` etapas, em cima dos tokens CSS
 * (`--gv-funil-N`, que o tema claro/escuro resolve). Até 4 etapas, um
 * degrau por etapa. Com mais (o funil de Relatórios tem 9), a cor é
 * INTERPOLADA entre os dois degraus vizinhos (`color-mix`, no mesmo matiz —
 * continua ordinal e monótona; três etapas seguidas da mesma cor liam como um
 * grupo, não como progressão). O navegador antigo que não entende
 * `color-mix` descarta a declaração inline e cai na classe `.gv-funil`,
 * que pinta pelo degrau de reserva (`degrauDoFunil`).
 */
export function corDoFunil(i: number, n: number): string {
  const degraus = RAMPA_ORDINAL.length;
  if (n <= degraus) return `var(--gv-funil-${Math.min(i, degraus - 1) + 1})`;
  const t = (i / Math.max(n - 1, 1)) * (degraus - 1);
  const k = Math.min(Math.floor(t), degraus - 2);
  const fracao = Math.round((t - k) * 100);
  if (fracao === 0) return `var(--gv-funil-${k + 1})`;
  if (fracao === 100) return `var(--gv-funil-${k + 2})`;
  return `color-mix(in oklab, var(--gv-funil-${k + 1}) ${100 - fracao}%, var(--gv-funil-${k + 2}))`;
}

/** o estilo inline da barra do funil: a cor (interpolada) e a reserva por variável, lida pela classe `.gv-funil` */
export function estiloDoFunil(i: number, n: number): Record<string, string> {
  return { "--gv-funil-base": `var(--gv-funil-${degrauDoFunil(i, n)})`, backgroundColor: corDoFunil(i, n) };
}

/** o formato de um valor — serializável, porque atravessa a fronteira servidor → navegador (função não passa) */
export type FormatoDoValor = "int" | "brl" | { pctDe: number };

/** UM formatador de dinheiro (o `brl` da casa): "R$ 200" sem centavos à toa, "R$ 1.234,50" com */
export function formatarValor(v: number, formato: FormatoDoValor = "int"): string {
  if (formato === "brl") return brl(v);
  if (typeof formato === "object") return `${v} (${formato.pctDe ? Math.round((v / formato.pctDe) * 100) : 0}%)`;
  return String(v);
}

/** largura reservada para um rótulo de eixo (dd/mm a 10px) */
export const LARGURA_DO_EIXO = 28;

export type GeometriaDaSerie = {
  w: number;
  h: number;
  pad: { top: number; right: number; bottom: number; left: number };
  n: number;
  max: number;
  iw: number;
  ih: number;
  step: number;
  xy: [number, number][];
  linha: string;
  area: string;
  maxIdx: number;
  /** os rótulos diretos, já posicionados: o pico e o último — o último sai se colidir com o pico; o x é preso dentro da área */
  rotulos: { i: number; x: number; y: number }[];
  /** os índices com rótulo de eixo (até ~6, sempre o último; o vizinho que encostaria no último sai) */
  eixo: number[];
};

/** a geometria da série de tempo (pura, testável): posições, caminhos, pico, rótulos sem colisão */
export function geometriaDaSerie(
  points: number[],
  opcoes: { w?: number; h?: number; pad?: GeometriaDaSerie["pad"]; larguraDoRotulo?: (i: number) => number } = {}
): GeometriaDaSerie {
  const w = opcoes.w ?? 600;
  const h = opcoes.h ?? 180;
  const pad = opcoes.pad ?? { top: 18, right: 10, bottom: 24, left: 10 };
  const n = points.length;
  const maior = n ? Math.max(...points) : 0;
  const max = Math.max(maior, 1);
  const iw = w - pad.left - pad.right;
  const ih = h - pad.top - pad.bottom;
  const step = n > 1 ? iw / (n - 1) : iw;
  const xy = points.map((v, i): [number, number] => [pad.left + i * step, pad.top + ih - (v / max) * ih]);
  const linha = xy.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = n ? `${linha} L${(pad.left + (n - 1) * step).toFixed(1)},${pad.top + ih} L${pad.left},${pad.top + ih} Z` : "";
  const maxIdx = n ? points.indexOf(maior) : -1;
  const largura = (i: number) => opcoes.larguraDoRotulo?.(i) ?? 60;
  // o rótulo é centrado no ponto, mas preso dentro da área: metade da largura de cada lado
  const posicao = (i: number) => {
    const meia = largura(i) / 2;
    return { i, x: Math.min(Math.max(xy[i][0], meia), w - meia), y: Math.max(xy[i][1] - 10, 12) };
  };
  const rotulos: GeometriaDaSerie["rotulos"] = [];
  if (n) {
    const pico = posicao(maxIdx);
    rotulos.push(pico);
    const ultimo = n - 1;
    if (ultimo !== maxIdx) {
      const u = posicao(ultimo);
      // colisão é pela posição PRESA (as duas podem ter escorregado para a borda), não pelo índice
      if (Math.abs(u.x - pico.x) >= (largura(ultimo) + largura(maxIdx)) / 2) rotulos.push(u);
    }
  }
  const cada = Math.max(1, Math.ceil(n / 6));
  let eixo = points.map((_, i) => i).filter((i) => i % cada === 0 || i === n - 1);
  // o vizinho que encostaria no rótulo do último sai (12 pontos: 0,2,4,6,8,10 e 11 — o 10 colava no 11)
  if (eixo.length >= 2) {
    const ultimo = eixo[eixo.length - 1];
    const vizinho = eixo[eixo.length - 2];
    if ((ultimo - vizinho) * step < LARGURA_DO_EIXO) eixo = eixo.filter((i) => i !== vizinho);
  }
  return { w, h, pad, n, max, iw, ih, step, xy, linha, area, maxIdx, rotulos, eixo };
}

/** luminância relativa (WCAG) */
function luminancia(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const canal = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255);
}

/** contraste WCAG entre duas cores (≥ 1) */
export function contraste(a: string, b: string): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  const [claro, escuro] = la > lb ? [la, lb] : [lb, la];
  return (claro + 0.05) / (escuro + 0.05);
}

export type EtapaDoFunil = { label: string; value: number };

/** conversão de cada etapa: % da anterior e % da primeira (nulos sem base) — puro */
export function conversaoDoFunil(etapas: EtapaDoFunil[]): { daAnterior: number | null; daPrimeira: number | null }[] {
  const primeira = etapas[0]?.value ?? 0;
  return etapas.map((e, i) => {
    const anterior = i === 0 ? null : etapas[i - 1].value;
    return {
      daAnterior: anterior ? Math.round((e.value / anterior) * 100) : null,
      daPrimeira: i === 0 ? null : primeira ? Math.round((e.value / primeira) * 100) : null,
    };
  });
}

/** o índice do ponto mais perto de uma posição horizontal (0..1) — puro */
export function indiceMaisPerto(fracao: number, n: number): number {
  if (n <= 1) return 0;
  return Math.max(0, Math.min(n - 1, Math.round(fracao * (n - 1))));
}

/** onde ancorar o balão: perto da borda direita ele se alinha à direita, perto da esquerda à esquerda (nunca sai da caixa) */
export function posicaoDoBalao(fracaoX: number): "esquerda" | "centro" | "direita" {
  if (fracaoX > 0.75) return "direita";
  if (fracaoX < 0.25) return "esquerda";
  return "centro";
}
