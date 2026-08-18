import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { imageHref } from "@/lib/img";
import { corIgual } from "@/lib/capa-por-cor";
import { intakeLead, normalizePhone } from "@/lib/intake";
import { atribuirCampanhaPorUtm, resolveRef } from "@/lib/tracking/engine";
import {
  reservarOQueTiver,
  textoDaFalta,
  type FaltaDeEstoque,
} from "@/lib/reservations";
import { pushStockToNuvemshop } from "@/lib/nuvemshop";
import { pushStockToJueri } from "@/lib/jueri";
import { catalogPrice, orderNumber, round2 } from "@/lib/orders";
import { modoValido, faltaParaOMinimo, textoDoMinimo } from "@/lib/catalogo/tabelas-de-preco";
import { resolverLink } from "@/lib/catalogo/tabelas-de-preco-servidor";
import { comNumeroUnico } from "@/lib/numero-do-pedido";
import { syncOpportunityValue, garantirCartaoDoPedido } from "@/lib/opportunity-sync";
import { avancarFunil } from "@/lib/funil-auto";
import { notifyNovoPedido } from "@/lib/notify";
import { brl } from "@/lib/format";

/**
 * Pedido vindo do catálogo público — POST /api/catalog/order
 *
 * Sem login: quando o cliente final toca em "Enviar pedido pelo WhatsApp",
 * o catálogo também registra o pedido AQUI, para ele aparecer na tela
 * Pedidos da loja com status "Aguardando pagamento".
 *
 *   • Com telefone → passa pelo Lead Intake Engine (deduplica cliente,
 *     cria conversa/oportunidade) e o pedido fica ligado a esse cliente.
 *   • Sem dados → cria um cliente "Cliente do catálogo (não identificado)"
 *     exclusivo do pedido; o vendedor preenche os dados depois, na tela
 *     do pedido.
 *
 * Preço e totais são recalculados no servidor (nunca confiamos no valor
 * enviado pelo navegador). O estoque NÃO baixa aqui — só quando o pedido
 * for marcado como pago (regra do sistema).
 */

/**
 * O catálogo aceita pedido com muitas linhas e o banco fica na nuvem: sem
 * folga, o pedido da cliente morre no meio e some (o incidente que a
 * proteção de protocolo resolve do outro lado).
 */
export const maxDuration = 60;

const itemSchema = z.object({
  productId: z.string().min(1),
  color: z.string().min(1),
  size: z.string().min(1),
  quantity: z.number().int().positive().max(9999),
});

const schema = z.object({
  company: z.string().min(1), // slug da loja
  items: z.array(itemSchema).min(1).max(300),
  customer: z
    .object({
      name: z.string().max(120).optional(),
      phone: z.string().max(30).optional(),
      store: z.string().max(120).optional(),
    })
    .optional(),
  message: z.string().max(10000).optional(), // texto enviado no WhatsApp
  ref: z.string().max(120).optional(), // link do vendedor/campanha (?ref=)
  c: z.string().max(60).optional(), // link rastreado por cliente (?c=)
  promo: z.string().max(60).optional(), // catálogo de campanha (desconto)
  /** TABELA DE PREÇO: código do link por onde a cliente entrou (atacado/varejo) */
  link: z.string().max(60).optional(),
  /**
   * PROTOCOLO DO ENVIO: código sorteado no aparelho da cliente antes de
   * mandar. É o que deixa o catálogo INSISTIR sem medo — se a internet
   * oscilar, ele tenta de novo (e até na próxima visita) e este código
   * garante que o pedido não entra duas vezes.
   */
  clientRef: z.string().min(6).max(60).optional(),
  /** sessão da Tracking Engine que gerou o pedido (faturamento por canal) */
  trackSessionId: z.string().max(60).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }
  const input = parsed.data;

  const company = await db.company.findUnique({
    where: { slug: input.company },
  });
  // Loja suspensa não recebe pedido novo — trava no servidor, para não
  // depender só da página ter sumido (link antigo, cache, app do cliente).
  if (!company || company.suspended) {
    return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
  }
  // TABELA DE PREÇO DO LINK (recurso gated). O navegador diz por qual link
  // entrou; QUEM DECIDE O PREÇO É AQUI. Link de loja que não ativou o recurso
  // (ou desativado) não vale, e a vitrine volta à tabela padrão da loja.
  const tabela = await resolverLink(company.id, input.link, company.priceTablesEnabled);
  // A CLIENTE VEIO POR UM LINK QUE NÃO VALE MAIS (desativado, ou o recurso
  // saiu do ar): NÃO cobrar pela tabela padrão. Ela viu preço de atacado na
  // tela; cair no varejo em silêncio cobraria a mais e ainda faria a
  // exigência de quantidade mínima sumir sem ninguém perceber.
  if (input.link && !tabela) {
    return NextResponse.json(
      {
        error:
          "Este link de preço não está mais valendo. Peça o link atualizado para a loja antes de enviar o pedido.",
        linkInvalido: true,
      },
      { status: 409 }
    );
  }
  // campanha e tabela de preço não se somam: são endereços diferentes, e um
  // pedido que chegasse com os dois teria desconto sobre atacado — valor que
  // nenhuma tela mostrou. Manda a tabela do link.
  const modoDePreco = tabela?.priceMode ?? modoValido(company.catalogPriceMode);
  // MESMO preço que a vitrine mostrou: a cliente não pode ver um valor na
  // tela e receber outro na confirmação do pedido
  const precoVitrine = (p: { retailPrice: number; wholesalePrice: number }) =>
    catalogPrice(p, modoDePreco);

  // JÁ ENTROU? A cliente (ou o próprio catálogo, insistindo) pode mandar o
  // mesmo pedido mais de uma vez. Devolvemos o pedido que já existe em vez
  // de criar outro — a loja não pode receber a mesma venda em duplicidade,
  // nem segurar a peça duas vezes no estoque.
  if (input.clientRef) {
    const jaExiste = await db.order.findUnique({
      where: {
        companyId_clientRef: { companyId: company.id, clientRef: input.clientRef },
      },
      select: { id: true, number: true },
    });
    if (jaExiste) {
      return NextResponse.json(
        { ok: true, orderId: jaExiste.id, number: jaExiste.number, jaRegistrado: true },
        { status: 200 }
      );
    }
  }

  // Catálogo de CAMPANHA: o desconto é da loja e recalculado AQUI — só vale
  // se a campanha existe, está ativa e o produto faz parte dela
  const promo = input.promo
    ? await db.promoCatalog.findUnique({
        where: { companyId_slug: { companyId: company.id, slug: input.promo } },
        include: { products: { select: { productId: true } } },
      })
    : null;
  const promoActive = promo?.active && !tabela ? promo : null;
  const promoProductIds = new Set(
    promoActive?.products.map((p) => p.productId) ?? []
  );
  const promoPrice = (productId: string, price: number) =>
    promoActive && promoProductIds.has(productId)
      ? Math.round(price * (1 - promoActive.discount / 100) * 100) / 100
      : price;

  // Resolve as variações (produto ativo + cor + tamanho) dentro da loja
  const productIds = [...new Set(input.items.map((i) => i.productId))];
  const products = await db.product.findMany({
    where: { id: { in: productIds }, companyId: company.id, active: true },
    include: {
      // todas as fotos, mas SÓ id+cor (o base64 fica no banco): o item
      // guarda a foto DA COR escolhida, não a capa geral (incidente Entre
      // Linhas: item Azul Serenity com foto da peça Preta)
      images: { orderBy: { order: "asc" }, select: { id: true, color: true } },
      variants: true,
    },
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  type Line = {
    productId: string;
    variantId: string;
    name: string;
    sku: string | null;
    imageUrl: string | null;
    color: string;
    size: string;
    quantity: number;
    unitPrice: number;
    total: number;
  };
  const lines: Line[] = [];
  for (const item of input.items) {
    const product = productById.get(item.productId);
    const variant = product?.variants.find(
      (v) => v.color === item.color && v.size === item.size
    );
    if (!product || !variant) {
      return NextResponse.json({ error: "Produto inválido" }, { status: 404 });
    }
    // SKU da VARIAÇÃO escolhida (o do produto é o da 1ª variação importada —
    // mostrava o SKU da Preta num item Azul Serenity); foto DA COR escolhida
    const fotoItem =
      product.images.find((im) => corIgual(im.color, variant.color)) ??
      product.images[0];
    lines.push({
      productId: product.id,
      variantId: variant.id,
      name: product.name,
      sku: variant.sku ?? product.sku,
      imageUrl: fotoItem ? imageHref(fotoItem.id) : null,
      color: variant.color,
      size: variant.size,
      quantity: item.quantity,
      // preço vigente no catálogo (com o desconto da campanha, se houver);
      // round2: 3 × 19,90 em float dá 59.699999… — o gravado tem que ser 59,70
      unitPrice: promoPrice(product.id, precoVitrine(product)),
      total: round2(item.quantity * promoPrice(product.id, precoVitrine(product))),
    });
  }
  // QUANTIDADE MÍNIMA DO ATACADO: a tela já avisa e desabilita o botão, mas
  // quem decide é o servidor — o navegador é do cliente. Só vale no link de
  // atacado; catálogo normal (e loja que não ativou o recurso) nunca cai aqui.
  const faltasDoMinimo = faltaParaOMinimo(
    input.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
    products.map((p) => ({ id: p.id, name: p.name, minQuantity: p.minQuantity })),
    modoDePreco === "ATACADO" && tabela ? "ATACADO" : "VAREJO"
  );
  if (faltasDoMinimo.length > 0) {
    return NextResponse.json(
      { error: textoDoMinimo(faltasDoMinimo), minimoAtacado: faltasDoMinimo },
      { status: 409 }
    );
  }

  // round2: soma de floats deixa centavo fantasma (10.1+20.2 = 30.299999…)
  // e o valor gravado tem que bater com o que a cliente vê e paga
  const subtotal = round2(lines.reduce((a, l) => a + l.total, 0));
  const totalPieces = lines.reduce((a, l) => a + l.quantity, 0);

  // REGRA DE COMISSÃO da loja: QUEM MANDA O LINK LEVA A VENDA — e SÓ ele.
  // A cliente chega no WhatsApp, a vendedora manda o link dela, a cliente
  // pede: o pedido é dessa vendedora. É ela quem atendeu e fechou.
  // A carteira acompanha (a cliente passa a ser de quem vendeu), senão o
  // cadastro apontaria para uma pessoa e a comissão para outra.
  let linkSellerId: string | null = null;
  if (input.ref) {
    linkSellerId = (await resolveRef(company.id, input.ref)).sellerId;
  }
  // Cliente do link rastreado (?c=): quem recebeu o link da vendedora
  const linkCustomer = input.c
    ? await db.customer.findFirst({
        where: {
          companyId: company.id,
          OR: [{ linkCode: input.c }, { id: input.c }],
        },
        select: { id: true, city: true, state: true, ownerId: true },
      })
    : null;

  // ---- Cliente ----
  const rawPhone = input.customer?.phone ?? "";
  const hasPhone = rawPhone.replace(/\D/g, "").length >= 8;
  const displayName =
    input.customer?.name?.trim() || input.customer?.store?.trim() || "";

  let customerId: string;
  let conversationId: string | null = null;
  let customerCity: string | null = null;
  let customerState: string | null = null;
  let opportunityId: string | null = null;
  // COMISSÃO DO CATÁLOGO: SÓ O LINK DECIDE.
  //
  // O pedido é de quem mandou o link — e de mais ninguém. Não existe mais o
  // "sem link, fica com a responsável pela cliente": era esse desvio que
  // fazia o orçamento nascido do link da Lara cair no painel da Juliana só
  // porque a cliente estava na carteira dela. Cada painel tem exatamente os
  // pedidos que vieram do link daquela vendedora.
  //
  // Sem vendedora no link, o pedido nasce SEM DONA: é da loja. A gerência
  // enxerga, e o pedido não vira PAGO enquanto alguém não assumir (a regra
  // "só vira pago com vendedora" já existe) — assim ninguém recebe comissão
  // por uma venda que não fez, e nenhuma venda fica sem responsável.
  const orderSellerId: string | null = linkSellerId;

  if (hasPhone) {
    // Com telefone: entra pelo Lead Intake Engine (deduplica, cria
    // conversa e oportunidade — nenhum contato se perde).
    const result = await intakeLead(company.id, {
      phone: normalizePhone(rawPhone),
      name: displayName || undefined,
      origin: "CATALOGO_PUBLICO",
      message: input.message,
      opportunityTitle: `Pedido do catálogo — ${totalPieces} ${totalPieces === 1 ? "peça" : "peças"}`,
      value: subtotal,
      // cliente NOVA que chegou pelo link da vendedora já nasce na carteira
      // DELA: sem isso o intake gastava a vez do rodízio e a tarefa/card
      // nasciam de outra vendedora — para serem repontados logo abaixo, com
      // rastro falso no meio (auditoria 07/08/2026)
      ...(linkSellerId ? { ownerId: linkSellerId } : {}),
    });
    customerId = result.customer.id;
    conversationId = result.conversation?.id ?? null;
    customerCity = result.customer.city;
    customerState = result.customer.state;
    // a carteira segue a venda: quem vendeu passa a cuidar da cliente. Fica
    // registrado na linha do tempo dela (troca de carteira mexe em dinheiro).
    if (linkSellerId && result.customer.ownerId !== linkSellerId) {
      const anterior = result.customer.ownerId
        ? await db.user.findUnique({
            where: { id: result.customer.ownerId },
            select: { name: true },
          })
        : null;
      const novo = await db.user.findUnique({
        where: { id: linkSellerId },
        select: { name: true },
      });
      await db.customer.update({
        where: { id: result.customer.id },
        data: { ownerId: linkSellerId },
      });
      await db.customerEvent.create({
        data: {
          companyId: company.id,
          customerId: result.customer.id,
          type: "OUTRO",
          description: anterior
            ? `Responsável alterada de ${anterior.name} para ${novo?.name ?? "—"}: pedido feito pelo link dela no catálogo`
            : `${novo?.name ?? "Vendedora"} assumiu a cliente: pedido feito pelo link dela no catálogo`,
        },
      });
    }
    // Aqui só entra a oportunidade que o intake ACABOU de criar. Quando ele
    // reaproveita uma negociação já aberta, quem a amarra é o
    // garantirCartaoDoPedido logo após criar o pedido (funil vivo,
    // 13/08/2026) — e apagar o pedido não a apaga: a exclusão só leva junto
    // cartão que NASCEU com o pedido (janela de 10min em nasceuComOPedido).
    opportunityId = result.opportunity?.id ?? null;
  } else if (linkCustomer) {
    // Link rastreado sem telefone digitado: o pedido é do cliente do link.
    customerId = linkCustomer.id;
    customerCity = linkCustomer.city;
    customerState = linkCustomer.state;
    // pedido do catálogo também vira card no funil
    const stage =
      (
        await db.originRule.findUnique({
          where: {
            companyId_origin: {
              companyId: company.id,
              origin: "CATALOGO_PUBLICO",
            },
          },
          include: { stage: true },
        })
      )?.stage ??
      (await db.stage.findFirst({
        where: { pipeline: { companyId: company.id } },
        orderBy: { order: "asc" },
      }));
    if (stage) {
      const opp = await db.opportunity.create({
        data: {
          companyId: company.id,
          customerId: linkCustomer.id,
          stageId: stage.id,
          title: `Pedido do catálogo — ${totalPieces} ${totalPieces === 1 ? "peça" : "peças"}`,
          value: subtotal,
          status: stage.isWon ? "WON" : stage.isLost ? "LOST" : "OPEN",
        },
      });
      opportunityId = opp.id;
    }
  } else {
    // Sem dados: cria um cliente próprio do pedido para o vendedor
    // completar manualmente na tela do pedido.
    const anon = await db.customer.create({
      data: {
        companyId: company.id,
        name: displayName || "Cliente do catálogo (não identificado)",
        phone: "",
        origin: "CATALOGO_PUBLICO",
      },
    });
    await db.customerEvent.create({
      data: {
        companyId: company.id,
        customerId: anon.id,
        type: "LEAD_CRIADO",
        channel: "CATALOGO_PUBLICO",
        description: "Pedido pelo catálogo sem identificação do cliente",
      },
    });
    customerId = anon.id;

    // Cria a oportunidade no Funil mesmo sem telefone — todo pedido do
    // catálogo deve aparecer no funil de vendas para acompanhamento.
    const stage =
      (
        await db.originRule.findUnique({
          where: {
            companyId_origin: {
              companyId: company.id,
              origin: "CATALOGO_PUBLICO",
            },
          },
          include: { stage: true },
        })
      )?.stage ??
      (await db.stage.findFirst({
        where: { pipeline: { companyId: company.id } },
        orderBy: { order: "asc" },
      }));
    if (stage) {
      const opp = await db.opportunity.create({
        data: {
          companyId: company.id,
          customerId: anon.id,
          stageId: stage.id,
          title: `Pedido do catálogo — ${totalPieces} ${totalPieces === 1 ? "peça" : "peças"}`,
          value: subtotal,
          status: stage.isWon ? "WON" : stage.isLost ? "LOST" : "OPEN",
        },
      });
      opportunityId = opp.id;
    }
  }

  const noteLines = [
    "Pedido recebido pelo catálogo público.",
    input.customer?.store ? `Loja: ${input.customer.store}` : null,
    input.customer?.name ? `Nome: ${input.customer.name}` : null,
    input.customer?.phone ? `Telefone: ${input.customer.phone}` : null,
  ].filter(Boolean);

  // RASTRO DA COMISSÃO: o pedido carrega, escrito, de que link ele veio.
  // Discussão de comissão sem prova é briga — aqui a prova fica no próprio
  // pedido: link da fulana, link que não identificou ninguém, ou link geral
  // da loja.
  let notaComissao: string | null = null;
  if (!input.ref) {
    notaComissao =
      "Pedido feito pelo link geral do catálogo (sem vendedora no link) — a venda é da loja." +
      " Defina a responsável no pedido antes de marcar como pago.";
  } else if (linkSellerId) {
    const doLink = await db.user.findUnique({
      where: { id: linkSellerId },
      select: { name: true },
    });
    notaComissao = `Venda de ${doLink?.name ?? "—"}: a cliente pediu pelo link dela no catálogo.`;
  } else {
    // ref veio, mas não bateu com ninguém: a venda fica da loja (não é
    // chutada para a carteira) e o aviso diz exatamente o que conferir
    notaComissao =
      `O link usado ("${input.ref}") não identificou nenhuma vendedora da equipe — a venda ficou da loja.` +
      " Confira se o nome bate com o cadastro (e se não há duas pessoas com o mesmo primeiro nome), e defina a responsável antes de marcar como pago.";
  }

  // RESERVA DO CATÁLOGO — o buraco que fazia a peça sumir.
  //
  // O pedido montado pela vendedora já segurava o estoque; o pedido do
  // catálogo (o mais comum: a vendedora manda o link e a cliente monta) não
  // segurava nada. A peça continuava à venda para todo mundo e, quando a
  // cliente ia pagar no dia seguinte, tinha acabado. Agora o catálogo reserva
  // na mesma transação que cria o pedido.
  //
  // Se faltar peça, o pedido AINDA assim é criado (com o que havia reservado)
  // e o que faltou fica escrito nele: no mesmo clique a cliente já mandou o
  // pedido pelo WhatsApp, então recusar aqui faria a loja receber a mensagem
  // sem ter pedido nenhum na tela — venda perdida no escuro.
  // SESSÃO DE NAVEGAÇÃO → PEDIDO: valida que a sessão é DESTA loja antes de
  // gravar (id vem do navegador; sessão de outra loja é ignorada). É o
  // vínculo que deixa a Inteligência somar faturamento PAGO por canal.
  let trackSessionId: string | null = null;
  if (input.trackSessionId) {
    const sessao = await db.trackSession.findFirst({
      where: { id: input.trackSessionId, companyId: company.id },
      select: { id: true, utmCampaign: true },
    });
    trackSessionId = sessao?.id ?? null;
    // ?utm_campaign=<etiqueta> vira a campanha do cliente — só quando ele
    // ainda não tem (vale o primeiro contato). Nunca derruba o pedido.
    if (sessao?.utmCampaign) {
      await atribuirCampanhaPorUtm(company.id, customerId, sessao.utmCampaign).catch(
        () => {}
      );
    }
  }

  let faltas: FaltaDeEstoque[] = [];
  // o que foi DE FATO segurado — é isso (e não a quantidade pedida) que a
  // Jueri desconta; com reserva parcial, mandar o pedido inteiro deixava o
  // ERP da loja com estoque errado para sempre (auditoria 07/08/2026)
  let seguradas: { variantId: string; quantity: number }[] = [];
  const criarPedido = () =>
    db.$transaction(async (tx) => {
    const reserva = await reservarOQueTiver(
      tx,
      lines.map((l) => ({
        variantId: l.variantId,
        quantity: l.quantity,
        label: `${l.name} (${l.color} ${l.size})`,
      }))
    );
    faltas = reserva.faltas;
    seguradas = reserva.seguradas;
    const last = await tx.order.findFirst({
      where: { companyId: company.id },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    const criado = await tx.order.create({
      data: {
        companyId: company.id,
        number: (last?.number ?? 0) + 1,
        customerId,
        conversationId,
        opportunityId,
        sellerId: orderSellerId,
        clientRef: input.clientRef ?? null,
        trackSessionId,
        // TABELA que precificou: sem este carimbo, um pedido de atacado
        // reaberto/recalculado depois voltaria com preço de varejo
        priceMode: tabela ? modoDePreco : null,
        status: "AGUARDANDO_PAGAMENTO",
        stockDeducted: true, // a peça está segurada desde já
        subtotal,
        // pedido do catálogo não tem frete nem ajuste: valor vendido = total
        netTotal: subtotal,
        total: subtotal,
        notes: [
        ...noteLines,
        ...(faltas.length
          ? [`⚠️ Sem estoque para parte do pedido — ${textoDaFalta(faltas)}.`]
          : []),
      ].join("\n"),
        items: { create: lines },
        payments: {
          create: { method: "PIX", amount: subtotal, status: "PENDENTE" },
        },
        shipping: { create: { cost: 0, city: customerCity, state: customerState } },
        events: {
          create: [
            { type: "CRIADO", description: "Pedido recebido pelo catálogo público" },
            ...(notaComissao ? [{ type: "NOTA" as const, description: notaComissao }] : []),
          // a peça acabou entre montar o carrinho e enviar: a loja precisa
          // saber ANTES de cobrar, para combinar troca/reposição
          ...(faltas.length
            ? [
                {
                  type: "NOTA" as const,
                  description: `⚠️ Estoque insuficiente na entrada do pedido — ${textoDaFalta(faltas)}. O que havia foi reservado; combine o restante com a cliente.`,
                },
              ]
            : []),
          ],
        },
      },
      include: { items: true },
    });
    // movimento auditável da reserva — pelo que foi DE FATO segurado, nunca
    // pela quantidade pedida (reserva parcial devolvia fantasma no cancelar)
    if (reserva.seguradas.length > 0) {
      await tx.inventoryMovement.createMany({
        data: reserva.seguradas.map((s) => ({
          companyId: company.id,
          variantId: s.variantId,
          orderId: criado.id,
          type: "SAIDA" as const,
          quantity: s.quantity,
          reason: `Reserva — pedido ${orderNumber(criado.number)}`,
        })),
      });
    }
    return criado;
      },
      // o padrão do Prisma são 5s — apertado para carrinho grande com o
      // banco na nuvem
      { timeout: 20_000, maxWait: 10_000 }
    );

  let order: Awaited<ReturnType<typeof criarPedido>>;
  try {
    // dois pedidos no MESMO instante (outra cliente, painel, Nuvemshop)
    // disputam o mesmo número — quem perde a corrida tenta de novo do zero
    order = await comNumeroUnico(criarPedido);
    // CONVERSÃO MARCADA NO SERVIDOR, uma vez por pedido CRIADO. Antes era o
    // navegador (evento order_submitted) quem marcava: reenviar a mesma
    // sacola numa visita nova contava DUAS conversões para UM pedido — os
    // caminhos de pedido repetido (protocolo) não passam por aqui.
    if (trackSessionId) {
      await db.trackSession
        .update({ where: { id: trackSessionId }, data: { converted: true } })
        .catch(() => {});
    }
  } catch (e) {
    // CORRIDA: dois envios do mesmo protocolo chegaram juntos e os dois
    // passaram pela conferência acima. O índice único barra o segundo — e
    // aqui devolvemos o pedido que o primeiro criou, em vez de estourar erro
    // (para o catálogo, insistir tem que ser sempre seguro).
    const duplicado =
      input.clientRef &&
      typeof e === "object" &&
      e !== null &&
      (e as { code?: string }).code === "P2002";
    if (duplicado) {
      const jaExiste = await db.order.findUnique({
        where: {
          companyId_clientRef: { companyId: company.id, clientRef: input.clientRef! },
        },
        select: { id: true, number: true },
      });
      if (jaExiste) {
        return NextResponse.json(
          { ok: true, orderId: jaExiste.id, number: jaExiste.number, jaRegistrado: true },
          { status: 200 }
        );
      }
    }
    throw e;
  }

  // Pedido que nasceu SOLTO — cliente de sempre cujo cartão aberto o intake
  // reaproveitou (e por isso não amarrou), ou política da loja sem criação
  // automática — ganha o cartão aqui: reaproveita a negociação aberta livre
  // ou cria uma. Sem isso, pagar esse pedido nunca fechava nada no funil.
  const cartao =
    order.opportunityId ?? (await garantirCartaoDoPedido(company.id, order.id));
  // o valor do cartão no funil acompanha o pedido (a oportunidade criada
  // pelo intake nascia com R$ 0 e a coluna não batia com Pedidos)
  await syncOpportunityValue(company.id, cartao, order.netTotal);
  // e o cartão ANDA: pedido existe → pelo menos "Pedido em negociação" (o
  // reaproveitado ficava parado em "Primeiro contato" com pedido amarrado)
  await avancarFunil(
    company.id,
    customerId,
    order.status === "AGUARDANDO_PAGAMENTO" ? "PAGAMENTO" : "NEGOCIACAO",
    cartao
  );

  // a reserva some do estoque dos outros canais no mesmo instante.
  // Jueri desconta pelo que foi SEGURADO (reserva parcial: pediu 10, havia 4
  // → desconta 4); a Nuvemshop espelha o número absoluto, então basta o id.
  const variantIds = order.items
    .map((i) => i.variantId)
    .filter((v): v is string => !!v);
  if (variantIds.length > 0) {
    pushStockToNuvemshop(company.id, variantIds).catch(() => {});
  }
  if (seguradas.length > 0) {
    pushStockToJueri(
      company.id,
      seguradas.map((s) => ({ variantId: s.variantId, delta: -s.quantity }))
    ).catch(() => {});
  }

  // AVISO NA HORA: sino + push. Sem isso, o pedido do catálogo só era
  // descoberto se alguém abrisse a tela Pedidos por acaso — e foi assim que
  // uma venda ficou horas parada enquanto a cliente esperava resposta.
  await notifyNovoPedido({
    companyId: company.id,
    orderId: order.id,
    orderNumber: orderNumber(order.number),
    sellerId: orderSellerId,
    convId: conversationId,
    customerName: displayName || "Cliente do catálogo",
    pieces: totalPieces,
    total: brl(subtotal),
  }).catch(() => {});

  return NextResponse.json(
    { ok: true, orderId: order.id, number: order.number },
    { status: 201 }
  );
}
