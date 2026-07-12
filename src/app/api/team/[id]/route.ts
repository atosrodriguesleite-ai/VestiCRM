import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isAdmin } from "@/lib/scope";

const schema = z.object({
  active: z.boolean().optional(),
  role: z.enum(["ADMIN", "MANAGER", "SELLER", "SUPPORT"]).optional(),
  password: z.string().min(6).optional(), // redefinição de senha pelo admin
  commissionRate: z.number().min(0).max(100).optional(), // % de comissão
  monthlyGoal: z.number().min(0).optional(), // meta de vendas do mês (R$)
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!isAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const { id } = await params;
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    const target = await db.user.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!target) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }
    if (target.id === user.id && parsed.data.active === false) {
      return NextResponse.json(
        { error: "Você não pode desativar a si mesmo" },
        { status: 400 }
      );
    }
    if (target.role === "SUPERADMIN") {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    const updated = await db.user.update({
      where: { id },
      data: {
        ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
        ...(parsed.data.role ? { role: parsed.data.role } : {}),
        ...(parsed.data.password
          ? { passwordHash: await bcrypt.hash(parsed.data.password, 10) }
          : {}),
        ...(parsed.data.monthlyGoal !== undefined
          ? { monthlyGoal: parsed.data.monthlyGoal }
          : {}),
        ...(parsed.data.commissionRate !== undefined
          ? { commissionRate: parsed.data.commissionRate }
          : {}),
      },
    });
    return NextResponse.json({ id: updated.id, active: updated.active });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
