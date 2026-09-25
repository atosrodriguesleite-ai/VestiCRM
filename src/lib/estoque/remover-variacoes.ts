import { Prisma } from "@prisma/client";
import type { SessionUser } from "../auth";
import { orderScope } from "../scope";
import { rotuloDaPeca } from "./dono-do-estoque";
import { pedidosQueSeguram, STATUS_QUE_SEGURAM_NA_LOJA } from "./inventario";
import { avisoDaRemocao, fraseDaPecaPresa, travaARemocao } from "./peca-presa";

/**
 * REMOVER VARIAÇÃO DA GRADE: quem pode travar, e quem fica sabendo (RN-050).
 *
 * Roda DENTRO da transação que remove, ANTES de qualquer outra escrita
 * dela (a recusa não desperdiça as fotos já gravadas). Três decisões:
 *
 *  • **Só pedido que ainda não é venda trava** (`travaARemocao`): orçamento
 *    e aguardando pagamento. O pago — separação inclusa, relato do dono em
 *    25/09/2026: *"separação já vendeu, então não pode segurar"* — segue
 *    com a peça: o item guarda nome, cor e tamanho congelados e perde só o
 *    vínculo com o cadastro (e com ele o código de barras).
 *  • **Trava os PEDIDOS e depois as VARIAÇÕES**, cada grupo em ordem de id,
 *    e só então confere de verdade: o pedido pago que volta a orçamento no
 *    meio (a porta do pedido grava a linha dele) espera esta transação, e a
 *    reserva nova (grava a linha da variação) também. As variações que a
 *    ficha vai AJUSTAR entram no mesmo passe (`travarTambem`): travar em
 *    dois passes separados, em ordens diferentes das da reserva, é deadlock.
 *  • **Todo pedido em aberto que tinha a peça fica sabendo**: o histórico
 *    ganha a nota (quem removeu, e que a peça segue ali sem código) e quem
 *    removeu recebe o aviso na hora — inclusive o pedido que não segurava
 *    nada (reserva com falta), que também perde o vínculo.
 */
export async function conferirRemocaoDeVariacoes(
  tx: Prisma.TransactionClient,
  user: SessionUser,
  product: { name: string; variants: { id: string; color: string; size: string }[] },
  removeVariantIds: string[],
  travarTambem: string[]
): Promise<{ recusa: string } | { aviso: string | null }> {
  const removidas = product.variants.filter((v) => removeVariantIds.includes(v.id));
  if (removidas.length === 0) return { aviso: null };
  const ids = removidas.map((v) => v.id);
  const porOrdem = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

  // quem tem a peça num item de pedido em aberto (com ou sem reserva no livro)
  const lerItens = () =>
    tx.orderItem.findMany({
      where: {
        variantId: { in: ids },
        order: { companyId: user.companyId, status: { in: [...STATUS_QUE_SEGURAM_NA_LOJA] } },
      },
      select: { orderId: true, variantId: true },
    });

  // 1ª leitura, sem trava: só para saber QUAIS pedidos travar
  const [antes, itensAntes] = await Promise.all([pedidosQueSeguram(user, ids, tx), lerItens()]);
  const pedidosParaTravar = [...new Set([...antes.map((p) => p.orderId), ...itensAntes.map((i) => i.orderId)])].sort(porOrdem);
  if (pedidosParaTravar.length) {
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ANY(${pedidosParaTravar}::text[]) ORDER BY "id" FOR UPDATE`;
  }
  const variacoesParaTravar = [...new Set([...ids, ...travarTambem])].sort(porOrdem);
  await tx.$queryRaw`SELECT "id" FROM "ProductVariant" WHERE "id" = ANY(${variacoesParaTravar}::text[]) ORDER BY "id" FOR UPDATE`;

  // a leitura que VALE: depois das travas, com o que já foi gravado
  const [seguradores, itens] = await Promise.all([pedidosQueSeguram(user, ids, tx), lerItens()]);
  const travam = seguradores.filter((p) => travaARemocao(p.status));
  if (travam.length) {
    const presa = removidas.find((v) => travam.some((p) => p.variantId === v.id))!;
    const dela = travam.filter((p) => p.variantId === presa.id);
    // diz QUAIS pedidos seguram a peça — "cancele o pedido" sem número era
    // beco sem saída numa loja cheia de pedidos
    return {
      recusa: fraseDaPecaPresa(
        rotuloDaPeca({ ...presa, product }),
        dela.reduce((soma, p) => soma + p.pecas, 0),
        dela
      ),
    };
  }

  const porPedido = new Map<string, Set<string>>();
  for (const x of [...seguradores, ...itens]) {
    const v = removidas.find((r) => r.id === x.variantId);
    if (!v) continue;
    const rotulos = porPedido.get(x.orderId) ?? new Set<string>();
    rotulos.add(rotuloDaPeca({ ...v, product }));
    porPedido.set(x.orderId, rotulos);
  }
  if (porPedido.size === 0) return { aviso: null };

  await tx.orderEvent.createMany({
    data: [...porPedido].map(([orderId, rotulos]) => ({
      orderId,
      type: "NOTA",
      userId: user.id,
      description:
        `${[...rotulos].join(", ")} saiu do cadastro de produtos (removida por ${user.name}). ` +
        `A peça continua neste pedido, só sem código de barras — na separação, conferir na mão. ` +
        `Se o pedido for cancelado, ela não volta sozinha ao estoque (a variação não existe mais).`,
    })),
  });
  const afetados = await tx.order.findMany({
    where: { companyId: user.companyId, id: { in: [...porPedido.keys()] } },
    select: { id: true, number: true },
  });
  const veem = new Set(
    (
      await tx.order.findMany({
        where: { AND: [orderScope(user), { id: { in: afetados.map((o) => o.id) } }] },
        select: { id: true },
      })
    ).map((o) => o.id)
  );
  return { aviso: avisoDaRemocao(afetados.map((o) => ({ numero: o.number, visivel: veem.has(o.id) }))) };
}
