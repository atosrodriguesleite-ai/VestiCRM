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
  // O visitorId tem que ser dono de uma sessão DESTA loja. Sem isto, a rota
  // (pública) era um oráculo: qualquer um perguntava "esse telefone é cliente
  // da loja X?" e recebia o customerId (auditoria 07/08/2026).
  const sessao = await db.trackSession.findFirst({
    where: { companyId: company.id, visitorId: parsed.data.visitorId },
    select: { id: true },
  });
  if (!sessao) {
    return NextResponse.json({ ok: true });
  }
  const result = await identifyVisitor(
    company.id,
    parsed.data.visitorId,
    parsed.data.phone
  );
  // nunca devolve o customerId cru para um chamador não autenticado —
  // o cliente do catálogo usa a chamada só para unificar (fire-and-forget)
  return NextResponse.json({ ok: result.ok, linked: result.linked ?? false });
}
