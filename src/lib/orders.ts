import type { OrderStatus, PaymentMethod } from "@prisma/client";

export const orderStatusLabel: Record<OrderStatus, string> = {
  ORCAMENTO: "Orçamento",
  AGUARDANDO_PAGAMENTO: "Aguardando pagamento",
  PAGO: "Pago",
  EM_PRODUCAO: "Em produção",
  SEPARACAO: "Separação",
  ENVIADO: "Enviado",
  ENTREGUE: "Entregue",
  CANCELADO: "Cancelado",
};

export const orderStatusColor: Record<OrderStatus, string> = {
  ORCAMENTO: "#64748b",
  AGUARDANDO_PAGAMENTO: "#d97706",
  PAGO: "#059669",
  EM_PRODUCAO: "#c4622d",
  SEPARACAO: "#5c5636",
  ENVIADO: "#8a4420",
  ENTREGUE: "#10b981",
  CANCELADO: "#e11d48",
};

/**
 * Regra de faturamento do produto: SÓ EXISTE VENDA SE HOUVE PAGAMENTO.
 * Estados avançados (produção, separação, envio, entrega) implicam pago.
 * Toda métrica de faturamento/venda/conversão deve filtrar por estes status.
 */
export const PAID_ORDER_STATUSES: OrderStatus[] = [
  "PAGO",
  "EM_PRODUCAO",
  "SEPARACAO",
  "ENVIADO",
  "ENTREGUE",
];

/**
 * DATA DO DINHEIRO — decide em qual mês a venda entra.
 *
 * Faturamento é somado pela data em que o pedido virou PAGO (`Order.paidAt`),
 * NUNCA pela data em que o orçamento foi montado. Motivo: como o pedido só
 * entra na conta depois de pago, usar a data de criação fazia um mês já
 * fechado mudar de valor quando um orçamento antigo era pago em seguida.
 *
 * Orçamento montado em julho e pago em agosto = faturamento de AGOSTO,
 * igualzinho ao extrato do banco. Mês fechado nunca mais muda.
 *
 * `createdAt` continua valendo onde a pergunta é "quantos orçamentos foram
 * GERADOS no período" (denominador da conversão) — ali a data certa é a da
 * criação mesmo.
 */
export const CAMPO_DATA_FATURAMENTO = "paidAt" as const;

/**
 * QUEM PODE TRANSFERIR A VENDA (trocar o vendedor do pedido).
 *
 * Regra da loja: a vendedora transfere um pedido DELA para uma colega —
 * acontece muito (a cliente é da região da outra, a vendedora vai viajar,
 * o atendimento passou para outra pessoa). O que ela NUNCA pode é mexer no
 * pedido de outra pessoa: comissão dos outros não se toca.
 *
 * Gerente e admin transferem qualquer pedido da loja (é o papel deles).
 * Suporte não mexe em dinheiro.
 */
export function podeTransferirVenda(
  user: { id: string; role: string },
  order: { sellerId: string | null }
): boolean {
  if (user.role === "SUPPORT") return false;
  if (user.role === "ADMIN" || user.role === "SUPERADMIN" || user.role === "MANAGER")
    return true;
  // vendedora: só o que é dela (pedido sem dono ainda também pode assumir)
  return order.sellerId === null || order.sellerId === user.id;
}

export const ORDER_STATUS_FLOW: OrderStatus[] = [
  "ORCAMENTO",
  "AGUARDANDO_PAGAMENTO",
  "PAGO",
  "EM_PRODUCAO",
  "SEPARACAO",
  "ENVIADO",
  "ENTREGUE",
  "CANCELADO",
];

/**
 * O que fazer com o ESTOQUE ao cancelar um pedido.
 *
 * Regra pedida pelas lojas: ao cancelar, o vendedor escolhe se as peças
 * voltam ao catálogo ou não.
 *   • DEVOLVER — comportamento clássico: o livro de movimentos devolve
 *                exatamente o que o pedido segurou.
 *   • BAIXAR   — as peças NÃO voltam (perda/brinde/defeito): o estoque fica
 *                como está e o pedido é marcado stockWrittenOff, para um
 *                eventual reabrir não descontar as mesmas peças duas vezes.
 *   • NADA     — o pedido não estava segurando estoque; nada a decidir.
 */
export function resolveCancelStock(
  stockDeducted: boolean,
  restock: boolean | undefined
): "DEVOLVER" | "BAIXAR" | "NADA" {
  if (!stockDeducted) return "NADA";
  // sem resposta explícita, vale o comportamento histórico: devolver
  return restock === false ? "BAIXAR" : "DEVOLVER";
}

/**
 * O que fazer com o estoque ao REABRIR um pedido cancelado (voltar para
 * qualquer etapa ativa). Se o cancelamento baixou as peças em definitivo
 * (stockWrittenOff), elas já estão fora do estoque — reabrir só "recola" a
 * baixa no pedido, sem descontar de novo (o líquido do livro de movimentos
 * do pedido continua positivo, então cancelar de novo devolvendo funciona).
 */
export function resolveReopenStock(
  stockDeducted: boolean,
  stockWrittenOff: boolean
): "DESCONTAR" | "REANEXAR" | "NADA" {
  if (stockDeducted) return "NADA"; // já está segurando
  return stockWrittenOff ? "REANEXAR" : "DESCONTAR";
}

export const paymentMethodLabel: Record<PaymentMethod, string> = {
  PIX: "PIX",
  CARTAO: "Cartão",
  BOLETO: "Boleto",
  CHEQUE: "Cheque",
  DINHEIRO: "Dinheiro",
  OUTRO: "Outro",
};

export type CartItemInput = {
  quantity: number;
  unitPrice: number;
};

export type OrderTotals = {
  subtotal: number;
  discount: number;
  surcharge: number;
  shippingFee: number;
  /** valor VENDIDO: produtos − desconto + acréscimo (o frete não entra) */
  netTotal: number;
  /** o que a cliente paga: valor vendido + frete */
  total: number;
};

/**
 * Como o desconto/acréscimo foi digitado. Guardar isso importa: em
 * porcentagem o valor tem que se RECALCULAR quando as peças mudam ("10% de
 * desconto" continua 10% depois de adicionar uma blusa). Em reais, o valor
 * digitado é o que vale, aconteça o que acontecer com o carrinho.
 */
export type AjusteInput = {
  /** valor em reais (usado quando `pct` é null/undefined) */
  valor?: number;
  /** porcentagem sobre o subtotal (0 a 100) — quando vem, manda nela */
  pct?: number | null;
};

/** Resolve um ajuste (desconto ou acréscimo) para reais, sobre o subtotal. */
export function valorDoAjuste(ajuste: AjusteInput | undefined, subtotal: number): number {
  if (!ajuste) return 0;
  if (ajuste.pct != null) {
    const pct = Math.min(Math.max(ajuste.pct, 0), 100);
    return round2((subtotal * pct) / 100);
  }
  return round2(Math.max(ajuste.valor ?? 0, 0));
}

/**
 * TOTAIS DO PEDIDO — e a separação que decide dinheiro no sistema inteiro.
 *
 *   valor vendido (netTotal) = produtos − desconto + acréscimo
 *   total a pagar            = valor vendido + frete
 *
 * O FRETE FICA DE FORA DO VALOR VENDIDO, e isso não é opção de configuração:
 * frete é dinheiro que atravessa a loja e vai para a transportadora. Somá-lo
 * inflava o faturamento e, pior, podia cair na comissão da vendedora —
 * remunerando ela por um serviço que não é venda. Deixando o frete fora da
 * estrutura, não existe jeito de configurar errado.
 *
 * O desconto é limitado ao subtotal + acréscimo: nunca existe pedido de valor
 * negativo, mas dar 100% de desconto num pedido com acréscimo não pode fazer
 * o total ficar abaixo de zero nem "comer" o acréscimo silenciosamente.
 */
export function computeOrderTotals(
  items: CartItemInput[],
  discount: number | AjusteInput = 0,
  shippingFee = 0,
  surcharge: number | AjusteInput = 0
): OrderTotals {
  const subtotal = round2(items.reduce((s, i) => s + i.quantity * i.unitPrice, 0));

  const comoAjuste = (v: number | AjusteInput): AjusteInput =>
    typeof v === "number" ? { valor: v } : v;

  const safeSurcharge = valorDoAjuste(comoAjuste(surcharge), subtotal);
  const teto = round2(subtotal + safeSurcharge);
  const safeDiscount = Math.min(valorDoAjuste(comoAjuste(discount), subtotal), teto);
  const safeShipping = round2(Math.max(shippingFee, 0));

  const netTotal = round2(subtotal - safeDiscount + safeSurcharge);
  return {
    subtotal,
    discount: safeDiscount,
    surcharge: safeSurcharge,
    shippingFee: safeShipping,
    netTotal,
    total: round2(netTotal + safeShipping),
  };
}

/**
 * ATALHO "FECHAR POR": a vendedora digita o total final ("faz por 5.000
 * redondo") e o sistema descobre sozinho se aquilo é desconto ou acréscimo.
 *
 * O valor digitado é o TOTAL A PAGAR (é o que a cliente ouve), então o frete
 * sai da conta antes de comparar com o subtotal.
 */
export function ajusteParaFecharPor(
  subtotal: number,
  totalDesejado: number,
  shippingFee = 0
): { discount: number; surcharge: number } {
  const alvo = round2(Math.max(totalDesejado, 0) - Math.max(shippingFee, 0));
  const diferenca = round2(alvo - subtotal);
  if (diferenca < 0) return { discount: Math.min(-diferenca, subtotal), surcharge: 0 };
  return { discount: 0, surcharge: diferenca };
}

/**
 * CAMPO DO DINHEIRO — qual coluna do pedido é "faturamento".
 *
 * Toda soma de faturamento usa `netTotal` (valor vendido), NUNCA `total`:
 * `total` inclui o frete, que é dinheiro da transportadora passando pela
 * loja. Somar `total` inflava Dashboard, Relatórios, Inteligência, Comissões
 * e o painel da plataforma com dinheiro que não é venda.
 *
 * `total` continua sendo o valor certo para COBRAR (Pix, PDF, nota) — é o
 * que a cliente paga.
 */
export const CAMPO_VALOR_FATURAMENTO = "netTotal" as const;

/** Preço unitário conforme o tipo de cliente e a quantidade mínima de atacado. */
export function unitPriceFor(
  product: { retailPrice: number; wholesalePrice: number; minQuantity: number },
  quantity: number,
  wholesaleCustomer: boolean
): number {
  if (
    product.wholesalePrice > 0 &&
    (wholesaleCustomer || quantity >= product.minQuantity) &&
    product.minQuantity > 1
  ) {
    return quantity >= product.minQuantity || wholesaleCustomer
      ? product.wholesalePrice
      : product.retailPrice;
  }
  if (product.wholesalePrice > 0 && wholesaleCustomer) {
    return product.wholesalePrice;
  }
  return product.retailPrice;
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Formata o número do pedido: #0042 */
export function orderNumber(n: number): string {
  return `#${String(n).padStart(4, "0")}`;
}

/**
 * Preço que o CATÁLOGO PÚBLICO mostra e cobra, conforme a escolha da loja
 * em Personalizar catálogo. Fonte única: a vitrine e o pedido gerado por
 * ela têm que usar exatamente este valor, senão a cliente vê um preço e
 * recebe outro na confirmação.
 *
 * ATACADO cai pro varejo quando a peça não tem preço de atacado — melhor
 * mostrar o preço certo do que zero.
 */
export function catalogPrice(
  product: { retailPrice: number; wholesalePrice: number },
  modo: string | null | undefined
): number {
  return modo === "ATACADO" && product.wholesalePrice > 0
    ? product.wholesalePrice
    : product.retailPrice;
}
