import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";
import { lerItens, mensagemDeRecuperacao, varrerCarrinhosSeDeuAHora } from "@/lib/recuperacao";
import { after } from "next/server";

/**
 * ESTEIRA DE RECUPERAÇÃO — carrinhos abandonados da loja (catálogo +
 * Nuvemshop), com a mensagem pronta de cada um e o placar do mês.
 *
 * Vendedora também vê: recuperar venda É trabalho de vendedora. O isolamento
 * é por LOJA (companyId); a carteira não se aplica porque o carrinho sem dona
 * é da loja — quem pegar primeiro, recupera.
 */
export async function GET(_req: NextRequest) {
  try {
    const user = await requireUser();
    // abrir a tela também dá carona na varredura (carrinho fresco na tela)
    after(() => varrerCarrinhosSeDeuAHora());

    const [carts, company] = await Promise.all([
      db.abandonedCart.findMany({
        where: { companyId: user.companyId },
        orderBy: { abandonedAt: "desc" },
        take: 300,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          trackSession: { select: { channel: true } },
        },
      }),
      db.company.findUnique({
        where: { id: user.companyId },
        select: { slug: true, recoveryAuto: true },
      }),
    ]);

    // placar do mês: soma o que os pedidos recuperados VALERAM de verdade
    // (netTotal do pedido amarrado; sem pedido amarrado, o valor da sacola)
    const inicioDoMes = new Date();
    inicioDoMes.setDate(1);
    inicioDoMes.setHours(0, 0, 0, 0);
    const recuperadosNoMes = carts.filter(
      (c) => c.status === "RECUPERADO" && c.recoveredAt && c.recoveredAt >= inicioDoMes
    );
    const pedidos = await db.order.findMany({
      where: {
        id: { in: recuperadosNoMes.map((c) => c.recoveredOrderId).filter((v): v is string => !!v) },
      },
      select: { id: true, netTotal: true },
    });
    const porPedido = new Map(pedidos.map((p) => [p.id, p.netTotal]));
    const placarMes = recuperadosNoMes.reduce(
      (s, c) => s + (c.recoveredOrderId ? (porPedido.get(c.recoveredOrderId) ?? c.value) : c.value),
      0
    );

    return NextResponse.json({
      recoveryAuto: company?.recoveryAuto ?? false,
      podeConfigurar: isManagerUp(user),
      placarMes,
      recuperadosMes: recuperadosNoMes.length,
      carts: carts.map((c) => ({
        id: c.id,
        source: c.source,
        status: c.status,
        value: c.value,
        items: lerItens(c.items),
        customer: c.customer
          ? { id: c.customer.id, name: c.customer.name, phone: c.customer.phone }
          : null,
        channel: c.trackSession?.channel ?? null,
        abandonedAt: c.abandonedAt.toISOString(),
        autoSentAt: c.autoSentAt?.toISOString() ?? null,
        contactedAt: c.contactedAt?.toISOString() ?? null,
        recoveredAt: c.recoveredAt?.toISOString() ?? null,
        checkoutUrl: c.checkoutUrl,
        // a mensagem pronta (com o link mágico) — a tela só abre o wa.me
        mensagem: mensagemDeRecuperacao(c, company?.slug ?? "", c.customer?.name),
      })),
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

const configSchema = z.object({ recoveryAuto: z.boolean() });

/** Liga/desliga a 1ª mensagem automática (decisão da loja: gerente+). */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const parsed = configSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    await db.company.update({
      where: { id: user.companyId },
      data: { recoveryAuto: parsed.data.recoveryAuto },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
