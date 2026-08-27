import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdmin, isManagerUp, isSupport } from "@/lib/scope";
import { parseCategoryOrder, sortCategories, chaveDeCategoria, rotuloDeCategoria } from "@/lib/categories";
import { compararTamanhos } from "@/lib/tamanhos";
import { PageHeader } from "@/components/ui";
import { CatalogDesigner } from "./catalog-designer";
import { catalogUrl } from "@/lib/catalog-url";
import { platformUrl } from "@/lib/site";
import { LinksDePreco } from "./links-de-preco";

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

  // gêmeas byte-diferentes (ç decomposto, espaço no fim) fundem numa linha
  // só — senão a lojista via e arrastava DUAS "Regata Alça", e salvar
  // re-gravava a fantasma na ordem para sempre
  const canonicas = new Map<string, string>();
  for (const nome of [
    ...catRows.map((r) => r.category),
    ...parseCategoryOrder(company.extraCategories),
  ]) {
    const k = chaveDeCategoria(nome);
    if (!canonicas.has(k)) canonicas.set(k, rotuloDeCategoria(nome));
  }
  const categories = sortCategories(
    [...canonicas.values()],
    parseCategoryOrder(company.categoryOrder)
  );

  // endereço público do catálogo, montado no SERVIDOR (o domínio de
  // catálogos vem de variável de ambiente e não existe no navegador)
  const base = catalogUrl(company.slug);
  const baseDoCatalogo = base.startsWith("http")
    ? base
    : `${platformUrl()}${base}`;

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
      {/* recurso gated: quem não ativou não vê nada aqui */}
      {company.priceTablesEnabled && (
        <LinksDePreco
          // gerente+ (a MESMA régua da API): preço é decisão comercial, e o
          // perfil Suporte não tem poderes comerciais
          canEdit={isManagerUp(user)}
          // o endereço é montado NO SERVIDOR: o domínio de catálogos não
          // existe no navegador, e o link copiado saía apontando para o
          // domínio errado
          baseUrl={baseDoCatalogo}
        />
      )}
    </div>
  );
}
