import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { imageSrc } from "@/lib/img";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";
import { reverseAndDeleteOrder } from "@/lib/order-actions";
import { notifySalePaid } from "@/lib/push";
import { orderStatusLabel, orderNumber, PAID_ORDER_STATUSES } from "@/lib/orders";
import { computeOrderTotals } from "@/lib/orders";

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
  shippingFee: z.number().nonnegative().optional(),
});

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
      where: { id, companyId: user.companyId },
      include: { items: true, payments: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
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

      const discount = parsed.data.discount ?? order.discount;
      const shippingFee = parsed.data.shippingFee ?? order.shippingFee;
      const totals = computeOrderTotals(parsed.data.items, discount, shippingFee);
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
            shippingFee: totals.shippingFee,
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
          // faturamento acompanha o novo total (venda já registrada)
          await tx.sale.updateMany({
            where: { orderId: order.id },
            data: { total: totals.total },
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
            description: `Itens do pedido editados por ${user.name} — novo total R$ ${totals.total.toFixed(2)}`,
            userId: user.id,
          },
        });
      });
      // se veio SÓ a edição de itens, responde aqui
      if (!parsed.data.status && !parsed.data.notes && parsed.data.sellerId === undefined && !parsed.data.customerId && !parsed.data.paymentMethod && parsed.data.trackingCode === undefined && parsed.data.shippingMethod === undefined) {
        const updated = await db.order.findUnique({ where: { id: order.id } });
        return NextResponse.json(updated);
      }
    }

    const newStatus = parsed.data.status;
    // Estados em que o pedido está pago → o estoque deve estar baixado.
    const PAID_STATUSES = new Set<string>(PAID_ORDER_STATUSES);
    const willChangeStatus = !!newStatus && newStatus !== order.status;
    const needDeduct =
      willChangeStatus && PAID_STATUSES.has(newStatus!) && !order.stockDeducted;
    const needReturn =
      willChangeStatus && !PAID_STATUSES.has(newStatus!) && order.stockDeducted;

    // Regra: um pedido só pode virar PAGO com um vendedor atribuído.
    if (needDeduct) {
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

    // Antes de escrever: se o pedido vai baixar estoque agora (virou pago),
    // confere disponibilidade e bloqueia se faltar.
    if (needDeduct) {
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
    if (parsed.data.sellerId !== undefined) {
      if (parsed.data.sellerId) {
        const seller = await db.user.findFirst({
          where: { id: parsed.data.sellerId, companyId: user.companyId },
        });
        if (!seller) {
          return NextResponse.json({ error: "Vendedor inválido" }, { status: 404 });
        }
      }
      data.sellerId = parsed.data.sellerId;
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
      if (PAID_STATUSES.has(newStatus) && !PAID_STATUSES.has(order.status)) {
        const pending = order.payments.find((p) => p.status === "PENDENTE");
        if (pending) {
          await db.payment.update({
            where: { id: pending.id },
            data: { status: "CONFIRMADO", paidAt: new Date() },
          });
        }
        await db.sale.create({
          data: {
            companyId: user.companyId,
            customerId: order.customerId,
            sellerId: order.sellerId,
            orderId: order.id,
            total: order.total,
            description: `Pedido ${orderNumber(order.number)}`,
            category: "Pedido",
          },
        });
        await db.customer.update({
          where: { id: order.customerId },
          data: { lastPurchaseAt: new Date() },
        });
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

      // ---- Estoque: baixa quando vira pago; devolve ao cancelar/estornar ----
      if (needDeduct) {
        for (const item of order.items) {
          if (!item.variantId) continue;
          await db.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { decrement: item.quantity } },
          });
        }
        await db.inventoryMovement.createMany({
          data: order.items
            .filter((i) => i.variantId)
            .map((i) => ({
              companyId: user.companyId,
              variantId: i.variantId!,
              orderId: order.id,
              type: "SAIDA" as const,
              quantity: i.quantity,
              reason: `Baixa por pagamento — pedido ${orderNumber(order.number)}`,
            })),
        });
        data.stockDeducted = true;
      } else if (needReturn) {
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
              reason:
                newStatus === "CANCELADO"
                  ? `Cancelamento do pedido ${orderNumber(order.number)}`
                  : `Estorno de estoque — pedido ${orderNumber(order.number)}`,
            })),
        });
        data.stockDeducted = false;
        // pagamento confirmado é estornado junto (cancelamento/estorno)
        await db.payment.updateMany({
          where: { orderId: order.id, status: "CONFIRMADO" },
          data: { status: newStatus === "CANCELADO" ? "ESTORNADO" : "PENDENTE" },
        });
        // a VENDA sai do faturamento: cancelou/estornou, não é mais venda
        await db.sale.deleteMany({ where: { orderId: order.id } });
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
      await db.shipping.update({
        where: { orderId: order.id },
        data: {
          ...(parsed.data.trackingCode !== undefined
            ? { trackingCode: parsed.data.trackingCode }
            : {}),
          ...(parsed.data.shippingMethod !== undefined
            ? { method: parsed.data.shippingMethod }
            : {}),
        },
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
    if (needDeduct) {
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
      where: { id, companyId: user.companyId },
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
