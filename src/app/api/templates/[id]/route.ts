import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

const schema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  category: z
    .enum([
      "PRIMEIRO_ATENDIMENTO", "CATALOGO", "COBRANCA", "POS_VENDA",
      "RECOMPRA", "PROMOCAO", "CLIENTE_FRIO", "ANIVERSARIO", "OUTRO",
    ])
    .optional(),
});

/** Edita uma resposta rápida (título, texto ou categoria). */
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
    // a resposta tem que ser da própria loja (isolamento multi-tenant)
    const template = await db.messageTemplate.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!template) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }
    const updated = await db.messageTemplate.update({
      where: { id },
      data: parsed.data,
    });
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const template = await db.messageTemplate.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!template) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }
    await db.messageTemplate.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
