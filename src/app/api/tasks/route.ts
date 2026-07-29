import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

const schema = z.object({
  title: z.string().min(1),
  description: z.string().max(500).optional(),
  type: z
    .enum(["LIGAR", "ENVIAR_CATALOGO", "COBRAR_PAGAMENTO", "POS_VENDA", "REATIVAR", "ENVIAR_NOVIDADES", "CONFIRMAR_ENTREGA", "FOLLOW_UP", "OUTRO"])
    .default("FOLLOW_UP"),
  customerId: z.string().optional(),
  dueAt: z.string(),
  priority: z.enum(["BAIXA", "MEDIA", "ALTA"]).default("MEDIA"),
  assigneeId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const { customerId, assigneeId, dueAt, ...rest } = parsed.data;

    if (customerId) {
      const customer = await db.customer.findFirst({
        where: { id: customerId, companyId: user.companyId },
      });
      if (!customer)
        return NextResponse.json({ error: "Cliente inválido" }, { status: 404 });
    }

    const task = await db.task.create({
      data: {
        ...rest,
        companyId: user.companyId,
        customerId,
        dueAt: new Date(dueAt),
        assigneeId: assigneeId ?? user.id,
      },
    });
    return NextResponse.json(task, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
