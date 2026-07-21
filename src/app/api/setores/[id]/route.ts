import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";

/** Edita um setor (nome/cor/vendedores) ou o remove. Config de admin/gerente. */

async function gate(id: string) {
  const user = await requireUser();
  if (!isManagerUp(user)) return { ok: false as const, res: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  const setor = await db.setor.findFirst({ where: { id, companyId: user.companyId }, select: { id: true } });
  if (!setor) return { ok: false as const, res: NextResponse.json({ error: "Setor não encontrado" }, { status: 404 }) };
  return { ok: true as const, user };
}

const schema = z.object({
  name: z.string().min(1).max(40).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  userIds: z.array(z.string()).optional(), // vendedores do setor (substitui a lista)
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const g = await gate(id);
    if (!g.ok) return g.res;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const d = parsed.data;

    // valida que os vendedores são da mesma loja
    if (d.userIds) {
      const valid = await db.user.count({ where: { id: { in: d.userIds }, companyId: g.user.companyId } });
      if (valid !== d.userIds.length) return NextResponse.json({ error: "Vendedor inválido" }, { status: 404 });
    }

    await db.setor.update({
      where: { id },
      data: {
        ...(d.name !== undefined ? { name: d.name.trim() } : {}),
        ...(d.color !== undefined ? { color: d.color } : {}),
        ...(d.userIds !== undefined ? { users: { set: d.userIds.map((uid) => ({ id: uid })) } } : {}),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const g = await gate(id);
    if (!g.ok) return g.res;
    // limpa o setor padrão se for este; conversas ficam sem setor (SetNull)
    await db.commSettings.updateMany({
      where: { companyId: g.user.companyId, defaultSetorId: id },
      data: { defaultSetorId: null },
    });
    await db.setor.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
