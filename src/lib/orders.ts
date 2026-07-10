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
  EM_PRODUCAO: "#6d28ff",
  SEPARACAO: "#0ea5e9",
  ENVIADO: "#6d28ff",
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
