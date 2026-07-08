import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/scope";
import { provisionCompany, ProvisionError } from "@/lib/provision";
import { PLATFORM_SLUG } from "@/lib/platform";

/**
 * Gestão de lojas (tenants) pelo Super Admin.
 *   GET  → lista as lojas provisionadas (exceto a empresa-plataforma).
 *   POST → provisiona uma nova loja + admin + funil + cores/tamanhos.
 * Somente SUPERADMIN. Nunca apaga nada.
 */

const schema = z.object({
  companyName: z.string().min(2, "Informe o nome da loja"),
  adminName: z.string().min(2, "Informe o nome do responsável"),
  adminEmail: z.string().email("E-mail inválido"),
  adminPassword: z.string().min(6, "A senha precisa de ao menos 6 caracteres"),
  whatsapp: z.string().optional(),
  tagline: z.string().optional(),
});

async function guard() {
  const user = await requireUser();
  if (!isSuperAdmin(user)) {
    return { error: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  }
  return { user };
}

export async function GET() {
  try {
    const g = await guard();
    if (g.error) return g.error;

    const companies = await db.company.findMany({
      where: { slug: { not: PLATFORM_SLUG } },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { users: true, customers: true, orders: true } },
        users: {
          where: { role: "ADMIN" },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { name: true, email: true },
        },
      },
    });

    return NextResponse.json(
      companies.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        createdAt: c.createdAt,
        admin: c.users[0] ?? null,
        users: c._count.users,
        customers: c._count.customers,
        orders: c._count.orders,
      }))
    );
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

export async function POST(req: NextRequest) {
  try {
    const g = await guard();
    if (g.error) return g.error;

    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
        { status: 400 }
      );
    }

    const result = await provisionCompany(parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    if (e instanceof ProvisionError)
      return NextResponse.json(
        { error: e.message },
        { status: e.code === "EMAIL_TAKEN" ? 409 : 400 }
      );
    throw e;
  }
}
