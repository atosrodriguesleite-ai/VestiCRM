import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

const schema = z.object({
  name: z.string().min(1),
  phone: z.string().min(8),
  city: z.string().optional(),
  state: z.string().optional(),
  type: z
    .enum(["VAREJO", "ATACADO", "REVENDEDORA", "LOJISTA", "BOUTIQUE", "SACOLEIRA"])
    .default("VAREJO"),
  origin: z
    .enum(["INSTAGRAM", "WHATSAPP", "INDICACAO", "TRAFEGO_PAGO", "LOJA_FISICA", "EVENTO", "SITE"])
    .default("WHATSAPP"),
  notes: z.string().optional(),
  preferredSize: z.string().optional(),
  preferredColors: z.string().optional(),
  interestIds: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const { interestIds, ...data } = parsed.data;

    const customer = await db.customer.create({
      data: {
        ...data,
        companyId: user.companyId,
        ownerId: user.id,
        interests: interestIds?.length
          ? { create: interestIds.map((id) => ({ interestId: id })) }
          : undefined,
      },
    });

    // automação: cliente novo → tarefa de primeiro contato
    await db.task.create({
      data: {
        companyId: user.companyId,
        customerId: customer.id,
        title: `Primeiro contato com ${customer.name}`,
        type: "LIGAR",
        dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        priority: "ALTA",
        assigneeId: user.id,
        autoRule: `primeiro-contato:${customer.id}`,
      },
    });

    return NextResponse.json(customer, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
