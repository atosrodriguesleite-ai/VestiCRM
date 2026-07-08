import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

const schema = z.object({
  name: z.string().min(1).max(30),
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida"),
});

/** Biblioteca de cores do lojista (nome + tonalidade). */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
        { status: 400 }
      );
    }
    const color = await db.companyColor.upsert({
      where: {
        companyId_name: {
          companyId: user.companyId,
          name: parsed.data.name.trim(),
        },
      },
      update: { hex: parsed.data.hex },
      create: {
        companyId: user.companyId,
        name: parsed.data.name.trim(),
        hex: parsed.data.hex,
      },
    });
    return NextResponse.json(color, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
