import { z } from "zod";

/**
 * O PREÇO DO CATÁLOGO DE REVENDA POR CATEGORIA (RN-109) — regra PURA, sem
 * banco: a janela da ficha do pedido e a rota do PDF importam daqui, e a
 * prévia que a vendedora vê é a MESMA conta que sai no papel.
 *
 * Pedido do dono (06/11/2026): *"no catálogo de revenda, poder colocar os
 * preços das categorias de forma personalizada, da forma que o cliente
 * final quiser"*. Antes só havia UMA margem para o pedido inteiro.
 *
 * A régua: cada categoria presente no pedido pode ter a sua regra — uma
 * MARGEM em % sobre o que a revendedora pagou, ou um PREÇO FIXO em reais
 * para toda peça da categoria; sem regra, vale a margem geral de sempre. O
 * arredondamento para ,90 vale só sobre a margem (o preço fixo é o número
 * que a pessoa digitou — arredondá-lo seria mudar o que ela decidiu). O
 * preço fixo tem um buraco dito na tela: a mesma categoria mistura custos
 * (a regata lisa de R$ 32 e a estampada de R$ 45 saindo as duas a R$ 59,90
 * dão margens muito diferentes), então a prévia AVISA quando o fixo fica
 * abaixo ou perto do que ela pagou em alguma peça.
 */

export const TIPOS_DE_REGRA = ["margem", "fixo"] as const;
export type TipoDeRegra = (typeof TIPOS_DE_REGRA)[number];
export type RegraDeCategoria = { tipo: TipoDeRegra; valor: number };
export type RegrasPorCategoria = Record<string, RegraDeCategoria>;

/** a categoria das peças sem categoria no cadastro (texto livre, loja online que não casou) */
export const CATEGORIA_OUTRAS = "Outras";
/** teto de categorias numa regra (um pedido não tem mais que isso; é só para a porta não engolir lixo) */
export const TETO_DE_CATEGORIAS = 60;
/** preço fixo acima disto é dedo errado */
export const TETO_DO_PRECO_FIXO = 100_000;
/** margem acima disto é dedo errado (a margem geral já aceitava qualquer número — aqui não) */
export const TETO_DA_MARGEM = 1000;
/** nome de categoria mais comprido que isto não ganha regra própria (o cadastro não limita o nome; a porta limita a regra) */
export const TETO_DO_NOME = 200;

/**
 * UMA regra: o tipo da lista e o valor dentro do teto DO TIPO — a margem
 * pode ser 0% (vender pelo custo é decisão), o preço fixo nunca é zero (R$
 * 0,00 no papel não é preço, é dedo errado). A porta e o leitor da ficha
 * passam pela mesma forma.
 */
export const regraSchema = z
  .object({ tipo: z.enum(TIPOS_DE_REGRA), valor: z.number().finite().min(0) })
  .superRefine((r, ctx) => {
    if (r.tipo === "fixo" && (r.valor <= 0 || r.valor > TETO_DO_PRECO_FIXO))
      ctx.addIssue({ code: "custom", message: "preço fixo fora do teto" });
    if (r.tipo === "margem" && r.valor > TETO_DA_MARGEM)
      ctx.addIssue({ code: "custom", message: "margem fora do teto" });
  });

/** a forma que a porta aceita: até 60 categorias, nome dentro do teto, cada regra válida */
export const regrasSchema = z
  .record(z.string().trim().min(1).max(TETO_DO_NOME), regraSchema)
  .refine((r) => Object.keys(r).length <= TETO_DE_CATEGORIAS, "categorias demais");

/** "R$ 1.299,90" — o formato do preço no papel E na prévia (um só) */
export function formatarPreco(v: number): string {
  return `R$ ${v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

/**
 * Lê o que está GUARDADO (o JSON da ficha, ou o que veio pela URL): a
 * categoria torta é PULADA — o resto vale — e o que não é objeto vira
 * "sem regra nenhuma". Nunca derruba a ficha nem o PDF.
 */
export function lerRegrasDeCategoria(cru: unknown): RegrasPorCategoria {
  if (!cru || typeof cru !== "object" || Array.isArray(cru)) return {};
  const saida: RegrasPorCategoria = {};
  for (const [nome, regra] of Object.entries(cru as Record<string, unknown>)) {
    const chave = nome.trim();
    if (!chave || chave.length > TETO_DO_NOME) continue;
    const lida = regraSchema.safeParse(regra);
    if (!lida.success) continue;
    saida[chave] = lida.data;
  }
  return saida;
}

/** o nome da categoria como a régua a vê: sem espaços nas pontas; vazia é "Outras" */
export function nomeDaCategoria(categoria: string | null | undefined): string {
  const limpa = (categoria ?? "").trim();
  return limpa || CATEGORIA_OUTRAS;
}

/** preço psicológico terminando em ,90 (70 → 69,90; 65 → 64,90) */
export function arredondarPara90(v: number): number {
  return Math.max(0, Math.round(v) - 0.1);
}

export type OpcoesDePreco = {
  /** a margem geral em %, para a categoria sem regra própria */
  margemGeral: number;
  /** arredondar para ,90 (só a margem; o fixo é o digitado) */
  arredondar: boolean;
  regras: RegrasPorCategoria;
};

/** a regra que vale para uma categoria: a própria, ou a margem geral */
export function regraQueVale(categoria: string | null | undefined, o: OpcoesDePreco): RegraDeCategoria {
  return o.regras[nomeDaCategoria(categoria)] ?? { tipo: "margem", valor: o.margemGeral };
}

/** O preço de revenda de UMA peça: o que ela pagou × a regra da categoria. */
export function precoDeRevenda(pago: number, categoria: string | null | undefined, o: OpcoesDePreco): number {
  const regra = regraQueVale(categoria, o);
  if (regra.tipo === "fixo") return regra.valor;
  const v = pago * (1 + regra.valor / 100);
  return o.arredondar ? arredondarPara90(v) : v;
}

/** uma linha do pedido: a categoria do cadastro, o preço unitário pago e quantas peças (padrão 1) */
export type PecaDoPedido = { categoria: string | null | undefined; pago: number; quantidade?: number };

export type CategoriaDoPedido = {
  nome: string;
  /** PEÇAS (a soma das quantidades), não linhas: "Regata ×12" são 12 */
  pecas: number;
  menorPago: number;
  maiorPago: number;
};

const quantidadeDe = (p: PecaDoPedido) => Math.max(1, Math.round(p.quantidade ?? 1));

/**
 * As categorias que o pedido tem, com o que a revendedora pagou em cada
 * uma (menor e maior preço unitário) — é o que a janela lista. "Outras" vai
 * por último; o resto em ordem alfabética.
 */
export function categoriasDoPedido(pecas: PecaDoPedido[]): CategoriaDoPedido[] {
  const mapa = new Map<string, CategoriaDoPedido>();
  for (const p of pecas) {
    const nome = nomeDaCategoria(p.categoria);
    const atual = mapa.get(nome);
    if (!atual) mapa.set(nome, { nome, pecas: quantidadeDe(p), menorPago: p.pago, maiorPago: p.pago });
    else {
      atual.pecas += quantidadeDe(p);
      atual.menorPago = Math.min(atual.menorPago, p.pago);
      atual.maiorPago = Math.max(atual.maiorPago, p.pago);
    }
  }
  return [...mapa.values()].sort((a, b) => {
    if (a.nome === CATEGORIA_OUTRAS) return 1;
    if (b.nome === CATEGORIA_OUTRAS) return -1;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
}

/** o preço pago de CADA PEÇA, por categoria — a linha ×12 vira 12 entradas (o aviso "abaixo do custo" conta peças) */
export function pagosPorCategoria(pecas: PecaDoPedido[]): Record<string, number[]> {
  const saida: Record<string, number[]> = {};
  for (const p of pecas) {
    const lista = (saida[nomeDaCategoria(p.categoria)] ??= []);
    for (let i = 0; i < quantidadeDe(p); i++) lista.push(p.pago);
  }
  return saida;
}

/** abaixo disto de margem sobre o maior custo da categoria, o preço fixo ganha o aviso amarelo */
export const MARGEM_MINIMA_SEM_AVISO = 20;

export type AvisoDaCategoria =
  | { tipo: "abaixo-do-custo"; pecasAbaixo: number }
  | { tipo: "margem-baixa"; margemMinima: number }
  | null;

/**
 * O aviso do preço FIXO: vermelho quando alguma peça da categoria custou o
 * preço fixo ou mais (a revendedora venderia no prejuízo), amarelo quando a
 * margem sobre a peça mais cara fica abaixo de 20%. Margem em % nunca avisa
 * — ela acompanha o custo de cada peça.
 */
export function avisoDaCategoria(
  cat: CategoriaDoPedido,
  regra: RegraDeCategoria | undefined,
  pagos: number[]
): AvisoDaCategoria {
  if (!regra || regra.tipo !== "fixo") return null;
  const abaixo = pagos.filter((p) => p >= regra.valor).length;
  if (abaixo > 0) return { tipo: "abaixo-do-custo", pecasAbaixo: abaixo };
  if (cat.maiorPago <= 0) return null;
  const margemMinima = ((regra.valor - cat.maiorPago) / cat.maiorPago) * 100;
  if (margemMinima < MARGEM_MINIMA_SEM_AVISO) return { tipo: "margem-baixa", margemMinima };
  return null;
}

/** a faixa de preço que a categoria vai ter no papel (menor e maior peça pela regra) */
export function faixaDePreco(cat: CategoriaDoPedido, o: OpcoesDePreco): { de: number; ate: number } {
  return {
    de: precoDeRevenda(cat.menorPago, cat.nome, o),
    ate: precoDeRevenda(cat.maiorPago, cat.nome, o),
  };
}

/** só as regras de categorias que existem NESTE pedido e que a porta aceita (o que a janela mostra é o que se grava) */
export function regrasDoPedido(regras: RegrasPorCategoria, categorias: CategoriaDoPedido[]): RegrasPorCategoria {
  const nomes = new Set(categorias.map((c) => c.nome));
  return Object.fromEntries(
    Object.entries(regras).filter(([nome, r]) => nomes.has(nome) && nome.length <= TETO_DO_NOME && regraSchema.safeParse(r).success)
  );
}

/**
 * O que fica LEMBRADO na ficha: as regras novas por cima das guardadas —
 * a categoria que não está neste pedido continua como estava (o pedido só
 * de regatas não apaga a regra dos vestidos); a regra tirada nesta
 * janela (categoria do pedido sem regra) SAI da ficha.
 */
export function regrasParaLembrar(
  guardadas: RegrasPorCategoria,
  escolhidas: RegrasPorCategoria,
  categoriasDoPedidoAgora: string[]
): RegrasPorCategoria {
  const saida: RegrasPorCategoria = { ...guardadas };
  for (const nome of categoriasDoPedidoAgora) delete saida[nome];
  return { ...saida, ...escolhidas };
}
