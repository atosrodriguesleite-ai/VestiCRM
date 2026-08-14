import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError, type SessionUser } from "@/lib/auth";
import { isManagerUp, orderScope } from "@/lib/scope";
import { orderNumber } from "@/lib/orders";
import { consultarNfe } from "@/lib/bling";
import {
  meCalculate,
  meBuyShipment,
  meTracking,
  mePrintUrl,
  meRetomarEtiqueta,
  meCancel,
  pesoDoPedidoKg,
} from "@/lib/melhorenvio";
import { aplicarRastreio, novoCodigoPublico } from "@/lib/rastreio";

/**
 * Frete do pedido via Melhor Envio (módulo Envios, gated por loja).
 * GET  → situação do envio (atualiza o rastreio na hora)
 * POST → { action: "cotar" | "comprar" | "etiqueta" | "cancelar" }
 * Cotar é livre; comprar/cancelar mexem com dinheiro → gerente/admin.
 */

// a compra faz até 6 chamadas externas em sequência (1 no Bling para
// confirmar a nota + 5 no Melhor Envio). Timeout curto aqui é perigoso: se
// estourar DEPOIS do checkout, o saldo já saiu e o retry compraria outra
// etiqueta — a folga existe para o `upsert` sempre alcançar o meOrderId.
export const maxDuration = 60;

async function carregarPedido(user: SessionUser, orderId: string) {
  const userCompanyId = user.companyId;
  const [company, conn, order] = await Promise.all([
    db.company.findUnique({
      where: { id: userCompanyId },
      select: { shippingEnabled: true },
    }),
    db.melhorEnvioConnection.findUnique({ where: { companyId: userCompanyId } }),
    db.order.findFirst({
      where: { id: orderId, ...orderScope(user) },
      include: {
        customer: true,
        shipping: true,
        items: {
          include: { product: { select: { weightGrams: true, category: true, name: true } } },
        },
      },
    }),
  ]);
  return { company, conn, order };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const { company, conn, order } = await carregarPedido(user, id);
    if (!order)
      return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    if (!company?.shippingEnabled)
      return NextResponse.json({ error: "Módulo Envios não contratado." }, { status: 403 });

    let ship = order.shipping;
    // rastreio ao vivo: consulta o ME, guarda o que mudou e FAZ O PEDIDO
    // ANDAR (postado → Enviado, chegou → Entregue) — mesma régua da
    // varredura de carona, em lib/rastreio.ts (fonte única).
    if (ship?.meOrderId && conn && ship.meStatus !== "CANCELADO") {
      const t = await meTracking(user.companyId, ship.meOrderId).catch(() => null);
      if (t) {
        const atualizado = await aplicarRastreio({
          companyId: user.companyId,
          envio: ship,
          tracking: t,
        });
        ship = { ...ship, ...atualizado };
      }
    }
    return NextResponse.json({ connected: Boolean(conn), shipping: ship });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

const postSchema = z.object({
  action: z.enum(["cotar", "comprar", "gerar", "etiqueta", "cancelar"]),
  serviceId: z.number().int().positive().optional(),
  service: z.string().max(60).optional(),
  carrier: z.string().max(60).optional(),
  // saída de emergência: comprar com declaração de conteúdo mesmo com nota no
  // pedido (Bling fora do ar, nota que sumiu de lá). É escolha da loja, nunca
  // do sistema — despachar com o documento errado é problema fiscal dela.
  semNota: z.boolean().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const { action } = parsed.data;

    const { company, conn, order } = await carregarPedido(user, id);
    if (!order)
      return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    if (!company?.shippingEnabled)
      return NextResponse.json({ error: "Módulo Envios não contratado." }, { status: 403 });
    if (!conn)
      return NextResponse.json(
        { error: "Conecte o Melhor Envio em Configurações." },
        { status: 409 }
      );

    const destZip = (order.customer.zip ?? "").replace(/\D/g, "");
    const pesoKg = pesoDoPedidoKg(order.items, conn);
    // valor segurado = valor das peças (sem frete)
    const valorPecas = Math.max(0, order.subtotal - order.discount);

    if (action === "cotar") {
      if (destZip.length !== 8)
        return NextResponse.json(
          { error: "Cliente sem CEP válido. Preencha o endereço no cadastro do cliente." },
          { status: 409 }
        );
      const r = await meCalculate({
        companyId: user.companyId,
        toZip: destZip,
        weightKg: pesoKg,
        insuranceValue: valorPecas,
      });
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
      // `recusadas` = quem não cotou E o porquê. A tela mostra — esconder
      // fazia parecer que o sistema só cota Correios.
      return NextResponse.json({
        quotes: r.quotes,
        recusadas: r.recusadas,
        weightKg: pesoKg,
        // a nota pode ter sido emitida DEPOIS de a tela abrir — a cotação
        // devolve a situação de agora para a promessa não mentir
        comNota: order.nfeStatus === "AUTORIZADA" && Boolean(order.nfeKey),
      });
    }

    if (action === "comprar") {
      if (!isManagerUp(user))
        return NextResponse.json(
          { error: "Só gerente ou admin podem comprar frete." },
          { status: 403 }
        );
      if (!parsed.data.serviceId)
        return NextResponse.json({ error: "Escolha um serviço de frete." }, { status: 400 });
      if (order.status === "CANCELADO")
        return NextResponse.json(
          { error: "Pedido cancelado não pode ter frete." },
          { status: 409 }
        );
      if (order.shipping?.meOrderId && order.shipping.meStatus !== "CANCELADO")
        return NextResponse.json(
          { error: "Este pedido já tem uma etiqueta comprada." },
          { status: 409 }
        );
      const c = order.customer;
      const faltando = [
        !destZip && "CEP",
        !c.street?.trim() && "rua",
        !c.streetNumber?.trim() && "número",
        !c.city?.trim() && "cidade",
        !c.state?.trim() && "estado",
      ].filter(Boolean);
      if (faltando.length)
        return NextResponse.json(
          { error: `Complete o endereço do cliente: falta ${faltando.join(", ")}.` },
          { status: 409 }
        );
      if (!conn.fromZip || !conn.fromStreet || !conn.fromCity || !conn.fromState || !conn.fromName)
        return NextResponse.json(
          { error: "Complete o endereço do remetente em Configurações → Melhor Envio." },
          { status: 409 }
        );

      // NOTA: confere a situação REAL no Bling antes de gastar o saldo.
      // A nota pode ter sido cancelada no painel do Bling sem ninguém clicar
      // em "atualizar" aqui — e aí a etiqueta sairia apontando para uma nota
      // morta, com o dinheiro da carteira já debitado e sem volta.
      // NOTA: confere a situação REAL no Bling antes de gastar o saldo.
      // A nota pode ter sido cancelada no painel do Bling sem ninguém clicar
      // em "atualizar" aqui — e aí a etiqueta sairia apontando para uma nota
      // morta, com o dinheiro da carteira já debitado e sem volta.
      let chaveNfe: string | null = null;
      const temNota = Boolean(
        order.nfeStatus === "AUTORIZADA" && order.nfeKey && order.nfeBlingId
      );
      if (temNota && !parsed.data.semNota) {
        const nota = await consultarNfe(user.companyId, order.nfeBlingId!).catch(() => ({
          ok: false as const,
          situacao: "EMITINDO",
        }));
        if (!nota.ok)
          return NextResponse.json(
            {
              error:
                "Não consegui confirmar a nota fiscal no Bling agora. Tente de novo em instantes — nada foi cobrado.",
              // Bling fora do ar não pode prender a etiqueta para sempre: a
              // loja decide seguir com declaração de conteúdo se quiser.
              podeSemNota: true,
            },
            { status: 502 }
          );
        if (nota.situacao !== "AUTORIZADA") {
          // só nota comprovadamente MORTA mexe no pedido. "EMITINDO" pode ser
          // situação desconhecida do Bling (o mapa cai nela por padrão) —
          // rebaixar uma nota autorizada por causa disso perderia a chave e
          // travaria a reemissão.
          if (nota.situacao === "CANCELADA" || nota.situacao === "REJEITADA") {
            await db.order.updateMany({
              where: { id: order.id, nfeBlingId: order.nfeBlingId },
              data: { nfeStatus: nota.situacao, nfeKey: null },
            });
          }
          return NextResponse.json(
            {
              error: `A nota fiscal deste pedido não está mais autorizada no Bling (situação: ${nota.situacao}). Confira a nota antes de comprar a etiqueta — nada foi cobrado.`,
              podeSemNota: true,
            },
            { status: 409 }
          );
        }
        chaveNfe = nota.chave ?? order.nfeKey;
      }

      const r = await meBuyShipment({
        companyId: user.companyId,
        serviceId: parsed.data.serviceId,
        from: {
          name: conn.fromName,
          cpf: conn.fromCpf,
          cnpj: conn.fromCnpj,
          phone: conn.fromPhone,
          email: conn.fromEmail,
          zip: conn.fromZip,
          street: conn.fromStreet,
          number: conn.fromNumber ?? "S/N",
          complement: conn.fromComplement,
          district: conn.fromDistrict,
          city: conn.fromCity,
          state: conn.fromState,
        },
        to: {
          name: c.name,
          cpf: c.cpf,
          cnpj: c.cnpj,
          phone: c.phone,
          email: c.email,
          zip: destZip,
          street: c.street!,
          number: c.streetNumber!,
          complement: c.complement,
          district: c.district,
          city: c.city!,
          state: c.state!,
        },
        items: order.items.map((i) => ({
          name: i.name, // snapshot do momento da venda
          quantity: i.quantity,
          unitPrice: i.unitPrice,
        })),
        weightKg: pesoKg,
        insuranceValue: valorPecas,
        orderLabel: `Pedido ${orderNumber(order.number)}`,
        // Nota AUTORIZADA e CONFIRMADA no Bling → etiqueta com NF-e. Sem nota
        // → declaração de conteúdo, como sempre. A loja não escolhe nada: o
        // que manda é a nota existir de verdade, agora.
        nfeKey: chaveNfe,
      });
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });

      // pago mas a etiqueta ainda não gerou: grava o meOrderId (status
      // GERANDO) para o retry RETOMAR a geração — não comprar de novo
      const meStatus = r.pendente ? "GERANDO" : "ETIQUETA";

      // MEIO DE ENVIO preenchido pela etiqueta comprada ("Correios PAC"): a
      // vendedora contratou o frete aqui dentro, não faz sentido ela ainda
      // ter que escolher "meio de envio" na mão (pedido do dono, 14/08/2026)
      const meioDeEnvio =
        [parsed.data.carrier, parsed.data.service].filter(Boolean).join(" ").trim() ||
        "Melhor Envio";
      // código do link público de rastreio — nasce com a etiqueta e não muda
      const publicCode = order.shipping?.publicCode ?? novoCodigoPublico();

      const ship = await db.shipping.upsert({
        where: { orderId: order.id },
        update: {
          method: meioDeEnvio,
          publicCode,
          trackedAt: null, // envio novo entra na frente da fila da varredura
          meOrderId: r.meOrderId,
          meService: parsed.data.service ?? null,
          meCarrier: parsed.data.carrier ?? null,
          mePrice: r.price,
          meStatus,
          labelUrl: r.labelUrl,
          weightKg: pesoKg,
          // registra a chave USADA nesta etiqueta (null = declaração de
          // conteúdo) — é o que a tela lê depois, e não o estado atual da nota
          nfeKey: r.nfeKey,
          ...(r.tracking ? { trackingCode: r.tracking } : {}),
          zip: destZip,
          address: `${c.street}, ${c.streetNumber}${c.complement ? ` — ${c.complement}` : ""}`,
          city: c.city,
          state: c.state,
        },
        create: {
          orderId: order.id,
          method: meioDeEnvio,
          publicCode,
          meOrderId: r.meOrderId,
          meService: parsed.data.service ?? null,
          meCarrier: parsed.data.carrier ?? null,
          mePrice: r.price,
          meStatus,
          labelUrl: r.labelUrl,
          weightKg: pesoKg,
          nfeKey: r.nfeKey,
          trackingCode: r.tracking,
          zip: destZip,
          address: `${c.street}, ${c.streetNumber}${c.complement ? ` — ${c.complement}` : ""}`,
          city: c.city,
          state: c.state,
        },
      });
      await db.orderEvent.create({
        data: {
          orderId: order.id,
          type: "ENVIO",
          description: `Etiqueta comprada por ${user.name} — ${parsed.data.carrier ?? ""} ${parsed.data.service ?? ""} (R$ ${r.price.toFixed(2).replace(".", ",")}, ${pesoKg} kg) via Melhor Envio — ${r.nfeKey ? `com NF-e ${r.nfeKey}` : "com declaração de conteúdo"}`,
          userId: user.id,
        },
      });
      return NextResponse.json({ shipping: ship });
    }

    // RETOMAR: etiqueta paga que não gerou (status GERANDO) — regenera sem
    // recomprar. Fecha o buraco do dinheiro que saía e a etiqueta se perdia.
    if (action === "gerar") {
      if (!isManagerUp(user))
        return NextResponse.json(
          { error: "Só gerente ou admin podem gerar a etiqueta." },
          { status: 403 }
        );
      if (!order.shipping?.meOrderId)
        return NextResponse.json({ error: "Este pedido não tem etiqueta paga." }, { status: 409 });
      const rg = await meRetomarEtiqueta(user.companyId, order.shipping.meOrderId);
      if (!rg.ok) return NextResponse.json({ error: rg.error }, { status: 502 });
      const ship = await db.shipping.update({
        where: { id: order.shipping.id },
        data: {
          meStatus: "ETIQUETA",
          labelUrl: rg.labelUrl,
          ...(rg.tracking ? { trackingCode: rg.tracking } : {}),
        },
      });
      return NextResponse.json({ shipping: ship });
    }

    if (action === "etiqueta") {
      if (!order.shipping?.meOrderId)
        return NextResponse.json({ error: "Este pedido não tem etiqueta." }, { status: 409 });
      const url = await mePrintUrl(user.companyId, order.shipping.meOrderId);
      if (!url)
        return NextResponse.json(
          { error: "Não foi possível gerar o link da etiqueta agora." },
          { status: 502 }
        );
      await db.shipping.update({
        where: { id: order.shipping.id },
        data: { labelUrl: url },
      });
      return NextResponse.json({ url });
    }

    // cancelar (etiqueta ainda não postada; o valor volta para a carteira ME)
    if (!isManagerUp(user))
      return NextResponse.json(
        { error: "Só gerente ou admin podem cancelar frete." },
        { status: 403 }
      );
    if (!order.shipping?.meOrderId)
      return NextResponse.json({ error: "Este pedido não tem etiqueta." }, { status: 409 });
    const cancel = await meCancel(user.companyId, order.shipping.meOrderId);
    if (!cancel.ok)
      return NextResponse.json({ error: cancel.error }, { status: 502 });
    const ship = await db.shipping.update({
      where: { id: order.shipping.id },
      data: { meStatus: "CANCELADO" },
    });
    await db.orderEvent.create({
      data: {
        orderId: order.id,
        type: "ENVIO",
        description: `Etiqueta cancelada por ${user.name} — o valor volta para a carteira Melhor Envio da loja`,
        userId: user.id,
      },
    });
    return NextResponse.json({ shipping: ship });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
