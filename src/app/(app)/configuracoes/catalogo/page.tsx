import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdmin, isSupport } from "@/lib/scope";
import { parseCategoryOrder, sortCategories } from "@/lib/categories";
import { compararTamanhos } from "@/lib/tamanhos";
import { PageHeader } from "@/components/ui";
import { CatalogDesigner } from "./catalog-designer";

export const dynamic = "force-dynamic";

export default async function CatalogCustomizePage() {
  const user = await requireUser();

  const [company, colors, sizes, catRows] = await Promise.all([
    db.company.findUnique({ where: { id: user.companyId } }),
    db.companyColor.findMany({
      where: { companyId: user.companyId },
      orderBy: { name: "asc" },
    }),
    db.companySize.findMany({
      where: { companyId: user.companyId },
      orderBy: { order: "asc" },
    }).then((tamanhos) =>
      tamanhos.sort((a, b) => a.order - b.order || compararTamanhos(a.name, b.name))
    ),
    // TODAS as categorias da loja — produto pausado e categoria criada à mão
    // também entram. Antes só produto ATIVO aparecia, e a lojista via a lista
    // "faltando" categorias (incidente Entre Linhas, 03/08/2026): a ordem
    // escolhida aqui precisa valer também para o que voltar a ficar ativo.
    db.product.findMany({
      where: { companyId: user.companyId },
      select: { category: true },
      orderBy: [{ collection: "desc" }, { name: "asc" }],
    }),
  ]);
  if (!company) return null;

  const categories = sortCategories(
    [
      ...new Set([
        ...catRows.map((r) => r.category),
        ...parseCategoryOrder(company.extraCategories),
      ]),
    ],
    parseCategoryOrder(company.categoryOrder)
  );

  return (
    <div className="max-w-5xl mx-auto">
      <Link
        href="/configuracoes"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-600 mb-4 transition"
      >
        <ArrowLeft className="size-4" />
        Configurações
      </Link>
      <PageHeader
        title="Personalizar catálogo"
        subtitle="Identidade visual, cores da grade e tamanhos — tudo do jeito da sua marca, refletindo na hora no catálogo geral."
      />
      <CatalogDesigner
        slug={company.slug}
        canEdit={isAdmin(user) || isSupport(user)}
        canEditIdentity={isAdmin(user)}
        initial={{
          logoUrl: company.logoUrl,
          catalogPrimary: company.catalogPrimary,
          catalogSecondary: company.catalogSecondary,
          catalogBg: company.catalogBg,
          catalogPriceMode: company.catalogPriceMode,
          catalogFont: company.catalogFont,
          catalogLogoSize: company.catalogLogoSize,
          catalogHideColors: company.catalogHideColors,
        }}
        colors={colors.map((c) => ({ id: c.id, name: c.name, hex: c.hex }))}
        sizes={sizes.map((s) => ({ id: s.id, name: s.name }))}
        categories={categories}
      />
    </div>
  );
}
