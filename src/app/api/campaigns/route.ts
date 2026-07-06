import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

const filterSchema = z.object({
  inactiveDays: z.number().optional(),
  type: z
    .enum(["VAREJO", "ATACADO", "REVENDEDORA", "LOJISTA", "BOUTIQUE", "SACOLEIRA"])
    .optional(),
  city: z.string().optional(),
  minSpent: z.number().optional(),
  interest: z.string().optional(),
  tag: z.string().optional(),
  lostDeals: z.boolean().optional(),
});

const schema = z.object({
  name: z.string().min(1),
  message: z.string().min(1),
  filter: filterSchema,
  status: z.enum(["RASCUNHO", "ATIVA"]).default("RASCUNHO"),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    const campaign = await db.campaign.create({
      data: {
        companyId: user.companyId,
        name: parsed.data.name,
        message: parsed.data.message,
        filterJson: JSON.stringify(parsed.data.filter),
        status: parsed.data.status,
      },
    });
    return NextResponse.json(campaign, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
