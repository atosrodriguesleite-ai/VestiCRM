import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

const schema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().min(8).optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  type: z
    .enum(["VAREJO", "ATACADO", "REVENDEDORA", "LOJISTA", "BOUTIQUE", "SACOLEIRA"])
    .optional(),
  origin: z
    .enum([
      "WHATSAPP", "CATALOGO_PUBLICO", "INSTAGRAM", "FACEBOOK", "SITE",
      "NUVEMSHOP", "BLING", "MARKETPLACE", "INDICACAO", "LOJA_FISICA",
      "TRAFEGO_PAGO", "GOOGLE", "EVENTO", "MANUAL",
    ])
    .optional(),
  notes: z.string().nullable().optional(),
  preferredSize: z.string().nullable().optional(),
  preferredColors: z.string().nullable().optional(),
  nextContactAt: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    const customer = await db.customer.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!customer) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }

    const { nextContactAt, ownerId, ...rest } = parsed.data;
    const data: Record<string, unknown> = { ...rest };
    if (nextContactAt !== undefined) {
      data.nextContactAt = nextContactAt ? new Date(nextContactAt) : null;
    }
    if (ownerId !== undefined) {
      if (ownerId) {
        const owner = await db.user.findFirst({
          where: { id: ownerId, companyId: user.companyId },
        });
        if (!owner) {
          return NextResponse.json({ error: "Usuário inválido" }, { status: 404 });
        }
      }
      data.ownerId = ownerId;
    }

    const updated = await db.customer.update({ where: { id }, data });
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
