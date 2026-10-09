import { notFound } from "next/navigation";
import { catalogPrice } from "@/lib/orders";
import { db } from "@/lib/db";
import { enderecoDaLogo } from "@/lib/catalogo/logo-da-loja";
import { imageHref } from "@/lib/img";
import { ordenarVariantes } from "@/lib/tamanhos";
import {
  parseCategoryDescriptions,
  parseCategoryOrder,
  parseCategoryTypes,
} from "@/lib/categories";
import { type LinkDeCatalogo } from "@/lib/catalogo/tabelas-de-preco";
import { disponivelNaVitrine } from "@/lib/catalogo/teto-do-estoque";
import { vendeSobEncomenda } from "@/lib/sob-encomenda";
import { categoriasSobEncomenda } from "@/lib/sob-encomenda-data";
import { ondeNaoEscondePorEstoque } from "@/lib/catalogo/sob-encomenda-na-vitrine";
import { lerCamposDaLoja } from "@/lib/catalogo/campos-do-pedido";
import { parseCategoryUnits, unidadeDaLoja, unidadeDaPeca } from "@/lib/catalogo/unidade";
import { resolverLink } from "@/lib/catalogo/tabelas-de-preco-servidor";
import { condicoesDoLink, precoComDesconto } from "@/lib/catalogo/condicoes-da-campanha";
import { resolverCampanhaDoLink } from "@/lib/catalogo/condicoes-da-campanha-servidor";
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

  // CONDIÇÕES DO LINK DE CAMPANHA (RN-040): desconto e pedido mínimo próprios
  // do `?ref=` desta visita. Não somam com a tabela de preço — dois descontos
  // dariam um valor que nenhuma tela mostrou.
  const campanha = tabela ? null : await resolverCampanhaDoLink(company.id, sp.ref);
  const cond = condicoesDoLink(campanha, company, !!tabela);
  const comDesconto = (v: number) => precoComDesconto(v, cond.desconto);

  // as categorias que vendem SOB ENCOMENDA (RN-076): a peça delas não some
  // ao zerar e a quantidade não para no estoque. O filtro da vitrine precisa
  // delas, então a leitura vai na frente — junto das cores, não em série
  const [catsSobEncomenda, customColors] = await Promise.all([
    categoriasSobEncomenda(company.id),
    db.companyColor.findMany({
      where: { companyId: company.id },
      select: { name: true, hex: true },
    }),
  ]);
  const [products] = await Promise.all([
    db.product.findMany({
      // vitrine pública: só produtos COM foto (item sem foto fica oculto até
      // ganhar imagem — aparece sozinho assim que uma foto for adicionada).
      // Se a loja escolher, esconde também os sem estoque (indisponíveis) —
      // menos a peça que vende sob encomenda (RN-076)
      where: {
        companyId: company.id,
        active: true,
        images: { some: {} },
        ...(company.catalogHideOutOfStock ? ondeNaoEscondePorEstoque(catsSobEncomenda) : {}),
      },
      include: {
        images: { orderBy: { order: "asc" }, select: { id: true, color: true } },
        variants: { orderBy: [{ color: "asc" }, { size: "asc" }] },
      },
      orderBy: [{ collection: "desc" }, { name: "asc" }],
    }),
  ]);

  // a escada da unidade (RN-068): loja e categorias lidas uma vez para todas
  const unidadeLoja = unidadeDaLoja(company);
  const unidadesPorCategoria = parseCategoryUnits(company.categoryUnits);

  const items: CatalogProduct[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    category: p.category,
    collection: p.collection,
    description: p.description,
    // preços JÁ com o desconto do link (o original vai riscado ao lado)
    retailPrice: comDesconto(p.retailPrice),
    wholesalePrice: comDesconto(p.wholesalePrice),
    // preço da TABELA desta visita (o link manda; sem link, o padrão da loja)
    precoCatalogo: comDesconto(catalogPrice(p, modo)),
    originalRetailPrice: cond.desconto > 0 ? catalogPrice(p, modo) : undefined,
    minQuantity: p.minQuantity,
    tags: p.tags,
    // "peça", "conjunto", "kit"… resolvido AQUI, no servidor (RN-068)
    unidade: unidadeDaPeca(p, unidadesPorCategoria, unidadeLoja),
    // url + cor etiquetada: o card de cada cor usa a foto DAQUELA cor
    images: p.images.map((i) => ({ url: imageHref(i.id), color: i.color })),
    // ordem de ROUPA (PP, P, M, G, GG / numeração crescente): as bolinhas de
    // tamanho do catálogo seguem a arara, não o alfabeto
    variants: ordenarVariantes(p.variants).map((v) => ({
      color: v.color,
      size: v.size,
      // QUANTAS há (RN-067): a vitrine para a quantidade neste teto — só o
      // "tem/não tem" deixava a cliente pedir 8 de uma peça com 1. A peça
      // sob encomenda (RN-076) recebe o teto da linha: não para no estoque
      disponivel: disponivelNaVitrine(
        v.stock,
        vendeSobEncomenda({
          peca: p.sobEncomenda,
          categoria: catsSobEncomenda.has(p.category),
          nuvemshopId: v.nuvemshopId,
          jueriId: p.jueriId,
        })
      ),
    })),
  }));

  return (
    <PublicCatalog
      storeSlug={company.slug}
      storeName={company.name}
      tagline={company.tagline}
      whatsapp={company.whatsapp}
      // mínimo desta visita: o do link quando ele define um, senão o da loja
      minOrder={cond.minOrderPieces}
      minOrderMode={cond.minOrderMode}
      minOrderValue={cond.minOrderValue}
      formFields={lerCamposDaLoja(company.catalogFormFields)}
      products={items}
      categoryOrder={parseCategoryOrder(company.categoryOrder)}
      categoryDescriptions={parseCategoryDescriptions(company.categoryDescriptions)}
      categoryTypes={parseCategoryTypes(company.categoryTypes)}
      unidadeDaLoja={unidadeLoja}
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
      // O LINK DE CAMPANHA DESTA VISITA (RN-040). Viaja SEMPRE que a visita
      // veio por uma campanha, mesmo sem desconto nenhum: é o carimbo que o
      // pedido guarda (`Order.campaignRef`) e por onde a exclusão conta os
      // pedidos dela. Amarrar isso a "tem condição especial" deixava a
      // campanha de puro rastreio com 0 pedidos — e apagável (achado da
      // revisão de 01/09/2026). O servidor reconfere tudo ao receber.
      condicoes={
        campanha
          ? { slug: campanha.slug, name: campanha.name, discount: cond.desconto }
          : null
      }
      identity={{
        // a logo vai por ENDEREÇO, nunca dentro da página (RN-070): embutida,
        // ela segurava a primeira pintura e o catálogo abria em tela preta
        logoUrl: enderecoDaLogo(company),
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
