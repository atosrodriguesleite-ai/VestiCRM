import type { Metadata } from "next";
import { montarCatalogo } from "./montar-catalogo";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Catálogo público — vitrine que a loja compartilha com o cliente final.
 * Sem login: mostra apenas produtos ativos da empresa do slug (nunca de
 * outra loja) e leva o cliente direto para o WhatsApp da loja.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const company = await db.company.findUnique({ where: { slug } });
  // loja suspensa não expõe nem o nome (mesmo tratamento de "não existe")
  if (!company || company.suspended) return { title: "Catálogo" };
  return {
    title: `${company.name} — Catálogo`,
    description: company.tagline ?? "Catálogo de produtos",
  };
}

export default async function PublicCatalogPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  return montarCatalogo({ slug, sp });
}
