import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { imageSrc } from "@/lib/img";
import { requireUser, AuthError } from "@/lib/auth";
import { computeOrderTotals, orderNumber } from "@/lib/orders";
import { pushStockToNuvemshop } from "@/lib/nuvemshop";
import { pushStockToJueri } from "@/lib/jueri";
import { reservarEstoque, textoDaFalta } from "@/lib/reservations";

/** Peça que se foi entre a conferência e a baixa (duas vendas simultâneas). */
class SemEstoque extends Error {}

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
  // quando vem porcentagem, ela manda: o valor em reais é derivado do subtotal
  discountPct: z.number().min(0).max(100).nullish(),
  surcharge: z.number().nonnegative().default(0),
  surchargePct: z.number().min(0).max(100).nullish(),
  shippingFee: z.number().nonnegative().default(0),
  notes: z.string().optional(),
  paymentMethod: z.enum(["PIX", "CARTAO", "BOLETO", "CHEQUE", "DINHEIRO", "OUTRO"]).default("PIX"),
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
      { valor: input.discount, pct: input.discountPct },
      input.shippingFee,
      { valor: input.surcharge, pct: input.surchargePct }
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
          discountPct: input.discountPct ?? null,
          surcharge: totals.surcharge,
          surchargePct: input.surchargePct ?? null,
          shippingFee: totals.shippingFee,
          netTotal: totals.netTotal,
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
                imageUrl: v.product.images[0] ? imageSrc(v.product.images[0]) : null,
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

      // RESERVA: o pedido do vendedor (orçamento/aguardando) já SEGURA o estoque
      // na criação — assim dois vendedores não vendem a mesma peça. A peça só
      // volta quando o pedido for CANCELADO — a reserva não tem prazo.
      // Registra o movimento pra ficar auditável/reversível.
      //
      // A baixa é CONDICIONADA ao estoque existente (não é um decremento
      // cego): a conferência lá em cima e a baixa aqui são dois momentos, e
      // duas vendedoras fechando a última peça no mesmo segundo passavam as
      // duas. Se a peça se foi no meio, a transação inteira é desfeita.
      const faltas = await reservarEstoque(
        tx,
        input.items.map((it) => {
          const v = variantById.get(it.variantId)!;
          return {
            variantId: it.variantId,
            quantity: it.quantity,
            label: `${v.product.name} (${v.color} ${v.size})`,
          };
        })
      );
      if (faltas.length > 0) throw new SemEstoque(textoDaFalta(faltas));
      await tx.inventoryMovement.createMany({
        data: created.items
          .filter((i) => i.variantId)
          .map((i) => ({
            companyId: user.companyId,
            variantId: i.variantId!,
            orderId: created.id,
            type: "SAIDA" as const,
            quantity: i.quantity,
            reason: `Reserva — pedido ${orderNumber(created.number)}`,
          })),
      });
      await tx.order.update({ where: { id: created.id }, data: { stockDeducted: true } });

      return created;
    });

    // Integrações: a reserva feita AQUI é refletida na ORIGEM do estoque
    // (Nuvemshop/Jueri) — a peça reservada some do estoque dos outros canais
    // no mesmo instante, então ninguém vende a mesma peça em dois lugares.
    const reservedVariantIds = order.items
      .map((i) => i.variantId)
      .filter((v): v is string => !!v);
    if (reservedVariantIds.length > 0) {
      pushStockToNuvemshop(user.companyId, reservedVariantIds).catch(() => {});
      const changes = order.items
        .filter((i) => i.variantId)
        .map((i) => ({ variantId: i.variantId!, delta: -i.quantity }));
      pushStockToJueri(user.companyId, changes).catch(() => {});
    }

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
    // a peça acabou no meio do caminho: nada foi criado, e a vendedora
    // recebe na hora qual peça e quanto restou
    if (e instanceof SemEstoque)
      return NextResponse.json(
        { error: `Estoque insuficiente — ${e.message}. Ajuste as quantidades.` },
        { status: 409 }
      );
    throw e;
  }
}
