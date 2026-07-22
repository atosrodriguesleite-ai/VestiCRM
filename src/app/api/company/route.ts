import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isAdmin, isSupport } from "@/lib/scope";

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida");

const schema = z.object({
  name: z.string().min(1).optional(),
  // endereço do catálogo (catalago.net/<slug>) — muda junto com um rebatismo
  // da loja; links antigos (e QR codes impressos) deixam de funcionar
  slug: z.string().min(3).max(40).optional(),
  tagline: z.string().nullable().optional(),
  whatsapp: z.string().nullable().optional(),
  minOrder: z.number().int().nonnegative().optional(),
  minOrderMode: z.enum(["NONE", "PECAS", "VALOR"]).optional(),
  minOrderValue: z.number().nonnegative().optional(),
  commissionBase: z.enum(["SUBTOTAL", "TOTAL"]).optional(),
  lowStockThreshold: z.number().int().min(0).max(10000).optional(),
  catalogLogoSize: z.enum(["normal", "grande"]).optional(),
  // esconder do catálogo os produtos sem estoque (indisponíveis)
  catalogHideOutOfStock: z.boolean().optional(),
  // ordem das categorias no catálogo (lista de nomes, na ordem desejada)
  categoryOrder: z.array(z.string().min(1).max(60)).max(200).optional(),
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
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    // Suporte organiza o catálogo: pode alterar SÓ a ordem das categorias.
    // A chavinha "esconder sem estoque" é liberada para todos os perfis
    // (inclusive suporte e vendedor). Qualquer outro campo da loja (nome,
    // logo, WhatsApp...) segue admin.
    const chaves = Object.keys(parsed.data);
    const soOrdem = chaves.every((k) => k === "categoryOrder");
    const soVitrineEstoque = chaves.length > 0 && chaves.every((k) => k === "catalogHideOutOfStock");
    if (!isAdmin(user) && !(isSupport(user) && soOrdem) && !soVitrineEstoque) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const { categoryOrder, ...data } = parsed.data;
    if (data.whatsapp) data.whatsapp = data.whatsapp.replace(/\D/g, "");

    if (data.slug !== undefined) {
      const clean = data.slug
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (clean.length < 3) {
        return NextResponse.json(
          { error: "Endereço muito curto: use ao menos 3 letras/números." },
          { status: 400 }
        );
      }
      if (clean === "vesticrm" || clean === "api" || clean === "catalogo") {
        return NextResponse.json({ error: "Endereço reservado." }, { status: 400 });
      }
      const taken = await db.company.findFirst({
        where: { slug: clean, id: { not: user.companyId } },
        select: { id: true },
      });
      if (taken) {
        return NextResponse.json(
          { error: "Este endereço já está em uso por outra loja." },
          { status: 409 }
        );
      }
      data.slug = clean;
    }

    const updated = await db.company.update({
      where: { id: user.companyId },
      data: {
        ...data,
        ...(categoryOrder !== undefined
          ? { categoryOrder: JSON.stringify(categoryOrder) }
          : {}),
      },
    });
    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
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
      catalogLogoSize: updated.catalogLogoSize,
      catalogHideOutOfStock: updated.catalogHideOutOfStock,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
