import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { intakeLead } from "@/lib/intake";
import type { Origin } from "@prisma/client";

const schema = z.object({
  name: z.string().min(1),
  phone: z.string().min(8),
  city: z.string().optional(),
  state: z.string().optional(),
  type: z
    .enum(["VAREJO", "ATACADO", "REVENDEDORA", "LOJISTA", "BOUTIQUE", "SACOLEIRA"])
    .default("VAREJO"),
  origin: z.string().default("MANUAL"),
  notes: z.string().optional(),
  preferredSize: z.string().optional(),
  preferredColors: z.string().optional(),
  interestIds: z.array(z.string()).optional(),
});

/** Cadastro manual — passa pelo Lead Intake Engine como todos os canais. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const { interestIds, type, notes, preferredSize, preferredColors, origin, ...core } =
      parsed.data;

    const validOrigins = Object.keys(
      (await import("@/lib/format")).originLabel
    );
    const resolvedOrigin = (
      validOrigins.includes(origin) ? origin : "MANUAL"
    ) as Origin;

    const result = await intakeLead(user.companyId, {
      phone: core.phone,
      name: core.name,
      city: core.city,
      state: core.state,
      origin: resolvedOrigin,
      ownerId: user.id, // quem cadastrou fica responsável
    });

    // campos complementares do formulário (perfil de moda)
    const customer = await db.customer.update({
      where: { id: result.customer.id },
      data: {
        type,
        notes: notes ?? undefined,
        preferredSize: preferredSize ?? undefined,
        preferredColors: preferredColors ?? undefined,
        interests: interestIds?.length
          ? {
              deleteMany: {},
              create: interestIds.map((id) => ({ interestId: id })),
            }
          : undefined,
      },
    });

    return NextResponse.json(customer, {
      status: result.isNewLead ? 201 : 200,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
