import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";
import { normalizeUrl } from "@/lib/bio";

/** Edita (título/link/imagem/ativo), reordena (order) ou exclui um botão. */

async function gate(id: string) {
  const user = await requireUser();
  if (!isManagerUp(user)) return { ok: false as const, res: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { marketingEnabled: true },
  });
  if (!company?.marketingEnabled) return { ok: false as const, res: NextResponse.json({ error: "Módulo Marketing desativado." }, { status: 403 }) };
  const link = await db.bioLink.findUnique({ where: { id } });
  if (!link || link.companyId !== user.companyId) {
    return { ok: false as const, res: NextResponse.json({ error: "Botão não encontrado" }, { status: 404 }) };
  }
  return { ok: true as const, companyId: user.companyId, link };
}

const schema = z.object({
  title: z.string().min(1).max(60).optional(),
  subtitle: z.string().max(80).nullable().optional(),
  url: z.string().max(500).nullable().optional(),
  imageUrl: z.string().max(2_000_000).nullable().optional(),
  active: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const g = await gate(id);
    if (!g.ok) return g.res;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const d = parsed.data;
    const isUrlType = g.link.type === "SITE" || g.link.type === "EXTERNO";
    const link = await db.bioLink.update({
      where: { id },
      data: {
        ...(d.title !== undefined ? { title: d.title.trim() } : {}),
        ...(d.subtitle !== undefined ? { subtitle: d.subtitle?.trim() || null } : {}),
        ...(d.url !== undefined && isUrlType ? { url: normalizeUrl(d.url) } : {}),
        ...(d.imageUrl !== undefined ? { imageUrl: d.imageUrl || null } : {}),
        ...(d.active !== undefined ? { active: d.active } : {}),
        ...(d.order !== undefined ? { order: d.order } : {}),
      },
    });
    return NextResponse.json({ ok: true, link });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const g = await gate(id);
    if (!g.ok) return g.res;
    await db.bioLink.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
