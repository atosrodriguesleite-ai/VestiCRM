import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { computeOrderTotals, orderNumber } from "@/lib/orders";

const itemSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
});

const createSchema = z.object({
  customerId: z.string().min(1),
  conversationId: z.string().optional(),
  items: z.array(itemSchema).min(1),
  discount: z.number().nonnegative().default(0),
  shippingFee: z.number().nonnegative().default(0),
  notes: z.string().optional(),
  paymentMethod: z.enum(["PIX", "CARTAO", "BOLETO", "DINHEIRO", "OUTRO"]).default("PIX"),
  status: z.enum(["ORCAMENTO", "AGUARDANDO_PAGAMENTO"]).default("ORCAMENTO"),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const input = parsed.data;

    // valida cliente e conversa dentro do tenant
    const customer = await db.customer.findFirst({
      where: { id: input.customerId, companyId: user.companyId },
    });
    if (!customer) {
      return NextResponse.json({ error: "Cliente inválido" }, { status: 404 });
    }
    if (input.conversationId) {
      const conv = await db.conversation.findFirst({
        where: { id: input.conversationId, companyId: user.companyId },
      });
      if (!conv) {
        return NextResponse.json({ error: "Conversa inválida" }, { status: 404 });
      }
    }

    // carrega variantes (com produto) garantindo tenant e monta snapshot
    const variantIds = input.items.map((i) => i.variantId);
    const variants = await db.productVariant.findMany({
      where: {
        id: { in: variantIds },
        product: { companyId: user.companyId },
      },
      include: { product: { include: { images: { orderBy: { order: "asc" }, take: 1 } } } },
    });
    const variantById = new Map(variants.map((v) => [v.id, v]));
    for (const item of input.items) {
      const v = variantById.get(item.variantId);
      if (!v || v.productId !== item.productId) {
        return NextResponse.json({ error: "Produto inválido" }, { status: 404 });
      }
      if (v.stock < item.quantity) {
        return NextResponse.json(
          {
            error: `Estoque insuficiente de ${v.product.name} (${v.color} ${v.size}): restam ${v.stock}`,
          },
          { status: 409 }
        );
      }
    }

    const totals = computeOrderTotals(
      input.items,
      input.discount,
      input.shippingFee
    );

    const order = await db.$transaction(async (tx) => {
      const last = await tx.order.findFirst({
        where: { companyId: user.companyId },
        orderBy: { number: "desc" },
        select: { number: true },
      });
      const created = await tx.order.create({
        data: {
          companyId: user.companyId,
          number: (last?.number ?? 0) + 1,
          customerId: input.customerId,
          conversationId: input.conversationId,
          sellerId: user.id,
          status: input.status,
          subtotal: totals.subtotal,
          discount: totals.discount,
          shippingFee: totals.shippingFee,
          total: totals.total,
          notes: input.notes,
          items: {
            create: input.items.map((i) => {
              const v = variantById.get(i.variantId)!;
              return {
                productId: v.productId,
                variantId: v.id,
                name: v.product.name,
                sku: v.product.sku,
                imageUrl: v.product.images[0]?.url ?? null,
                color: v.color,
                size: v.size,
                quantity: i.quantity,
                unitPrice: i.unitPrice,
                total: i.quantity * i.unitPrice,
              };
            }),
          },
          payments: {
            create: {
              method: input.paymentMethod,
              amount: totals.total,
              status: "PENDENTE",
            },
          },
          shipping: {
            create: {
              cost: totals.shippingFee,
              city: customer.city,
              state: customer.state,
            },
          },
          events: {
            create: {
              type: "CRIADO",
              description: `Pedido criado por ${user.name}`,
              userId: user.id,
            },
          },
        },
        include: { items: true },
      });

      // reserva estoque: baixa nas variantes + movimento de saída
      for (const i of input.items) {
        await tx.productVariant.update({
          where: { id: i.variantId },
          data: { stock: { decrement: i.quantity } },
        });
      }
      await tx.inventoryMovement.createMany({
        data: input.items.map((i) => ({
          companyId: user.companyId,
          variantId: i.variantId,
          orderId: created.id,
          type: "SAIDA" as const,
          quantity: i.quantity,
          reason: `Pedido ${orderNumber(created.number)}`,
        })),
      });

      return created;
    });

    // registra o pedido no histórico da conversa (timeline do WhatsApp)
    if (input.conversationId) {
      const resumo = order.items
        .map((i) => `• ${i.quantity}x ${i.name} ${i.color ?? ""} ${i.size ?? ""}`.trim())
        .join("\n");
      await db.message.create({
        data: {
          conversationId: input.conversationId,
          direction: "OUT",
          kind: "NOTE",
          body: `🛍️ Pedido ${orderNumber(order.number)} criado — total R$ ${order.total.toFixed(2)}\n${resumo}`,
          authorId: user.id,
        },
      });
      await db.conversation.update({
        where: { id: input.conversationId },
        data: { lastMessageAt: new Date() },
      });
    }

    return NextResponse.json(order, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
