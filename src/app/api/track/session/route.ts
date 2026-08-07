import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { startSession } from "@/lib/tracking/engine";
import { ehRobo } from "@/lib/robo";

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
  // robô não abre sessão: mesma régua da bio (visita e clique). Na prática o
  // tracking já exige JS + consentimento, mas a porta pública não precisa
  // aceitar curl/crawler inflando visita de loja.
  if (ehRobo(req.headers.get("user-agent"))) {
    return NextResponse.json({ ok: false }, { status: 202 });
  }
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
