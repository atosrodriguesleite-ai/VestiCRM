import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { reiniciarConexaoDaLoja } from "@/lib/comm/reiniciar-conexao";

/**
 * Reinicia a conexão do WhatsApp de QUALQUER loja (RN-105) — só o Super
 * Admin, pelo painel de Saúde: é ali que a loja muda aparece, e quem a vê
 * precisa poder agir sem entrar na loja nem na Hostinger.
 */
// reiniciar (15 s, mais 15 do PUT de reserva) + reaplicar avisos + ler o
// estado (até 3 leituras) + a sonda (até 3 tentativas com espera): folga para
// o pior caso — cortada no meio, a pessoa não saberia o que houve
export const maxDuration = 300;

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
