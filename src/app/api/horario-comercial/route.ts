import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";
import { validarHorarioComercial } from "@/lib/bi/horario-comercial";

/**
 * HORÁRIO DE ATENDIMENTO DA LOJA (RN-079).
 *
 * Gerência grava (admin e gerente — é operação da loja, não segredo de
 * dinheiro); vendedora e suporte veem a tela mas não mudam. `horario: null`
 * apaga o cadastro e o tempo de resposta volta a contar o dia inteiro.
 * O que a tela manda é conferido pela MESMA régua que a leitura usa
 * (`validarHorarioComercial`): horário torto nunca chega ao banco.
 */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const corpo = (await req.json().catch(() => null)) as { horario?: unknown } | null;
    if (!corpo || !("horario" in corpo)) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    if (corpo.horario === null) {
      await db.company.update({
        where: { id: user.companyId },
        data: { horarioComercial: null },
      });
      return NextResponse.json({ ok: true, horario: null });
    }
    const v = validarHorarioComercial(corpo.horario);
    if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 });
    await db.company.update({
      where: { id: user.companyId },
      data: { horarioComercial: JSON.stringify(v.horario) },
    });
    return NextResponse.json({ ok: true, horario: v.horario });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
