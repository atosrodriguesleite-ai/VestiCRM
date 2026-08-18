import type { Metadata } from "next";
import { db } from "@/lib/db";
import { montarCatalogo } from "../../montar-catalogo";

export const dynamic = "force-dynamic";

/**
 * CATÁLOGO COM TABELA DE PREÇO PRÓPRIA — /catalogo/<loja>/l/<código>.
 *
 * Mesmo acervo da vitrine normal, com o preço da tabela do link (atacado ou
 * varejo). O código é sorteado: quem não recebeu o link não descobre o preço
 * de atacado tentando endereços. Recurso gated — se a loja não ativou (ou o
 * link foi desativado), este endereço simplesmente não existe.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const company = await db.company.findUnique({ where: { slug } });
  if (!company || company.suspended) return { title: "Catálogo" };
  return {
    title: `${company.name} — Catálogo`,
    description: company.tagline ?? "Catálogo de produtos",
    // link de preço não é para buscador: circula de mão em mão
    robots: { index: false, follow: false },
  };
}

export default async function CatalogoComTabelaPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; code: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { slug, code } = await params;
  const sp = await searchParams;
  return montarCatalogo({ slug, sp, linkCode: code });
}
