import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";
import { novoCodigoDeLink } from "@/lib/catalogo/tabelas-de-preco-servidor";

/**
 * LINKS COM TABELA DE PREÇO (atacado / varejo) — recurso gated.
 *
 * GET    → lista os links da loja
 * POST   → cria um link ({ name, priceMode })
 * PATCH  → liga/desliga um link ({ id, active })
 *
 * Só gerente/admin mexem, e só se a loja tiver o recurso ativado pelo Super
 * Admin: sem isso a porta responde 403 e nada muda para ninguém.
 */

/**
 * Porteiro das duas portas:
 *  • LER a lista é liberado para qualquer pessoa da loja — é a vendedora que
 *    manda o link para a cliente dela; recusar leitura fazia a tela dizer
 *    "nenhum link criado" e ela concluir que a loja não usa tabela
 *    (revisão 18/08/2026);
 *  • CRIAR / DESATIVAR continua em gerente+: preço é decisão comercial.
 */
async function guardar(
  user: { companyId: string; role: string },
  precisaEditar: boolean
) {
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { priceTablesEnabled: true, catalogHideOutOfStock: true },
  });
  if (!company?.priceTablesEnabled)
    return { erro: "Sua loja não usa tabelas de preço por link.", company: null };
  if (precisaEditar && !isManagerUp(user as never))
    return { erro: "Só gerente ou admin podem criar ou desativar links.", company: null };
  return { erro: null, company };
}

export async function GET() {
  try {
    const user = await requireUser();
    const { erro, company } = await guardar(user, false);
    if (erro) return NextResponse.json({ error: erro }, { status: 403 });
    // a vitrine esconde esgotado quando a loja pede: a conferência tem que
    // contar as MESMAS peças que a cliente vê, senão o total mente
    const soComEstoque = company!.catalogHideOutOfStock
      ? { variants: { some: { stock: { gt: 0 } } } }
      : {};
    const [links, total, semAtacado, semMinimo] = await Promise.all([
      db.catalogLink.findMany({
        where: { companyId: user.companyId },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, code: true, priceMode: true, active: true },
      }),
      // CONFERÊNCIA DA VITRINE (só as peças que aparecem no catálogo).
      //
      // O preço de atacado CAI NO VAREJO quando a peça não tem atacado
      // cadastrado (`catalogPrice`): sem este aviso, a lojista mandaria o
      // link de atacado e a cliente veria preço cheio — parecendo que o
      // recurso não funciona, quando o que falta é o cadastro.
      db.product.count({
        where: { companyId: user.companyId, active: true, images: { some: {} }, ...soComEstoque },
      }),
      db.product.count({
        where: {
          companyId: user.companyId,
          active: true,
          images: { some: {} },
          ...soComEstoque,
          wholesalePrice: { lte: 0 },
        },
      }),
      db.product.count({
        where: {
          companyId: user.companyId,
          active: true,
          images: { some: {} },
          ...soComEstoque,
          minQuantity: { lte: 1 },
        },
      }),
    ]);
    return NextResponse.json({ links, conferencia: { total, semAtacado, semMinimo } });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const { erro } = await guardar(user, true);
    if (erro) return NextResponse.json({ error: erro }, { status: 403 });
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(40),
        priceMode: z.enum(["VAREJO", "ATACADO"]),
      })
      .safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Dê um nome ao link." }, { status: 400 });
    // teto de bom senso: a loja precisa de dois ou três links, não de mil.
    // Conta só os ATIVOS — senão o conselho "desative algum" não destravava.
    const quantos = await db.catalogLink.count({
      where: { companyId: user.companyId, active: true },
    });
    if (quantos >= 20)
      return NextResponse.json(
        { error: "Você já tem 20 links. Desative algum antes de criar outro." },
        { status: 409 }
      );
    const link = await db.catalogLink.create({
      data: {
        companyId: user.companyId,
        name: parsed.data.name,
        priceMode: parsed.data.priceMode,
        code: novoCodigoDeLink(),
      },
      select: { id: true, name: true, code: true, priceMode: true, active: true },
    });
    return NextResponse.json({ link }, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const { erro } = await guardar(user, true);
    if (erro) return NextResponse.json({ error: erro }, { status: 403 });
    const parsed = z
      .object({ id: z.string().min(1), active: z.boolean() })
      .safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    // updateMany com companyId: link de outra loja não é alcançável
    if (parsed.data.active) {
      // reativar também conta para o teto (antes dava para passar de 20)
      const ativos = await db.catalogLink.count({
        where: { companyId: user.companyId, active: true },
      });
      if (ativos >= 20)
        return NextResponse.json(
          { error: "Você já tem 20 links ativos. Desative algum antes." },
          { status: 409 }
        );
    }
    const r = await db.catalogLink.updateMany({
      where: { id: parsed.data.id, companyId: user.companyId },
      data: { active: parsed.data.active },
    });
    if (r.count === 0)
      return NextResponse.json({ error: "Link não encontrado" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
