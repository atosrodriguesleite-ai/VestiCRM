import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";

/**
 * Setores/Departamentos da Central de Atendimento (Vendas, Financeiro...).
 * Config de admin/gerente. GET traz setores + time + setor padrão do número.
 */

async function gate() {
  const user = await requireUser();
  if (!isManagerUp(user)) {
    return { ok: false as const, res: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  }
  return { ok: true as const, user };
}

export async function GET() {
  try {
    const g = await gate();
    if (!g.ok) return g.res;
    const companyId = g.user.companyId;
    const [setores, team, comm] = await Promise.all([
      db.setor.findMany({
        where: { companyId },
        orderBy: [{ order: "asc" }, { name: "asc" }],
        include: { users: { select: { id: true } }, _count: { select: { conversations: true } } },
      }),
      db.user.findMany({
        where: { companyId, active: true, role: { not: "SUPERADMIN" } },
        orderBy: { name: "asc" },
        select: { id: true, name: true, role: true, color: true },
      }),
      db.commSettings.findUnique({ where: { companyId }, select: { defaultSetorId: true } }),
    ]);
    return NextResponse.json({
      setores: setores.map((s) => ({
        id: s.id,
        name: s.name,
        color: s.color,
        userIds: s.users.map((u) => u.id),
        conversations: s._count.conversations,
      })),
      team,
      defaultSetorId: comm?.defaultSetorId ?? null,
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

const schema = z.object({
  name: z.string().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

/** Define o setor padrão do número (para onde os chamados novos entram). */
export async function PATCH(req: NextRequest) {
  try {
    const g = await gate();
    if (!g.ok) return g.res;
    const body = await req.json().catch(() => null);
    const setorId: string | null = body?.defaultSetorId ?? null;
    if (setorId) {
      const s = await db.setor.findFirst({ where: { id: setorId, companyId: g.user.companyId }, select: { id: true } });
      if (!s) return NextResponse.json({ error: "Setor inválido" }, { status: 404 });
    }
    await db.commSettings.upsert({
      where: { companyId: g.user.companyId },
      update: { defaultSetorId: setorId },
      create: { companyId: g.user.companyId, defaultSetorId: setorId },
    });
    return NextResponse.json({ ok: true, defaultSetorId: setorId });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

export async function POST(req: NextRequest) {
  try {
    const g = await gate();
    if (!g.ok) return g.res;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Informe o nome do setor." }, { status: 400 });
    const name = parsed.data.name.trim();
    const companyId = g.user.companyId;

    const exists = await db.setor.findFirst({
      where: { companyId, name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (exists) return NextResponse.json({ error: "Esse setor já existe." }, { status: 409 });

    const count = await db.setor.count({ where: { companyId } });
    const setor = await db.setor.create({
      data: { companyId, name, color: parsed.data.color ?? "#6366f1", order: count },
      include: { users: { select: { id: true } } },
    });
    return NextResponse.json({
      ok: true,
      setor: { id: setor.id, name: setor.name, color: setor.color, userIds: [], conversations: 0 },
    }, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
