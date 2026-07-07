import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

const schema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  category: z
    .enum([
      "PRIMEIRO_ATENDIMENTO", "CATALOGO", "COBRANCA", "POS_VENDA",
      "RECOMPRA", "PROMOCAO", "CLIENTE_FRIO", "ANIVERSARIO", "OUTRO",
    ])
    .default("OUTRO"),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const template = await db.messageTemplate.create({
      data: { ...parsed.data, companyId: user.companyId },
    });
    return NextResponse.json(template, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
