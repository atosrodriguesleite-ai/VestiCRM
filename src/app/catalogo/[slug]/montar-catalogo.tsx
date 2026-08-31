import { notFound } from "next/navigation";
import { catalogPrice } from "@/lib/orders";
import { db } from "@/lib/db";
import { imageHref } from "@/lib/img";
import { ordenarVariantes } from "@/lib/tamanhos";
import {
  parseCategoryDescriptions,
  parseCategoryOrder,
  parseCategoryTypes,
} from "@/lib/categories";
import { type LinkDeCatalogo } from "@/lib/catalogo/tabelas-de-preco";
import { lerCamposDaLoja } from "@/lib/catalogo/campos-do-pedido";
import { resolverLink } from "@/lib/catalogo/tabelas-de-preco-servidor";
import { PublicCatalog, type CatalogProduct } from "./public-catalog";

/**
 * A VITRINE, montada num lugar só.
 *
 * O catálogo é servido por dois endereços — o normal (`/catalogo/<loja>`) e o
 * de TABELA DE PREÇO (`/catalogo/<loja>/l/<código>`, recurso gated). Os dois
 * mostram o mesmo acervo; muda o preço que aparece e é cobrado. Manter a
 * montagem aqui evita duas cópias que envelhecem separadas — o preço é
 * dinheiro, e dinheiro não pode divergir entre telas.
 */
export async function montarCatalogo({
  slug,
  sp,
  linkCode = null,
}: {
  slug: string;
  sp: Record<string, string | undefined>;
  /** código do link de tabela de preço (quando a cliente entrou por um) */
  linkCode?: string | null;
}) {
  const company = await db.company.findUnique({ where: { slug } });
  // Loja suspensa (ex.: inadimplência) sai do ar também no público. Sem
  // isso a suspensão não tinha efeito nenhum: a loja continuava recebendo
  // pedidos pelo catálogo mesmo sem conseguir entrar no sistema.
  if (!company || company.suspended) notFound();

  // TABELA DO LINK: só existe para loja que ATIVOU o recurso. Link de loja
  // que não ativou (ou desativou) simplesmente não vale, e a vitrine volta ao
  // preço padrão dela — nunca cobra a tabela errada.
  let tabela: LinkDeCatalogo | null = null;
  if (linkCode) {
    tabela = await resolverLink(company.id, linkCode, company.priceTablesEnabled);
    // endereço de tabela que não resolve não é "o catálogo normal": seria a
    // cliente lojista vendo preço de varejo sem saber
    if (!tabela) notFound();
  }
  const modo = tabela?.priceMode ?? company.catalogPriceMode;

  const [products, customColors] = await Promise.all([
    db.product.findMany({
      // vitrine pública: só produtos COM foto (item sem foto fica oculto até
      // ganhar imagem — aparece sozinho assim que uma foto for adicionada).
      // Se a loja escolher, esconde também os sem estoque (indisponíveis).
      where: {
        companyId: company.id,
        active: true,
        images: { some: {} },
        ...(company.catalogHideOutOfStock ? { variants: { some: { stock: { gt: 0 } } } } : {}),
      },
      include: {
        images: { orderBy: { order: "asc" }, select: { id: true, color: true } },
        variants: { orderBy: [{ color: "asc" }, { size: "asc" }] },
      },
      orderBy: [{ collection: "desc" }, { name: "asc" }],
    }),
    db.companyColor.findMany({
      where: { companyId: company.id },
      select: { name: true, hex: true },
    }),
  ]);

  const items: CatalogProduct[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    category: p.category,
    collection: p.collection,
    description: p.description,
    retailPrice: p.retailPrice,
    wholesalePrice: p.wholesalePrice,
    // preço da TABELA desta visita (o link manda; sem link, o padrão da loja)
    precoCatalogo: catalogPrice(p, modo),
    minQuantity: p.minQuantity,
    tags: p.tags,
    // url + cor etiquetada: o card de cada cor usa a foto DAQUELA cor
    images: p.images.map((i) => ({ url: imageHref(i.id), color: i.color })),
    // ordem de ROUPA (PP, P, M, G, GG / numeração crescente): as bolinhas de
    // tamanho do catálogo seguem a arara, não o alfabeto
    variants: ordenarVariantes(p.variants).map((v) => ({
      color: v.color,
      size: v.size,
      available: v.stock > 0,
    })),
  }));

  return (
    <PublicCatalog
      storeSlug={company.slug}
      storeName={company.name}
      tagline={company.tagline}
      whatsapp={company.whatsapp}
      minOrder={company.minOrder}
      minOrderMode={company.minOrderMode as "NONE" | "PECAS" | "VALOR"}
      minOrderValue={company.minOrderValue}
      formFields={lerCamposDaLoja(company.catalogFormFields)}
      products={items}
      categoryOrder={parseCategoryOrder(company.categoryOrder)}
      categoryDescriptions={parseCategoryDescriptions(company.categoryDescriptions)}
      categoryTypes={parseCategoryTypes(company.categoryTypes)}
      logoSize={company.catalogLogoSize as "normal" | "grande"}
      // a chavinha vale por COR: o card da cor esgotada some da vitrine
      hideSoldOut={company.catalogHideOutOfStock}
      // loja sem variação de cor (semijoias): bolinha/nome de cor não aparecem
      hideColors={company.catalogHideColors}
      // tabela de preço deste endereço (null = catálogo normal da loja).
      // A exigência de quantidade mínima do atacado vale SÓ aqui: loja que
      // não ativou o recurso não ganha trava nenhuma.
      tabela={
        tabela ? { code: tabela.code, name: tabela.name, mode: tabela.priceMode } : null
      }
      identity={{
        logoUrl: company.logoUrl,
        primary: company.catalogPrimary,
        secondary: company.catalogSecondary,
        bg: company.catalogBg,
        font: company.catalogFont,
      }}
      customColors={customColors}
      tracking={{
        ref: sp.ref ?? null,
        c: sp.c ?? null,
        utm_source: sp.utm_source ?? null,
        utm_medium: sp.utm_medium ?? null,
        utm_campaign: sp.utm_campaign ?? null,
        utm_term: sp.utm_term ?? null,
        utm_content: sp.utm_content ?? null,
      }}
    />
  );
}
