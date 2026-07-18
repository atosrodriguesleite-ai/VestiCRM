import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  ingestCancelledOrder,
  ingestPaidOrder,
  upsertProduct,
  loadConn,
  verifyWebhook,
} from "@/lib/nuvemshop";

/**
 * Webhook da Nuvemshop: venda paga, cancelamento e mudanças de produto.
 * O corpo traz {store_id, event, id}; buscamos o dado completo na API.
 * Assinatura HMAC (x-linkedstore-hmac-sha256) validada com o client secret.
 * Responde 200 sempre que possível — a Nuvemshop desativa webhooks que
 * falham repetidamente.
 */

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const ok = verifyWebhook(raw, req.headers.get("x-linkedstore-hmac-sha256"));
  if (!ok) return NextResponse.json({ error: "Assinatura inválida" }, { status: 401 });

  const body = JSON.parse(raw || "{}") as {
    store_id?: number | string;
    event?: string;
    id?: number | string;
  };
  if (!body.store_id || !body.event || body.id === undefined) {
    return NextResponse.json({ ok: true });
  }

  const conn = await db.nuvemshopConnection.findUnique({
    where: { storeId: String(body.store_id) },
  });
  if (!conn || conn.status !== "CONECTADO") return NextResponse.json({ ok: true });
  const companyId = conn.companyId;
  const id = String(body.id);

  try {
    switch (body.event) {
      case "order/paid":
        await ingestPaidOrder(companyId, id);
        break;
      case "order/cancelled":
        await ingestCancelledOrder(companyId, id);
        break;
      case "order/updated": {
        // pagamento pode chegar como "updated" com status pago
        const c = await loadConn(companyId);
        if (c) await ingestPaidOrderIfPaid(companyId, id);
        break;
      }
      case "product/created":
      case "product/updated": {
        const c = await loadConn(companyId);
        if (!c) break;
        const { nuvemshopEnv } = await import("@/lib/nuvemshop");
        const res = await fetch(`${nuvemshopEnv().apiBase}/${c.storeId}/products/${id}`, {
          headers: { Authentication: `bearer ${c.token}`, "User-Agent": "AtacadoPro" },
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data) await upsertProduct(companyId, data);
        break;
      }
      case "product/deleted": {
        // some da vitrine, sem apagar histórico
        await db.product.updateMany({
          where: { companyId, nuvemshopId: id },
          data: { active: false },
        });
        break;
      }
    }
  } catch {
    // erro interno não pode derrubar o webhook
  }
  return NextResponse.json({ ok: true });
}

/** order/updated: só importa quando o pagamento consta como pago. */
async function ingestPaidOrderIfPaid(companyId: string, nsOrderId: string) {
  const { nuvemshopEnv } = await import("@/lib/nuvemshop");
  const conn = await loadConn(companyId);
  if (!conn) return;
  const res = await fetch(`${nuvemshopEnv().apiBase}/${conn.storeId}/orders/${nsOrderId}`, {
    headers: { Authentication: `bearer ${conn.token}`, "User-Agent": "AtacadoPro" },
  });
  const o = (await res.json().catch(() => null)) as { payment_status?: string } | null;
  if (res.ok && o?.payment_status === "paid") {
    await ingestPaidOrder(companyId, nsOrderId);
  }
}
