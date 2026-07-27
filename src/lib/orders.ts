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
  shippingFee: number;
  total: number;
};

/**
 * Totais do pedido: subtotal - desconto + frete, nunca negativo.
 * O desconto é limitado ao subtotal (não existe pedido de valor negativo).
 */
export function computeOrderTotals(
  items: CartItemInput[],
  discount = 0,
  shippingFee = 0
): OrderTotals {
  const subtotal = round2(
    items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  );
  const safeDiscount = round2(Math.min(Math.max(discount, 0), subtotal));
  const safeShipping = round2(Math.max(shippingFee, 0));
  return {
    subtotal,
    discount: safeDiscount,
    shippingFee: safeShipping,
    total: round2(subtotal - safeDiscount + safeShipping),
  };
}

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
