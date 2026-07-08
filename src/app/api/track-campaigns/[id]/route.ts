import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";

const schema = z.object({
  active: z.boolean().optional(),
  goal: z.number().nonnegative().optional(),
  name: z.string().min(1).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const { id } = await params;
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const campaign = await db.trackCampaign.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!campaign) {
      return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
    }
    const updated = await db.trackCampaign.update({
      where: { id },
      data: parsed.data,
    });
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
