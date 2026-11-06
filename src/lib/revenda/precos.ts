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

/**
 * O PREÇO POR PEÇA (pedido do dono, 06/11/2026: *"gostaria de colocar o
 * preço unitário, e não o valor completo por categoria"*): cada card do
 * catálogo (produto × cor — a MESMA chave que a rota usa para montar os
 * cards) pode ter o seu preço unitário digitado, que manda mais que a regra
 * da categoria e que a margem geral. É o número que a pessoa decidiu: nunca
 * arredondado, nunca zero.
 */
export type PrecosPorPeca = Record<string, number>;
/** teto de peças com preço próprio numa URL (um pedido não passa disso; é só para a porta não engolir lixo — a tela avisa antes) */
export const TETO_DE_PECAS = 400;
/** a chave de um card leva no máximo isto (o nome congelado do item + cor) */
export const TETO_DA_CHAVE = 220;
/** quantas peças a ficha lembra, no máximo — as mais recentes ficam */
export const TETO_DE_PECAS_LEMBRADAS = 300;

/** a chave do card: a MESMA da rota do PDF (produto, ou o nome congelado quando não há produto) × cor */
export function chaveDoCard(productId: string | null | undefined, nome: string, cor: string | null | undefined): string {
  return `${productId ?? nome}|${cor ?? ""}`;
}

const precoDePecaSchema = z.number().finite().positive().max(TETO_DO_PRECO_FIXO);

/** a forma que a porta aceita para o preço por peça: chave × número positivo dentro do teto */
export const precosPorPecaSchema = z
  .record(z.string().min(1).max(TETO_DA_CHAVE), precoDePecaSchema)
  .refine((r) => Object.keys(r).length <= TETO_DE_PECAS, "peças demais");

/** o que fica na ficha: o valor e quando foi escolhido (é o que decide quem sai no teto) */
export type PecaLembrada = { valor: number; em: string };
export type PecasLembradas = Record<string, PecaLembrada>;

/** lê o JSON da ficha: a peça torta é pulada, o resto vale; nunca derruba */
export function lerPrecosDePeca(cru: unknown): PecasLembradas {
  if (!cru || typeof cru !== "object" || Array.isArray(cru)) return {};
  const saida: PecasLembradas = {};
  for (const [chave, v] of Object.entries(cru as Record<string, unknown>)) {
    if (!chave || chave.length > TETO_DA_CHAVE) continue;
    const r = v as { valor?: unknown; em?: unknown } | null;
    const valor = precoDePecaSchema.safeParse(r?.valor);
    if (!valor.success) continue;
    const em = typeof r?.em === "string" && !Number.isNaN(Date.parse(r.em)) ? r.em : "1970-01-01T00:00:00.000Z";
    saida[chave] = { valor: valor.data, em };
  }
  return saida;
}

/** só os valores (o que a conta e a tela usam) */
export function valoresDasPecas(lembradas: PecasLembradas): PrecosPorPeca {
  return Object.fromEntries(Object.entries(lembradas).map(([k, v]) => [k, v.valor]));
}

/**
 * O que fica LEMBRADO na ficha: as peças deste pedido são trocadas pelo
 * que veio agora (a tirada sai; a nova entra, com a hora), as de outros
 * pedidos ficam — e, acima do teto, as mais ANTIGAS saem (a revendedora
 * que pede todo mês acumularia centenas).
 */
export function pecasParaLembrar(
  guardadas: PecasLembradas,
  escolhidas: PrecosPorPeca,
  chavesDoPedidoAgora: string[],
  agora: Date = new Date()
): PecasLembradas {
  const saida: PecasLembradas = { ...guardadas };
  for (const chave of chavesDoPedidoAgora) delete saida[chave];
  const em = agora.toISOString();
  for (const [chave, valor] of Object.entries(escolhidas)) saida[chave] = { valor, em };
  const chaves = Object.keys(saida);
  if (chaves.length <= TETO_DE_PECAS_LEMBRADAS) return saida;
  const ordem = chaves.sort((a, b) => Date.parse(saida[b].em) - Date.parse(saida[a].em));
  return Object.fromEntries(ordem.slice(0, TETO_DE_PECAS_LEMBRADAS).map((k) => [k, saida[k]]));
}

export type OpcoesDePreco = {
  /** a margem geral em %, para a categoria sem regra própria */
  margemGeral: number;
  /** arredondar para ,90 (só a margem; o fixo é o digitado) */
  arredondar: boolean;
  regras: RegrasPorCategoria;
  /** o preço unitário por card, que manda mais que tudo (opcional) */
  pecas?: PrecosPorPeca;
};

/** a regra que vale para uma categoria: a própria, ou a margem geral */
export function regraQueVale(categoria: string | null | undefined, o: OpcoesDePreco): RegraDeCategoria {
  return o.regras[nomeDaCategoria(categoria)] ?? { tipo: "margem", valor: o.margemGeral };
}

/**
 * O preço de revenda de UMA peça: o preço próprio do card, se houver;
 * senão o que ela pagou × a regra da categoria (ou a margem geral).
 */
export function precoDeRevenda(pago: number, categoria: string | null | undefined, o: OpcoesDePreco, chave?: string): number {
  const proprio = chave ? o.pecas?.[chave] : undefined;
  if (proprio != null && proprio > 0) return proprio;
  const regra = regraQueVale(categoria, o);
  if (regra.tipo === "fixo") return regra.valor;
  const v = pago * (1 + regra.valor / 100);
  return o.arredondar ? arredondarPara90(v) : v;
}

/** uma linha do pedido: a categoria do cadastro, o preço unitário pago e quantas peças (padrão 1); com produto/nome/cor vira card */
export type PecaDoPedido = {
  categoria: string | null | undefined;
  pago: number;
  quantidade?: number;
  productId?: string | null;
  nome?: string;
  cor?: string | null;
};

const quantidadeDe = (p: PecaDoPedido) => Math.max(1, Math.round(p.quantidade ?? 1));

/** um card do catálogo (produto × cor), como a rota o monta: a PRIMEIRA linha dá o preço pago, as demais somam peças */
export type CardDoPedido = { chave: string; nome: string; cor: string | null; categoria: string; pago: number; pecas: number };

/** os cards do pedido na ordem das linhas (a mesma dedup da rota: a primeira linha de cada produto × cor manda no preço) */
export function cardsDoPedido(pecas: PecaDoPedido[]): CardDoPedido[] {
  const mapa = new Map<string, CardDoPedido>();
  for (const p of pecas) {
    const chave = chaveDoCard(p.productId ?? null, p.nome ?? "", p.cor ?? null);
    const atual = mapa.get(chave);
    if (atual) atual.pecas += quantidadeDe(p);
    else mapa.set(chave, { chave, nome: p.nome ?? "", cor: p.cor ?? null, categoria: nomeDaCategoria(p.categoria), pago: p.pago, pecas: quantidadeDe(p) });
  }
  return [...mapa.values()];
}

export type CategoriaDoPedido = {
  nome: string;
  /** PEÇAS (a soma das quantidades), não linhas: "Regata ×12" são 12 */
  pecas: number;
  menorPago: number;
  maiorPago: number;
};

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
  // a peça mais cara ENTRE as que saem pela regra (a com preço próprio não conta)
  const maiorPago = pagos.length > 0 ? Math.max(...pagos) : cat.maiorPago;
  if (maiorPago <= 0) return null;
  const margemMinima = ((regra.valor - maiorPago) / maiorPago) * 100;
  if (margemMinima < MARGEM_MINIMA_SEM_AVISO) return { tipo: "margem-baixa", margemMinima };
  return null;
}

/** a faixa de preço que a categoria vai ter no papel (menor e maior peça pela REGRA — o preço por peça é dito à parte) */
export function faixaDePreco(cat: CategoriaDoPedido, o: OpcoesDePreco): { de: number; ate: number } {
  const semPecas = { ...o, pecas: undefined };
  return {
    de: precoDeRevenda(cat.menorPago, cat.nome, semPecas),
    ate: precoDeRevenda(cat.maiorPago, cat.nome, semPecas),
  };
}

/** o número como a tela o escreve de volta num campo (vírgula, 2 casas no dinheiro): "99,90" — nunca "99.9", que o leitor pt-BR entenderia como milhar em "12.345" */
export function textoDoDinheiro(v: number): string {
  return v.toFixed(2).replace(".", ",");
}

/** a margem em % como texto do campo ("120", "12,5") */
export function textoDaMargem(v: number): string {
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

/** o preço pago de cada peça dos cards SEM preço próprio (o aviso da categoria só olha quem sai pela regra dela) */
export function pagosDosCards(cards: CardDoPedido[], pecasProprias: PrecosPorPeca = {}): number[] {
  const saida: number[] = [];
  for (const c of cards) {
    if (pecasProprias[c.chave] != null) continue;
    for (let i = 0; i < c.pecas; i++) saida.push(c.pago);
  }
  return saida;
}

/** só os preços de peças que existem NESTE pedido e que a porta aceita (chave e valor dentro dos tetos) */
export function pecasDoPedido(precos: PrecosPorPeca, cards: CardDoPedido[]): PrecosPorPeca {
  const chaves = new Set(cards.map((c) => c.chave));
  return Object.fromEntries(
    Object.entries(precos).filter(([chave, v]) => chaves.has(chave) && chave.length <= TETO_DA_CHAVE && precoDePecaSchema.safeParse(v).success)
  );
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
