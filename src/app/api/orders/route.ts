import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { imageHref } from "@/lib/img";
import { corIgual } from "@/lib/capa-por-cor";
import { avancarFunil } from "@/lib/funil-auto";
import { requireUser, AuthError } from "@/lib/auth";
import { isSupport } from "@/lib/scope";
import { computeOrderTotals, orderNumber } from "@/lib/orders";
import { espelharEstoqueSemQuebrar } from "@/lib/nuvemshop";
import { espelharJueriSemQuebrar } from "@/lib/jueri";
import { juntarPorVariacao, reservarComExtras } from "@/lib/reservations";
import { variacoesSobEncomenda } from "@/lib/sob-encomenda";
import { categoriasSobEncomenda } from "@/lib/sob-encomenda-data";
import {
  ExtrasSemCiencia,
  extrasConfirmadosSchema,
  extrasPrevistos,
  extrasSemCiencia,
  respostaDeExtras,
  textoDosExtras,
} from "@/lib/pedido-extras";
import { syncOpportunityValue, garantirCartaoDoPedido } from "@/lib/opportunity-sync";
import { comNumeroUnico } from "@/lib/numero-do-pedido";
import { sincronizarPedidoSemQuebrar } from "@/lib/financeiro/porta-vendas";

/**
 * Pedido grande (a mensagem colada do WhatsApp traz 30+ linhas) precisa de
 * folga: em produção o banco fica na nuvem e cada consulta é uma viagem.
 */
export const maxDuration = 60;

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
  // LINK DE CAMPANHA que precificou (RN-040) — usado pelo resgate "Colar
  // pedido do WhatsApp". Sem isto o pedido nascia com desconto 0 e a peça
  // acrescentada depois vinha a preço cheio, no mesmo pedido.
  //
  // Só o ENDEREÇO vem daqui. A PORCENTAGEM é lida do cadastro: aceitar o
  // número da tela deixava qualquer vendedora carimbar 90% e o editor de
  // itens passava a sugerir toda peça nova a 10% do preço (achado da revisão
  // de 01/09/2026). Em toda esta entrega quem calcula desconto é o servidor.
  campaignRef: z.string().max(120).nullish(),
  // PEÇAS EXTRAS (RN-075): o que a pessoa viu na janela e confirmou, por
  // peça. Sem isto, faltar estoque continua recusando o pedido (a Central e
  // o "Colar pedido do WhatsApp" não oferecem extra).
  extrasConfirmados: extrasConfirmadosSchema,
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

    // CAMPANHA DO PEDIDO (RN-040): o endereço vem da tela, a PORCENTAGEM vem
    // do cadastro — e da campanha DESTA loja (RN-013). Campanha pausada ou
    // encerrada não desconta nada; o carimbo do endereço fica assim mesmo,
    // porque é por ele que a exclusão conta os pedidos dela.
    const campanhaDoPedido = input.campaignRef
      ? await db.trackCampaign.findFirst({
          where: { companyId: user.companyId, slug: input.campaignRef },
          select: { slug: true, discount: true, active: true, archivedAt: true },
        })
      : null;
    const descontoDaCampanha =
      campanhaDoPedido && campanhaDoPedido.active && !campanhaDoPedido.archivedAt
        ? campanhaDoPedido.discount
        : 0;

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
    // as categorias que vendem sob encomenda (RN-076) vêm junto, não em série
    const catsSobEncomenda = categoriasSobEncomenda(user.companyId);
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
      // a cor SEPARADA em produto próprio (RN-050) ainda vale pelo produto
      // de antes: o rascunho guardado na tela aponta para ele
      if (!v || (v.productId !== item.productId && v.separadaDeId !== item.productId)) {
        return NextResponse.json({ error: "Produto inválido" }, { status: 404 });
      }
    }
    // O ESTOQUE COBRE? Conferido pela SOMA de cada peça (a mesma peça em duas
    // linhas é uma conta só). O que passar do estoque só entra como EXTRA,
    // com a ciência da pessoa (RN-075) — sem ela, a resposta é o 409 de
    // sempre, agora com a lista para a tela perguntar.
    const itensDeEstoque = input.items.map((it) => {
      const v = variantById.get(it.variantId)!;
      return {
        variantId: it.variantId,
        quantity: it.quantity,
        label: `${v.product.name} (${v.color} ${v.size})`,
      };
    });
    // a peça que VENDE SOB ENCOMENDA (RN-076) passa livre: não vira extra
    // nem para no estoque — fica negativa, e o negativo é o que produzir
    const livres = variacoesSobEncomenda(variants, await catsSobEncomenda);
    const previstos = extrasPrevistos(
      juntarPorVariacao(itensDeEstoque).map((p) => ({ ...p, precisa: p.quantity })),
      new Map(variants.map((v) => [v.id, v.stock])),
      livres
    );
    if (extrasSemCiencia(previstos, input.extrasConfirmados).length > 0) {
      return NextResponse.json(respostaDeExtras(previstos), { status: 409 });
    }

    const totals = computeOrderTotals(
      input.items,
      { valor: input.discount, pct: input.discountPct },
      input.shippingFee,
      { valor: input.surcharge, pct: input.surchargePct }
    );

    // comNumeroUnico: dois pedidos no mesmo instante (painel + catálogo +
    // Nuvemshop) disputam o mesmo número; quem perde tenta de novo do zero
    // o que a reserva DE FATO segurou (o extra fica de fora) — é só isso que
    // as integrações espelham depois da transação
    let seguradasDoPedido: { variantId: string; quantity: number }[] = [];
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
          campaignRef: campanhaDoPedido?.slug ?? null,
          campaignDiscount: descontoDaCampanha,
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
      // duas. O que não coube vira EXTRA (RN-075) — e só fica se a pessoa
      // confirmou AQUELA quantidade; senão a transação inteira é desfeita e
      // a tela pergunta de novo, com os números de agora.
      const reserva = await reservarComExtras(tx, itensDeEstoque, livres);
      const semCiencia = extrasSemCiencia(reserva.extras, input.extrasConfirmados);
      if (semCiencia.length > 0) throw new ExtrasSemCiencia(reserva.extras);
      // o livro guarda o que SAIU de verdade, por peça — é dele que o
      // cancelamento devolve e é por ele que o extra se conta (nunca pela
      // quantidade do item: o extra não saiu de estoque nenhum)
      if (reserva.seguradas.length > 0) {
        await tx.inventoryMovement.createMany({
          data: reserva.seguradas.map((s) => ({
            companyId: user.companyId,
            variantId: s.variantId,
            orderId: created.id,
            type: "SAIDA" as const,
            quantity: s.quantity,
            reason: `Reserva — pedido ${orderNumber(created.number)}`,
          })),
        });
      }
      if (reserva.extras.length > 0) {
        await tx.orderEvent.create({
          data: {
            orderId: created.id,
            type: "NOTA",
            description: textoDosExtras(reserva.extras, user.name),
            userId: user.id,
          },
        });
      }
      seguradasDoPedido = reserva.seguradas;
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
    // Só o que SAIU daqui: a peça EXTRA não mexeu em estoque nenhum e não
    // vai para a Nuvemshop nem para o Jueri (RN-075).
    if (seguradasDoPedido.length > 0) {
      espelharEstoqueSemQuebrar(
        user.companyId,
        seguradasDoPedido.map((s) => s.variantId)
      );
      espelharJueriSemQuebrar(
        user.companyId,
        seguradasDoPedido.map((s) => ({ variantId: s.variantId, delta: -s.quantity }))
      );
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

    // PORTA ÚNICA DO FINANCEIRO (RN-033): pedido criado já aguardando
    // pagamento (ou pago) vira lançamento sozinho
    sincronizarPedidoSemQuebrar(order.id);

    return NextResponse.json(order, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    // a peça acabou no meio do caminho: nada foi criado, e a tela recebe
    // na hora qual peça e quanto restou — a que oferece extra pergunta de
    // novo com os números de agora (RN-075)
    if (e instanceof ExtrasSemCiencia)
      return NextResponse.json(respostaDeExtras(e.extras), { status: 409 });
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
