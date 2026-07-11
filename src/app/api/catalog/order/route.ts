import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { intakeLead, normalizePhone } from "@/lib/intake";

/**
 * Pedido vindo do catálogo público — POST /api/catalog/order
 *
 * Sem login: quando o cliente final toca em "Enviar pedido pelo WhatsApp",
 * o catálogo também registra o pedido AQUI, para ele aparecer na tela
 * Pedidos da loja com status "Aguardando pagamento".
 *
 *   • Com telefone → passa pelo Lead Intake Engine (deduplica cliente,
 *     cria conversa/oportunidade) e o pedido fica ligado a esse cliente.
 *   • Sem dados → cria um cliente "Cliente do catálogo (não identificado)"
 *     exclusivo do pedido; o vendedor preenche os dados depois, na tela
 *     do pedido.
 *
 * Preço e totais são recalculados no servidor (nunca confiamos no valor
 * enviado pelo navegador). O estoque NÃO baixa aqui — só quando o pedido
 * for marcado como pago (regra do sistema).
 */

const itemSchema = z.object({
  productId: z.string().min(1),
  color: z.string().min(1),
  size: z.string().min(1),
  quantity: z.number().int().positive().max(9999),
});

const schema = z.object({
  company: z.string().min(1), // slug da loja
  items: z.array(itemSchema).min(1).max(300),
  customer: z
    .object({
      name: z.string().max(120).optional(),
      phone: z.string().max(30).optional(),
      store: z.string().max(120).optional(),
    })
    .optional(),
  message: z.string().max(10000).optional(), // texto enviado no WhatsApp
});

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }
  const input = parsed.data;

  const company = await db.company.findUnique({
    where: { slug: input.company },
  });
  if (!company) {
    return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
  }

  // Resolve as variações (produto ativo + cor + tamanho) dentro da loja
  const productIds = [...new Set(input.items.map((i) => i.productId))];
  const products = await db.product.findMany({
    where: { id: { in: productIds }, companyId: company.id, active: true },
    include: {
      images: { orderBy: { order: "asc" }, take: 1 },
      variants: true,
    },
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  type Line = {
    productId: string;
    variantId: string;
    name: string;
    sku: string | null;
    imageUrl: string | null;
    color: string;
    size: string;
    quantity: number;
    unitPrice: number;
    total: number;
  };
  const lines: Line[] = [];
  for (const item of input.items) {
    const product = productById.get(item.productId);
    const variant = product?.variants.find(
      (v) => v.color === item.color && v.size === item.size
    );
    if (!product || !variant) {
      return NextResponse.json({ error: "Produto inválido" }, { status: 404 });
    }
    lines.push({
      productId: product.id,
      variantId: variant.id,
      name: product.name,
      sku: product.sku,
      imageUrl: product.images[0]?.url ?? null,
      color: variant.color,
      size: variant.size,
      quantity: item.quantity,
      unitPrice: product.retailPrice, // preço vigente no catálogo
      total: item.quantity * product.retailPrice,
    });
  }
  const subtotal = lines.reduce((a, l) => a + l.total, 0);
  const totalPieces = lines.reduce((a, l) => a + l.quantity, 0);

  // ---- Cliente ----
  const rawPhone = input.customer?.phone ?? "";
  const hasPhone = rawPhone.replace(/\D/g, "").length >= 8;
  const displayName =
    input.customer?.name?.trim() || input.customer?.store?.trim() || "";

  let customerId: string;
  let conversationId: string | null = null;
  let customerCity: string | null = null;
  let customerState: string | null = null;
  let opportunityId: string | null = null;

  if (hasPhone) {
    // Com telefone: entra pelo Lead Intake Engine (deduplica, cria
    // conversa e oportunidade — nenhum contato se perde).
    const result = await intakeLead(company.id, {
      phone: normalizePhone(rawPhone),
      name: displayName || undefined,
      origin: "CATALOGO_PUBLICO",
      message: input.message,
      opportunityTitle: `Pedido do catálogo — ${totalPieces} ${totalPieces === 1 ? "peça" : "peças"}`,
      value: subtotal,
    });
    customerId = result.customer.id;
    conversationId = result.conversation?.id ?? null;
    customerCity = result.customer.city;
    customerState = result.customer.state;
    // Só vincula a oportunidade que ACABOU de ser criada para este pedido;
    // se o intake reaproveitou uma já aberta, não a ligamos (não é "deste
    // pedido" e não deve ser apagada junto).
    opportunityId = result.opportunity?.id ?? null;
  } else {
    // Sem dados: cria um cliente próprio do pedido para o vendedor
    // completar manualmente na tela do pedido.
    const anon = await db.customer.create({
      data: {
        companyId: company.id,
        name: displayName || "Cliente do catálogo (não identificado)",
        phone: "",
        origin: "CATALOGO_PUBLICO",
      },
    });
    await db.customerEvent.create({
      data: {
        companyId: company.id,
        customerId: anon.id,
        type: "LEAD_CRIADO",
        channel: "CATALOGO_PUBLICO",
        description: "Pedido pelo catálogo sem identificação do cliente",
      },
    });
    customerId = anon.id;

    // Cria a oportunidade no Funil mesmo sem telefone — todo pedido do
    // catálogo deve aparecer no funil de vendas para acompanhamento.
    const stage =
      (
        await db.originRule.findUnique({
          where: {
            companyId_origin: {
              companyId: company.id,
              origin: "CATALOGO_PUBLICO",
            },
          },
          include: { stage: true },
        })
      )?.stage ??
      (await db.stage.findFirst({
        where: { pipeline: { companyId: company.id } },
        orderBy: { order: "asc" },
      }));
    if (stage) {
      const opp = await db.opportunity.create({
        data: {
          companyId: company.id,
          customerId: anon.id,
          stageId: stage.id,
          title: `Pedido do catálogo — ${totalPieces} ${totalPieces === 1 ? "peça" : "peças"}`,
          value: subtotal,
          status: stage.isWon ? "WON" : stage.isLost ? "LOST" : "OPEN",
        },
      });
      opportunityId = opp.id;
    }
  }

  const noteLines = [
    "Pedido recebido pelo catálogo público.",
    input.customer?.store ? `Loja: ${input.customer.store}` : null,
    input.customer?.name ? `Nome: ${input.customer.name}` : null,
    input.customer?.phone ? `Telefone: ${input.customer.phone}` : null,
  ].filter(Boolean);

  const order = await db.$transaction(async (tx) => {
    const last = await tx.order.findFirst({
      where: { companyId: company.id },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    return tx.order.create({
      data: {
        companyId: company.id,
        number: (last?.number ?? 0) + 1,
        customerId,
        conversationId,
        opportunityId,
        status: "AGUARDANDO_PAGAMENTO",
        subtotal,
        total: subtotal,
        notes: noteLines.join("\n"),
        items: { create: lines },
        payments: {
          create: { method: "PIX", amount: subtotal, status: "PENDENTE" },
        },
        shipping: { create: { cost: 0, city: customerCity, state: customerState } },
        events: {
          create: {
            type: "CRIADO",
            description: "Pedido recebido pelo catálogo público",
          },
        },
      },
    });
  });

  return NextResponse.json(
    { ok: true, orderId: order.id, number: order.number },
    { status: 201 }
  );
}
