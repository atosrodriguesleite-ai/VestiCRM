import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

const createSchema = z.object({
  customerId: z.string().min(1),
  title: z.string().min(1),
  value: z.number().nonnegative().default(0),
  stageId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const { customerId, title, value, stageId } = parsed.data;

    // valida que cliente e etapa pertencem à empresa do usuário (multi-tenant)
    const [customer, stage] = await Promise.all([
      db.customer.findFirst({ where: { id: customerId, companyId: user.companyId } }),
      db.stage.findFirst({
        where: { id: stageId, pipeline: { companyId: user.companyId } },
      }),
    ]);
    if (!customer || !stage) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }

    const opp = await db.opportunity.create({
      data: {
        companyId: user.companyId,
        customerId,
        stageId,
        title,
        value,
        ownerId: user.id,
        status: stage.isWon ? "WON" : stage.isLost ? "LOST" : "OPEN",
      },
    });
    return NextResponse.json(opp, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
