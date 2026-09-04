import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";

/** CENTROS DE CUSTO (RN-029) — a "frente" do negócio (loja física, online…). */

export async function GET() {
  try {
    const porta = await porteiraFinanceiro();
    if (!porta.ok) return porta.resposta;
    const centros = await db.finCentroCusto.findMany({
      where: { companyId: porta.user.companyId },
      orderBy: [{ arquivadoEm: "asc" }, { nome: "asc" }],
    });
    return NextResponse.json({ centros });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

export async function POST(req: NextRequest) {
  try {
    const porta = await porteiraFinanceiro();
    if (!porta.ok) return porta.resposta;
    const parsed = z
      .object({ nome: z.string().trim().min(1).max(80) })
      .safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const centro = await db.finCentroCusto.create({
      data: { companyId: porta.user.companyId, nome: parsed.data.nome },
    });
    return NextResponse.json({ centro });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
