import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/scope";
import { dataOuNull } from "@/lib/ficha-funcionario";

/** DEPENDENTES da ficha (RN-025): linhas simples, só ADMIN. */

const schema = z.object({
  nome: z.string().min(1).max(120),
  nascimento: z.string().nullable().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!isAdmin(user))
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    const { id } = await params;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Confira o nome" }, { status: 400 });
    const ficha = await db.funcionario.findFirst({
      where: { id, companyId: user.companyId },
      select: { id: true },
    });
    if (!ficha) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
    const dep = await db.funcionarioDependente.create({
      data: {
        funcionarioId: id,
        nome: parsed.data.nome,
        nascimento: dataOuNull(parsed.data.nascimento),
      },
    });
    return NextResponse.json(dep, { status: 201 });
  } catch (e) {
    return trata(e);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!isAdmin(user))
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    const { id } = await params;
    const depId = req.nextUrl.searchParams.get("dep");
    if (!depId) return NextResponse.json({ error: "Dependente?" }, { status: 400 });
    const dep = await db.funcionarioDependente.findFirst({
      where: { id: depId, funcionario: { id, companyId: user.companyId } },
      select: { id: true },
    });
    if (!dep) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    await db.funcionarioDependente.delete({ where: { id: dep.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return trata(e);
  }
}

function trata(e: unknown) {
  if (e instanceof AuthError)
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  throw e;
}
