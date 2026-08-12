import { db } from "./db";
import { decryptSecret } from "./crypto";
import { orderNumber, round2 } from "./orders";
import { appBaseUrl } from "./comm/evolution";
import { settleOrderPaid } from "./settle-order";

/**
 * INFINITEPAY — Checkout por link (Pix e cartão em até 12x).
 *
 * Modelo diferente do Mercado Pago: o dinheiro cai DIRETO na conta da loja
 * (a InfiniteTag identifica a conta; não há OAuth nem taxa da plataforma).
 * O fluxo:
 *   1. o pedido gera um LINK de checkout (uma chamada só);
 *   2. a cliente paga no site da InfinitePay (Pix ou cartão);
 *   3. a InfinitePay avisa nosso webhook — e nós NUNCA confiamos no aviso
 *      sozinho: antes de marcar PAGO, conferimos na API (payment_check).
 *      O aviso não tem assinatura; sem a conferência, qualquer um que
 *      descobrisse a URL do webhook marcaria pedido como pago.
 *
 * Valores viajam em CENTAVOS (inteiro) — a conversão mora aqui, num lugar
 * só, para nunca cobrarmos 100× a mais nem a menos.
 */

const BASE = process.env.INFINITEPAY_API_BASE ?? "https://api.infinitepay.io";

export type InfinitePayConn = {
  handle: string;
  apiToken: string | null;
};

/** Conexão da loja, com o token já aberto (ou null se não conectada). */
export async function loadInfinitePay(companyId: string): Promise<InfinitePayConn | null> {
  const conn = await db.infinitePayConnection.findUnique({ where: { companyId } });
  if (!conn) return null;
  return {
    handle: conn.handle,
    apiToken: conn.apiToken ? decryptSecret(conn.apiToken) : null,
  };
}

function headers(conn: InfinitePayConn): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(conn.apiToken ? { Authorization: `Bearer ${conn.apiToken}` } : {}),
  };
}

/** R$ (float) → centavos (int), sem surpresa de ponto flutuante. */
export const emCentavos = (reais: number) => Math.round(round2(reais) * 100);

/**
 * Cria o link de checkout do pedido. Os itens vão com preço unitário em
 * centavos; o frete (quando houver) entra como item próprio — o total do
 * checkout tem que bater com o `total` do pedido (o que a cliente paga).
 */
export async function criarLinkInfinitePay(args: {
  conn: InfinitePayConn;
  webhookToken: string;
  order: {
    id: string;
    number: number;
    total: number;
    shippingFee: number;
    items: { productId: string | null; name: string; color: string | null; size: string | null; quantity: number; unitPrice: number }[];
    customer: { name: string; email: string | null; phone: string };
  };
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const { conn, order } = args;

  const itens = order.items.map((i, idx) => ({
    id: String(i.productId ?? idx + 1),
    description: [i.name, i.color, i.size].filter(Boolean).join(" ").slice(0, 100),
    quantity: i.quantity,
    price: emCentavos(i.unitPrice),
  }));
  if (order.shippingFee > 0) {
    // frete-ok: o checkout cobra o que a cliente paga — frete incluído
    itens.push({ id: "frete", description: "Frete", quantity: 1, price: emCentavos(order.shippingFee) });
  }
  // desconto/acréscimo do pedido: a soma dos itens pode não bater com o
  // total. O `amount` manda no valor cobrado; um item de ajuste deixa o
  // extrato do checkout honesto quando há diferença.
  const somaItens = itens.reduce((s, i) => s + i.price * i.quantity, 0);
  const alvo = emCentavos(order.total); // frete-ok: total a pagar do checkout
  if (alvo > somaItens) {
    itens.push({ id: "ajuste", description: "Acréscimo", quantity: 1, price: alvo - somaItens });
  } else if (alvo < somaItens) {
    // a API não aceita item negativo: com desconto, os itens são resumidos
    // numa linha só com o valor final (o PDF do pedido detalha as peças)
    itens.length = 0;
    itens.push({
      id: order.id,
      description: `Pedido ${orderNumber(order.number)}`.slice(0, 100),
      quantity: 1,
      price: alvo,
    });
  }

  const fone = order.customer.phone.replace(/\D/g, "");
  const payload = {
    handle: conn.handle,
    order_nsu: order.id,
    // a cliente volta para a página pública de confirmação — que CONFERE o
    // pagamento na API e já baixa o pedido (confirmação instantânea)
    redirect_url: `${appBaseUrl()}/pagamento/confirmado`,
    webhook_url: `${appBaseUrl()}/api/infinitepay/webhook/${args.webhookToken}`,
    amount: alvo,
    customer: {
      name: order.customer.name.slice(0, 100),
      ...(order.customer.email ? { email: order.customer.email } : {}),
      ...(fone.length === 10 || fone.length === 11
        ? { phone: `+55${fone}` }
        : fone.length >= 12
          ? { phone: `+${fone}` }
          : {}),
    },
    items: itens,
  };

  try {
    const res = await fetch(`${BASE}/invoices/public/checkout/links`, {
      method: "POST",
      headers: headers(conn),
      body: JSON.stringify(payload),
      cache: "no-store",
      // teto de 20s: uma InfinitePay lenta não pode segurar a função da
      // Vercel até o limite e derrubar a tela (auditoria 11/08/2026)
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => null)) as {
      url?: string;
      payment_url?: string;
      error?: string;
      message?: string;
    } | null;
    const url = body?.url ?? body?.payment_url;
    if (!res.ok || !url) {
      return {
        ok: false,
        error:
          body?.error ??
          body?.message ??
          `A InfinitePay não gerou o link (HTTP ${res.status}). Confira a InfiniteTag em Configurações.`,
      };
    }
    return { ok: true, url };
  } catch {
    return { ok: false, error: "Sem resposta da InfinitePay — tente de novo em instantes." };
  }
}

/**
 * A CONFERÊNCIA QUE VALE DINHEIRO: pergunta à InfinitePay se a transação
 * está paga de verdade. É ela (e nunca o webhook cru ou a URL de retorno)
 * que autoriza marcar o pedido como PAGO.
 */
export async function conferirPagamentoInfinitePay(
  conn: InfinitePayConn,
  dados: { order_nsu: string; transaction_nsu: string; slug: string }
): Promise<{ ok: boolean; paid: boolean; installments?: number }> {
  try {
    const res = await fetch(`${BASE}/invoices/public/checkout/payment_check`, {
      method: "POST",
      headers: headers(conn),
      body: JSON.stringify({
        handle: conn.handle,
        order_nsu: dados.order_nsu,
        transaction_nsu: dados.transaction_nsu,
        slug: dados.slug,
      }),
      cache: "no-store",
      // teto de 15s: sem ele, a conferência lenta segurava o webhook até o
      // limite da função (→ 500 → reenvio infinito) e prendia conexões do banco
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as {
      paid?: boolean;
      installments?: number;
    } | null;
    if (!res.ok || body == null) return { ok: false, paid: false };
    return { ok: true, paid: body.paid === true, installments: body.installments };
  } catch {
    return { ok: false, paid: false };
  }
}

/** capture_method da InfinitePay → nossa forma de pagamento. */
export function metodoDaCaptura(capture?: string | null): "PIX" | "CARTAO" | "OUTRO" {
  const c = (capture ?? "").toLowerCase();
  if (c.includes("pix")) return "PIX";
  if (c.includes("credit") || c.includes("card") || c.includes("cartao")) return "CARTAO";
  return "OUTRO";
}

/**
 * CONFIRMAÇÃO DO PAGAMENTO — chamada SÓ pelo webhook (autenticado pelo token
 * secreto da loja na URL). A página pública de retorno é apenas leitura: ela
 * NÃO liquida nada, porque os parâmetros dela são forjáveis (a InfiniteTag da
 * loja é pública, e qualquer um cria um checkout barato com o order_nsu do
 * pedido caro da vítima — auditoria 11/08/2026).
 *
 * As travas, em ordem:
 *  1. o pedido tem que ser DA LOJA da conexão (multi-tenant);
 *  2. a transação (transaction_nsu) só vale para UM pedido — se já está
 *     registrada em outro pedido/loja, recusa (fecha replay + P2002 do
 *     mpPaymentId, que é único global);
 *  3. a InfinitePay tem que dizer "paid: true" na conferência (payment_check);
 *  4. o VALOR é OBRIGATÓRIO — sem ele o pedido nunca vira pago (era o buraco
 *     que deixava liquidar um pedido de R$ 5.000 com R$ 1);
 *  5. o settle liquida com as blindagens de sempre (trava de corrida, valor
 *     conferido contra o total, estoque condicionado, aviso de dobro).
 */
export async function confirmarPagamentoInfinitePay(args: {
  companyId: string;
  order_nsu: string;
  transaction_nsu: string;
  slug: string;
  /** VALOR PAGO em centavos — o webhook informa; sem ele não se liquida */
  paid_amount?: number | null;
  capture_method?: string | null;
  receipt_url?: string | null;
}): Promise<
  | { resultado: "pago"; already?: boolean }
  | { resultado: "nao-liquidado" } // conferiu pago, mas o pedido não aceitou (cancelado/valor divergente)
  | { resultado: "nao-pago" }
  | { resultado: "indisponivel" } // conferência fora do ar / sem valor — tente de novo
  | { resultado: "invalido" } // pedido não é desta loja / transação de outro pedido / dados incompletos
> {
  const { companyId, order_nsu, transaction_nsu, slug } = args;
  if (!order_nsu || !transaction_nsu || !slug) return { resultado: "invalido" };

  const [conn, order] = await Promise.all([
    loadInfinitePay(companyId),
    db.order.findFirst({
      where: { id: order_nsu, companyId },
      select: { id: true, total: true },
    }),
  ]);
  if (!conn || !order) return { resultado: "invalido" };

  // UMA transação, UM pedido: se este transaction_nsu já existe amarrado a
  // OUTRO pedido (ou a outro provedor com id coincidente), recusa. Fecha o
  // replay ("confirma N pedidos com uma transação") e o P2002 do índice único
  // global de mpPaymentId.
  const jaRegistrada = await db.payment.findUnique({
    where: { mpPaymentId: transaction_nsu },
    select: { orderId: true },
  });
  if (jaRegistrada && jaRegistrada.orderId !== order.id) {
    return { resultado: "invalido" };
  }

  // O VALOR é a régua e é obrigatório: sem ele, "pede reenvio" em vez de
  // liquidar no escuro (o payment_check só devolve paid: boolean).
  if (args.paid_amount == null) return { resultado: "indisponivel" };
  const valorPago = round2(args.paid_amount / 100);

  const check = await conferirPagamentoInfinitePay(conn, {
    order_nsu,
    transaction_nsu,
    slug,
  });
  if (!check.ok) return { resultado: "indisponivel" };
  if (!check.paid) return { resultado: "nao-pago" };

  // a cobrança pendente ganha a identidade da transação ANTES do settle —
  // é por ela que o settle confirma SÓ a linha paga (conciliação honesta).
  // Escolhe UMA linha (a mais recente sem id), atualizada pelo id: carimbar
  // várias de uma vez estourava o índice único quando havia 2+ pendentes.
  const metodo = metodoDaCaptura(args.capture_method);
  const alvo = await db.payment.findFirst({
    where: {
      orderId: order.id,
      provider: "INFINITEPAY",
      status: "PENDENTE",
      OR: [{ mpPaymentId: null }, { mpPaymentId: transaction_nsu }],
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (alvo) {
    await db.payment.update({
      where: { id: alvo.id },
      data: { mpPaymentId: transaction_nsu, ...(metodo !== "OUTRO" ? { method: metodo } : {}) },
    });
  } else {
    // pagamento sem cobrança registrada (link antigo de antes de uma
    // reconexão): nasce a linha, para o dinheiro nunca ficar sem registro.
    // A corrida com outra confirmação cai no índice único → P2002 tratado.
    try {
      await db.payment.create({
        data: {
          orderId: order.id,
          method: metodo,
          status: "PENDENTE",
          amount: valorPago, // frete-ok: o que a cliente pagou (com frete)
          provider: "INFINITEPAY",
          mpPaymentId: transaction_nsu,
        },
      });
    } catch (e) {
      if ((e as { code?: string })?.code !== "P2002") throw e;
      // a linha já nasceu (outra confirmação simultânea) — segue para o settle
    }
  }

  const r = await settleOrderPaid(order.id, "InfinitePay", valorPago, transaction_nsu);
  // o settle recusa pedido cancelado / valor divergente: NÃO dizer "pago"
  // (a página de retorno anunciaria pago um pedido que não liquidou)
  if (!r.ok) return { resultado: "nao-liquidado" };

  // recibo no histórico do pedido (link oficial da InfinitePay)
  if (!r.already && args.receipt_url && /^https:\/\//.test(args.receipt_url)) {
    await db.orderEvent
      .create({
        data: {
          orderId: order.id,
          type: "NOTA",
          description: `🧾 Recibo InfinitePay${check.installments && check.installments > 1 ? ` (${check.installments}x)` : ""}: ${args.receipt_url}`,
        },
      })
      .catch(() => {});
  }
  return { resultado: "pago", already: r.already };
}
