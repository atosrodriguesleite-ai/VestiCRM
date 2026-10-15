import type { Metadata } from "next";
import { after } from "next/server";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { variacoesSobEncomenda } from "@/lib/sob-encomenda";
import { categoriasSobEncomenda } from "@/lib/sob-encomenda-data";
import { trackedLinkParts } from "@/lib/catalog-url";
import { lerLinkDeFotos, linkDeFotosVivo, montarGaleria, urlDoCatalogoDoLink } from "@/lib/fotos/link";
import { GaleriaDeFotos } from "./galeria";

/**
 * RN-071 · GALERIA DE FOTOS PARA A CLIENTE (pública, sem login).
 *
 * O link é um filtro sobre as fotos do catálogo: a página monta a galeria
 * com o acervo de HOJE (peça inativa ou zerada some sozinha), sem preço.
 * Link vencido ou desconhecido mostra uma página que explica e aponta o
 * WhatsApp da loja — nunca um 404 seco: a cliente recebeu o link de uma
 * pessoa e precisa saber a quem pedir outro.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const company = await db.company.findUnique({ where: { slug }, select: { name: true, suspended: true } });
  if (!company || company.suspended) return { title: "Fotos" };
  return { title: `Fotos · ${company.name}`, robots: { index: false, follow: false } };
}

export default async function PaginaDeFotos({ params }: { params: Promise<{ slug: string; code: string }> }) {
  const { slug, code } = await params;
  const company = await db.company.findUnique({
    where: { slug },
    select: { id: true, name: true, logoUrl: true, whatsapp: true, suspended: true },
  });
  if (!company || company.suspended) notFound();

  const link = await lerLinkDeFotos(code, company.id);
  const vivo = link ? linkDeFotosVivo(link) : false;
  const loja = { nome: company.name, logoUrl: company.logoUrl, whatsapp: company.whatsapp };

  if (!link || !vivo) {
    return <GaleriaDeFotos loja={loja} code={code} vencido categorias={[]} />;
  }

  // o catálogo para onde a galeria aponta leva a vendedora do link
  // (RN-005): quem mandou as fotos leva a venda que vier delas
  const vendedora = link.sellerId
    ? await db.user.findFirst({
        where: { id: link.sellerId, companyId: company.id, active: true },
        select: { name: true, role: true },
      })
    : null;
  const partes = vendedora ? trackedLinkParts(vendedora, slug) : trackedLinkParts({ role: "SUPPORT", name: "" }, slug);
  const catalogo = urlDoCatalogoDoLink(partes.base, partes.sellerRef);

  const [lidos, catsSobEncomenda] = await Promise.all([
    db.product.findMany({
      where: { companyId: company.id, active: true, images: { some: {} } },
      select: {
        id: true,
        name: true,
        category: true,
        sobEncomenda: true,
        jueriId: true,
        images: { select: { id: true, color: true, order: true } },
        variants: { select: { id: true, color: true, stock: true } },
      },
    }),
    categoriasSobEncomenda(company.id),
  ]);
  // a peça que vende sob encomenda (RN-076) conta como "com estoque" na
  // galeria — a mesma régua da vitrine, resolvida por variação
  const produtos = lidos.map((p) => {
    const livres = variacoesSobEncomenda(
      p.variants.map((v) => ({ id: v.id, product: p })),
      catsSobEncomenda
    );
    return { ...p, variants: p.variants.map((v) => ({ ...v, sobEncomenda: livres.has(v.id) })) };
  });
  const categorias = montarGaleria(produtos, { categorias: link.categorias, soComEstoque: link.soComEstoque });

  // abertura contada DEPOIS da resposta, no `after()`: chamada solta é
  // congelada pela Vercel junto com a resposta e o contador ficava em zero
  // (a lição da RN-033/RN-053). Falhar aqui nunca derruba a página.
  after(async () => {
    await db.fotosLink.update({ where: { id: link.id }, data: { aberturas: { increment: 1 } } }).catch(() => {});
  });

  return (
    <GaleriaDeFotos
      loja={loja}
      code={code}
      vencido={false}
      categorias={categorias}
      validoAte={link.expiresAt.toISOString()}
      catalogo={catalogo}
    />
  );
}
