import { db } from "./db";
import { PAID_ORDER_STATUSES, orderNumber } from "./orders";
import { cicloEntreCompras, passouDoRitmo } from "./recompra";

/**
 * LINHA DO TEMPO COMERCIAL — a história do relacionamento, não só a última
 * compra.
 *
 * A ficha mostrava eventos soltos; aqui o sistema CONTA A HISTÓRIA:
 *
 *   🛒 15/01 — Pedido #0042 — R$ 1.250 (12 peças)
 *   💬 18/02 — Conversou no WhatsApp · sem pedido na sequência
 *   👀 27/02 — Visitou o catálogo · viu 8 produtos
 *   🛍️ 03/03 — Encheu a sacola (R$ 460) e não finalizou
 *   📣 12/04 — Recebeu a campanha "Volta Maria" · sem resposta
 *   📅 Hoje — há 37 dias sem comprar (ritmo dela: ~34 dias) ⏰
 *
 * Cada linha diz se o movimento VIROU venda — é o que transforma histórico
 * em leitura comercial: dá para ver onde o relacionamento esquenta e onde
 * esfria, e o que costuma destravar a compra dessa cliente.
 */

export type EventoComercial = {
  quando: string; // ISO
  tipo: "PEDIDO" | "PEDIDO_CANCELADO" | "CONVERSA" | "CAMPANHA" | "VISITA" | "SACOLA";
  emoji: string;
  titulo: string;
  detalhe: string | null;
  valor: number | null;
  /** pinta a linha: true = venda/avanço, false = esfriou, null = neutro */
  tom: "BOM" | "RUIM" | "NEUTRO";
};

export type LinhaDoTempo = {
  eventos: EventoComercial[]; // mais recente primeiro
  hoje: {
    diasSemComprar: number | null;
    cicloDias: number | null;
    passouDoPonto: boolean;
  };
};

const DIA_MS = 24 * 60 * 60 * 1000;
/** Movimento "virou pedido" quando a compra sai em até 7 dias. */
const JANELA_VIROU_PEDIDO_DIAS = 7;
/** Campanha "respondida" quando a cliente fala em até 3 dias. */
const JANELA_RESPOSTA_DIAS = 3;
/** Teto de linhas (histórico gigante vira rolagem infinita, não leitura). */
const MAX_EVENTOS = 40;

/** Houve pedido pago em até N dias depois deste momento? (exportada p/ teste) */
export function virouPedidoDepois(
  momento: Date,
  pagas: Date[],
  dias = JANELA_VIROU_PEDIDO_DIAS
): boolean {
  const fim = momento.getTime() + dias * DIA_MS;
  return pagas.some((p) => p.getTime() > momento.getTime() && p.getTime() <= fim);
}

/** O dia (calendário de SP) de uma data — para agrupar conversa por dia. */
export function diaSP(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export async function linhaDoTempoComercial(
  companyId: string,
  customerId: string
): Promise<LinhaDoTempo> {
  const [pedidos, mensagensIn, envios, sessoes, sacolas] = await Promise.all([
    db.order.findMany({
      where: { companyId, customerId },
      select: {
        number: true,
        status: true,
        netTotal: true,
        paidAt: true,
        createdAt: true,
        items: { select: { quantity: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
    db.message.findMany({
      where: {
        direction: "IN",
        kind: "TEXT",
        conversation: { companyId, customerId },
      },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    db.campaignSend.findMany({
      where: { customerId, campaign: { companyId } },
      select: { sentAt: true, campaign: { select: { name: true } } },
      orderBy: { sentAt: "desc" },
      take: 20,
    }),
    db.trackSession.findMany({
      where: { companyId, customerId, productsViewed: { gt: 0 } },
      select: { startedAt: true, productsViewed: true, converted: true, cartAdds: true },
      orderBy: { startedAt: "desc" },
      take: 20,
    }),
    db.abandonedCart.findMany({
      where: { companyId, customerId },
      select: { abandonedAt: true, value: true, status: true },
      orderBy: { abandonedAt: "desc" },
      take: 10,
    }),
  ]);

  const pagas = pedidos
    .filter((p) => (PAID_ORDER_STATUSES as readonly string[]).includes(p.status))
    .map((p) => p.paidAt)
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime());

  const eventos: EventoComercial[] = [];

  // ---- pedidos ----
  for (const p of pedidos) {
    const pago = (PAID_ORDER_STATUSES as readonly string[]).includes(p.status);
    const pecas = p.items.reduce((s, i) => s + i.quantity, 0);
    if (pago && p.paidAt) {
      eventos.push({
        quando: p.paidAt.toISOString(),
        tipo: "PEDIDO",
        emoji: "🛒",
        titulo: `Pedido ${orderNumber(p.number)}`,
        detalhe: `${pecas} peça${pecas === 1 ? "" : "s"}`,
        valor: p.netTotal,
        tom: "BOM",
      });
    } else if (p.status === "CANCELADO") {
      eventos.push({
        quando: p.createdAt.toISOString(),
        tipo: "PEDIDO_CANCELADO",
        emoji: "❌",
        titulo: `Pedido ${orderNumber(p.number)} cancelado`,
        detalhe: null,
        valor: null,
        tom: "RUIM",
      });
    }
  }

  // ---- conversas: um evento por DIA em que a cliente falou ----
  const diasComConversa = new Map<string, Date>();
  for (const m of mensagensIn) {
    const dia = diaSP(m.createdAt);
    const atual = diasComConversa.get(dia);
    if (!atual || m.createdAt < atual) diasComConversa.set(dia, m.createdAt);
  }
  // dias de conversa que são o PRÓPRIO dia de um pedido não entram (o pedido
  // já conta a história daquele dia)
  const diasDePedido = new Set(pagas.map(diaSP));
  for (const [dia, primeira] of [...diasComConversa.entries()].slice(0, 20)) {
    if (diasDePedido.has(dia)) continue;
    const virou = virouPedidoDepois(primeira, pagas);
    eventos.push({
      quando: primeira.toISOString(),
      tipo: "CONVERSA",
      emoji: "💬",
      titulo: "Conversou no WhatsApp",
      detalhe: virou ? "→ virou pedido dias depois" : "sem pedido na sequência",
      valor: null,
      tom: virou ? "BOM" : "NEUTRO",
    });
  }

  // ---- campanhas: recebeu, e o que deu? ----
  const falas = mensagensIn.map((m) => m.createdAt);
  for (const e of envios) {
    const respondeu = falas.some(
      (f) =>
        f.getTime() > e.sentAt.getTime() &&
        f.getTime() <= e.sentAt.getTime() + JANELA_RESPOSTA_DIAS * DIA_MS
    );
    const comprou = virouPedidoDepois(e.sentAt, pagas);
    eventos.push({
      quando: e.sentAt.toISOString(),
      tipo: "CAMPANHA",
      emoji: "📣",
      titulo: `Recebeu a campanha “${e.campaign.name}”`,
      detalhe: comprou
        ? "→ virou pedido 🎯"
        : respondeu
          ? "respondeu, sem pedido"
          : "sem resposta",
      valor: null,
      tom: comprou ? "BOM" : respondeu ? "NEUTRO" : "RUIM",
    });
  }

  // ---- visitas ao catálogo (sem virar pedido na hora) ----
  for (const s of sessoes) {
    if (s.converted) continue; // a visita que converteu já aparece como pedido
    eventos.push({
      quando: s.startedAt.toISOString(),
      tipo: "VISITA",
      emoji: "👀",
      titulo: "Visitou o catálogo",
      detalhe: `viu ${s.productsViewed} produto${s.productsViewed === 1 ? "" : "s"}${
        s.cartAdds > 0 ? " · mexeu na sacola" : ""
      }`,
      valor: null,
      tom: "NEUTRO",
    });
  }

  // ---- sacolas abandonadas ----
  for (const s of sacolas) {
    eventos.push({
      quando: s.abandonedAt.toISOString(),
      tipo: "SACOLA",
      emoji: "🛍️",
      titulo: "Encheu a sacola e não finalizou",
      detalhe: s.status === "RECUPERADO" ? "→ recuperada depois 🎯" : null,
      valor: s.value,
      tom: s.status === "RECUPERADO" ? "BOM" : "RUIM",
    });
  }

  // mais recente primeiro, com teto de leitura
  eventos.sort((a, b) => b.quando.localeCompare(a.quando));

  // ---- o "hoje": dias sem comprar vs o ritmo DELA (mesma régua da agenda) ----
  const ultima = pagas[pagas.length - 1] ?? null;
  const diasSemComprar = ultima
    ? Math.floor((Date.now() - ultima.getTime()) / DIA_MS)
    : null;
  const ciclo = cicloEntreCompras(pagas[0] ?? null, ultima, pagas.length);

  return {
    eventos: eventos.slice(0, MAX_EVENTOS),
    hoje: {
      diasSemComprar,
      cicloDias: ciclo ? Math.round(ciclo) : null,
      passouDoPonto:
        diasSemComprar != null && ciclo != null && passouDoRitmo(diasSemComprar, ciclo),
    },
  };
}
