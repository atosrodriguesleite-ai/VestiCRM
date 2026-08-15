import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { lerItens } from "@/lib/recuperacao";

/**
 * O LINK MÁGICO DA RECUPERAÇÃO: devolve os itens da sacola abandonada para o
 * catálogo REMONTAR (?sacola=<id> na URL do catálogo).
 *
 * Pública de propósito (a cliente não tem login) e segura por desenho:
 *  • o id é um cuid não adivinhável, entregue só na mensagem da cliente;
 *  • responde SÓ itens (produto/cor/tamanho/qtde) — nunca nome, telefone
 *    ou qualquer dado da cliente;
 *  • confere que o carrinho pertence à loja do slug (um link não abre
 *    sacola de outra loja).
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim();
  const slug = req.nextUrl.searchParams.get("slug")?.trim();
  if (!token || !slug) {
    return NextResponse.json({ error: "Link inválido" }, { status: 400 });
  }
  const cart = await db.abandonedCart.findFirst({
    where: { id: token, company: { slug } },
    select: { items: true, status: true },
  });
  if (!cart) {
    return NextResponse.json({ error: "Sacola não encontrada" }, { status: 404 });
  }
  return NextResponse.json({
    itens: lerItens(cart.items).map((i) => ({
      productId: i.productId ?? null,
      name: i.name,
      color: i.color ?? null,
      size: i.size ?? null,
      qty: i.qty,
    })),
  });
}
