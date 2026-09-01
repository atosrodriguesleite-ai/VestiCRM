import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp, ownedScope } from "@/lib/scope";
import {
  reverseAndDeleteOrder,
  cleanupOrphanCatalogCustomer,
  temPagamentoConfirmadoDeGateway,
  avisarIntegracoesDaDevolucao,
} from "@/lib/order-actions";
import { apagarPedidoDoFinanceiroSemQuebrar } from "@/lib/financeiro/porta-vendas";
import { orderNumber } from "@/lib/orders";

const patchSchema = z.object({
  stageId: z.string().optional(),
  lostReason: z.string().optional(),
  value: z.number().nonnegative().optional(),
  title: z.string().min(1).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    // ownedScope: vendedora só mexe na negociação da carteira dela (a tela
    // do funil já filtra assim; a API aceitava qualquer id — auditoria
    // 07/08/2026). Gerente/admin seguem vendo tudo.
    const opp = await db.opportunity.findFirst({
      where: { id, ...ownedScope(user) },
      include: { order: { select: { id: true, number: true, status: true } } },
    });
    if (!opp) {
      return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
    }

    const data: Record<string, unknown> = {
      lastInteractionAt: new Date(),
    };
    if (parsed.data.title) data.title = parsed.data.title;
    if (parsed.data.value !== undefined) data.value = parsed.data.value;
    if (parsed.data.lostReason !== undefined)
      data.lostReason = parsed.data.lostReason;

    if (parsed.data.stageId) {
      const stage = await db.stage.findFirst({
        where: {
          id: parsed.data.stageId,
          pipeline: { companyId: user.companyId },
        },
      });
      if (!stage) {
        return NextResponse.json({ error: "Etapa inválida" }, { status: 404 });
      }

      if (stage.isLost) {
        // Cartão com pedido vivo não vira "perdido" por arrasto: a reserva de
        // estoque é do PEDIDO e não tem prazo (RN-003) — marcar a negociação
        // como perdida deixaria as peças seguradas para sempre, sem ninguém
        // ver. O caminho certo é cancelar o pedido (que pergunta o destino
        // das peças, RN-004); o cancelamento move o cartão sozinho.
        if (opp.order && opp.order.status !== "CANCELADO") {
          return NextResponse.json(
            {
              error: `Esta negociação tem o pedido ${orderNumber(opp.order.number)} ligado a ela. Cancele o pedido para devolver as peças ao estoque (se ele não aparece no seu painel, peça à gerência) — marcar como perdida não solta a reserva.`,
            },
            { status: 409 }
          );
        }
        // motivo obrigatório também no servidor: sem ele o relatório de
        // perdas não diz nada (a tela já pergunta; isto segura outros clientes)
        if (!parsed.data.lostReason?.trim() && !opp.lostReason) {
          return NextResponse.json(
            { error: "Informe o motivo da perda." },
            { status: 400 }
          );
        }
      } else if (parsed.data.lostReason === undefined) {
        // saiu da coluna de perda: o motivo antigo não vale mais (ficava
        // gravado numa negociação aberta/ganha e sujava a leitura)
        data.lostReason = null;
      }

      data.stageId = stage.id;
      data.status = stage.isWon ? "WON" : stage.isLost ? "LOST" : "OPEN";
      data.closedAt = stage.isWon || stage.isLost ? new Date() : null;

      // Ganhar a oportunidade no funil NÃO gera faturamento: venda só existe
      // com pagamento (pedido pago). Isso evita contar o mesmo dinheiro duas
      // vezes (o pedido do catálogo já cria pedido + oportunidade). A "última
      // compra" também é atualizada apenas quando o pedido é pago.
    }

    const updated = await db.opportunity.update({ where: { id }, data });
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

/**
 * Excluir uma oportunidade do funil — usado para limpar testes.
 *
 * Com pedido ligado, a régua (revisão 18/08/2026 — pelo funil dava para
 * apagar pedido pago sem nenhuma trava):
 * • Só o par DO CATÁLOGO cai junto: pedido com `clientRef` (o protocolo que
 *   SÓ o catálogo grava, RN-010) criado no mesmo instante do cartão. A janela
 *   de tempo sozinha não serve — a conciliação carimba no cartão a data do
 *   pedido, então TODO cartão dela pareceria "nascido junto", e apagá-lo
 *   derrubaria uma venda real (Nuvemshop/manual) devolvendo estoque de peças
 *   já vendidas.
 * • Qualquer outro pedido ligado RECUSA a exclusão: desvincular também não
 *   dá — a conciliação recriaria o cartão na próxima abertura (exclusão que
 *   "não pega") e o cartão novo nasceria com cara de "nascido junto".
 * • Par do catálogo com pagamento de gateway CONFIRMADO → recusa (o rastro
 *   do dinheiro real não some por cascata).
 * • Estoque devolvido é empurrado às integrações donas (RN-014).
 * Permitido apenas para dono/admin/gerente.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json(
        { error: "Você não tem permissão para excluir oportunidades." },
        { status: 403 }
      );
    }
    const { id } = await params;
    const opp = await db.opportunity.findFirst({
      where: { id, companyId: user.companyId },
      include: { order: { include: { items: true } } },
    });
    if (!opp) {
      return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
    }

    // par do catálogo: protocolo clientRef (só o catálogo grava) + mesmo
    // instante (10min de folga, a mesma janela do DELETE de pedidos)
    const nasceuComOPedido =
      opp.order &&
      opp.order.clientRef !== null &&
      Math.abs(opp.createdAt.getTime() - opp.order.createdAt.getTime()) <
        10 * 60 * 1000;

    if (opp.order && !nasceuComOPedido) {
      return NextResponse.json(
        {
          error: `Esta negociação acompanha o pedido ${orderNumber(opp.order.number)}. Apagar só o cartão não apaga a venda — e o funil o recriaria sozinho. Para tirar os dois, exclua ou cancele o pedido na tela Pedidos.`,
        },
        { status: 409 }
      );
    }

    if (opp.order && (await temPagamentoConfirmadoDeGateway(opp.order.id))) {
      return NextResponse.json(
        {
          error:
            "O pedido desta negociação tem pagamento confirmado (Mercado Pago ou InfinitePay) e não pode ser apagado. Cancele o pedido (isso trata o estorno) em vez de excluir.",
        },
        { status: 409 }
      );
    }

    // idem exclusão pela tela de Pedidos: a venda some, o financeiro cancela
    if (opp.order) apagarPedidoDoFinanceiroSemQuebrar(user.companyId, opp.order.id);
    const devolvidas = await db.$transaction(
      async (tx) => {
        let dev: { variantId: string; quantity: number }[] = [];
        if (opp.order) {
          // Pedido gerado junto (catálogo) é desfeito e apagado primeiro. Isso
          // pode apagar o cliente do catálogo em cascata — e, com ele, esta
          // própria oportunidade — por isso usamos deleteMany logo abaixo (não
          // erra se já tiver sumido).
          dev = (await reverseAndDeleteOrder(tx, opp.order)).devolvidas;
        } else {
          // Sem pedido ligado: o cliente do catálogo pode ficar órfão. Limpa se
          // não tiver mais nenhum pedido.
          await cleanupOrphanCatalogCustomer(tx, user.companyId, opp.customerId);
        }
        // A oportunidade sai do funil; tarefas/vendas ficam sem vínculo (SetNull).
        await tx.opportunity.deleteMany({ where: { id: opp.id } });
        return dev;
      },
      // desfazer pedido grande peça a peça não cabe nos 5s padrão com o
      // banco na nuvem (mesma folga do DELETE de pedidos)
      { timeout: 30_000, maxWait: 10_000 }
    );

    avisarIntegracoesDaDevolucao(user.companyId, devolvidas);

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
