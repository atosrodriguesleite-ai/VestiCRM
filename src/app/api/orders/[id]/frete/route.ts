import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError, type SessionUser } from "@/lib/auth";
import { isManagerUp, orderScope } from "@/lib/scope";
import { orderNumber } from "@/lib/orders";
import {
  meCalculate,
  meBuyShipment,
  meTracking,
  mePrintUrl,
  meRetomarEtiqueta,
  meCancel,
  pesoDoPedidoKg,
} from "@/lib/melhorenvio";

/**
 * Frete do pedido via Melhor Envio (módulo Envios, gated por loja).
 * GET  → situação do envio (atualiza o rastreio na hora)
 * POST → { action: "cotar" | "comprar" | "etiqueta" | "cancelar" }
 * Cotar é livre; comprar/cancelar mexem com dinheiro → gerente/admin.
 */

export const maxDuration = 30; // compra faz 4 chamadas externas em sequência

async function carregarPedido(user: SessionUser, orderId: string) {
  const userCompanyId = user.companyId;
  const [company, conn, order] = await Promise.all([
    db.company.findUnique({
      where: { id: userCompanyId },
      select: { shippingEnabled: true },
    }),
    db.melhorEnvioConnection.findUnique({ where: { companyId: userCompanyId } }),
    db.order.findFirst({
      where: { id: orderId, ...orderScope(user) },
      include: {
        customer: true,
        shipping: true,
        items: {
          include: { product: { select: { weightGrams: true, category: true, name: true } } },
        },
      },
    }),
  ]);
  return { company, conn, order };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const { company, conn, order } = await carregarPedido(user, id);
    if (!order)
      return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    if (!company?.shippingEnabled)
      return NextResponse.json({ error: "Módulo Envios não contratado." }, { status: 403 });

    let ship = order.shipping;
    // rastreio ao vivo: consulta o ME e guarda o que mudou
    if (ship?.meOrderId && conn && ship.meStatus !== "CANCELADO") {
      const t = await meTracking(user.companyId, ship.meOrderId).catch(() => null);
      if (t) {
        const novoStatus =
          t.status === "delivered"
            ? "ENTREGUE"
            : t.status === "posted"
              ? "POSTADO"
              : t.status === "cancelled" || t.status === "canceled"
                ? "CANCELADO"
                : ship.meStatus;
        if ((t.tracking && t.tracking !== ship.trackingCode) || novoStatus !== ship.meStatus) {
          ship = await db.shipping.update({
            where: { id: ship.id },
            data: {
              ...(t.tracking ? { trackingCode: t.tracking } : {}),
              meStatus: novoStatus,
              ...(novoStatus === "POSTADO" && !ship.shippedAt
                ? { shippedAt: new Date() }
                : {}),
              ...(novoStatus === "ENTREGUE" && !ship.deliveredAt
                ? { deliveredAt: new Date() }
                : {}),
            },
          });
        }
      }
    }
    return NextResponse.json({ connected: Boolean(conn), shipping: ship });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

const postSchema = z.object({
  action: z.enum(["cotar", "comprar", "gerar", "etiqueta", "cancelar"]),
  serviceId: z.number().int().positive().optional(),
  service: z.string().max(60).optional(),
  carrier: z.string().max(60).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const { action } = parsed.data;

    const { company, conn, order } = await carregarPedido(user, id);
    if (!order)
      return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    if (!company?.shippingEnabled)
      return NextResponse.json({ error: "Módulo Envios não contratado." }, { status: 403 });
    if (!conn)
      return NextResponse.json(
        { error: "Conecte o Melhor Envio em Configurações." },
        { status: 409 }
      );

    const destZip = (order.customer.zip ?? "").replace(/\D/g, "");
    const pesoKg = pesoDoPedidoKg(order.items, conn);
    // valor segurado = valor das peças (sem frete)
    const valorPecas = Math.max(0, order.subtotal - order.discount);

    if (action === "cotar") {
      if (destZip.length !== 8)
        return NextResponse.json(
          { error: "Cliente sem CEP válido. Preencha o endereço no cadastro do cliente." },
          { status: 409 }
        );
      const r = await meCalculate({
        companyId: user.companyId,
        toZip: destZip,
        weightKg: pesoKg,
        insuranceValue: valorPecas,
      });
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
      return NextResponse.json({ quotes: r.quotes, weightKg: pesoKg });
    }

    if (action === "comprar") {
      if (!isManagerUp(user))
        return NextResponse.json(
          { error: "Só gerente ou admin podem comprar frete." },
          { status: 403 }
        );
      if (!parsed.data.serviceId)
        return NextResponse.json({ error: "Escolha um serviço de frete." }, { status: 400 });
      if (order.status === "CANCELADO")
        return NextResponse.json(
          { error: "Pedido cancelado não pode ter frete." },
          { status: 409 }
        );
      if (order.shipping?.meOrderId && order.shipping.meStatus !== "CANCELADO")
        return NextResponse.json(
          { error: "Este pedido já tem uma etiqueta comprada." },
          { status: 409 }
        );
      const c = order.customer;
      const faltando = [
        !destZip && "CEP",
        !c.street?.trim() && "rua",
        !c.streetNumber?.trim() && "número",
        !c.city?.trim() && "cidade",
        !c.state?.trim() && "estado",
      ].filter(Boolean);
      if (faltando.length)
        return NextResponse.json(
          { error: `Complete o endereço do cliente: falta ${faltando.join(", ")}.` },
          { status: 409 }
        );
      if (!conn.fromZip || !conn.fromStreet || !conn.fromCity || !conn.fromState || !conn.fromName)
        return NextResponse.json(
          { error: "Complete o endereço do remetente em Configurações → Melhor Envio." },
          { status: 409 }
        );

      const r = await meBuyShipment({
        companyId: user.companyId,
        serviceId: parsed.data.serviceId,
        from: {
          name: conn.fromName,
          cpf: conn.fromCpf,
          cnpj: conn.fromCnpj,
          phone: conn.fromPhone,
          email: conn.fromEmail,
          zip: conn.fromZip,
          street: conn.fromStreet,
          number: conn.fromNumber ?? "S/N",
          complement: conn.fromComplement,
          district: conn.fromDistrict,
          city: conn.fromCity,
          state: conn.fromState,
        },
        to: {
          name: c.name,
          cpf: c.cpf,
          cnpj: c.cnpj,
          phone: c.phone,
          email: c.email,
          zip: destZip,
          street: c.street!,
          number: c.streetNumber!,
          complement: c.complement,
          district: c.district,
          city: c.city!,
          state: c.state!,
        },
        items: order.items.map((i) => ({
          name: i.name, // snapshot do momento da venda
          quantity: i.quantity,
          unitPrice: i.unitPrice,
        })),
        weightKg: pesoKg,
        insuranceValue: valorPecas,
        orderLabel: `Pedido ${orderNumber(order.number)}`,
      });
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });

      // pago mas a etiqueta ainda não gerou: grava o meOrderId (status
      // GERANDO) para o retry RETOMAR a geração — não comprar de novo
      const meStatus = r.pendente ? "GERANDO" : "ETIQUETA";

      const ship = await db.shipping.upsert({
        where: { orderId: order.id },
        update: {
          method: parsed.data.carrier ?? "Melhor Envio",
          meOrderId: r.meOrderId,
          meService: parsed.data.service ?? null,
          meCarrier: parsed.data.carrier ?? null,
          mePrice: r.price,
          meStatus,
          labelUrl: r.labelUrl,
          weightKg: pesoKg,
          ...(r.tracking ? { trackingCode: r.tracking } : {}),
          zip: destZip,
          address: `${c.street}, ${c.streetNumber}${c.complement ? ` — ${c.complement}` : ""}`,
          city: c.city,
          state: c.state,
        },
        create: {
          orderId: order.id,
          method: parsed.data.carrier ?? "Melhor Envio",
          meOrderId: r.meOrderId,
          meService: parsed.data.service ?? null,
          meCarrier: parsed.data.carrier ?? null,
          mePrice: r.price,
          meStatus,
          labelUrl: r.labelUrl,
          weightKg: pesoKg,
          trackingCode: r.tracking,
          zip: destZip,
          address: `${c.street}, ${c.streetNumber}${c.complement ? ` — ${c.complement}` : ""}`,
          city: c.city,
          state: c.state,
        },
      });
      await db.orderEvent.create({
        data: {
          orderId: order.id,
          type: "ENVIO",
          description: `Etiqueta comprada por ${user.name} — ${parsed.data.carrier ?? ""} ${parsed.data.service ?? ""} (R$ ${r.price.toFixed(2).replace(".", ",")}, ${pesoKg} kg) via Melhor Envio`,
          userId: user.id,
        },
      });
      return NextResponse.json({ shipping: ship });
    }

    // RETOMAR: etiqueta paga que não gerou (status GERANDO) — regenera sem
    // recomprar. Fecha o buraco do dinheiro que saía e a etiqueta se perdia.
    if (action === "gerar") {
      if (!isManagerUp(user))
        return NextResponse.json(
          { error: "Só gerente ou admin podem gerar a etiqueta." },
          { status: 403 }
        );
      if (!order.shipping?.meOrderId)
        return NextResponse.json({ error: "Este pedido não tem etiqueta paga." }, { status: 409 });
      const rg = await meRetomarEtiqueta(user.companyId, order.shipping.meOrderId);
      if (!rg.ok) return NextResponse.json({ error: rg.error }, { status: 502 });
      const ship = await db.shipping.update({
        where: { id: order.shipping.id },
        data: {
          meStatus: "ETIQUETA",
          labelUrl: rg.labelUrl,
          ...(rg.tracking ? { trackingCode: rg.tracking } : {}),
        },
      });
      return NextResponse.json({ shipping: ship });
    }

    if (action === "etiqueta") {
      if (!order.shipping?.meOrderId)
        return NextResponse.json({ error: "Este pedido não tem etiqueta." }, { status: 409 });
      const url = await mePrintUrl(user.companyId, order.shipping.meOrderId);
      if (!url)
        return NextResponse.json(
          { error: "Não foi possível gerar o link da etiqueta agora." },
          { status: 502 }
        );
      await db.shipping.update({
        where: { id: order.shipping.id },
        data: { labelUrl: url },
      });
      return NextResponse.json({ url });
    }

    // cancelar (etiqueta ainda não postada; o valor volta para a carteira ME)
    if (!isManagerUp(user))
      return NextResponse.json(
        { error: "Só gerente ou admin podem cancelar frete." },
        { status: 403 }
      );
    if (!order.shipping?.meOrderId)
      return NextResponse.json({ error: "Este pedido não tem etiqueta." }, { status: 409 });
    const cancel = await meCancel(user.companyId, order.shipping.meOrderId);
    if (!cancel.ok)
      return NextResponse.json({ error: cancel.error }, { status: 502 });
    const ship = await db.shipping.update({
      where: { id: order.shipping.id },
      data: { meStatus: "CANCELADO" },
    });
    await db.orderEvent.create({
      data: {
        orderId: order.id,
        type: "ENVIO",
        description: `Etiqueta cancelada por ${user.name} — o valor volta para a carteira Melhor Envio da loja`,
        userId: user.id,
      },
    });
    return NextResponse.json({ shipping: ship });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
