import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { reiniciarConexaoDaLoja } from "@/lib/comm/reiniciar-conexao";

/**
 * Reinicia a conexão do WhatsApp de QUALQUER loja (RN-105) — só o Super
 * Admin, pelo painel de Saúde: é ali que a loja muda aparece, e quem a vê
 * precisa poder agir sem entrar na loja nem na Hostinger.
 */
// reiniciar (15 s, mais 15 do PUT de reserva) + reaplicar avisos (15 s) + ler o
// estado (15 s, até 3 leituras curtas) + as esperas: 60 s não cobriam o pior caso
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (user.role !== "SUPERADMIN") {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const parsed = z
      .object({ companyId: z.string().min(1) })
      .safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const r = await reiniciarConexaoDaLoja(parsed.data.companyId, {
      nome: `${user.name} (plataforma)`,
    });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
