import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { imageHref } from "@/lib/img";
import { corIgual } from "@/lib/capa-por-cor";
import { avancarFunil } from "@/lib/funil-auto";
import { requireUser, AuthError } from "@/lib/auth";
import { isSupport } from "@/lib/scope";
import { computeOrderTotals, orderNumber } from "@/lib/orders";
import { pushStockToNuvemshop } from "@/lib/nuvemshop";
import { pushStockToJueri } from "@/lib/jueri";
import { reservarEstoque, textoDaFalta } from "@/lib/reservations";
import { syncOpportunityValue, garantirCartaoDoPedido } from "@/lib/opportunity-sync";
import { comNumeroUnico } from "@/lib/numero-do-pedido";
import { sincronizarPedidoSemQuebrar } from "@/lib/financeiro/porta-vendas";

/**
 * Pedido grande (a mensagem colada do WhatsApp traz 30+ linhas) precisa de
 * folga: em produção o banco fica na nuvem e cada consulta é uma viagem.
 */
export const maxDuration = 60;

/** Peça que se foi entre a conferência e a baixa (duas vendas simultâneas). */
class SemEstoque extends Error {}

const itemSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
});

const createSchema = z.object({
  customerId: z.string().min(1),
  conversationId: z.string().optional(),
  items: z.array(itemSchema).min(1),
  discount: z.number().nonnegative().default(0),
  // quando vem porcentagem, ela manda: o valor em reais é derivado do subtotal
  discountPct: z.number().min(0).max(100).nullish(),
  surcharge: z.number().nonnegative().default(0),
  surchargePct: z.number().min(0).max(100).nullish(),
  shippingFee: z.number().nonnegative().default(0),
  notes: z.string().optional(),
  paymentMethod: z.enum(["PIX", "CARTAO", "BOLETO", "CHEQUE", "DINHEIRO", "OUTRO"]).default("PIX"),
  status: z.enum(["ORCAMENTO", "AGUARDANDO_PAGAMENTO"]).default("ORCAMENTO"),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    // Suporte é perfil OPERACIONAL: acompanha e ajusta pedidos, mas montar
    // um pedido é ato comercial (vira carteira e comissão de vendedora)
    if (isSupport(user)) {
      return NextResponse.json(
        { error: "Perfil Suporte não cria pedidos — peça para a vendedora ou a gerente." },
        { status: 403 }
      );
    }
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const input = parsed.data;

    // valida cliente e conversa dentro do tenant
    const customer = await db.customer.findFirst({
      where: { id: input.customerId, companyId: user.companyId },
    });
    if (!customer) {
      return NextResponse.json({ error: "Cliente inválido" }, { status: 404 });
    }
    if (input.conversationId) {
      const conv = await db.conversation.findFirst({
        where: { id: input.conversationId, companyId: user.companyId },
      });
      if (!conv) {
        return NextResponse.json({ error: "Conversa inválida" }, { status: 404 });
      }
    }

    // carrega variantes (com produto) garantindo tenant e monta snapshot
    const variantIds = input.items.map((i) => i.variantId);
    const variants = await db.productVariant.findMany({
      where: {
        id: { in: variantIds },
        product: { companyId: user.companyId },
      },
      // SÓ O ID DA FOTO. Trazer a coluna inteira lia o base64 da imagem
        // do banco (megabytes por pedido) só para descobrir o endereço
        // dela — `imageHref` monta o link a partir do id, e a rota
        // /api/img resolve sozinha quando a foto é link externo.
        // TODAS as fotos (id+cor): o item guarda a foto DA COR escolhida,
        // não a capa geral (incidente Entre Linhas: item Azul com foto Preta)
        include: {
          product: {
            include: {
              images: { orderBy: { order: "asc" }, select: { id: true, color: true } },
            },
          },
        },
    });
    const variantById = new Map(variants.map((v) => [v.id, v]));
    for (const item of input.items) {
      const v = variantById.get(item.variantId);
      if (!v || v.productId !== item.productId) {
        return NextResponse.json({ error: "Produto inválido" }, { status: 404 });
      }
      if (v.stock < item.quantity) {
        return NextResponse.json(
          {
            error: `Estoque insuficiente de ${v.product.name} (${v.color} ${v.size}): restam ${v.stock}`,
          },
          { status: 409 }
        );
      }
    }

    const totals = computeOrderTotals(
      input.items,
      { valor: input.discount, pct: input.discountPct },
      input.shippingFee,
      { valor: input.surcharge, pct: input.surchargePct }
    );

    // comNumeroUnico: dois pedidos no mesmo instante (painel + catálogo +
    // Nuvemshop) disputam o mesmo número; quem perde tenta de novo do zero
    const order = await comNumeroUnico(() => db.$transaction(async (tx) => {
      const last = await tx.order.findFirst({
        where: { companyId: user.companyId },
        orderBy: { number: "desc" },
        select: { number: true },
      });
      // O PEDIDO GRUDA NA NEGOCIAÇÃO DO FUNIL.
      //
      // Até aqui só o pedido do catálogo era ligado. Pedido montado no chat ou
      // na tela de Pedidos — o caminho principal do atacado — nascia solto, e
      // TODO o motor de `opportunity-sync` desiste na primeira linha quando não
      // há vínculo. Resultado: a vendedora fechava a venda, recebia o
      // pagamento, e o cartão continuava parado em "em negociação" para
      // sempre. Era o motivo de o funil parecer inútil.
      //
      // Pega a negociação ABERTA mais recente da cliente que ainda não tem
      // pedido: o vínculo é 1-para-1 (`Order.opportunityId` é único), então
      // uma negociação já usada não pode ser reaproveitada. Não achou nenhuma
      // livre? O pedido segue sem vínculo, como antes — funil nunca trava
      // venda.
      const negociacaoAberta = await tx.opportunity.findFirst({
        where: {
          companyId: user.companyId,
          customerId: input.customerId,
          status: "OPEN",
          order: null,
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      const created = await tx.order.create({
        data: {
          companyId: user.companyId,
          number: (last?.number ?? 0) + 1,
          customerId: input.customerId,
          conversationId: input.conversationId,
          opportunityId: negociacaoAberta?.id ?? null,
          sellerId: user.id,
          status: input.status,
          subtotal: totals.subtotal,
          discount: totals.discount,
          discountPct: input.discountPct ?? null,
          surcharge: totals.surcharge,
          surchargePct: input.surchargePct ?? null,
          shippingFee: totals.shippingFee,
          netTotal: totals.netTotal,
          total: totals.total,
          notes: input.notes,
          items: {
            create: input.items.map((i) => {
              const v = variantById.get(i.variantId)!;
              // SKU da VARIAÇÃO escolhida (o do produto é o da 1ª variação
              // importada — mostrava "Preto" num item Azul); foto DA COR
              const fotoItem =
                v.product.images.find((im) => corIgual(im.color, v.color)) ??
                v.product.images[0];
              return {
                productId: v.productId,
                variantId: v.id,
                name: v.product.name,
                sku: v.sku ?? v.product.sku,
                imageUrl: fotoItem ? imageHref(fotoItem.id) : null,
                color: v.color,
                size: v.size,
                quantity: i.quantity,
                unitPrice: i.unitPrice,
                total: i.quantity * i.unitPrice,
              };
            }),
          },
          payments: {
            create: {
              method: input.paymentMethod,
              amount: totals.total,
              status: "PENDENTE",
            },
          },
          shipping: {
            create: {
              cost: totals.shippingFee,
              city: customer.city,
              state: customer.state,
            },
          },
          events: {
            create: {
              type: "CRIADO",
              description: `Pedido criado por ${user.name}`,
              userId: user.id,
            },
          },
        },
        include: { items: true },
      });

      // RESERVA: o pedido do vendedor (orçamento/aguardando) já SEGURA o estoque
      // na criação — assim dois vendedores não vendem a mesma peça. A peça só
      // volta quando o pedido for CANCELADO — a reserva não tem prazo.
      // Registra o movimento pra ficar auditável/reversível.
      //
      // A baixa é CONDICIONADA ao estoque existente (não é um decremento
      // cego): a conferência lá em cima e a baixa aqui são dois momentos, e
      // duas vendedoras fechando a última peça no mesmo segundo passavam as
      // duas. Se a peça se foi no meio, a transação inteira é desfeita.
      const faltas = await reservarEstoque(
        tx,
        input.items.map((it) => {
          const v = variantById.get(it.variantId)!;
          return {
            variantId: it.variantId,
            quantity: it.quantity,
            label: `${v.product.name} (${v.color} ${v.size})`,
          };
        })
      );
      if (faltas.length > 0) throw new SemEstoque(textoDaFalta(faltas));
      await tx.inventoryMovement.createMany({
        data: created.items
          .filter((i) => i.variantId)
          .map((i) => ({
            companyId: user.companyId,
            variantId: i.variantId!,
            orderId: created.id,
            type: "SAIDA" as const,
            quantity: i.quantity,
            reason: `Reserva — pedido ${orderNumber(created.number)}`,
          })),
      });
      await tx.order.update({ where: { id: created.id }, data: { stockDeducted: true } });

      return created;
      },
      // o padrão do Prisma são 5s: apertado demais para um pedido de 30
      // linhas com o banco na nuvem. Estourar aqui derrubava a rota sem
      // mensagem nenhuma — a vendedora via só "não foi possível criar".
      { timeout: 20_000, maxWait: 10_000 }
    ));

    // Integrações: a reserva feita AQUI é refletida na ORIGEM do estoque
    // (Nuvemshop/Jueri) — a peça reservada some do estoque dos outros canais
    // no mesmo instante, então ninguém vende a mesma peça em dois lugares.
    const reservedVariantIds = order.items
      .map((i) => i.variantId)
      .filter((v): v is string => !!v);
    if (reservedVariantIds.length > 0) {
      pushStockToNuvemshop(user.companyId, reservedVariantIds).catch(() => {});
      const changes = order.items
        .filter((i) => i.variantId)
        .map((i) => ({ variantId: i.variantId!, delta: -i.quantity }));
      pushStockToJueri(user.companyId, changes).catch(() => {});
    }

    // registra o pedido no histórico da conversa (timeline do WhatsApp)
    if (input.conversationId) {
      const resumo = order.items
        .map((i) => `• ${i.quantity}x ${i.name} ${i.color ?? ""} ${i.size ?? ""}`.trim())
        .join("\n");
      await db.message.create({
        data: {
          conversationId: input.conversationId,
          direction: "OUT",
          kind: "NOTE",
          body: `🛍️ Pedido ${orderNumber(order.number)} criado — total R$ ${order.total.toFixed(2)}\n${resumo}`,
          authorId: user.id,
        },
      });
      await db.conversation.update({
        where: { id: input.conversationId },
        data: { lastMessageAt: new Date() },
      });
    }

    // Cliente SEM negociação aberta livre → o pedido nascia solto e a venda
    // nunca aparecia no funil (nem ao pagar). Agora o cartão nasce junto,
    // já na etapa certa, amarrado a ESTE pedido.
    const cartao =
      order.opportunityId ?? (await garantirCartaoDoPedido(user.companyId, order.id));
    // O CARTÃO ANDA SOZINHO: montou orçamento → "Pedido em negociação";
    // já foi para aguardando pagamento → "Pagamento pendente". Antes essas
    // duas etapas do meio só existiam se alguém arrastasse o cartão à mão.
    await avancarFunil(
      user.companyId,
      input.customerId,
      input.status === "AGUARDANDO_PAGAMENTO" ? "PAGAMENTO" : "NEGOCIACAO",
      // o cartão certo é o que ficou amarrado a ESTE pedido
      cartao
    );
    // o valor do cartão acompanha o pedido desde o NASCIMENTO (valor vendido,
    // sem frete) — a coluna do funil mostrava R$ 0/valor velho enquanto o
    // Dashboard já mostrava a venda (auditoria 07/08/2026)
    await syncOpportunityValue(user.companyId, cartao, order.netTotal);

    // PORTA ÚNICA DO FINANCEIRO (RN-031): pedido criado já aguardando
    // pagamento (ou pago) vira lançamento sozinho
    sincronizarPedidoSemQuebrar(order.id);

    return NextResponse.json(order, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    // a peça acabou no meio do caminho: nada foi criado, e a vendedora
    // recebe na hora qual peça e quanto restou
    if (e instanceof SemEstoque)
      return NextResponse.json(
        { error: `Estoque insuficiente — ${e.message}. Ajuste as quantidades.` },
        { status: 409 }
      );
    // Erro inesperado: a vendedora precisa de UMA frase que ajude, e o time
    // precisa do erro no painel Saúde. Antes a rota estourava sem resposta
    // JSON e a tela mostrava só "não foi possível criar o pedido".
    console.error("[POST /api/orders] falhou", e);
    return NextResponse.json(
      {
        error:
          "O pedido não pôde ser criado. Tente de novo; se repetir, avise o suporte com o horário.",
        detalhe: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300),
      },
      { status: 500 }
    );
  }
}
