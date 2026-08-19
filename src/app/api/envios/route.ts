import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp, orderScope } from "@/lib/scope";
import { atualizarRastreiosSeDevido } from "@/lib/rastreio";
import { DIAS_PARA_PARADO, inicioDoMesSP, resumoDosEnvios } from "@/lib/envios/painel";

export const dynamic = "force-dynamic";

/**
 * Tela ENVIOS (módulo Envios, gated por loja): tudo que a loja despachou
 * pelo Melhor Envio num lugar só — status, rastreio, destinatária — mais o
 * painel (gasto do mês, em trânsito, parados, tempo de entrega).
 *
 * RN-007 vale aqui como em toda porta: vendedora vê SÓ os envios dos pedidos
 * dela (`orderScope`); gerência/suporte veem a loja inteira. O painel soma
 * dentro do MESMO escopo — o número que a pessoa vê é dos pedidos que ela vê.
 *
 * A tela também é tráfego: a varredura de rastreio pega carona (sem cron
 * novo, regra do CLAUDE.md) — abrir Envios já deixa os status mais frescos.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const company = await db.company.findUnique({
      where: { id: user.companyId },
      select: { shippingEnabled: true, freteSimuladorEnabled: true },
    });
    if (!company?.shippingEnabled)
      return NextResponse.json({ error: "Módulo Envios não contratado." }, { status: 403 });

    // carona da varredura: quem abre a tela de envios quer status fresco
    after(() => atualizarRastreiosSeDevido());

    const escopo = { meOrderId: { not: null }, order: orderScope(user) };
    // fronteira do mês NO FUSO DE SÃO PAULO (mesma lição do lib/periodo.ts:
    // em UTC cru o "gasto do mês" zerava às 21h do dia 31 na frente da lojista)
    const inicioDoMes = inicioDoMesSP();

    // BUSCA NO SERVIDOR: a lista carrega os 300 mais recentes, mas a lupa
    // tem que enxergar a loja inteira — a lupa que "só via as 200 carregadas"
    // já foi incidente real na Central de WhatsApp (lição do CLAUDE.md)
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
    const numeroBuscado = Number(q.replace(/\D/g, ""));
    const filtroBusca = q
      ? {
          OR: [
            { order: { customer: { name: { contains: q, mode: "insensitive" as const } } } },
            { trackingCode: { contains: q, mode: "insensitive" as const } },
            ...(Number.isInteger(numeroBuscado) && numeroBuscado > 0
              ? [{ order: { number: numeroBuscado } }]
              : []),
          ],
        }
      : {};

    const [linhas, porStatus, gasto, entreguesRecentes, parados] = await Promise.all([
      db.shipping.findMany({
        where: { ...escopo, ...filtroBusca },
        // compra mais recente primeiro; etiqueta de antes da coluna existir
        // (meCompradoEm nulo) vai para o fim, ordenada pelo id
        orderBy: [{ meCompradoEm: { sort: "desc", nulls: "last" } }, { id: "desc" }],
        take: 300,
        select: {
          id: true,
          orderId: true,
          meCarrier: true,
          meService: true,
          meStatus: true,
          mePrice: true,
          trackingCode: true,
          publicCode: true,
          labelUrl: true,
          weightKg: true,
          pieces: true,
          meCompradoEm: true,
          shippedAt: true,
          deliveredAt: true,
          city: true,
          state: true,
          nfeKey: true,
          order: {
            select: { number: true, customer: { select: { name: true } } },
          },
        },
      }),
      db.shipping.groupBy({
        by: ["meStatus"],
        where: escopo,
        _count: { _all: true },
      }),
      db.shipping.aggregate({
        where: {
          ...escopo,
          meStatus: { not: "CANCELADO" },
          meCompradoEm: { gte: inicioDoMes },
        },
        _sum: { mePrice: true },
      }),
      // tempo médio de entrega: só os desfechos dos últimos 90 dias — a
      // operação de hoje, não a média da vida inteira da loja
      db.shipping.findMany({
        where: {
          ...escopo,
          deliveredAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
          shippedAt: { not: null },
        },
        take: 500,
        select: { shippedAt: true, deliveredAt: true },
      }),
      // parados: contados no banco, sobre o escopo INTEIRO — se saísse da
      // lista (300 mais recentes), o envio esquecido de dois meses atrás,
      // que é justamente o alerta, ficava de fora da conta
      db.shipping.count({
        where: {
          ...escopo,
          meStatus: "POSTADO",
          shippedAt: {
            lt: new Date(Date.now() - DIAS_PARA_PARADO * 24 * 60 * 60 * 1000),
          },
        },
      }),
    ]);

    const painel = resumoDosEnvios({
      porStatus: porStatus.map((s) => ({
        meStatus: s.meStatus,
        quantidade: s._count._all,
      })),
      gastoMes: gasto._sum.mePrice ?? 0,
      parados,
      entregues: entreguesRecentes,
    });

    return NextResponse.json({
      lista: linhas.map((l) => ({
        id: l.id,
        orderId: l.orderId,
        pedido: l.order.number,
        cliente: l.order.customer.name,
        transportadora: l.meCarrier,
        servico: l.meService,
        status: l.meStatus,
        preco: l.mePrice,
        rastreio: l.trackingCode,
        linkPublico: l.publicCode,
        etiqueta: l.labelUrl,
        pesoKg: l.weightKg,
        pecas: l.pieces,
        compradoEm: l.meCompradoEm,
        postadoEm: l.shippedAt,
        entregueEm: l.deliveredAt,
        cidade: l.city,
        uf: l.state,
        comNota: Boolean(l.nfeKey),
      })),
      painel,
      diasParaParado: DIAS_PARA_PARADO,
      simuladorLigado: company.freteSimuladorEnabled,
      podeLigarSimulador: isManagerUp(user),
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
