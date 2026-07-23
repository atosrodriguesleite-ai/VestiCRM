import { NextRequest, NextResponse } from "next/server";
import { releaseExpiredReservations } from "@/lib/reservations";

/**
 * Solta as reservas de estoque vencidas (>48h em orçamento não pago).
 * Endpoint mantido pra disparo manual/emergência — o agendamento de verdade
 * roda DENTRO do cron diário (ver /api/cron/jueri-sync e vercel.json), pra não
 * estourar o limite de cron jobs do plano da Vercel.
 *
 * Protegido pelo CRON_SECRET.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET não configurado no servidor." },
      { status: 503 }
    );
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const out = await releaseExpiredReservations();
  return NextResponse.json({ ranAt: new Date().toISOString(), ...out });
}
