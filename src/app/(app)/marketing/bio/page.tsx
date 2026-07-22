import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagerUp } from "@/lib/scope";
import { platformUrl } from "@/lib/site";
import { PageHeader } from "@/components/ui";
import { BioEditor } from "./bio-editor";

export const dynamic = "force-dynamic";

export default async function BioPageEditor() {
  const user = await requireUser();
  if (!isManagerUp(user)) redirect("/dashboard");

  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: {
      slug: true,
      name: true,
      tagline: true,
      logoUrl: true,
      whatsapp: true,
      marketingEnabled: true,
      catalogPrimary: true,
      catalogSecondary: true,
      catalogBg: true,
      catalogFont: true,
    },
  });
  if (!company?.marketingEnabled) redirect("/dashboard");

  // garante que a bio exista (nasce com o slug da loja)
  let page = await db.bioPage.findUnique({ where: { companyId: user.companyId } });
  if (!page) {
    page = await db.bioPage.create({
      data: { companyId: user.companyId, slug: company.slug },
    });
  }
  const links = await db.bioLink.findMany({
    where: { bioPageId: page.id },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Gestor de Bio"
        subtitle="A sua página de links do Instagram, com a cara da sua loja. Publique, cole o link na bio e acompanhe os cliques."
      />
      <BioEditor
        publicBase={`${platformUrl()}/bio`}
        initial={{
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
          })),
          identity: {
            name: company.name,
            tagline: company.tagline,
            logoUrl: company.logoUrl,
            whatsapp: company.whatsapp,
            primary: company.catalogPrimary,
            secondary: company.catalogSecondary,
            bg: company.catalogBg,
            font: company.catalogFont,
          },
        }}
      />
    </div>
  );
}
