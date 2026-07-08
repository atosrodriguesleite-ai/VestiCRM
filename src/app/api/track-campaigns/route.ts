import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";

const schema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/, "Use apenas letras minúsculas, números e hífen"),
  channel: z.string().min(1).default("campanha"),
  ownerId: z.string().nullable().optional(),
  goal: z.number().nonnegative().default(0),
});

/** Campanhas/links inteligentes (cada uma vira ?ref= + QR Code). */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
        { status: 400 }
      );
    }
    const exists = await db.trackCampaign.findFirst({
      where: { companyId: user.companyId, slug: parsed.data.slug },
    });
    if (exists) {
      return NextResponse.json(
        { error: "Já existe um link com este ref" },
        { status: 409 }
      );
    }
    const campaign = await db.trackCampaign.create({
      data: { ...parsed.data, companyId: user.companyId },
    });
    return NextResponse.json(campaign, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
