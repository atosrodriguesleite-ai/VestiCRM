import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { startSession } from "@/lib/tracking/engine";

const schema = z.object({
  company: z.string().min(1),
  visitorId: z.string().nullable().optional(),
  ref: z.string().nullable().optional(),
  c: z.string().nullable().optional(), // link rastreado por cliente
  utm: z
    .object({
      source: z.string().nullable().optional(),
      medium: z.string().nullable().optional(),
      campaign: z.string().nullable().optional(),
      term: z.string().nullable().optional(),
      content: z.string().nullable().optional(),
    })
    .optional(),
  referer: z.string().nullable().optional(),
});

/** Abre uma sessão de navegação no catálogo (Tracking Engine). */
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

  const result = await startSession({
    companyId: company.id,
    visitorId: parsed.data.visitorId,
    ref: parsed.data.ref,
    customerId: parsed.data.c,
    utm: parsed.data.utm,
    referer: parsed.data.referer,
    userAgent: req.headers.get("user-agent"),
    ip: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip"),
    city: req.headers.get("x-vercel-ip-city"),
    state: req.headers.get("x-vercel-ip-country-region"),
    country: req.headers.get("x-vercel-ip-country") ?? "BR",
  });

  return NextResponse.json(result, { status: 201 });
}
