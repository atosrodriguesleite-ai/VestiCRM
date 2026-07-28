import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { imageSrc } from "@/lib/img";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp, isSupport, orderScope } from "@/lib/scope";
import { reverseAndDeleteOrder } from "@/lib/order-actions";
import { notifySalePaid } from "@/lib/push";
import { pushStockToNuvemshop } from "@/lib/nuvemshop";
import { pushStockToJueri } from "@/lib/jueri";
import {
  orderStatusLabel,
  orderNumber,
  PAID_ORDER_STATUSES,
  ORDER_STATUS_FLOW,
  podeTransferirVenda,
} from "@/lib/orders";
import { computeOrderTotals } from "@/lib/orders";
import { reservarOQueTiver, textoDaFalta } from "@/lib/reservations";
import {
  winLinkedOpportunity,
  loseLinkedOpportunity,
  reopenLinkedOpportunity,
  syncOpportunityValue,
} from "@/lib/opportunity-sync";

// Estoque fica RESERVADO em qualquer etapa que não seja Cancelado (o orçamento
// já reserva). Só o cancelamento devolve. O faturamento (venda) continua sendo
// contado só a partir de Pago (PAID_ORDER_STATUSES) — reserva não é venda.
const HELD_STATUSES = new Set<string>(ORDER_STATUS_FLOW.filter((s) => s !== "CANCELADO"));

const itemSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
});

const patchSchema = z.object({
  status: z
    .enum([
      "ORCAMENTO",
      "AGUARDANDO_PAGAMENTO",
      "PAGO",
      "EM_PRODUCAO",
      "SEPARACAO",
      "ENVIADO",
      "ENTREGUE",
      "CANCELADO",
    ])
    .optional(),
  notes: z.string().nullable().optional(),
  trackingCode: z.string().nullable().optional(),
  shippingMethod: z.string().nullable().optional(),
  sellerId: z.string().nullable().optional(), // vendedor responsável pela venda
  customerId: z.string().optional(), // vincula o pedido a um cliente já cadastrado
  paymentMethod: z
    .enum(["PIX", "CARTAO", "BOLETO", "CHEQUE", "DINHEIRO", "OUTRO"])
    .optional(), // forma de pagamento
  items: z.array(itemSchema).min(1).optional(), // edição dos itens (antes de pagar)
  discount: z.number().nonnegative().optional(),
  discountPct: z.number().min(0).max(100).nullish(),
  surcharge: z.number().nonnegative().optional(),
  surchargePct: z.number().min(0).max(100).nullish(),
  shippingFee: z.number().nonnegative().optional(),
});

/**
 * Resolve o ajuste (desconto ou acréscimo) a aplicar: o que veio na
 * requisição, ou o que já estava no pedido. Porcentagem manda sobre valor —
 * mandar `pct: null` explicitamente é como se diz "volta para reais".
 */
function ajusteAtual(
  valorNovo: number | undefined,
  pctNovo: number | null | undefined,
  valorAtual: number,
  pctAtual: number | null
): { valor: number; pct: number | null } {
  if (pctNovo !== undefined) return { valor: valorNovo ?? valorAtual, pct: pctNovo };
  if (valorNovo !== undefined) return { valor: valorNovo, pct: null }; // digitou em reais
  return { valor: valorAtual, pct: pctAtual };
}

const pctResolvida = (nova: number | null | undefined, atual: number | null) =>
  nova !== undefined ? nova : atual;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    const order = await db.order.findFirst({
      where: { id, ...orderScope(user) },
      include: { items: true, payments: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }

    // Perfil Suporte: gerencia o pedido (status, rastreio, pagamento), mas
    // cancelamento e desconto são decisões comerciais — gerente pra cima.
    if (isSupport(user)) {
      if (parsed.data.status === "CANCELADO" && order.status !== "CANCELADO") {
        return NextResponse.json(
          { error: "Cancelar pedido é permitido só para gerente ou admin." },
          { status: 403 }
        );
      }
      const mexeuNoValor =
        (parsed.data.discount !== undefined && parsed.data.discount !== order.discount) ||
        parsed.data.discountPct !== undefined ||
        (parsed.data.surcharge !== undefined && parsed.data.surcharge !== order.surcharge) ||
        parsed.data.surchargePct !== undefined;
      if (mexeuNoValor) {
        return NextResponse.json(
          { error: "Alterar desconto ou acréscimo é permitido só para gerente ou admin." },
          { status: 403 }
        );
      }
    }

    // ---- Edição dos itens (permitida a qualquer momento, exceto cancelado) ----
    if (parsed.data.items) {
      if (order.status === "CANCELADO") {
        return NextResponse.json(
          { error: "Pedido cancelado não pode ser editado. Reabra mudando o status antes." },
          { status: 409 }
        );
      }
      const variantIds = parsed.data.items.map((i) => i.variantId);
      const variants = await db.productVariant.findMany({
        where: { id: { in: variantIds }, product: { companyId: user.companyId } },
        include: { product: { include: { images: { orderBy: { order: "asc" }, take: 1 } } } },
      });
      const variantById = new Map(variants.map((v) => [v.id, v]));
      for (const item of parsed.data.items) {
        const v = variantById.get(item.variantId);
        if (!v || v.productId !== item.productId) {
          return NextResponse.json({ error: "Produto inválido no pedido" }, { status: 404 });
        }
      }

      // Se o pedido já baixou estoque (está pago/em produção...), reconcilia:
      // devolve o que saiu e baixa o que entrou, comparando itens antigos × novos.
      const deltas = new Map<string, number>(); // variantId → variação (novo - antigo)
      if (order.stockDeducted) {
        for (const old of order.items) {
          if (old.variantId) deltas.set(old.variantId, (deltas.get(old.variantId) ?? 0) - old.quantity);
        }
        for (const it of parsed.data.items) {
          deltas.set(it.variantId, (deltas.get(it.variantId) ?? 0) + it.quantity);
        }
        // valida disponibilidade para os itens que vão baixar MAIS estoque
        for (const [variantId, delta] of deltas) {
          if (delta > 0) {
            const v = variantById.get(variantId);
            const avail = v?.stock ?? 0;
            if (avail < delta) {
              const label = v ? `${v.product.name} (${v.color} ${v.size})` : "item";
              return NextResponse.json(
                { error: `Estoque insuficiente de ${label}: faltam ${delta - avail}. Ajuste a quantidade.` },
                { status: 409 }
              );
            }
          }
        }
      }

      const totals = computeOrderTotals(
        parsed.data.items,
        ajusteAtual(parsed.data.discount, parsed.data.discountPct, order.discount, order.discountPct),
        parsed.data.shippingFee ?? order.shippingFee,
        ajusteAtual(parsed.data.surcharge, parsed.data.surchargePct, order.surcharge, order.surchargePct)
      );
      await db.$transaction(async (tx) => {
        await tx.orderItem.deleteMany({ where: { orderId: order.id } });
        await tx.orderItem.createMany({
          data: parsed.data.items!.map((i) => {
            const v = variantById.get(i.variantId)!;
            return {
              orderId: order.id,
              productId: v.productId,
              variantId: v.id,
              name: v.product.name,
              sku: v.product.sku,
              imageUrl: v.product.images[0] ? imageSrc(v.product.images[0]) : null,
              color: v.color,
              size: v.size,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              total: i.quantity * i.unitPrice,
            };
          }),
        });
        await tx.order.update({
          where: { id: order.id },
          data: {
            subtotal: totals.subtotal,
            discount: totals.discount,
            discountPct: pctResolvida(parsed.data.discountPct, order.discountPct),
            surcharge: totals.surcharge,
            surchargePct: pctResolvida(parsed.data.surchargePct, order.surchargePct),
            shippingFee: totals.shippingFee,
            netTotal: totals.netTotal,
            total: totals.total,
          },
        });
        // ajuste de estoque (só quando o pedido já estava com baixa)
        if (order.stockDeducted) {
          for (const [variantId, delta] of deltas) {
            if (delta === 0) continue;
            await tx.productVariant.update({
              where: { id: variantId },
              data: { stock: { decrement: delta } }, // delta>0 baixa; delta<0 devolve
            });
            await tx.inventoryMovement.create({
              data: {
                companyId: user.companyId,
                variantId,
                orderId: order.id,
                type: delta > 0 ? "SAIDA" : "ENTRADA",
                quantity: Math.abs(delta),
                reason: `Edição do pedido ${orderNumber(order.number)}`,
              },
            });
          }
          // faturamento acompanha o novo VALOR VENDIDO (sem frete)
          await tx.sale.updateMany({
            where: { orderId: order.id },
            data: { total: totals.netTotal },
          });
        }
        // valor do pagamento acompanha o novo total (pendente ou confirmado)
        await tx.payment.updateMany({
          where: { orderId: order.id },
          data: { amount: totals.total },
        });
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            type: "NOTA",
            description: `Itens do pedido editados por ${user.name} — valor vendido R$ ${totals.netTotal.toFixed(2)}, total a pagar R$ ${totals.total.toFixed(2)}`,
            userId: user.id,
          },
        });
      });
      // o funil acompanha o VALOR VENDIDO (frete não é negociação)
      await syncOpportunityValue(user.companyId, order.opportunityId, totals.netTotal);
      // se veio SÓ a edição de itens, responde aqui
      if (!parsed.data.status && !parsed.data.notes && parsed.data.sellerId === undefined && !parsed.data.customerId && !parsed.data.paymentMethod && parsed.data.trackingCode === undefined && parsed.data.shippingMethod === undefined) {
        const updated = await db.order.findUnique({ where: { id: order.id } });
        return NextResponse.json(updated);
      }
    }

    // ---- Só os VALORES mudaram (desconto, acréscimo ou frete) ----
    // Sem este caminho, mexer no desconto exigia reenviar o pedido inteiro.
    // Aqui o cálculo sai dos itens que JÁ estão gravados.
    const mexeuSoNosValores =
      !parsed.data.items &&
      (parsed.data.discount !== undefined ||
        parsed.data.discountPct !== undefined ||
        parsed.data.surcharge !== undefined ||
        parsed.data.surchargePct !== undefined ||
        parsed.data.shippingFee !== undefined);

    if (mexeuSoNosValores) {
      if (order.status === "CANCELADO") {
        return NextResponse.json(
          { error: "Pedido cancelado não pode ser editado. Reabra mudando o status antes." },
          { status: 409 }
        );
      }
      const totals = computeOrderTotals(
        order.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice })),
        ajusteAtual(parsed.data.discount, parsed.data.discountPct, order.discount, order.discountPct),
        parsed.data.shippingFee ?? order.shippingFee,
        ajusteAtual(parsed.data.surcharge, parsed.data.surchargePct, order.surcharge, order.surchargePct)
      );

      // AUDITORIA: mexer no valor do pedido é decisão comercial e mexe em
      // comissão — fica registrado quem mudou, de quanto para quanto.
      const mudancas: string[] = [];
      const brl = (v: number) => `R$ ${v.toFixed(2)}`;
      if (totals.discount !== order.discount)
        mudancas.push(`desconto ${brl(order.discount)} → ${brl(totals.discount)}`);
      if (totals.surcharge !== order.surcharge)
        mudancas.push(`acréscimo ${brl(order.surcharge)} → ${brl(totals.surcharge)}`);
      if (totals.shippingFee !== order.shippingFee)
        mudancas.push(`frete ${brl(order.shippingFee)} → ${brl(totals.shippingFee)}`);

      await db.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: {
            discount: totals.discount,
            discountPct: pctResolvida(parsed.data.discountPct, order.discountPct),
            surcharge: totals.surcharge,
            surchargePct: pctResolvida(parsed.data.surchargePct, order.surchargePct),
            shippingFee: totals.shippingFee,
            netTotal: totals.netTotal,
            total: totals.total,
          },
        });
        // a cobrança acompanha o que a cliente paga (COM frete)
        await tx.payment.updateMany({
          where: { orderId: order.id },
          data: { amount: totals.total },
        });
        if (order.stockDeducted) {
          await tx.sale.updateMany({
            where: { orderId: order.id },
            data: { total: totals.netTotal },
          });
        }
        if (mudancas.length) {
          await tx.orderEvent.create({
            data: {
              orderId: order.id,
              type: "NOTA",
              description: `Valores alterados por ${user.name}: ${mudancas.join("; ")}. Valor vendido ${brl(totals.netTotal)} · total a pagar ${brl(totals.total)}`,
              userId: user.id,
            },
          });
        }
      });
      // o funil acompanha o VALOR VENDIDO (frete não é negociação)
      await syncOpportunityValue(user.companyId, order.opportunityId, totals.netTotal);

      if (
        !parsed.data.status &&
        !parsed.data.notes &&
        parsed.data.sellerId === undefined &&
        !parsed.data.customerId &&
        !parsed.data.paymentMethod &&
        parsed.data.trackingCode === undefined &&
        parsed.data.shippingMethod === undefined
      ) {
        const updated = await db.order.findUnique({ where: { id: order.id } });
        return NextResponse.json(updated);
      }
    }

    const newStatus = parsed.data.status;
    const PAID_STATUSES = new Set<string>(PAID_ORDER_STATUSES);
    const willChangeStatus = !!newStatus && newStatus !== order.status;
    // ESTOQUE (reserva/hold): segura ao entrar numa etapa não cancelada;
    // devolve só ao cancelar. Assim o orçamento já reserva a peça.
    const needStockDeduct =
      willChangeStatus && HELD_STATUSES.has(newStatus!) && !order.stockDeducted;
    const needStockReturn =
      willChangeStatus && !HELD_STATUSES.has(newStatus!) && order.stockDeducted;
    // FATURAMENTO (venda): entra/sai de etapa paga — independente do estoque.
    const enteringPaid =
      willChangeStatus && PAID_STATUSES.has(newStatus!) && !PAID_STATUSES.has(order.status);
    const leavingPaid =
      willChangeStatus && !PAID_STATUSES.has(newStatus!) && PAID_STATUSES.has(order.status);

    // Regra: um pedido só pode virar PAGO com um vendedor atribuído.
    if (enteringPaid) {
      const effectiveSeller =
        parsed.data.sellerId !== undefined ? parsed.data.sellerId : order.sellerId;
      if (!effectiveSeller) {
        return NextResponse.json(
          {
            error:
              "Atribua um vendedor ao pedido antes de marcá-lo como pago (em \"Editar dados\").",
          },
          { status: 409 }
        );
      }
    }

    // Antes de escrever: se o pedido vai segurar estoque agora (reserva/baixa),
    // confere disponibilidade e bloqueia se faltar.
    if (needStockDeduct) {
      const variantIds = order.items
        .map((i) => i.variantId)
        .filter((v): v is string => !!v);
      const variants = await db.productVariant.findMany({
        where: { id: { in: variantIds } },
      });
      const stockById = new Map(variants.map((v) => [v.id, v.stock]));
      for (const item of order.items) {
        if (!item.variantId) continue;
        const avail = stockById.get(item.variantId) ?? 0;
        if (avail < item.quantity) {
          return NextResponse.json(
            {
              error: `Estoque insuficiente de ${item.name} (${item.color} ${item.size}): restam ${avail}`,
            },
            { status: 409 }
          );
        }
      }
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;
    if (parsed.data.sellerId !== undefined && parsed.data.sellerId !== order.sellerId) {
      // MESMA REGRA do botão "Transferir venda": a vendedora só mexe no
      // pedido dela. Sem isso, bastaria usar "Editar dados" para desviar a
      // comissão de uma colega — a regra do botão seria só enfeite.
      if (!podeTransferirVenda(user, order)) {
        return NextResponse.json(
          {
            error:
              "Você só pode mudar o vendedor de pedidos que são seus. Peça para a gerente ou a administradora.",
          },
          { status: 403 }
        );
      }
    }
    if (parsed.data.sellerId !== undefined) {
      let newSellerName: string | null = null;
      if (parsed.data.sellerId) {
        const seller = await db.user.findFirst({
          where: { id: parsed.data.sellerId, companyId: user.companyId },
        });
        if (!seller) {
          return NextResponse.json({ error: "Vendedor inválido" }, { status: 404 });
        }
        newSellerName = seller.name;
      }
      data.sellerId = parsed.data.sellerId;
      // troca de vendedor mexe em COMISSÃO: fica sempre registrada no
      // histórico do pedido (quem trocou, de quem para quem) — sem rastro
      // seria possível redirecionar a comissão em silêncio
      if (parsed.data.sellerId !== order.sellerId) {
        const oldSeller = order.sellerId
          ? await db.user.findUnique({
              where: { id: order.sellerId },
              select: { name: true },
            })
          : null;
        await db.orderEvent.create({
          data: {
            orderId: order.id,
            type: "NOTA",
            description: `Vendedor alterado de ${oldSeller?.name ?? "(sem vendedor)"} para ${newSellerName ?? "(sem vendedor)"} por ${user.name}`,
            userId: user.id,
          },
        });
      }
    }
    if (parsed.data.customerId && parsed.data.customerId !== order.customerId) {
      const customer = await db.customer.findFirst({
        where: { id: parsed.data.customerId, companyId: user.companyId },
      });
      if (!customer) {
        return NextResponse.json({ error: "Cliente inválido" }, { status: 404 });
      }
      data.customerId = customer.id;
      await db.orderEvent.create({
        data: {
          orderId: order.id,
          type: "NOTA",
          description: `Pedido vinculado ao cliente ${customer.name} por ${user.name}`,
          userId: user.id,
        },
      });
    }

    if (newStatus && newStatus !== order.status) {
      data.status = newStatus;
      // DATA DO DINHEIRO: carimba QUANDO o pedido virou pago — é ela que manda
      // no faturamento do mês. Se voltar atrás (cancelou/virou orçamento de
      // novo), a data sai junto, senão o mês ficaria com uma venda fantasma.
      if (enteringPaid) data.paidAt = order.paidAt ?? new Date();
      if (leavingPaid) data.paidAt = null;

      await db.orderEvent.create({
        data: {
          orderId: order.id,
          type: "STATUS",
          description: `Status alterado para "${orderStatusLabel[newStatus]}" por ${user.name}`,
          userId: user.id,
        },
      });

      // Pular etapas segue a lógica completa: entrar em qualquer etapa paga
      // (Pago, Em produção, Separação, Enviado, Entregue) vindo de uma etapa
      // não paga confirma o pagamento e registra a venda no CRM.
      if (enteringPaid) {
        const pending = order.payments.find((p) => p.status === "PENDENTE");
        if (pending) {
          await db.payment.update({
            where: { id: pending.id },
            data: { status: "CONFIRMADO", paidAt: new Date() },
          });
        }
        // total ATUAL do banco: se os itens foram editados nesta mesma
        // chamada, `order.total` (lido no começo) estaria desatualizado
        const atual = await db.order.findUnique({
          where: { id: order.id },
          select: { total: true },
        });
        await db.sale.create({
          data: {
            companyId: user.companyId,
            customerId: order.customerId,
            sellerId: order.sellerId,
            orderId: order.id,
            total: atual?.total ?? order.total,
            description: `Pedido ${orderNumber(order.number)}`,
            category: "Pedido",
          },
        });
        await db.customer.update({
          where: { id: order.customerId },
          data: { lastPurchaseAt: new Date() },
        });
      }

      // FUNIL acompanha o pedido: pago → GANHO; cancelado → PERDIDO;
      // reaberto (saiu de pago/cancelado sem fechar) → volta a ABERTA.
      // Antes a negociação ficava aberta para sempre e o funil não batia.
      if (enteringPaid) {
        await winLinkedOpportunity(user.companyId, order.opportunityId);
      } else if (newStatus === "CANCELADO") {
        await loseLinkedOpportunity(user.companyId, order.opportunityId);
      } else if (leavingPaid || order.status === "CANCELADO") {
        await reopenLinkedOpportunity(user.companyId, order.opportunityId);
      }

      // Envio: Enviado marca a saída; Entregue implica que todo o processo
      // de envio foi executado (marca saída e entrega de uma vez).
      if (newStatus === "ENVIADO" || newStatus === "ENTREGUE") {
        const now = new Date();
        const shipData = {
          shippedAt: now,
          ...(newStatus === "ENTREGUE" ? { deliveredAt: now } : {}),
        };
        await db.shipping.upsert({
          where: { orderId: order.id },
          update: {
            ...(newStatus === "ENTREGUE" ? { deliveredAt: now } : {}),
            shippedAt: now,
          },
          create: { orderId: order.id, cost: order.shippingFee, ...shipData },
        });
      }
      // Voltar para antes do envio (ou cancelar) limpa as marcas de entrega
      if (["ORCAMENTO", "AGUARDANDO_PAGAMENTO", "PAGO", "EM_PRODUCAO", "SEPARACAO", "CANCELADO"].includes(newStatus)) {
        await db.shipping.updateMany({
          where: { orderId: order.id },
          data: { shippedAt: null, deliveredAt: null },
        });
      }

      // ---- Estoque: SEGURA (reserva no orçamento / baixa no pago); devolve ao cancelar ----
      if (needStockDeduct) {
        // Baixa condicionada: segura o que existe e NUNCA deixa o estoque
        // negativo às escondidas. Se faltar peça (pedido antigo, reserva que
        // expirou, pedido reaberto), o pedido não é travado — dinheiro é
        // dinheiro — mas a falta fica escrita no histórico e a loja é avisada.
        const faltas = await reservarOQueTiver(
          db,
          order.items.map((i) => ({
            variantId: i.variantId,
            quantity: i.quantity,
            label: `${i.name}${i.color || i.size ? ` (${[i.color, i.size].filter(Boolean).join(" ")})` : ""}`,
          }))
        );
        if (faltas.length > 0) {
          const aviso = `⚠️ Baixa de estoque incompleta — ${textoDaFalta(faltas)}. Confira o estoque físico.`;
          await db.orderEvent.create({
            data: {
              orderId: order.id,
              type: "NOTA",
              description: aviso,
              userId: user.id,
            },
          });
          const equipe = await db.user.findMany({
            where: {
              companyId: user.companyId,
              active: true,
              role: { in: ["ADMIN", "MANAGER"] },
            },
            select: { id: true },
          });
          if (equipe.length > 0) {
            await db.notification.createMany({
              data: equipe.map((u) => ({
                companyId: user.companyId,
                userId: u.id,
                type: "ASSIGN",
                title: `Estoque faltou no pedido ${orderNumber(order.number)}`,
                body: aviso.slice(0, 160),
                actorName: user.name,
              })),
            });
          }
        }
        // razão conforme o momento: reserva (orçamento/aguardando) ou baixa (pago)
        const motivo = enteringPaid
          ? `Baixa por pagamento — pedido ${orderNumber(order.number)}`
          : `Reserva — pedido ${orderNumber(order.number)}`;
        await db.inventoryMovement.createMany({
          data: order.items
            .filter((i) => i.variantId)
            .map((i) => ({
              companyId: user.companyId,
              variantId: i.variantId!,
              orderId: order.id,
              type: "SAIDA" as const,
              quantity: i.quantity,
              reason: motivo,
            })),
        });
        data.stockDeducted = true;
      } else if (needStockReturn) {
        for (const item of order.items) {
          if (!item.variantId) continue;
          await db.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { increment: item.quantity } },
          });
        }
        await db.inventoryMovement.createMany({
          data: order.items
            .filter((i) => i.variantId)
            .map((i) => ({
              companyId: user.companyId,
              variantId: i.variantId!,
              orderId: order.id,
              type: "ENTRADA" as const,
              quantity: i.quantity,
              reason: `Cancelamento do pedido ${orderNumber(order.number)}`,
            })),
        });
        data.stockDeducted = false;
      }

      // FATURAMENTO: sair de uma etapa paga (cancelou/voltou p/ orçamento) estorna
      // o pagamento e tira a venda do faturamento — independente do estoque.
      if (leavingPaid) {
        await db.payment.updateMany({
          where: { orderId: order.id, status: "CONFIRMADO" },
          data: { status: newStatus === "CANCELADO" ? "ESTORNADO" : "PENDENTE" },
        });
        await db.sale.deleteMany({ where: { orderId: order.id } });
      }

      // Integrações: a baixa/devolução feita AQUI é refletida na ORIGEM do
      // estoque — uma venda, uma baixa, sem divergir entre os sistemas.
      if (needStockDeduct || needStockReturn) {
        const variantIds = order.items
          .map((i) => i.variantId)
          .filter((v): v is string => !!v);
        pushStockToNuvemshop(user.companyId, variantIds).catch(() => {});
        // Jueri: delta EXATO por variação (reserva/baixa = −, cancelamento = +)
        const sinal = needStockReturn ? 1 : -1;
        const changes = order.items
          .filter((i) => i.variantId)
          .map((i) => ({ variantId: i.variantId!, delta: sinal * i.quantity }));
        pushStockToJueri(user.companyId, changes).catch(() => {});
      }
    }

    if (parsed.data.paymentMethod) {
      await db.payment.updateMany({
        where: { orderId: order.id },
        data: { method: parsed.data.paymentMethod },
      });
    }

    if (
      parsed.data.trackingCode !== undefined ||
      parsed.data.shippingMethod !== undefined
    ) {
      const shipData = {
        ...(parsed.data.trackingCode !== undefined
          ? { trackingCode: parsed.data.trackingCode }
          : {}),
        ...(parsed.data.shippingMethod !== undefined
          ? { method: parsed.data.shippingMethod }
          : {}),
      };
      // upsert: cria a linha de envio se ainda não existir (pedido novo/manual)
      await db.shipping.upsert({
        where: { orderId: order.id },
        update: shipData,
        create: { orderId: order.id, cost: order.shippingFee, ...shipData },
      });
      await db.orderEvent.create({
        data: {
          orderId: order.id,
          type: "ENVIO",
          description: `Dados de envio atualizados por ${user.name}`,
          userId: user.id,
        },
      });
    }

    const updated = await db.order.update({ where: { id }, data });

    // 💰 Notificação de venda: dispara quando o pedido ACABOU de virar pago.
    // Fire-and-forget: nunca atrasa nem quebra a resposta do pedido.
    if (enteringPaid) {
      const customer = await db.customer.findUnique({
        where: { id: order.customerId },
        select: { name: true },
      });
      notifySalePaid(user.companyId, {
        id: order.id,
        number: order.number,
        total: updated.total,
        customerName: customer?.name ?? "Cliente",
      }).catch(() => {});
    }

    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

/**
 * Excluir um pedido de vez — usado para limpar testes.
 * Desfaz TODO o efeito do pedido, como se ele nunca tivesse existido:
 *  1. devolve o estoque ao catálogo (se estava baixado);
 *  2. remove a venda do faturamento;
 *  3. apaga o histórico de estoque ligado a ele;
 *  4. apaga o pedido (itens, pagamentos, envio e eventos caem por cascata).
 * Permitido apenas para dono/admin/gerente — vendedor comum não exclui.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json(
        { error: "Você não tem permissão para excluir pedidos." },
        { status: 403 }
      );
    }
    const { id } = await params;
    const order = await db.order.findFirst({
      where: { id, ...orderScope(user) },
      include: { items: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }

    await db.$transaction(async (tx) => {
      const oppId = order.opportunityId;
      // Desfaz o pedido (estoque + faturamento) e o apaga.
      await reverseAndDeleteOrder(tx, order);
      // A oportunidade criada junto com este pedido sai do funil também.
      if (oppId) {
        await tx.opportunity.deleteMany({
          where: { id: oppId, companyId: user.companyId },
        });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
