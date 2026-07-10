import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isAdmin } from "@/lib/scope";

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida");

const schema = z.object({
  name: z.string().min(1).optional(),
  tagline: z.string().nullable().optional(),
  whatsapp: z.string().nullable().optional(),
  minOrder: z.number().int().nonnegative().optional(),
  minOrderMode: z.enum(["NONE", "PECAS", "VALOR"]).optional(),
  minOrderValue: z.number().nonnegative().optional(),
  commissionBase: z.enum(["SUBTOTAL", "TOTAL"]).optional(),
  // identidade visual do catálogo
  logoUrl: z.string().nullable().optional(),
  catalogPrimary: hexColor.optional(),
  catalogSecondary: hexColor.optional(),
  catalogBg: hexColor.optional(),
  catalogFont: z
    .enum(["montserrat", "inter", "poppins", "playfair", "lora"])
    .optional(),
});

/** Configurações da loja (admin): nome, frase e WhatsApp do catálogo público. */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const data = { ...parsed.data };
    if (data.whatsapp) data.whatsapp = data.whatsapp.replace(/\D/g, "");

    const updated = await db.company.update({
      where: { id: user.companyId },
      data,
    });
    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      tagline: updated.tagline,
      whatsapp: updated.whatsapp,
      minOrder: updated.minOrder,
      minOrderMode: updated.minOrderMode,
      minOrderValue: updated.minOrderValue,
      logoUrl: updated.logoUrl,
      catalogPrimary: updated.catalogPrimary,
      catalogSecondary: updated.catalogSecondary,
      catalogBg: updated.catalogBg,
      catalogFont: updated.catalogFont,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
