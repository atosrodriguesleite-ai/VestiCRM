import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { identifyVisitor } from "@/lib/tracking/engine";

const schema = z.object({
  company: z.string().min(1),
  visitorId: z.string().min(1),
  phone: z.string().min(8),
});

/** Visitante anônimo informou o telefone → unifica toda a navegação. */
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
  const result = await identifyVisitor(
    company.id,
    parsed.data.visitorId,
    parsed.data.phone
  );
  return NextResponse.json(result);
}
