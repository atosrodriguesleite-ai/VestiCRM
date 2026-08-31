import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";

/**
 * CANCELAR uma transferência (RN-030) — errou a conta ou o valor.
 *
 * Como todo o módulo: não se apaga, se cancela com quem e quando. A
 * transferência cancelada some dos saldos e do extrato, mas continua na
 * lista, riscada — é o que explica "por que o saldo mudou".
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const porta = await porteiraFinanceiro();
    if (!porta.ok) return porta.resposta;
    const { id } = await params;
    const parsed = z
      .object({ cancelar: z.literal(true) })
      .safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

    // a trava do "ainda não cancelada" evita dois cliques virarem dois
    // registros de cancelamento com autores diferentes
    const r = await db.finTransferencia.updateMany({
      where: { id, companyId: porta.user.companyId, canceladaEm: null },
      data: { canceladaEm: new Date(), canceladaPor: porta.user.name },
    });
    if (r.count === 0)
      return NextResponse.json(
        { error: "Não encontrada ou já cancelada" },
        { status: 404 }
      );
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
