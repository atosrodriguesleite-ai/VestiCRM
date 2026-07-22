import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";
import { normalizeUrl } from "@/lib/bio";

/** Cria um botão na bio da loja. */

async function gate() {
  const user = await requireUser();
  if (!isManagerUp(user)) return { ok: false as const, res: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { marketingEnabled: true },
  });
  if (!company?.marketingEnabled) return { ok: false as const, res: NextResponse.json({ error: "Módulo Marketing desativado." }, { status: 403 }) };
  return { ok: true as const, companyId: user.companyId };
}

const schema = z.object({
  title: z.string().min(1).max(60),
  subtitle: z.string().max(80).nullable().optional(),
  type: z.enum(["CATALOGO", "WHATSAPP", "SITE", "EXTERNO"]),
  url: z.string().max(500).nullable().optional(),
  imageUrl: z.string().max(3_000_000).nullable().optional(),
  layout: z.enum(["normal", "banner"]).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const g = await gate();
    if (!g.ok) return g.res;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const d = parsed.data;
    if ((d.type === "SITE" || d.type === "EXTERNO") && !normalizeUrl(d.url ?? null)) {
      return NextResponse.json({ error: "Informe o link (endereço)." }, { status: 400 });
    }

    const page = await db.bioPage.findUnique({ where: { companyId: g.companyId } });
    if (!page) return NextResponse.json({ error: "Bio não encontrada." }, { status: 404 });

    const last = await db.bioLink.findFirst({
      where: { bioPageId: page.id },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    const link = await db.bioLink.create({
      data: {
        bioPageId: page.id,
        companyId: g.companyId,
        title: d.title.trim(),
        subtitle: d.subtitle?.trim() || null,
        type: d.type,
        url: d.type === "SITE" || d.type === "EXTERNO" ? normalizeUrl(d.url ?? null) : null,
        imageUrl: d.imageUrl || null,
        layout: d.layout ?? "normal",
        order: (last?.order ?? -1) + 1,
      },
    });
    return NextResponse.json({ ok: true, link }, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
