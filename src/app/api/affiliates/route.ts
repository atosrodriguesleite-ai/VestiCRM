import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/scope";
import { ensurePlatformCompany } from "@/lib/platform";

/**
 * Afiliados da plataforma — cadastro e listagem (só Super Admin).
 * Cada afiliado tem um código (slug) que vira o link de divulgação:
 *   https://www.atacadopro.com/?utm_source=afiliado&utm_campaign=<slug>
 * Leads que entram por esse link ficam atribuídos ao afiliado.
 */

const schema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "use letras minúsculas, números e hífen"),
  phone: z.string().max(30).optional().or(z.literal("")),
  pixKey: z.string().max(140).optional().or(z.literal("")),
  notes: z.string().max(2000).optional().or(z.literal("")),
});

export async function GET() {
  try {
    const user = await requireUser();
    if (!isSuperAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const platformId = await ensurePlatformCompany();
    const affiliates = await db.affiliate.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        customers: {
          where: { companyId: platformId },
          select: {
            id: true,
            name: true,
            createdAt: true,
            opportunities: { select: { status: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    return NextResponse.json(
      affiliates.map((a) => ({
        id: a.id,
        name: a.name,
        slug: a.slug,
        phone: a.phone,
        pixKey: a.pixKey,
        notes: a.notes,
        active: a.active,
        leads: a.customers.length,
        won: a.customers.filter((c) =>
          c.opportunities.some((o) => o.status === "WON")
        ).length,
        recent: a.customers.slice(0, 8).map((c) => ({
          id: c.id,
          name: c.name,
          createdAt: c.createdAt,
          won: c.opportunities.some((o) => o.status === "WON"),
        })),
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
    const user = await requireUser();
    if (!isSuperAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Confira os campos: código só com letras minúsculas, números e hífen." },
        { status: 400 }
      );
    }
    const exists = await db.affiliate.findUnique({
      where: { slug: parsed.data.slug },
    });
    if (exists) {
      return NextResponse.json(
        { error: "Já existe um afiliado com esse código de link." },
        { status: 409 }
      );
    }
    const affiliate = await db.affiliate.create({
      data: {
        name: parsed.data.name,
        slug: parsed.data.slug,
        phone: parsed.data.phone || null,
        pixKey: parsed.data.pixKey || null,
        notes: parsed.data.notes || null,
      },
    });
    return NextResponse.json(affiliate, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
