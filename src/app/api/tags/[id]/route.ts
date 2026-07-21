import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

const schema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

/** Renomeia/recolore uma etiqueta. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const tag = await db.tag.findFirst({ where: { id, companyId: user.companyId } });
    if (!tag) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
    const updated = await db.tag.update({
      where: { id },
      data: parsed.data,
      select: { id: true, name: true, color: true },
    });
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

/** Exclui a etiqueta (some de todos os contatos que a usavam). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const tag = await db.tag.findFirst({ where: { id, companyId: user.companyId } });
    if (!tag) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
    await db.tag.delete({ where: { id } }); // CustomerTag cai em cascata
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
