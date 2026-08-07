import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { motivoOculto } from "@/lib/catalogo/visibilidade";

/**
 * CONFERIDOR DE CATÁLOGO — "por que essa peça não aparece pra cliente?"
 *
 * O selo da tela de Produtos explica os quatro motivos conhecidos. Esta rota
 * vai além: ela roda a MESMA CONSULTA que a vitrine pública roda, com os
 * dados de verdade do banco, e responde se a peça está lá ou não. Se a
 * consulta devolve a peça e mesmo assim a cliente não vê, o problema não é a
 * peça — é o LINK (catálogo de campanha, que só tem peças selecionadas) ou a
 * tela velha no aparelho dela. As duas coisas viram resposta aqui.
 *
 * Isso existe porque adivinhar não resolveu: a loja dizia "a peça está certa"
 * e o catálogo dizia o contrário. Agora quem responde é o banco.
 *
 * Somente leitura, sempre dentro da loja de quem pergunta.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const company = await db.company.findUnique({
      where: { id: user.companyId },
      select: {
        slug: true,
        suspended: true,
        catalogHideOutOfStock: true,
      },
    });
    if (!company) {
      return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
    }

    const produto = await db.product.findFirst({
      where: { id, companyId: user.companyId },
      select: {
        id: true,
        name: true,
        active: true,
        nuvemshopId: true,
        images: { select: { id: true } },
        variants: { select: { color: true, size: true, stock: true } },
      },
    });
    if (!produto) {
      return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });
    }

    /**
     * A CONSULTA DA VITRINE, igualzinha — só que presa a esta peça.
     * Se algum dia o filtro do catálogo mudar e este aqui não, o teste
     * `conferidor-catalogo.test.ts` avisa (ele compara os dois arquivos).
     */
    const noCatalogo = await db.product.findFirst({
      where: {
        id: produto.id,
        companyId: user.companyId,
        active: true,
        images: { some: {} },
        ...(company.catalogHideOutOfStock
          ? { variants: { some: { stock: { gt: 0 } } } }
          : {}),
      },
      select: { id: true },
    });

    /**
     * A vitrine desenha um card POR COR — e, com a chavinha ligada, pula a
     * cor esgotada. Peça que passa no filtro mas não gera nenhum card some
     * do mesmo jeito, e era o caso mais silencioso de todos.
     */
    const cores = [...new Set(produto.variants.map((v) => v.color))].map((cor) => {
      const doGrupo = produto.variants.filter((v) => v.color === cor);
      const temPeca = doGrupo.some((v) => v.stock > 0);
      return {
        cor,
        pecas: doGrupo.reduce((s, v) => s + Math.max(0, v.stock), 0),
        aparece: !!noCatalogo && (temPeca || !company.catalogHideOutOfStock),
      };
    });
    const cardsVisiveis = cores.filter((c) => c.aparece).length;
    const apareceNoGeral = !!noCatalogo && cardsVisiveis > 0;

    /**
     * O LINK IMPORTA. Catálogo de campanha só mostra as peças selecionadas —
     * se a vendedora mandou o link da campanha, a cliente não vê o resto do
     * catálogo, e isso não é defeito da peça.
     */
    const campanhas = await db.promoCatalog.findMany({
      where: { companyId: user.companyId, active: true },
      select: {
        name: true,
        slug: true,
        products: { where: { productId: produto.id }, select: { productId: true } },
      },
      orderBy: { name: "asc" },
    });

    const motivo = motivoOculto(
      {
        active: produto.active,
        images: produto.images,
        variants: produto.variants,
        nuvemshopId: produto.nuvemshopId,
      },
      { esconderSemEstoque: company.catalogHideOutOfStock }
    );

    return NextResponse.json({
      produto: { id: produto.id, nome: produto.name },
      lojaSuspensa: company.suspended,
      catalogoGeral: {
        url: `/catalogo/${company.slug}`,
        aparece: apareceNoGeral && !company.suspended,
        // quando o motivo conhecido não explica, a resposta não inventa:
        // diz que a peça está no ar e joga a investigação para o link.
        motivo: motivo?.motivo ?? null,
        comoResolver: motivo?.comoResolver ?? null,
      },
      cores,
      campanhas: campanhas.map((c) => ({
        nome: c.name,
        url: `/catalogo/${company.slug}/c/${c.slug}`,
        inclui: c.products.length > 0,
      })),
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    console.error(e);
    return NextResponse.json({ error: "Erro ao conferir o catálogo" }, { status: 500 });
  }
}
