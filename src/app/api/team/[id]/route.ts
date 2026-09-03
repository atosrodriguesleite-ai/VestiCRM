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
  // vendedora com visão TOTAL do chat (só a Central de Atendimento)
  chatVisaoTotal: z.boolean().optional(),
  // vendedora com visão TOTAL dos pedidos (exceção por pessoa à RN-007)
  pedidosVisaoTotal: z.boolean().optional(),
  // foto: string (data-URL) para definir/trocar, ou null para remover
  avatarUrl: z.string().max(700_000).nullable().optional(),
  // WhatsApp que recebe o código de login em aparelho novo (RN-045);
  // null limpa (a pessoa volta a entrar sem código). Validado AQUI, na
  // gravação: número sem DDD passaria calado e o código nunca chegaria —
  // com o registro culpando a conexão da loja (diagnóstico impossível)
  loginPhone: z
    .string()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((d) => d.length >= 10 && d.length <= 13, {
      message: "WhatsApp incompleto: use DDD + número (ex.: 82 99999-1234).",
    })
    .nullable()
    .optional(),
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
        ...(parsed.data.chatVisaoTotal !== undefined
          ? { chatVisaoTotal: parsed.data.chatVisaoTotal }
          : {}),
        ...(parsed.data.pedidosVisaoTotal !== undefined
          ? { pedidosVisaoTotal: parsed.data.pedidosVisaoTotal }
          : {}),
        ...(parsed.data.avatarUrl !== undefined
          ? { avatarUrl: parsed.data.avatarUrl || null }
          : {}),
        ...(parsed.data.loginPhone !== undefined
          ? { loginPhone: parsed.data.loginPhone }
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
