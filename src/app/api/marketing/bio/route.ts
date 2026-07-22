import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";

/**
 * Gestor de Bio (módulo Marketing) — página + botões de uma loja.
 * GET: devolve a página (criando uma vazia na 1ª vez) + botões + padrões
 *      da identidade (nome/tagline/logo do catálogo).
 * PATCH: atualiza título/subtítulo/foto/publicação.
 * Tudo gated por marketingEnabled + gerente/admin.
 */

async function gate(): Promise<
  | { ok: true; companyId: string }
  | { ok: false; res: NextResponse }
> {
  const user = await requireUser();
  if (!isManagerUp(user)) {
    return { ok: false, res: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  }
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { marketingEnabled: true },
  });
  if (!company?.marketingEnabled) {
    return { ok: false, res: NextResponse.json({ error: "Módulo Marketing desativado." }, { status: 403 }) };
  }
  return { ok: true, companyId: user.companyId };
}

/** Garante que a loja tenha uma bio (nasce com a cara do catálogo). */
async function ensureBioPage(companyId: string) {
  const existing = await db.bioPage.findUnique({ where: { companyId } });
  if (existing) return existing;
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { slug: true },
  });
  return db.bioPage.create({
    data: { companyId, slug: company?.slug ?? companyId },
  });
}

export async function GET() {
  try {
    const g = await gate();
    if (!g.ok) return g.res;
    const page = await ensureBioPage(g.companyId);
    const [links, company] = await Promise.all([
      db.bioLink.findMany({
        where: { bioPageId: page.id },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      }),
      db.company.findUnique({
        where: { id: g.companyId },
        select: { name: true, tagline: true, logoUrl: true, whatsapp: true },
      }),
    ]);
    return NextResponse.json({
      enabled: true,
      page: {
        slug: page.slug,
        published: page.published,
        headline: page.headline,
        tagline: page.tagline,
        avatarUrl: page.avatarUrl,
        coverUrl: page.coverUrl,
        bgColor: page.bgColor,
        buttonColor: page.buttonColor,
        buttonTextColor: page.buttonTextColor,
        font: page.font,
        buttonShape: page.buttonShape,
        instagram: page.instagram,
        tiktok: page.tiktok,
        youtube: page.youtube,
        facebook: page.facebook,
        metaPixelId: page.metaPixelId,
        gaId: page.gaId,
        views: page.views,
      },
      links: links.map((l) => ({
        id: l.id,
        title: l.title,
        subtitle: l.subtitle,
        type: l.type,
        url: l.url,
        imageUrl: l.imageUrl,
        layout: l.layout,
        featured: l.featured,
        active: l.active,
        clicks: l.clicks,
        order: l.order,
      })),
      defaults: {
        name: company?.name ?? "",
        tagline: company?.tagline ?? null,
        logoUrl: company?.logoUrl ?? null,
        whatsapp: company?.whatsapp ?? null,
      },
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

const hex = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .nullable()
  .optional();
const schema = z.object({
  published: z.boolean().optional(),
  headline: z.string().max(80).nullable().optional(),
  tagline: z.string().max(160).nullable().optional(),
  avatarUrl: z.string().max(2_000_000).nullable().optional(),
  coverUrl: z.string().max(3_000_000).nullable().optional(),
  bgColor: hex,
  buttonColor: hex,
  buttonTextColor: hex,
  font: z.enum(["montserrat", "inter", "poppins", "playfair", "lora"]).nullable().optional(),
  buttonShape: z.enum(["rounded", "pill", "square"]).optional(),
  instagram: z.string().max(120).nullable().optional(),
  tiktok: z.string().max(120).nullable().optional(),
  youtube: z.string().max(200).nullable().optional(),
  facebook: z.string().max(200).nullable().optional(),
  metaPixelId: z.string().max(40).nullable().optional(),
  gaId: z.string().max(40).nullable().optional(),
});
const clean = (v: string | null | undefined) =>
  v === undefined ? undefined : v?.trim() || null;

export async function PATCH(req: NextRequest) {
  try {
    const g = await gate();
    if (!g.ok) return g.res;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const page = await ensureBioPage(g.companyId);
    const d = parsed.data;
    const updated = await db.bioPage.update({
      where: { id: page.id },
      data: {
        ...(d.published !== undefined ? { published: d.published } : {}),
        ...(d.headline !== undefined ? { headline: d.headline?.trim() || null } : {}),
        ...(d.tagline !== undefined ? { tagline: d.tagline?.trim() || null } : {}),
        ...(d.avatarUrl !== undefined ? { avatarUrl: d.avatarUrl || null } : {}),
        ...(d.coverUrl !== undefined ? { coverUrl: d.coverUrl || null } : {}),
        ...(d.bgColor !== undefined ? { bgColor: d.bgColor } : {}),
        ...(d.buttonColor !== undefined ? { buttonColor: d.buttonColor } : {}),
        ...(d.buttonTextColor !== undefined ? { buttonTextColor: d.buttonTextColor } : {}),
        ...(d.font !== undefined ? { font: d.font } : {}),
        ...(d.buttonShape !== undefined ? { buttonShape: d.buttonShape } : {}),
        ...(d.instagram !== undefined ? { instagram: clean(d.instagram) } : {}),
        ...(d.tiktok !== undefined ? { tiktok: clean(d.tiktok) } : {}),
        ...(d.youtube !== undefined ? { youtube: clean(d.youtube) } : {}),
        ...(d.facebook !== undefined ? { facebook: clean(d.facebook) } : {}),
        ...(d.metaPixelId !== undefined ? { metaPixelId: clean(d.metaPixelId) } : {}),
        ...(d.gaId !== undefined ? { gaId: clean(d.gaId) } : {}),
      },
    });
    return NextResponse.json({
      ok: true,
      page: {
        slug: updated.slug,
        published: updated.published,
        headline: updated.headline,
        tagline: updated.tagline,
        avatarUrl: updated.avatarUrl,
        coverUrl: updated.coverUrl,
        bgColor: updated.bgColor,
        buttonColor: updated.buttonColor,
        buttonTextColor: updated.buttonTextColor,
        font: updated.font,
        buttonShape: updated.buttonShape,
        instagram: updated.instagram,
        tiktok: updated.tiktok,
        youtube: updated.youtube,
        facebook: updated.facebook,
        metaPixelId: updated.metaPixelId,
        gaId: updated.gaId,
        views: updated.views,
      },
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
