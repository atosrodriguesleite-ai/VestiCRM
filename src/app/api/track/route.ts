import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { trackEvents } from "@/lib/tracking/engine";

const schema = z.object({
  company: z.string().min(1),
  sessionId: z.string().min(1),
  events: z
    .array(
      z.object({
        type: z.string().min(1),
        productId: z.string().optional(),
        productName: z.string().optional(),
        category: z.string().optional(),
        color: z.string().optional(),
        size: z.string().optional(),
        qty: z.number().int().optional(),
        value: z.number().optional(),
        meta: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .min(1)
    .max(100),
});

/**
 * Recebe lotes de eventos do catálogo (sendBeacon/keepalive — nunca
 * bloqueia o carregamento). Toda gravação passa pela Tracking Engine.
 */
export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }
  const company = await db.company.findUnique({
    where: { slug: parsed.data.company },
  });
  if (!company) {
    return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
  }
  const result = await trackEvents(
    company.id,
    parsed.data.sessionId,
    parsed.data.events
  );
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
