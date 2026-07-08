import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

const schema = z.object({ name: z.string().min(1).max(20) });

/** Tamanhos próprios do lojista (P, M, G, 36, Único...). */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const count = await db.companySize.count({
      where: { companyId: user.companyId },
    });
    const size = await db.companySize.upsert({
      where: {
        companyId_name: {
          companyId: user.companyId,
          name: parsed.data.name.trim(),
        },
      },
      update: {},
      create: {
        companyId: user.companyId,
        name: parsed.data.name.trim(),
        order: count,
      },
    });
    return NextResponse.json(size, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
