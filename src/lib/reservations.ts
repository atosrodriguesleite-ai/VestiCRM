import { db } from "./db";
import { orderNumber } from "./orders";
import { pushStockToNuvemshop } from "./nuvemshop";
import { pushStockToJueri } from "./jueri";

/**
 * Expiração das reservas de estoque. Quando um vendedor monta um orçamento, a
 * peça sai do estoque na hora pra ninguém vender a mesma peça duas vezes. Mas
 * se a venda não fecha, a peça não pode ficar presa pra sempre: depois de 48h
 * sem virar pedido pago, a reserva é solta e o estoque volta sozinho.
 *
 * Solta só pedidos AINDA em orçamento/aguardando (não pagos) que estão
 * segurando estoque (stockDeducted) e foram criados há mais de 48h. Registra a
 * devolução (ENTRADA "Reserva expirada") e reflete nas integrações.
 *
 * Roda dentro do cron diário (2x/dia) — a janela de 48h tem folga de sobra.
 */

const RESERVA_HORAS = 48;

/**
 * RESERVA ATÔMICA DE ESTOQUE.
 *
 * Conferir o estoque e depois baixar em dois passos separados tem uma janela
 * no meio: duas clientes fechando a última peça no mesmo segundo passam as
 * duas na conferência e as duas baixam. O `updateMany` com `stock >= pedido`
 * faz as duas coisas de uma vez — o banco garante que só uma ganha; a outra
 * volta zero linhas e o pedido é recusado com a mensagem certa.
 *
 * Devolve a lista do que FALTOU (vazia = reservou tudo). Quem chama decide
 * se recusa o pedido (catálogo/vendedora) ou se só avisa (baixa de um pedido
 * antigo que já foi pago).
 */
export type ItemDeEstoque = {
  variantId: string | null;
  quantity: number;
  /** nome legível da peça, para a mensagem de erro */
  label: string;
};

export type FaltaDeEstoque = { label: string; pedido: number; disponivel: number };

type ClientePrisma = {
  productVariant: {
    updateMany: (args: {
      where: { id: string; stock: { gte: number } };
      data: { stock: { decrement: number } };
    }) => Promise<{ count: number }>;
    findUnique: (args: {
      where: { id: string };
      select: { stock: true };
    }) => Promise<{ stock: number } | null>;
  };
};

export async function reservarEstoque(
  tx: ClientePrisma,
  itens: ItemDeEstoque[]
): Promise<FaltaDeEstoque[]> {
  const faltas: FaltaDeEstoque[] = [];
  for (const item of itens) {
    if (!item.variantId || item.quantity <= 0) continue;
    const r = await tx.productVariant.updateMany({
      where: { id: item.variantId, stock: { gte: item.quantity } },
      data: { stock: { decrement: item.quantity } },
    });
    if (r.count === 0) {
      const atual = await tx.productVariant.findUnique({
        where: { id: item.variantId },
        select: { stock: true },
      });
      faltas.push({
        label: item.label,
        pedido: item.quantity,
        disponivel: Math.max(atual?.stock ?? 0, 0),
      });
    }
  }
  return faltas;
}

/**
 * RESERVA O QUE TIVER — usada no pedido do CATÁLOGO PÚBLICO.
 *
 * Aqui recusar o pedido inteiro seria pior: a cliente monta o carrinho e o
 * WhatsApp abre com a mensagem dela no mesmo clique. Se o servidor recusasse,
 * ela mandaria o pedido e a loja não teria pedido nenhum na tela — sumiria a
 * venda. Então o sistema segura tudo o que existe, cria o pedido e AVISA na
 * cara da loja o que faltou, para a vendedora resolver com a cliente (outra
 * cor, outro tamanho, esperar reposição).
 *
 * O estoque nunca fica negativo: cada baixa é condicionada ao que há.
 */
export async function reservarOQueTiver(
  tx: ClientePrisma,
  itens: ItemDeEstoque[]
): Promise<FaltaDeEstoque[]> {
  const faltas: FaltaDeEstoque[] = [];
  for (const item of itens) {
    if (!item.variantId || item.quantity <= 0) continue;
    const cheio = await tx.productVariant.updateMany({
      where: { id: item.variantId, stock: { gte: item.quantity } },
      data: { stock: { decrement: item.quantity } },
    });
    if (cheio.count > 0) continue; // segurou a quantidade toda

    const atual = await tx.productVariant.findUnique({
      where: { id: item.variantId },
      select: { stock: true },
    });
    const disponivel = Math.max(atual?.stock ?? 0, 0);
    if (disponivel > 0) {
      // segura o que sobrou (condicionado de novo: nunca deixa negativo)
      await tx.productVariant.updateMany({
        where: { id: item.variantId, stock: { gte: disponivel } },
        data: { stock: { decrement: disponivel } },
      });
    }
    faltas.push({ label: item.label, pedido: item.quantity, disponivel });
  }
  return faltas;
}

/** Frase pronta para a cliente/vendedora entender o que faltou. */
export function textoDaFalta(faltas: FaltaDeEstoque[]): string {
  return faltas
    .map((f) =>
      f.disponivel > 0
        ? `${f.label}: você pediu ${f.pedido} e restam ${f.disponivel}`
        : `${f.label}: esgotado`
    )
    .join("; ");
}

export async function releaseExpiredReservations() {
  const limite = new Date(Date.now() - RESERVA_HORAS * 60 * 60 * 1000);

  const expirados = await db.order.findMany({
    where: {
      status: { in: ["ORCAMENTO", "AGUARDANDO_PAGAMENTO"] },
      stockDeducted: true,
      createdAt: { lt: limite },
    },
    include: { items: true },
  });

  const soltos: { number: number; companyId: string }[] = [];

  for (const order of expirados) {
    try {
      await db.$transaction(async (tx) => {
        for (const it of order.items) {
          if (!it.variantId) continue;
          await tx.productVariant.update({
            where: { id: it.variantId },
            data: { stock: { increment: it.quantity } },
          });
        }
        await tx.inventoryMovement.createMany({
          data: order.items
            .filter((i) => i.variantId)
            .map((i) => ({
              companyId: order.companyId,
              variantId: i.variantId!,
              orderId: order.id,
              type: "ENTRADA" as const,
              quantity: i.quantity,
              reason: `Reserva expirada (48h) — pedido ${orderNumber(order.number)}`,
            })),
        });
        await tx.order.update({
          where: { id: order.id },
          data: { stockDeducted: false },
        });
      });

      // devolve o estoque solto pra origem (Nuvemshop absoluto / Jueri delta +)
      const variantIds = order.items
        .map((i) => i.variantId)
        .filter((v): v is string => !!v);
      if (variantIds.length > 0) {
        pushStockToNuvemshop(order.companyId, variantIds).catch(() => {});
        const changes = order.items
          .filter((i) => i.variantId)
          .map((i) => ({ variantId: i.variantId!, delta: i.quantity }));
        pushStockToJueri(order.companyId, changes).catch(() => {});
      }

      soltos.push({ number: order.number, companyId: order.companyId });
    } catch {
      // um pedido problemático não pode travar os outros
    }
  }

  return {
    verificados: expirados.length,
    soltos: soltos.length,
    pedidos: soltos.map((s) => orderNumber(s.number)),
  };
}
