import { randomBytes } from "node:crypto";
import { db } from "./db";
import { meTracking } from "./melhorenvio";
import { orderNumber, PAID_ORDER_STATUSES } from "./orders";
import { sendToCompany } from "./push";
import { platformUrl } from "./site";

/**
 * O PEDIDO ANDA SOZINHO ATÉ A PORTA DA CLIENTE (14/08/2026).
 *
 * Antes, quem comprava a etiqueta pelo sistema ainda tinha que voltar no
 * pedido e mudar o status à mão: postou → "Enviado", chegou → "Entregue".
 * Ninguém faz isso no meio do dia, e o painel de Pedidos virava ficção.
 *
 * Aqui o rastreio da transportadora vira status do pedido:
 *   postado  → ENVIADO      chegou → ENTREGUE
 *
 * DUAS TRAVAS DE OURO (mexe com dinheiro e estoque):
 *  1. só faz andar pedido que JÁ ESTÁ PAGO (PAGO/EM_PRODUCAO/SEPARACAO →
 *     ENVIADO → ENTREGUE). ENVIADO e ENTREGUE contam como faturamento: se a
 *     varredura empurrasse um orçamento não pago para "Enviado", a venda
 *     entrava no caixa sem ninguém ter pago e o estoque não baixava pelo
 *     caminho normal. Cancelado nunca é tocado;
 *  2. só anda para FRENTE. Nada volta.
 *
 * A varredura roda DE CARONA no tráfego (`atualizarRastreiosSeDevido`), sem
 * cron novo — o Vercel Hobby só permite 2 crons diários, e um terceiro
 * bloqueia todos os deploys em silêncio (regra do CLAUDE.md).
 */

/** Intervalo mínimo entre duas varreduras (trava global anti-corrida). */
const VARREDURA_INTERVALO_MS = 20 * 60_000;
/** Quantos envios cada rodada consulta (a chamada é externa, uma por envio). */
const POR_RODADA = 12;
/** Não reconsulta o mesmo envio antes disso. */
const REVISITA_MS = 3 * 60 * 60_000;

/** Situações em que o envio ainda pode mudar (as outras são ponto final). */
const EM_TRANSITO = ["COMPRADO", "GERANDO", "ETIQUETA", "POSTADO"];

/** Status cru do Melhor Envio → o nosso. Desconhecido = não mexe. */
export function statusDoRastreio(bruto: string | null | undefined): string | null {
  const s = (bruto ?? "").toLowerCase();
  if (s === "delivered") return "ENTREGUE";
  if (s === "posted") return "POSTADO";
  if (s === "cancelled" || s === "canceled") return "CANCELADO";
  return null;
}

/** Código do link público de rastreio (curto, sorteado, sem id do pedido). */
export function novoCodigoPublico(): string {
  return randomBytes(9).toString("base64url"); // 12 caracteres
}

/** Link que a cliente abre para acompanhar a entrega. */
export function linkDoRastreio(publicCode: string): string {
  return `${platformUrl()}/rastreio/${publicCode}`;
}

/**
 * O status do pedido que o rastreio pede — ou null quando não deve mexer.
 * É AQUI que moram as duas travas de ouro (paga e só para frente).
 */
export function statusDoPedidoPeloRastreio(
  statusAtual: string,
  situacaoDoEnvio: string | null
): "ENVIADO" | "ENTREGUE" | null {
  // pedido que ainda não é venda paga não anda sozinho (nem cancelado)
  if (!(PAID_ORDER_STATUSES as readonly string[]).includes(statusAtual)) return null;
  if (situacaoDoEnvio === "ENTREGUE" && statusAtual !== "ENTREGUE") return "ENTREGUE";
  if (
    situacaoDoEnvio === "POSTADO" &&
    // já entregue não volta para "enviado"
    statusAtual !== "ENTREGUE" &&
    statusAtual !== "ENVIADO"
  )
    return "ENVIADO";
  return null;
}

type EnvioParaAtualizar = {
  id: string;
  orderId: string;
  meStatus: string | null;
  trackingCode: string | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  publicCode: string | null;
};

/**
 * Guarda o que a transportadora respondeu e faz o pedido andar. Nunca lança —
 * rastreio é reflexo do trabalho, jamais pedágio dele.
 *
 * Devolve o envio atualizado (ou o mesmo, quando nada mudou).
 */
export async function aplicarRastreio(args: {
  companyId: string;
  envio: EnvioParaAtualizar;
  tracking: {
    tracking: string | null;
    status: string | null;
    postedAt?: Date | null;
    deliveredAt?: Date | null;
  };
}): Promise<EnvioParaAtualizar> {
  const { companyId, envio, tracking } = args;
  try {
    const agora = new Date();
    const situacao = statusDoRastreio(tracking.status) ?? envio.meStatus;
    const codigoNovo =
      tracking.tracking && tracking.tracking !== envio.trackingCode
        ? tracking.tracking
        : null;
    const mudou = codigoNovo !== null || situacao !== envio.meStatus;
    // datas DA TRANSPORTADORA quando ela manda (a varredura passa de tempos em
    // tempos: carimbar a hora da consulta mostrava à cliente um dia errado)
    const postou = tracking.postedAt ?? agora;
    const entregou = tracking.deliveredAt ?? agora;

    const atualizado = await db.shipping.update({
      where: { id: envio.id },
      data: {
        trackedAt: agora, // marca a consulta mesmo quando nada mudou
        ...(codigoNovo ? { trackingCode: codigoNovo } : {}),
        ...(mudou ? { meStatus: situacao } : {}),
        ...(situacao === "POSTADO" && !envio.shippedAt ? { shippedAt: postou } : {}),
        ...(situacao === "ENTREGUE" && !envio.deliveredAt
          ? { deliveredAt: entregou, ...(envio.shippedAt ? {} : { shippedAt: postou }) }
          : {}),
      },
    });

    // SEMPRE tenta fazer o pedido andar — não só quando o envio mudou de
    // situação. Envio que já estava POSTADO no banco (gravado antes desta
    // automação existir, ou pago depois de entregue) responde "posted" de
    // novo: se a chamada dependesse da mudança, esse pedido ficava parado em
    // PAGO para sempre. É idempotente (troca condicionada ao status atual).
    await fazerPedidoAndar(companyId, envio.orderId, situacao);
    return atualizado;
  } catch {
    return envio;
  }
}

/**
 * Postado → ENVIADO; entregue → ENTREGUE. Só para pedido já pago, só para
 * frente, e a troca é ATÔMICA (updateMany condicionado ao status que
 * autorizou a mudança): duas rodadas simultâneas não escrevem duas vezes.
 */
async function fazerPedidoAndar(
  companyId: string,
  orderId: string,
  situacao: string | null
): Promise<void> {
  const pedido = await db.order.findFirst({
    where: { id: orderId, companyId },
    select: { id: true, number: true, status: true, customer: { select: { name: true } } },
  });
  if (!pedido) return;
  const novo = statusDoPedidoPeloRastreio(pedido.status, situacao);
  if (!novo) return;

  const trocou = await db.order.updateMany({
    where: { id: pedido.id, companyId, status: pedido.status },
    data: { status: novo },
  });
  if (trocou.count === 0) return; // outra rodada/pessoa mudou antes: fica o dela

  await db.orderEvent.create({
    data: {
      orderId: pedido.id,
      type: "ENVIO",
      description:
        novo === "ENVIADO"
          ? "🚚 Status alterado para \"Enviado\" pelo rastreio da transportadora (postagem confirmada)"
          : "📦 Status alterado para \"Entregue\" pelo rastreio da transportadora",
    },
  });

  // a loja fica sabendo sem precisar abrir o pedido
  await sendToCompany(companyId, {
    title: novo === "ENVIADO" ? "🚚 Pedido postado" : "📦 Pedido entregue",
    body: `${orderNumber(pedido.number)} · ${pedido.customer.name} — ${
      novo === "ENVIADO" ? "a caminho da cliente" : "chegou no destino"
    }`,
    url: `/pedidos/${pedido.id}`,
    tag: `rastreio-${pedido.id}-${novo}`,
  }).catch(() => {});
}

/**
 * Varredura DE CARONA: atualiza os envios em trânsito mais esquecidos.
 * Uma trava atômica garante no máximo uma rodada por intervalo, mesmo com
 * várias abas abertas. Seguro para chamar de qualquer rota: nunca lança, e
 * quando não está na hora custa uma consulta.
 */
export async function atualizarRastreiosSeDevido(): Promise<void> {
  try {
    const agora = new Date();
    await db.systemHealth
      .createMany({ data: [{ id: "main" }], skipDuplicates: true })
      .catch(() => {});
    const claimed = await db.systemHealth.updateMany({
      where: {
        id: "main",
        OR: [
          { trackingRunAt: null },
          { trackingRunAt: { lt: new Date(agora.getTime() - VARREDURA_INTERVALO_MS) } },
        ],
      },
      data: { trackingRunAt: agora },
    });
    if (claimed.count === 0) return;

    const envios = await db.shipping.findMany({
      where: {
        meOrderId: { not: null },
        // loja suspensa não consome chamada externa
        order: { company: { suspended: false } },
        AND: [
          {
            OR: [
              { trackedAt: null },
              { trackedAt: { lt: new Date(agora.getTime() - REVISITA_MS) } },
            ],
          },
          {
            OR: [
              { meStatus: { in: EM_TRANSITO } },
              // já entregue mas o PEDIDO ainda não sabe: acontece com envio
              // gravado antes desta automação existir e com a compra que só
              // foi paga depois de entregue. Sem esta linha, esse pedido
              // ficava parado para sempre (a fila só olhava "em trânsito").
              {
                meStatus: "ENTREGUE",
                order: {
                  status: {
                    in: (PAID_ORDER_STATUSES as readonly string[]).filter(
                      (s) => s !== "ENTREGUE"
                    ) as never,
                  },
                },
              },
            ],
          },
        ],
      },
      orderBy: [{ trackedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
      take: POR_RODADA,
      select: {
        id: true,
        orderId: true,
        meOrderId: true,
        meStatus: true,
        trackingCode: true,
        shippedAt: true,
        deliveredAt: true,
        publicCode: true,
        order: { select: { companyId: true } },
      },
    });

    for (const e of envios) {
      const t = await meTracking(e.order.companyId, e.meOrderId!).catch(() => null);
      if (!t) {
        // não respondeu: marca a tentativa para não travar a fila num envio só
        await db.shipping.update({ where: { id: e.id }, data: { trackedAt: agora } }).catch(() => {});
        continue;
      }
      await aplicarRastreio({ companyId: e.order.companyId, envio: e, tracking: t });
    }
  } catch {
    /* varredura nunca derruba a tela que a chamou */
  }
}
