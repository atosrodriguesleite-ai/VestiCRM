import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { enderecoDaLogo } from "@/lib/catalogo/logo-da-loja";
import { imageHref } from "@/lib/img";
import {
  parseCategoryDescriptions,
  parseCategoryOrder,
  parseCategoryTypes,
} from "@/lib/categories";
import { type LinkDeCatalogo } from "@/lib/catalogo/tabelas-de-preco";
import { acervoDaVitrine } from "@/lib/catalogo/acervo";
import { lerCamposDaLoja } from "@/lib/catalogo/campos-do-pedido";
import { unidadeDaLoja } from "@/lib/catalogo/unidade";
import { resolverLink } from "@/lib/catalogo/tabelas-de-preco-servidor";
import { condicoesDoLink } from "@/lib/catalogo/condicoes-da-campanha";
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

  // O ACERVO vem da fonte única (RN-094): a MESMA leitura que o catálogo em
  // PDF usa. Duas cópias da regra envelheceriam separadas e o papel passaria
  // a mostrar peça (ou preço) que o site não mostra.
  const [acervo, customColors] = await Promise.all([
    acervoDaVitrine(company, { modo, desconto: cond.desconto }),
    db.companyColor.findMany({
      where: { companyId: company.id },
      select: { name: true, hex: true },
    }),
  ]);

  const unidadeLoja = unidadeDaLoja(company);

  const items: CatalogProduct[] = acervo.map((p) => ({
    ...p,
    // a tela recebe o ENDEREÇO da foto (RN-070); o PDF lê o conteúdo
    images: p.images.map((i) => ({ url: imageHref(i.id), color: i.color })),
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
