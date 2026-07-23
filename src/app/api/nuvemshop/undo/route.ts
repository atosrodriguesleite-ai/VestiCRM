import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isAdmin } from "@/lib/scope";

/**
 * Desfaz a importação da Nuvemshop: remove os produtos que a importação
 * ESPELHOU (criados a partir da loja online — têm nuvemshopId) e desfaz as
 * ligações feitas nos produtos próprios da loja. Os produtos que o lojista
 * cadastrou à mão (sem nuvemshopId) NÃO são tocados. O histórico de pedidos
 * fica intacto (o item do pedido guarda nome/SKU e só perde o vínculo).
 *
 * Uso: quando a primeira importação duplicou por falta de SKU/nome batendo —
 * limpa tudo pra reimportar do jeito certo (com os SKUs alinhados).
 */
export async function POST() {
  try {
    const user = await requireUser();
    if (!isAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    // 1) apaga os produtos espelhados da Nuvemshop (variações e fotos vão junto)
    const del = await db.product.deleteMany({
      where: { companyId: user.companyId, nuvemshopId: { not: null } },
    });

    // 2) desvincula os produtos PRÓPRIOS que a importação tinha casado
    await db.productVariant.updateMany({
      where: {
        product: { companyId: user.companyId },
        OR: [{ nuvemshopId: { not: null } }, { nuvemshopProductId: { not: null } }],
      },
      data: { nuvemshopId: null, nuvemshopProductId: null },
    });

    return NextResponse.json({ ok: true, removidos: del.count });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
