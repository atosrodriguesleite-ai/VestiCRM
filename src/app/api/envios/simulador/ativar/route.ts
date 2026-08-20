import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";

/**
 * Interruptor do SIMULADOR DE FRETE (RN-019) — diferente das chaves de
 * módulo (que são do Super Admin), esta é escolha DA LOJA: gerente/admin
 * liga na própria tela Envios, depois de ver o aviso de que o resultado é
 * estimativa. Desligar volta tudo ao que era, sem rastro.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user))
      return NextResponse.json(
        { error: "Só gerente ou admin podem ligar o simulador." },
        { status: 403 }
      );
    const parsed = z
      .object({ ligar: z.boolean() })
      .safeParse(await req.json().catch(() => ({})));
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

    // o interruptor mora DENTRO do módulo Envios: sem o módulo, nem ele
    const r = await db.company.updateMany({
      where: { id: user.companyId, shippingEnabled: true },
      data: { freteSimuladorEnabled: parsed.data.ligar },
    });
    if (r.count === 0)
      return NextResponse.json({ error: "Módulo Envios não contratado." }, { status: 403 });
    return NextResponse.json({ ok: true, ligado: parsed.data.ligar });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
