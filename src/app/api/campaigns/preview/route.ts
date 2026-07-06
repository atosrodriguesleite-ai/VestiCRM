import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { evaluateSegment, type SegmentFilter } from "@/lib/segments";

/** Retorna quantos (e quais) clientes um filtro de campanha alcança. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const filter = (await req.json().catch(() => ({}))) as SegmentFilter;
    const customers = await evaluateSegment(user, filter);
    return NextResponse.json({
      count: customers.length,
      sample: customers.slice(0, 8),
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
