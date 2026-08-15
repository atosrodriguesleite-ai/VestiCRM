import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";

/**
 * Mensagens da lista "Quem chamar hoje", personalizadas por loja.
 *
 * Diferente das mensagens da inbox (que qualquer vendedora ajusta, porque são
 * do dia a dia dela), estas valem para a LOJA INTEIRA — o que a Ana escrever
 * vale para a mensagem que a Júlia vai enviar. Por isso, gerente para cima.
 *
 * Campo vazio grava NULL = volta ao texto padrão do sistema.
 */

const schema = z.object({
  msgAniversario: z.string().max(500).nullable().optional(),
  msgRecompra: z.string().max(500).nullable().optional(),
  msgPosVenda: z.string().max(500).nullable().optional(),
  msgPrimeiroContato: z.string().max(500).nullable().optional(),
  msgConversaParada: z.string().max(500).nullable().optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json(
        { error: "Só gerente ou admin pode mudar as mensagens da loja." },
        { status: 403 }
      );
    }
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      const campo = String(parsed.error.issues[0]?.path[0] ?? "");
      return NextResponse.json(
        {
          error: campo
            ? "Uma das mensagens passou de 500 caracteres. Deixe mais curta."
            : "Dados inválidos",
        },
        { status: 400 }
      );
    }

    const data: Record<string, string | null> = {};
    for (const [campo, valor] of Object.entries(parsed.data)) {
      if (valor !== undefined) data[campo] = valor?.trim() || null;
    }

    await db.commSettings.upsert({
      where: { companyId: user.companyId },
      update: data,
      create: { companyId: user.companyId, ...data },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
