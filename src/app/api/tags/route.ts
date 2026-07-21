import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

/** Etiquetas (tags) da loja — usadas para marcar contatos no atendimento. */
export async function GET() {
  try {
    const user = await requireUser();
    const tags = await db.tag.findMany({
      where: { companyId: user.companyId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, color: true },
    });
    return NextResponse.json(tags);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

const schema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#8b5cf6"),
});

/** Cria uma etiqueta (qualquer usuário pode criar durante o atendimento). */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const existing = await db.tag.findFirst({
      where: {
        companyId: user.companyId,
        name: { equals: parsed.data.name, mode: "insensitive" },
      },
    });
    if (existing) {
      return NextResponse.json(existing); // idempotente: já existe → devolve ela
    }
    const tag = await db.tag.create({
      data: {
        companyId: user.companyId,
        name: parsed.data.name,
        color: parsed.data.color,
      },
      select: { id: true, name: true, color: true },
    });
    return NextResponse.json(tag, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
