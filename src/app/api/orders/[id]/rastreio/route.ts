import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { orderScope } from "@/lib/scope";
import { orderNumber } from "@/lib/orders";
import { sendMessage } from "@/lib/comm/engine";
import { linkDoRastreio, novoCodigoPublico } from "@/lib/rastreio";

/**
 * RASTREIO NA MÃO DA CLIENTE, EM UM CLIQUE.
 *
 * GET  → devolve o link público (criando o código na primeira vez), para a
 *        vendedora copiar.
 * POST → MANDA o link no WhatsApp da cliente pela conexão da própria loja
 *        (o mesmo caminho das outras mensagens: fica registrado na conversa,
 *        a vendedora vê o que foi dito e a cliente responde ali mesmo).
 *
 * Escopo de pedidos (`orderScope`): vendedora só mexe nos pedidos dela.
 */

async function carregar(userCompanyId: string, orderId: string, escopo: object) {
  return db.order.findFirst({
    where: { id: orderId, ...escopo },
    select: {
      id: true,
      number: true,
      companyId: true,
      conversationId: true,
      customerId: true,
      customer: { select: { id: true, name: true, phone: true } },
      shipping: {
        select: { id: true, publicCode: true, trackingCode: true, meStatus: true },
      },
      company: { select: { name: true } },
    },
  }).then((o) => (o && o.companyId === userCompanyId ? o : null));
}

/** Garante o código público (pedido antigo, comprado antes do link existir). */
async function garantirCodigo(shippingId: string, atual: string | null): Promise<string> {
  if (atual) return atual;
  const code = novoCodigoPublico();
  await db.shipping.update({ where: { id: shippingId }, data: { publicCode: code } });
  return code;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const order = await carregar(user.companyId, id, orderScope(user));
    if (!order)
      return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    if (!order.shipping)
      return NextResponse.json({ error: "Este pedido ainda não tem envio." }, { status: 409 });
    const code = await garantirCodigo(order.shipping.id, order.shipping.publicCode);
    return NextResponse.json({ url: linkDoRastreio(code) });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const order = await carregar(user.companyId, id, orderScope(user));
    if (!order)
      return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    if (!order.shipping)
      return NextResponse.json({ error: "Este pedido ainda não tem envio." }, { status: 409 });
    if (!order.customer.phone)
      return NextResponse.json(
        { error: "A cliente não tem WhatsApp no cadastro. Copie o link e mande por outro caminho." },
        { status: 409 }
      );

    const code = await garantirCodigo(order.shipping.id, order.shipping.publicCode);
    const url = linkDoRastreio(code);

    // conversa da cliente: reaproveita a aberta; senão reabre a encerrada ou
    // cria uma nova NA FILA (mesma régua da recuperação de carrinho)
    let conv = await db.conversation.findFirst({
      where: { companyId: user.companyId, customerId: order.customerId, status: { not: "CLOSED" } },
      orderBy: { lastMessageAt: "desc" },
      select: { id: true },
    });
    if (!conv) {
      const encerrada = await db.conversation.findFirst({
        where: { companyId: user.companyId, customerId: order.customerId, status: "CLOSED" },
        orderBy: { lastMessageAt: "desc" },
        select: { id: true },
      });
      conv = encerrada
        ? await db.conversation.update({
            where: { id: encerrada.id },
            data: { status: "OPEN" },
            select: { id: true },
          })
        : await db.conversation.create({
            data: {
              companyId: user.companyId,
              customerId: order.customerId,
              channel: "WHATSAPP",
              status: "OPEN",
            },
            select: { id: true },
          });
    }

    const primeiroNome = order.customer.name.split(" ")[0];
    // o texto conta a verdade do momento: ainda embalando ≠ já a caminho
    const jaSaiu = order.shipping.meStatus === "POSTADO" || order.shipping.meStatus === "ENTREGUE";
    const abertura = jaSaiu
      ? `Seu pedido ${orderNumber(order.number)} já está a caminho.`
      : `Seu pedido ${orderNumber(order.number)} já está sendo preparado para envio.`;
    const texto =
      `Oi ${primeiroNome}! 📦 ${abertura}\n\n` +
      `Acompanhe a entrega por aqui:\n${url}\n\n` +
      (order.shipping.trackingCode
        ? `Código de rastreio: ${order.shipping.trackingCode}\n\n`
        : "") +
      `Qualquer dúvida é só chamar! 💛`;

    const enviada = await sendMessage({
      conversationId: conv.id,
      companyId: user.companyId,
      body: texto,
      kind: "TEXT",
      mediaType: "TEXT",
      authorId: user.id,
      authorName: user.name,
    });
    // o engine NÃO lança quando o provedor recusa: ele grava a bolha como
    // FALHOU. Sem conferir, a tela dizia "Enviado!" e o histórico registrava
    // um envio que a cliente nunca recebeu (revisão 14/08/2026).
    if (enviada.status === "FALHOU") {
      return NextResponse.json(
        {
          error:
            "O WhatsApp da loja não conseguiu enviar agora (conexão fora do ar). Copie o link e mande pela conversa.",
          url,
        },
        { status: 502 }
      );
    }

    await db.orderEvent.create({
      data: {
        orderId: order.id,
        type: "ENVIO",
        description: `Link de rastreio enviado no WhatsApp da cliente por ${user.name}`,
        userId: user.id,
      },
    });

    return NextResponse.json({ ok: true, url, conversationId: conv.id });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    return NextResponse.json(
      { error: "Não foi possível enviar agora. Copie o link e mande pela conversa." },
      { status: 502 }
    );
  }
}
