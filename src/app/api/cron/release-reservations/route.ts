import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { orderNumber } from "@/lib/orders";
import { pushStockToNuvemshop } from "@/lib/nuvemshop";
import { pushStockToJueri } from "@/lib/jueri";

/**
 * Expiração das reservas — roda a cada hora (agendada no Vercel, ver
 * vercel.json). Quando um vendedor monta um orçamento, a peça sai do estoque
 * na hora pra ninguém vender a mesma peça duas vezes. Mas se a venda não
 * fecha, a peça não pode ficar presa pra sempre: depois de 48h sem virar
 * pedido pago, a reserva é solta e o estoque volta sozinho.
 *
 * Solta só pedidos AINDA em orçamento/aguardando (não pagos) que estão
 * segurando estoque (stockDeducted) e foram criados há mais de 48h. Registra
 * a devolução (ENTRADA "Reserva expirada") e reflete nas integrações.
 *
 * Protegida pelo CRON_SECRET, igual à sincronização da Jueri.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const RESERVA_HORAS = 48;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET não configurado no servidor." },
      { status: 503 }
    );
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const limite = new Date(Date.now() - RESERVA_HORAS * 60 * 60 * 1000);

  // pedidos ainda não-pagos que seguram estoque há mais de 48h
  const expirados = await db.order.findMany({
    where: {
      status: { in: ["ORCAMENTO", "AGUARDANDO_PAGAMENTO"] },
      stockDeducted: true,
      createdAt: { lt: limite },
    },
    include: { items: true },
  });

  const soltos: { number: number; companyId: string }[] = [];

  for (const order of expirados) {
    try {
      await db.$transaction(async (tx) => {
        for (const it of order.items) {
          if (!it.variantId) continue;
          await tx.productVariant.update({
            where: { id: it.variantId },
            data: { stock: { increment: it.quantity } },
          });
        }
        await tx.inventoryMovement.createMany({
          data: order.items
            .filter((i) => i.variantId)
            .map((i) => ({
              companyId: order.companyId,
              variantId: i.variantId!,
              orderId: order.id,
              type: "ENTRADA" as const,
              quantity: i.quantity,
              reason: `Reserva expirada (48h) — pedido ${orderNumber(order.number)}`,
            })),
        });
        await tx.order.update({
          where: { id: order.id },
          data: { stockDeducted: false },
        });
      });

      // devolve o estoque solto pra origem (Nuvemshop absoluto / Jueri delta +)
      const variantIds = order.items
        .map((i) => i.variantId)
        .filter((v): v is string => !!v);
      if (variantIds.length > 0) {
        pushStockToNuvemshop(order.companyId, variantIds).catch(() => {});
        const changes = order.items
          .filter((i) => i.variantId)
          .map((i) => ({ variantId: i.variantId!, delta: i.quantity }));
        pushStockToJueri(order.companyId, changes).catch(() => {});
      }

      soltos.push({ number: order.number, companyId: order.companyId });
    } catch {
      // um pedido problemático não pode travar os outros
    }
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    verificados: expirados.length,
    soltos: soltos.length,
    pedidos: soltos.map((s) => orderNumber(s.number)),
  });
}
