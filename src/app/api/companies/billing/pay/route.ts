import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { nextCompetencia, formatCompetencia } from "@/lib/billing";

/**
 * Registra um pagamento (manual) de uma loja — só o Super Admin.
 *   RECORRENCIA → quita o próximo mês em aberto e avança `paidThrough`.
 *   IMPLEMENTACAO → marca a implementação como paga.
 * Cada registro vira uma linha no histórico (alimenta o "recebido no mês").
 */

const schema = z.object({
  companyId: z.string().min(1),
  kind: z.enum(["RECORRENCIA", "IMPLEMENTACAO"]),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (user.role !== "SUPERADMIN") {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const { companyId, kind } = parsed.data;

    const billing = await db.companyBilling.findUnique({ where: { companyId } });
    if (!billing) {
      return NextResponse.json(
        { error: "Configure os valores da loja antes de registrar pagamento." },
        { status: 409 }
      );
    }

    if (kind === "IMPLEMENTACAO") {
      if (billing.implementationFee <= 0) {
        return NextResponse.json(
          { error: "Defina o valor da implementação primeiro." },
          { status: 400 }
        );
      }
      if (billing.implementationPaid) {
        return NextResponse.json(
          { error: "Implementação já está marcada como paga." },
          { status: 409 }
        );
      }
      await db.$transaction([
        db.companyBilling.update({
          where: { companyId },
          data: { implementationPaid: true, implementationPaidAt: new Date() },
        }),
        db.billingPayment.create({
          data: {
            billingId: billing.id,
            companyId,
            kind: "IMPLEMENTACAO",
            amount: billing.implementationFee,
          },
        }),
      ]);
      return NextResponse.json({ ok: true, message: "Implementação registrada." });
    }

    // RECORRENCIA
    if (billing.monthlyFee <= 0) {
      return NextResponse.json(
        { error: "Defina o valor da recorrência primeiro." },
        { status: 400 }
      );
    }
    const competencia = nextCompetencia(billing.paidThrough);
    await db.$transaction([
      db.companyBilling.update({
        where: { companyId },
        data: { paidThrough: competencia },
      }),
      db.billingPayment.create({
        data: {
          billingId: billing.id,
          companyId,
          kind: "RECORRENCIA",
          amount: billing.monthlyFee,
          competencia,
        },
      }),
    ]);
    return NextResponse.json({
      ok: true,
      message: `Pagamento de ${formatCompetencia(competencia)} registrado.`,
      paidThrough: competencia,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
