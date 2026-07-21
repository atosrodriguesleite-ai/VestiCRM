import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

const schema = z.object({ tagId: z.string().min(1) });

async function guard(companyId: string, customerId: string, tagId: string) {
  const [customer, tag] = await Promise.all([
    db.customer.findFirst({ where: { id: customerId, companyId } }),
    db.tag.findFirst({ where: { id: tagId, companyId } }),
  ]);
  return customer && tag;
}

/** Aplica uma etiqueta ao contato. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    if (!(await guard(user.companyId, id, parsed.data.tagId)))
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    await db.customerTag.upsert({
      where: { customerId_tagId: { customerId: id, tagId: parsed.data.tagId } },
      create: { customerId: id, tagId: parsed.data.tagId },
      update: {},
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

/** Remove uma etiqueta do contato. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    if (!(await guard(user.companyId, id, parsed.data.tagId)))
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    await db.customerTag.deleteMany({
      where: { customerId: id, tagId: parsed.data.tagId },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
