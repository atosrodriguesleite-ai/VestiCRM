import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { verifyWebhook } from "@/lib/nuvemshop";

/**
 * Webhooks obrigatórios da LGPD (Nuvemshop) — pedidos de privacidade de dados.
 * Um único endpoint atende os TRÊS que a Nuvemshop exige no painel:
 *   • customers/redact        → anonimiza os dados do cliente aqui no CRM
 *   • customers/data_request  → confirmamos (os dados ficam com a própria loja)
 *   • store/redact            → a loja desinstalou; confirmamos o recebimento
 *
 * Sempre responde 200 (a Nuvemshop desativa apps cujo webhook falha). A
 * limpeza SÓ acontece quando a assinatura HMAC confere — assim ninguém
 * consegue forjar um pedido de exclusão de dados.
 */
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const valid = verifyWebhook(raw, req.headers.get("x-linkedstore-hmac-sha256"));

  try {
    if (valid) {
      const body = JSON.parse(raw || "{}") as {
        store_id?: number | string;
        customer?: { id?: number | string; email?: string | null };
        orders_to_redact?: unknown;
      };
      const storeId = body.store_id != null ? String(body.store_id) : null;

      // customers/redact: chega com o cliente + a lista de pedidos a apagar
      if (storeId && body.customer && body.orders_to_redact !== undefined) {
        const conn = await db.nuvemshopConnection.findUnique({ where: { storeId } });
        if (conn) {
          const nsId = body.customer.id != null ? String(body.customer.id) : null;
          const email = body.customer.email?.trim() || null;
          const or: Prisma.CustomerWhereInput[] = [];
          if (nsId) or.push({ phone: `ns-${nsId}` });
          if (email) or.push({ email });
          if (or.length > 0) {
            await db.customer.updateMany({
              where: { companyId: conn.companyId, OR: or },
              data: {
                name: "Cliente removido (LGPD)",
                email: null,
                document: null,
                street: null,
                streetNumber: null,
                district: null,
                city: null,
                state: null,
                zip: null,
                ...(nsId ? { phone: `lgpd-${conn.companyId}-${nsId}` } : {}),
              },
            });
          }
        }
      }
      // customers/data_request e store/redact: apenas confirmamos (200)
    }
  } catch {
    // um webhook de LGPD nunca pode derrubar a resposta
  }

  return NextResponse.json({ ok: true });
}
