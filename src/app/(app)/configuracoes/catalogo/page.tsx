import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/scope";
import { PageHeader } from "@/components/ui";
import { CatalogDesigner } from "./catalog-designer";

export const dynamic = "force-dynamic";

export default async function CatalogCustomizePage() {
  const user = await requireUser();

  const [company, colors, sizes] = await Promise.all([
    db.company.findUnique({ where: { id: user.companyId } }),
    db.companyColor.findMany({
      where: { companyId: user.companyId },
      orderBy: { name: "asc" },
    }),
    db.companySize.findMany({
      where: { companyId: user.companyId },
      orderBy: { order: "asc" },
    }),
  ]);
  if (!company) return null;

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
        subtitle="Identidade visual, cores da grade e tamanhos — tudo do jeito da sua marca, refletindo na hora no catálogo público."
      />
      <CatalogDesigner
        slug={company.slug}
        canEdit={isAdmin(user)}
        initial={{
          logoUrl: company.logoUrl,
          catalogPrimary: company.catalogPrimary,
          catalogSecondary: company.catalogSecondary,
          catalogBg: company.catalogBg,
          catalogFont: company.catalogFont,
          catalogLogoSize: company.catalogLogoSize,
        }}
        colors={colors.map((c) => ({ id: c.id, name: c.name, hex: c.hex }))}
        sizes={sizes.map((s) => ({ id: s.id, name: s.name }))}
      />
    </div>
  );
}
