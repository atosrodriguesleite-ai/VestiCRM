import { randomBytes } from "node:crypto";
import { db } from "./db";
import { meTracking } from "./melhorenvio";
import { orderNumber, PAID_ORDER_STATUSES } from "./orders";
import { sendToUser } from "./push";
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
/**
 * Quantos envios cada rodada consulta. As consultas saem em LOTES paralelos
 * (LOTE), senão 12 chamadas em série já estouravam o tempo da função — e a
 * rodada morria no meio com a trava de 20 min já queimada.
 * Conta de capacidade: 40 por rodada × 3 rodadas/h = 120/h para a plataforma
 * inteira; com revisita de 3h, sustenta ~360 envios em trânsito ao mesmo
 * tempo (antes eram ~108, e a fila atrasava dias com pouco volume).
 */
const POR_RODADA = 40;
const LOTE = 5;
/** Não reconsulta o mesmo envio antes disso. */
const REVISITA_MS = 3 * 60 * 60_000;
/** Etiqueta comprada e nunca postada vira peso morto: sai da fila. */
const DESISTE_SEM_POSTAR_MS = 30 * 24 * 60 * 60_000;
/** Postado que nunca chega (extravio): a fila também aposenta. */
const DESISTE_EM_TRANSITO_MS = 60 * 24 * 60 * 60_000;

/** Situações em que o envio ainda pode mudar (as outras são ponto final). */
const EM_TRANSITO = ["COMPRADO", "GERANDO", "ETIQUETA", "POSTADO"];

/**
 * Quanto cada situação "avança" — o envio nunca REGRIDE. O Melhor Envio às
 * vezes responde "posted" depois de já ter dito "delivered"; sem esta régua a
 * cliente via a página voltar de "Entregue" para "A caminho", e o envio
 * reentrava na fila para sempre.
 */
const AVANCO: Record<string, number> = {
  COMPRADO: 1,
  GERANDO: 2,
  ETIQUETA: 3,
  POSTADO: 4,
  DEVOLVIDO: 5,
  ENTREGUE: 6,
};

/** Status cru do Melhor Envio → o nosso. Desconhecido = não mexe. */
export function statusDoRastreio(bruto: string | null | undefined): string | null {
  const s = (bruto ?? "").toLowerCase();
  if (s === "delivered") return "ENTREGUE";
  if (s === "posted") return "POSTADO";
  if (s === "cancelled" || s === "canceled") return "CANCELADO";
  // pacote que VOLTOU para a loja: não mexe no status do pedido (a decisão de
  // reenviar ou devolver o dinheiro é humana), mas precisa virar aviso —
  // antes sumia no "desconhecido" e a venda voltava sem ninguém saber
  if (s === "undelivered" || s === "returned" || s === "returning") return "DEVOLVIDO";
  return null;
}

/** A situação nova pode substituir a atual? (só para frente; cancelado à parte) */
export function podeAvancarEnvio(atual: string | null, nova: string | null): boolean {
  if (!nova || nova === atual) return false;
  const peso = (s: string | null) => (s ? (AVANCO[s] ?? 0) : 0);
  // etiqueta cancelada só vale enquanto a caixa não saiu
  if (nova === "CANCELADO") return peso(atual) < AVANCO.POSTADO;
  if (atual === "CANCELADO") return false;
  return peso(nova) > peso(atual);
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
    const pedido = await db.order.findFirst({
      where: { id: envio.orderId, companyId },
      select: {
        id: true,
        number: true,
        status: true,
        sellerId: true,
        customer: { select: { name: true } },
      },
    });
    if (!pedido) return envio;
    const cancelado = pedido.status === "CANCELADO";

    const resposta = statusDoRastreio(tracking.status);
    // SÓ PARA FRENTE também na situação do envio: "delivered" e depois
    // "posted" (o ME oscila) fazia a página da cliente voltar de "Entregue"
    // para "A caminho" e o envio reentrava na fila para sempre.
    const situacao = podeAvancarEnvio(envio.meStatus, resposta) ? resposta : envio.meStatus;
    const codigoNovo =
      tracking.tracking && tracking.tracking !== envio.trackingCode
        ? tracking.tracking
        : null;
    const mudou = codigoNovo !== null || situacao !== envio.meStatus;
    // datas DA TRANSPORTADORA quando ela manda (a varredura passa de tempos em
    // tempos: carimbar a hora da consulta mostrava à cliente um dia errado).
    // Entrega sem postagem informada usa a própria entrega, nunca "agora":
    // senão a página mostrava "A caminho em 14/08" acima de "Entregue em 10/08".
    const entregou = tracking.deliveredAt ?? agora;
    const postou = tracking.postedAt ?? (situacao === "ENTREGUE" ? entregou : agora);

    const atualizado = await db.shipping.update({
      where: { id: envio.id },
      data: {
        trackedAt: agora, // marca a consulta mesmo quando nada mudou
        ...(codigoNovo ? { trackingCode: codigoNovo } : {}),
        ...(mudou ? { meStatus: situacao } : {}),
        // pedido CANCELADO não recebe marca de envio: a rota de cancelamento
        // limpa shippedAt/deliveredAt e a varredura regravava, fazendo a tela
        // exibir "Entregue em..." num pedido morto (revisão 14/08/2026)
        ...(situacao === "POSTADO" && !envio.shippedAt && !cancelado ? { shippedAt: postou } : {}),
        ...(situacao === "ENTREGUE" && !envio.deliveredAt && !cancelado
          ? { deliveredAt: entregou, ...(envio.shippedAt ? {} : { shippedAt: postou }) }
          : {}),
      },
    });

    // A CAIXA CHEGOU NUM PEDIDO CANCELADO: o pedido não anda (e não deve),
    // mas alguém precisa saber — se o cancelamento devolveu as peças ao
    // estoque, a loja tem peça "em estoque" que está na casa da cliente, sem
    // cobrança. Antes isso passava em silêncio absoluto.
    if (cancelado && situacao === "ENTREGUE" && envio.meStatus !== "ENTREGUE") {
      await avisarPedido(companyId, pedido, {
        evento:
          "⚠️ A transportadora ENTREGOU um pedido CANCELADO. Confira o estoque (as peças podem ter voltado no sistema e estarem com a cliente) e a cobrança.",
        titulo: "⚠️ Pedido cancelado foi entregue",
        corpo: `${orderNumber(pedido.number)} · ${pedido.customer.name} — a caixa chegou na cliente. Confira estoque e cobrança.`,
        soGerencia: true,
      });
    }

    // PACOTE VOLTANDO PARA A LOJA: não mexe no status (reenviar ou devolver o
    // dinheiro é decisão humana), mas vira aviso — antes a venda voltava e
    // ninguém ficava sabendo.
    if (situacao === "DEVOLVIDO" && envio.meStatus !== "DEVOLVIDO") {
      await avisarPedido(companyId, pedido, {
        evento:
          "↩️ A transportadora informou DEVOLUÇÃO AO REMETENTE — o pacote está voltando para a loja. Combine com a cliente o reenvio ou o estorno.",
        titulo: "↩️ Pacote voltando para a loja",
        corpo: `${orderNumber(pedido.number)} · ${pedido.customer.name} — a entrega não aconteceu.`,
        soGerencia: false,
      });
    }

    // SEMPRE tenta fazer o pedido andar — não só quando o envio mudou de
    // situação. Envio que já estava POSTADO no banco (gravado antes desta
    // automação existir, ou pago depois de entregue) responde "posted" de
    // novo: se a chamada dependesse da mudança, esse pedido ficava parado em
    // PAGO para sempre. É idempotente (troca condicionada ao status atual).
    await fazerPedidoAndar(companyId, pedido, situacao);
    return atualizado;
  } catch {
    return envio;
  }
}

type PedidoDoRastreio = {
  id: string;
  number: number;
  status: string;
  sellerId: string | null;
  customer: { name: string };
};

/** Marcas estáveis no histórico — é por elas que a automação sabe que já fez. */
const MARCA_AUTO: Record<"ENVIADO" | "ENTREGUE", string> = {
  ENVIADO: '🚚 Status alterado para "Enviado" pelo rastreio',
  ENTREGUE: '📦 Status alterado para "Entregue" pelo rastreio',
};

/**
 * Aviso de rastreio: histórico do pedido + sino + push, para QUEM É DONO da
 * venda (ou gerência/admin quando o pedido não tem vendedora). Antes ia por
 * push para a loja inteira: toda vendedora recebia o nome da cliente das
 * outras e, ao tocar, caía numa página "não encontrada" (o `orderScope` já
 * barra pedido de colega) — e nada ficava no sino.
 */
async function avisarPedido(
  companyId: string,
  pedido: PedidoDoRastreio,
  aviso: { evento: string; titulo: string; corpo: string; soGerencia: boolean }
): Promise<void> {
  await db.orderEvent
    .create({ data: { orderId: pedido.id, type: "ENVIO", description: aviso.evento } })
    .catch(() => {});
  const gerencia = async () =>
    (
      await db.user.findMany({
        where: { companyId, role: { in: ["ADMIN", "MANAGER"] }, active: true },
        select: { id: true },
      })
    ).map((u) => u.id);
  const destinos =
    aviso.soGerencia || !pedido.sellerId ? await gerencia() : [pedido.sellerId];
  if (destinos.length === 0) return;
  await db.notification
    .createMany({
      data: destinos.map((userId) => ({
        companyId,
        userId,
        type: "PEDIDO",
        title: aviso.titulo,
        body: aviso.corpo,
        orderId: pedido.id,
      })),
    })
    .catch(() => {});
  await Promise.allSettled(
    destinos.map((userId) =>
      sendToUser(userId, {
        title: aviso.titulo,
        body: aviso.corpo,
        url: `/pedidos/${pedido.id}`,
        tag: `rastreio-${pedido.id}-${aviso.titulo}`,
      })
    )
  );
}

/**
 * Postado → ENVIADO; entregue → ENTREGUE. Só para pedido já pago, só para
 * frente, e a troca é ATÔMICA (updateMany condicionado ao status que
 * autorizou a mudança): duas rodadas simultâneas não escrevem duas vezes.
 *
 * A DECISÃO HUMANA VENCE: cada transição é aplicada UMA VEZ por pedido. Se a
 * gerente puxar o pedido de volta (o pacote voltou, vai reenviar), a
 * automação não desmancha a correção dela na rodada seguinte — antes era uma
 * guerra de escrita que a máquina sempre ganhava (revisão 14/08/2026).
 */
async function fazerPedidoAndar(
  companyId: string,
  pedido: PedidoDoRastreio,
  situacao: string | null
): Promise<void> {
  const novo = statusDoPedidoPeloRastreio(pedido.status, situacao);
  if (!novo) return;

  const jaFez = await db.orderEvent.findFirst({
    where: {
      orderId: pedido.id,
      type: "ENVIO",
      description: { startsWith: MARCA_AUTO[novo] },
    },
    select: { id: true },
  });
  if (jaFez) return; // já andou uma vez: o que veio depois foi decisão de gente

  const detalhe =
    novo === "ENVIADO"
      ? `${MARCA_AUTO.ENVIADO} da transportadora (postagem confirmada)`
      : `${MARCA_AUTO.ENTREGUE} da transportadora`;

  // status e histórico na MESMA transação: a varredura roda em `after()` e
  // pode ser cortada no meio — pedido que amanhece "Entregue" sem uma linha
  // explicando deixa a lojista sem saber se foi gente ou robô
  const trocou = await db.$transaction(async (tx) => {
    const r = await tx.order.updateMany({
      where: { id: pedido.id, companyId, status: pedido.status as never },
      data: { status: novo },
    });
    if (r.count === 0) return false; // outra rodada/pessoa mudou antes: fica o dela
    await tx.orderEvent.create({
      data: { orderId: pedido.id, type: "ENVIO", description: detalhe },
    });
    return true;
  });
  if (!trocou) return;

  const dona = pedido.sellerId ? [pedido.sellerId] : null;
  const destinos =
    dona ??
    (
      await db.user.findMany({
        where: { companyId, role: { in: ["ADMIN", "MANAGER"] }, active: true },
        select: { id: true },
      })
    ).map((u) => u.id);
  if (destinos.length === 0) return;
  const titulo = novo === "ENVIADO" ? "🚚 Pedido postado" : "📦 Pedido entregue";
  const corpo = `${orderNumber(pedido.number)} · ${pedido.customer.name} — ${
    novo === "ENVIADO" ? "a caminho da cliente" : "chegou no destino"
  }`;
  await db.notification
    .createMany({
      data: destinos.map((userId) => ({
        companyId,
        userId,
        type: "PEDIDO",
        title: titulo,
        body: corpo,
        orderId: pedido.id,
      })),
    })
    .catch(() => {});
  await Promise.allSettled(
    destinos.map((userId) =>
      sendToUser(userId, {
        title: titulo,
        body: corpo,
        url: `/pedidos/${pedido.id}`,
        tag: `rastreio-${pedido.id}-${novo}`,
      })
    )
  );
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
        order: {
          // pedido CANCELADO sai da fila: não anda mais e só consumia consulta
          status: { not: "CANCELADO" as never },
          company: {
            // loja suspensa não consome chamada externa
            suspended: false,
            // MÓDULO ENVIOS É PAGO À PARTE: sem o interruptor ligado, a tela
            // devolve "não contratado" — a varredura não pode ficar rodando
            // por trás, gastando chamada e mexendo no status dos pedidos de
            // quem não contratou (revisão 14/08/2026)
            shippingEnabled: true,
          },
        },
        AND: [
          {
            OR: [
              { trackedAt: null },
              { trackedAt: { lt: new Date(agora.getTime() - REVISITA_MS) } },
            ],
          },
          {
            OR: [
              // em trânsito, mas SEM peso morto: etiqueta comprada e nunca
              // postada há mais de 30 dias, ou postagem sem desfecho há mais
              // de 60, saem da fila — senão a fila só cresce e o envio de
              // hoje espera dias pela vez dele.
              {
                meStatus: { in: EM_TRANSITO },
                order: {
                  createdAt: {
                    gt: new Date(agora.getTime() - DESISTE_EM_TRANSITO_MS),
                  },
                },
              },
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
          {
            // etiqueta parada (nunca postada) também tem prazo de validade
            OR: [
              { meStatus: { notIn: ["COMPRADO", "GERANDO", "ETIQUETA"] } },
              { order: { createdAt: { gt: new Date(agora.getTime() - DESISTE_SEM_POSTAR_MS) } } },
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

    // EM LOTES PARALELOS: em série, 40 consultas externas estouravam o tempo
    // da função e a rodada morria no meio com a trava já queimada por 20 min
    for (let i = 0; i < envios.length; i += LOTE) {
      await Promise.allSettled(
        envios.slice(i, i + LOTE).map(async (e) => {
          const t = await meTracking(e.order.companyId, e.meOrderId!).catch(() => null);
          if (!t) {
            // não respondeu: marca a tentativa para não travar a fila num envio só
            await db.shipping
              .update({ where: { id: e.id }, data: { trackedAt: agora } })
              .catch(() => {});
            return;
          }
          await aplicarRastreio({ companyId: e.order.companyId, envio: e, tracking: t });
        })
      );
    }
  } catch {
    /* varredura nunca derruba a tela que a chamou */
  }
}
