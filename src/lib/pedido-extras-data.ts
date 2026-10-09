import type { Prisma } from "@prisma/client";
import { liquidoDosMovimentos } from "./estoque-do-pedido";
import {
  MARCA_DOS_EXTRAS,
  STATUS_COM_EXTRA_PENDENTE,
  extrasDoPedido,
  pedidoMostraExtras,
  totalDeExtras,
} from "./pedido-extras";
import { ajusteDasTrocasPorVariacao } from "./troca/regra";

/**
 * QUANTAS PEÇAS EXTRAS CADA PEDIDO TEM (RN-075) — para o selo da lista.
 *
 * O extra não tem coluna: é o que o pedido pede além do que o livro de
 * movimentos diz que ele segura (ver `lib/pedido-extras.ts`). Aqui a conta é
 * feita para a PÁGINA inteira em duas consultas (os itens e o livro dos
 * pedidos da página), nunca uma por pedido.
 */
type Banco = Pick<
  Prisma.TransactionClient,
  "orderItem" | "inventoryMovement" | "trocaItem" | "orderEvent"
>;

/**
 * O que o pedido pede além do que segura, e se isso foi CONFIRMADO como
 * extra (a confecção vai fazer) ou é falta que ninguém confirmou (pedido do
 * catálogo com estoque a menos, Pix que liquidou sem peça) — a tela fala
 * diferente das duas.
 */
export type ExtrasDoPedido = { total: number; confirmados: boolean };

export async function extrasDosPedidos(
  banco: Banco,
  pedidos: readonly {
    id: string;
    status: string;
    stockDeducted: boolean;
    nuvemshopId: string | null;
    createdAt: Date;
  }[]
): Promise<Map<string, ExtrasDoPedido>> {
  const candidatos = pedidos.filter(
    (p) =>
      (STATUS_COM_EXTRA_PENDENTE as readonly string[]).includes(p.status) &&
      p.stockDeducted &&
      !p.nuvemshopId
  );
  const resultado = new Map<string, ExtrasDoPedido>();
  if (candidatos.length === 0) return resultado;
  const ids = candidatos.map((p) => p.id);
  const [itens, movimentos, itensDeTroca, confirmacoes] = await Promise.all([
    banco.orderItem.findMany({
      where: { orderId: { in: ids } },
      select: { orderId: true, variantId: true, quantity: true },
    }),
    banco.inventoryMovement.findMany({
      where: { orderId: { in: ids } },
      select: { orderId: true, variantId: true, type: true, quantity: true },
    }),
    // as trocas do pedido (RN-073) entram na conta: o livro já as tem
    banco.trocaItem.findMany({
      where: { troca: { orderId: { in: ids } } },
      select: { sentido: true, variantId: true, quantity: true, troca: { select: { orderId: true } } },
    }),
    banco.orderEvent.findMany({
      where: { orderId: { in: ids }, description: { startsWith: MARCA_DOS_EXTRAS } },
      select: { orderId: true },
      distinct: ["orderId"],
    }),
  ]);
  const confirmados = new Set(confirmacoes.map((c) => c.orderId));
  const trocasPorPedido = new Map<string, { sentido: string; variantId: string | null; quantity: number }[]>();
  for (const t of itensDeTroca) {
    const lista = trocasPorPedido.get(t.troca.orderId) ?? [];
    lista.push(t);
    trocasPorPedido.set(t.troca.orderId, lista);
  }
  const itensPorPedido = new Map<string, { variantId: string | null; quantity: number }[]>();
  for (const i of itens) {
    const lista = itensPorPedido.get(i.orderId) ?? [];
    lista.push(i);
    itensPorPedido.set(i.orderId, lista);
  }
  const movsPorPedido = new Map<string, typeof movimentos>();
  for (const m of movimentos) {
    if (!m.orderId) continue;
    const lista = movsPorPedido.get(m.orderId) ?? [];
    lista.push(m);
    movsPorPedido.set(m.orderId, lista);
  }
  for (const p of candidatos) {
    const movs = movsPorPedido.get(p.id) ?? [];
    if (!pedidoMostraExtras({ ...p, temMovimento: movs.length > 0 })) continue;
    const total = totalDeExtras(
      extrasDoPedido(
        itensPorPedido.get(p.id) ?? [],
        liquidoDosMovimentos(movs),
        ajusteDasTrocasPorVariacao([{ itens: trocasPorPedido.get(p.id) ?? [] }])
      )
    );
    if (total > 0) resultado.set(p.id, { total, confirmados: confirmados.has(p.id) });
  }
  return resultado;
}
